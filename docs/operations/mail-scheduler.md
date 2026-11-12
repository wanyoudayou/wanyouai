# Supabase 权益邮件调度

可选运维方案：`pg_cron + http + Vault` 每分钟直接调用现有 `/api/cron/mail-outbox`。采用同步 HTTPS，凭据只在调用时从 Vault 读取，不进入 pg_net 的共享请求队列。准备和启用分开；本地 SQL 测试不等于托管调度或自动送信验收。其他 HTTP 调度器可沿用[邮件队列指南](payment-mail-outbox.md)。

脚本不进入应用 `install.sql` 或业务 migrations，不随数据库恢复自动启动。每个 OPC 只在承载实际订单的数据库配置一次；恢复测试库继续停用支付和邮件，现有每日到期提醒不变。

## 操作顺序

在目标 Supabase 项目的 **SQL Editor** 以 `postgres` 执行以下完整文件。Vercel 使用 **Production 固定域名**，避免 Preview 登录保护。出现错误时停止后续步骤，不重复安装或删除扩展。

1. 执行 [01-enable.sql](../../supabase/operations/mail-scheduler/01-enable.sql)。安装 `pg_cron`、`http` 并验证实际 API 签名；不创建任务、不调用 HTTP。结果列出 `http`、`pg_cron`、`supabase_vault` 的 `installed_version`，三者 `installed` 应为 true。该方案要求 `http` 位于 `extensions` schema；若已有安装位置不同，先复核，脚本不会自动移动或重装。
2. 在 **Vercel → 项目 → Settings → Environments → Production** 配置专用 Secret `CRON_SECRET`，并部署使之生效。接着在 **Supabase → Vault** 保存下表两项。密钥直接输入表单，不写进 SQL Editor 历史或聊天。已配置且一致时无需重新填写。
3. 执行 [02-prepare.sql](../../supabase/operations/mail-scheduler/02-prepare.sql)。应返回一条 `wanyou-mail-outbox`，`schedule=* * * * *`、`active=false`，附队列摘要。脚本不覆盖同名任务，整个准备过程不发送 HTTP 或邮件。
4. 确认允许后续真实业务权益通知自动发送后，执行 [03-start.sql](../../supabase/operations/mail-scheduler/03-start.sql)。应为 `active=true`。首次启用要求队列只有 sent 或没有记录，避免发送未核对的历史积压。
5. 至少经过两个分钟边界后，执行 [04-status.sql](../../supabase/operations/mail-scheduler/04-status.sql)。单个结果包含任务状态、队列摘要和最近五次运行。`synchronous_http=true` 且连续两次 `status=succeeded`，才证明本版本成功收到两次 HTTP 200 和有效 worker JSON。

| Supabase Vault 名称 | 值的明确来源 |
|---|---|
| `wanyou_mail_worker_url` | `https://你的Production固定域名/api/cron/mail-outbox`，无查询参数 |
| `wanyou_mail_cron_secret` | Vercel 项目 **Production 环境变量 `CRON_SECRET`** 的完整原值，不含 `CRON_SECRET=`，不加 `Bearer ` |

Vercel Sensitive 值保存后不能回读，从自己的本机配置底稿取值；找不到时先停止，不能随便填入另一份密钥。新装推荐独立的 `CRON_SECRET`。已有外部调度若选择沿用兼容的 `PUBLISH_TOKEN`，此 Vault 项也可保存该发布令牌的完整原值：应用仍接受它，但其权限比维护任务密钥更广。这里的“共用”指邮件与支付调度使用同一份凭据，不表示两项环境变量必然相等；也不需要将两项变量合并或同时改值。更换域名或轮换所用密钥前先停用，更新对应 Vercel 部署与 Vault 后再启动。

## 从早期 pg_net 脚本恢复

早期版本要求撤销 `PUBLIC / anon / authenticated` 对 `net` 的权限。托管 Supabase 的 `net` 对象及授权归 `supabase_admin`，项目 `postgres` 无法撤销；SQL Editor 不显示相关 warning，容易误以为成功。官方将此列为[托管平台约束](https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16)。

因此旧 `02-prepare.sql` 可能报 `Extension permissions require review before storing a bearer in requests`。这是本方案原先的平台兼容性缺陷，不是密钥填写错误。事务在创建任务前终止时没有 HTTP 请求或邮件发送。不要删除 guard 强行放行，不要重跑旧 REVOKE 或重装 pg_net。

恢复路径：保留 Vercel 和 Vault 的现有值，使用本版本的 **01-enable → 02-prepare**。若同名任务已经存在，先按 **05-stop** 停用并复核原命令，由维护者明确替换；新脚本拒绝覆盖。已安装的 pg_net 暂时保留，避免影响其他 Webhook；本方案不调用它。

[00-check-permissions.sql](../../supabase/operations/mail-scheduler/00-check-permissions.sql)只查权限。新方案下 `net_usage` / `net_headers_select` 可以仍为 true，因为不会向该表写凭据；两种应用角色的 `vault_secret_select` 必须为 false，表级和列级 SELECT 均检查。`net`、`vault`、`cron`、`extensions` 仍不得加入 Data API exposed schemas。默认 net 授权并不单独证明客户端泄露，还要结合 Data API 与数据库连接路径判断。

## 执行边界和故障处理

- 连接超时 5 秒，整个 HTTPS 请求超时 55 秒，Cron SQL 上限 60 秒。网络等待占用本任务的数据库连接；pg_cron 同一任务只运行一个实例。不能把本方案用于高频或无界长任务。
- TLS 校验必须开启。每次调用重置 curl 配置；若 PostgreSQL 服务端或客户端日志级别会输出 DEBUG2 请求头，任务在读取密钥前失败。不要为排错开启带密钥的 HTTP 详细日志。
- 只有 HTTP 200、可解析 JSON、`enabled=true` 与健康摘要对象才能成功。401、503、重定向或登录页均失败。日志不保存请求头、响应正文或扩展的原始错误；调试时先看 `/admin/setup` 和 Vercel worker 日志。
- 通过 [05-stop.sql](../../supabase/operations/mail-scheduler/05-stop.sql)停止后续调度。正在执行的 HTTPS 请求可能完成；SQL 回滚或连接中断不能撤销已发邮件。恢复前核对 outbox 收据和租约，保留幂等记录。
- 不删除扩展、共享日志或其他任务。Cron 运行历史不会自动清理，维护者按留存规则管理本任务记录。

## 验收边界

空队列成功只能证明调用链。新部署须核对一次非空业务任务的自动领取、sent 状态、供应商收据与实际收件；不要为检查重发已确认送达的历史通知。

本方案可选接入独立心跳监控。把独立监控服务提供的秘密 HTTPS 成功回报地址保存为应用服务端 `MAIL_SCHEDULER_HEARTBEAT_URL`，重新部署；地址不得带用户名、密码、查询参数或片段。邮件 worker 只有在鉴权、数据库处理和队列健康检查均成功后才发送空 POST；失败、超时、401、503 或任务停运都不会回报成功。它不包含订单、收件人或邮件正文，URL 本身须按密钥保护；无效地址或监控网络故障不会阻断邮件处理。请求最多等待 2.5 秒，不跟随重定向。未配置时行为不变。

例如 [Healthchecks.io 的 Cron 监控](https://healthchecks.io/docs/monitoring_cron_jobs/)可创建一个检查，周期 1 分钟，宽限时间按网络与运行波动设置（测试环境可先用 3 分钟），将其 Ping URL 保存到 Vercel Production 的上述变量，再确认邮件 worker 的下一轮成功回报使检查变为 Up。随后在**无待发任务的隔离环境**停用本任务超过宽限时间，确认告警实际到达，然后恢复任务并确认下一轮回报。该服务的 [Ping URL 应视为秘密](https://healthchecks.io/docs/)；不要提交到 Git、SQL 或公开问题。其他支持 HTTPS 成功回报和漏报告警的服务也可使用同一配置。未验证通知渠道和停运演练前，独立告警仍记为未验收。平台用量与计费遵循部署者套餐，不承诺无限免费。

本地命令 `npm run test:mail:scheduler` 使用 PGlite 与扩展替身，验证 SQL 分支和保护条件；真实 `http` 扩展、TLS、pg_cron 后台进程和送信必须另做托管验证。

依据：[Supabase http](https://supabase.com/docs/guides/database/extensions/http)、[pgsql-http 源码与超时说明](https://github.com/pramsey/pgsql-http)、[pg_cron](https://github.com/citusdata/pg_cron)、[Vault](https://supabase.com/docs/guides/database/vault)。
