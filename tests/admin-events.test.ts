import { installTestDatabase } from "./support/database";
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkEligibility} from '../src/lib/events/eligibility';
import type {Reader} from '../src/types/reading';

const UID='00000000-0000-4000-8000-000000000002';
const reader=(ents:Reader['entitlements']=[],userId:string|null=UID):Reader=>({userId,owner:false,entitlements:ents});
const sub=(uid:string)=>({user_id:uid,type:'subscription' as const,target_id:null,ends_at:'2027-01-01T00:00:00Z',revoked_at:null});
const ticket=(uid:string,event:number)=>({user_id:uid,type:'event' as const,target_id:event,ends_at:null,revoked_at:null});
const ev=(over:Partial<Parameters<typeof checkEligibility>[1]>={})=>({id:7,status:'published',kind:'open',ticket_price:null,state:'registering',...over});

test('events: 资格判定矩阵',()=>{
  // 免费开放：任何人（含匿名语义外——登录在 API 层强制）
  assert.deepEqual(checkEligibility(reader(),ev()),{action:'register',reason:'open'});
  // 开放收费：未购票 → 购票；已购票 → 报名
  assert.deepEqual(checkEligibility(reader(),ev({ticket_price:99})),{action:'buy_ticket',price:99});
  assert.deepEqual(checkEligibility(reader([ticket(UID,7)]),ev({ticket_price:99})),{action:'register',reason:'ticket'});
  // 会员专享：订阅者免费报名；非订阅者看票价；无价会员活动需订阅
  assert.deepEqual(checkEligibility(reader([sub(UID)]),ev({kind:'member',ticket_price:99})),{action:'register',reason:'subscriber'});
  assert.deepEqual(checkEligibility(reader(),ev({kind:'member',ticket_price:99})),{action:'buy_ticket',price:99});
  assert.deepEqual(checkEligibility(reader(),ev({kind:'member'})),{action:'subscription_required'});
  // 已购票会员活动 → 报名（无需订阅）
  assert.deepEqual(checkEligibility(reader([ticket(UID,7)]),ev({kind:'member',ticket_price:99})),{action:'register',reason:'ticket'});
  // 关闭态
  assert.equal(checkEligibility(reader(),ev({state:'upcoming'})).action,'closed');
  assert.equal(checkEligibility(reader(),ev({state:'ended'})).action,'closed');
  assert.equal(checkEligibility(reader(),ev({status:'draft'})).action,'closed');
  // 暂停停售不停读：持票人仍可报名；未持票者关闭；结束后持票人也关闭
  assert.deepEqual(checkEligibility(reader([ticket(UID,7)]),ev({status:'paused',ticket_price:99})),{action:'register',reason:'ticket'});
  assert.equal(checkEligibility(reader(),ev({status:'paused'})).action,'closed');
  assert.equal(checkEligibility(reader([ticket(UID,7)]),ev({status:'archived',ticket_price:99})).action,'closed');
  assert.equal(checkEligibility(reader([ticket(UID,7)]),ev({state:'ended',ticket_price:99})).action,'closed');
  // 过期订阅无效
  const expired=[{user_id:UID,type:'subscription' as const,target_id:null,ends_at:'2020-01-01T00:00:00Z',revoked_at:null}];
  assert.deepEqual(checkEligibility(reader(expired),ev({kind:'member'})),{action:'subscription_required'});
});

test('events: 核销发票与首登补发（PGlite）',async t=>{
  const {PGlite}=await import('@electric-sql/pglite');
  const {vector}=await import('@electric-sql/pglite-pgvector');
  const db=new PGlite({extensions:{vector}});t.after(()=>db.close());
  await installTestDatabase(db);
  const OWNER='00000000-0000-4000-8000-000000000001',READER='00000000-0000-4000-8000-000000000002';
  const login=async(id:string)=>{await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated'})]);};
  const checkin=async(token:string)=>(await db.query<{result:{ok:boolean;message:string;granted?:boolean}}>('select checkin_registration($1) result',[token])).rows[0].result;

  // 免费活动 + 有账户报名者
  await db.exec('reset role;set role service_role');
  const s1=(await db.query<{id:number}>(`insert into series(slug,title,type,status) values ('ev-free','免费活动','event','published') returning id`)).rows[0].id;
  await db.query(`insert into event_details(series_id,starts_at,state,ticket_price,kind) values ($1,now()+interval '7 days','registering',0,'open')`,[s1]);
  const token=(await db.query<{checkin_token:string}>(`insert into registrations(series_id,user_id,email) values ($1,$2,'r@example.test') returning checkin_token`,[s1,READER])).rows[0].checkin_token;
  // 非 owner 核销被拒
  await login(READER);
  assert.equal((await checkin(token)).ok,false);
  // owner 核销：attended + 发票
  await login(OWNER);
  const r1=await checkin(token);
  assert.equal(r1.ok,true);
  assert.equal(r1.granted,true);
  assert.equal(((await db.query('select count(*)::int c from entitlements where user_id=$1 and type=$2 and target_id=$3',[READER,'event',s1])).rows[0] as {c:number}).c,1);
  // 重复核销幂等
  const r2=await checkin(token);
  assert.equal(r2.ok,true);
  assert.equal(r2.granted,false);
  assert.equal(((await db.query('select count(*)::int c from entitlements where user_id=$1 and type=$2',[READER,'event'])).rows[0] as {c:number}).c,1);

  // 付费活动核销：不重复发票（订单已发）
  await db.exec('reset role;set role service_role');
  const s2=(await db.query<{id:number}>(`insert into series(slug,title,type,status) values ('ev-paid','付费活动','event','published') returning id`)).rows[0].id;
  await db.query(`insert into event_details(series_id,starts_at,state,ticket_price,kind) values ($1,now()+interval '7 days','registering',99,'open')`,[s2]);
  const token2=(await db.query<{checkin_token:string}>(`insert into registrations(series_id,user_id,email) values ($1,$2,'r@example.test') returning checkin_token`,[s2,READER])).rows[0].checkin_token;
  await login(OWNER);
  const r3=await checkin(token2);
  assert.equal(r3.ok,true);
  assert.equal(r3.granted,false);
  assert.equal(((await db.query('select count(*)::int c from entitlements where user_id=$1 and type=$2 and target_id=$3',[READER,'event',s2])).rows[0] as {c:number}).c,0);

  // 无效 token（owner 身份）
  assert.equal((await checkin('00000000-0000-0000-0000-000000000000')).ok,false);

  // 纯邮箱报名者：到场核销（无票）→ 首登绑定并补发
  await db.exec('reset role;set role service_role');
  const s3=(await db.query<{id:number}>(`insert into series(slug,title,type,status) values ('ev-guest','嘉宾活动','event','published') returning id`)).rows[0].id;
  await db.query(`insert into event_details(series_id,starts_at,state,ticket_price,kind) values ($1,now()+interval '7 days','registering',0,'open')`,[s3]);
  await db.query(`insert into registrations(series_id,email,status) values ($1,'guest@example.test','registered')`,[s3]);
  const guestToken=(await db.query<{checkin_token:string}>(`select checkin_token from registrations where email='guest@example.test'`)).rows[0].checkin_token;
  await login(OWNER);
  const r4=await checkin(guestToken);
  assert.equal(r4.ok,true);
  assert.equal(r4.granted,false); // 无账户不发
  // 首登触发补发
  await db.exec('reset role');
  const newUser='00000000-0000-4000-9000-000000000099';
  await db.query(`insert into auth.users(id,email) values ($1,'guest@example.test')`,[newUser]);
  assert.equal(((await db.query(`select user_id from registrations where email='guest@example.test'`)).rows[0] as {user_id:string}).user_id,newUser);
  assert.equal(((await db.query('select count(*)::int c from entitlements where user_id=$1 and type=$2 and source=$3',[newUser,'event','checkin'])).rows[0] as {c:number}).c,1);
});

test('dashboard: 看板指标汇总口径（纯函数）',async()=>{
  const {summarizeDashboard,hitRate,monthStartIso}=await import('../src/lib/admin/dashboard-metrics');
  const now=new Date('2026-09-22T10:00:00Z');
  const m=summarizeDashboard({
    paidOrders:[
      {amount:199,updated_at:'2026-09-01T00:00:00Z'},
      {amount:12.34,updated_at:'2026-09-21T00:00:00Z'},
      {amount:999,updated_at:'2026-08-31T23:59:59Z'}, // 上月不计
    ],
    subscriptions:[
      {ends_at:'2027-01-01T00:00:00Z',revoked_at:null},
      {ends_at:null,revoked_at:null},
      {ends_at:'2020-01-01T00:00:00Z',revoked_at:null}, // 过期
      {ends_at:'2027-01-01T00:00:00Z',revoked_at:'2026-01-01T00:00:00Z'}, // 回收
    ],
    series:[{status:'published'},{status:'paused'},{status:'published'}],
    articles:[{status:'published'},{status:'draft'},{status:'published'},{status:'archived'}],
    avatarUsageThisMonth:[{id:1},{id:2}],
    avatarUsageTotal:[{id:1},{id:2},{id:3}],
    avatarCache:[{hit_count:5},{hit_count:4}],
    now,
  });
  assert.equal(monthStartIso(now),'2026-09-01T00:00:00.000Z');
  assert.equal(m.revenueThisMonth,211.34);
  assert.equal(m.activeSubscriptions,2);
  assert.equal(m.seriesPublished,2);
  assert.equal(m.articlesPublished,2);
  assert.equal(m.avatarGenerationsThisMonth,2);
  assert.equal(m.avatarGenerationsTotal,3);
  assert.equal(m.avatarCacheHitsTotal,9);
  assert.equal(hitRate(m),0.75);
  assert.equal(hitRate({avatarCacheHitsTotal:0,avatarGenerationsTotal:0}),null);
});

test('roster csv: 报名名单导出（M3-S6）',async()=>{
  const {buildRosterCsv}=await import('../src/lib/admin/roster-csv');
  const csv=buildRosterCsv([
    {email:'a@example.com',status:'registered',created_at:'2026-09-20T08:00:00.000Z'},
    {email:'b, "x"@example.com',status:'attended',created_at:'2026-09-21T09:30:00.000Z'},
    {email:'c@example.com',status:'cancelled',created_at:'2026-09-22T10:00:00.000Z'},
  ]);
  const lines=csv.trimEnd().split('\n');
  assert.equal(lines[0],'email,status,registered_at');
  assert.equal(lines[1],'a@example.com,已报名,2026-09-20T08:00:00.000Z');
  assert.equal(lines[2],'"b, ""x""@example.com",已到场,2026-09-21T09:30:00.000Z');
  assert.equal(lines[3],'c@example.com,已取消,2026-09-22T10:00:00.000Z');
  // 未知状态原样输出；空名单只有表头
  assert.ok(buildRosterCsv([{email:'d@example.com',status:'mystery',created_at:'t'}]).includes('mystery'));
  assert.equal(buildRosterCsv([]),'email,status,registered_at\n');
  // 公式注入：= + - @ 开头的文本加 ' 前缀；回车也加引号；纯数字保持原样
  const {csvCell}=await import('../src/lib/admin/csv');
  assert.equal(buildRosterCsv([{email:'=HYPERLINK("http://x")@a.test',status:'registered',created_at:'t'}]).split('\n')[1],`"'=HYPERLINK(""http://x"")@a.test",已报名,t`);
  for(const v of ['+1','-cmd','@SUM(A1)','\tx']) assert.ok(csvCell(v).replace(/^"/,'').startsWith("'"),v);
  assert.equal(csvCell('-5'),'-5');
  assert.equal(csvCell('12.50'),'12.50');
  assert.equal(csvCell('a\rb'),'"a\rb"');
  assert.equal(csvCell(null),'');
});

test('events: register_for_event 在活动行锁内裁决资格与名额（PGlite）',async t=>{
  const {PGlite}=await import('@electric-sql/pglite');
  const {vector}=await import('@electric-sql/pglite-pgvector');
  const db=new PGlite({extensions:{vector}});t.after(()=>db.close());
  await installTestDatabase(db);
  const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b2',C='00000000-0000-4000-8000-0000000000c3';
  await db.exec('reset role');
  for(const [id,mail] of [[A,'a@example.test'],[B,'b@example.test'],[C,'c@example.test']]) await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,mail]);
  const login=async(id:string|null)=>{await db.exec('reset role;reset request.jwt.claims;set role '+(id?'authenticated':'anon'));if(id)await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated'})]);};
  const register=async(series:number)=>(await db.query<{r:{ok:boolean;code?:string;status?:string;checkin_token?:string}}>('select register_for_event($1) r',[series])).rows[0].r;
  const order=async(user:string,series:number,amount:number)=>db.query('select create_pending_order($1,$2,$3,$4) o',[user,'event',series,amount]);

  // 免费开放活动，名额 1：第一位成功，第二位满员，重复报名复用原记录
  await db.exec('reset role');
  const free=(await db.query<{id:number}>(`insert into series(slug,title,type,status) values ('ev-cap','名额活动','event','published') returning id`)).rows[0].id;
  await db.query(`insert into event_details(series_id,starts_at,state,ticket_price,kind,capacity) values ($1,now()+interval '7 days','registering',0,'open','1 人')`,[free]);
  await login(null);
  await assert.rejects(register(free),/permission denied/);
  await login(A);
  const first=await register(free);
  assert.equal(first.ok,true);
  assert.equal((await register(free)).checkin_token,first.checkin_token);
  await login(B);
  assert.equal((await register(free)).code,'FULL');

  // 收费活动，名额 1：A 持票后售罄，B 不能再买；暂停后 A 仍能报名，C 关闭
  await db.exec('reset role');
  const paid=(await db.query<{id:number}>(`insert into series(slug,title,type,status) values ('ev-ticket','收费活动','event','published') returning id`)).rows[0].id;
  await db.query(`insert into event_details(series_id,starts_at,state,ticket_price,kind,capacity) values ($1,now()+interval '7 days','registering',99,'open','1')`,[paid]);
  await db.exec('set role service_role');
  await order(A,paid,99);
  await db.exec('reset role');
  await db.query(`insert into entitlements(user_id,type,target_id,source,source_ref) values ($1,'event',$2,'admin','test-ticket')`,[A,paid]);
  await db.exec('set role service_role');
  await assert.rejects(order(B,paid,99),/NOT_SELLABLE/);
  await db.exec('reset role');
  await db.query(`update series set status='paused',paused_at=now() where id=$1`,[paid]);
  await login(A);
  const ticketRegistration=await register(paid);
  assert.equal(ticketRegistration.ok,true);
  await login(C);
  assert.equal((await register(paid)).code,'CLOSED');

  // 结束后持票人也不能再报名；匿名/普通角色不能直接写名单
  await db.exec('reset role');
  await db.query(`update event_details set state='ended' where series_id=$1`,[free]);
  await login(B);
  assert.equal((await register(free)).code,'CLOSED');
  await assert.rejects(db.query(`insert into registrations(series_id,user_id,email) values ($1,$2,'b@example.test')`,[free,B]),/permission denied/);
});
