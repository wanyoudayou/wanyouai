# 部署指南

本文说明如何部署自己的 OPC 站点：初始化数据库与图片存储，部署 Vercel 并确定网站地址，再配置邮箱登录、认领站主并发布内容。收款、事务邮件和分身可按需开通。

[项目 README](../../README.md) 提供快速开始，下面按操作顺序展开。

首次安装先完成第 0、1 节准备，再按 **2 → 3 → 4 → 5 → 6** 操作；没有收款、事务邮件或分身需求时，跳过第 6 节相应的可选配置。

| 名称 | 本文指什么 | 在哪里管理 |
|---|---|---|
| Supabase 项目 | 本站的数据库、账户和图片存储；由 Project URL 中的项目标识区分 | Supabase Dashboard |
| Vercel 项目 | 本站的构建、网站部署、域名和应用环境变量 | Vercel Dashboard |
| 网站 `SITE_URL` | 读者访问的网站根地址，如 `https://www.example.com` | Vercel 环境变量；Supabase Auth 的 Site URL 也填写这个地址 |
| Supabase Project URL | 数据服务地址，如 `https://<项目标识>.supabase.co` | 复制到 `NEXT_PUBLIC_SUPABASE_URL`，不作为网站地址 |
| 发件域名 | 你能管理 DNS、已在 Resend 验证的域，如 `auth.example.com` | Resend 与域名服务商；可与网站使用同一根域名的不同子域 |

以下提到“本站的 Supabase 项目”，均指 **`NEXT_PUBLIC_SUPABASE_URL` 中项目标识对应的那一个项目**。网站地址、Supabase Project URL、Resend 发件域名用途不同，不能互填。

## 0. 部署准备

| 项 | 说明 |
|---|---|
| GitHub 账号 | 保存本站代码，并授权 Vercel 读取对应仓库 |
| Supabase 账号 | <https://supabase.com>；创建项目前以 Dashboard 显示的可用项目额度与费用为准 |
| Vercel 账号 | <https://vercel.com>，建议用 GitHub 登录（免配 token） |
| 自有域名（推荐） | 正式上线推荐先准备域名与 DNS 管理权限，第 4 节完成网站绑定；本指南的 Resend 登录邮件还需验证自有发件域名。网站演练可先用 `*.vercel.app`，但它不能作为自有发件域名 |
| 本机环境 | Node.js ≥ 22（与 CI 一致）、git、一个 IDE |

自查命令：

```bash
node --version   # 期望 v22.x 或更高
git --version
```

## 1. 获取源码与安装工具

可通过 README 的部署按钮创建自己的仓库，也可 fork 后克隆到本机。使用指定版本的源码包时，按下面的方法创建仓库，后续在 Vercel 导入这个仓库即可。

在 GitHub 创建**空白私有仓库**，不要勾选自动生成 README、`.gitignore` 或 License。将以下 ZIP 文件名替换为实际文件名，先核对随包提供的 SHA-256；GitHub 地址替换为刚创建的仓库地址。发布源码包包含顶层 `wanyouai/` 文件夹：

```bash
shasum -a 256 ./wanyouai-source.zip  # 与随包提供的 SHA-256 比对
unzip ./wanyouai-source.zip -d ./wanyou-source
cd ./wanyou-source/wanyouai
git init -b main
git add .
git commit -m "Import wanyouai source"
git remote add origin https://github.com/<YOUR_ACCOUNT>/<YOUR_REPO>.git
git push -u origin main
```

若使用 GitHub 的 Download ZIP，顶层文件夹名称可能不同。进入**同时包含 `README.md`、`package.json` 和 `supabase/` 的目录**后再执行初始化和安装命令；不要在它的外层目录运行 `npm ci`。

进入本机源码根目录，安装后续预检和图片桶配置工具需要的依赖，再复制环境模板：

```bash
npm ci
cp .env.example .env.local
```

**建议从现在起，将 `.env.local` 作为本站环境变量的本机配置底稿：每完成一个基础服务平台的配置，就立即填写模板中对应的变量，不等到 Vercel 部署时再集中回忆和查找。** 部分 API Key 只在创建时完整显示一次，创建后及时记录原值，并在自己的密码管理器中保留安全备份，可避免因找不到密钥而重建、再逐处同步。

- 按模板用途记录完整的一组参数。例如应用事务邮件需要同时填写 `RESEND_API_KEY` 和 `EMAIL_FROM`，不能只记录密钥、遗漏发件人。
- 只填写准备启用的功能；仅在平台后台配置的项目（如 Supabase SMTP、本站后台的分身模型密钥）仍在对应后台保存，不自行增加环境变量。
- 后续修改或轮换变量时，同步更新这份本机底稿和 Vercel 对应环境，保存后重新部署；导入前按已启用的功能逐组核对，避免本机与线上记录不一致。

`.env.local` 是保存在本机的实际配置文件，用途取决于运行位置：

| 使用场景 | 配置从哪里读取 |
|---|---|
| 本机运行预检、图片桶配置工具或网站 | `npm run doctor`、`npm run storage:setup` 和本机 Next.js 会读取 `.env.local`，填写的值会实际用于这些操作 |
| 部署到 Vercel | `.env.local` 用于本机记录待填写／导入的值，并供上述本机工具使用；线上部署使用 Vercel 项目中保存的环境变量，不会自动读取或同步本机文件 |

采用 Vercel 部署时，无需在本机启动网站。到第 3 节时，将已填写的变量添加或导入 Vercel **Production**；修改本机文件不会更新线上配置，修改 Vercel 变量后也须重新部署才生效。数据库密码、服务端密钥、支付资料和登录链接均不提交到 Git。

首页未配置横幅时使用内置的浅色、深色背景；头像和 Logo 留空时显示名称首字标。需要自己的品牌图片时，在「首页与导航」为两种主题从素材库选图，在「站主名片」选择头像和 Logo。

## 2. Supabase 项目创建与初始化

### 2.1 创建项目

1. Supabase Dashboard → **New project**；
2. 选组织、起名（例如 `my-opc-site`）、设置数据库密码并仅在自己的密码管理器保存；不要把密码发给协作者或放进仓库；
3. Region 按实际受众与合规需求选，核对 Dashboard 显示的套餐与费用。

在**创建项目页面**的 **Security** 区域设置以下三项，再提交创建：

| 勾选项 | 应选状态 | 用途 |
|---|---|---|
| **Enable Data API** | **勾选** | 应用使用 Supabase 的数据接口读取与保存数据 |
| **Automatically expose new tables** | **取消勾选** | 新表不自动获得接口访问授权；安装文件显式授予需要的权限 |
| **Enable automatic RLS** | **勾选** | 自动为 `public` 中的新建表启用行级安全，作为额外保护；具体访问规则仍由安装文件设置 |

确认后点击 **Create new project**，等待项目初始化完成。三项设置分别控制数据接口、默认授权和行级安全，不能相互替代。说明见 [Supabase 数据接口安全](https://supabase.com/docs/guides/api/securing-your-api)与[自动启用 RLS](https://supabase.com/blog/supabase-security-2025-retro#automatically-enable-rls-when-tables-are-created)。

**已经创建项目时无需重建**：进入 **Integrations → Data API**，在 **Overview** 确认 `Enable Data API` 开启，在 **Settings** 确认 `Automatically expose new tables` 关闭。如需核对自动 RLS，可在 **SQL Editor** 运行以下只读查询：

```sql
select e.evtname, e.evtenabled, p.proname
from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid
where e.evtname = 'ensure_rls';
```

返回 `ensure_rls / O / rls_auto_enable` 表示平台自动 RLS 触发器已启用。部分项目没有对应开关或触发器；安装文件仍会对每张应用表显式启用 RLS，安装后须确认 `verify.sql` 的 `application_rls_enabled` 为 `true`。

### 2.2 取连接信息（后续填 Vercel）

在 Supabase Dashboard 选择本次为本站创建的 **Supabase 项目**，点击顶部 **Connect**，将 **Project URL** 填入 `NEXT_PUBLIC_SUPABASE_URL`。例如 URL 为 `https://<项目ref>.supabase.co`，后面的两项密钥都从这个 `<项目ref>` 对应的 Supabase 项目取得。

保持选中该 Supabase 项目，进入 **Settings → API Keys**，按下表复制对应密钥：

| 对应环境变量 | 推荐：Publishable / Secret 区域 | 兼容已有配置：Legacy 区域 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Publishable key**（`sb_publishable_…`） | **anon** |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret key**（`sb_secret_…`） | **service_role** |

**新部署使用推荐列的新版密钥**，本项目已支持，不需要修改代码或数据库。Legacy 是兼容的密钥格式，与项目创建时间无关；已有 Legacy 配置按[密钥迁移步骤](../contracts/environment.md#从-legacy-密钥迁移到新版)逐步更换，不作为长期方案。两项环境变量保留既有名称，只替换值。`SUPABASE_SERVICE_ROLE_KEY` **只进服务端环境变量，绝不进浏览器或仓库**。

复制密钥的完整原值，不加 `Bearer`；不要用数据库密码或 Supabase 账号访问令牌代替。密钥类型说明见 [Supabase API Keys](https://supabase.com/docs/guides/getting-started/api-keys)，每项填写示例见[环境变量获取指南](../contracts/environment.md)。

两个密钥使用不同的值。Publishable / anon 公钥不能填入 `SUPABASE_SERVICE_ROLE_KEY`；否则普通邮箱登录可能成功，站主认领仍会失败。Vercel 的 Secret 类型只控制保存后能否查看原值，不会改变 Supabase 密钥的权限。

将这三项填入本机 `.env.local`，再填写 `OWNER_EMAIL` 和自行生成的 `PUBLISH_TOKEN`。`SITE_URL` 在下面创建 Vercel 项目时填写，模板中的 `http://localhost:3000` 供本地开发使用。参数获取方法见 `.env.example` 的逐项注释。未启用功能的可选值保持空白。

### 2.3 按序执行 SQL（SQL Editor 逐个新建查询粘贴执行）

新装要求 PostgreSQL 17 或更高版本。仅在**全新、未使用的项目**中依次完整执行以下文件，每个文件成功后再执行下一个。结构版本与文件摘要见[数据库发布清单](../../supabase/release-manifest.json)。

```text
supabase/install.sql
supabase/verify.sql
```

- install：一次性建立最终结构、权限与中性站点配置；失败整体回滚。检测到既有应用对象会停止，应改走升级路径；
- verify：返回只读验收表，所有 `passed` 必须为 true；出现 false 或 SQL 错误时停止部署并排查；
- 新装不开通支付 / 分身，不设置销售价格，也不创建站主；指定 `OWNER_EMAIL` 完成验证登录后认领；
- 站主认领后可从 `/admin/setup` 载入使用指南与收费方案页，无需额外执行演示 SQL；
- **已有实例**按[数据库升级指南](../operations/database-upgrade.md)操作，不执行新装文件或演示 SQL；切换到 CLI 管理升级前，先按[迁移历史衔接](../operations/migration-history.md)核对实际结构与迁移记录。

后续向 Vercel 导入变量时，省略未启用的空值项。配置来源与本地环境文件加载顺序见[环境契约](../contracts/environment.md)。

### 2.4 配置图片存储

使用 Supabase Dashboard 手动创建两个文件桶即可完成本节，**无需运行命令，也无需 Supabase CLI 或 MCP 登录**。这两个桶须与前面执行安装 SQL 的数据库属于同一个 Supabase 项目。

1. 打开自己的 Supabase 项目 → **Storage → New bucket**，进入 **Create file bucket** 对话框。
2. 先创建 `media`，再打开同一对话框创建 `media-uploads`，分别按下表填写：

| 界面字段 | `media`：已校验的公开图片 | `media-uploads`：原始图片私有暂存 |
|---|---|---|
| **Bucket name** | `media` | `media-uploads`（固定名称） |
| **Public bucket** | **开启** | **关闭** |
| **Restrict file size** | **开启** | **开启** |
| 大小输入框 | 填 `10`，单位选择 **MB** | 填 `10`，单位选择 **MB** |
| **Restrict MIME types** | **开启** | **开启** |
| 允许的 MIME 类型 | 填下面的公开桶清单 | 填下面的私有暂存桶清单 |

应用使用的精确大小上限是 **10 MiB = 10485760 字节**；若页面按字节输入，填写 `10485760`。

`media` 的允许 MIME 类型，复制整行，不加引号；若界面使用标签输入，则逐项添加：

```text
image/png,image/jpeg,image/webp,image/gif
```

`media-uploads` 的允许 MIME 类型：

```text
image/png,image/jpeg,image/webp,image/gif,image/svg+xml
```

MIME 类型填写 `image/jpeg` 等完整名称，不填 `.jpg` 扩展名或 `image/*`。SVG 只进入私有暂存桶，服务端校验并转为 PNG 后写入公开桶，因此公开桶不加入 `image/svg+xml`。

3. 每个桶填完后点击 **Create**。`media` 开启 Public 时出现黄色公开访问提示属于预期：其中图片可被任何人读取；上传、覆盖和删除仍由应用控制。`media-uploads` 保持私有，不添加允许匿名或普通账户任意读写对象的策略。
4. 回到桶列表，确认 `media` 为 **Public**、`media-uploads` 为 **Private**；打开各桶的设置，核对文件大小与 MIME 限制已保存。完成后继续 Vercel 部署，取得网站地址后再配置邮箱登录与回调。

使用上述默认名称时，`SUPABASE_STORAGE_MEDIA_BUCKET` 可省略或填 `media`。若自行更改公开桶名，本机和 Vercel 的该变量都要同步；私有暂存桶名固定为 `media-uploads`，没有另一个桶名变量。只发布文章时使用这两个桶即可；要发布 Skill，再按 [Skill 使用指南](skills.md)配置 `skill-packages` 私有桶。

后续部署完成后，在 `/admin/setup` 检查「图片素材存储」，再从素材库上传一张图片验证实际使用。熟悉终端、希望自动配置桶的部署者可选用[图片素材库中的命令工具](../contracts/media-library.md#可选使用命令工具配置桶)，其中列有完整前置条件；手动创建者可跳过。桶限制的官方说明见 [Supabase 创建桶](https://supabase.com/docs/guides/storage/buckets/creating-buckets#restricting-uploads)。

## 3. Vercel 部署

数据库安装和两个图片桶完成后，先部署网站以取得固定的 Production 地址，再设置 Auth 和登录邮件。首次构建与匿名首页访问不依赖 SMTP；发起登录前须完成后面的邮箱配置。

### 3.1 导入仓库

1. 打开 <https://vercel.com/new> → **Import Git Repository**，选择第 1 节准备的仓库。通过 README 部署按钮已创建 Vercel 项目时，进入该项目继续配置。
2. Framework Preset 自动识别 **Next.js**，Root Directory 保持 `./`，**不要改构建命令**（`package.json` 已指定 webpack 构建）。首次使用自己的 `main` 分支；页面显示 Source / Branch 时核对为 `main`，创建项目后再按 3.4 节核对生产分支设置。
3. 在 **Project Name** 填写自己的 Vercel 项目名，例如 `my-opc-site`。先按 `https://my-opc-site.vercel.app` 预填下面的 `SITE_URL`；最终网址须在部署成功后从 **Domains** 复制确认，名称冲突等情况可能使实际地址不同。

### 3.2 导入 .env.local（在 Import Repository 配置页完成）

留在导入仓库后的项目配置页，先导入已经填写好的本机文件，再点击 **Deploy**，无需逐项重新输入：

1. 在本机编辑源码根目录的 `.env.local`：填好下面六项基础变量，将 `SITE_URL` 改为 3.1 节预填的网站地址，必填项不得保留模板占位值；删除未启用的可选空值行（如 `ZPAY_KEY=`）及开发测试专用变量。使用默认图片桶时，`SUPABASE_STORAGE_MEDIA_BUCKET=media` 可保留。
2. 展开 **Environment Variables**，点击 **Import .env / Import**，选择这份 `.env.local`。Mac 文件选择框可用 `⌘ + Shift + .` 显示隐藏文件。如果该界面只有粘贴提示，复制文件全文粘贴到 **Key / Name** 输入框，面板会拆分成多条变量；不粘贴到单个 Value 中。创建页的粘贴方式见 [Vercel 官方说明](https://community.vercel.com/t/not-able-to-populate-env-variables-with-env-local-file/520/4)。
3. 核对解析后的列表：每行是一个变量，六项基础变量齐全，没有空值或占位值；两项 Supabase 密钥属于 `NEXT_PUBLIC_SUPABASE_URL` 指向的 Supabase 项目。文件中可保留正常 `.env` 引号写法；解析后的 Value 应是原值，不包含包裹引号、`KEY=` 或额外的 `Bearer`。手动补填时也只在 Value 中填写原值。
4. 如有 **Environments** 选项，本次选择 **Production**。本文件含生产凭据，不整组勾选 Preview / Development；若创建页没有作用域选项，首次部署后到 **Settings → Environments → Production → Environment Variables** 核对，移除这些值在 Preview / Development 中的副本，再单独配置测试环境。

下表的 **Type** 是推荐分类：地址、名称和公开标识用 **Config**，私有密钥用 **Secret**。`.env.local` 不携带 Type；若整批导入后全部显示为 Secret，可以保留并继续部署，两种类型都能供构建和服务端读取，无需为分类删除重建或拆成两次导入。区别主要在保存后能否查看原值：Secret 不回显，须自行保管原始配置。Type 与 Production / Preview 作用域是两个独立选项。规则见 [Vercel Config / Secret](https://vercel.com/docs/environment-variables/sensitive-environment-variables)。

下表是首次部署所需的六项基础变量与默认图片桶。可选功能在第 6 节开通时再补入，无需为首次部署填写全部模板：

| 变量 | Type | 值 | 说明 |
|---|---|---|---|
| `SITE_URL` | Config | 按 Project Name 预填，如 `https://my-opc-site.vercel.app` | 必须填写，末尾不带 `/`；部署后核对实际固定地址 |
| `NEXT_PUBLIC_SUPABASE_URL` | Config | 2.2 节 Project URL | 可进浏览器 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Config | 2.2 节 Publishable / Legacy anon key | 可进浏览器；不是服务端密钥 |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | 2.2 节 Secret / Legacy service_role key | **仅服务端** |
| `PUBLISH_TOKEN` | Secret | 自生成随机串（`openssl rand -hex 32`） | 发布工具的授权令牌 |
| `OWNER_EMAIL` | Config | 本站站主邮箱 | 全新部署首次认领只允许这个邮箱；验证码或链接登录前先配置 |
| `SUPABASE_STORAGE_MEDIA_BUCKET` | Config | `media` | 与「配置图片存储」中的桶名一致，使用默认名称时可省 |

**变量名以 `NEXT_PUBLIC_` 开头，表示该值可供访客浏览器中的网页代码使用，应当视为公开信息。** 即使在 Vercel 将它设为 Secret，也不会改变这一点；Secret 只是不在 Vercel 管理界面回显原值，不会把网页需要使用的值隐藏起来。

例如，`NEXT_PUBLIC_SUPABASE_ANON_KEY` 应填可公开的 Supabase Publishable key（`sb_publishable_` 开头）；私有 Secret key（`sb_secret_` 开头）只填在 `SUPABASE_SERVICE_ROLE_KEY`，不能填进前者。按模板保留变量名，不要给私有密钥的变量名加上 `NEXT_PUBLIC_`。机制见 [Next.js 环境变量说明](https://nextjs.org/docs/app/guides/environment-variables#bundling-environment-variables-for-the-browser)，其余变量的推荐 Type 见[环境变量契约](../contracts/environment.md)。


首次部署只需填写六项基础变量和图片桶名。第 6 节按功能说明其余变量如何取得和使用，启用时再批量补填；[环境变量契约](../contracts/environment.md)提供完整格式、Type 和轮换规则。

**Import .env 是把文件中的值保存到 Vercel 的这一次操作**；Vercel 不会持续读取本机文件。文件不需要提交 Git，后续只改本机文件不会更新线上配置；线上值在项目的 Environment Variables 中编辑，保存后重新部署对应环境。`http://localhost:3000` 不作为线上 `SITE_URL`。参见 [Vercel 环境变量](https://vercel.com/docs/environment-variables)。

如需本机配置预检，保存 `.env.local` 后可从源码根目录运行 `npm run doctor`，按输出修正 `error` / `incomplete` 项。该命令只检查本机配置形态，不会替你保存 Vercel 变量，也不验证 Dashboard 设置或外部连通性。

### 3.3 部署并确认固定地址

1. **Deploy**。打开 Vercel 项目 → **Deployments**，确认最新部署详情为 **Ready / Production**，Source 是自己仓库的 `main` 及预期提交。
2. 从项目 **Overview → Production Deployment → Domains** 复制固定站点根地址，如 `https://my-opc-site.vercel.app`。选择网站的固定地址，不使用含提交哈希的临时部署地址或分支 Preview 地址；类型说明见 [Vercel 部署地址](https://vercel.com/docs/deployments/generated-urls)。
3. 与 Vercel Production 的 `SITE_URL` 比对。若不同，在 Vercel 修正 `SITE_URL` 并从 `main` 重新部署，同时更新本机配置记录。
4. 在无痕窗口打开固定 Production 地址，确认首页正常加载、空站显示空态，且不会要求登录 Vercel。邮箱登录在完成第 5 节后测试。

正式上线推荐先完成第 4 节，绑定自有域名后再配置第 5 节的 Auth 回调和登录邮件，减少后续换址操作。暂时只做安装演练时，可用固定 `*.vercel.app` 地址继续；使用 Resend 发信仍需准备并验证自有发件域名。3.4 节用于说明后续更新与预览，不是首次安装的额外步骤。

### 3.4 部署分支、Preview 与 Production

首次安装使用 `main → Production` 即可，不必先建立 Preview。Vercel 新项目的首个部署会成为 Production；后续默认按生产分支区分环境，规则见 [Vercel 部署环境](https://vercel.com/docs/deployments/environments)。

| 环境 | 默认触发方式 | 使用的变量 | 访问入口 |
|---|---|---|---|
| **Production（正式站点）** | 向生产分支 `main` 推送或合并代码 | Production 变量 | 固定 `项目名.vercel.app` 和绑定的正式域名 |
| **Preview（改动预览）** | 向其他分支（如 `feat/update-site`）推送代码或创建 PR | Preview 变量，可为指定分支单独设置 | 分支预览地址或该次部署地址，不替换正式域名 |

项目建立后，打开 **Settings → Environments → Production → Branch Tracking**，确认启用且跟踪 `main`，保存。Preview 默认跟踪 **All unassigned git branches**，即未分配给其他环境的分支。更换生产分支在这里修改；日常上线保持 `main` 不变，将改动合并回 `main`。本机 `git checkout` 或 GitHub 页面切换分支，只是在切换查看／编辑的代码，不会切换线上站点。生产分支设置见 [Vercel Git 部署](https://vercel.com/docs/git#production-branch)。

后续需要先预览再上线时：

1. **准备测试配置**：按第 2 节为另一个测试 Supabase 项目初始化数据库和图片桶。在 **Settings → Environments → Preview → Environment Variables** 保存该测试项目的 URL、anon key、service-role key，以及测试用 `OWNER_EMAIL`、`PUBLISH_TOKEN` 和 Preview 的 `SITE_URL`；可把变量限定到 `feat/update-site` 分支。取得分支固定地址后，核对 `SITE_URL` 并重新部署，在该测试 Supabase 项目追加两条精确 Auth 回调、配置登录邮件。支付、事务邮件等可选功能按测试用途另配，生产凭据不复制到 Preview。
2. **验证改动**：推送该分支，打开生成的 Preview，核对 **Source 分支／提交、Environment = Preview、Ready**，再测试登录与相关功能。Preview 若要求登录 Vercel，属于部署访问保护；它与应用自己的站主／普通用户登录不同。
3. **合并上线**：验证通过后，在 GitHub 创建目标分支为 `main` 的 Pull Request（PR），检查 CI 后合并。Vercel 会用 Production 变量重新构建生产部署；需要数据库升级时，先按版本的[升级说明](../operations/database-upgrade.md)处理正式库，再让依赖新结构的应用上线。
4. **核对正式站点**：在 Overview 的 **Production Deployment** 确认 Source 为预期的 `main` 提交；详情应为 **Ready / Production / Current**，再从固定正式域名复查。**Ready** 只表示该部署可用，较早部署或 Preview 的 Ready 不表示它正在承接正式流量。

Preview 与 Production 的区分不会自动隔离数据：应用使用哪份 Supabase 数据库、Auth 与 Storage，取决于该环境实际保存的 URL 和密钥。合并代码、切换部署或提升部署都不会复制测试内容、用户、订单或执行数据库迁移。

**手动部署与切换**：在 **Deployments → Create Deployment** 填入目标分支或提交，确认 Source 和目标环境后创建；对已有部署点击 **Redeploy** 是重建所选提交，不会合并 Git 分支。若使用 **Promote to Production**，Vercel 会以 Production 变量重新构建 Preview，并将正式域名切到新部署；这不会把代码合并回 `main`，之后推送 `main` 仍会触发正式部署。因此日常更新采用上面的 PR 合并流程。操作区别见 [Vercel 提升部署](https://vercel.com/docs/deployments/promoting-a-deployment)。

## 4. 配置自有域名（推荐）

推荐在配置第 5 节的 Auth 回调和登录邮件前，先确定正式网站地址并完成绑定。网站域名和邮件发件域名用途不同，可以使用同一自有根域名的不同子域：

| 用途 | 示例 | 配置位置与要求 |
|---|---|---|
| 网站访问与登录回跳 | `www.example.com` | 在 Vercel 绑定，确认 HTTPS；推荐作为正式网站主地址 |
| Resend 登录邮件发件 | `auth.example.com`，发件人如 `no-reply@auth.example.com` | 在 Resend 添加域名，并在 DNS 服务商保存验证记录；本指南公开登录发信的前置条件 |

两者无需同名，也不必购买两个根域名。自有网站域名是上线建议，不是应用运行的硬性条件；如果网站暂用 Vercel 默认地址，仍可用自己控制的其他域名发邮件。Resend 要求发件域可由你添加 DNS 验证记录，不能用 Vercel 分配的 `*.vercel.app` 子域代替。依据见 [Resend 域名说明](https://resend.com/docs/dashboard/domains/introduction)。

绑定网站域名：

1. Vercel 项目 → **Settings → Domains → Add**，输入你的域名（如 `www.example.com`）；
2. 到域名服务商，按 Vercel 页面为该域名给出的记录类型、名称和值配置 DNS；
3. 等待 Vercel 签发 HTTPS 证书（通常几分钟）；
4. 将 Vercel **Settings → Environments → Production → Environment Variables** 中的环境变量 `SITE_URL` 和本机 `.env.local` 的同名变量改为 `https://www.example.com`，然后 **Redeploy**。确认新地址可访问后，继续第 5 节，首次填写 Auth 的 Site URL 与两条 Redirect URLs 时直接使用这个域名。
5. 国内受众注意：域名需备案且 Vercel 访问性不稳定时，另行评估地区可达性与部署合规要求，本指南步骤不变、仅平台替换。

已运行的网站日后换域名时，按 5.1 节的「后续改用自有域名」操作，先添加新回调，再切换主地址并验证，最后清理不用的旧回调。已启用 zpay 时，新订单使用新的 `SITE_URL` 生成回调与返回地址；仍有待支付订单时保留旧域名可访问，直到这些订单完成处理。Auth 回调白名单的删除不等于停用旧域名或支付通知接口。

## 5. 邮箱登录与 Auth 回调

前置条件：Vercel Production 已 **Ready**，已选定可访问的固定 HTTPS 根地址，Vercel 的 `SITE_URL` 与它一致。正式上线推荐先按第 4 节完成自有网站域名绑定；按本指南使用 Resend 时，还需准备可验证的自有发件域名。完成本节后再请求登录邮件。

### 5.1 设置 Auth 地址

打开 Supabase 项目 → **Authentication → URL Configuration**。以下以第 4 节绑定的网站 `https://www.example.com` 为例，三处均替换为自己的实际地址；若暂用 Vercel 默认域名，则三处都使用其固定 HTTPS 地址。然后保存：

```text
Site URL:        https://www.example.com
Redirect URLs:   https://www.example.com/auth/callback
                 https://www.example.com/login/callback
```

`/auth/callback` 用于站主，`/login/callback` 用于普通用户。正式站点使用两条精确回调，不使用 `/**` 通配；本地开发或独立 Preview 需要时再单独追加对应地址。规则见 [Supabase Auth 回调说明](https://supabase.com/docs/guides/auth/redirect-urls)。

#### 后续改用自有域名

`Site URL` 是一个默认主地址，`Redirect URLs` 是允许回跳的地址清单。建议切换期间先增加新地址，验证成功后删除不再使用的旧地址：

| 配置项 | 从默认 Vercel 域名改为 `https://www.example.com` 时 |
|---|---|
| Supabase **Site URL** | 替换为 `https://www.example.com`，保留一个主地址 |
| Supabase **Redirect URLs** | 先新增 `https://www.example.com/auth/callback` 和 `https://www.example.com/login/callback`；原 Vercel 两条暂时保留 |
| Vercel Production **SITE_URL** | 替换为 `https://www.example.com`，同步本机记录并重新部署 |

1. 先在 Vercel 绑定自有域名，确认 HTTPS 和页面访问正常。
2. 在 Supabase 保存新域名的两条精确 Redirect URLs，再更新 Site URL 和 Vercel `SITE_URL`，重新部署。
3. 从**新域名**的 `/admin` 与 `/login` 发起登录，分别核对验证码和邮件链接回跳；链接仍在发起请求的同一浏览器打开。
4. 将对外登录入口改为新域名；新域名登录通过，且旧域名不再作为登录入口、此前邮件已按实际 **Email OTP expiration** 过期、没有待完成登录流程后，删除旧 Vercel 域名的两条回调。若确有旧地址兼容用途，可暂留对应精确路径；不用的地址不长期积累，也不扩大成 `*.vercel.app/**`。

本应用以 `SITE_URL` 生成登录回跳，采用一个主登录域名。不同域名的浏览器会话不会因白名单中同时存在两个域名而自动共享；仅保留旧回调也不能保证切换前的邮件链接继续完成登录。切换后从新域名重新请求验证码／链接。机制见 [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)。

### 5.2 配置登录邮件

公开邮箱登录按[Resend 邮箱验证码登录指南](email-login.md)完成以下配置；其中有发件域与密钥获取、逐项参数表、完整 HTML 模板和排查方法：

开始前确认：网站已选定第 5.1 节中的最终地址，且具备自有发件域名的 DNS 管理权限。网站推荐先绑定自有域名；Resend 发件域则必须验证，不能用默认测试发件地址向本站所有用户发送登录邮件。两种域名的关系见第 4 节，Resend 对接前置条件见[官方 SMTP 指南](https://resend.com/docs/send-with-supabase-smtp)。

**新建 Supabase Free 项目使用默认 SMTP 时，Email Templates 不可编辑。先在 Supabase 启用并保存自定义 SMTP，再编辑模板。** 本指南使用 Resend，其他兼容 SMTP 服务也能满足此前置条件，无需仅为模板编辑升级 Supabase。适用范围见[官方规则](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)。

1. 注册并登录 [Resend](https://resend.com)，打开 **Domains → Add Domain**，填写自己控制的发件域，例如 `auth.example.com`。到域名服务商的 DNS 管理页，逐条添加 Resend 给出的类型、名称、值和优先级；返回 Resend 核验，等状态成为 **Verified**。然后在 **API Keys → Create API Key** 创建 **Sending access** 密钥，限定到该域，立即复制完整原值并保管。发件地址可自行选为 `no-reply@auth.example.com`，无需先创建同名收件邮箱。网站可以使用 `www.example.com` 或 Vercel 默认域名，发件域验证一次即可。
2. Supabase **Authentication → Emails → SMTP Settings** 启用自定义 SMTP。Host 填 `smtp.resend.com`，Port number 填 `465`（SSL/TLS），Username 填 `resend`，Password 填完整 Resend API Key（不加 `Bearer`）；Sender email address 使用已验证域下的发件地址，Sender name 填自己的站名。点击 **Save changes**，确认保存成功且 **Enable custom SMTP** 保持开启。
3. **确认自定义 SMTP 已保存后**，在 **Email Templates** 的 **Confirm sign up** 和 **Magic link or OTP** 两处，都粘贴 [login.html](../../supabase/templates/login.html) 的完整内容并保存。保留 `{{ .Token }}` 和 `{{ .ConfirmationURL }}`，分别覆盖新用户首次与已有用户再次登录；不要只修改其中一处。
4. 打开 **Authentication → Sign In / Providers → Auth Providers → Email**（部分界面直接显示 Email），确认 Email 登录启用、允许新用户注册且邮箱验证开启。将 **Email OTP length** 设为 **6** 并保存；这是验证码的数字位数，不是 **Minimum password length**（密码长度），也不是在模板里写“6 位”就会生效。**Email OTP expiration** 另管有效期，单位为秒，例如 `600` 为 10 分钟。在 **Rate Limits** 核对发信限额，Resend 关闭链接跟踪。保存后申请一封新邮件，实际核对位数并完成登录，不使用保存设置前的旧验证码。设置位置与免密登录规则见 [Supabase OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)。

Supabase 默认 SMTP 只向项目组织成员发信，不能用于公开登录。登录邮件不由 Vercel 的 `RESEND_API_KEY` / `EMAIL_FROM` 控制，不依赖应用邮件队列；只设置这些应用变量也不会解锁 Auth 模板。电脑发起登录、手机收信时可直接在电脑输入验证码；邮件链接须在发起登录的同一浏览器及设备打开。各项限制与官方依据见上述邮箱登录指南。

## 6. 首次设置与功能检查

先完成基础站点，再选择需要的业务功能：

1. **认领站主**：访问正式域名的 `/admin`，用 Vercel `OWNER_EMAIL` 指定的邮箱获取新验证码并登录。全新站点首次验证成功后，该邮箱成为唯一站主；以后修改 `OWNER_EMAIL` 不会转移身份。
2. **检查配置与载入示例**：打开「维护 → 部署检查」`/admin/setup`，确认基础变量、数据库版本和图片桶。保留“载入示例内容”可创建收费方案与使用指南；取消则从空站开始。中断可回到本页继续，遇到网址冲突或已编辑内容按提示处理，不覆盖自己的内容。升级不会自动载入示例。
3. **填写名片**：在「站点设置 → 站主名片」填写站名、站主、一句话，以及公开联系邮箱或预约页面（二选一）。服务语言用 `zh-CN`、`en` 等代码。看到保存成功后检查首页、`/card` 和 `/card.json`。
4. **发布与导航**：在「内容管理 → 文章」创建并发布一篇带图 Markdown。图片可上传到素材库或从库中选择；专辑与独立页面可设置侧栏名称和顺序。免费使用指南与收费方案均可编辑、隐藏或归档。

下面的功能均按需启用。不用时省略该组变量并保持后台开关关闭，继续 6.7 节检查基础站点。可以先准备好所有要启用功能的参数，**一次补入 Vercel Production 环境变量、保存并重新部署**，再完成对应后台设置与调度；不必每取得一个参数就重新部署一次。同步更新本机 `.env.local` 记录即可，未启用的空值行不导入。

要发布私有 Skill 包，按 [Skill 发布与使用](skills.md)配置独立私有桶、上传版本并检查授权下载；要从 Obsidian 维护手册，按 [OPC手册管理器](obsidian.md)安装插件并创建专用上传凭据。两项均不新增必填环境变量。

### 6.1 事务邮件：权益通知等（可选）

先区分两条独立的发送链路：

| 邮件 | 凭据保存位置 | 是否需要应用调度 |
|---|---|---|
| 登录验证码／登录链接 | Supabase 的 SMTP Settings | 不需要 |
| 付款后的权益通知、停售通知、订阅到期提醒 | Vercel 的 `RESEND_API_KEY` 与 `EMAIL_FROM` | 权益队列需分钟调度；到期提醒使用每日任务 |

**能收到登录邮件，只证明 Supabase SMTP 可用，不代表 Vercel 的事务邮件变量已填写。** `/admin/setup` 中“事务邮件环境配置”检查的是后一组，不读取 Supabase 的 SMTP 密码。

1. 第 5.2 节已经验证的 Resend 发件域可继续使用，无需重复添加 DNS。到 **Resend → API Keys → Create API Key**，为应用创建一枚 **Sending access** 密钥并限制到该域，方便与登录 SMTP 分别轮换；也可使用已有、权限匹配的发送密钥。
2. 将完整原值填入 Vercel Production 的 `RESEND_API_KEY`，Type 选 **Secret**。不要填 Supabase key 或把 `Bearer` 一并填入。
3. `EMAIL_FROM` 选 **Config**，填已验证域下的发件人，例如 `我的站点 <no-reply@auth.example.com>`。在 Vercel Value 中不加外层引号；本机文件可写 `EMAIL_FROM="我的站点 <no-reply@auth.example.com>"`。它是邮件的发件人，不是买家地址或站主登录邮箱。
4. 与其余选定功能的变量一起保存并重新部署，再按 **6.3** 配置自动任务。仅填这两个值不会自动建立每分钟发信任务。
5. 对一笔自己同意接收通知的测试购买，核对队列发送记录、Resend 投递状态及买家实际收件，确认只收到一次。若同时测试收款，使用同一笔小额订单即可，无需为邮件重复付款。

未启用事务邮件时，业务通知可能留在队列；日后启用前按[邮件运维](../operations/payment-mail-outbox.md)核对积压，避免误发历史通知。独立停运监控是可选增强，基础发信无需注册其他监控服务。

### 6.2 在线支付（可选）

本项目已内置 zpay／易支付兼容协议的接入：买家在本站下单后，应用会跳转到支付平台收银台，并向同一平台查询付款结果。你需要先在支付平台开通商户与支付渠道，再填写下面三个参数。

**`ZPAY_BASE_URL` 填的是支付平台提供的接口根地址，不是你的网站地址。获取方法如下：**

1. 登录你已开通的支付平台商户后台，打开 **API 信息／接口信息**，找到接口根地址；若后台只提供文档链接，打开文档的 **页面跳转支付 → 请求 URL**。不要选择“API 接口支付”的其他接入方式。
2. 以 [ZPAY 官方开发文档](https://zpayz.cn/doc.html)为例，“页面跳转支付”的请求 URL 是 `https://zpayz.cn/submit.php`。其中 `/submit.php` 是 **ZPAY 平台的支付接口路径**，不是本站的文件，也不要求你部署 PHP。使用该平台的商户在 `.env.local` 中填写：

   ```dotenv
   ZPAY_BASE_URL=https://zpayz.cn
   ```

3. 本项目会在这个地址后自动追加 `/submit.php` 发起支付、追加 `/api.php` 查询订单，因此这里只记录接口根地址，不包含 `/submit.php`、`/api.php`、订单参数或签名。如果你签约的是另一家兼容平台，使用它自己提供的 HTTPS 接口根地址；对照它的“页面跳转支付”请求 URL，去掉末尾 `/submit.php` 及查询参数即可核对，不直接照抄 ZPAY 的域名。

及时将取得的地址与商户资料记录到 `.env.local`，再按下表填写完整参数组：

| Vercel Production 变量 | 从哪里取得 | 填写方法 |
|---|---|---|
| `ZPAY_BASE_URL`（Config） | 上述商户后台的接口根地址，或按“页面跳转支付”请求 URL 核对 | 使用 ZPAY 官方文档所示平台时填 `https://zpayz.cn`；其他兼容平台填自己的接口根地址 |
| `ZPAY_PID`（Config） | 同一平台商户后台的 API 信息／接口信息 | 商户 ID（pid），不是订单号、支付渠道 ID 或支付宝账号 |
| `ZPAY_KEY`（Secret） | 上述同一商户的接口信息 | 商户通信密钥，不是商户后台登录密码 |

1. 三项一起填写，和其他变量一并保存、重新部署。
2. 在本站后台「站点设置 → 首页与导航 → 在线收款」开启开关，仅勾选已签约渠道，保存。设置要销售的单篇／专辑价格或年度订阅价格，前台收费方案读取这些真实设置。
3. 应用用当前 `SITE_URL` 为新订单生成 `/api/payments/notify` 通知地址与订单返回地址，无需把每笔订单的链接抄回环境变量。直接在浏览器打开通知地址没有平台签名，返回 `fail` 属于预期，不能作为支付验收。
4. 按 **6.3** 配置每分钟查单补漏；再由普通买家购买自己的小额测试商品。核对支付平台已付、本站订单已付、对应正文解锁、订单能打开所购文章或专辑。只打开收银台不算付款成功。
5. 按[支付运维说明](../operations/payment-reconcile-scheduler.md)核对同一笔订单重复通知后的权益与邮件任务唯一性。不要手工把订单改为已付，不为排错反复付款。

年度订阅到期后，订阅带来的权限自动失效，不依赖提醒任务；已单独购买的永久文章／专辑权益不受影响。

### 6.3 自动任务：邮件发送、查单与到期提醒

需要事务邮件、支付补单或订阅到期提醒时配置本节。仅登录邮件或分身不需要这些任务。

1. 在自己的终端运行 `openssl rand -hex 32`，生成**另一份**随机值，保管完整输出。将它填入 Vercel Production 的 `CRON_SECRET`（Secret），不带 `Bearer`，与 `PUBLISH_TOKEN` 使用不同值。把选定功能的变量一起保存后重新部署。`PUBLISH_TOKEN` 用于发布内容；`CRON_SECRET` 仅授权维护任务，便于独立轮换。
2. 确认正式固定域名可匿名访问，不受 Vercel 登录保护。任务发送的是带鉴权头的服务请求，不使用浏览器登录会话。
3. 根据启用的业务选择下表任务。**填写变量只解决鉴权，不等于分钟任务已经建立或运行。**

| 业务 | 调度方式 | 操作入口 |
|---|---|---|
| 权益通知队列 | 每分钟调用 `/api/cron/mail-outbox` | 按[邮件调度](../operations/mail-scheduler.md#操作顺序)：SQL Editor 执行 `01-enable.sql` → Vault 保存 URL／密钥 → `02-prepare.sql` → 核对队列后 `03-start.sql` → `04-status.sql` |
| 支付查单补漏 | 每分钟调用 `/api/cron/payment-reconcile` | 按[支付调度](../operations/payment-reconcile-scheduler.md)准备、启用并查询状态；复用下述 Cron 密钥，不新生成另一份 |
| 订阅到期提醒 | Vercel 每日执行 `/api/cron/expiry-reminder` | 已在 `vercel.json` 声明；Production 配好 `CRON_SECRET` 后，在 Vercel 项目的 **Cron Jobs / Crons** 查看执行日志，无需创建分钟任务 |

分钟调度的 SQL 文件从**当前源码**打开并复制完整内容，在 **`NEXT_PUBLIC_SUPABASE_URL` 对应项目 → SQL Editor** 执行，使用默认 `postgres` 角色；不用在本机安装数据库。Vault 在同一 Supabase 项目管理，用表单保存秘密，不把密钥写进 SQL 历史：

| Vault 名称 | 填什么 |
|---|---|
| `wanyou_mail_worker_url`（启用邮件队列时） | `https://你的正式域名/api/cron/mail-outbox` |
| `wanyou_mail_cron_secret`（两种分钟任务共用） | **Vercel Production 环境变量 `CRON_SECRET` 的完整原值**，不含 `CRON_SECRET=` 或 `Bearer` |
| `wanyou_payment_reconcile_url`（启用支付查单时） | `https://你的正式域名/api/cron/payment-reconcile` |

上述新装流程使用独立 `CRON_SECRET`，邮件和支付调度共用它。已有外部调度也兼容 `PUBLISH_TOKEN`；若明确沿用该方式，Vault 的 `wanyou_mail_cron_secret` 保存 **PUBLISH_TOKEN 的完整原值**，无需修改 Vercel 的两项变量。字段名称不表示两份环境变量的值相同。密钥从新站本机配置底稿取得，不凭旧部署的记录猜测。

准备步骤不发送业务请求；启动步骤会开始实际任务，邮件可能真实送达。首次启用前按相应运维指南核对队列和订单。连续两次任务成功只能证明调用链正常，仍需核对一次非空业务任务的结果。任务失败时查看 Supabase 调度记录与 Vercel 函数日志，不重复启动或盲目重发。

### 6.4 AI 设置与站主分身（可选）

模型接口、API Key、知识库和分身都在本站后台 **站点设置 → AI 设置**（`/admin/ai`）配置，不需要新增 Vercel 变量或重新部署。

1. **准备生成连接**：在选用的模型平台创建 API Key，并从其模型列表取得准确的模型标识。后台提供 DeepSeek、硅基流动、OpenAI 和 Anthropic 的受信接口根地址；按平台文档选择 Chat Completions、Responses 或 Anthropic Messages 协议，不填控制台网页或完整请求路径。后台页面初稿与分身共用此连接，但提示词和内容互相独立。
2. **准备向量连接**：在[硅基流动](https://cloud.siliconflow.cn/)创建有目标模型权限的 API Key，知识库选用 `https://api.siliconflow.cn/v1` 的 `BAAI/bge-m3` 原生 1024 维模型。如果生成也使用同一硅基流动账户，可勾选显式复用 Key；生成使用 DeepSeek 等其他平台时，须另填硅基流动的 Key。支持生成 API 不等于提供向量模型。
3. 填写连接、模型与 Key，点击 **保存全部 AI 配置**。密钥保存后不回显；留空保留同一平台的现有 Key。更换接口根地址须填写该平台对应的 Key；更换模型或协议后也须重新检查。
4. 在 **1．准备内容与连接** 勾选允许发送固定合成测试文字，分别检查生成和向量连接。每次最多两次外部请求，可能计费；不会读取文章，也不会自动重试。结果显示在对应按钮下方；失败时按提示核对目标、Key 和账户权限。
5. 在 **知识库索引** 按编号步骤操作：核对内容 → 选择首次初始化 → 确认文字发送范围 → **开始建立索引**。任务建立后会连续处理批次；显示“索引已生成”后，核对范围并确认启用。检索效果检查可跳过，不作为启用门槛。可直接使用自己的已发布内容，不要求导入示例。详细操作见 6.6 节。
6. 编辑 **分身指令**，勾选启用知识库分身并保存。固定权限与引用规则不可编辑；连接或知识库未就绪时，前台隐藏分身入口。没有相关资料时不调用生成模型，不提供通用聊天。
7. 用普通账户提问公开内容、未购内容和库外问题，打开回答中的来源链接，确认没有越权正文。需要匿名提问时，再完成 6.5 节并打开允许匿名提问。

只使用后台页面生成时，完成生成连接的保存与检查即可，不必启用分身或构建知识库；生成结果是待编辑草稿，不会自动保存、发布。向量服务会接收索引文字，使用前核对其数据处理政策及账户费用；调用次数上限不是供应商账单金额上限。

已有实例若显示 **迁入现有 AI 配置**，可显式迁入旧配置，之后重新检查连接和构建索引。运行时只使用后台保存的连接，不自动退回旧环境变量或旧向量。

### 6.5 匿名提问的人机验证（可选）

本节的 **Cloudflare Turnstile** 用于匿名分身提问与匿名服务询价，不是 Supabase 登录邮件设置中的 CAPTCHA，也不是 Cloudflare 网站代理开关。无需修改 Vercel 环境变量。

1. 注册并登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，打开 **Turnstile → Add widget**。填写便于识别的名称，例如“我的站点分身”。不要求把网站迁到 Cloudflare 托管。
2. 在 **Hostname management** 添加实际使用的主机名，如 `www.example.com`；只填主机名，不带 `https://`、端口或页面路径。有独立测试 Preview 时另配测试 widget，不把无关域名加入生产配置。
3. **Widget mode** 选择 **Managed**，无需为本功能开启 Pre-clearance，点击 **Create**。打开本站 **站点设置 → 安全与人机校验**（`/admin/security`），填写同一 widget 的 **Site Key** 与 **Secret Key**，勾选“启用人机校验”并保存，立即生效。Secret Key 保存后不回显；留空保留，更换 Site Key 时须同时填写对应的 Secret Key。步骤见 [Cloudflare 官方指南](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)。
4. 在本站 `/admin/ai` 的站主分身区同时勾选“启用站主分身”和“允许匿名提问”，保存。只填密钥不会自动开启匿名功能。
5. 在无痕窗口使用 `SITE_URL` 对应的固定域名打开前台分身，完成校验并提问；应有正常回答。启用服务询价时，也检查匿名询价表单的校验控件。未完成校验、校验失败或配额用完时应提示原因，不能绕过校验生成。检查失败时核对固定域名、Cloudflare 的 hostname 和同一 widget 的密钥，不连续重试。

已有实例仍可暂用旧环境变量；后台显示“迁移当前环境配置”时可一键迁入，不回显 Secret Key。首次在后台保存后，以后台配置为准，关闭后也不会被旧环境变量重新开启；确认配置来源已迁移后，可从 Vercel 删除旧的两项 Turnstile 变量。

生产使用自己的真实 widget 密钥；本机开发另按 [Cloudflare 测试说明](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)配置测试密钥，不把测试密钥用于正式站点。

### 6.6 知识库构建、启用与日常更新

分身依赖知识库；本节不新增环境变量。索引包含已发布／暂停文章及站主编辑的公开问答，私人会话不进入索引。

1. 准备自己的已发布内容，在 **模型连接与分身设置** 保存并检查向量连接。没有内容时先发布文章，仅需演示时才导入默认使用指南。
2. 首次建立全部索引；以后默认 **同步内容变化**，复用未变化的向量。更换向量连接须全量重建。核对发送范围和费用，确认许可后点击 **开始建立索引**。
3. 等待扫描和向量生成。关闭页面会停止后续批次，重新进入可继续已保存进度；失败或结果未确认时，仅在另行确认可能重复计费后重试。
4. 生成完整后进入 **确认启用**。核对完整覆盖、当前内容版本与向量连接，勾选“我决定启用这份知识库”，点击 **确认启用这份知识库**。不要求先做题或达到某个命中率。启用后按提示配置生成连接、打开分身开关，再到首页提问。
5. 日常发布或修改文章后点击 **同步内容变化**，完成后确认切换即可，无需重新测试。旧版文字立即退出检索，新内容在同步并切换后使用。分身仍只获得当前访客有权阅读的正文。

**可选：检查检索效果**用于排查错配和遗漏，可以在启用前后使用，也可以跳过：

- 手工准备 1–100 个真实问题，或用共享生成连接自动准备草稿；生成前会确认内容发送范围和费用。默认指南问题只适用于保留了对应文章的站点，不会导入文章。
- 逐题选择包含答案的文章，或选择 **本站没有答案**。自动题只是建议，未核对不能发送；无需选择分组或凑题数。
- 点击 **下一步：确认检查范围**，确认本次问题发送与费用，再开始检查。结果展示预期来源是否出现在前五个候选中，高亮错配；这不是生成回答的准确率，也不限制启用。
- 问题和预期来源正确时，保留失败样例。补充文章的答案、标题和上下文后发布、同步，再用相同问题比较；相同内容用同一模型重建不保证改善。修改题目或来源标注不会训练向量或调整线上检索规则。
- 只有返回来源确实包含答案时，才点击 **核对后采纳此来源**，加入该题的可接受来源草稿（最多 3 个，保留原来源）。原题、原报告和原始命中率不变。需要重新检查时另行确认费用；也可取消修改。
- **取消编辑问题**只放弃本页未提交的问题草稿，不删除报告、正文或索引。离开前可下载草稿。为避免丢失草稿，编辑未结束时先取消编辑，再确认启用。
- 单题回答预演默认匿名视角，可切换站主视角；另行确认费用，不创建真实会话或权益。

新建索引采用固定的初始检索筛选值，兼容的增量同步沿用正在使用的规则，测试题目标注不调整它。历史报告保留当时记录，不能与不同规则、不同题目下的成绩直接比较。建议保留真实问题，在模型、检索实现或重要内容改变时比较效果；一次测试不保证未来回答都正确。

刷新、查看报告、编辑和启用不调用模型；自动出题、问题检索和回答预演分别确认范围。正文授权、来源有效性与连接检查始终生效。

### 6.7 人工确认：如何完成实际部署验收

`/admin/setup` 按基础条件、站点内容、邮件、支付、AI 分类展示。每项人工检查可展开“如何验收”。页面只读、不发邮件、不付款，**不会保存人工验收结论**；完成后仍显示“待人工验收”并不代表操作失败。自行记录下面的检查结果，未启用的可选业务无需为验收而开通。

| 检查 | 具体操作 | 应看到的结果 |
|---|---|---|
| 正式访问与界面 | 无痕打开固定正式域名，检查桌面、手机及深浅主题 | 首页可直接访问，不跳到 Vercel 登录；导航正确、页面可读 |
| 登录与站主 | 站主从 `/admin` 登录；另一浏览器普通用户从 `/login` 首次、再次登录；另请求一封邮件测试同浏览器链接 | 新邮件验证码为 6 位；两类账户进入正确页面，普通用户不能进入后台 |
| 发布与图片 | 素材库上传图片，发布带图文章，再修改并发布一次 | 前台正文、图片及更新都正确 |
| 权限与导航 | 受限文章在编辑器用 `⌘/Ctrl + Shift + P` 插入付费墙划定预览；用匿名／未购账户查看，再改一次专辑或页面的侧栏名称 | 未授权只能看预览；页面源码和 `/llms.txt` 无受限正文；侧栏同步 |
| 数据库与桶 | 执行 `supabase/verify.sql`，核对 2.1 节安全设置与 Supabase Advisors | 每项 `passed` 为 true；相关 ERROR 已处理；公开／私有桶设置正确 |
| 收款（启用时） | 自己完成一笔小额付款，核对订单、正文与重复通知 | 订单已付、权益正确且不重复；订单直链到对应文章／专辑 |
| 事务邮件（启用时） | 核对分钟任务、供应商收据、上述订单的实际收件 | 连续运行成功、真实通知送达一次；空队列不代替送达验收 |
| 分身（启用时） | 普通账户提问公开及未购内容；开启匿名时另做 Turnstile | 回答与引用可用，无越权正文；匿名校验和限额有效 |
| 备份恢复 | 按[备份指南](../operations/backup-and-restore.md)备份并在独立空项目验证恢复 | 内容、图片、账户与权限可恢复；不覆盖现用站点 |

`verify.sql` 检查安装结构与权限，不需要在业务库载入任何测试夹具。若自行修改代码或权限规则，在独立测试库运行[回归测试](../../tests/README.md)后再部署。后台内容 ZIP 用于复用内容，不能代替整站备份。

如果保存配置时显示超时，先到 Supabase Logs 按发生时间核对写入是否成功，再刷新检查；不要在结果未知时连续提交。若多个页面同时超时，从运行应用的环境检查 Supabase 地址的 DNS、代理与出站 HTTPS。反馈时提供页面、发生时间和提示，隐藏密钥、邮箱与配置正文。

## 7. 更新与日常维护

首次上线前及数据库升级前，按[备份与恢复指南](../operations/backup-and-restore.md)备份数据库、Auth、Storage 对象和迁移历史，并在独立空项目验证恢复。后台内容 ZIP 用于内容复用，不包含整站恢复所需的全部材料。

- **版本更新**：先查看版本说明，在测试环境确认升级步骤，再更新自己的 Git 仓库并由 Vercel 部署。自行修改代码的验证方法见[贡献指南](../../CONTRIBUTING.md)；
- **数据库升级**：先备份，再按[升级指南](../operations/database-upgrade.md)执行目标版本缺失的迁移；已有实例不重跑 `install.sql` / `demo.sql`；
- **回滚**：切换应用部署不会还原数据库。先按升级说明确认旧应用兼容当前数据库，再选择 Vercel 中已验证的部署；数据库和文件恢复按备份指南执行；
- **密钥轮换**：Vercel 改环境变量后 Redeploy 生效；`PUBLISH_TOKEN` / zpay key 泄露时同流程轮换。
