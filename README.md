# 万有AI

万有AI 是面向一人公司（OPC）的开源站点系统。一个部署对应一个站主，将内容、订阅、服务履约、活动与站主分身放在自己的站点中，并提供 `/card.json` 与 `/llms.txt` 供机器读取。

[部署指南](docs/deployment/guide.md) · [在线使用指南](https://www.wanyou.ai/handbooks/getting-started) · [版本与插件下载](https://github.com/wanyoudayou/wanyouai/releases) · [文档索引](docs/README.md) · [贡献指南](CONTRIBUTING.md) · [安全反馈](SECURITY.md) · [变更记录](CHANGELOG.md)

## 功能

- 博客、手册与活动内容，以及独立 Skill 介绍和私有版本包；公开、注册、订阅与已购权限，服务端验权与数据库 RLS 双重保护。
- Markdown 工作台、文件夹导入、匿名预览与待发布修订；统一图片素材库，正文、封面、横幅与名片共用选图。
- 订阅、专辑、单篇与活动票在线收款；订单核对、权益开通与事务邮件。
- 服务询价、报价确认、检查点、交付验收和交易锚定评价；服务付款在线下完成。
- 活动报名、二维码核销、纪要权限和名单导出。
- 可配置名片、首页、自定义页面与站主分身；未启用的可选能力如实显示关闭或未配置。
- 内容与业务数据导出，供阅读编辑和统计对账；事故恢复使用数据库与 Storage 备份。

技术栈：Next.js App Router、React 19、TypeScript、Tailwind CSS 4、shadcn/ui、Supabase Postgres/Auth/Storage；默认部署到 Vercel。

## 快速部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwanyoudayou%2Fwanyouai&env=SITE_URL,NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,PUBLISH_TOKEN,OWNER_EMAIL&envDescription=%E5%BF%85%E5%A1%AB%E5%8F%98%E9%87%8F%E8%AF%B4%E6%98%8E%E8%A7%81%20docs%2Fcontracts%2Fenvironment.md&envLink=https%3A%2F%2Fgithub.com%2Fwanyoudayou%2Fwanyouai%2Fblob%2Fmain%2Fdocs%2Fcontracts%2Fenvironment.md&project-name=wanyou-site)

使用上方按钮创建自己的 GitHub 与 Vercel 项目，或在 Vercel 导入自己的 Git 仓库。Supabase 数据库需要单独创建和初始化，完整步骤见[部署指南](docs/deployment/guide.md)。

1. 创建自己的全新 Supabase 项目，完成下面的数据库初始化、安全设置与图片桶配置。
2. 按[部署指南的参数获取与导入步骤](docs/deployment/guide.md#2-supabase-项目创建与初始化)填写本机 `.env.local`：六项基础变量为 `SITE_URL`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`PUBLISH_TOKEN`、`OWNER_EMAIL`。删除未启用的可选空值行，在 Vercel 导入仓库的 **Environment Variables → Import .env** 批量导入，核对 **Production** 作用域；指南列有推荐 **Config / Secret** 类型，全部导入为 Secret 也可保留。文件不提交 Git。
3. 从自己的 `main` 部署，核对 **Ready / Production / Source** 与预期提交，并从 Domains 复制固定 Production 根地址。正式上线推荐先绑定自有网站域名，再配置登录；确认 `SITE_URL` 与最终地址一致，有修改时重新部署。
4. 取得真实网站地址后，再在 Supabase Authentication 的 URL Configuration 中设置同一 Site URL，加入 `${SITE_URL}/auth/callback` 和 `${SITE_URL}/login/callback`。按[Resend 邮箱验证码登录指南](docs/deployment/email-login.md)验证自有发件域名，**先启用并保存 Supabase 自定义 SMTP，再编辑两份登录邮件模板**；新建 Free 项目在默认 SMTP 下不可编辑模板。发件域名可与网站域名不同。
5. 用 `OWNER_EMAIL` 指定的邮箱访问 `/admin`，通过验证码或邮件链接登录并一次性认领站主。进入 `/admin/setup`，按业务分组检查配置、展开“如何验收”，完成名片与首次发布。收款、事务邮件、分身和人机验证的从零配置及人工检查见[部署指南第 6 节](docs/deployment/guide.md#6-首次设置与功能检查)。

首次安装使用 `main → Production`；后续可在其他分支的 Preview 验证，再合并回 `main` 上线。Preview 使用独立测试项目、变量与回调，数据不会随合并复制到正式库；具体设置和手动切换见[分支与部署环境](docs/deployment/guide.md#34-部署分支preview-与-production)。验收公开访问使用固定 Production 域名，并在无痕窗口确认不会被 Vercel 登录保护拦截。

## 数据库初始化

仅在**全新、未使用**的 Supabase 项目中，打开 SQL Editor，依次完整执行：

```text
supabase/install.sql
supabase/verify.sql
```

SQL 安装生成空白站点，不预设站主或价格。首次认领站主后，`/admin/setup` 默认勾选“载入示例内容”，可导入八篇免费使用指南与可编辑收费方案页，也可取消后从空站开始。指南的安装、配置与维护章节由同一份部署文档生成，导入后可自行编辑，代码升级不覆盖站主修改；[来源说明](content/starter/README.md)列出章节与维护位置。执行 `verify.sql` 后，检查返回结果，每行 `passed` 都必须为 `true`；出现 `false` 或 SQL 错误时停止部署并排查。版本与 SHA-256 见[发布清单](supabase/release-manifest.json)。支持 PostgreSQL 17+。

已有实例先备份，再按[数据库安装与升级](supabase/README.md)识别版本、应用缺失迁移；**不能重跑 install.sql**。支付升级需停收款并核对待付单，分身配额升级需排空旧请求。SQL Editor 安装不会建立 CLI 历史，未对齐前不能直接 `db push`。`supabase/legacy/` 仅供旧版升级与等价回放，新装不执行其中脚本。

图片使用公开桶 `media` 与私有暂存桶 `media-uploads`。按[部署指南](docs/deployment/guide.md#24-配置图片存储)手动创建，两个桶均开启文件大小与 MIME 类型限制，上限为 10 MiB；公开桶允许 PNG/JPEG/WebP/GIF，私有暂存桶额外允许 SVG。原图直传私有暂存桶，服务端校验后才写入公开桶；公开图片中不放受限正文或私密资料。

手动配置无需命令。需要自动配置时，按[可选命令工具说明](docs/contracts/media-library.md#可选使用命令工具配置桶)准备本机依赖与环境变量。旧图登记和暂存清理也见素材库说明。

## Supabase 安全配置

创建 Supabase 项目时，在 **Security** 区域选择：

```text
Enable Data API                  ON
Automatically expose new tables  OFF
Enable automatic RLS             ON
```

已有项目可在 Dashboard → Integrations → Data API 复核接口与自动暴露设置。部分 Dashboard 没有“自动 RLS”开关；按[安全配置契约](docs/contracts/supabase-security.md)只读确认 `ensure_rls` 事件触发器启用。安装 SQL 显式启用应用表 RLS，verify 逐表校验。

登录邮件由 **Supabase Auth / SMTP** 发送，与应用的 `RESEND_API_KEY` 分开配置。默认 Auth SMTP 只向组织成员发信，不能用于公开生产登录。[邮箱验证码登录指南](docs/deployment/email-login.md)提供 Resend 域名与密钥获取、SMTP 参数逐项示例、可复制的 HTML 模板和实际登录验证步骤；首次与再次登录的邮件模板均须保留 `{{ .Token }}` 和 `{{ .ConfirmationURL }}`。

## 按需开启

| 功能 | 配置与验收入口 |
|---|---|
| 在线收款 | zpay 三项服务端变量 + 后台收款开关和渠道；[支付契约](docs/contracts/payment-api.md)、[查单补漏调度](docs/operations/payment-reconcile-scheduler.md) |
| 权益事务邮件 | `RESEND_API_KEY` + `EMAIL_FROM`；每分钟运行邮件队列，[邮件运维](docs/operations/payment-mail-outbox.md)、[Supabase 调度步骤](docs/operations/mail-scheduler.md) |
| 站主分身 | 在 `/admin/ai` 配置生成与向量连接、知识库、提示词和额度，完成索引后由站主确认启用；匿名人机校验在 `/admin/security` 配置；[配置契约](docs/contracts/environment.md)与[配额规则](docs/development/avatar-quota.md) |
| 自定义页面与品牌 | 后台“站主名片”“独立页面”“首页与导航”使用素材库选图；也可使用自己维护的 HTTPS 或站内图片地址 |
| 导出与恢复 | 后台导出 Markdown/CSV/配置供复用；[导出用途](docs/operations/content-export.md)与[备份恢复](docs/operations/backup-and-restore.md) |

zpay 是易支付兼容的四方支付通道，存在资金冻结与损失风险，开通由站主自行评估。代码不托管资金。配置后应实测付款、权益、邮件和重复回调，并完成支付查单与邮件调度；配置齐全不等于闭环验收完成。

分身回复带“AI 生成 · 仅供参考 · 合作请转人工”。生成失败或配额用尽时降级检索，未授权正文不能进入上下文。原始会话保持私有；站主另写公开稿后才进入公开检索。

## 内容与导航

手册使用 `/handbooks`，复用章节、公开介绍、按专辑购买和订阅权益。专辑是内容集合，包含手册和活动；旧 `/collections` 地址自动转到手册。站主在专辑设置中选择是否加入侧栏及名称、顺序；独立页面同样支持导航位置。新装示例的“收费方案”位于 `/p/pricing`，其中实时方案组件读取当前价格与收款配置，不提供虚构价格或未启用的购买动作。示例导入后归站主管理，升级不会覆盖修改。

首页横幅可分别配置浅色版与深色版，每版留空时使用对应的内置背景，文字与控件自动跟随主题。主题默认跟随系统，目录底部的单个 pill 按“跟随系统 → 浅色模式 → 深色模式”循环切换并记住偏好。桌面使用三栏，平板使用图标栏，手机使用底部导航；后台按内容、业务、设置与维护分组。

## 内容发布

站主从 `/admin/content` 新建或导入 Markdown，编辑后查看匿名预览。`<!-- paywall -->` 是公开预览切点，编辑器快捷键为 `⌘/Ctrl + Shift + P`。只有确认发布后才改变线上版本；工作台草稿保存在页面内存，刷新前请下载草稿。

手册和活动从专辑详情导入文件夹，只读取根目录 Markdown 并放入专辑根目录；子目录、图片与其他文件忽略。每批最多 500 篇 / 100 MiB。需要的图片可在编辑器上传或从素材库插入；导入允许先保存缺图草稿，发布前须补齐引用。审核时可一次发布全部或选中的章节，新专辑可同时绑定公开 README 并上架。线上已有文稿不会因本地缺失而被删除。

内容状态为草稿 → 发布 ⇄ 暂停 → 归档。暂停表示停售不停读，并向直接购买者发停售通知；暂停满三个月才可归档，归档停止阅读且不可恢复。发布 API 与工作台共用校验、事务和幂等规则，详见[发布接口](docs/contracts/publish-api.md)。

## Skill 与 Obsidian

Skill 使用独立介绍页和私有版本包，支持授权下载、限时安装说明和可选的网页文本对话。包内脚本只供下载，不在网站执行；配置步骤见 [Skill 发布与使用](docs/deployment/skills.md)。

桌面 Obsidian 插件“OPC手册管理器”可批量载入 Vault 中的手册文件夹，只读取根目录 Markdown 及实际引用的图片，支持共享附件、左右比对和中断恢复。上传与同步均保存为线上草稿，权限、价格和公开发布在网页后台完成；全部相同时提示无需上传。专用凭据仅允许手册草稿及必要图片操作。安装与同步见 [Obsidian 手册发布](docs/deployment/obsidian.md)。

直接下载：[Obsidian 插件安装包](releases/obsidian/wanyou-handbooks.zip) · [SHA-256 校验文件](releases/obsidian/wanyou-handbooks.zip.sha256)。源码包也包含这两份文件，无需自行编译插件。

## 本地开发与检查

```bash
cp .env.example .env.local
npm ci
npm run doctor
npm run dev
```

打开 <http://localhost:3000>；本地地址、`SITE_URL` 和 Auth 回调须一致。不要提交真实环境文件、一次性登录链接或会话 cookie。Next.js 按文件优先级加载环境变量，避免保留意外覆盖 `.env.local` 的环境文件。

提交前执行：

```bash
npm run contracts
npm run docs:check
npm run lint
npm run typecheck
npm run build
```

[回归测试说明](tests/README.md)列出权限、发布、后台、分身与配置检查；[真实 PostgreSQL 并发验收](docs/development/database-concurrency.md)覆盖独立连接和事务恢复，CI 单独运行。一次性记录与本地归档不进入版本库、构建或部署包。

`supabase/tests/rls-fixtures.sql` 用于开发测试：创建测试账户、模拟权益并修改测试配置，以验证权限矩阵。它只在独立测试库使用，不属于网站部署流程。

## 许可证与素材

代码及内置的双色 Hero 矢量背景采用 [MIT](LICENSE)。第三方组件与素材见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。站主自行上传的图片由站主按其适用许可管理。
