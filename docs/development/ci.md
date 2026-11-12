# Linux 发布候选验收

GitHub Actions 验证上传的提交，不能看到本机未提交文件。验收记录需包含候选完整 SHA、运行链接、三个作业的结果，以及与本机工作区的对应关系。当前配置见 [.github/workflows/ci.yml](../../.github/workflows/ci.yml)。

## 运行方式

在候选代码完成本地检查后，将其提交到 `ci/**` 或 `feat/**` 分支并推送到当前仓库。该分支 push 会触发 CI，无需向 main 合并。普通 PR 与 main push 仍运行检查。若本机有跨批次未提交改动，可在独立副本生成候选快照；保留本机分支和暂存区原状，并比较文件清单与内容摘要，避免遗漏新增文件。

Vercel 的 `git.deploymentEnabled` 对 `ci/**` 设置为 false，这类分支用于检查而不自动部署。其他分支沿用原部署行为；配置依据 [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled)。推送前仍须排除真实环境文件、备份与凭据；一次文件扫描不代替发布前的 Git 历史与资产审查。

## 三个作业

| 作业 | 环境及内容 | 截止 |
|---|---|---|
| verify | Ubuntu 24.04、Node 22、npm ci；契约、配置、Storage、干净库、媒体迁移、安装工件、内容 / 发布 / 后台 / 分身及离线 Embedding 测试、lint、类型检查、生产构建 | 15 分钟 |
| browser | Ubuntu 24.04、Node 22、Chromium；隔离 UI 夹具中的双色、响应式、分页与编辑恢复 | 15 分钟 |
| database-concurrency | Ubuntu 24.04、Node 22、固定摘要的 PostgreSQL 17 / pgvector 容器；完整安装、真实独立连接竞争、事务故障与恢复 | 10 分钟 |

浏览器测试使用一个 worker，不自动重试；单项截止 30 秒，整套截止 8 分钟，包含隔离 Next.js 夹具的启动及首次路由编译。测试步骤截止 9 分钟，允许超时后的清理结束；整个作业截止 15 分钟，另含依赖和 Chromium 安装。列表报告逐项显示名称、结果和耗时，便于区分断言失败与整套超时。

Actions 仅请求 `contents: read`，checkout 不保留 Git 凭据；应用测试不需要 GitHub Secrets。数据库使用可丢弃的本机容器和公开测试口令，构建只注入公开占位值。运行版本、测试总数与失败原因从实际日志取证。`checkout` / `setup-node` 按各自[官方说明](https://github.com/actions/checkout)与[官方说明](https://github.com/actions/setup-node)更新，Action 自身运行时与项目测试用 Node 22 是两个概念。

## 阻塞处理与证据

浏览器查看运行详情和失败步骤；不对旧提交反复点击 Re-run 来验证本机新代码。明确的断言失败先本地复现、修复并追加候选提交；服务或下载超时最多做一次有原因的重跑，仍失败则记录阻塞并转 HITL。三个作业均成功才关闭本次 Linux 工程检查子项。

云端绿灯不自动部署应用、执行远程迁移或发送真实邮件，也不代表业务供应商验收通过。候选合并、正式部署、公开仓库和发布公告仍按发布验收状态分别处理。
