# 权益邮件队列：部署、调度与故障处理

权益邮件与结算事务一起入箱，由独立 worker 领取和发送。本页是部署与故障处理指南，执行结果和限制见[发布状态](../development/release-status.md)。

## 实际行为

三个结算入口经 `settle_payment_reference` 校验持久商户订单号，再进入 `settle_payment_queued`；底层结算在订单锁内再次检查编号绑定。支付事件、订单变为 paid、权益及 `email_outbox` 任务在同一事务提交；任务插入失败时全部回滚。通知路由只等待数据库，客户端网络请求截止为 3.5 秒，成功仅接受 settled / duplicate / already_paid。网络中断后数据库仍可能提交，平台重试会按同一流水幂等处理。

独立 `/api/cron/mail-outbox` worker 每次最多处理 5 项，45 秒总预算，外部请求及数据库单次请求最多 8 秒；领取采用 `FOR UPDATE SKIP LOCKED`。一项任务有 120 秒租约和随机 token，过期后可以重新领取，旧 token 无法写回结果。不要只把发送逻辑放入进程内的异步回调。

有明确截止的 Supabase 客户端关闭 PostgREST 自动重试，并合并请求和调用者的取消信号，避免 GET 重试退避超出 worker 预算。支付结算是 POST RPC，不受此次确认的 GET 自动重试缺陷影响。邮件队列与到期提醒两个 cron 都显式拒绝 HEAD（405 / `Allow: GET, POST` / no-store），避免 Next.js 用 GET 自动实现 HEAD 时触发发送；GET / POST 仍须 Bearer 鉴权。

领取后通过服务端 Auth Admin 查询邮箱，固定收件人、发件人、主题、正文、站点链接和 API Key 的 SHA-256 指纹。后续重试只用已保存内容，配置或用户邮箱变化不重新生成。幂等键为 `grant/<任务 UUID>`，只发给 Resend，不进入浏览器或日志。表含收件人及邮件正文，仅服务端角色可以访问；站主诊断只显示健康状态。

瞬时网络错误、429、5xx 和并发幂等冲突会重试；校验 / 授权拒绝、内容幂等冲突、发送账户变化和收件人缺失会终止。最多 8 次领取，重试间隔为 1、2、4、8、16、32、60 分钟。Resend 幂等键保留 24 小时；系统以首次准备时间为起点，23 小时后停止自动发送。此机制不能声称无限期的恰好一次送达。邮件未送达不撤销已经提交的付款或权益。

队列只发送结算时实际新增权益的通知。迁移前的订单、已有权益或重复流水不会重新入箱；到期提醒、停售和服务通知使用各自发送路径。未配置事务邮件时，新任务仍持久保存；以后启用会处理这些未准备任务，启用前应核对积压。

## 操作顺序

1. **核对数据库版本**：新实例按[数据库指南](../../supabase/README.md)执行 install / verify；已有实例先备份，再按[升级说明](database-upgrade.md)选择缺失增量。不要重跑安装文件；邮件 worker 依赖的 RPC 必须与应用版本一致。
2. **部署应用与配置邮件**：服务端环境填入 Secret `RESEND_API_KEY`、Config `EMAIL_FROM` 与 `SITE_URL`。`EMAIL_FROM` 的邮箱域名须在同一 Resend 账户验证，API Key 须具备该域名的发送权限。SMTP 登录邮件成功不能证明这组事务邮件变量正确。
3. **准备调度**：为调度器配置独立 Secret `CRON_SECRET`，与发布工具的 `PUBLISH_TOKEN` 使用不同值；授权范围见[环境变量契约](../contracts/environment.md#调度密钥与发布密钥)。每分钟 GET 或 POST `${SITE_URL}/api/cron/mail-outbox`，凭据仅放 `Authorization: Bearer <CRON_SECRET>` 请求头，HTTP 超时覆盖 45 秒 worker 预算。使用 [Supabase 配置脚本](mail-scheduler.md)时先准备停用任务，核对积压和发送结果后再启用。仓库不自动添加分钟级 Vercel Cron。
4. **验证实际送达**：在隔离测试项目完成一笔授权支付，核对 paid、权益、唯一队列任务、Resend 收据和实际收信；重放通知不应新增任务。再核对无凭据请求返回 401，自动调度执行成功。已有相同实现的真实证据可复用，不为检查配置重复付款。故障注入、租约恢复和幂等测试仅在隔离环境执行。
5. **按运维需要配置告警**：可选 `MAIL_SCHEDULER_HEARTBEAT_URL` 回报独立监控服务；如启用，另行验证任务停运后收到告警。基础发信不依赖监控订阅。

旧函数名仍存在，但当前数据库已在底层强制商户编号绑定，不能回滚到只提交本地递增订单 ID 的旧应用。回退必须选择支持当前商户编号协议的版本，并核对处理中的邮件任务；不要删除队列表、清除支付事件或解除编号约束。数据库升级不会将历史订单重新排队。

## 健康检查与人工处理

`/admin/setup` 的「权益邮件队列」显示是否存在终止任务或超过 10 分钟的到期积压；队列为空不能证明调度已运行。worker 处理后发现上述问题返回 503，只有计数、固定错误和摘要，不返回收件人、任务正文或密钥。

故障时先恢复配置 / 调度并查看 SQL Editor 的只读摘要：

```sql
select public.email_outbox_health();
select id, order_id, status, attempts, last_error, started_at, provider_message_id
from public.email_outbox
where status='dead' or (status='processing' and lease_until<now())
order by created_at;
```

恢复中的任务由 worker 自动领取；不要人工清理有效租约。终止任务需先根据订单、幂等键、发送时间与 Resend 收据核对是否已接受。网络错误、丢失确认和超时可能发生在发送成功之后，不能据此直接补发。超过窗口或切换 API Key 时，核对发送账户与收据后由维护者单独决定是否重新通知；当前不提供自动重新开任务 / 清空指纹的捷径。人工结论记录到运维日志，保留任务供对账。

供应商返回失败时，Vercel Runtime Logs 中的 `mail_provider_response` 只记录任务编号、HTTP 状态、处理结果和固定错误码，不记录邮箱、邮件正文、密钥或供应商响应原文。`401` 优先核对 API Key；`403` 核对发送权限及发件域；`400` / `422` 核对发件地址与请求格式。结合 Resend 日志确定具体原因，不因单一状态码就重置凭据或重新发送。

收件人与正文也进入数据库备份，按部署者的数据保留政策保护和清理；不能导出到公开 issue。用户数据删除遵循既有外键级联。当前不提供自动保留期或清理 cron。

## 验证与边界

本地运行迁移集成测试、注入的邮件 worker 故障测试和真实 PostgreSQL 并发测试，不会调用真实 Resend：

```bash
npm run test:admin
npm run db:baseline:check
# 按 docs/development/database-concurrency.md 启动隔离 PostgreSQL 后：
npm run test:db:concurrency
```

回归使用 PGlite/真实 PostgreSQL 验证事务、租约和 token 保护；Auth/provider 故障注入使用模拟。托管扩展、定时进程、非空任务和实际收件另行验收。独立失败告警按运维需求配置。

以下为初轮邮件迁移的历史演练工具，仅限其 manifest 指定的前置版本，不能用于当前支付版本的新装或升级：

```bash
node scripts/build-migration-review.mjs /tmp/wanyou-mail-review
```

脚本校验 manifest 中迁移与 verify 的 SHA-256，并要求匹配前置版本；在同一事务比较各表行数与内容摘要并执行 verify。先运行 `-rollback.sql`，确认回滚状态，再运行 `-commit.sql`。摘要不包含原始数据，也不是备份；此全表扫描工具仅用于小型测试库，生产升级另行安排备份、容量和维护窗口。

设计依据：[Resend 幂等键](https://resend.com/docs/dashboard/emails/idempotency-keys)、[Resend 错误类型](https://resend.com/docs/api-reference/errors)、[PostgreSQL SKIP LOCKED](https://www.postgresql.org/docs/17/sql-select.html)。
