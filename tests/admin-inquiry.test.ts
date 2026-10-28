import test from 'node:test';
import assert from 'node:assert/strict';
import { installTestDatabase } from "./support/database";
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {parseInquiryInput, InquiryError} from '../src/lib/services/inquiry-input';

test('inquiry: 字段校验（slug/intent/链接/邮箱/日期）',()=>{
  const ok=parseInquiryInput({slug:'svc-a',intent:'请帮我做一次选品诊断，背景是跨境家居独立站。',budget_range:'3000-5000',deadline:'2026-10-01',context_links:['https://example.com/ctx'],contact_email:'a@b.co'});
  assert.equal(ok.slug,'svc-a');
  assert.equal(ok.contextLinks.length,1);
  assert.throws(()=>parseInquiryInput({slug:'../x',intent:'12345678901'}),InquiryError);
  assert.throws(()=>parseInquiryInput({slug:'svc-a',intent:'太短'}),/至少 10 个字/);
  assert.throws(()=>parseInquiryInput({slug:'svc-a',intent:'12345678901',context_links:['http://insecure.com']}),/HTTPS/);
  assert.throws(()=>parseInquiryInput({slug:'svc-a',intent:'12345678901',deadline:'昨天'}),/日期|时间|格式/);
  assert.throws(()=>parseInquiryInput({slug:'svc-a',intent:'12345678901',contact_email:'not-mail'}),/邮箱/);
  // 选填缺省
  const min=parseInquiryInput({slug:'svc-a',intent:'12345678901'});
  assert.equal(min.budgetRange,null);
  assert.equal(min.deadline,null);
});

test('inquiry: bookings 表权限（PGlite：service 可写 inquiry，客户端禁写）',async t=>{
  const db=new PGlite({extensions:{vector}});t.after(()=>db.close());
  await installTestDatabase(db);
  const svcId=(await db.query<{id:number}>(`select id from services limit 1`)).rows[0]?.id;
  assert.ok(svcId);
  // service 落 inquiry
  await db.exec('reset role;set role service_role');
  await db.query(`insert into bookings(service_id,email,intent,status) values ($1,'a@b.co','测试询价内容','inquiry')`,[svcId]);
  // 客户端（登录用户）不能直接写 bookings
  await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',false)`);
  await assert.rejects(db.query(`insert into bookings(service_id,email,intent) values ($1,'x@y.z','客户端直写')`,[svcId]));
  // 当事人可读自己的 inquiry（own read policy）
  await db.exec('reset role;set role service_role');
  await db.query(`update bookings set user_id='00000000-0000-4000-8000-000000000002' where email='a@b.co'`);
  await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',false)`);
  assert.equal(((await db.query('select count(*)::int c from bookings')).rows[0] as {c:number}).c,1);
  // anon：无 SELECT 授权，直接 permission denied（比 0 行更硬的拒绝）
  await db.exec('reset role;reset request.jwt.claims;set role anon');
  await assert.rejects(db.query('select count(*) from bookings'),/permission denied/);
});

test('tracking: pendingParty 待办归属推导',async()=>{
  const {pendingParty,PARTY_LABEL}=await import('../src/lib/services/tracking');
  const ms=[
    {title:'需求确认',owner_party:'client' as const,expected_at:null,actual_at:null,status:'done' as const,sort:1},
    {title:'初稿交付',owner_party:'owner' as const,expected_at:null,actual_at:null,status:'doing' as const,sort:2},
  ];
  assert.deepEqual(pendingParty('in_progress',ms),{party:PARTY_LABEL.owner,milestoneTitle:'初稿交付',clientWaiting:false,expectedAt:null});
  assert.deepEqual(pendingParty('in_progress',[]),{party:PARTY_LABEL.owner,milestoneTitle:null,clientWaiting:false,expectedAt:null});
  assert.deepEqual(pendingParty('delivered',[]),{party:PARTY_LABEL.client,milestoneTitle:null,clientWaiting:true,expectedAt:null});
  assert.equal(pendingParty('settled',[]).party,'—');
  const allDone=ms.map(m=>({...m,status:'done' as const}));
  assert.equal(pendingParty('in_progress',allDone).party,PARTY_LABEL.owner);
  // 待客户检查点：clientWaiting=true 且带预计日期（客户端醒目提示用）
  const clientMs=[{title:'提供素材',owner_party:'client' as const,expected_at:'2026-10-01',actual_at:null,status:'todo' as const,sort:1}];
  assert.deepEqual(pendingParty('in_progress',clientMs),{party:PARTY_LABEL.client,milestoneTitle:'提供素材',clientWaiting:true,expectedAt:'2026-10-01'});
});
