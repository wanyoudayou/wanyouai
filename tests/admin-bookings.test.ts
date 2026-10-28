import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";

const OWNER = "00000000-0000-4000-8000-000000000001";
const CLIENT = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000004";
const AGREEMENT = { party_owner: "站主", party_client: "客户", scope: "诊断", deliverable: "报告", cadence: "5 天", compensation: "5000", exit: "提前 3 天", ownership: "客户" };
type Result = { ok: boolean; message: string };

test("bookings: final SQL flow, customer-only acceptance, direct-write denial and immutable history", async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db);
  await db.exec("set role service_role");
  const service = (await db.query<{ id: number }>("select id from services order by id limit 1")).rows[0].id;
  const booking = (await db.query<{ id: number }>("insert into bookings(service_id,user_id,email,intent,status) values ($1,$2,'client@example.test','测试需求','inquiry') returning id", [service, CLIENT])).rows[0].id;
  const login = async (id: string) => {
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: "authenticated" })]);
  };
  const stamp = async () => (await db.query<{ value: string }>("select updated_at::text value from bookings where id=$1", [booking])).rows[0].value;
  const ownerAction = async (action: string, value: unknown = {}) => (await db.query<{ result: Result }>("select manage_booking($1,$2,$3,$4::jsonb) result", [booking, await stamp(), action, JSON.stringify(value)])).rows[0].result;
  const clientAction = async (action: string, value: unknown = {}) => (await db.query<{ result: Result }>("select client_respond_booking($1,$2,$3::jsonb) result", [booking, action, JSON.stringify(value)])).rows[0].result;
  const status = async () => (await db.query<{ status: string }>("select status from bookings where id=$1", [booking])).rows[0].status;

  await login(CLIENT);
  assert.equal((await ownerAction("quote", { plan: "完整的服务方案说明", delivery_date: "2026-10-01" })).ok, false);
  await login(OWNER);
  assert.equal((await ownerAction("status", { status: "quoted" })).ok, false);
  assert.equal((await ownerAction("quote", { plan: "完整的服务方案说明与交付范围", delivery_date: "2026-10-01", price: 5000 })).ok, true);
  assert.equal((await clientAction("accept_quote")).ok, false); // owner cannot impersonate customer
  await login(CLIENT);
  assert.equal((await clientAction("accept_quote")).ok, true);
  assert.equal((await clientAction("accept_quote")).ok, false); // replay cannot change state again

  await login(OWNER);
  assert.equal((await ownerAction("book", { agreement: { ...AGREEMENT, scope: "" }, agreed_at: "2026-09-28" })).ok, false);
  assert.equal((await ownerAction("book", {
    agreement: AGREEMENT, agreed_at: "2026-09-28",
    milestones: [{ title: "需求确认", owner_party: "client", sort: 1 }, { title: "初稿交付", owner_party: "owner", sort: 2 }],
  })).ok, true);
  const milestones = (await db.query<{ id: number }>("select id from milestones where booking_id=$1 order by sort", [booking])).rows;
  assert.equal(milestones.length, 2);
  const node = milestones[0].id;
  assert.equal((await ownerAction("status", { status: "in_progress" })).ok, false);
  assert.equal((await ownerAction("milestone_start", { id: node, expected_at: "2026-10-01" })).ok, false);
  assert.equal((await ownerAction("send_agreement")).ok, true);
  assert.equal((await ownerAction("book", { agreement: AGREEMENT, agreed_at: "2026-09-29" })).ok, false);
  await login(OTHER);
  assert.equal((await clientAction("accept_agreement")).ok, false);
  await login(CLIENT);
  assert.equal((await clientAction("accept_agreement")).ok, true);
  await login(OWNER);
  assert.equal((await ownerAction("status", { status: "in_progress" })).ok, true);

  // State and acceptance authority cannot be bypassed through direct Data API writes.
  await assert.rejects(db.query("update bookings set status='accepted' where id=$1", [booking]), /permission denied/);
  await assert.rejects(db.query("update milestones set accepted_at=now() where id=$1", [node]), /permission denied/);
  await assert.rejects(db.query("delete from milestones where id=$1", [node]), /permission denied/);
  assert.equal((await ownerAction("milestone_start", { id: node, expected_at: "2026-10-01" })).ok, true);
  assert.equal((await ownerAction("milestone_start", { id: node, expected_at: "2026-10-01" })).ok, false);
  assert.equal((await ownerAction("milestone_request", { id: node, note: "请反馈当前需求与补充资料" })).ok, true);
  await login(CLIENT);
  assert.equal((await clientAction("respond_milestone", { milestone_id: node, note: "已补充需求资料" })).ok, true);
  await login(OWNER);
  assert.equal((await ownerAction("milestone_deliver", { id: node, note: "首稿已交付，请检查需求说明" })).ok, true);
  await login(CLIENT);
  assert.equal((await clientAction("object_milestone", { milestone_id: node, note: "请补充需求边界与例外条件" })).ok, true);
  await login(OWNER);
  assert.equal((await ownerAction("milestone_deliver", { id: node, note: "已补充需求边界并重新交付" })).ok, true);
  await login(CLIENT);
  assert.equal((await clientAction("accept_milestone", { milestone_id: node })).ok, true);
  assert.equal((await clientAction("accept_milestone", { milestone_id: node })).ok, false);
  const events = (await db.query<{ events: { type: string }[] }>("select events from milestones where id=$1", [node])).rows[0].events;
  assert.deepEqual(events.map((event) => event.type), ["request", "response", "deliver", "objection", "deliver", "accept"]);

  await login(OWNER);
  assert.equal((await ownerAction("status", { status: "delivered" })).ok, false);
  assert.equal((await ownerAction("deliver", { note: "交付报告与全部附件已准备完毕" })).ok, true);
  assert.equal((await ownerAction("status", { status: "accepted" })).ok, false);
  await login(OTHER);
  assert.equal((await clientAction("accept_delivery")).ok, false);
  await login(CLIENT);
  assert.equal((await clientAction("request_revision", { note: "短" })).ok, false);
  assert.equal((await clientAction("request_revision", { note: "请补充报告中的分析依据" })).ok, true);
  assert.equal(await status(), "in_progress");
  await login(OWNER);
  assert.equal((await ownerAction("deliver", { note: "分析依据已补充，请复核终稿" })).ok, true);
  await login(CLIENT);
  assert.equal((await clientAction("accept_delivery")).ok, true);
  assert.equal((await clientAction("accept_delivery")).ok, false);
  await login(OWNER);
  assert.equal((await ownerAction("status", { status: "settled" })).ok, true);
  assert.equal((await ownerAction("milestone_add", { title: "结案后篡改" })).ok, false);
  assert.equal((await ownerAction("milestone_update", { id: node, actual_at: "2027-01-01" })).ok, false);
  const stale = (await db.query<{ result: Result }>("select manage_booking($1,$2,$3,$4::jsonb) result", [booking, "2020-01-01T00:00:00Z", "status", JSON.stringify({ status: "in_progress" })])).rows[0].result;
  assert.equal(stale.ok, false);
  const snapshot = (await db.query<{ agreement_snapshot: typeof AGREEMENT }>("select agreement_snapshot from bookings where id=$1", [booking])).rows[0].agreement_snapshot;
  assert.deepEqual(snapshot, AGREEMENT);
  await login(CLIENT);
  assert.equal((await clientAction("respond_milestone", { milestone_id: node, note: "结案后修改" })).ok, false);
  assert.equal((await db.query("select * from bookings where id=$1", [booking])).rows.length, 1);
  assert.equal((await db.query("select * from milestones where booking_id=$1", [booking])).rows.length, 2);
  await assert.rejects(db.query("update bookings set status='in_progress' where id=$1", [booking]), /permission denied/);
  await login(OTHER);
  assert.equal((await db.query("select * from bookings where id=$1", [booking])).rows.length, 0);
  assert.equal((await db.query("select * from milestones where booking_id=$1", [booking])).rows.length, 0);
});
