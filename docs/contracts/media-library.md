# 图片素材库

后台「内容管理 → 素材库」管理全站可公开展示的图片。文章正文、封面、首页浅深横幅、头像、Logo 和自定义 HTML 共用选择器；视频不属于此图片库的上传范围。

## 上传与选用

- 支持 PNG、JPEG、WebP、GIF、SVG，每张原文件及转换结果均不超过 10 MiB，最多 4000 万像素。SVG 去除活动内容和外部资源后转为 PNG。
- 站主可单独批量上传，也可在选图窗口上传后选用。上传显示阶段及字节进度；网络失败保留草稿，手动重试同一文件。不会因重试重复发布文章。
- 图片采用不可变的内容地址；同一内容重复上传复用文件。素材名称和替代文字可修改，已插入正文的替代文字不被反向覆盖。
- 上传后图片可公开访问。付费正文的权限不保护图片链接；不要上传私密资料、支付凭据或需要鉴权的视频。
- 归档使图片不再出现在默认选图列表，不删除文件、不撤销旧引用。可在素材库切换「已归档」恢复选用。本系统不提供公共素材的物理删除或自动回收。
- 「检查已有引用」按相同图片内容检查已保存正文与封面、历史版本、导入修订、导入附件、独立页面和站点配置，返回分类数量；不含未保存草稿。读取失败显示不可用。

文件夹导入会把本地图片上传到素材库，保留目录路径和原文件摘要的冲突检查，在发布时把 Markdown 相对图片引用改为站内地址。它不会自动发布，也不会把同一图片复制到每个章节目录。已有文章与历史版本的图片地址保持有效。

## 部署

数据库按 [Supabase 安装与升级说明](../../supabase/README.md)更新后，使用同一个 Supabase 项目准备两个桶：

| 桶 | 可见性 | 用途 | 上传限制 |
|---|---|---|---|
| `SUPABASE_STORAGE_MEDIA_BUCKET` 指定的桶，默认 `media` | Public | 已校验的公开位图 | 10 MiB；PNG/JPEG/WebP/GIF |
| `media-uploads`（固定名称） | Private | 临时原始图片 | 10 MiB；上述格式及 SVG |

手动创建时，按[部署指南的图片存储步骤](../deployment/guide.md#24-配置图片存储)逐项配置 Public、Restrict file size 和 Restrict MIME types。两个桶均设置 10 MiB 上限；公开桶的 MIME 清单为 `image/png,image/jpeg,image/webp,image/gif`，私有暂存桶额外允许 `image/svg+xml`。按指南保存成功后即可继续部署，不要求运行命令。

浏览器通过站主接口领取仅针对单个暂存对象的签名上传地址，直接把图片送到 Supabase；服务端下载并检查大小、原始摘要、签名、实际格式、尺寸及完整解码，成功后才写入公开桶和素材目录。浏览器不会取得服务端密钥。图片字节不经过 Vercel 的上传请求体；保留的旧 multipart 发布接口仍受宿主平台请求上限约束，大图请使用后台素材库。

## 可选：使用命令工具配置桶

这是手动创建的替代方式；已按部署指南手动配置的站主可跳过整个小节。以下命令在**自己的电脑终端**执行，不粘贴到 Supabase SQL Editor，也不在浏览器控制台运行。

执行前准备：

1. 本机安装 Node.js 22 或更高版本，终端已进入解压或克隆后的源码根目录；该目录应同时包含 `README.md`、`package.json` 和 `scripts/`。
2. 在这个目录执行过 `npm ci`，安装锁定的依赖；如已经成功安装，无需重复执行。
3. 同一目录下已创建并保存 `.env.local`，其中 `NEXT_PUBLIC_SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY` 为**同一个目标项目**的实际值，不是模板占位值。公开桶改名时同时填写 `SUPABASE_STORAGE_MEDIA_BUCKET`。
4. 本机网络可以访问该 Supabase 项目。工具使用服务端密钥调用 Storage API，不需要 Supabase CLI 登录、MCP 认证或 Vercel 登录。

先运行只读预检，不会创建或修改桶：

```bash
npm run storage:setup
```

`media` 和 `media-uploads` 均显示 `ready`，表示桶设置已符合要求，无需执行写入命令。`missing` 表示尚未创建，`incomplete` 表示限制不同；确认 `.env.local` 指向要配置的项目后，再执行：

```bash
npm run storage:setup -- --apply
npm run storage:setup
```

`--apply` 通过 Storage API 创建缺失桶或修改大小与 MIME 限制；最后一条再次只读确认，两个桶应均显示 `ready`。`blocked` 表示已有桶的 Public/Private 状态不同，工具不会替你更改可见性；先在 Dashboard 核对桶内文件和用途。读取报错时先检查配置或网络，修正前不执行 `--apply`。

工具不上传、删除图片，也不创建对象 RLS 策略。私有暂存桶不设为 Public，不给匿名或普通登录账户增加任意对象读取、上传、覆盖或删除权限。按[安全配置](supabase-security.md)核对权限，并在网站部署后用站主身份实际上传。

## 旧图片与暂存维护

升级不会重写旧图片或自动修改历史版本。如需把旧上传加入选图目录，先只读预检，再执行登记：

```bash
npm run media:maintain -- --index
npm run media:maintain -- --index --apply
```

登记逐张校验现有 `media/<slug>/<hash>.<ext>` 对象，保持原地址和字节不变；不合格对象跳过并返回失败状态。重复执行不会覆盖名称、替代文字或归档状态。

已完成的私有暂存文件会尽力清理。网络中断、过期或拒绝的原文件可用以下命令检查和清理；只处理过期超过 24 小时的暂存对象，保留上传记录，绝不删除公开桶文件：

```bash
npm run media:maintain -- --cleanup-staging
npm run media:maintain -- --cleanup-staging --apply
```

素材文件和目录均须纳入备份；数据库备份不包含 Storage 文件，见[备份恢复](../operations/backup-and-restore.md)。存储套餐、流量和支出上限在 Supabase 组织 Billing 中管理，本系统不自动升级套餐。

现有内容导出会保留 `data/raw/media_assets.json` 的目录信息，临时上传记录不导出；ZIP 不含图片原件，也不支持整包恢复站点。新版导出使用显式包含素材目录的快照重载，原无参数快照保持兼容旧应用，见[内容导出](../operations/content-export.md)。

## 接口与权限

- `GET /api/admin/media`：站主分页搜索；参数 `q/status/sort/page/pageSize`，页码 1 起、20/50/100；先筛选计数再分页，创建时间或名称后附唯一 ID 排序。读取错误不伪装为零。
- `POST /api/admin/media`：同源站主会话；`prepare` 登记原始文件摘要并签名单对象，`finish` 校验并确认，`edit` 只更新名称／替代文字／归档，`usage` 只返回引用计数。响应 `no-store`，无任意路径下载或删除入口。
- 上传 ID 重试须绑定同一站主、名称、摘要、MIME 和大小；冲突拒绝。签名最长两小时，已确认请求直接返回原素材；过期未确认需重新上传。每站主 15 分钟最多登记 600 次请求，重放不占新请求。
- `media_assets`：站主 RLS；普通身份不可读。客户端不能插入记录或修改文件地址、摘要、格式、尺寸、体积与创建时间。
- `media_uploads` 和 `reserve_media_upload`：仅受信服务端；暂存凭据与上传记录不经 Data API 暴露给普通账户。
- 发布的 `media[]` 协议形状不变。传统文章目录清单继续严格验证；跨文章及素材库引用必须匹配服务端登记元数据，再校验存储字节。直接引用已登记站内地址无需附带清单；任意外链不进入服务端下载。
- 历史发布输入摘要、重放结果和版本快照不因素材登记而变更。
