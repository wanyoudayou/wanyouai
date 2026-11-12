# 历史数据库源码

此目录保留完整旧版本的 SQL 回放输入，供升级等价验证和已有早期实例的缺失文件核对使用。它不是当前维护源，也不是新装入口。

新项目只执行上级目录的 `install.sql → verify.sql`；当前结构由 `../migrations/` 维护。旧实例按照[数据库升级说明](../README.md)选择经过审查的升级路径，不逐个猜测执行这些历史文件。

历史回放顺序由 `../legacy-install-order.json` 定义。文件内容保持不变；生成器使用这些输入与标准迁移比较目录、权限和既有数据摘要，所以它们继续纳入 Git。

早期 bootstrap.sql 与 imports-upgrade.sql 也保留于此，不在 legacy-install-order.json 的完整 V1 等价回放链中；当前生成器不读取它们。不要将它们追加到新装步骤。
