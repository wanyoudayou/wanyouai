import test from 'node:test';
import assert from 'node:assert/strict';
import { installTestDatabase } from "./support/database";
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';

const OWNER='00000000-0000-4000-8000-000000000001';
const READER='00000000-0000-4000-8000-000000000002';

test('inbox: 收件箱与会话审核权限（PGlite）',async t=>{
  const db=new PGlite({extensions:{vector}});t.after(()=>db.close());
  await installTestDatabase(db);

  // service 写入收件箱 + 造一条 pending 会话
  await db.exec('reset role;set role service_role');
  await db.query(`insert into inbox_items(kind,user_id,contact,payload) values ('escalation',$1,'r@example.test','{"message":"想约咨询","ip":"1.2.3.4"}')`,[READER]);
  const conv=(await db.query<{id:number}>(`insert into conversations(user_id,status) values ($1,'pending') returning id`,[READER])).rows[0].id;

  // 非 owner：收件箱不可见不可写；会话状态不可改
  await db.exec('reset role;set role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:READER,role:'authenticated'})]);
  assert.equal(((await db.query('select count(*)::int c from inbox_items')).rows[0] as {c:number}).c,0);
  await assert.rejects(db.query(`insert into inbox_items(kind,payload) values ('escalation','{}')`));
  await db.query(`update conversations set status='public' where id=$1`,[conv]); // RLS 静默过滤 0 行，非报错
  assert.equal(((await db.query('select status from conversations where id=$1',[conv])).rows[0] as {status:string}).status,'pending');

  // owner：可见、可标记处理、可审核会话（仅 status 列）
  await db.exec('reset role;set role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:OWNER,role:'authenticated'})]);
  assert.equal(((await db.query('select count(*)::int c from inbox_items')).rows[0] as {c:number}).c,1);
  await db.query(`update inbox_items set status='done' where id=1`);
  await db.query(`update conversations set status='public' where id=$1`,[conv]);
  assert.equal(((await db.query('select status from conversations where id=$1',[conv])).rows[0] as {status:string}).status,'public');
  // 审核即定稿：owner 也不可改会话内容列（列级授权仅 status）
  await assert.rejects(db.query(`update conversations set summary_md='x' where id=$1`,[conv]));

  // 站主必须另写公开稿；原始记录与身份始终私有。
  await assert.rejects(db.query(`select review_conversation($1,'public','公开问题','公开答复',false)`,[conv]), /PUBLIC_COPY_CONFIRMATION_REQUIRED/);
  await assert.rejects(db.query(`select review_conversation($1,'public','','',true)`,[conv]), /check constraint/);
  await db.query(`select review_conversation($1,'public','公开问题','公开答复',true)`,[conv]);
  await db.exec('reset role;reset request.jwt.claims;set role anon');
  assert.equal(((await db.query('select count(*)::int c from conversations')).rows[0] as {c:number}).c,0);
  assert.equal(((await db.query('select answer_md from conversation_publications')).rows[0] as {answer_md:string}).answer_md,'公开答复');
  await assert.rejects(db.query(`select review_conversation($1,'hidden','','',false)`,[conv]), /permission denied/);
  await db.exec('reset role;set role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:READER})]);
  await assert.rejects(db.query(`select review_conversation($1,'hidden','','',false)`,[conv]), /OWNER_REQUIRED/);
  await assert.rejects(db.query(`insert into conversation_publications(conversation_id,question_md,answer_md) values($1,'x','x')`,[conv]), /row-level security/);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:OWNER})]);
  await db.query(`select review_conversation($1,'hidden','','',false)`,[conv]);
  await db.exec('reset role;reset request.jwt.claims;set role anon');
  assert.equal(((await db.query('select count(*)::int c from conversations')).rows[0] as {c:number}).c,0);
  assert.equal(((await db.query('select count(*)::int c from conversation_publications')).rows[0] as {c:number}).c,0);
});
