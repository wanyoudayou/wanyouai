import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import sharp from "sharp";
import { installTestDatabase } from "./support/database";
import {
  uploadDescriptor,
  validateStagedImage,
} from "../src/lib/media/validation";
import { resolveMedia } from "../src/lib/publishing/media";
import { publicMediaUrl } from "../src/lib/publishing/media-url";
import { contentHash } from "../src/lib/publishing/validate";
import { localReferences } from "../src/lib/importing/paths";
import { prepareUploadProtocol } from "../src/lib/media/upload-protocol";
import { MediaLibraryError, type MediaAsset } from "../src/lib/media/types";
import { parseExportSnapshot } from "../src/lib/admin/export-snapshot";
import type { PublishInput } from "../src/lib/publishing/types";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

test("an existing staging object is confirmed before signing; uncertain results never overwrite it", async () => {
  const ticket = {
    asset_id: null,
    source_hash: "a".repeat(64),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    resumed: true,
  };
  let signed = 0;
  const complete = {
    asset: { id: "asset" } as MediaAsset,
    sourceHash: ticket.source_hash,
  };
  const operations = {
    readAsset: async () => complete.asset,
    finish: async () => complete,
    sign: async () => {
      signed++;
      throw new Error("Duplicate object refuses signing");
    },
  };
  assert.deepEqual(await prepareUploadProtocol(ticket, operations), complete);
  assert.equal(signed, 0);
  await assert.rejects(
    prepareUploadProtocol(ticket, {
      ...operations,
      finish: async () => {
        throw new Error("unknown transport result");
      },
    }),
    /unknown/,
  );
  assert.equal(signed, 0);
  const signedResult = await prepareUploadProtocol(ticket, {
    ...operations,
    finish: async () => {
      throw new MediaLibraryError("not uploaded", "UPLOAD_MISSING");
    },
    sign: async () => {
      signed++;
      return { id: "ticket", signedUrl: "signed" };
    },
  });
  assert.equal("signedUrl" in signedResult, true);
  assert.equal(signed, 1);
  assert.deepEqual(
    await prepareUploadProtocol(
      { ...ticket, asset_id: "asset", expires_at: "2000-01-01" },
      operations,
    ),
    complete,
  );
});
test("staging validates declared bytes, safe image decode, SVG conversion and transport descriptors", async () => {
  const bytes = await sharp({
    create: { width: 5, height: 3, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const ticket = {
    byte_size: bytes.length,
    source_hash: hash(bytes),
    mime_type: "image/png",
    name: "中文图片.png",
  };
  const result = await validateStagedImage(bytes, ticket);
  assert.equal(
    result.media.storage_path,
    `media/library/${ticket.source_hash}.png`,
  );
  assert.equal(result.media.width, 5);
  await assert.rejects(
    validateStagedImage(bytes, { ...ticket, source_hash: "f".repeat(64) }),
    /内容/,
  );
  await assert.rejects(
    validateStagedImage(bytes, { ...ticket, byte_size: bytes.length - 1 }),
    /大小/,
  );
  await assert.rejects(
    validateStagedImage(bytes, { ...ticket, mime_type: "image/jpeg" }),
    /解码/,
  );
  const bad = Buffer.from("<script>fake.png</script>");
  await assert.rejects(
    validateStagedImage(bad, {
      ...ticket,
      byte_size: bad.length,
      source_hash: hash(bad),
    }),
    /解码/,
  );
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="5" height="3"><script>evil()</script><image href="http://localhost/private"/><rect width="5" height="3" fill="red"/></svg>',
  );
  const converted = await validateStagedImage(svg, {
    ...ticket,
    byte_size: svg.length,
    source_hash: hash(svg),
    mime_type: "image/svg+xml",
  });
  assert.equal(converted.media.mime_type, "image/png");
  assert.notEqual(converted.media.sha256, hash(svg));
  const descriptor = {
    id: "00000000-0000-4000-8000-000000000099",
    name: "中文.png",
    mime: "image/png",
    size: 10485760,
    sha256: hash(bytes),
  };
  assert.equal(uploadDescriptor(descriptor).size, 10485760);
  for (const invalid of [
    { size: 10485761 },
    { size: 0 },
    { mime: "video/mp4" },
    { sha256: "bad" },
    { name: "\n" },
    { id: "not-uuid" },
  ])
    assert.throws(() => uploadDescriptor({ ...descriptor, ...invalid }));
});
test("registered images cross article boundaries, archived references remain readable, hashes and manifests remain authoritative", async () => {
  const bytes = await sharp({
    create: { width: 3, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const digest = hash(bytes),
    path = `media/library/${digest}.png`;
  const media = {
    source_path: "图.png",
    storage_path: path,
    sha256: digest,
    mime_type: "image/png",
    width: 3,
    height: 2,
  };
  const input: PublishInput = {
    client_request_id: "shared-image",
    frontmatter: {
      slug: "different-article",
      title: "复用",
      type: "blog",
      access: "public",
      cover: publicMediaUrl(path),
    },
    markdown: `![图片](<${publicMediaUrl(path)}>)`,
    media: [],
  };
  const before = contentHash(input);
  const store = {
    publicUrl: publicMediaUrl,
    download: async () => bytes,
    upload: async () => {},
    lookup: async () => [media],
  };
  const ready = await resolveMedia(input, store);
  assert.deepEqual(ready.diagnostics, []);
  assert.equal(ready.cover, publicMediaUrl(path));
  assert.equal(
    contentHash(input),
    before,
    "resolution cannot mutate input/replay hash",
  );
  assert.deepEqual(
    localReferences(input.markdown, input.frontmatter.cover),
    [],
  );
  assert.ok(
    (
      await resolveMedia(input, { ...store, lookup: async () => [] })
    ).diagnostics.some((d) => d.code === "MEDIA_MISSING"),
  );
  assert.ok(
    (
      await resolveMedia(input, {
        ...store,
        download: async () => Buffer.from("tampered"),
      })
    ).diagnostics.some((d) => d.code === "MEDIA_HASH_MISMATCH"),
  );
  const forged = {
    ...input,
    markdown: "![x](图.png)",
    media: [{ ...media, width: 9 }],
  };
  assert.ok(
    (await resolveMedia(forged, store)).diagnostics.some(
      (d) => d.code === "SCHEMA_INVALID",
    ),
  );
  const imported = await resolveMedia(
    { ...input, markdown: "![x](图.png)", media: [media] },
    store,
  );
  assert.deepEqual(imported.diagnostics, []);
  assert.ok(imported.markdown.includes(publicMediaUrl(path)));
});
test("catalog is owner-only, metadata immutable, upload reservations idempotent and usage does not expose bodies", async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db);
  const owner = "00000000-0000-4000-8000-000000000001",
    stranger = "00000000-0000-4000-8000-000000000002";
  const id = "00000000-0000-4000-8000-000000000099",
    sha = "a".repeat(64);
  await db.exec("set role service_role");
  await db.query(
    "insert into media_assets(id,storage_path,sha256,mime_type,byte_size,width,height,name) values($1,$2,$3,'image/png',100,5,3,'中文%_图')",
    [id, `media/library/${sha}.png`, sha],
  );
  const reserve = async (name = "raw.png", who = owner) =>
    db.query<{ ticket: { id: string } }>(
      "select reserve_media_upload($1,$2,$3,$4,'image/png',100) as ticket",
      [id, who, name, sha],
    );
  assert.equal((await reserve()).rows[0].ticket.id, id);
  assert.equal((await reserve()).rows[0].ticket.id, id);
  await assert.rejects(reserve("different.png"), /UPLOAD_CONFLICT/);
  await assert.rejects(reserve("raw.png", stranger), /OWNER_REQUIRED/);
  const exported = parseExportSnapshot(
    (
      await db.query<{ snapshot: unknown }>(
        "select export_site_snapshot(true,true) snapshot",
      )
    ).rows[0].snapshot,
  );
  assert.equal(exported.rows.media_assets[0].id, id);
  assert.equal(exported.rows.media_assets[0].name, "中文%_图");
  assert.equal("media_uploads" in exported.rows, false);
  await db.exec("reset role;set role anon");
  await assert.rejects(
    db.query("select * from media_assets"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select * from media_uploads"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select media_asset_usage($1)", [id]),
    /permission denied/,
  );
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: stranger }),
  ]);
  assert.equal((await db.query("select * from media_assets")).rows.length, 0);
  assert.equal(
    (await db.query("update media_assets set name='tampered' returning id"))
      .rows.length,
    0,
  );
  await assert.rejects(
    db.query("select media_asset_usage($1)", [id]),
    /OWNER_REQUIRED/,
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: owner }),
  ]);
  assert.equal((await db.query("select * from media_assets")).rows.length, 1);
  await assert.rejects(
    db.query("select * from media_uploads"),
    /permission denied/,
  );
  await assert.rejects(reserve(), /permission denied/);
  await assert.rejects(
    db.query("update media_assets set storage_path='forged'"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("delete from media_assets"),
    /permission denied/,
  );
  await db.query(
    "update media_assets set name='保留',alt='替代文字',archived=true where id=$1",
    [id],
  );
  const usage = (
    await db.query<{ u: Record<string, number> }>(
      "select media_asset_usage($1) as u",
      [id],
    )
  ).rows[0].u;
  assert.deepEqual(usage, {
    articles: 0,
    versions: 0,
    revisions: 0,
    imports: 0,
    pages: 0,
    settings: 0,
  });
  await db.exec("reset role;set role service_role");
  await db.query(
    "insert into custom_pages(slug,title,html) values('media-usage-test','素材引用',$1)",
    [`<img src="/media/library/${sha}.png">`],
  );
  await db.exec("reset role;set role authenticated");
  assert.equal(
    (
      await db.query<{ u: { pages: number } }>(
        "select media_asset_usage($1) as u",
        [id],
      )
    ).rows[0].u.pages,
    1,
  );
});
