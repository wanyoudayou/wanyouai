# 环境变量契约

本文件与 [配置模板](../../.env.example)是变量定义的唯一来源。真实 `.env*` 不进入 Git；平台导入时省略未启用的空值变量。

## 填写前先区分三种来源

- **从自己的平台项目复制**：Supabase URL/密钥、支付商户信息、Resend API Key、模型密钥、Turnstile 密钥；不能使用其他部署者的值。
- **自己确定或生成**：站点地址、站主邮箱、桶名称；`PUBLISH_TOKEN` 和 `CRON_SECRET` 在自己的终端分别运行 `openssl rand -hex 32`，每次得到一整行 64 位十六进制随机值。分别保存，不抄命令本身，不加 `Bearer`。
- **在管理页面配置**：Supabase Auth SMTP/回调，以及后台的模型、收款与匿名提问开关。这些不是新增 `.env` 变量，填完环境变量也不会自动完成它们。

本地先在项目根目录运行 `cp .env.example .env.local`，只编辑 `.env.local`。`your-...`、`replace-...`、`example.com` 均为占位值。先填下面六项基础配置，再按需要配置其他组；不用的可选项删除整行。

`.env.local` 会被本机 Next.js、`npm run doctor` 和 `npm run storage:setup` 实际读取。采用 Vercel 部署时，该文件用于本机保存待填写／导入的值，同时供本地工具使用；它不会通过 Git 上传，也不会自动同步到 Vercel。线上配置以 Vercel 对应环境保存并用于该次部署的变量为准，单独修改本机文件不会改变线上值。

首次在 Vercel 导入仓库时，展开 **Environment Variables → Import .env**，选择填好并删除可选空值行的 `.env.local`，批量导入后核对变量清单、Type 及 Production 作用域；文件不提交 Git。若该界面只提供粘贴提示，将 `.env` 全文粘贴到 Key / Name，面板会解析多条变量。具体步骤见[部署指南](../deployment/guide.md#32-导入-envlocal在-import-repository-配置页完成)。

文件使用正常 `.env` 语法；解析后，或手动添加时，**Key 为变量名，Value 为原值**，不含 `KEY=`、包裹引号或额外的 `Bearer`。项目设置的 **Environments → Production → Environment Variables** 管理线上值；Preview 保存独立测试配置，不共享生产 Supabase 密钥。修改后重新部署对应环境，`NEXT_PUBLIC_` 在构建时写入浏览器代码，旧部署不会随变量编辑而改变。环境不会自动复制数据库，分支与上线方式见[部署环境说明](../deployment/guide.md#34-部署分支preview-与-production)。参见 [Vercel 环境变量](https://vercel.com/docs/environment-variables)。

## Vercel Type：Config 与 Secret

下面各表的 **Type** 是 Vercel 表单中的类型：**Config** 用于地址、名称、公开标识等配置，保存后项目有权限的成员仍可查看；**Secret** 用于私有密钥、令牌和秘密回报地址，保存后不能回显，原值须自行保管。规则见 [Vercel Config / Secret](https://vercel.com/docs/environment-variables/sensitive-environment-variables)。

`.env.local` 只记录变量名和值，不携带 Type；各表列的是推荐分类。整批导入后若全部为 Secret，不影响应用读取，可以保持现状继续部署，无需拆分导入或删除重建。非敏感值使用 Config 是为了便于日后查看和核对；私有密钥使用 Secret。Production / Preview 是另一项作用域设置，两种 Type 都须选择正确环境。

变量名以 `NEXT_PUBLIC_` 开头，表示该值可供访客浏览器中的网页代码使用，应当视为公开信息；Vercel 的 Secret 类型不会改变这一点。Config / Secret 决定的是在 Vercel 管理界面能否查看保存后的原值，不是网页代码是否公开使用它。Supabase Publishable / anon key 可以用于 `NEXT_PUBLIC_SUPABASE_ANON_KEY`，推荐 Config；私有 Secret / service_role key 只填 `SUPABASE_SERVICE_ROLE_KEY`，推荐 Secret。按模板保留变量名，不给私有密钥变量增加 `NEXT_PUBLIC_` 前缀。

新部署推荐使用 Supabase Publishable key（`sb_publishable_` 开头）和 Secret key（`sb_secret_` 开头），本项目已兼容。Legacy 区域的 `anon` / `service_role` 是供已有配置迁移的密钥格式，与 Supabase 项目创建时间无关。Vercel 的 Secret 类型不会把公钥转换为服务端密钥；两个 Supabase 密钥变量不能重复填写同一个公钥。

## 基础部署

| 变量 | Type | 获取位置与填写方法 | 作用域与边界 |
|---|---|---|---|
| `SITE_URL` | Config | 本地填 `http://localhost:3000`；线上在 Vercel 项目 **Overview / Production Deployment → Domains** 复制固定域名并补齐 `https://`，如 `https://my-site.vercel.app`；自定义域名以实际绑定地址为准 | 服务端；无路径、查询、片段和尾斜杠。不用每次构建变化的部署地址，也不填 Supabase URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Config | 在 Supabase Dashboard 选择本次为本站创建的 Supabase 项目 → **Connect**，复制 **Project URL**，形如 `https://<项目ref>.supabase.co` | 浏览器/服务端；不是 Dashboard 地址、PostgreSQL 连接串或 Auth 的 Site URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Config | 打开 `NEXT_PUBLIC_SUPABASE_URL` 所属的 Supabase 项目 → **Settings → API Keys**，推荐复制 **Publishable key**（`sb_publishable_…`）；兼容已有 Legacy **anon** 密钥 | 浏览器/服务端；变量名保留不变，填写完整密钥原值，数据访问仍受 RLS 约束 |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | 打开 `NEXT_PUBLIC_SUPABASE_URL` 所属的 Supabase 项目 → **Settings → API Keys**，推荐从 **Secret keys** 区域复制或创建 **Secret key**（`sb_secret_…`）；兼容已有 Legacy **service_role** 密钥 | 仅服务端；绕过 RLS。不是数据库密码、项目 ref、账号访问令牌，也不能填 Publishable/anon key |
| `PUBLISH_TOKEN` | Secret | 自己运行 `openssl rand -hex 32`，把输出的一整行填入并保存到密码管理器 | 仅服务端；至少 32 字节随机值。发布接口使用 `Authorization: Bearer <原值>`，也兼容调用维护任务 |
| `OWNER_EMAIL` | Config | 自行指定确实能收信的站主登录邮箱；首次访问 `/admin` 时使用此邮箱验证 | 仅服务端；不是 no-reply 发件地址，不要求与 Supabase 账号邮箱相同。已有站主可不设，改值不转移所有权 |

两项 Supabase 密钥都从 **`NEXT_PUBLIC_SUPABASE_URL` 指向的 Supabase 项目**取得；URL 中的 `<项目ref>` 可用于核对项目。每项密钥按自己的用途选取，不按项目创建时间选择。Supabase 已宣布弃用 Legacy 密钥，应按下方步骤迁移；时间安排以 [Supabase API Keys](https://supabase.com/docs/guides/getting-started/api-keys) 公告为准。客户端变量绝不能填 Secret/service_role key。只复制密钥原值，不加 `Bearer`。

若仍用 Supabase 默认 SMTP，`OWNER_EMAIL` 还必须是项目组织成员的收件邮箱；这只能用于受限测试。面向普通用户开放登录前完成下方自定义 SMTP 配置。

新装先完成 Vercel Production 部署；正式上线推荐先绑定自有网站域名，确认实际固定地址后再配置 Supabase Auth。首次构建可按 Project Name 预填 `SITE_URL`，Ready 后以 Domains 显示的固定地址核对；不同则修正 Vercel 值并重新部署，再配置登录。网站暂用默认 Vercel 地址也能运行；按本指南使用 Resend 时，验证自有发件域名仍是发信前置，见[域名准备](../deployment/guide.md#4-配置自有域名推荐)。

已运行的网站更换地址时，先在 Supabase Redirect URLs 增加新域名的两条精确回调，再将 Vercel `SITE_URL` 与 Supabase Site URL 替换为新根地址并重新部署；验证新域名登录、结束旧地址的登录用途及待完成流程后，删除不用的旧回调。Site URL 是单个主地址，Redirect URLs 是白名单，步骤见[域名切换](../deployment/guide.md#后续改用自有域名)。Resend 发件域及凭据与网站地址独立，发件域不变时无需为站点换址重新申请。运行本机网站时，本地端口与实际浏览器地址一致。`npm run doctor` 检查配置形态而不输出值；已有实例用 `--existing-site`，机器读取用 `--json`。

### 从 Legacy 密钥迁移到新版

1. 打开 `NEXT_PUBLIC_SUPABASE_URL` 所属的 Supabase 项目 → **Settings → API Keys → Publishable and secret API keys**。复制 Publishable key，并复制或创建 Secret key；新增这些密钥不会自动停用 Legacy 密钥。
2. 将本机 `.env.local` 与 Vercel 目标环境的 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 改为 `sb_publishable_…`，`SUPABASE_SERVICE_ROLE_KEY` 改为 `sb_secret_…`。已经使用新版的项保持原值，变量名不变；Preview 使用它自己测试项目的密钥。
3. 重新部署该环境，验证登录、后台部署检查、素材上传和内容发布。数据库结构、现有站主、用户与权益保持不变，无需重新安装 SQL 或认领站主。
4. 核对其他部署、维护脚本、外部集成与可用回滚版本均已使用新版，再在 Supabase API Keys 页面停用 Legacy 密钥。迁移期间两套密钥可以并存。完整注意事项见 [Supabase 密钥迁移指南](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)。

## 图片与文件存储

| 变量 | Type | 默认值 | 规则 |
|---|---|---|---|
| `SUPABASE_STORAGE_MEDIA_BUCKET` | Config | `media` | 图片公开读、仅服务端写；无图发布不依赖 Storage，带图时桶与对象必须存在 |

在 Supabase 项目 **Storage → Buckets** 查看或创建桶，把 **Name** 原样填入，不能填桶 URL、对象路径或 API Key。图片桶设为公开读，限制单文件 10 MiB、PNG/JPEG/WebP/GIF。素材库另使用固定名称 `media-uploads` 的私有暂存桶，无需增加变量；允许上述格式及 SVG，限制 10 MiB。Skill 使用固定私有桶 `skill-packages`，20 MiB、仅 `application/zip`；不新增环境变量，使用 Skill 前按[操作说明](../deployment/skills.md)配置。

按[部署指南](../deployment/guide.md#24-配置图片存储)手动创建即可，无需终端命令。可选[命令工具](media-library.md#可选使用命令工具配置桶)须先准备本机依赖与 `.env.local`；`npm run storage:setup` 只读检查，`--apply` 才创建或设置上传限制。工具不修改现有公开属性、不管理对象 RLS、不操作对象。

旧维护工具的 `--packages` 参数仍识别 `SUPABASE_STORAGE_PACKAGE_BUCKET`（Config，默认 `packages`），只供已有通用私有桶的维护兼容。它不参与 Skill 交付，新安装不填写此变量。

## 登录邮件

验证码与登录链接在 **Supabase Authentication / SMTP** 配置。应用的 `RESEND_API_KEY` 不控制 Auth 邮件。默认 SMTP 仅向组织成员发送，公开生产登录必须使用自有 SMTP；限制以 [Supabase 官方说明](https://supabase.com/docs/guides/auth/auth-smtp)为准。

在 **Authentication → Emails → SMTP Settings** 启用自定义 SMTP，填写供应商提供的发件人、Host、Port、Username、Password，然后保存。若使用 Resend：Host 为 `smtp.resend.com`，Username 为 `resend`，Password 为 Resend API Key；本项目部署示例使用 465（SSL/TLS），也可按供应商要求选择 587（STARTTLS）。发件域先在 Resend 验证，不使用 Supabase 密钥作为 SMTP 密码。发件地址、密钥获取和全部表单值见[邮箱验证码登录指南](../deployment/email-login.md)。这些配置保存在 Supabase，不新增应用 `SMTP_*` 变量。

新建 Supabase Free 项目使用默认 SMTP 时不能修改 Auth 邮件模板；先启用并保存自定义 SMTP，再打开 Email Templates。Resend 是本指南选用的兼容服务商，不是 Supabase 的唯一要求；只设置 Vercel 的 `RESEND_API_KEY` 不会启用 Auth SMTP 或解锁模板。适用范围见[模板自定义规则](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)。

即使 SMTP 与事务邮件同用 Resend，也要在 Supabase 和 Vercel **分别配置**；可分别创建凭据以便独立轮换。在 Supabase 保存后，实际验证站主和非组织成员邮箱均能收到登录邮件。

Auth Site URL 使用 `SITE_URL`，Redirect URLs 加入 `${SITE_URL}/auth/callback` 与 `${SITE_URL}/login/callback`。**Confirm sign up** 与 **Magic link or OTP** 两个模板都使用 [login.html](../../supabase/templates/login.html)，保留 `{{ .Token }}` 验证码与 `{{ .ConfirmationURL }}` 链接，覆盖首次与再次登录。验证码位数在 Supabase **Authentication → Sign In / Providers → Email → Email OTP length** 设置，建议为 **6**；有效期由同页 **Email OTP expiration** 控制，不能用模板文案替代这两个设置；本应用回调处理 PKCE code，不替换成未实现的 token_hash 路径。

## 事务邮件与调度

| 变量 | Type | 作用域 | 规则 |
|---|---|---|---|
| `RESEND_API_KEY` | Secret | 仅服务端 | Resend 应用事务邮件凭据 |
| `EMAIL_FROM` | Config | 仅服务端 | 已验证发件域地址，例如 `万有AI <no-reply@example.com>`；与 API Key 同配 |
| `CRON_SECRET` | Secret | 仅服务端 | 独立调度令牌；启用 Vercel Cron 时配置，外部调度器也使用此值 |
| `MAIL_SCHEDULER_HEARTBEAT_URL` | Secret | 仅服务端 | 可选独立停运监控 HTTPS 成功回报 URL，按秘密保管；健康 worker 完成后空 POST，回报失败不影响发信 |

这两项检查的是 Vercel 当前部署的应用发信配置。能收到 Supabase 登录验证码不代表此组已配置；Auth SMTP 和应用事务邮件各自保存凭据。完整开通顺序见[部署指南 6.1–6.3](../deployment/guide.md#61-事务邮件权益通知等可选)。

`RESEND_API_KEY` 与 `EMAIL_FROM` 的获取步骤：

1. 登录 **Resend → Domains → Add Domain**，填写自己控制的域名；到域名的 DNS 服务商添加页面要求的记录，等待验证通过。
2. **Resend → API Keys → Create API Key**，选择发送邮件权限，建议限制到上述发件域；创建后立即复制并安全保存完整密钥，之后不能再查看完整值。把原值填到 `RESEND_API_KEY`，不加 `Bearer`。见 [Resend API Keys](https://resend.com/docs/dashboard/api-keys/introduction)。
3. 在已验证域下自行选定发件地址，不必先创建同名收件邮箱。假设验证的是 `example.com`，本地可写 `EMAIL_FROM="我的站点 <no-reply@example.com>"`；在 Vercel 的 Value 中只填 `我的站点 <no-reply@example.com>`，不带外层引号。它不是站主登录邮箱，且 API Key 必须有该域的发信权限。见 [Resend 已验证域与发件地址](https://resend.com/docs/dashboard/domains/introduction)。

### 调度密钥与发布密钥

`CRON_SECRET` 是调用后台维护任务的授权令牌：每日订阅到期提醒、权益邮件队列发送和支付查单补漏都用它验证请求。它不是支付签名密钥，也不负责 Supabase 登录邮件；填写变量不会自动创建分钟任务。

| 令牌 | 发布内容接口 | 三个维护任务接口 |
|---|---|---|
| `PUBLISH_TOKEN` | 可调用 | 兼容接受 |
| `CRON_SECRET` | 不可调用 | 可调用 |

维护任务当前同时接受两个值，即使已配置 `CRON_SECRET`，`PUBLISH_TOKEN` 仍被接受；这是已有外部调度及人工调用可继续使用的兼容路径，不是 Vercel 自动借用另一变量。Vercel 自带 Cron 只读取约定名称 **`CRON_SECRET`**，自动发送 `Authorization: Bearer <CRON_SECRET>`，不会读取 `PUBLISH_TOKEN`。仅配置后者不能让 Vercel Cron 自动通过鉴权。见 [Vercel Cron 鉴权](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)。

新装将两者分别生成、使用不同值：`PUBLISH_TOKEN` 留给发布工具，`CRON_SECRET` 交给调度器。这样调度凭据泄露不会同时获得发布权限，轮换调度密钥也不必修改发布工具；设为同一值会失去这两项隔离效果。

启用调度时，再运行一次 `openssl rand -hex 32`，将新值作为 **Secret** 保存到 Vercel **Production → CRON_SECRET** 并重新部署。使用 Supabase 调度方案时，把**这个 Production 值**保存到 Vault 的 `wanyou_mail_cron_secret`，供邮件与支付查单任务使用；Vault 中只存原值，**不加 Bearer**，发起 HTTP 请求时才在头部添加 `Bearer `。未使用自动任务时可暂不配置，启用到期提醒、邮件发送或查单调度前完成此项。

权益邮件持久入箱，发送还需有效 `SITE_URL` 与每分钟 `/api/cron/mail-outbox`。未配置邮件时任务保留，启用前核对积压；首次发送固定发件人/收件人/正文，API Key 指纹变化或超过安全重试窗口需人工核对。到期提醒与停售通知沿各自审计路径。步骤见[邮件运维](../operations/payment-mail-outbox.md)和[Supabase 调度](../operations/mail-scheduler.md)。独立停运监控是可选增强，不是发信前置。

`MAIL_SCHEDULER_HEARTBEAT_URL` 不用监控时删除或留空；需要时从所选监控服务的检查详情复制 **HTTPS 成功回报 / Ping URL**。该地址不能带账号密码、查询参数或片段，不填写本站 worker URL。它检查任务是否持续运行，不负责访客统计或新订阅通知。

## 在线支付

| 变量 | Type | 作用域 | 规则 |
|---|---|---|---|
| `ZPAY_BASE_URL` | Config | 仅服务端 | 易支付兼容平台根地址，必须 HTTPS |
| `ZPAY_PID` | Config | 仅服务端 | 商户 ID，不作为请求签名密钥 |
| `ZPAY_KEY` | Secret | 仅服务端 | 商户密钥 |

登录你实际签约的支付平台商户后台，在“API 信息 / 接口信息 / 商户信息”等区域取得 `pid` 和通信密钥 `key`，入口名称以平台为准。它们不是支付渠道 ID、支付宝账号、订单号或后台登录密码。

`ZPAY_BASE_URL` 填**同一家支付平台**提供的 HTTPS 接口根地址，来源是商户后台的 API 信息，或其开发文档“页面跳转支付”的请求 URL。以 [ZPAY 官方文档](https://zpayz.cn/doc.html)为例，请求 URL 是 `https://zpayz.cn/submit.php`，使用该平台时填 `ZPAY_BASE_URL=https://zpayz.cn`。`/submit.php` 和 `/api.php` 是支付平台的接口路径，本项目自动追加并调用，不需要部署者创建 PHP 文件。此变量不含接口文件名、订单查询参数或签名，也不填写本站地址、商户后台登录地址或某笔订单的收银台链接。其他兼容平台使用自己的接口根地址和商户凭据，获取过程见[部署指南 6.2](../deployment/guide.md#62-在线支付可选)。

三值同配、后台 `payment_enabled` 开启且渠道可用时才能在线收款。缺失或无效时如实显示“暂未开通在线收款”。每分钟查单补漏另用独立调度器 POST `/api/cron/payment-reconcile`，复用 Production 的 `CRON_SECRET`；Vault URL/密钥是运维凭据，不新增应用变量。见[支付契约](payment-api.md)和[调度步骤](../operations/payment-reconcile-scheduler.md)。

## AI 设置与人机验证

AI 在 `/admin/ai` 管理，不使用日常部署环境变量。共享生成连接支持受信目标的 Chat Completions、Responses、Anthropic Messages；知识库当前使用硅基流动中国区 `BAAI/bge-m3` 原生 1024 维。完整配置操作见[部署指南 6.4–6.6 节](../deployment/guide.md#64-ai-设置与站主分身可选)。

连接 URL、模型、协议与 Key 作为不可变版本保存在私有 `ai_connections`，配置选择、分身指令与开关位于私有 `ai_settings`。两表不授予浏览器 Data API 访问权，即使站主也只通过服务端管理接口读取必要元数据，密钥不回显。保存采用同事务版本检查；更改目标须重新提供对应凭据。仅同一硅基流动生成目标可显式复用向量 Key，不自动跨供应商借用。

旧 `AVATAR_BASE_URL`、`EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL` 和旧数据库分身配置只供后台显式迁入。迁入后完成检查和索引验收，确认后可从 Vercel 和本机记录删除旧变量；应用不会静默使用它们。新装不填写这四项。

分身必须同时满足开关、已验证生成连接和活动知识库就绪；无命中或只有未解锁正文时不生成。页面初稿只依赖共享生成连接，不读取分身指令、聊天或知识库，关闭分身不影响它。匿名分身另需开启匿名入口和通过 Turnstile。调用次数按 UTC 日／月限制，缓存不消耗生成次数，查询向量有独立频控；未知结果不自动重试，详见[配额说明](../development/avatar-quota.md)。

### 获取 Turnstile 密钥

进入 **Cloudflare Dashboard → Turnstile → Add widget**，填写名称和 `SITE_URL` 对应的站点主机名，例如 `my-site.vercel.app` 或 `www.example.com`，不带协议、端口或路径；选择 Managed 模式。创建后在本站 `/admin/security` 一次填写同一 widget 的 Site Key 与 Secret Key，启用并保存，无需新增环境变量或重新部署。步骤见 [Cloudflare 官方指南](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)。

Site Key 与开关存于匿名可读的 `site_config.turnstile_config`；Secret Key 存于私有 `site_secrets`，站主保存函数同事务更新两者，并检查配置版本，客户端只收到保存结果。Secret Key 留空保留，更换 Site Key 时须同步对应的 Secret Key。校验同时检查成功标志、固定域名与操作类型，单次验证不自动重试。

旧变量 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`（Config、浏览器可见）与 `TURNSTILE_SECRET_KEY`（Secret、仅服务端）仅供已有实例迁移，须成对配置；新装不填写。数据库字段为 NULL 时才使用旧变量；后台保存后，关闭配置、缺项或读取故障均不回退到环境值。后台可显式迁移旧密钥对，迁移确认后可删除这两个变量。

生产使用自己的 widget 密钥；本地开发按 [Turnstile 测试说明](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)另配。开启人机校验不自动开启分身匿名提问，仍须在分身设置中单独启用。

## 开发测试与安全纪律

`TEST_DATABASE_URL` 只供隔离 PostgreSQL 并发/规模测试，要求 PostgreSQL 17+ / pgvector，地址仅接受 localhost/127.0.0.1/::1。工具创建随机库并在结束后删除；不加载 Supabase env，不指向业务库，不配置到 Vercel。详见[并发测试](../development/database-concurrency.md)。

该值来自**自己启动的一次性本机 PostgreSQL**，格式为 `postgresql://用户名:密码@127.0.0.1:端口/postgres`；账号须有创建/删除测试库权限。不是从 Supabase Connect 复制远程业务库连接串。只部署网站、不运行并发/规模测试时无需填写。

本地复制模板到 `.env.local` 后运行 doctor 和 dev。Next.js 的进程环境优先，其次按运行模式加载 `.env.<mode>.local`、`.env.local`、`.env.<mode>`、`.env`；保留一份明确的本地配置，避免旧覆盖文件改变目标项目。

- 名称以 `NEXT_PUBLIC_` 开头的变量应视为浏览器可见，只填写允许公开的值；私有 API 密钥与令牌只用于服务端／受信本地进程。
- 必填缺失会导致相应服务端能力失败，doctor/后台检查返回固定提示，不承诺应用启动时自动全面验收。
- 可选组部分缺失时禁用能力；后台 `/admin/setup` 共用配置规则并只读核对版本、Storage 与站点配置，不显示变量值、不发测试邮件、不付款。
- Preview 与 Production 应隔离 Supabase 项目、站点地址和密钥，Preview 回调不得写入正式实例。
- 配置检查不能代替 Auth SMTP、RLS、多身份、真实交易、调度和恢复验收。泄露后轮换对应密钥，不把旧值写入文档。
