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
});
