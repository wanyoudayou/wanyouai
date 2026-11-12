# Dashboard 与 CLI 迁移历史

`migrations/` 是维护源，install.sql 是新装生成文件，app_schema_version 是应用结构版本；supabase_migrations.schema_migrations 是 CLI 跟踪历史。版本行相同不等于目录、权限和历史已对齐。

| 轨道 | 新装 | 后续升级 |
|---|---|---|
| Dashboard | 全新 SQL Editor 执行 install → verify | 先备份，按[升级说明](../../supabase/README.md)执行经审查的缺失增量；不直接 db push |
| CLI | 全新项目按 migrations 顺序建立历史 | 单一执行者追加迁移，核对本地/远程 migration list；不混入 install.sql |

两条轨道的结构和权限必须等价。选择 Dashboard 不需要为了发布强行建立 CLI 历史；转入 CLI 是独立运维动作，不能猜测版本或用 db push 试错。

## 跨轨前核对

1. 备份目标业务和历史状态，记录文件哈希、结构版本与应用表行摘要。
2. 固定 search_path，对比表列、序列、约束、索引、函数、视图、触发器、RLS、policy 与完整 grants；授权记录须包含对象、角色、权限与 grant option，只比数量会漏检。
3. 核实 vector 实际 schema；逻辑恢复后先按[恢复手册](backup-and-restore.md)收口默认 ACL，再跑与恢复版本匹配的 verify。TRUNCATE 等维护权限不受 RLS 保护，不能只验证 SELECT。
4. 只有目标实际包含每份迁移效果、目录/数据保全证据齐全且高风险审查通过，才按[Supabase 官方流程](https://supabase.com/docs/guides/deployment/database-migrations#diagnosing-and-fixing-sync-errors)考虑 migration repair --status applied。该命令只修历史，不执行或回滚 SQL。
5. 只读核对 migration list、verify、目录与业务摘要；任何不一致停止 CLI 部署，保留原 Dashboard 升级路径。

MCP OAuth 与 CLI 数据库凭据相互独立。已验收的测试项目未进行 CLI 历史收养，不能把恢复或 SQL Editor 通过当作 CLI 全流程已通过。
