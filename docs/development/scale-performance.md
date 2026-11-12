# 规模与性能验收

本页说明本地与 CI 的规模回归，用于防止数据静默截断。导出用途、验收与托管容量边界见[内容与业务数据导出](../operations/content-export.md)。

目标规模：1,000 篇文章、10,000 笔订单、1,000 名用户。使用随机命名的临时数据库，执行实际 `supabase/install.sql` 与 `verify.sql`，不连接现有 Supabase 项目、不读取 `.env*`、不复制真实用户数据。

## 复现

准备可丢弃的本机 PostgreSQL 17+ / pgvector，使用其管理员连接：

```bash
TEST_DATABASE_URL=postgresql://postgres:local-test-only@127.0.0.1:5432/postgres \
SCALE_REPORT_PATH=/tmp/wanyou-scale.json npm run test:scale
```

也可运行 `npm run test:scale -- --pglite` 检查数据与算法正确性；这是嵌入式引擎，不作为原生 PostgreSQL 性能结果。GitHub CI 的 database-concurrency 作业在事务测试后运行原生规模验收，并把 JSON（含 EXPLAIN ANALYZE / BUFFERS）写入运行摘要。

只接受 localhost 连接，不接受带 query / fragment 的连接串；随机数据库正常完成或出错后关闭并删除，不终止其他数据库连接。连接上限 5 秒、原生单条语句 10 秒、锁等待 5 秒、脚本总上限 180 秒；每 15 秒输出进度。硬超时会终止进程，人工使用的临时实例可能残留本次 `wanyou_scale_*` 数据库，先核实名称再清理；CI 容器随作业销毁。

## 数据与测量口径

- 1,000 个虚构邮箱，1,000 篇已发布博客（公开 / 单篇付费各半），每篇正文 8,775 字节。
- 10,000 笔已支付订单，每用户 10 笔、每笔 10 元；500 条单篇权益。模拟站主、已购者、未购者、匿名四种角色。
- 完整安装检查全部通过（数量以当前 verify.sql 为准）；匿名正文 500 篇、已购用户 501 篇、未购用户 500 篇，订单隔离为本人 10 笔。
- 列表使用生产数据函数的筛选、字段与排序；数据库层执行实际 RLS。用户归组、看板汇总、导出分页、完整 ZIP 组装复用生产函数。
- 导出覆盖 `EXPORT_TABLES` 列明的应用表、1,000 个用户、1,000 个 Markdown 和清单。测试适配器每页限制为 137 条，验证不能把“短于请求页大小”当成完成。
- 单项先预热并断言，再测 9 次；完整订单分页和 ZIP 各测 3 次。记录中位数与近似 p95（样本很少，实际上接近最大值），不作为稳定 SLA。

数据库直接连接不含 PostgREST / Auth HTTP、公网、代理、Next SSR 或浏览器渲染。Auth 平台表与管理员分页由测试适配器模拟；真实 SDK 的请求格式、分页截断和错误拒绝由 `tests/admin-scale.test.ts` 另测。进程峰值 RSS 包括测试夹具、驱动、验证及重复 ZIP 构建，不能视为线上单请求内存；PGlite 还包含 WASM 引擎。

`EXPLAIN ANALYZE` 用于检查实际执行计划，数据库成本不包含把结果传给客户端的网络耗时，见 [PostgreSQL 17 文档](https://www.postgresql.org/docs/17/using-explain.html)。生产中全量导出仍需内存组装，付费正文只在站主服务端导出路径处理；此文件不是匿名接口。

## 分页与完整性规则

后台用户与看板按稳定主键分页并校验总数；失败或总数变化时报错，避免显示部分金额。单用户详情只读取该用户的完整统计数据，列表先按用户归组，避免对每个用户重复扫描全部订单。

测量沿用生产服务端的 owner 校验和数据库 RLS。Supabase 默认 API 条数上限不能靠请求更大的 `limit` 绕过，参见 [select](https://supabase.com/docs/reference/javascript/select) 与 [Auth 管理员分页](https://supabase.com/docs/reference/javascript/auth-admin-listusers)。

## 验收边界

这是规模正确性和顺序、预热后的数据库 / 算法测量。多次分页请求不是事务快照：能拒绝条数变化与重复主键，不能检测等量替换或分页期间的原地更新。导出已使用单次 RPC，见[导出一致性](export-consistency.md)。完整备份仍应按备份文档建立一致性边界。

性能结果只覆盖所测引擎、数据与环境；托管 HTTP、浏览器与更大体积需按实际使用单独评估。只有执行计划和复现证据显示必要时，才考虑索引或聚合接口。
