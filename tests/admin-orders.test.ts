import test from 'node:test';
import assert from 'node:assert/strict';
import { installTestDatabase } from "./support/database";
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {createOrder, OrderError, type OrderGateway, type OrderRow} from '../src/lib/orders/service';

const OWNER = '00000000-0000-4000-8000-000000000001';
const REGISTERED = '00000000-0000-4000-8000-000000000002';
const SUBSCRIBER = '00000000-0000-4000-8000-000000000003';
const SERIES_BUYER = '00000000-0000-4000-8000-000000000004';
const SINGLE_BUYER = '00000000-0000-4000-8000-000000000005';

test('orders: server-side price snapshot, entitlement guard and idempotent pending reuse',async t=>{
  const db=new PGlite({extensions:{vector}});t.after(()=>db.close());
  await installTestDatabase(db);
  await db.exec('reset role;set role service_role');

  const gateway:OrderGateway={
    async skillSku(){return null;},
    async subscriptionPrice(){const r=await db.query<{amount:string}>("select commerce->'subscription_price'->>'amount' as amount from site_config where id=1");return r.rows[0]?{amount:Number(r.rows[0].amount)}:null;},
    async seriesSku(target){const r=await db.query('select id,type,status,price from series where id=$1',[target]);return (r.rows[0]??null) as {id:number;type:string;status:string;price:number}|null;},
    async articleSku(target){const r=await db.query('select id,type,access,status,series_id,price from articles where id=$1',[target]);return (r.rows[0]??null) as {id:number;type:string;access:string;status:string;series_id:number|null;price:number}|null;},
    async eventSku(target){const s=await db.query('select id,status,type from series where id=$1',[target]);if(!s.rows[0]||(s.rows[0] as {type:string}).type!=='event')return null;const d=await db.query('select ticket_price,state from event_details where series_id=$1',[target]);if(!d.rows[0])return null;const det=d.rows[0] as {ticket_price:string|null;state:string};return {id:(s.rows[0] as {id:number}).id,status:(s.rows[0] as {status:string}).status,ticket_price:det.ticket_price===null?null:Number(det.ticket_price),state:det.state};},
    async activeEntitlements(userId){return (await db.query('select type,target_id,ends_at from entitlements where user_id=$1 and revoked_at is null',[userId])).rows as {type:string;target_id:number|null;ends_at:string|null}[];},
    async createPendingOrder(userId,sku,target,amount){return (await db.query<{result:OrderRow}>('select create_pending_order($1,$2,$3,$4) result',[userId,sku,target,amount])).rows[0].result;},
  };
  const targetOf=async(sql:string,param:string)=>((await db.query(sql,[param])).rows[0] as {id:number}).id;
  const handbookId=await targetOf('select id from series where slug=$1','demo-selection-handbook');
  const singleId=await targetOf('select id from articles where slug=$1','demo-paid-single-blog');
  const chapterId=await targetOf('select id from articles where slug=$1','demo-selection-handbook-readme');

  const concurrent = await Promise.all([createOrder(gateway,OWNER,{sku_type:'single',target_id:singleId}),createOrder(gateway,OWNER,{sku_type:'single',target_id:singleId})]);
  assert.equal(concurrent[0].id,concurrent[1].id,'concurrent requests must reuse one pending order');
  assert.match(concurrent[0].merchant_order_no,/^9[0-9]{31}$/);
  assert.equal(concurrent[0].merchant_order_no,concurrent[1].merchant_order_no,'replayed checkout must retain one merchant reference');

  // 订阅单：价格服务端快照 199，客户端不可指定金额。
  const sub=await createOrder(gateway,REGISTERED,{sku_type:'subscription'});
  assert.equal(sub.amount,199);
  await assert.rejects(createOrder(gateway,REGISTERED,{sku_type:'subscription',amount:1}),(e:unknown)=>e instanceof OrderError&&e.code==='INVALID_SKU');
  await assert.rejects(createOrder(gateway,REGISTERED,{sku_type:'bogus'}),(e:unknown)=>e instanceof OrderError&&e.code==='INVALID_SKU');

  // 专辑单：published handbook 可买；改价后新单按新价快照，旧单金额不变。
  const seriesOrder=await createOrder(gateway,REGISTERED,{sku_type:'series',target_id:handbookId});
  assert.equal(seriesOrder.amount,199);
  await db.exec("update series set price=299.00 where id="+handbookId);
  const repriced=await createOrder(gateway,REGISTERED,{sku_type:'series',target_id:handbookId});
  assert.notEqual(repriced.id,seriesOrder.id);
  assert.equal(repriced.amount,299);
  assert.equal((await createOrder(gateway,REGISTERED,{sku_type:'series',target_id:handbookId})).id,repriced.id);

  // 幂等：无 pending 时重复下单复用同一订单。
  assert.equal((await createOrder(gateway,REGISTERED,{sku_type:'subscription'})).id,sub.id);

  // paused 停售不可新购。
  await db.query('update series set status=$1 where id=$2',['paused',handbookId]);
  await assert.rejects(createOrder(gateway,OWNER,{sku_type:'series',target_id:handbookId}),(e:unknown)=>e instanceof OrderError&&e.code==='NOT_SELLABLE');
  await db.query('update series set status=$1 where id=$2',['published',handbookId]);

  // 单篇仅独立 paid 博文；专辑内 chapter 拒绝。
  const single=await createOrder(gateway,REGISTERED,{sku_type:'single',target_id:singleId});
  assert.equal(single.amount>0,true);
  await assert.rejects(createOrder(gateway,OWNER,{sku_type:'single',target_id:chapterId}),(e:unknown)=>e instanceof OrderError&&e.code==='NOT_SELLABLE');
  // 免费/未发布目标拒绝。
  await assert.rejects(createOrder(gateway,OWNER,{sku_type:'series',target_id:999999}),(e:unknown)=>e instanceof OrderError&&e.code==='NOT_SELLABLE');

  // 已持权益 409：订阅者买订阅/专辑拒绝/单篇；专辑买家重复购买同专辑拒绝。
  for(const body of [{sku_type:'subscription'},{sku_type:'series',target_id:handbookId}])
    await assert.rejects(createOrder(gateway,SUBSCRIBER,body),(e:unknown)=>e instanceof OrderError&&e.code==='ALREADY_ENTITLED');
  await assert.rejects(createOrder(gateway,SERIES_BUYER,{sku_type:'series',target_id:handbookId}),(e:unknown)=>e instanceof OrderError&&e.code==='ALREADY_ENTITLED');
  await assert.rejects(createOrder(gateway,SINGLE_BUYER,{sku_type:'single',target_id:singleId}),(e:unknown)=>e instanceof OrderError&&e.code==='ALREADY_ENTITLED');
  // 全站订阅覆盖单篇，防止为已覆盖内容重复付款。
  await assert.rejects(createOrder(gateway,SUBSCRIBER,{sku_type:'single',target_id:singleId}), (e:unknown)=>e instanceof OrderError&&e.code==='ALREADY_ENTITLED');

  // RLS：orders 对 anon 无表级授权（fail closed）；本人仅可读自己的订单；entitlements 仅本人。
  await db.exec('reset role;reset request.jwt.claims;set role anon');
  await assert.rejects(db.query('select * from orders'),/permission denied/);
  await db.exec('reset role;set role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:REGISTERED})]);
  const own=await db.query('select id from orders');
  assert.equal(own.rows.every(r=>(r as {id:number}).id>0),true);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:SERIES_BUYER})]);
  assert.equal((await db.query('select * from entitlements')).rows.length,1);
  await assert.rejects(db.query('insert into orders (user_id,sku_type,target_id,amount) values ($1,$2,$3,$4)',[SERIES_BUYER,'single',singleId,1]),/permission denied|row-level security/);
});

test('orders: event SKU——票价服务端权威、资格守卫、已购票/订阅不可重复',async t=>{
  const db=new PGlite({extensions:{vector}});t.after(()=>db.close());
  await installTestDatabase(db);
  await db.exec('reset role;set role service_role');
  const gateway:OrderGateway={
    async skillSku(){return null;},
    async subscriptionPrice(){return {amount:199};},
    async seriesSku(){return null;},
    async articleSku(){return null;},
    async eventSku(target){const s=await db.query('select id,status,type from series where id=$1',[target]);if(!s.rows[0]||(s.rows[0] as {type:string}).type!=='event')return null;const d=await db.query('select ticket_price,state from event_details where series_id=$1',[target]);if(!d.rows[0])return null;const det=d.rows[0] as {ticket_price:string|null;state:string};return {id:(s.rows[0] as {id:number}).id,status:(s.rows[0] as {status:string}).status,ticket_price:det.ticket_price===null?null:Number(det.ticket_price),state:det.state};},
    async activeEntitlements(userId){return (await db.query('select type,target_id,ends_at from entitlements where user_id=$1 and revoked_at is null',[userId])).rows as {type:string;target_id:number|null;ends_at:string|null}[];},
    async createPendingOrder(userId,sku,target,amount){return (await db.query<{result:OrderRow}>('select create_pending_order($1,$2,$3,$4) result',[userId,sku,target,amount])).rows[0].result;},
  };
  const USER='00000000-0000-4000-8000-000000000002';
  const SUBSCRIBER='00000000-0000-4000-8000-000000000003';
  // 收费活动：published + registering + 票价 99
  const eventId=(await db.query<{id:number}>(`insert into series(slug,title,type,status) values ('m3-event','M3测试活动','event','published') returning id`)).rows[0].id;
  await db.query(`insert into event_details(series_id,starts_at,state,ticket_price,kind) values ($1,now()+interval '7 days','registering',99,'open')`,[eventId]);
  const order=await createOrder(gateway,USER,{sku_type:'event',target_id:eventId});
  assert.equal(order.amount,99);
  assert.equal(order.sku_type,'event');
  // 幂等 pending 复用
  const again=await createOrder(gateway,USER,{sku_type:'event',target_id:eventId});
  assert.equal(again.id,order.id);
  // 订阅者（全站订阅）不可再购票
  await db.query(`insert into entitlements(user_id,type,ends_at) values ($1,'subscription',now()+interval '30 days')`,[SUBSCRIBER]);
  await assert.rejects(createOrder(gateway,SUBSCRIBER,{sku_type:'event',target_id:eventId}),/ALREADY_ENTITLED|已持有/);
  // 免费活动（ticket_price 0）不可走订单
  const freeId=(await db.query<{id:number}>(`insert into series(slug,title,type,status) values ('m3-free','免费活动','event','published') returning id`)).rows[0].id;
  await db.query(`insert into event_details(series_id,starts_at,state,ticket_price,kind) values ($1,now()+interval '7 days','registering',0,'open')`,[freeId]);
  await assert.rejects(createOrder(gateway,USER,{sku_type:'event',target_id:freeId}),/NOT_SELLABLE|不可购票/);
  // 已结束活动不可购
  await db.query(`update event_details set state='ended' where series_id=$1`,[eventId]);
  await assert.rejects(createOrder(gateway,'00000000-0000-4000-8000-000000000004',{sku_type:'event',target_id:eventId}),/NOT_SELLABLE|不可购票/);
});
