# Supabase 安全配置契约 · v0.1

图片素材库新增 `media_assets`（站主读取及名称／替代文字／归档更新）与 `media_uploads`（仅服务端）。文件地址、摘要、格式、尺寸和体积不能由浏览器写入。固定私有桶 `media-uploads` 不授予普通身份对象访问权，只签名单个待验证上传；验证后由服务端写入公开图片桶。引用计数 RPC 使用调用者权限并显式检查站主，仅返回数量，见[素材库契约](media-library.md)。

## 创建项目时的 Security 配置

| 配置项 | 建议值 | 原因 |
|---|---:|---|
| Enable Data API | **开启** | 前台 / SSR 使用 `supabase-js` 与 Supabase Auth；表访问仍受显式 GRANT + RLS 控制 |
| Automatically expose new tables | **关闭** | 避免未来新表默认暴露；当前 migrations 已显式授予 Data API roles 所需权限 |
| Enable automatic RLS | **开启** | 为 `public` 中的新表自动启用 RLS；具体 policy 和权限仍由安装文件显式设置 |

在创建项目页面的 **Security** 区域完成以上三项，再点击创建。已创建项目可在 **Integrations → Data API** 复核接口与自动暴露设置；部分项目不显示自动 RLS 开关，可用下方只读查询核对触发器。

## 执行顺序

1. 创建项目时勾选 `Enable Data API`
2. 取消 `Automatically expose new tables`
3. 勾选 `Enable automatic RLS`；如需核对，在 SQL Editor 只读查询 `select e.evtname,e.evtenabled,p.proname from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid where e.evtname='ensure_rls';`。返回 `ensure_rls / O / rls_auto_enable` 表示已启用。若项目无此平台触发器，安装文件仍显式启用应用表 RLS，随后由 verify 检查
4. 在全新项目执行 `supabase/install.sql`
5. 执行 `supabase/verify.sql`，所有行 passed 为 true
6. 用 Dashboard 或 `npm run storage:setup -- --apply` 初始化图片桶，检查对象 RLS
7. 指定 OWNER_EMAIL，保存 Vercel 环境变量并部署 Production，确认固定网站地址与 SITE_URL 一致；已有实例走专用升级路径
8. 使用真实网站地址配置 Supabase Auth 回调，再配置 SMTP 与登录模板，最后登录认领站主

当前执行状态与版本见[发布状态](../development/release-status.md)。CLI 历史不能仅凭应用版本自动对齐，操作见[数据库指南](../../supabase/README.md)。

首次站主认领由应用在 Auth 验证后检查 `OWNER_EMAIL`，再以服务端 `service_role` 调用 `claim_owner_for(uuid,text)`。普通 `authenticated` 不具备该 RPC 的执行权；旧 `claim_owner()` 在 V1 加固迁移中移除。已有站主不会因环境变量变化而自动转移。

服务端客户端拒绝将已知 Publishable / anon / authenticated 公钥用作管理密钥。该检查只阻止误配，不代替 Supabase 验证密钥。OTP 或链接验证成功后的认领请求失败会保留独立错误提示，不解释为邮箱不匹配；运行日志只记录操作阶段与受限错误码，不记录邮箱、密钥或原始 RPC 错误正文。

履约写权限由 `v1-booking-authority.sql` 收口：撤销会话角色对 bookings / milestones 的直接写权限。`manage_booking` 是限定 owner、固定空 search_path、显式限定表名的 SECURITY DEFINER 事务入口；`client_respond_booking` 校验 Auth 用户与订单客户一致。仅这两个受控 RPC 允许会话修改履约状态，整单验收不授予 owner；service_role 保留服务端权威操作权限。这里的 SECURITY DEFINER 用于明确的受控写入口，不能据此把其他 RPC 批量改为 definer。

## 权限原则

可选[邮件调度运维配置](../operations/mail-scheduler.md)使用 pg_cron、同步 http 与 Vault，带 5 秒连接 / 55 秒总 HTTP 超时及 TLS 校验。托管 Supabase 不允许 postgres 撤销 pg_net 默认授权，因此本方案不把 Bearer 写入 net 共享请求队列。Vault 仅存生产 endpoint 与专用 CRON_SECRET；任务 SQL 只引用秘密名称，准备与运行均检查应用角色不能 SELECT 解密列、日志未开启 DEBUG2 请求头输出。不把 net、cron、vault、extensions 加入 Data API exposed schemas。脚本不进入应用安装基线或恢复后自动启动流程，不新增应用表、公开 RPC 或浏览器 service_role 入口。

- `service_role`：仅服务端；拥有写权限并绕过 RLS，用于发布、支付、权威后台操作。
- `anon`：只授予公开 / RLS 可放行的读取权限。
- `authenticated`：只授予有 RLS policy 支撑的读取与写入权限。
- 表级 `GRANT` 不是权限判定终点；行级可见性必须由 RLS 决定。
- 新增表时必须同时补：`enable row level security`、policy、显式 Data API grant。

## 发布事务与图片存储

`commit_publication(text, jsonb)` 使用 `SECURITY INVOKER`、空 search_path 和显式 public 表限定，仅授予 service_role EXECUTE，撤销 PUBLIC / anon / authenticated 的执行权限。应用必须先验证脚本 token 或 owner 会话，再调用它；浏览器不能直接调用该 RPC。文章、正文、版本、chunks 与首次响应在同一事务提交，request / slug 使用事务级 advisory locks 串行化。

图片桶为公开读、服务端写；不授予 anon / authenticated 上传、覆盖或删除权限。服务端核验对象 SHA-256、实际格式和尺寸，SVG 经白名单消毒后转 PNG，页面仅引用转换结果。第三方图片不由携带凭据的服务端抓取，返回外链未本地化警告。

Web 导入按当前 install/升级路径配置；content_files / content_file_revisions / content_assets 全部启用 RLS，仅 authenticated owner 读取，service_role 写入。heads 视图显式 security_invoker。stage_content_file / commit_file_publication / order_content_files 全部 SECURITY INVOKER、空 search_path，仅 service_role 可执行；应用入口逐次验证同源和 owner。文件夹附件先校验后写公开图片桶，待发布 Markdown 只存 owner-only 修订表。

## 函数与授权加固

vector 位于 extensions；match_chunks 的参数类型与距离运算符显式限定 extensions。set_updated_at 固定空 search_path；is_owner 使用空 search_path 和 public.profiles。handle_new_user / set_updated_at / Dashboard rls_auto_enable 撤销会话与 service_role 的直接 EXECUTE，已有触发器继续工作。

安装与专用升级均先撤销 PUBLIC / anon / authenticated / service_role 的隐式表、序列、函数授权，再恢复维护源的明确授权；新装基线与完整 V1 升级同时撤销未来新表的默认 Data API 授权。匿名及登录角色不获得 TRUNCATE / TRIGGER 等维护权限。逻辑备份恢复到另一个 Supabase 项目后，先执行 `supabase/restore-hardening.sql` 再跑 `supabase/verify.sql`：目标平台可能给新建表不同的默认授权，单靠 dump 的 `GRANT` 语句不能保证来源 ACL 被精确复制。app_schema_version 启用 RLS，仅 service_role SELECT，API 角色不能改写版本。

is_owner 是 RLS 避免 profiles 递归所需的受控布尔函数，匿名调用只判断当前 Auth 身份，不返回用户信息；client_respond_booking、manage_booking、set_display_name 是具有身份 / 当事人检查的已登录事务入口。其 SECURITY DEFINER Advisor 提示须由独立审查确认，不能为消除提示直接禁用业务或批量改权限。泄露密码保护属于 Dashboard Auth 设置，部署者按当前 Auth 设置核对。

## 阅读、会话与支付权威

维护源 `migrations/20260928155549_security_review_payment_and_visibility.sql`：父专辑生命周期进入文章 RLS，正文 / chunk 子查询继承该闸门；API owner 的状态转移与 paused_at 由触发器保护。原始会话始终私有，客户端不可 INSERT；conversation_publications 独立保存站主编辑的公开稿，显式 RLS 和角色授权。review_conversation 为 authenticated / owner 的 SECURITY INVOKER 事务入口。

create_pending_order / settle_payment 仅 service_role EXECUTE；前者事务内复核售价、资格并复用同价 pending，后者先验金额 / 状态 / 事件归属，以平台流水统一去重；两者使用事务锁防竞争。不得把数据库权限正确当作已修复旧应用的签名解析或共享缓存问题。边界见[安全摘要](../development/security-review.md)。

## 导出快照

`export_site_snapshot(p_include_media => true)` 是 SQL STABLE 的服务端导出入口，原无参数重载保持旧字段集合。为读取 Auth 用户资料采用 SECURITY DEFINER，固定空 search_path、完全限定表名，撤销 PUBLIC / anon / authenticated（含 owner 会话）的 EXECUTE，仅 service_role 可调用。HTTP `/admin/export` 必须先验证 owner。导出使用固定应用表与素材目录及 Auth 资料字段白名单，排除 site_secrets、media_uploads 和 Auth 密码令牌；不存在调用方指定任意表或 SQL 的参数。

同一调用快照包含应用表与 Auth 资料；接口不存在或结构不符时拒绝，不降级到多请求非原子导出。`verify.sql` 第 27 项检查执行权限、STABLE 与 search_path；恢复脚本在函数存在时重置其授权。升级步骤与并发证据见[导出一致性](../development/export-consistency.md)。这不替代托管 REST 多身份验证及独立安全复核。
