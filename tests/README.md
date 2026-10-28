# 自动回归测试

这些测试是可重复的工程验证源码，纳入 Git；它们不进入 Vercel 应用上传，不需要生产凭据。

| 命令 | 验证范围 |
|---|---|
| `npm run test:browser` | 隔离 Next.js 夹具的双色、1440/1100/390/320px、抽屉、分页及编辑保留 |
| `npm run test:content` | 阅读身份、正文边界、渲染与机器输出 |
| `npm run test:publish` | 发布输入、事务、重放、媒体与 RLS |
| `npm run test:admin` | 站主身份、支付、邮件、后台操作、导出与失败关闭 |
| `npm run test:ai` | 私有 AI 配置、协议／出站保护、完整索引、租约、站主启用及可选诊断 |
| `npm run test:avatar` | 检索、注入验权、缓存与生成额度 |
| `npm run test:skills` | 私有包校验、下载和安装授权、文本执行边界、新旧权益与转换 |
| `npm run test:handbooks` | 专用凭据、发布并发保护、Vault 附件范围与中断恢复 |
| `npm run plugin:build` / `npm run plugin:check` | 生成受版本控制的 Obsidian 交付包，或验证安装包与源码一致；检查打包模块边界与许可证 |
| `npm run test:embedding` | 合成向量的协议、顺序、故障、容量、取消与检查工具默认离线；不调用真实供应商 |
| `npm run test:config` / `test:storage` | 配置组与 Storage 工具 |
| `npm run release:package` | 只在干净提交打包；插件源码与安装包一致、源码排除项、数据库摘要及输出不可覆盖检查；规则回归纳入 `test:config` |
| `npm run test:mail:scheduler` / `test:payment:scheduler` | 调度权限与故障处理 |
| `npm run test:db:media` | 历史媒体精确迁移保护 |
| `npm run test:db:concurrency` / `test:scale` | 可丢弃 PostgreSQL 17 / pgvector 的并发、故障恢复和规模基线 |

多数测试使用 PGlite / 内存夹具；真实并发测试需[独立 PostgreSQL](../docs/development/database-concurrency.md)。禁止把 `TEST_DATABASE_URL` 指向 Supabase 或真实业务数据库。

`admin-login-recovery.test.ts` 通过隔离依赖执行真实登录 action 和服务端网关，覆盖验证码通过后认领失败的错误传递、公钥误配拒绝及日志脱敏；不发送邮件或使用真实账户。

`ai-sdk.test.ts` 使用锁定 SDK 和合成供应商响应，验证现有四个供应商目标、三种生成协议、流式终止、取消、单次派发、错误脱敏及向量原始响应。`helpers/ai-protocol.ts` 提供标准响应夹具；这些测试不连接供应商，也不证明真实账户可用。SDK 升级必须重跑这些边界测试。

素材库回归在 `test:admin` 中校验原始摘要、图片完整解码、SVG 转换、跨文章登记校验及目录 RLS；浏览器夹具检查选图焦点、草稿保留和 6 MiB 文件直传／响应丢失后的手动恢复。夹具的 Storage 响应为替身，不等同真实云端对象权限通过。

单次日志、截图、导出包与调试结果保存到被忽略的 `.local-archive/`；当前测试和构建不得依赖归档文件。完整执行顺序见 [CI](../.github/workflows/ci.yml)。

浏览器测试复用实际业务组件，但不登录真实站点、不读取 `.env.local`、不连接托管 Supabase。运行前执行 `npx playwright install chromium`；截图与结果在被忽略的 `test-results/`。数据库回归另覆盖逻辑文档去重、普通专辑价格权威、初始化重放与冲突，不能用 UI 夹具替代 RLS 或支付测试。

SKILL 浏览器夹具验证配置草稿、版本分页、安装授权撤销、对话中断后只读恢复，以及模型输出不自动加载外部图片。Obsidian 视图夹具使用实际插件视图及平台控件适配，检查条目内操作、左右文稿列表、草稿覆盖确认、线上状态、进度更新不替换 DOM、README 缺失入口；它不包含真实 Vault 或凭据。真实下载、模型协议和 Obsidian 原生界面须另在部署验收中完成；插件单元测试不能代替真实 Vault 的首次草稿上传、共享附件和更新冲突验收。

Skill 交互回归另覆盖固定类型／公开权限、桌面右栏与手机抽屉、同页在线／本机模式切换、介绍正文保持、输入／主题／抽屉状态保留、旧对话链接及刷新恢复、断网后只读查询、模型图片不自动加载及安装提示词复制。手册插件回归覆盖根目录扫描、独立文件夹绑定、同步保留权限、草稿不发布／不公开、逐项进度与比对／上传草稿／网页发布引导，以及部分失败后跳过成功文稿、按原操作 ID 恢复。

部署检查页：`tests/admin-deployment.test.ts` 验证站主闸门、业务分组、缺项提示、可选功能关闭与人工状态；`tests/browser/deployment-checks.spec.ts` 用合成配置检查浅深主题、手机／桌面、键盘展开与无配置值泄露，不连接真实云端或触发业务动作。

`tests/admin-turnstile.test.ts` 使用实际迁移验证站主保存、密钥与公开配置原子更新、冲突及 RLS；合成 Siteverify 响应另验 hostname、action、容量和故障关闭，不连接 Cloudflare 或修改真实 widget。

全辑审核回归见 `admin-series-workflow.test.ts` 与 `browser/series-review.spec.ts`：设置并发冲突、批内整体回滚、同任务重放、未授权正文隔离、缺图提示、未保存设置阻断，以及浅深色手机布局。真实 PostgreSQL 作业另测同批重复请求并发，确保每篇只产生一个版本。
