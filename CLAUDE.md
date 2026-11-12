# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

项目宪章、安全边界、状态机与文档同步规则以 AGENTS.md 为准（下行导入），本文只补充命令与跨文件架构。

@AGENTS.md

## 命令

```bash
npm ci                       # 仅 npm；CI 为 Node 22
npm run dev                  # Turbopack；需要 webpack 时 npm run dev:webpack
npm run build                # next build --webpack
npm run doctor               # 只读检查本地 .env 配置形态
```

提交前门槛：`contracts`（契约校验 + tokens:check + starter:check）→ `docs:check` → `lint` → `typecheck` → `build`。

回归按领域分组（node:test + tsx，多数用 PGlite / 内存夹具，不连真实云端）：
`test:content` `test:publish` `test:admin` `test:avatar` `test:ai` `test:skills` `test:handbooks` `test:config` `test:storage` `test:embedding`。各组覆盖范围见 [tests/README.md](tests/README.md)。

```bash
# 单个测试文件 / 单个用例
node --import tsx --test tests/content-access.test.ts
node --import tsx --test --test-name-pattern="关键词" tests/publish-pipeline.test.ts
# 浏览器（Playwright，隔离夹具 tests/browser/fixture，端口 3102，不读 .env.local）
npx playwright install chromium   # 首次
npx playwright test tests/browser/skills.spec.ts
```

数据库相关：改 `supabase/migrations/` 后运行 `npm run db:baseline` 重新生成 `install.sql` / `verify.sql` / 清单，再 `db:baseline:check`；`drill:fresh-db` 做新装演练。`test:db:concurrency` / `test:scale` 需要 `TEST_DATABASE_URL` 指向一次性 PostgreSQL 17 + pgvector（绝不指向 Supabase）。

生成类产物都有 build/check 成对脚本，改源后必须重新生成：`tokens:build`（`tokens.json → tokens.css`）、`starter:build`（`content/starter/manifest.json → src/generated/starter-content.json`）、`plugin:build`（Obsidian 插件）。

## 架构要点

- **Next.js 16**：中间件文件是 [src/proxy.ts](src/proxy.ts)（导出 `proxy`，非 `middleware`），只负责 Supabase 会话刷新。写代码前先查 `node_modules/next/dist/docs/`。
- **三种 Supabase 客户端**（[src/lib/supabase/](src/lib/supabase/)）：`client.ts` 浏览器 anon；`server.ts` 带用户会话、受 RLS 约束，是普通页面默认选择；`service.ts` 为 `server-only` 的 service_role，仅限发布、支付、导出、站主权威操作与审查过的分身检索。
- **阅读权限双闸**：RLS 之外，[src/lib/reading/access.ts](src/lib/reading/access.ts) 的 `visible()` 返回 `hidden | preview | full`，是服务端第二道防线；列表与机器输出只读公开投影（`public-catalog*.ts`）。
- **内容模型**：所有专辑类（普通专辑、手册、Skill、活动）复用 series / chapter，类型、路由与可售能力集中在 [src/lib/content-kinds.ts](src/lib/content-kinds.ts)；新增类型须同步导入、发布重验、检索、机器输出与测试。
- **发布管线**：[src/lib/publishing/pipeline.ts](src/lib/publishing/pipeline.ts) 的 `publish()` 依赖注入 `PublisherStore`（replay / commit / media / revalidate），后台、`/api/publish`、默认内容导入和手册同步都走这一条路径；先持久化再 revalidate。
- **支付**：[src/lib/payments/](src/lib/payments/) 中 zpay 回调与 `reconcile` 查单共用 `settle` 结算权威；邮件通过 outbox 表由 `/api/cron` 分钟任务发送。
- **AI**：分身、Skill、页面生成、知识库共用 [src/lib/ai/](src/lib/ai/) 的 `generate` / `embed`；出站只能经 `transport.ts` 访问已配置连接。AI 与 Turnstile 配置存在数据库（`/admin/ai`、`/admin/security`），旧环境变量仅作未保存时的兼容。分身检索与注入验权在 [src/lib/avatar/](src/lib/avatar/)。
- **配置**：环境变量注册表 [src/lib/config/registry.mjs](src/lib/config/registry.mjs) 同时驱动 `doctor` 与 `/admin/setup` 部署检查；新增变量需同步 `.env.example` 与 `docs/contracts/environment.md`。
- **机器输出**：`/card`、`/card.json`、`/llms.txt` 同源于 `getCardData` / [src/lib/machine-output.ts](src/lib/machine-output.ts)，以 `docs/card.schema.json` 校验。
- **后台列表**：URL 参数经 `admin/list-query.ts` 白名单解析 → 站主验证 → 计数 → 分页 → `AdminDataTable`；列表不读正文，明细才读。
- 其余工作区：`packages/handbook-protocol`（手册同步协议）、`plugins/obsidian`（插件源码）、`.agents/skills`（Supabase 相关 agent skill）。
