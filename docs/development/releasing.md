# 版本验证与发布

正式版本由同一个 Git 提交的应用、数据库工件、默认指南和插件交付包组成。部署者从[部署指南](../deployment/guide.md)开始；本文供维护者打包和发布使用。

## 验证候选

从干净分支运行[完整 CI](../../.github/workflows/ci.yml)，完成[验收矩阵](../contracts/acceptance-matrix.md)中的受影响真实流程。隔离浏览器夹具、PGlite 和合成供应商响应分别说明覆盖边界，不能记成真实 Auth、Storage、模型或插件宿主通过。

已有独立部署、支付和邮件证据可按差异复用。新装 SQL、升级等价、源码包安装与生产构建仍需覆盖最终提交；涉及 RLS、结算或供应商协议的修复补做对应真实检查。未经授权不重复真实付款、发信、模型调用或人机挑战。

## 显式内容冒烟清单

官网不必安装旧演示数据。先通过正常后台创建可辨识的测试内容，再建立本地 JSON 清单：

```json
{
  "format": "wanyou.content-smoke/1",
  "forbiddenText": ["RELEASE_CHECK_PRIVATE_UNIQUE_MARKER"],
  "cases": [
    {
      "path": "/blog/release-check-paid",
      "locked": true,
      "price": 1,
      "expectedText": ["发布验收公开试读"]
    },
    {
      "path": "/blog/release-check-missing",
      "missing": true
    }
  ]
}
```

`forbiddenText` 使用专门放在受限测试正文中的合成标记，不填写真实私人内容。每个存在的页面指定匿名付费墙状态和公开文本；需要核对结构化价格时填写从后台独立核对的 `price`。不存在的页面使用 `missing:true`。所有路径必须属于同一站点的公开内容路由，章节仅使用 `article` 参数。

```bash
npm run test:content:smoke -- https://你的站点 --cases /绝对路径/content-cases.json
npm run test:security:smoke -- https://你的站点
npm run test:availability -- https://你的站点 3
```

这些命令不创建账户、写入业务数据、发送有效付款通知或运行调度任务。内容检查最多同时读取三页，不跟随跳转，不携带用户登录会话，不打印响应正文。省略清单时保留隔离旧演示数据模式，`--prices` 继续兼容旧价格清单。

## 生成交付包

更新应用版本及锁文件，提交所有源码与生成物，通过完整 CI 后执行：

```bash
npm run release:package
```

命令要求工作目录干净，执行 `plugin:check`，从当前提交生成 `dist/releases/v版本号/`：

| 文件 | 用途 |
|---|---|
| `wanyouai-v版本号.zip` | 可独立安装的完整源码、SQL、文档和默认指南 |
| `wanyou-handbooks.zip` | 可直接安装的 OPC手册管理器，插件保持自己的版本号 |
| `release-manifest.json` | 来源提交、应用／数据库／插件版本和文件摘要 |
| `SHA256SUMS` | 三份交付文件的 SHA-256 |

```bash
cd dist/releases/v版本号
shasum -a 256 -c SHA256SUMS
```

源码包保留回归测试和维护工具，排除真实环境文件、本地归档、机器配置、缓存与依赖目录。打包校验数据库清单、迁移和插件摘要，拒绝符号链接或子模块。同一版本只能重现完全一致的输出；未发布候选变化后先移走旧输出再重新生成，已公开版本必须递增版本号。

## 对外发布

1. 扫描准备公开的全部 Git 引用、历史、Actions 日志与附件中的凭据和私人材料；确认许可证和依赖审计结论。
2. 从交付包完成干净安装和构建；保留同提交 CI、真实流程、已复用证据与已知限制记录。
3. 更新官网部署与使用指南，核对 Source、配置、内容权限和交付功能；记录上一兼容部署作为回滚点。
4. 准备版本标签和 GitHub Release 草稿，附件使用上述同一组工件。仓库公开前确认具体公开范围，并在公开后启用私密漏洞反馈和 main 必需检查。
5. 发布后以匿名身份打开仓库、README 部署按钮、指南和下载链接，下载后核对 SHA-256。官网从正式仓库 main 部署，不继续镜像两个仓库。

公开文档只说明当前操作和限制；原始日志、截图、交易和个人信息保存在受限本地归档，不作为应用、测试或打包输入。
