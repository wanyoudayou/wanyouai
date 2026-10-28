# 数据库安装与维护

本目录提供万有AI 的数据库安装、升级和校验文件。新部署按下面的安装步骤操作；已有数据的实例使用[升级指南](../docs/operations/database-upgrade.md)。

## 新装

要求 PostgreSQL 17 或更高版本。在**全新、未使用的 Supabase 项目**中打开 SQL Editor，依次粘贴并完整执行：

```text
supabase/install.sql
supabase/verify.sql
```

`install.sql` 执行成功后再运行 `verify.sql`。校验应返回检查结果，**每一行的 `passed` 都必须为 `true`**。如果校验返回空结果、出现 `false` 或 SQL 错误，停止部署，按失败项排查；不要通过反复运行安装文件来修复。

安装会建立数据库结构、访问权限和空白站点配置，不创建用户、站主或内容，也不开通支付和分身。站主认领、Auth 登录邮件和网站部署按[部署指南](../docs/deployment/guide.md)继续操作。面向部署者的示例在站主认领后从 `/admin/setup` 载入，包含免费指南与收费方案页，可选择空站。`demo.sql` 是另一个维护测试用演示数据集，仅用于尚未使用的测试实例，不是网站初始化的必需步骤。

## 图片存储

图片桶需在 Storage 中单独配置，安装 SQL 不会创建桶。按[部署指南](../docs/deployment/guide.md#24-配置图片存储)在 Dashboard 手动创建两个桶；指南逐项列出公开状态、文件大小限制和允许的 MIME 类型，手动配置无需运行命令。

公开图片桶默认 `media`，单文件上限 10 MiB，允许 PNG、JPEG、WebP、GIF；名称通过 `SUPABASE_STORAGE_MEDIA_BUCKET` 设置。私有暂存桶固定为 `media-uploads`，同样 10 MiB，额外允许 SVG。浏览器直传暂存桶，服务端校验并将 SVG 转为 PNG 后才进入公开桶。

熟悉终端的部署者可使用[可选命令工具](../docs/contracts/media-library.md#可选使用命令工具配置桶)；其中列有 Node.js、依赖安装、`.env.local`、目标项目和网络等前置条件。工具不上传或删除文件，也不改变已有桶的公开/私有属性。

对象写入权限仍须按[安全配置](../docs/contracts/supabase-security.md)检查。`verify.sql` 只检查应用数据库，不检查 Storage、Auth 回调、SMTP 或外部服务凭据。选图、旧图登记和暂存维护见[素材库说明](../docs/contracts/media-library.md)。启用 Skill 前另按 [Skill 部署说明](../docs/deployment/skills.md)创建固定私有桶 `skill-packages`；安装／升级 SQL 会为它添加限制性访问策略。

## 文件用途

| 文件或目录 | 用途 |
|---|---|
| `install.sql` | 全新实例的一体化安装文件 |
| `verify.sql` | 只读检查数据库结构、版本和访问权限 |
| `demo.sql` | 可选演示内容；仅用于尚未使用的实例 |
| `migrations/` | 按版本顺序保存的数据库变更，是维护源 |
| `upgrades/` | 指定旧版本的升级脚本，使用前须核对前置版本 |
| `operations/` | 邮件调度、支付查单等运维脚本，按对应指南使用 |
| `templates/login.html` | Auth 验证码与登录链接邮件模板；按[邮箱登录指南](../docs/deployment/email-login.md)复制到 Dashboard，不由 SQL 自动安装 |
| `baseline.sql` | 数据库结构快照，供比对和诊断，不用于安装或升级 |
| `restore-hardening.sql` | 逻辑备份恢复后重新设置应用访问权限，按恢复指南使用 |
| `release-manifest.json` | 目标结构版本、迁移清单和文件 SHA-256 |
| `install-order.json` | 新装与校验的文件顺序 |
| `legacy/`、`legacy-install-order.json` | 早期版本的 SQL 与回放顺序，供兼容升级及测试使用；新装不执行 |
| `tests/` | 开发者在独立测试库使用的测试配置和权限夹具；会写入测试账户与权益，不在实际站点数据库执行 |

## 已有实例升级

先[备份数据库与文件](../docs/operations/backup-and-restore.md)，再按[数据库升级指南](../docs/operations/database-upgrade.md)识别已安装版本、选择缺失迁移并在测试副本演练。不要在已有实例运行 `install.sql`、`demo.sql` 或把 `legacy/` 全部重放。

通过 SQL Editor 安装不会自动建立 Supabase CLI 的迁移记录。继续用 SQL Editor 升级时不需要补造记录；若要改用 CLI，先按[迁移历史衔接](../docs/operations/migration-history.md)核对真实结构和已执行迁移，再决定如何同步历史，不能直接运行 `db push` 试错。

## 备份与恢复

整站恢复需要数据库、Auth、Storage 对象和部署配置，操作顺序见[备份与恢复指南](../docs/operations/backup-and-restore.md)。后台内容导出包只用于内容复用和业务分析，不包含完整数据库结构、登录凭据、站点秘密或图片文件。

从逻辑备份恢复后，按指南执行 `restore-hardening.sql`，再运行与恢复结构版本匹配的校验文件；完成缺失升级后使用目标版本的 `verify.sql`。恢复与新装使用不同流程，不能在恢复数据上叠加安装文件。

## 维护数据库源码

数据库变更追加到 `migrations/`，不要回写已发布的迁移。`install.sql`、`baseline.sql`、`demo.sql`、`verify.sql`、组合升级脚本和发布清单由工具生成，不手工编辑。

```bash
npm run db:baseline         # 检查新装与旧版升级的结果等价，并生成文件
npm run db:baseline:check   # 只检查等价性及生成文件是否需要更新
npm run drill:fresh-db      # 检查空库安装、演示内容与权限
npm run test:db:concurrency # 在一次性本机 PostgreSQL 中检查并发与故障恢复
```

等价检查会比对数据库对象、权限和升级前后的原有数据。测试环境、执行方法及验证范围见[测试说明](../tests/README.md)与[数据库并发测试](../docs/development/database-concurrency.md)。这些命令不能代替目标实例的登录、Storage、支付和邮件检查。
