# 自定义导航与代码栏目

站主在左侧栏内置导航之后追加自定义项：外部链接、独立页面、手册与活动，以及仓库中实现的交互栏目（代码栏目）。本文是开发维护规则；页面行为见[页面契约](../reference/pages.md#316-labname-代码栏目)，数据与权限见[产品契约](../reference/product.md#476-自定义导航与代码栏目)。

## 选型

| 需求 | 做法 |
|---|---|
| 介绍、方案、政策等静态内容 | 独立页面（`/admin/pages`，可 AI 生成初稿），在导航中添加 |
| 需要交互或数据、与站点外壳融为一体 | 代码栏目，路径固定为 `/lab/<name>` |
| 技术栈不同、需要自有后端或高度定制的小项目 | 独立部署，在导航中添加外部链接 |

主站不嵌入 iframe、不为子项目放宽 `frame-ancestors`，也不由后台生成或部署代码。

## 导航数据

`nav_items` 是自定义导航的唯一来源；内置导航（首页、博客、手册、技能、活动、服务、名片）在代码中维护。

- 一行对应一个目标：`external`（https URL）、`page`（`custom_pages`）、`series`（专辑）或 `section`（栏目名）。同一页面、专辑或栏目只能出现一次；目标删除时导航项一并删除。
- 两级目录：`group` 行没有目标，其他行用 `parent_id` 归入一个顶层 `group`，只有一层。数据库约束 `group` 不能有父级，触发器 `guard_nav_item_parent` 保证父级是顶层 `group`，删除目录时子项一并删除（后台移除目录前会把子项提升为顶层）。保存时仍是一份扁平有序列表，`child: true` 表示归入前面最近的目录，顶层项结束当前目录。停用的目录连同子项不进入公开投影；没有可见子项的目录由前台隐藏。
- `access` 只用于代码栏目：`public`（免费）、`login`（登录可见）、`subscriber`（订阅可见）。不做单篇购买式的栏目收费。
- 读取：前台只调用 `public_navigation()`，它只返回已启用、目标可公开读取的项目和渲染所需字段（含 `parent_id`），由 `buildNavigation` 组装成两级；表本身仅站主可读写。
- 写入：后台整表保存 `save_nav_items(p_expected, p_items)`，版本由 `nav_items_version()` 计算，过期版本拒绝覆盖；校验规则在 `src/lib/navigation/validate.ts` 与数据库约束各执行一次。保存后 revalidate 站点外壳。
- 激活：`src/lib/navigation/match.ts` 按路径段做最长前缀匹配，内置项与自定义项一起参与，同一时刻只激活一项；外链不参与。
- 页面的页脚链接仍由页面自己的“页脚链接”设置管理。
- 旧导航字段（专辑 `nav_enabled` / `nav_label` / `nav_order`，页面 `placement = nav`）在升级时复制进 `nav_items` 后原样保留，仅供回滚到旧应用；应用不读写它们，页面的旧 `nav` 位置按“不固定”显示。确认不再需要回滚后，可另以一个迁移删除这些字段（需同时更新迁移审查对该次删除的预期）。

## 代码栏目结构

```text
src/sections/<name>/
  manifest.json        # 栏目登记信息（schema：docs/contracts/section-manifest.schema.json）
  page.tsx             # 根组件（服务端），接收 { path, viewer }
  components/ lib/ data/
  *.module.css
  tokens.json          # 仅扩展档
  README.md            # 用途、维护人、独占依赖的理由
src/app/lab/<name>/[[...rest]]/page.tsx   # 薄路由，只调用 renderSection("<name>", Root, props)
src/sections/_sdk/                         # 栏目可用的唯一主站接口
src/generated/sections.json                # 登记表（生成）
src/generated/sections/<name>.tokens.css   # 扩展档栏目变量（生成）
```

`npm run sections:build` 读取全部 manifest，生成登记表与栏目变量 CSS；`npm run sections:check`（包含在 `npm run contracts`）检查产物同步与下列守卫。运行时只导入登记表，不读文件系统：登记表中的栏目就是本次部署实际存在的栏目。

脚手架：`node scripts/new-section.mjs new <name> --title … --description … [--icon …] [--tier standard|extended]` 与 `remove <name>`，模板在 `scripts/templates/section/`。本地 agent skill 位于 `.claude/skills/new-section/`，负责新建、迁移和删除栏目并在确认后开 PR。

## 访问判定

薄路由经 `src/lib/sections/route.tsx` 在服务端判定（规则在 `src/lib/sections/access.ts`）：

- 登记表中没有该栏目 → 404。
- 导航中未加入或未启用 → 访客 404；站主可预览并看到提示。上下线只需在后台切换，不需要重新部署。
- 登录可见 → 未登录跳转登录页并带回原路径；订阅可见 → 未登录先登录，已登录未订阅显示订阅入口。站主始终可进入。
- 导航读取失败时按不可用处理，不放行。

栏目通过 `viewer` 只拿到 `loggedIn` / `subscribed` / `owner` 三个布尔结论，拿不到会话、邮箱、权益明细或付费正文。栏目页面不进入 `/llms.txt`、`/card.json` 或分身上下文。

## 两个档位

| | 标准档 `standard` | 扩展档 `extended` |
|---|---|---|
| 组件 | `_sdk` 导出的站点组件 | 同左 |
| 样式 | 全局 token 与 Tailwind 工具类 | 另可在 `tokens.json` 定义 `--<name>-*` 变量 |
| 依赖 | 根 `package.json` 已有的包 | 另可登记本栏目独占的包 |

扩展档的 `tokens.json` 必须同时给出 `light` 与 `dark` 且变量相同；`contrast` 列出的文字 / 背景对按两种主题检查对比度（默认 4.5）。颜色优先用 `color-mix()` 从全局 token 派生，品牌色变化时栏目随之变化。扩展档若没有独占依赖或栏目变量，检查提示改回标准档。

## 守卫

`scripts/build-sections.mjs` 检查以下规则，ESLint 对 `src/sections/**` 的 `@/` 导入给出同样的编辑器提示。

**代码边界**
- 栏目只能导入 `@/sections/_sdk`、本栏目目录、React / Next 公共 API 与根依赖；栏目之间不能互相导入，相对路径不能离开栏目目录。
- 禁止 `@supabase/*`、`ai`、`@ai-sdk/*`、`next/headers`、`next/script`、`next/server`、`node:*`。
- 禁止 server action、路由处理器、中间件、SQL 文件、`process.env`、`dangerouslySetInnerHTML`、`eval` / `new Function`、`<script>`。
- 主站代码（`src/app/lab/` 薄路由除外）不能导入栏目；薄路由只能导入本栏目。`_sdk` 不能导出 service_role、支付、发布、后台、分身或 AI 模块。
- `src/app/lab/` 下只允许已登记栏目的 `[[...rest]]/page.tsx`。

**样式**
- 只用 `*.module.css`；禁止 `:global`、`:root`、`html` / `body` / `*` 选择器。
- CSS 与类名中不写字面颜色（十六进制、`rgb()`、`oklch()` 等），颜色来自全局 token 或栏目变量。
- 禁止网络字体与远程样式。外壳（左侧栏、主题、焦点环、正文基础字体）始终由主站控制。

**依赖**
- 扩展档登记的包必须写入根 `dependencies`、被本栏目实际使用，且只被本栏目导入；不能登记 React / Next；同一个包不能被两个栏目登记。
- 根 `dependencies` 中每个包都必须被代码导入（仅为满足对等依赖而声明的包列在脚本白名单中），因此删除栏目时必须同时移除其独占依赖。
- 许可证限 MIT、Apache-2.0、BSD、ISC，其他需维护者审查；不引入第二套 React / Next、UI 组件库、样式方案或状态管理库。
- 同一依赖或变量被两个以上栏目需要时，经正常评审提升进主站或 `_sdk`。

**体积**
- `npm run build` 之后运行 `npm run sections:budget`（CI 已包含）：栏目首屏客户端 JS 中、首页尚未加载的部分（gzip）不得超过 manifest 的 `budgetKb`。重型模块用 `next/dynamic` 或 `import()` 延迟加载，不计入首屏。

## 下线与删除

- 临时下线：后台导航中取消启用。
- 删除：`node scripts/new-section.mjs remove <name>`，按提示卸载独占依赖并重新生成登记表；合并部署后新的 Production 不再包含该栏目，`/lab/<name>` 返回 404。
- Vercel 历史部署是不可变快照，仍保留旧代码以便回滚；需要时在 Vercel 开启 Deployment Protection，限制历史部署地址的公开访问。
- 后台导航中的对应项标为“本次部署中不存在”，前台自动隐藏，由站主删除。

## 私有栏目与公开版本

栏目源码随仓库分发；仓库公开时任何人都能克隆。需要保留栏目源码时，在私有仓库开发并部署，再从私有仓库导出不含栏目的公开版本：

```bash
node scripts/export-public.mjs <目标目录> [--ref HEAD]
```

- 目标为空目录，或公开仓库的干净克隆（保留 `.git`，其余内容整体替换，供审阅后在那里提交）。工具读取已提交的 `--ref`，不改动当前仓库的工作区与索引，也不受 `export-ignore` 影响。
- 删除每个栏目的目录、`/lab/<name>` 薄路由、生成的栏目变量 CSS 与浏览器测试（`tests/browser/<name>.spec.ts` 或 `section-<name>*.spec.ts`），重新生成空登记表；栏目在 manifest 登记的独占依赖从 `package.json` 移除并重新生成 `package-lock.json`。
- 导出后扫描对已删除栏目（`@/sections/<name>`、`/lab/<name>`、登记名）与独占依赖的引用，仍有引用则失败并列出文件；在源仓库消除引用后重新导出。
- 在导出目录执行 `npm ci` 与提交前门槛后再提交到公开仓库。
- 仓库私有只保护源码。栏目的客户端代码与其中的数据仍会下发到有权访问页面的浏览器（生产构建不含 source map），导航访问设置也不保护静态脚本；不能被提取的内容需留在服务端按步骤下发。

## 移动端

本项目以电脑端使用为主。代码栏目只在 ≥768px 的侧栏与图标栏显示；手机目录中隐藏并提示“更多栏目请在电脑上访问”，直接打开栏目地址时显示同样的建议。外链、页面与专辑导航在手机上正常显示。

## 回归

- `tests/admin-navigation.test.ts`：最长前缀匹配、输入校验、公开投影、RLS 与 RPC 授权、乐观版本、旧导航字段迁移、栏目访问判定。
- `tests/config-sections.test.mjs`：登记表生成、全部守卫、栏目变量与对比度、依赖归属、脚手架新建与删除。
- `tests/config-export-public.test.mjs`：公开导出删除栏目、薄路由、栏目变量、浏览器测试与独占依赖，并报告残留引用。
- `tests/browser/navigation.spec.ts`：嵌套路由激活、外链属性、三档断点、手机提示与后台导航编辑。
- `tests/admin-starter-content.test.ts`：默认内容完成后两项导航才出现在公开投影中。
