import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSiteExportResponse } from "../src/lib/admin/export-response";
import { buildZip } from "../src/lib/admin/export-zip";

test("export HTTP: denied or unavailable identity never reads privileged data", async () => {
  let reads = 0;
  const buildArchive = async () => { reads++; return new Uint8Array(0); };
  for (const owner of [false, true]) {
    const response = await createSiteExportResponse({
      getIdentity: async () => { if (owner) throw new Error("AUTH_SECRET_TRAP"); return { owner }; },
      buildArchive,
    });
    assert.equal(response.status, owner ? 503 : 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-disposition"), null);
    assert(!(await response.text()).includes("TRAP"));
  }
  assert.equal(reads, 0);
});

test("export HTTP: snapshot or archive failure returns no partial ZIP or sensitive log", async (t) => {
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  const response = await createSiteExportResponse({
    getIdentity: async () => ({ owner: true }),
    buildArchive: async () => { throw new Error("PAID_BODY_AND_SECRET_TRAP"); },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-disposition"), null);
  assert(!(await response.text()).includes("TRAP"));
  assert.equal(logs.length, 1);
  assert(!JSON.stringify(logs).includes("TRAP"));
});

test("export HTTP: completed 23 MB ZIP streams intact in bounded chunks", async () => {
  const payload = new Uint8Array(23 * 1024 * 1024);
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
  const zip = buildZip([{ path: "data/large.bin", content: payload }]);
  const expected = createHash("sha256").update(zip).digest("hex");
  let complete!: (value: Uint8Array) => void;
  let returned = false;
  const pending = createSiteExportResponse({
    getIdentity: async () => ({ owner: true }),
    buildArchive: () => new Promise(resolve => { complete = resolve; }),
  }).then(response => { returned = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, false, "No download response before archive completion");
  complete(zip);
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), String(zip.byteLength));
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.match(response.headers.get("content-disposition")!, /^attachment; filename="wanyou-export-\d{8}\.zip"$/);
  const reader = response.body!.getReader();
  const hash = createHash("sha256");
  let bytes = 0, chunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    assert(value.byteLength > 0 && value.byteLength <= 64 * 1024);
    bytes += value.byteLength; chunks++; hash.update(value);
  }
  assert(chunks > 1);
  assert.equal(bytes, zip.byteLength);
  assert.equal(hash.digest("hex"), expected);
});

test("export HTTP: cancelling a download stops further chunks", async () => {
  const response = await createSiteExportResponse({
    getIdentity: async () => ({ owner: true }),
    buildArchive: async () => new Uint8Array(200_000),
  });
  const reader = response.body!.getReader();
  assert.equal((await reader.read()).done, false);
  await reader.cancel();
  assert.equal((await reader.read()).done, true);
});
