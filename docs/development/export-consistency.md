# 导出快照与并发验收

`/admin/export` 通过一次 `export_site_snapshot(p_include_media => true)` RPC 读取固定白名单应用表、素材目录与 Auth 资料字段，再在服务端组装 ZIP。用途与限制见[内容导出](../operations/content-export.md)。

## 一致性与兼容

SQL STABLE 函数的子查询使用同一调用语句的 MVCC 快照，避免分别分页期间把文章、订单与权益的新旧状态混在一起。无需跨 REST 请求维持事务或冻结正常业务写入。规则依据 [PostgreSQL 事务隔离](https://www.postgresql.org/docs/17/transaction-iso.html)及[函数稳定性](https://www.postgresql.org/docs/17/xfunc-volatility.html)。

显式参数重载增加素材目录；原无参数重载保持旧字段集合，兼容升级期间的旧应用。数据库先按[升级指南](../operations/database-upgrade.md)更新，再部署新应用；缺失重载时导出失败，不静默降级为旧分页读取。

清单 `wanyou.export/1` 的 `consistency.mode=single_statement_snapshot` 和 `captured_at` 表示查询方式及语句开始时间，不是跨数据库、Storage 与外部服务的备份截止点。纯组装函数没有快照证据时标记 `non_atomic`。

## 权限与失败行为

- HTTP 路由先验证站主；两个重载仅 service_role 可执行，普通账户与站主会话都不能直接调用。
- 读取 Auth 资料使用 SECURITY DEFINER，固定空 search_path、限定对象名称。参数只控制是否包含素材目录，不接受任意表名或 SQL，不写业务数据。
- 固定表名单排除站点秘密和临时上传记录；Auth 只含账户资料白名单，密码、恢复令牌及会话令牌不返回。用户写入 metadata 的内容仍需按私人资料保管。
- 应用校验完整表集合、单例、主键、重复行与 Auth 字段范围。任何失败返回 503，不发送部分 ZIP。
- RPC 设置 30 秒截止并禁用 SDK 自动重试。客户端取消不等于证明数据库已立即停止查询，数据库仍受托管角色与平台时限约束。
- ZIP 完整组装后分块发送，保留 no-store、文件长度和文件名；取消后停止发送。分块交付不减少数据库响应及打包所需内存，不能据此承诺任意体积下载。

## 回归

`npm run test:admin` 覆盖服务端权限、秘密排除、非空素材目录、旧重载兼容、目录覆盖、文件摘要和缺失迁移拒绝降级。

`npm run test:db:concurrency` 使用可丢弃的 localhost PostgreSQL 和独立连接，验证并发修改文章／Auth、替换订单、真实结算事务及回滚时，导出不会混合事务前后状态。测试通过锁与 pg_stat_activity 证明调用实际重叠，结束后释放锁和临时数据库；这些锁不是生产实现。

`npm run test:scale` 验证规模数据下的正确性及查询测量，不模拟托管 HTTP 与 Vercel 容量。完整事故恢复仍使用数据库、Auth、Storage 和配置备份。
