# 参与万有AI

万有AI 是一个部署对应一个站主的开源系统。当前仍在 v1.0 发布前整顿，尚未承诺稳定版兼容或维护周期。请先阅读 [AGENTS.md](AGENTS.md) 与改动涉及的契约，再实现一个可独立审查的小批次。

## 准备开发环境

使用 Node.js 22 和 npm；CI 以 Node 22 为基线。本机隔离验收与云端 CI 的区别见发布验收状态。安装锁定依赖：

```bash
npm ci
cp .env.example .env.local
```

本地应用需要独立测试 Supabase，按[部署指南](docs/deployment/guide.md)初始化。不要把生产项目作为测试夹具，也不要把真实环境文件、导出 ZIP、用户资料、密钥或数据库备份提交到仓库。默认自动测试使用本地夹具，真实并发测试另外启动[临时 PostgreSQL](docs/development/database-concurrency.md)。

## 实现与验证

修改产品语义、权限、API、配置或数据库时，同步 AGENTS.md 指向的相应契约。页面只组合取数、鉴权和组件；付费正文必须经过服务端与 RLS 双重边界。数据库维护源是 `supabase/migrations/`，后续变更追加迁移；生成文件不得手改。新表要显式启用 RLS、定义 policy / GRANT 并覆盖角色权限测试。

每次代码提交前运行：

```bash
npm run contracts
npm run lint
npm run typecheck
npm run build
```

按改动范围运行 `test:content`、`test:publish`、`test:admin`、`test:avatar`、`test:config`、`test:storage`。数据库还须运行 `db:baseline:check`、`drill:fresh-db` 及相关数据库测试；涉及交易并发时运行 `test:db:concurrency`。`typecheck` 与 `build` 顺序运行，避免同时读写 Next 生成类型。完整 CI 步骤见 [.github/workflows/ci.yml](.github/workflows/ci.yml)。

页面改动按验收矩阵检查匿名 / 登录身份、错误 / 空态及响应式；本地模拟通过不能写成真实 Supabase 或浏览器验收通过。

## 提交问题与变更

普通问题请给出版本或提交号、最小复现、预期 / 实际行为及脱敏日志。连接慢时记录入口、持续时间和状态码；不要贴含令牌的请求头、Auth 回调链接或整份环境文件。安全问题按 [SECURITY.md](SECURITY.md) 私下报告。

PR 说明具体触发条件、最终行为、测试结果与尚未验证的边界。权限、支付、数据库升级及恢复改动应有独立复核证据。未经验证不勾选验收；注明阻塞原因即可。维护者在检查和复核通过后合并，贡献者不需要获得真实部署凭据。

维护者可使用 `ci/**` 分支运行候选检查：推送后触发 GitHub Actions，Vercel 对该类分支禁用自动部署。CI 固定 Ubuntu 24.04 / Node 22，使用只读仓库权限；主检查最多 15 分钟，数据库并发作业最多 10 分钟。应用检查与临时 PostgreSQL 均不需要生产 Secrets。验收记录必须对应候选提交 SHA，旧提交的绿灯不能替代当前代码。

自有代码与内置主题矢量背景使用 [MIT License](LICENSE)。新增贡献的素材、字体和数据须注明来源与许可证，不默认按代码 MIT 处理，也不要未经授权加入个人品牌资源。
