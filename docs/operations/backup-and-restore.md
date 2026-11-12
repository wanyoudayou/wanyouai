# 备份与恢复演练

本文面向每个独立部署的 OPC。`/admin/export` 提供用于内容留存、继续编辑和业务分析的 ZIP：内容 Markdown、页面 HTML、便读 CSV、清单列明的应用表原始 JSON，以及 Auth 用户资料。`EXPORT-MANIFEST.json` 记录表行数和每个文件的 SHA-256；读取或结构验证失败时不生成部分 ZIP。应用表与 Auth 白名单资料共享单次查询快照。ZIP 不含 Auth 密码 / 令牌、`site_secrets`、临时上传记录、Storage 对象字节及 schema / 序列恢复 SQL，因此**不是灾难恢复备份**。`supabase/install.sql` 只用于空项目首次安装，也不能覆盖已有库作恢复。

依据：[Supabase 数据库备份](https://supabase.com/docs/guides/platform/backups)、[官方 CLI 备份与恢复](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)。执行时再次核对官方文档与 CLI 版本；不同套餐和项目数据库版本的备份能力可能不同。

## 导出边界

应用导出用于可阅读/编辑的内容和可分析的业务数据；没有整包回灌或账号/权益恢复承诺。数据库、Auth、Storage 与外部支付/邮件对账采用下述独立恢复流程。使用方式见[导出用途与验收](content-export.md)。

## 备份范围与保管

| 资产 | 备份 / 恢复方式 | 验收点 |
|---|---|---|
| 应用、Auth、Storage 元数据 | CLI 分别导出 roles、schema、data；在全新 Supabase 项目恢复 | `auth.users` 与 `profiles`、订单、权益、文章、配置的 ID / 行数与抽样摘要一致 |
| CLI 迁移历史 | 单独导出 `supabase_migrations`；按项目实际历史恢复或经审查 repair | 远程历史与本仓库迁移序列一致，之后才允许 `db push` |
| `media` / 私有文件包对象字节 | 用 Storage API 单独下载并向目标上传；保存路径、大小、SHA-256 清单 | 图片可公开读取，私有对象仍须授权，清单无缺失 |
| Auth URL、邮件、Data API、Storage 桶属性、Realtime、扩展、调度和部署环境变量 | 在目标 Dashboard / 托管平台按配置契约重建；密钥重新安全配置 | 实际登录、RLS、邮件 / 支付配置与后台部署检查通过 |
| 外部支付与发信平台记录 | 平台自身留存，不属于本数据库 dump | 恢复时间点之后的支付 / 邮件人工对账，再开放相关入口 |

Supabase 明确说明数据库备份只含 Storage **元数据**，不含对象字节；Free 项目应定期自行导出并异地保管。数据库备份、对象备份及清单应保存在受控位置，加密、限制访问并定期测试可读性，不能提交 Git、放公开桶或夹进部署包。记录时间点、源项目、数据库版本、CLI 版本、文件 SHA-256 和保管位置；记录中不放连接串、密钥、用户数据。预估恢复点目标和可容忍停机时间由每个站主自行设定；未演练前不承诺具体 RPO / RTO。

## 演练前检查

1. 准备**全新、专供恢复的 Supabase 项目**，与源项目分离。确认空库和正确项目 ref；不要在现有运行实例或已有测试数据的项目执行恢复。演练期间不将目标接入公开域名、支付回调或邮件调度。
2. 标准 CLI 路径准备 Docker Desktop、PostgreSQL 客户端 `psql` 与仓库的 Supabase CLI；确认 `docker info`、`psql --version`、`npx supabase --version` 能运行。若 Homebrew `libpq` 已安装但未进入 `PATH`，可执行 `PATH="/opt/homebrew/opt/libpq/bin:$PATH" psql --version`。CLI 实际执行 `db dump` 依赖 Docker；无 Docker 时仅可按下文的受审替代路径执行，不能跳过 Supabase 专用过滤。PostgreSQL 客户端主版本须与来源库兼容，恢复前先看官方步骤。
3. 在 Supabase Dashboard 的 **Connect** 取得各项目连接 host / port / user；网络无 IPv6 时优先 Session pooler。数据库密码只通过安全终端交互或本机凭据管理器输入；不要发给协作者、写进命令行 URL、仓库、日志或工单。Supabase MCP 的 OAuth 不等于 CLI 数据库口令。
4. 核对来源的 `app_schema_version`、`supabase/verify.sql`、扩展（本项目需要 `vector`）、Auth 自定义触发器及 Storage policies。若使用 Vault / 列加密，先按官方加密根密钥迁移说明制定专门步骤；新建项目的密钥不能直接解密来源密文。
5. 暂停会写入目标的应用和外部调度。正式事故恢复还需冻结或记录来源的写入截止时点，避免支付回调和邮件 worker 与旧库同时处理；演练只在隔离测试数据中进行。

## 取得备份

在仓库根目录先完成 `npx supabase login` 和 `npx supabase link --project-ref YOUR_SOURCE_PROJECT_REF`（将占位值换成源项目 ref）；`link` 的数据库口令使用交互提示，不把口令放在命令参数中。下列命令也从仓库根目录运行，输出写到**不属于仓库**的受控目录；`npx supabase` 使用仓库安装的 CLI 版本。每条返回码必须为 0，检查文件非空并计算 SHA-256 后才保管。`db dump` 的细节以当时的[官方命令](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)为准。

```bash
umask 077
mkdir -p /path/to/private-backup
npx supabase db dump --linked --role-only -f /path/to/private-backup/roles.sql
npx supabase db dump --linked -f /path/to/private-backup/schema.sql
npx supabase db dump --linked --data-only --use-copy \
  -x storage.buckets_vectors -x storage.vector_indexes \
  -f /path/to/private-backup/data.sql
npx supabase db dump --linked --schema supabase_migrations \
  -f /path/to/private-backup/history-schema.sql
npx supabase db dump --linked --schema supabase_migrations --data-only --use-copy \
  -f /path/to/private-backup/history-data.sql
shasum -a 256 /path/to/private-backup/*.sql > /path/to/private-backup/SHA256SUMS
```

`supabase_migrations` 在尚未建立 CLI 历史的项目上可能缺失或与代码历史不一致；该步失败或内容有漂移时，应保留错误并先审查来源历史，**不要伪造迁移记录**。导出过程中可能有业务写入，五份 SQL 与对象文件不是自动的同一时间点快照；正式恢复前需安排写入冻结或使用满足一致性要求的备份机制，并记录截止时刻。不要把 `schema.sql`/`data.sql` 与仓库的 `install.sql` 混用。

没有 `supabase_migrations` schema 的来源，历史导出可能返回「no matching schemas」；记录缺失情况，并按[迁移历史衔接](migration-history.md)核对，不创建虚构记录。无 Docker 时，由维护者使用仓库固定版本 CLI 的 `db dump --dry-run` 核对 Supabase 专用过滤脚本，再用匹配来源主版本的 PostgreSQL 客户端导出；真实口令通过安全凭据方式传入。未经 Supabase 过滤的整库 `pg_dump` 可能混入托管 schema 和角色，不能直接作为这套恢复流程的输入。

Storage 另按[官方对象迁移流程](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore#migrating-storage-objects)通过 Storage API 导出原始字节。逐对象记录 bucket、路径、字节数、SHA-256 和可见性；任何下载失败都视为备份不完整。若导出时仍允许上传 / 删除，须在最终冻结窗口补齐差异或重新生成清单。

## 恢复到全新项目

1. 先读[官方恢复步骤](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore#restore-backup-using-cli)，按目标项目预启用必要扩展 / Webhooks。校验备份 SHA-256，确保目标仍是空项目。涉及 Vault / 列加密时先完成官方要求的根密钥迁移；没有明确方案就停止。
2. 使用目标项目的独立数据库口令与 `psql`，按官方顺序在**一个事务**中恢复 `roles.sql`、`schema.sql`、`SET session_replication_role = replica`、`data.sql`，并启用 `ON_ERROR_STOP=1`。官方此设置会暂时禁用触发器；恢复后必须确认连接结束或会话设置复原，重新核对 Auth 创建触发器及全部 RLS。不要在已有应用库上叠加 `install.sql`。
3. 单独审查并恢复 `supabase_migrations` 历史；Dashboard/MCP 执行不会自然建立 CLI 历史，不能仅凭 `app_schema_version` 推断 CLI 历史。检查 `auth.users` 上的 `on_auth_user_created` 等自定义对象、Storage policies / grants 是否需要从本仓库迁移单独补建。官方明确托管 `auth` / `storage` schema 的自定义变更可能不随标准 dump 一同恢复。
4. 在隔离目标执行 [restore-hardening.sql](../../supabase/restore-hardening.sql)，然后运行与恢复结构版本匹配的 verify；完成全部缺失迁移至当前发布清单版本后才能使用当前完整 verify。硬化收口应用角色维护权限、版本表与邮件队列权限、向量 RPC 与未来表默认授权。固定 search_path 逐项对比来源/目标目录、完整 grants，不能只比数量；RLS 不能代替 ACL 校验。
5. 按对象清单用 Storage API 对**原始完整路径**恢复字节；如果数据库恢复已建立同名对象元数据，上传须显式 `upsert`，随后以公开 / 授权请求下载原路径并校验内容哈希。Dashboard 的同名文件自动改名会产生可读副本，却不会修复旧 URL；不能把副本验证当成恢复通过。重新上传可正常改变 `storage.objects` 的更新时间、版本与文件修改时间，不应为追求整行摘要相同直接改写 Storage 内部版本。设置 `media` 公开图片桶与可选私有文件包桶的原有属性 / 限制。不能只恢复 `storage.objects` 元数据；对象路径与内容哈希都要比对。应用中的旧绝对 Supabase URL、公开图片 URL 和签名链接若含源项目域名，需要审查 / 更新；签名链接应重签。
6. 按[环境变量契约](../contracts/environment.md)和[安全配置](../contracts/supabase-security.md)在新项目重建 Auth Site URL / Redirect URLs、SMTP、Data API 开关、Storage 权限、环境密钥、Realtime 及调度。先保持在线支付、回调和事务邮件 worker 关闭，直至外部平台对账与新项目回归通过；不要让源、目标两个 worker 同时处理同一业务。恢复会原样复制既有订单的 `merchant_order_no`，随机编号只隔离后来独立创建的新订单；克隆库不能与源库同时接入同一商户的真实支付、回调或补漏。灾备接管须先停用源站收款和结算入口，核对恢复点之后的交易，再由唯一目标接管；演练目标保持支付关闭，不能把“编号随机”当作克隆订单隔离。

历史绝对媒体 URL 需要逐项盘点，保留版本、快照与幂等输入；不能全库字符串替换。新发布使用站内 /media/{slug}/{hash}.{ext}，切换项目须重新构建。精确映射操作见[媒体迁移](media-relocation.md)。

对于 PostgreSQL 报角色所有权 / grant 错误，应停在失败事务并逐项比对官方故障说明；禁止为“让脚本跑通”而整体关闭 RLS 或对 `anon` / `authenticated` 放宽授权。恢复到不同 Supabase 项目通常改变 API key 和 URL；应用环境变量须切到目标并重新部署，不能复用源项目密钥。

### 托管隔离应用复核

数据库与 Storage 恢复后，先把目标作为**独立 Preview** 接入应用，保持原 Production 不变。Vercel 支持[按 Git 分支设置 Preview 环境变量](https://vercel.com/docs/environment-variables)：目标项目的 URL、anon key、service-role key 必须作为一组配置到同一 Preview 分支，连同该预览域名的 `SITE_URL` 和独立 `PUBLISH_TOKEN`；不要混用来源项目的 key。用[分支引用创建部署](https://vercel.com/docs/git#creating-a-deployment-from-a-git-reference)时，以最终详情的 Environment、Source SHA 和 Ready 状态为准。若首次部署后才取得精确预览域名，修正 `SITE_URL` 并重新部署，再把该域名的 `/auth/callback` 与 `/login/callback` 加入目标 Supabase Auth Redirect URLs。

在这个 Preview 逐项核对匿名首页 / 付费墙、站主与普通用户登录、原路径媒体、后台部署检查、RLS / GRANT 验证以及站主 ZIP 完整性。记录部署 ID、SHA、目标数据库版本、对象哈希、HTTP 状态与错误日志，不记录密钥、Cookie、个人资料或正文。`vercel.json` 的 cron 仅用于 [Production 部署](https://vercel.com/docs/project-configuration/vercel-json#crons)，Preview 通过不能算调度恢复；外部支付、Resend 与待处理任务须先人工对账，再逐项启用，避免来源和目标同时处理同一笔交易或邮件。

## 放行检查与故障回退

| 闸门 | 预期证据 |
|---|---|
| 数据与版本 | `supabase/verify.sql` 全部 passed；表、Auth 用户、订单、权益、发布版本、站点配置的行数与抽样摘要一致；迁移历史经单独审查 |
| 权限 | 匿名正文、站点密钥、邮件队列不可读；另一用户不能认领站主；四身份 RLS 与真实 REST 检查按[验收矩阵](../contracts/acceptance-matrix.md)执行 |
| 文件 | `media` 样本图片字节哈希一致、URL 可读；私有对象未经授权不可读；清单零缺项 |
| 应用 | 站主 / 普通用户重新登录，公开页与付费墙正确；后台部署检查无错误；支付、邮件、cron 仅在外部对账后分别放行 |
| 切换 | 固定新项目 URL 的隔离应用通过 smoke；记录恢复用时、恢复点和与源库差异，再执行域名 / 回调切换 |

任一闸门失败时保持隔离目标，不切流量、不启动支付或邮件；修复后从全新目标重演，避免在半恢复状态反复覆盖。正式恢复会导致停机或数据回退，选择恢复点前先评估已支付未落库、邮件已发未确认、支付回调重放等差异。Supabase 的原项目原地备份恢复会使项目在恢复期间不可用，不能用它演练到当前运行库。

此流程的验收记录应附：备份文件哈希（不附文件本体）、源 / 目标项目代号、版本、执行时间、逐项结果、失败项与回退决定。只有独立目标的真实恢复和以上闸门全部通过，才把“备份恢复”标为发布通过。

## 站点 ZIP 的查询快照

站点导出使用一次 SQL STABLE RPC，使清单内的应用表和 Auth 白名单资料共享查询快照；并发业务写入不再被多页请求拆成混合状态。该承诺仅适用于清单中 `consistency.mode=single_statement_snapshot` 的 ZIP。它不包含密码、令牌、site_secrets、临时上传记录或 Storage 字节，也不包含还原序列 / schema 的 SQL，不是数据库灾备包；本文件前面的独立 dump / Storage 一致性要求继续适用。实现与并发校验方法见[导出一致性](../development/export-consistency.md)。

站主下载 ZIP 后可运行 `node scripts/check-export-zip.mjs /path/to/wanyou-export.zip`，核对 ZIP CRC、清单中每个文件的大小和 SHA-256、表行数及 Auth 字段白名单；命令只输出非敏感摘要。使用方法和容量边界见[内容与业务数据导出](content-export.md)。
