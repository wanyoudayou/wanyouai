# 项目工具

维护者通过 `npm run release:package` 从干净 Git 提交生成完整源码、插件 ZIP、版本清单与 SHA-256。命令执行插件源码一致性检查，并拒绝敏感文件或版本覆盖；运行前提和交付内容见[版本验证与发布](../docs/development/releasing.md)。

`test:content:smoke` 支持 `--cases` 显式指定待检查的真实内容、匿名权限、价格和受限正文合成标记，不要求官网导入旧演示数据。格式与安全边界同见上述说明；旧演示与 `--prices` 模式保留兼容。

部署者常用：`npm run doctor` 检查本地配置形态。图片桶可按部署指南手动创建；可选 `npm run storage:setup` 工具的运行位置、依赖与环境变量前置条件见[素材库说明](../docs/contracts/media-library.md#可选使用命令工具配置桶)。不带参数时只读，确认目标后添加 `-- --apply` 才创建或调整桶。

素材维护使用 `npm run media:maintain -- --index` 检查旧图片登记，或 `--cleanup-staging` 检查过期私有暂存。两者均只读，添加 `--apply` 才写入；不删除公开图片，操作边界见[素材库说明](../docs/contracts/media-library.md)。

启用 SKILL 时，使用 `npm run storage:setup -- --skills` 只读检查私有包桶；添加 `--apply` 才创建或收紧配置，见 [SKILL 部署](../docs/deployment/skills.md)。`npm run plugin:build` 在 `dist/plugins/` 生成中间文件，将正式安装 ZIP 与 SHA-256 写入受版本控制的 `releases/obsidian/`，包内附带许可证。CI 的 `npm run plugin:check` 重新构建并逐字节检查交付包，避免源码变化后漏更新安装包；两者均不连接网站或读取 Vault。

维护者常用：`npm run contracts` 检查配置和接口契约；`npm run db:baseline:check` 验证数据库生成文件及旧库升级等价；`npm run db:baseline` 刷新生成物。数据库维护源是标准迁移，生成 SQL 不手工修改。

`node scripts/build-migration-review.mjs /absolute/output-prefix --from VERSION` 从实例的结构版本生成全部缺失增量的回滚演练与提交 SQL。`VERSION` 来自 `app_schema_version`，必须存在于发布清单；省略 `--from` 时只生成最后一份增量。工具核验源文件摘要、起始版本、原有数据与最终权限，不连接数据库，也不能代替备份。`check-export-zip.mjs` 校验真实下载的内容包；HTTP 内容、安全和可用性检查以实际站点 URL 为参数。工具与限制见[文档索引](../docs/README.md)。

这些是持续维护工具，保留版本控制。生成的升级审查材料、性能结果、下载包与临时日志存入 `.local-archive/`，不提交真实密钥或业务资料。

设计规范维护 `src/styles/tokens.json`，运行 `tokens:build` 生成 CSS。默认手册由 `content/starter/manifest.json` 选择公开来源与部署指南章节，运行 `starter:build` 生成正文及站内章节链接；[来源说明](../content/starter/README.md)列出八篇内容的维护位置。contracts 检查生成文件无漂移，同时验证升级表从基线连续到达目标结构版本。浏览器测试使用独立夹具，详见测试说明。

`npm run embedding:check` 默认只显示说明。显式添加 `-- --live` 才在交互终端要求输入不回显的硅基流动 Key，检查 `BAAI/bge-m3` 原生 1024 维：最多一次模型列表与两次向量请求、7 条合成文本，可能计费；不读取环境文件或实际文章、不写数据库、不调用生成模型。接入与结果边界见 [Embedding 实施规格](../docs/development/embedding-implementation.md)。
