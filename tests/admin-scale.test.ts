import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { readAllAdminRows, readAllAdminUsers } from "../src/lib/admin/read-all";
import { deriveUserRow, deriveUserRows } from "../src/lib/admin/users-derive";
import { summarizeDashboard } from "../src/lib/admin/dashboard-metrics";

const now = new Date("2026-10-08T00:00:00Z");
const users = Array.from({ length: 1001 }, (_, i) => ({ id: `user-${i}`, email: `${i}@example.test`, created_at: now.toISOString() }));
const orders = Array.from({ length: 10000 }, (_, i) => ({ id: i + 1, user_id: users[i % users.length].id, created_at: now.toISOString(), updated_at: now.toISOString(), amount: 10, status: "paid" }));

test("admin scale: SDK pagination reads 10,000 orders despite a 137-row API cap", async () => {
  let pages = 0;
  let heads = 0;
  const client = createClient("https://example.supabase.co", "test-key", { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/rest/v1/orders");
      assert.equal(url.searchParams.get("status"), "in.(paid,fulfilled)");
      if (init?.method === "HEAD") {
        heads++;
        return new Response(null, { headers: { "content-range": `*/${orders.length}` } });
      }
      assert.equal(url.searchParams.get("order"), "id.asc");
      pages++;
      const after = Number(url.searchParams.get("id")?.replace("gt.", "") ?? 0);
      const data = orders.filter((row) => row.id > after).slice(0, Math.min(137, Number(url.searchParams.get("limit"))));
      return new Response(JSON.stringify(data), { headers: { "content-range": `0-${data.length - 1}/${orders.length}`, "content-type": "application/json" } });
    },
  } });
  const rows = await readAllAdminRows<(typeof orders)[number]>(client, "orders", "id,user_id,amount,updated_at,created_at", (q) => q.in("status", ["paid", "fulfilled"]));
  assert.equal(rows.length, 10000);
  assert.equal(rows.at(-1)?.id, 10000);
  assert.equal(pages, Math.ceil(10000 / 137));
  assert.equal(heads, 1);
  const metrics = summarizeDashboard({ paidOrders: rows, subscriptions: [], series: [], articles: [], avatarUsageThisMonth: [], avatarUsageTotal: [], avatarCache: [], now });
  assert.equal(metrics.revenueThisMonth, 100000);
});

test("admin scale: Auth SDK reaches user 1,001 and rejects a repeated page", async () => {
  let repeat = false;
  const client = createClient("https://example.supabase.co", "test-key", { auth: { persistSession: false }, global: {
    fetch: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/auth/v1/admin/users");
      const page = repeat ? 1 : Number(url.searchParams.get("page"));
      const size = Number(url.searchParams.get("per_page"));
      return new Response(JSON.stringify({ users: users.slice((page - 1) * size, page * size) }), { headers: {
        "x-total-count": String(users.length), "content-type": "application/json",
        link: '<https://example.supabase.co/auth/v1/admin/users?page=6>; rel="last"',
      } });
    },
  } });
  const rows = await readAllAdminUsers(client);
  assert.equal(rows.length, 1001);
  assert.equal(rows.at(-1)?.email, "1000@example.test");
  repeat = true;
  await assert.rejects(readAllAdminUsers(client), /读取不完整/);
});

test("admin scale: incomplete table pages fail instead of showing partial totals", async () => {
  const client = createClient("https://example.supabase.co", "test-key", { auth: { persistSession: false }, global: {
    fetch: async () => new Response("[]", { headers: { "content-range": "*/10", "content-type": "application/json" } }),
  } });
  await assert.rejects(readAllAdminRows(client, "orders", "id"), /读取不完整/);
});

test("admin scale: grouped statistics preserve each user's result and all 10,000 orders", () => {
  const rights = users.slice(0, 300).map((user) => ({ user_id: user.id, type: "subscription", ends_at: null, revoked_at: null, created_at: now.toISOString() }));
  const grouped = deriveUserRows(users, rights, orders, now);
  assert.equal(grouped.length, 1001);
  assert.equal(grouped.reduce((sum, row) => sum + row.orderCount, 0), 10000);
  assert.equal(grouped.filter((row) => row.subscriptionActive).length, 300);
  for (const index of [0, 1, 499, 1000]) {
    assert.deepEqual(grouped.find((row) => row.id === users[index].id), deriveUserRow(users[index], rights, orders, now));
  }
});
