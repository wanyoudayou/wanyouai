# 历史媒体地址迁移

数据库恢复到新项目后，旧内容可能仍含来源项目的绝对图片 URL。新发布使用站内 /media/{slug}/{hash}.{ext}，但不会自动改写历史记录。

当前展示字段包括 articles.cover_url、articles.preview_md、article_bodies.content 和 article_chunks.content；历史 article_versions/content_file_revisions 快照与原始输入 hash 保留原值。每个实例先盘点真实字段和对象，不假定只有一个图片。

## 迁移设计约束

1. 先验证目标 Storage 对象路径、字节 SHA-256、桶属性、`verify.sql` 和当前文章 / 版本数量；备份迁移前数据库与对象。只对已在目标对象清单中、路径符合 `media/{slug}/{hash}.{png|jpg|webp|gif}`、字节 hash 已验证的旧公开 URL 建立精确映射。不能用整个来源域名的全局替换。
2. 在短事务内仅更新上述四个**当前展示字段**，以原值包含精确旧 URL 为条件。更新后立即断言这四类字段中来源项目 ref 为 0，且未出现未映射的旧媒体 URL；否则回滚。设置有限 `lock_timeout` / `statement_timeout`，不在事务中做网络调用。
3. 不更新 `article_versions.snapshot`、`content_file_revisions.snapshot`、`content_hash`、`input_hash`、`publish_requests` 或任何支付 / 权益字段。保留原始输入、版本号、请求 ID 与重放语义；迁移不是一次新发布。
4. 事务提交后重新核对表行数、文章状态、版本号和 hash、检索切片的 `access`、`与当前版本匹配的完整 verify。匿名及普通用户不得因 URL 改写获得付费正文；比较匿名 REST、SSR、`/llms.txt` 与站主阅读。用**只指向目标项目**的隔离应用验证封面和正文图片，随后在来源项目暂不可达的模拟条件下复核，确认不再回退到旧项目。
5. 对其他 OPC 实例先只读盘点全库 URL 和对象清单，不假定只有这六个字段或一个图片。若外链不是已验证的本实例 Storage 图片，报告例外并停下人工分类；不得把外部图片误认成本地资产。

## 精确迁移工具

[relocate-one-media.sql](../../supabase/operations/relocate-one-media.sql)仅用于一篇文章/一个已验证图片，不在 migrations 中，不是全库替换器。调用者在显式事务内通过 set_config('wanyou.media_relocation', JSON, true) 提供 source_url 与 article_slug；先核对目标、备份和 Storage 字节 SHA-256，默认演练回滚。脚本设置 2 秒锁、8 秒语句超时，短时阻止公共表并发写入以核对预期变化。

事务提交后，用只指向目标项目的隔离应用核对封面、正文、匿名/站主和 llms 输出，再模拟来源不可达。对象必须恢复原始路径；Dashboard 自动重命名的副本不算恢复通过。重发布历史快照时发布器核对 manifest 与对象 hash，再解析为站内路径，避免破坏重放与版本语义。

回归入口：npm run test:db:media。测试覆盖误映射、超量更新、快照保持、回滚和重复执行；真实对象与跨身份检查另行验收。
