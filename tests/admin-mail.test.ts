import test from 'node:test';
import assert from 'node:assert/strict';
import { installTestDatabase } from "./support/database";
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {mailerFromEnv, renderMailHtml} from '../src/lib/mailer';
import {isInReminderWindow} from '../src/lib/expiry-window';

const OWNER='00000000-0000-4000-8000-000000000001';

test('mail: email_sends 幂等去重 + owner 只读 + 客户端禁写',async t=>{
  const db=new PGlite({extensions:{vector}});t.after(()=>db.close());
  await installTestDatabase(db);

  // service_role 写入 + unique(kind, ref_id) 幂等
  await db.exec('reset role;set role service_role');
  await db.query(`insert into email_sends (kind,ref_id,sent_to) values ('expiry_reminder','42','a@example.test')`);
  await assert.rejects(
    db.query(`insert into email_sends (kind,ref_id,sent_to) values ('expiry_reminder','42','b@example.test')`),
    /duplicate key/);
  await db.query(`insert into email_sends (kind,ref_id,sent_to) values ('archive_notice','series:1','c@example.test')`);

  // owner 可读（审计），非 owner authenticated 0 行
  await db.exec('reset role;set role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:OWNER,role:'authenticated'})]);
  assert.equal(((await db.query('select count(*)::int count from email_sends')).rows[0] as {count:number}).count,2);
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:'00000000-0000-4000-8000-000000000002',role:'authenticated'})]);
  assert.equal(((await db.query('select count(*)::int count from email_sends')).rows[0] as {count:number}).count,0);
  await assert.rejects(
    db.query(`insert into email_sends (kind,ref_id,sent_to) values ('expiry_reminder','99','x@example.test')`));

  // anon 完全不可见
  await db.exec('reset role;reset request.jwt.claims;set role anon');
  await assert.rejects(db.query('select count(*) from email_sends'));
});

test('mail: mailerFromEnv 门控与发送载荷',async()=>{
  const savedKey=process.env.RESEND_API_KEY,savedFrom=process.env.EMAIL_FROM;
  try{
    delete process.env.RESEND_API_KEY;delete process.env.EMAIL_FROM;
    assert.equal(mailerFromEnv(),null);
    process.env.RESEND_API_KEY='re_test';delete process.env.EMAIL_FROM;
    assert.equal(mailerFromEnv(),null);
    process.env.EMAIL_FROM='站点 <no-reply@example.com>';
    const calls:{url:string;init:RequestInit}[]=[];
    const stub=async(url:unknown,init?:unknown)=>{calls.push({url:String(url),init:init as RequestInit});return new Response('{}',{status:200});};
    const mailer=mailerFromEnv(stub as typeof fetch);
    assert.ok(mailer);
    await mailer!.send({to:'u@example.test',subject:'主题',html:'<p>正文</p>',text:'正文'});
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://api.resend.com/emails');
    const headers=calls[0].init.headers as Record<string,string>;
    assert.equal(headers.authorization,'Bearer re_test');
    const body=JSON.parse(String(calls[0].init.body)) as {from:string;to:string[];subject:string};
    assert.equal(body.from,'站点 <no-reply@example.com>');
    assert.deepEqual(body.to,['u@example.test']);
    const failStub=async()=>new Response('bad',{status:422});
    await assert.rejects(mailerFromEnv(failStub as typeof fetch)!.send({to:'u@example.test',subject:'s',html:'h',text:'t'}),/HTTP 422/);
  }finally{
    if(savedKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=savedKey;
    if(savedFrom===undefined)delete process.env.EMAIL_FROM;else process.env.EMAIL_FROM=savedFrom;
  }
});

test('mail: 模板单一布局含站名/摘要/回站链接且转义',()=>{
  const html=renderMailHtml({siteName:'<b>站</b>',title:'权益已开通',bodyHtml:'<p>你好</p>',summary:'权益摘要：专辑 · 永久有效',ctaUrl:'https://example.com/me',ctaLabel:'查看我的权益'});
  assert.ok(html.includes('&lt;b&gt;站&lt;/b&gt;'));
  assert.ok(html.includes('权益摘要：专辑 · 永久有效'));
  assert.ok(html.includes('https://example.com/me'));
  assert.ok(html.includes('<p>你好</p>'));
});

test('mail: 到期提醒窗口 (now+6d, now+7d]',()=>{
  const now=new Date('2026-09-17T00:00:00Z');
  const at=(days:number)=>new Date(now.getTime()+days*86_400_000).toISOString();
  assert.equal(isInReminderWindow(at(6.5),now),true);
  assert.equal(isInReminderWindow(at(7),now),true);
  assert.equal(isInReminderWindow(at(6),now),false);
  assert.equal(isInReminderWindow(at(7.1),now),false);
  assert.equal(isInReminderWindow(at(-1),now),false);
  assert.equal(isInReminderWindow('not-a-date',now),false);
});
