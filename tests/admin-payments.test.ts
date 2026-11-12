import test from 'node:test';
import assert from 'node:assert/strict';
import { installTestDatabase } from "./support/database";
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {epaySign, zpayConfigFromEnv, zpayProvider} from '../src/lib/payments/zpay';
import type {PaymentOrder} from '../src/lib/payments/types';

const REGISTERED='00000000-0000-4000-8000-000000000002';

test('payments: settle inbox is idempotent, amount-checked and grants exactly once',async t=>{
  const db=new PGlite({extensions:{vector}});t.after(()=>db.close());
  await installTestDatabase(db);
  await db.exec('reset role;set role service_role');
  const settle=async(orderId:number,eventId:string,amount:number,payload={})=>(await db.query<{result:string}>(`select settle_payment($1,$2,$3,$4::jsonb || (select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1)) as result`,[orderId,eventId,amount,JSON.stringify(payload)])).rows[0].result;
  const newOrder=async(userId:string,sku:string,target:number|null,amount:number)=>(await db.query<{id:number}>(`insert into orders (user_id,sku_type,target_id,amount) values ($1,$2,$3,$4) returning id`,[userId,sku,target,amount])).rows[0].id;

  // 订阅单成交：paid + 1 年权益；重复 event_id 幂等跳过；金额不符拒绝且不留痕。
  const subOrder=await newOrder(REGISTERED,'subscription',null,199);
  assert.equal(await settle(subOrder,'trade-sub-1',199),'settled');
  const ent=(await db.query(`select * from entitlements where user_id=$1 and type='subscription'`,[REGISTERED])).rows[0] as {ends_at:string|null};
  assert.ok(ent&&ent.ends_at);
  assert.ok(Date.parse(ent.ends_at)>Date.now()+300*24*3600e3);
  assert.equal(await settle(subOrder,'trade-sub-1',199),'duplicate');
  assert.equal(((await db.query(`select count(*)::int count from entitlements where user_id=$1`,[REGISTERED])).rows[0] as {count:number}).count,1);
  assert.equal(((await db.query(`select count(*)::int count from payment_events`)).rows[0] as {count:number}).count,1);
  const badOrder=await newOrder(REGISTERED,'subscription',null,199);
  await assert.rejects(settle(badOrder,'trade-bad',1),/AMOUNT_MISMATCH/);
  assert.equal(((await db.query('select status from orders where id=$1',[badOrder])).rows[0] as {status:string}).status,'pending');
  assert.equal(((await db.query(`select count(*)::int count from payment_events where event_id='trade-bad'`)).rows[0] as {count:number}).count,0);

  // 专辑单：永久权益（ends_at null）；reconcile 命名空间 event id 可用。
  const handbook=((await db.query(`select id from series where slug='demo-selection-handbook'`)).rows[0] as {id:number}).id;
  const seriesOrder=await newOrder(REGISTERED,'series',handbook,199);
  assert.equal(await settle(seriesOrder,`reconcile:${seriesOrder}:T100`,199),'settled');
  const seriesEnt=(await db.query(`select ends_at from entitlements where user_id=$1 and type='series'`,[REGISTERED])).rows[0] as {ends_at:string|null};
  assert.equal(seriesEnt.ends_at,null);
  // 已购权益不重复开通：换一个用户重复专辑成交场景 → 该用户已有 fixtures 权益，行数不增。
  const dupOrder=await newOrder('00000000-0000-4000-8000-000000000004','series',handbook,199);
  assert.equal(await settle(dupOrder,'trade-dup-1',199),'settled');
  assert.equal(((await db.query(`select count(*)::int count from entitlements where user_id='00000000-0000-4000-8000-000000000004' and type='series'`)).rows[0] as {count:number}).count,1);
  // 已支付订单收到第二个不同 event：记事件但不重复开通。
  assert.equal(await settle(dupOrder,'trade-dup-2',199),'already_paid');
  assert.equal(((await db.query(`select count(*)::int count from entitlements where user_id='00000000-0000-4000-8000-000000000004'`)).rows[0] as {count:number}).count,1);

  // 订单不存在 / 空 event id 拒绝。
  await assert.rejects(settle(999999,'trade-x',199),/ORDER_NOT_FOUND/);
  await assert.rejects(settle(subOrder,'',199),/EMPTY_EVENT/);

  // 客户端角色无权执行 settle_payment。
  await db.exec('reset role;reset request.jwt.claims;set role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:REGISTERED})]);
  await assert.rejects(db.query(`select settle_payment($1,$2,$3,$4::jsonb)`,[subOrder,'trade-evil',199,'{}']),/permission denied/);
  await db.exec('reset role;set role anon');
  await assert.rejects(db.query(`select settle_payment($1,$2,$3,$4::jsonb)`,[subOrder,'trade-evil2',199,'{}']),/permission denied/);
});

test('payments: zpay provider signs, verifies and queries with a stub fetch',async()=>{
  // 三值同配 + HTTPS 才启用。
  assert.equal(zpayConfigFromEnv({}),null);
  assert.equal(zpayConfigFromEnv({ZPAY_BASE_URL:'http://insecure.example.com',ZPAY_PID:'1',ZPAY_KEY:'k'}),null);
  assert.equal(zpayConfigFromEnv({ZPAY_BASE_URL:'https://pay.example.com/',ZPAY_PID:'1001',ZPAY_KEY:'secret-key'})?.baseUrl,'https://pay.example.com');
  const provider=zpayProvider({baseUrl:'https://pay.example.com',pid:'1001',key:'secret-key'});
  // 收银台跳转：参数齐全、签名可复验。
  const order:PaymentOrder={id:7,merchant_order_no:'91234567890123456789012345678901',user_id:REGISTERED,sku_type:'subscription',target_id:null,amount:199,status:'pending'};
  const {redirectUrl}=provider.createPayment({order,productName:'万有AI · 全站订阅（1 年）',notifyUrl:'https://site.example/api/payments/notify',returnUrl:'https://site.example/checkout/7',channel:'alipay'});
  const url=new URL(redirectUrl);
  assert.equal(url.origin,'https://pay.example.com');
  assert.equal(url.pathname,'/submit.php');
  assert.equal(url.searchParams.get('type'),'alipay');
  const wxurl=new URL(provider.createPayment({order,productName:'x',notifyUrl:'https://site.example/api/payments/notify',returnUrl:'https://site.example/checkout/7',channel:'wxpay'}).redirectUrl);
  assert.equal(wxurl.searchParams.get('type'),'wxpay');
  assert.ok(wxurl.searchParams.get('sign'));
  assert.equal(url.searchParams.get('out_trade_no'),'91234567890123456789012345678901');
  assert.equal(url.searchParams.get('money'),'199.00');
  assert.equal(url.searchParams.get('name'),'万有AI · 全站订阅（1 年）');
  const signParam=url.searchParams.get('sign');
  assert.ok(signParam);
  const unsigned:Record<string,string>={};url.searchParams.forEach((v,k)=>{if(k!=='sign'&&k!=='sign_type')unsigned[k]=v;});
  assert.equal(epaySign(unsigned,'secret-key'),signParam);
  // 回调验签：roundtrip 通过，篡改金额/签名/协议均拒绝。
  const notify:Record<string,string>={pid:'1001',trade_no:'T9001',out_trade_no:'91234567890123456789012345678901',type:'alipay',name:'x',money:'199.00',trade_status:'TRADE_SUCCESS',sign_type:'MD5'};
  notify.sign=epaySign(notify,'secret-key');
  assert.deepEqual(provider.verifyNotify(new URLSearchParams(notify)),{orderNo:'91234567890123456789012345678901',tradeNo:'T9001',amount:199});
  const legacy:Record<string,string>={...notify,out_trade_no:'7'};legacy.sign=epaySign(legacy,'secret-key');
  assert.equal(provider.verifyNotify(new URLSearchParams(legacy)),null,'legacy local IDs cannot settle new orders');
  const tampered=new URLSearchParams(notify);tampered.set('money','1.00');
  assert.equal(provider.verifyNotify(tampered),null);
  const noType=new URLSearchParams(notify);noType.set('sign_type','RSA');
  assert.equal(provider.verifyNotify(noType),null);
  // 查单：stub fetch 返回平台已支付/未支付两种形态。
  const paidStub=(async()=>({ok:true,json:async()=>({code:1,status:1,pid:'1001',out_trade_no:'91234567890123456789012345678901',money:'199.00',trade_no:'T9001'})})) as unknown as typeof fetch;
  const unpaidStub=(async()=>({ok:true,json:async()=>({code:1,status:0,pid:'1001',out_trade_no:'91234567890123456789012345678901'})})) as unknown as typeof fetch;
  assert.deepEqual(await zpayProvider({baseUrl:'https://pay.example.com',pid:'1001',key:'secret-key'},paidStub).queryOrder(order),{paid:true,tradeNo:'T9001',amount:199});
  assert.deepEqual(await zpayProvider({baseUrl:'https://pay.example.com',pid:'1001',key:'secret-key'},unpaidStub).queryOrder(order),{paid:false,tradeNo:null,amount:null});
});

test('payments: settleIfPaidRemotely 查单补漏四种结局与事件命名空间',async()=>{
  const {settleIfPaidRemotely}=await import('../src/lib/payments/settle');
  const order={id:7,merchant_order_no:'91234567890123456789012345678901',user_id:'u',sku_type:'subscription',target_id:null,amount:199,status:'pending'};
  const mkProvider=(paid:boolean,tradeNo:string|null=null)=>({name:'zpay',createPayment:()=>{throw new Error('unused')},verifyNotify:()=>null,queryOrder:async()=>({paid,tradeNo,amount:199})});
  const mkService=(rpcResult:{data?:string;error?:{message:string}})=>{const calls:Record<string,unknown>[]=[];return {calls,rpc:async(_fn:string,args:Record<string,unknown>)=>{calls.push(args);return rpcResult;}};};

  const s1=mkService({});
  assert.equal(await settleIfPaidRemotely(s1 as never,mkProvider(false) as never,order,'return'),'unpaid');
  assert.equal(s1.calls.length,0);

  const s2=mkService({data:'settled'});
  assert.equal(await settleIfPaidRemotely(s2 as never,mkProvider(true,'T9') as never,order,'return'),'settled');
  assert.equal(s2.calls[0].p_event_id,'T9');
  assert.equal((s2.calls[0].p_payload as {source:string}).source,'return');

  const s3=mkService({data:'settled'});
  assert.equal(await settleIfPaidRemotely(s3 as never,mkProvider(true,null) as never,order,'reconcile'),'failed');
  assert.equal(s3.calls.length,0);

  const s4=mkService({data:'duplicate'});
  assert.equal(await settleIfPaidRemotely(s4 as never,mkProvider(true,'T9') as never,order,'reconcile'),'duplicate_or_already');
  const s5=mkService({error:{message:'boom'}});
  assert.equal(await settleIfPaidRemotely(s5 as never,mkProvider(true,'T9') as never,order,'reconcile'),'failed');
});

test('payments: settleIfPaidRemotelyWithRetry 覆盖平台确认延迟窗口',async()=>{
  const {settleIfPaidRemotelyWithRetry}=await import('../src/lib/payments/settle');
  const order={id:8,merchant_order_no:'91234567890123456789012345678901',user_id:'u',sku_type:'single',target_id:10,amount:0.01,status:'pending'};
  // 前两次查单未付、第三次已付 → settled（模拟跳回时平台尚未确认）
  let n=0;
  const provider={name:'zpay',createPayment:()=>{throw new Error('unused')},verifyNotify:()=>null,queryOrder:async()=>{n+=1;return {paid:n>=3,tradeNo:'T10',amount:0.01};}};
  const calls:Record<string,unknown>[]=[];
  const service={rpc:async(_fn:string,args:Record<string,unknown>)=>{calls.push(args);return {data:'settled'};}};
  assert.equal(await settleIfPaidRemotelyWithRetry(service as never,provider as never,order,'return',3,0),'settled');
  assert.equal(n,3);
  assert.equal(calls.length,1);
  assert.equal(calls[0].p_event_id,'T10');
  // 始终未付 → 重试耗尽返回 unpaid
  n=0;
  const provider2={...provider,queryOrder:async()=>{n+=1;return {paid:false,tradeNo:null,amount:null};}};
  assert.equal(await settleIfPaidRemotelyWithRetry(service as never,provider2 as never,order,'return',3,0),'unpaid');
  assert.equal(n,3);
});
