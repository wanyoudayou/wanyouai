# 真实 PostgreSQL 交易并发验收

此工具验证可重复部署的应用 SQL，不依赖测试站的账户、订单或商户。入口为 `npm run test:db:concurrency`：使用 `pg` 的独立连接，执行完整 `supabase/install.sql` 和 `verify.sql`，不删改向量扩展或替换生产事务函数。

## 一步一步运行

准备 Node.js 22、已安装的项目 npm 依赖与 Docker。已有可丢弃的 PostgreSQL 17+ 且安装了 pgvector 时可跳过第一步。

1. 启动只监听本机的临时数据库。密码是公开测试夹具，不用于部署：

   ```bash
   docker run --rm --detach --name wanyou-test-postgres \
     --env POSTGRES_USER=postgres \
     --env POSTGRES_PASSWORD=local-test-only \
     --env POSTGRES_DB=postgres \
     --publish 127.0.0.1:55432:5432 \
     pgvector/pgvector:0.8.2-pg17@sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966
   ```

2. 确认就绪：

   ```bash
   docker exec wanyou-test-postgres pg_isready -U postgres
   ```

3. 在仓库根目录运行：

   ```bash
   TEST_DATABASE_URL='postgresql://postgres:local-test-only@127.0.0.1:55432/postgres' npm run test:db:concurrency
   ```

   工具创建随机 `wanyou_concurrency_*` 库，输出真实数据库 / 扩展版本和结果。缺少连接、安装失败或断言失败均返回非零，不以跳过代替通过。结束时关闭自己的连接并删除自己的库；保留集群已有角色、不修改角色属性、不终止其他连接。强制终止进程时，直接停止整个临时容器清理。不要把容器数据持久化到业务目录。

4. 结束后停止临时容器：

   ```bash
   docker stop wanyou-test-postgres
   ```

`TEST_DATABASE_URL` 只接受本机地址，禁止 query / fragment，防止连接参数覆盖主机。工具不加载 `.env.local`，不连接 Supabase，不调用支付商户或邮件服务。该变量属于开发 / CI，不配置到应用部署平台。

## 验收内容

竞争请求使用不同 `pg_backend_pid()`；协调连接先持有对应锁，观察连接在 `pg_stat_activity` 中确认全部请求处于 Lock 等待，再释放锁。因此，单连接排队不能被记为实际并发。

测试连接显式使用 READ COMMITTED，边界为当前服务端 RPC 的常规事务模型；没有宣称 REPEATABLE READ / SERIALIZABLE 下无需事务重试。每个 SQL 设置 10 秒 statement_timeout 和 8 秒 lock_timeout，竞争观察最多等待 5 秒。

| 场景 | 结果要求 |
| --- | --- |
| 站主人机校验配置同时保存 | 两个独立认证连接实际等锁；同版本仅一方成功，另一方冲突；公开 Site Key 与私有 Secret Key 始终来自同一次保存 |
| 全部 SKU（含独立 Skill）各 8 路建单 | 各只创建一个 pending，响应复用同单 |
| notify / reconcile / 旧 return 前缀同时结算 | 1 settled + 2 duplicate，事件 / 权益各一行 |
| 新商户订单号的 notify / return / reconcile 同时结算 | 同一 `merchant_order_no` 只产生一份事件、权益与邮件任务；真实 PostgreSQL CI 结果按候选 SHA 单独验收 |
| 无通知、无浏览器返回的自动查单 | 在真实 PostgreSQL 上创建 11 分钟前的待付单，由应用自动认领与结算函数接入受控“平台已付款”响应；首次产生一份事件、权益与邮件任务，第二轮不再认领。平台响应为测试替身，不向真实商户发请求。 |
| 同流水竞争不同订单 | 一个成功，另一个 EVENT_ORDER_MISMATCH，绑定成功订单 |
| 同用户同 SKU 的两个历史单分别付款 | 两单 paid、两事件、一份权益；这不是自动退款 |
| 同订单不同流水 | settled / already_paid，权益不重开 |
| 建单与结算同时发生 | 复用原单或 ALREADY_ENTITLED，无额外 pending |
| 错误金额与有效通知竞争 | 错误金额拒绝，不能借重放返回成功 |
| 锁超时 / 重试 | 首次无部分落库，重试 settled，再重放 duplicate |
| 提交前断线 | 原事务回滚，等待者完成且只落一份权益 |
| 最后权益 INSERT 注入失败 | 订单、事件、权益一起回滚，恢复后可重试 |
| 停售 / 改价事务与建单竞争 | 等待后按新状态 / 新价格判 NOT_SELLABLE |
| 三种终态并发通知 | 不写事件、不重开权益 |
| 客户端角色调用交易 authority | SQLSTATE 42501 |
| Skill 包确认与配置同时提交 | 同一上传只有一个确认租约；同版本只落一份包；配置 CAS 只有一方成功 |
| Skill 多轮重复提交 | 同一请求只启动一次；同会话不同请求在执行中被拒绝 |
| 手册同步操作同时创建 | 同 ID 同摘要复用结果；摘要变化或凭据撤销后拒绝 |

故障约束只注入临时库并在 finally 中移除，测试文件不能当迁移执行。Auth schema 模拟平台接口；应用表、约束、RLS、授权、触发器和函数来自实际安装工件。

## 应用 HTTP 检查

运行与 `SITE_URL` 地址一致的修复版应用后：

```bash
npm run test:security:smoke -- http://localhost:3000
```

检查 GET / POST 非法通知返回 fail、匿名下单需要登录、匿名部署检查无诊断、机器路由 ETag 条件请求。无效签名不触发结算。泄露扫描只覆盖既定 DEMO 哨兵，不能解释为扫描了所有真实正文；有效签名的重复键反例由交易单元测试负责。已导入演示内容时还可执行 `npm run test:content:smoke`。

已使用的测试站可能修改过演示售价。此时先独立读取数据库公开售价，保存为 JSON 对象（键为演示 slug，值为当前数值价格），再运行 `npm run test:content:smoke -- http://localhost:3000 --prices /安全临时路径/prices.json`。文件须覆盖全部 4 个有价格的 slug；重复出现的手册 / 活动章节共用同一价格。未传文件仍严格按 seed 售价验收；不得为通过测试修改真实站点价格或删除价格断言。

## CI 与证据边界

CI 增加独立 `database-concurrency` 作业：Node 22、固定镜像摘要的 pgvector / PostgreSQL 17、锁定 npm 依赖。缺库或失败阻断作业，不使用 GitHub Secrets 或托管 Supabase 凭据。

当前 CI 与提交结果见[发布状态](release-status.md)。本地日志需明确数据库/Node 版本、安装校验和实际测试总数，不以历史通过计数覆盖新增测试。

这些结果不替代 Supabase Auth / REST / Storage 全身份矩阵、供应商时限、网络层重试、远程应用更新、真实空托管安装及备份恢复。高风险权限与结算变更仍需独立审查，工程重排不改变已验收 SQL。


新增配额竞争与商户订单号边界由当前测试源码和 CI 覆盖，不沿用旧提交计数。独立连接须在 pg_stat_activity / pg_blocking_pids 观察到同时等锁后再放行，保证验证真实竞争。受控供应商响应不等于真实商户故障。
