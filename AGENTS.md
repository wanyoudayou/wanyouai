# 万有AI Agent Constitution

人与 Agent 修改仓库前须阅读本文。具体产品、权限、协议以[文档索引](docs/README.md)中的当前契约为准。

## 1. 项目与安全边界

一个部署对应一个 OPC，唯一站主；不做 SaaS、多租户或团队角色。站主身份、文案、价格、域名来自 `site_config`，禁止实例硬编码。可部署性是一等需求，陌生部署者须能只按 README 完成安装。

- 付费正文不得进入未授权 SSR HTML、client bundle、`/llms.txt`、可公开读取的 chunks 或分身上下文。RLS 为硬闸，服务端阅读判定为第二道防线，禁止前端隐藏替代验权。
- `SUPABASE_SERVICE_ROLE_KEY`、`PUBLISH_TOKEN` 与模型/邮件/支付密钥只能用于受信服务端，禁止进入浏览器、日志与错误输出。
- 真实 `.env*` 禁止入库，仅 `.env.example` 可提交。`.local-archive/` 是权限受限的本地恢复材料，任何运行、测试或生成入口不得依赖它。
- `supabase/tests/rls-fixtures.sql` 仅用于独立测试库，禁止在生产运行。
- 原始分身会话私有，公开稿须由站主明确编辑；内容权限变化必须使缓存失配。

## 2. 当前版本与文档

应用已实现内容发布与阅读、账户、订单与权益、zpay、事务邮件、服务履约、活动核销、分身、自定义页面与机器名片。正式版本以 GitHub Releases 为准，发布门槛和已知限制以[发布状态](docs/development/release-status.md)为准；工程整理不能代替独立部署者验收。

| 用途 | 权威入口 |
|---|---|
| 产品范围、身份、状态机 | [产品契约](docs/reference/product.md) |
| 路由、三态与布局 | [页面契约](docs/reference/pages.md)、[线框图](docs/reference/wireframes.md) |
| UI tokens 与组件 | [设计规范](docs/reference/design-tokens.md) |
| 数据库安装与升级 | [Supabase README](supabase/README.md)、`supabase/migrations/` |
| 权限与配置 | [安全配置](docs/contracts/supabase-security.md)、[环境变量](docs/contracts/environment.md) |
| 发布与支付 | [发布 API](docs/contracts/publish-api.md)、[支付 API](docs/contracts/payment-api.md) |
| 机器输出与 JSON | [card 映射](docs/contracts/card-mapping.md)、[card schema](docs/card.schema.json)、[site_config schema](docs/contracts/site-config.schema.json) |
| 验收与安全 | [验收矩阵](docs/contracts/acceptance-matrix.md)、[安全摘要](docs/development/security-review.md)、[测试说明](tests/README.md) |
| 运维 | [备份恢复](docs/operations/backup-and-restore.md)、[邮件](docs/operations/payment-mail-outbox.md)、[支付查单](docs/operations/payment-reconcile-scheduler.md) |

详细阶段记录归档；正式文档描述当前正面规则，不把已取消方案、裁定日期或接力进度搬回源码。

## 3. 命令与验证

使用 npm 与 `package-lock.json`，不混入其他 lockfile。CI 使用 Node.js 22。先 `npm ci`；开发 `npm run dev`，需要 webpack 时 `npm run dev:webpack`，生产服务 `npm run start`。

提交前必须通过：

```bash
npm run contracts
npm run docs:check
npm run lint
npm run typecheck
npm run build
```

受影响行为运行对应回归；数据库须通过 `db:baseline:check`、新装/升级等价与真实 PostgreSQL 并发作业。运行方法和隔离边界见 tests/README.md。页面抽查匿名、注册、订阅与已购，404/空态、三档断点及泄露搜索。机器输出校验 schema、供给过滤、ETag 与无授权正文。

## 4. 配置与部署

变量唯一来源是 `.env.example` 和环境变量契约。新增变量同步两者。按基础部署、图片存储、登录邮件、在线支付、事务邮件、分身与人机验证分组；可选组不完整时如实禁用。

人机验证在 `/admin/security` 管理，公开开关／Site Key 与私有 Secret Key 同事务保存。旧 Turnstile 环境变量只在后台未保存配置时兼容；保存后不得静默回退，读取失败按不可用处理。校验固定站点 hostname 与操作类型，不凭 `success` 一项放行。

`NEXT_PUBLIC_` 可进浏览器但不能含秘密。Auth 登录邮件在 Supabase SMTP 配置；`RESEND_API_KEY` / `EMAIL_FROM` 只控制应用事务邮件。已有站主身份以数据库为准，改 `OWNER_EMAIL` 不转移所有权。

部署顺序：Supabase 安全设置 → install/verify → 配置图片桶 → Vercel env / Production 部署 → 确认固定域名与 SITE_URL → Auth URL/SMTP → `/admin` 一次性认领 → `/admin/setup` 与人工验收。具体动作只维护在 README 和部署指南。

## 5. 数据库纪律

新装唯一入口：

```text
supabase/install.sql
supabase/verify.sql
```

维护源是 `supabase/migrations/`，生成文件用 `npm run db:baseline` 生成、`--check` 验证。`legacy/` 是历史升级/等价回放材料，新装不逐份执行。已有实例先备份，识别结构版本再选择缺失增量；SQL Editor 与 CLI 历史衔接遵循升级说明。

- 全部应用表启用 RLS；policy 与 Data API grants 显式声明，不依赖新表自动暴露。
- Data API ON，Automatically expose new tables OFF；按安全契约只读检查 ensure_rls。
- 新表/函数/视图/列权限进入回归和验收矩阵；结构与权限语义同步产品契约。
- `service_role` 仅用于发布、支付、导出、站主权威操作与经过审查的分身检索；普通页面使用 anon/authenticated 会话和 RLS。
- 分身可以检索全域，注入必须再次代码验权。未授权命中只能提供标题、权限与试读链接。

## 6. 工程与组件

纵切实现真实路由、数据与权限。mock 仅能存在于签名一致的数据函数缝，不在组件层发明权限结果。

页面只做取数、权限判定、布局与组件组合。组件消费类型和数据函数；付费 body 只在服务端授权读取，列表不得传正文。

不修改 `components/ui/` 的 shadcn 原语；定制在业务组件。颜色用 Design Tokens，语义徽章唯一出口是 StatusBadge。设计清单中可复用单元首次使用就提取；新增组件先同步清单。

响应式：≥1280 三栏；768–1279 左侧图标栏、目录/分身按需展开；<768 单栏与底部主导航。浅深模式由顶层主题控制，默认跟随系统。后台快捷操作遵循页面/设计契约的独立右栏规则。

## 7. 产品状态与权威路径

- 内容：`draft → published ⇄ paused → archived`。暂停停售不停读，向直接购买者通知三个月保留期；归档需 paused 满三个月，DB 强制，归档静默。受信维护修复不得被当作普通操作旁路。
- 订单：`pending → paid → fulfilled / failed / refunded`，仅支付 authority 可确认收款；不能伪造已付或删除交易。可信关旧单须有对账证据和停收款条件。
- 服务：`inquiry → quoted → booked → in_progress → delivered → accepted → settled`；客户要求修改可 `delivered → in_progress`。报价、协议、交付留快照；验收仅客户操作，付款线下完成。
- 活动：`upcoming → registering → ended`；核销与 event 权益同事务、幂等，个人资料仅本人和站主可读。
- 权益取有效并集；订阅到期不影响已购永久权益。公开 README 须验证同专辑归属；不可扩大至非 README 正文。

在线 provider 唯一 zpay。客户端仅给 SKU/目标，价格由服务端快照。回调与查单共用 payment_events authority，校验签名、金额、商户和唯一商户订单号；权益/邮件入箱同事务。

站主认领由已验证邮箱与 `OWNER_EMAIL` 限定，OTP 与链接共用 `claim_owner_for` 单站主闸门；用户 `/login` 回调不能认领站主。

后台发布与 API 共用：身份 → 请求校验 → request_id 重放 → lint → preview → 文章/body/version/chunks → 同事务首次响应 → revalidate。错误阻断，警告可成功；重放也 revalidate，同内容不增版本。

`/card` 与 `/card.json` 同源 `getCardData`，机器目录固定匿名读取。source_of_truth 为 `${SITE_URL}/card`，paused/ended 不作为可售供给。输出 Cache-Control/稳定 ETag；源不可用 503/no-store。询价使用当前服务端点，不补造 schema 字段。

分身标注常驻“AI 生成 · 仅供参考 · 合作请转人工”，不外露模型名。缓存/检索不占生成额度；派发后未知结果保留额度，生成不自动重试。

## 8. 文档更新

行为范围/状态/权限改动同步产品与验收矩阵；路由同步页面；布局/组件同步设计；数据库同步迁移和生成工件；发布/支付请求响应同步对应 API；JSON 字段同步 schema；配置同步环境契约与模板；部署安全同步 README/部署指南/安全契约。

部署文档只描述部署者需要的操作、结果与排错方法；维护者的验收规则放入开发维护文档，具体变更原因写入提交说明。文档一致性由维护者负责，不要求部署者判断文档新旧或修正文档。

回归测试、权限夹具、维护脚本保留 Git。一次性截图、原始日志、接力记录、临时导出与机器状态只存忽略归档，不能成为源码依赖。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
