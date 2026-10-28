# 支付 API 契约

> 依据：PRD §4.3「在线支付」与「PaymentProvider 架构」。唯一在线支付 provider = zpay（易支付协议兼容）；接口职责唯一——「让订单 pending → paid」，paid 之后权益开通 / 邮件 / 人工处理为单一后置路径。

## 1. SKU 与定价 authority

| sku_type | target_id | 价格来源（服务端快照） | 可售条件 |
|---|---|---|---|
| `subscription` | null | `site_config.commerce.subscription_price` | 配置了非零订阅价 |
| `series` | series.id | `series.price`（>0） | `status='published'`（paused 停售不可新购，已购仍读） |
| `single` | articles.id | `articles.price`（>0） | `type='blog'`、`access='paid'`、`status='published'`；**专辑内文章不可单买** |
| `skill` | articles.id | `skills.price`（>0） | 独立 Skill 介绍已发布且已有当前版本包；迁移后的旧 series 不再新售 |
| `event` | series.id | `event_details.ticket_price` | 仅报名期的收费活动可售票 |

- 支付渠道：`site_config.commerce.payment_channels`（`alipay` / `wxpay` 子集）由站主后台勾选；买家在成交核对页选择渠道，start 路由按选择构造 `type` 跳转 zpay 收银台。

- 客户端只能提交 `{sku_type, target_id?}`；`amount` 一律服务端计算，客户端传入即 400。
- 已持有覆盖该 SKU 的有效权益 → `409 ALREADY_ENTITLED`（携带权益摘要）。
- 幂等：服务端调用 `create_pending_order`，在事务锁内复核可售状态、当前价格和有效权益；同用户同 SKU / target / 金额的 pending 单复用。改价生成新价格快照，旧单不改写。全站订阅覆盖付费单篇，与 PRD §6、visible() 和 RLS 一致。
- `orders.id` 仅供本站路由与用户展示；新订单的 `orders.merchant_order_no` 在数据库创建时产生并持久保存，采用 32 位数字，跨重新安装的 OPC 实例与商户账户历史保持高概率唯一。复用 pending 单时复用同一商户订单号。发起支付、平台查单、签名回调均使用它作为 `out_trade_no`，不得再使用自增 `orders.id`。升级前已结束的旧订单在该列保留原先提交给平台的数字 ID，供历史对账；新支付接口拒绝此旧格式。

## 2. 订单 API

```text
POST /api/orders            cookie 会话（匿名 401）
  req:  { sku_type, target_id? }
  res:  201 { order: { id, sku_type, target_id, amount, status, created_at } }
        400 参数非法 · 401 匿名 · 403 SKU 不可售 · 409 已持权益（复用/冲突说明）

GET /api/payments/start?order=<id>&channel=<alipay|wxpay>   仅订单本人且 status='pending' → 302 平台收银台
  （payment_enabled 关闭时 503，不产生收银台跳转；channel 必须在 site_config.commerce.payment_channels 内，否则 400/403；渠道由站主在后台勾选，须在 zpay 商户中心已开通）
GET /checkout/[orderId]              订单核对页（本人；非本人 404 不泄露存在性）
GET|POST /api/payments/notify        zpay 服务端回调（无会话，验签与商户 / 状态 / 金额校验）
POST /api/payments/reconcile         PUBLISH_TOKEN 或 owner 会话；查单补漏
```

## 3. PaymentProvider 接口（三方法）

```ts
type PaymentProvider = {
  /** 构造平台收银台跳转（form/redirect），商品名含具体商品描述（平台风控） */
  createPayment(order: Order): { redirectUrl: string };
  /** 验签 + 金额强校验；不符返回 null（调用方 400） */
  verifyNotify(params: URLSearchParams): { orderNo: string; tradeNo: string; amount: number } | null;
  /** 平台查单：返回该商户订单号的真实支付状态 */
  queryOrder(order: Order): Promise<{ paid: boolean; tradeNo: string | null; amount: number | null }>;
};
```

- 易支付兼容协议：`md5` 签名，参数按 key 排序拼接商户密钥；`ZPAY_BASE_URL`（必须 HTTPS）+ `ZPAY_PID` + `ZPAY_KEY` 三值同配启用，缺一即「暂未开通在线收款」。
- 平台可换：换 base URL + 商户密钥即切换，业务代码零改动（provider 列在创建订单时锁定进 `orders.provider`）。

## 4. 回调纪律

```text
拒绝重复参数 → 验签 → pid 等于本站商户、trade_status=TRADE_SUCCESS
→ 校验 32 位商户订单号 / 流水号 / 正数金额格式 → 按商户订单号查单且金额 == 订单.amount
→ 流水锁 + 订单锁；先检查 provider、金额、订单状态与事件所属订单
→ INSERT payment_events (provider, event_id=trade_no) 唯一去重
→ 同事务：orders.status pending→paid + entitlement 开通 + 权益邮件 outbox
   subscription: ends_at = now + 1 年
   series/single/skill: permanent（ends_at null）
→ 已提交或有效重放应答纯文本 success；校验失败 400，数据库异常 500
  不同步发送邮件；数据库客户端请求最多 3.5s，异常或结果未知返回 500 供重试
```

- `payment_events` 是唯一入箱：notify 与 reconcile 共用同一「入箱 → 后置」函数，禁止旁路。
- notify、跳回查单与 reconcile 均调用 service_role 专用 `settle_payment_reference`；它要求签名回调或可信查单结果的 `out_trade_no` 与订单持久商户编号一致，再委托原子入箱函数。最底层 `settle_payment` 在取得订单行锁后再次校验持久编号；直接调用旧 `settle_payment` / `settle_payment_queued` 也必须携带正确的 32 位编号。未知编号、旧数字本地 ID、缺失编号、载荷错绑一律不授予权益，包括旧部署仍在处理回调的情形。
- 查单补漏：reconcile 扫 pending 且超时订单逐笔 queryOrder，平台侧 paid 的走同一入箱路径（event_id 使用平台 trade_no，payload.source=reconcile）。
  - 自动调度走 `POST /api/cron/payment-reconcile`，只接受服务端 `CRON_SECRET` 或 `PUBLISH_TOKEN` Bearer。每次最多认领两单、45 秒预算；数据库 `claim_pending_payment_reconciliation()` 以 `reconcile_checked_at` 排序并用 `FOR UPDATE SKIP LOCKED` 原子认领。创建未满 10 分钟或 30 分钟内已查过的不认领。失败返回 503，成功返回 `summary` 和 `reason=null`。调度与验收见[支付查单补漏调度](../operations/payment-reconcile-scheduler.md)。
  - `POST /api/payments/reconcile?after=0` 从头开始，按订单 ID 升序，每批最多处理 50 单；仍仅包含创建超过 10 分钟的 pending。鉴权保持 PUBLISH_TOKEN 或 owner 会话。
  - 响应包含 `summary`（scanned / settled / already / unpaid / failed）、`complete`、`nextAfter`、`reason`。`scanned` 是本批实际尝试数；`complete=false` 时以返回的 `nextAfter` 继续，不能把 HTTP 200 单独作为全量完成信号。整轮结束后，下一轮必须重新从 0 开始，以复查后来才付款的旧订单。
  - 单请求预算 45 秒，函数上限 60 秒；平台查询上限 10 秒、数据库请求上限 8 秒。余量不足 20 秒时停止启动新查单，返回 `reason=budget_exhausted` 和已完成位置。
  - 读取失败返回 503 / `order_read_failed`。单笔结算失败返回 503 / `settlement_failed`、`failedOrderId`，游标停在上一笔确认完成的订单；重试不会跳过失败单。持续失败时人工核对订单与支付平台，不反复循环调用。鉴权或配置异常返回通用 503，不泄露 SDK 错误和密钥。
  - 此人工接口不自行循环或创建定时任务。调用方必须保存续扫位置、等待本批完成再调用下一批；失败最多有限重试后转人工。不能将并发调用当作吞吐优化。
- 跳回即落账：买家跳回 `/checkout/[id]?trade_status=TRADE_SUCCESS` 且订单仍 pending 时，页面服务端直接 queryOrder 并入箱（event_id 使用平台 trade_no，payload.source=return）；URL 参数不参与信任，只作为触发器。查单 unpaid 时按 1.5s×3 重试覆盖平台确认延迟；仍 pending 则页面自动轮询刷新兜底。notify / reconcile / return 三条路径共用商户编号绑定的结算入口，同一笔成交只开通一次权益，调用方不再发邮件。

**既有实例升级**：先暂停在线收款并确认没有正在跳转或支付中的订单；逐笔对账所有旧 pending 单。旧数字编号可能与另一实例的历史交易相撞，因此不得只凭平台编号与金额自动补单；须以交易时间、付款人/收据和本地订单记录确认归属，再处理已付订单的权益与邮件。确认为未付且不会再支付的订单，可在停收款、留存备份和核对付款人确认/平台记录后，由受信运维将 `pending → failed`，记录订单号、原状态、金额、核对依据与时间；这是人工关闭未支付旧单，不是退款、补单或删除。若归属不明、存在已付证据或仍可继续支付，则保持 pending，暂停升级并人工处理。迁移在存在任何 pending 单时拒绝执行；不能直接改状态或删除订单以绕过检查。随后执行 [`20261010053221-to-payment-reference.sql`](../../supabase/upgrades/20261010053221-to-payment-reference.sql)，一次事务同时安装商户编号和底层结算绑定至 `20261011144257`（要求收款关闭；锁等待 5 秒、单语句 30 秒；失败整体回滚）、核对 `verify.sql` 全部通过、部署同批应用，最后恢复收款并用新订单做小额闭环。历史已结束订单的 `merchant_order_no` 保留旧数字，与实际平台记录一致；其旧数字回调在新应用中失败关闭，不会被解释成新订单。外部支付平台的历史流水需继续留存用于人工对账。
- 退款：当前不做自动化；支付成功但权益未开通的异常订单由站主人工处理（后台用户列表可查可改，操作记 source='admin'）。

**权益邮件**：`email_outbox` 由新增权益触发器在 queued 事务内写入，service_role 专用。worker GET / POST `/api/cron/mail-outbox` 需要 CRON_SECRET 或 PUBLISH_TOKEN；固定邮件与幂等键重试，120 秒租约 + token 防旧 worker 确认，最多 8 次，23 小时停止自动重发。Resend 的幂等保留期为 24 小时，终止任务须人工核对收据；其他事务邮件未纳入本批。部署采用「新迁移 → 新应用 → 配置外部每分钟调度」，旧 4 参数 settle_payment 保留为内部结算核心，不自动队列化历史订单；自商户编号升级起也强制校验持久编号，旧应用必须更新，不能用原数字 ID 或缺失编号调用它。详情与验收边界见 [权益邮件运维](../operations/payment-mail-outbox.md)。

签名通知及 Bearer cron 不依赖浏览器会话刷新，其原有签名 / Bearer 验证仍完整执行。权益邮件与到期提醒两个 cron 的 HEAD 均显式返回 405 / `Allow: GET, POST` / no-store，不执行 GET；调度必须使用 GET 或 POST。有明确截止的服务端 Supabase 请求关闭 SDK GET 自动重试并保留取消信号，结算 POST RPC 不做 SDK 重试。

## 5. 安全与红线

- notify 路由**无会话依赖**：只信签名 + 金额，不信任何客户端字段声明的订单状态。
- 权益（entitlements）是唯一权利源：已购态渲染只读 entitlement，不读 orders。
- zpay 密钥仅服务端；不进浏览器 / 日志 / 错误信息 / NEXT_PUBLIC_ 变量。
- 商品名为「站名 + 商品描述」（如「万有AI · OPC白皮书 专辑」），不含用户敏感信息。
- 四方支付风险在 README 如实披露（无牌照资金归集，勤提现、余额不过夜），开通与否由站主自决。

## 6. 独立审查加固（2026-09-29）

- 回调同一参数出现两次即拒绝；签名与结算消费同一份解析结果。本站订单路由 ID 限制为 JS 安全正整数；平台商户订单号为固定 32 位数字；金额须符合 numeric(8,2) 的正数范围及最多两位小数。
- 查单须返回成功 code、本商户 pid、请求的 out_trade_no、有效 trade_no 与金额；缺失字段不以本地金额或虚构流水补齐。协议以 [ZPAY 开发文档](https://api.zpayz.cn/doc.html) 为核对依据。
- `settle_payment` 仅服务端可调；金额检查先于重复事件返回；pending 才能开权益，paid 只记事件不再开通，failed / refunded / fulfilled 拒绝重入。不同订单复用流水拒绝。
- 新事件 payload 写入不可由来参覆盖的 settlement_order_id 和 trade_no；旧通知从 out_trade_no、旧查单从 return/reconcile 前缀恢复关联。无法确认旧事件归属时返回 EVENT_BINDING_REQUIRED，要求人工核对，不自动放行。原事件不批量重写。
- 同流水锁防跨订单竞争，同用户/SKU/target 锁保护下单复用和结算的有效权益检查。真实 PostgreSQL 17 多连接已验证四种 SKU 建单、通知 / 查单竞争、错绑、权益去重、锁超时与断线 / 故障回滚；工具和边界见 [并发验收](../development/database-concurrency.md)。该结果不代表云端全身份矩阵、供应商时限或最终独立复核已经完成。
- 2026-09-29 的旧查单前缀兼容只保留事件归一化；2026-10-11 商户号升级起，所有结算调用必须同时提供匹配的持久编号。部署遵循上方暂停收款、旧单核对、原子升级和匹配应用的顺序。旧版应用仍含回调解析和缓存漏洞，数据库升级本身不等于应用修复已上线。

## 普通专辑商品

`collection` 与 `handbook`、`skill` 共用 `series` SKU、数据库价格快照和既有权益类型；活动仍使用票价权威。普通专辑不增加订单状态或付款旁路。结算重放不得重复增加权益或邮件；机器目录保持 series 形状。

## 订单内容入口

本人订单列表、订单详情、支付返回页及站主收款订单详情通过同一服务端元数据解析获取商品名称与站内链接。单篇使用 `/blog/[slug]`；专辑使用统一类型路由（含 `/collections/[slug]`）；活动使用 `/events/[slug]`；订阅指向 `/me`。批量列表最多读取一批文章元数据和一批专辑元数据，不逐单查询，不读取正文。

缺失、草稿、归档、SKU 与内容类型不匹配时不生成链接。订单及目标页各自执行原有鉴权，链接不代表付款或授权，不修改订单、权益或支付状态。
