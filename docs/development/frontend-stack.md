# 前端模块与技术栈

Next.js App Router 与 React 服务端组件承担取数和授权；客户端组件负责交互。Tailwind CSS 4、shadcn/Radix 原语和 lucide 图标组成界面，业务组件在原语外层定制。

- 主题：next-themes，默认 system，类名切换，偏好只保存在浏览器。`src/styles/tokens.json` 生成语义 CSS；不加载在线字体。
- 布局：AppShell 共享导航来源；桌面三栏、平板图标栏、手机底栏。后台使用 AdminNavigation。
- 列表：TanStack Table v8 受控服务端模式；`list-query` 解析参数，`list-resources` 按领域授权查询，AdminResourcePage 转为元数据，AdminDataTable 渲染当前页。
- 编辑：CodeMirror 6 工作台复用统一发布事务；复杂表单独立路由，短操作和预览使用既有快捷栏。
- 自定义页面：sanitize-html 保存/读取双道白名单；htmlparser2 构建 React 树，服务端替换明确允许的 cp-pricing/cp-subscribe，不执行 HTML 中的脚本。
- 配置与内容：site_config 为站点身份和商业配置权威；统一内容类型注册表管理路由；模板由白名单公开文档生成固定 JSON，不在运行时扫描仓库。

权限、支付和邮件继续使用既有 Supabase 与服务端路径。借鉴 [MkSaaS 模块组织](https://mksaas.com/docs/structure)和[服务端分页](https://tanstack.com/table/v8/docs/guide/pagination)的边界，不引入多租户或团队角色。
