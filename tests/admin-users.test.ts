import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveUserRow, buildSubscriberCsv} from '../src/lib/admin/users-derive';
import type {EntitlementLike, OrderLike} from '../src/lib/admin/users-derive';

const NOW=new Date('2026-09-17T00:00:00Z');
const user={id:'u1',email:'a@example.test',created_at:'2026-01-01T00:00:00Z'};
const ent=(over:Partial<EntitlementLike>):EntitlementLike=>({user_id:'u1',type:'subscription',ends_at:null,revoked_at:null,created_at:'2026-02-01T00:00:00Z',...over});
const ord=(over:Partial<OrderLike>):OrderLike=>({user_id:'u1',created_at:'2026-03-01T00:00:00Z',...over});

test('users: 订阅状态推导（有效 / 已过期 / 已回收 / 无）',()=>{
  assert.equal(deriveUserRow(user,[ent({ends_at:'2026-10-01T00:00:00Z'})],[],NOW).subscriptionEndsAt,'2026-10-01T00:00:00Z');
  assert.equal(deriveUserRow(user,[ent({ends_at:null})],[],NOW).subscriptionActive,true);
  assert.equal(deriveUserRow(user,[ent({ends_at:null})],[],NOW).subscriptionEndsAt,null);
  assert.equal(deriveUserRow(user,[ent({ends_at:'2026-09-01T00:00:00Z'})],[],NOW).subscriptionEndsAt,null);
  assert.equal(deriveUserRow(user,[ent({ends_at:'2026-10-01T00:00:00Z',revoked_at:'2026-08-01T00:00:00Z'})],[],NOW).subscriptionEndsAt,null);
  assert.equal(deriveUserRow(user,[],[],NOW).subscriptionEndsAt,null);
  // 多个有效订阅取最晚到期
  assert.equal(deriveUserRow(user,[ent({ends_at:'2027-01-01T00:00:00Z'}),ent({ends_at:'2026-12-01T00:00:00Z'})],[],NOW).subscriptionEndsAt,'2027-01-01T00:00:00Z');
  // 他人权益不混入
  assert.equal(deriveUserRow(user,[ent({user_id:'u2',ends_at:'2027-01-01T00:00:00Z'})],[],NOW).subscriptionEndsAt,null);
});

test('users: 最近活跃 = 注册 / 权益 / 订单的最大值；订单数只计本人',()=>{
  const row=deriveUserRow(user,[ent({created_at:'2026-02-01T00:00:00Z'})],[ord({created_at:'2026-05-01T00:00:00Z'}),ord({created_at:'2026-04-01T00:00:00Z'}),ord({user_id:'u2',created_at:'2026-06-01T00:00:00Z'})],NOW);
  assert.equal(row.lastActiveAt,'2026-05-01T00:00:00Z');
  assert.equal(row.orderCount,2);
  assert.equal(deriveUserRow(user,[],[],NOW).lastActiveAt,user.created_at);
});

test('users: 订阅者 CSV 只含有效订阅者且正确转义',()=>{
  const csv=buildSubscriberCsv([
    {...deriveUserRow(user,[ent({ends_at:'2026-10-01T00:00:00Z'})],[],NOW)},
    {...deriveUserRow({id:'u2',email:'b@example.test',created_at:user.created_at},[],[],NOW)},
    {...deriveUserRow({id:'u3',email:'we"ird@example.test',created_at:user.created_at},[ent({user_id:'u3',ends_at:null,created_at:user.created_at})],[],NOW)},
  ]);
  const lines=csv.trim().split('\n');
  assert.equal(lines[0],'email,subscription_ends_at');
  assert.equal(lines.length,3);
  assert.ok(lines[1].startsWith('a@example.test,2026-10-01'));
  assert.ok(!csv.includes('b@example.test'));
  assert.ok(csv.includes('"we""ird@example.test"'));
});
