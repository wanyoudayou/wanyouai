import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { readPublicCatalog } from "../src/lib/public-catalog-data";
import { supabaseRequestOptions } from "../src/lib/supabase/request-options";

const updated_at = "2026-09-29T00:00:00Z";
test("public catalog starts independent reads together and requests bodies only for matched public READMEs", async () => {
  let release!: () => void, seen!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { seen = resolve; });
  const paths: string[] = [], bodies: string[] = [];
  const fetchImpl = (async (input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer public-fixture");
    const url = new URL(String(input)), table = url.pathname.split("/").at(-1)!;
    paths.push(table);
    if (table === "site_config") { seen(); await gate; return Response.json({ site_name: "Fixture", owner_name: "Owner", updated_at }); }
    if (table === "series") return Response.json([
      { id: 1, readme_article_id: 11, updated_at }, { id: 2, readme_article_id: 12, updated_at },
      { id: 3, readme_article_id: 13, updated_at },
    ]);
    if (table === "articles") return Response.json([
      { id: 11, series_id: 1, access: "public", updated_at },
      { id: 12, series_id: 2, access: "paid", updated_at },
      { id: 13, series_id: 1, access: "public", updated_at },
    ]);
    if (table === "article_bodies") { bodies.push(url.searchParams.get("article_id")!); return Response.json([{ article_id: 11, content: "PUBLIC README" }]); }
    return Response.json([]);
  }) as typeof fetch;
  const client = createClient("https://fixture.example", "public-fixture", {
    ...supabaseRequestOptions({ timeoutMs: 1000, fetchImpl }),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const loading = readPublicCatalog(client);
  await started; await setImmediate();
  const firstPhase = [...paths]; release();
  const result = await loading;
  assert.deepEqual(firstPhase.sort(), ["articles", "event_details", "series", "services", "site_config", "skills"]);
  assert.deepEqual(bodies, ["in.(11)"]);
  assert.deepEqual(result.readmes, [{ article_id: 11, content: "PUBLIC README" }]);
  assert.equal(paths.includes("evaluations"), false);
});

test("public catalog fails closed on a single unavailable source", async () => {
  const client = createClient("https://fixture.example", "public-fixture", {
    ...supabaseRequestOptions({ timeoutMs: 1000, fetchImpl: (async input => {
      const table = new URL(String(input)).pathname.split("/").at(-1);
      if (table === "site_config") return Response.json({ site_name: "Fixture", updated_at });
      if (table === "articles") return Response.json({ message: "unavailable" }, { status: 503 });
      return Response.json([]);
    }) as typeof fetch }),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await assert.rejects(readPublicCatalog(client), /公开目录暂时不可用/);
});
