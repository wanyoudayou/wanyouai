# 万有AI 发布 API 契约 · v0.1

> 适用范围：Web 文件夹导入与后台内容工作台。两者必须调用同一个服务端发布函数；后台不得旁路 lint、幂等、版本快照与 revalidate。

## 1. 身份

Obsidian 手册凭据只被[手册同步协议](handbook-sync.md)接受，不被本通用发布 API 接受。两者共用发布事务，插件额外检查目标为手册。

`POST /api/publish` 只接受两种身份：

| 客户端 | 身份 |
|---|---|
| 兼容 Bearer 调用方 | `Authorization: Bearer <PUBLISH_TOKEN>` |
| 后台内容工作台 | 站主 Supabase 会话，服务端必须验证 `is_owner()` |

其他客户端一律 `401`。

## 2. 请求

```http
POST /api/publish
Content-Type: application/json
```

```json
{
  "client_request_id": "01J8Z8EXAMPLEREQUESTID",
  "frontmatter": {
    "title": "选品评分卡",
    "slug": "selection-scorecard",
    "type": "chapter",
    "access": "paid",
    "series_slug": "selection-handbook",
    "summary": "用五个维度判断品类。",
    "tags": ["选品", "评分卡"]
  },
  "markdown": "## 选品评分卡\n\n<!-- paywall -->\n\n完整正文。",
  "media": [
    {
      "source_path": "assets/scorecard.png",
      "storage_path": "media/selection-scorecard/5f3c-warning-example.png",
      "sha256": "5f3c...",
      "mime_type": "image/png",
      "width": 1200,
      "height": 800
    }
  ]
}
```

### 字段

- `client_request_id`：客户端生成的全局唯一请求 ID，建议 ULID 或 UUID。
- `frontmatter`：必须符合 `publish-frontmatter.schema.json`。
- `cover`：可为相对路径或公开 URL；发布管线负责解析本地图片并改写为站内稳定媒体 URL。
- `markdown`：原始 Markdown；预览切点使用独立的顶层 HTML 注释 `<!-- paywall -->`。权限由 `access` 决定；多个有效切点只使用第一个，代码示例中的标记按普通内容处理，均不因标记数量或缺失阻止发布。
- `media`：可为空数组。仅接受图片：
  - `image/png`
  - `image/jpeg`
  - `image/webp`
  - `image/gif`
  - `image/svg+xml`（服务端必须消毒，或发布时转成 PNG）
- 视频、音频、PDF 一律 `BLOCKED`。
- 传统 `storage_path` 符合 `media/{article-slug}/{content-hash}.{ext}`；跨文章复用须匹配服务端素材目录中的地址、摘要、格式与尺寸，再校验真实字节。新素材地址为 `media/library/{content-hash}.{ext}`，同内容复用对象。
- 发布后的图片地址为 `/media/{article-slug}/{content-hash}.{ext}`，由应用临时重定向到当前配置的公开 Storage 桶。数据库正文与封面不写入具体 Supabase 项目域名；外部 HTTPS 图片仍保留原地址并标记警告。
- 历史快照若含旧 Supabase 项目的公开图片绝对 URL，重发时仅在对应媒体清单的存储路径及字节 hash 已核验后将该 URL 解析为站内地址；历史快照和其内容 hash 不因此改写。

独立 Skill 使用 `type=skill`、`access=public`，不传 `series_slug` 或文章 `price`；售价与包设置在 SKILL 后台管理，包文件不进入本文发布请求。

## 3. 内容哈希与幂等

服务端权威计算内容哈希，不信任客户端声明的整体哈希：

```text
sha256(
  canonical_json(frontmatter)
  + "\n---\n"
  + markdown
  + "\n\0\0"
  + canonical_json(sorted_media_manifest)
)
```

规则：

1. `client_request_id` 首次完成后，响应写入 `publish_requests`；重放直接返回首次响应。
2. 同 slug + 同内容哈希：不创建新 `article_versions`，返回既有版本。
3. 同 slug + 内容变化：创建下一个递增版本。
4. HTTP `422 BLOCKED` 请求同样写入 `publish_requests`；修正后必须使用新的 `client_request_id`。鉴权失败不写入，之后可用同一 ID 重试。
5. 图片字节 hash 以存储对象的 `sha256` 为准，用于去重与 `storage_path`。

## 4. 文章 URL

响应中的 `article.url` 由服务端按内容归属生成：

| 类型 | URL |
|---|---|
| 独立博客 | `/blog/{article.slug}` |
| Skill 公开介绍 | `/skills/{article.slug}` |
| 手册章节 | `/handbooks/{series.slug}?article={article.slug}` |
| 兼容的旧技能章节 | `/skills/{series.slug}?article={article.slug}` |
| 活动沉淀 | `/events/{series.slug}?article={article.slug}` |

查询参数只作为当前章节锚定；服务端仍按 `article_bodies` 权限判定输出正文。

## 5. 服务端处理

顺序固定：

1. 鉴权；
2. 请求结构校验；
3. `publish_requests` 重放检查；
4. frontmatter 条件校验；
5. Markdown AST lint；
6. 媒体类型与 manifest 校验；
7. series 存在性校验；
8. 生成 `preview_md`；
9. upsert `articles` / `article_bodies`；
10. 写版本快照；
11. 重建 catalog / preview / body chunks；
12. 在同一数据库事务保存首次响应并提交；
13. revalidate `/`、类型列表、详情页、`/llms.txt`、`/card`、`/card.json`，然后返回首次响应。

事务入口为 `commit_publication`，维护源位于 `supabase/migrations/`，仅 service_role 可调用。先持久化响应、后刷新 Next 缓存，避免跨系统中断造成正文成功而请求记录丢失；重放同样执行首次响应里的刷新路径，不重复写内容。`revalidated` 表示需要提交给 Next 的路径失效请求，不代表已重新渲染。

无 paywall 标记的 paid 文发布成功但返回 `needs_user_action`，且 `preview_md = ""`。

## 6. Diagnostics

每条诊断：

```json
{
  "code": "MULTIPLE_PAYWALL_MARKERS",
  "severity": "warning",
  "message": "已使用第一个预览切点，后续标记不影响阅读权限。",
  "path": "/markdown"
}
```

- `severity=warning`：不阻断，响应状态为 `needs_user_action`。
- `severity=error`：不落库正文与版本，响应状态为 `blocked`。

### 错误码

| Code | Severity | 说明 |
|---|---|---|
| `UNAUTHORIZED` | error | 身份缺失或无效 |
| `SCHEMA_INVALID` | error | 请求或 frontmatter 不符合契约 |
| `SERIES_NOT_FOUND` | error | `series_slug` 不存在 |
| `MEDIA_TYPE_BLOCKED` | error | 视频 / 音频 / PDF 嵌入 |
| `MEDIA_MISSING` | error | Markdown 引用图片但 manifest 缺失 |
| `MEDIA_HASH_MISMATCH` | error | 存储对象 hash 与 manifest 不一致 |
| `PAYWALL_IGNORED` | warning | 非独立顶层切点未参与预览截断 |
| `MULTIPLE_PAYWALL_MARKERS` | warning | 多个有效切点使用第一个 |
| `SUBSCRIBER_IN_PAID_SERIES` | warning | subscriber 内容位于定价专辑 |
| `PAID_WITHOUT_PREVIEW` | warning | paid 文无 paywall 切点，预览为空 |
| `EXTERNAL_IMAGE` | warning | 未本地化的外链图片 |
| `UNEXPECTED_ERROR` | error | 服务端未预期错误 |

## 7. 响应

### PASS / NEEDS_USER_ACTION

HTTP `200`：

```json
{
  "status": "pass",
  "diagnostics": [],
  "article": {
    "slug": "selection-scorecard",
    "version": 2,
    "url": "/handbooks/selection-handbook?article=selection-scorecard"
  },
  "revalidated": ["/", "/llms.txt", "/card.json"]
}
```

`needs_user_action` 结构相同，但 `diagnostics` 至少包含一条 warning。

### BLOCKED

HTTP `422`：

```json
{
  "status": "blocked",
  "diagnostics": [
    {
      "code": "MEDIA_TYPE_BLOCKED",
      "severity": "error",
      "message": "video embedding is outside the MVP media scope",
      "path": "/media/0"
    }
  ],
  "article": null,
  "revalidated": []
}
```

### 鉴权失败

HTTP `401`：

```json
{
  "status": "blocked",
  "diagnostics": [
    { "code": "UNAUTHORIZED", "severity": "error", "message": "valid publisher identity required", "path": "" }
  ],
  "article": null,
  "revalidated": []
}
```

### 未预期错误

HTTP `500`，结构同 `BLOCKED`，`code=UNEXPECTED_ERROR`。未预期错误响应本身不写入 `publish_requests`；事务失败整体回滚。若事务已提交而缓存刷新失败，成功响应已经持久化，客户端用同一请求 ID 重试会补做刷新并取得该成功响应。

## 8. HTTP 摘要

| 场景 | Status |
|---|---:|
| 发布成功，无警告 | 200 `pass` |
| 发布成功，有警告 | 200 `needs_user_action` |
| lint 阻断 | 422 `blocked` |
| 鉴权失败 | 401 `blocked` |
| 未预期错误 | 500 `blocked` |

## 9. 服务端实现边界

- owner 会话请求必须携带与 `SITE_URL` 同源的 Origin；脚本使用 Bearer，不回退到 cookie 身份。
- 请求上限 2 MiB，Markdown 上限 1,000,000 字符，媒体最多 100 项、每张 10 MiB、解码最多 4,000 万像素。`client_request_id` 为 1–128 位字母、数字、下划线或短横线。
- 无法解析 JSON、超限或 envelope 无效时返回 422；由于还未进入有效请求阶段，不写请求记录。通过 envelope 后的 frontmatter / lint 阻断持久化并重放。
- 金额与 `numeric(8,2)` 对齐：大于 0、最多两位小数、上限 999999.99。已有文章不允许通过发布改变 type / series 归属；archived 不可重发，paused 更新后仍 paused，README 只接受 public。
- 付费以及其他受限文章只写 catalog / preview chunks；全文仅写 article_bodies 和仅站主可读的版本快照。public 可生成 body / readme chunk。
- 媒体对象需先存在于配置的公开图片桶。清单 hash 按原始字节核验，SVG 经服务端白名单清理后转 PNG，生成新的 hash 路径；版本保存原始输入，正文和 cover 使用处理后的站内 URL。PNG / JPEG / WebP / GIF 按实际解码格式与尺寸核验。扩展名规范分别为 png / jpg / webp / gif / svg。`GET /media/{slug}/{hash}.{ext}` 仅接受此路径形态并临时重定向到当前 Storage 项目；不使用服务密钥代理文件。
- 原始 HTML 媒体嵌入被阻断；Obsidian 媒体方言由后续发布客户端转换。外部 HTTPS 位图仅返回 `EXTERNAL_IMAGE` 警告，不执行任意 URL 抓取或声称已验证可达性；本地化由发布客户端负责。
- 内容 hash 使用原始 frontmatter、Markdown 和按 canonical JSON 字典序排序的 media manifest；JSON 对象键递归按字典序排列，数组（media 外）保留原顺序。相同内容指与当前最新版本 hash 相同；恢复旧内容会产生新版本。

## 10. 图片上传入口

`POST /api/publish/media` 与发布 API 使用相同的 Bearer / owner 鉴权。multipart/form-data 字段：`file`（图片文件）、`slug`（目标文章）、`source_path`（原引用路径，缺省为文件名）。请求体最大 12 MiB，单图最大 10 MiB、边长最大 20000、总像素最多 4000 万。

服务端核验文件签名、实际格式、尺寸与解码结果，并复用发布媒体校验逻辑；SVG 白名单清理后转 PNG，转换前的 SVG 不上传。按最终字节 hash 生成 storage_path，禁止覆盖已有对象，同 hash 重传复用。

成功 200 返回 `{ "media": { "source_path", "storage_path", "sha256", "mime_type", "width", "height" }, "url": "/media/{slug}/{hash}.{ext}" }`，前端把 media 加入发布清单。失败返回 `{ "message": "通用提示" }`：未授权 401、请求 / 媒体无效 422、存储不可用 500；均为 no-store。该入口不写文章、版本或 publish_requests；发布正文仍只能调用统一发布函数。

后台匿名预览通过受 owner 验证的 Server Action 使用同一 Markdown 渲染器；它不上传媒体、不写数据库，也不把切点后的受限正文返回预览。预览不替代发布时完整 schema / 媒体 / 幂等校验。

## 后台改价与回滚（2026-09-14）

后台只向客户端提供版本号和时间。站主操作在服务端读取快照，调用同一 publish 管线；回滚恢复正文与 frontmatter，生成新版本或对相同内容返回现有版本，不删除历史、不改变当前 paused 状态。种子文章没有历史快照时，首次改价从服务端当前正文和元数据生成快照。

后台调用为提交载荷附加内部 `expected_updated_at`，commit_publication 在锁定文章后核对，过期提交被阻断。该字段不增加到公共发布请求；现有脚本请求兼容。操作的请求标识用于断流重试，回放先于并发检查。归档 / 草稿不允许通过此入口重发。


## Web 待发布修订协议（2026-09-14）

`POST /api/admin/files` 仅接受同源、已验证的 owner 会话，不接受 Bearer 代替站主登录；所有响应 no-store。JSON 上限 2 MiB。操作包括 inventory（元数据）、compare（校验路径和属性、源文及引用图片 hash 比对）、stage（expected 修订 ID 乐观锁）、review（owner 按需加载原文）、publish（以修订 ID 发布）、order（校验完整文件集合后排序）。附件使用 multipart（scope/path/file/expected 原 hash），总请求 12 MiB、单图 10 MiB；服务端验证字节、尺寸及 SVG 消毒后才上传。

新增内容先存在 content_file_revisions 中，stage 不写 articles / article_bodies / article_versions / chunks。发布时从修订读取快照，调用同一 publish 管线，通过 commit_file_publication 包装事务做基线与最新修订检查，然后调用 commit_publication 并保存修订发布结果。请求丢失可重试同修订；修订输入不变且线上未变化时重复保存复用修订。线上发生新修改时必须重新导入审核。

相对路径记录在 content_files / content_assets 中；新导入图片登记于共享素材库，`linkAsset` 用已确认上传 ID 绑定原目录路径和原文件摘要，保留 expected 冲突检查。章节快照保留相对引用，发布正文解析为规范 URL；旧图片清单和地址继续有效。后台图片直传与素材目录权限见[素材库契约](media-library.md)。修订与正文权限分开，未发布正文不进入公开读取或机器输出。

### 专辑设置与全辑发布

专辑设置通过站主专用 `save_series_settings` 一次保存展示字段、导航、精选、价格与已发布公开 README；使用专辑 `updated_at` 乐观锁，校验失败全部不保存。上架、暂停与归档仍是明确的独立动作，沿用生命周期与权益保留规则。

`/api/admin/files` 增加 `batchList`、`batchPublish`、`batchStatus`，继续要求同源站主 Cookie；手册凭据不可调用。列表只返回最新待发布修订的标题、路径、权限和版本，不取正文；最多列出 500 篇并返回真实总数。

批量请求包含专辑 ID、预期更新时间、请求 UUID、选中修订 ID、是否上架以及公开 README slug。服务端按既有发布管线校验全部所选文稿与媒体，再由仅 service_role 可调用的 `commit_series_publication` 同事务提交。数据库重新检查所属专辑、不可变快照、最新修订及线上版本；任一失败回滚全部正文、版本与结果记录。新专辑可同时绑定本批公开 README 并上架，活动仍需完整活动详情。未选中草稿不发布；暂停专辑更新正文后仍暂停。

每批最多 500 篇、准备后载荷不超过 8 MiB。超限要求明确拆批，不静默截断。响应未知先查询原任务，手动重试沿用 UUID；同任务更换范围拒绝，重放不增加版本。插件返回本页后读取最新已发布版本和剩余草稿。

网页文件夹导入只读取所选目录根部 Markdown，子目录及其他文件忽略；现有在线图片保留。本地图片引用可以随草稿原样保存并提示待补插，发布仍检查媒体完整性。首次自动地址为 `专辑slug-readme` 或 `专辑slug-稳定唯一后缀`，已有绑定和明确提供的 slug 不改变。

批量发布在逐组校验时累计请求大小，超过 8 MiB 或校验预算时提示缩小选中范围，尚不提交任何章节；数据库提交最长 25 秒，锁等待最长 5 秒。
