# 支付查单补漏调度

ZPAY 的[开发文档](https://zpayz.cn/doc.html)说明异步通知可能最终未送达。买家返回页能立即查单，但买家关闭收银台时没有返回。为此，已创建超过 10 分钟的 `pending` 订单需定期由平台查单确认；只有平台返回已付且商户编号、金额与订单匹配，才进入同一个原子结算函数。调度不会发起付款、扣款或退款。

应用接口 `POST /api/cron/payment-reconcile` 每次最多认领两单，单次预算 45 秒。数据库的 `reconcile_checked_at` 记录认领时间，同一待付单至少间隔 30 分钟再查；`FOR UPDATE SKIP LOCKED` 防止并发任务重复认领。这样不会因为旧未付单长期留在队列而永久挡住后续订单。若待付积压超过每分钟两单的能力，权益开通可能延迟，应查看本页状态查询并人工核对，不得声称实时到账。原 `/api/payments/reconcile?after=...` 仍用于受控人工续扫，不应由定时任务反复从 0 调用。

本方案沿用[邮件调度](mail-scheduler.md)已安装的 `pg_cron`、`http` 和 Vault；新装先执行该文档的 `01-enable.sql`。SQL 调度是部署后的独立运维配置，**不进入数据库 `install.sql`，恢复库也不会自动启用**。仅在承载真实订单且已配置支付的数据库启用一次。若无 Supabase Cron，可用其他支持每分钟 HTTPS POST 和 Bearer 的调度器调用同一路由，但必须检查 200 与 `reason=null`，失败要复核，不能把空调用当作支付验收。

按以下顺序操作，所有 SQL 在目标 Supabase SQL Editor 以 `postgres` 执行：

1. 先升级数据库至 `20261013171232`，部署同一提交的应用，运行 `verify.sql`。确认 Production 固定域名可公开访问，`ZPAY_BASE_URL` / `ZPAY_PID` / `ZPAY_KEY` 与 `CRON_SECRET` 已在 Production 生效。不要把密钥发到聊天、日志或 SQL 编辑器。
2. 在 Supabase Vault 新增 `wanyou_payment_reconcile_url` = `https://你的Production固定域名/api/cron/payment-reconcile`。凭据沿用邮件调度已有的 `wanyou_mail_cron_secret`（历史名称，值为 Vercel Production 的 `CRON_SECRET` 原值，不带 `Bearer `）；若未配置邮件调度，也按[邮件调度](mail-scheduler.md)的说明保存此项。不要使用 Preview 域名或把密钥写进 URL。
3. 执行 [`01-prepare.sql`](../../supabase/operations/payment-reconcile/01-prepare.sql)。它只创建 `active=false` 的任务，不查单。若同名任务存在，先检查，脚本不会覆盖。
4. 在支付平台和数据库核对当前 `pending` 订单及积压，确认允许自动查询并为确实已付的单开通权益、排入邮件队列后，执行 [`02-start.sql`](../../supabase/operations/payment-reconcile/02-start.sql)。这一步开始每分钟调用。
5. 跨过至少两个分钟边界后执行 [`03-status.sql`](../../supabase/operations/payment-reconcile/03-status.sql)：`active=true`、`synchronous_http=true`，最近运行应为 `succeeded`。`aged_pending` 是超过 10 分钟的待付单数；`due_now` 是当前可认领数。任务运行成功仅证明调度请求与接口正常，若要证明补单，需用隔离受控订单验证 `payment_events`、订单状态、权益和邮件任务的唯一性。返回页落账不能冒充无人返回时的自动补单证据。

异常时执行 [`04-stop.sql`](../../supabase/operations/payment-reconcile/04-stop.sql)停后续调度，核对支付平台、订单和 `payment_events`，再修复；已经发出的 HTTP 请求可能完成。401 表示 Cron Secret 或部署不一致，503 表示配置、数据库认领或平台查单 / 结算异常；不要通过改订单状态、重放无签名通知或盲目重复付款来“消除”异常。Cron SQL 不记录密钥、商户编号或响应正文。TLS 验证保持开启，连接超时 5 秒、请求超时 55 秒；单次 SQL 最长 60 秒。生产故障应同时检查 Vercel 函数日志和 Supabase `cron.job_run_details`。

依据：[Supabase Cron](https://supabase.com/docs/guides/cron)、[Supabase pg_cron 排障](https://supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz)、[ZPAY 开发文档](https://zpayz.cn/doc.html)。
