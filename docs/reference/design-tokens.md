# 万有AI · Design Tokens 与组件清单

> 配套：[页面契约](pages.md)、[线框图](wireframes.md)、[前端技术栈](../development/frontend-stack.md)、[产品契约](product.md)。
> 本文档补齐契约留下的最后一层：**色板、字体、间距、布局尺寸（令牌）+ shadcn 原语与业务组件的构成清单**。开发转交时，契约答「页面上有什么块」，本文答「这些块长什么样、由什么构成」。

---

## 0 · 视觉系统与纪律

采用 Cloud Glass 浅色与 Terminal Wave 深色，两套模式共享布局和组件语义。品牌原色保留，操作和文本使用满足对比度的派生色。

- 色板、尺寸和字体唯一维护源为 `src/styles/tokens.json`，`npm run tokens:build` 生成 CSS，`tokens:check` 检查漂移。原始导出不直接作为运行时样式。
- 所有字体采用系统栈，没有字体网络请求。深色标题可使用系统等宽字体，中文回退可读系统字体。
- 组件在 shadcn 原语外层组合；状态徽章通过 StatusBadge 输出，语义色来自 token。
- 主题跟随系统，访客可选择浅色或深色；偏好保存在浏览器，与站主配置分离。

## 1 · 色彩

浅色背景淡紫、半透明白表面、紫色品牌主色与青绿辅助色；深色背景深绿黑、分层深绿表面、荧光绿品牌色与琥珀辅助色。`primary` 是可读的链接和操作色，`opc-primary` 保留设计品牌原色。`accent` 是导航/悬停选中底色，`opc-accent` 是品牌辅助色，两者不混用。

Lucide 控件图标使用 12/14/16/20px、stroke 2，小尺寸可 1.5；辅助图标默认 secondary、激活 primary、弱化 muted。所有图标有语义文字或可访问名称。

普通文字对比度至少 4.5:1；必要控件边界和大字按适用要求至少 3:1。玻璃表面按实际叠加背景测试。状态具备可见文字或图标，不能仅靠颜色区分。success/info/warning/destructive 为成对语义色，StatusBadge 组合使用。

## 2 · 字体与阅读

正文使用系统无衬线；代码使用系统等宽。中文正文 1rem、行高 1.8、阅读宽度 42em；标题不添加中文字符间距。代码块、表格、引用、链接和图表使用同一套主题 token。图片不反色，Hero 前景明暗独立于全局主题。

## 3 · 尺寸与反馈

间距采用 4/8/12/16/20/24/32px；圆角为控件 8px、tab 10px、中等 12px、卡片 14px、面板 16px、pill 999px。图标使用 lucide。

内容卡片默认无投影：浅色半透明白表面与白色 1.5px 描边，深色实体绿黑表面与 1px 暗边。悬停使用 40° Aurora 渐变描边和外光，标题、封面标签、阅读动作同步变化；按压使用独立表面、2px 内描边与内影。描边由伪元素绘制，几何尺寸不变。键盘焦点为无障碍补充；设计稿未定义的 selected/disabled 卡片不伪造为原稿状态。玻璃效果仅用于主要表面，提供实体底色回退。减少动态效果设置下移除非必要动画与过渡。

## 4 · 布局与导航

- ≥1280px：236px 左栏、中间弹性内容、按页面需要出现的 300px 右栏。
- 768–1279px：左侧图标栏，完整目录和分身按需展开。
- <768px：单栏，底部首页/目录/分身/我的。未启用分身时隐藏入口；底栏处理安全区，目录与分身抽屉互斥。
- 后台使用自己的任务分组导航，移动端使用菜单抽屉。分组标题以 Lucide 图标作为层级识别，不叠加底色、描边或加粗；子项文字与一级标题文字对齐，为图标和间距保留空位，整行点击区保持完整，不绘制分支线或增加层级装饰。标题只作分组，当前页面由子项的选中态标识，键盘焦点独立可见。右侧快捷操作保持独立焦点与宽度规则。
- 外观使用单个 pill 按钮，按“跟随系统 → 浅色模式 → 深色模式 → 跟随系统”循环；当前偏好由 Monitor / Sun / Moon 图标与文字共同表达，不以系统解析后的颜色替代偏好。按钮保持固定宽度、圆角与清楚的键盘焦点，Enter / Space 均可切换；可访问名称说明当前与下一模式，前后台及移动端目录共用。偏好仍保存于浏览器，切换不提交表单或重置编辑内容。

## 5 · 内容表面

首页保留现有五类内容结构；Hero、卡片、标签和搜索统一层次。上传封面保持原始色彩，Logo 可使用安全底板。空态提供说明与当前可执行动作，错误态不能伪装成空记录。主题切换不重置编辑状态。

## 6 · 组件清单

### 6.1 shadcn 原语

按实际使用安装 button/card/badge/input/textarea、separator/skeleton/sheet/scroll-area、select/tabs/tooltip、dropdown-menu/dialog 与表单相关原语；文件以 components/ui 为准。不修改内部实现，业务变体在外层组合 className 和 props。未实现的全站命令搜索不属于本版。

### 6.2 业务组件清单（构成 = shadcn 原语 + 关键 tokens）

| 组件 | 构成要点 | 契约锚点 |
|---|---|---|
| `ThemeProvider` / `ThemeToggle` | 顶层主题与单 pill 循环切换；服务器占位稳定，挂载前禁用，偏好不混入业务数据 | §0 / §4 |
| `TurnstileWidget` | 分身与询价共用紧凑控件；固定操作类型、过期清空、单次提交后重置；跟随本站浅深主题，切换后重新挑战且保留表单 | 安全与人机校验 |
| `TurnstileChallenge` | 匿名分身发送时按需打开居中弹窗；通过即关闭并继续该次发送，取消保留原输入；加载失败可手动重试，键盘焦点回到发送入口 | 安全与人机校验 |
| `NavigationRail` / `MobileNavigation` | 共享导航来源、平板图标栏与手机底导航、抽屉互斥 | §4 |
| `ContentCard` | 共边 120px 封面、12px 内容间距、14px 加粗标题与 11px 元信息；四类内容卡共用原稿默认/hover/pressed状态，不修改ui原语 | §3 / §5 |
| `PricingPlans` / `PricingFeatureList` | 三列方案 + 服务询价横条；label13→price30/period12→分隔→Lucide功能列表→全宽pill CTA；真实配置决定价格与动作 | §5 / 自定义页面契约 |
| `AppShell` | grid 三列（`--w-left-nav` / 1fr / `--w-right-panel`）；xl 下右列收 `--w-right-collapsed`（由 `RightPanelCollapseContext` 驱动列宽切换）；md 下改手机底部导航，中间宽度显示图标栏 | §2 / 2.6 |
| `LeftNav` | 顶栏 `SiteLogo` + 站名/简介 + ScrollArea 导航 + Separator + 底部固定身份区；站主登录时后台区段为单入口「网站管理」 | 2.1 / 2.4 |
| `SiteLogo` | `identity.logo_url` 图片（size-9、object-contain 不裁切）+ 缺省「站名首字」字标；左栏顶部与移动端抽屉共用 | 2.1 |
| `CardIdentityAside` | /card 左身份栏：大头像（size-32）+ 站名 + 图标事实行 + CTA（预约/邮件）+ 一句话 bio + tags + 默认折叠的 AI 读取入口 | 3.11 |
| `MachineCardLink` | 名片身份栏的原生 details/summary、公开地址只读 Input 与低优先级复制按钮；成功才显示已复制，失败聚焦地址并提示手动复制 | 3.11 |
| `OwnerAvatar` | `identity.avatar_url` 圆形头像（size-20）+ 缺省「站主名首字」字标；右栏名片与 /card 共用 | 2.3 / 3.11 |
| `NavIdentityZone` | 匿名=ghost「登录」+ SubscribePill；注册=Avatar+DropdownMenu；已订阅 pill 消失 | 2.4 三态 |
| `SubscribePill` | Button `rounded-full size-sm`，primary——全站唯一常驻销售元素 | 2.4 |
| `RightPanel` | Tabs 段控（对话 ⇄ 本页目录）+ Sheet（<768 底部抽屉）+ ScrollArea；表头折叠符号（xl 完全收起为右上角机器人悬浮钮，点开还原；768–1279 按需展开） | 2.3 |
| `AvatarChat` | 消息气泡 card/muted+ 多行 Textarea（`MentionInput` 的 @ 补全同源；Enter 发送 / Shift+Enter 换行，按内容自增高）+ 框内右下角发送按钮；面板头部常驻 AI 标注；会话只有一个家=右栏 | 2.3 |
| `MentionInput` | 对话输入 + @ 触发自动补全（已发布内容模糊匹配）+ 选中项 chip 化；@引用 = 补发门票（钉载 + 加权，PRD §4.6） | 2.3 / 3.1 |
| `PageOutline` | 服务端锚点列表 text-sm；OutlineLinks 对已渲染节点做滚动高亮，当前项 primary 左边框 | 2.3 |
| `HeroCard` | 大 banner 背景图（`banner_light_url` / `banner_dark_url` 分别配置浅深背景，单侧留空时使用对应内置 Cloud Glass / Terminal Wave 图片；前景和控件自动跟随主题，开阔排版无内嵌圆角面板；自定义图片保持色彩，用整幅渐变保护文字）+ 一句话（`whitespace-pre-line`，站主配置内换行即断行；text-4xl / sm:5xl / lg:6xl）+ FactBadges + HeroAskBox + 专注/不做摘要；订阅 pill 仅左栏，Hero 内不渲染 | 3.1 块 1 |
| `FactBadges` | Badge outline + lucide 小图标；只放可验证事实，声誉不自陈 | 3.1 纪律 |
| `HeroAskBox` | Input + 图标按钮（→）；placeholder 读 home_config；提交唤起 RightPanel 并带入问题 | 3.1 纪律 |
| `ListBrowser` / `TypeColumn` | 工具条与卡片网格组合；类型栏目服务端取数，客户端搜索与排序 | 3.2 / 3.4 |
| `ContentLoadError` | 错误边界提示 + 重试 Button，取数失败与空列表区分 | 3.2 / 3.4 |
| `ListToolbar` | Input 搜索 + Select 排序 + 权限计数 chips（Badge 可点选过滤） | 3.2 / 3.4 |
| `CardGrid` | grid gap-6；2–3 列自适应，<1024 单列；Skeleton 占位 | 2.6 加载态 |
| `ArticleCard` / `AlbumCard` / `ServiceCard` | 统一解剖：封面/emoji + 标题 + StatusBadge + line-clamp-2 摘要 + 右侧动作；静止态即有边框 + xs 阴影（hover 加深边框 + shadow-sm）；封面优先（README `cover_url`，首页橱窗与栏目同源），无封面时技能卡回退 `ManifestPreview`（file_manifest），再无则类型占位图标 | 模式 3 / 3.4 |
| `ArticleDetail` / `SeriesDetail` | 服务端标题、正文、paywall、类型扩展与页脚组合；四类详情共用 | 3.3 / 3.5 |
| `ReadingShellBridge` / `ReadingShellProvider` | 注入章节元数据、已渲染目录或经服务端授权的 Skill 交付槽位；离页清理面板 | 2.1 / 2.3 |
| `ArticleHeader` / `ContentImage` / `MermaidDiagram` / `ContentJsonLd` | 元数据标题；安全图片；服务端静态图；同源公开价格 JSON-LD | 3.3 / 3.5 |
| `ReadingSkeleton` | 阅读标题与正文段落 Skeleton 占位 | 2.6 |
| `ReadingActions` | 阅读页讨论入口与当前内容上下文 | 3.3 / 3.5 |
| `ChapterTree` | 树列表 + Lock 图标（锁定◐）+ 当前项 primary；顶部「« 返回栏目」 | 2.1 / 3.5 |
| `ProseReader` | `--reading-width` + leading-[1.8]；代码块 `--muted` 底 + mono；统一渲染管线 | 2.2 / 产品 §4.2 |
| `OrderContentLink` | 订单列表、详情、支付返回页与后台共用内容入口；仅传公开元数据和站内路径，不授予阅读权限；不可用内容显示说明 | 3.8 / 3.9 |
| `PaywallBlock` | Callout 变体：节选止点 + 权益说明 + 价格 + 主/次 Button（上下文函数注入） | 2.5 / 3.3 |
| `AudienceChips` | Badge outline 职业 / 人群 chips（series.audiences）；静态无跳转，空数组不渲染 | 3.5 |
| `SubscribeCrossCard` | Callout 变体：订阅一句话 + 订阅价 + 入口 Button；与单买主 CTA 并列，**已订阅不渲染** | 2.5 / PRD §4.3 |
| `ArticleFooter` | Separator + text-sm muted 版权行 + 所属专辑回链；评价与讨论按当前阅读动作显示 | 3.3 |
| `RegistrationCallout` | Callout + 活动 StatusBadge + 报名动作 | 3.5 |
| `ServiceDetail` | 六要素 Definition 列表（交付物 chips / 工期 / 价格 / 容量 / 协议快照键值）+ 约束块 + 询价 Callout与询价表单| 3.7 |
| 技能下载提示 | 仅有已配置且经权威验权的下载入口时提供动作；未配置显示不可用，不生成私有桶直链 | 3.5 |
| `Callout` | 自绘：1px 边框卡 + 图标位 + 标题/正文（FlowUs 式；paywall/报名/通知共用） | 模式 9 |
| `EmptyState` | lucide 48px muted + 一句话 + 单动作 Button | 模式 11 |
| `StatusBadge` | §1.2 映射表的唯一渲染出口（access/已购/活动/履约/停售） | 1.2 |
| `InquiryForm` | Form + Input/Textarea/Select；字段=card.json accepted_fields 同源 | 3.7 |
| `OrderTimeline` + `MilestoneCard` | 自绘竖向时间线 + 待办归属 Badge；快照取 agreement_snapshot | 3.9 |
| `AdminTabs` / `AdminPanelProvider` / `AdminPanelPortal` | 后台页签（兼容旧编辑器的面包屑；主导航使用 AdminNavigation）；默认关闭的快捷操作栏，桌面展开留出列宽，窄屏抽屉；承载条目操作和匿名预览，关闭恢复触发点焦点 | 3.13 |
| `AdminInbox` | 留言处理、原始会话只读展开、公开问答问题/答复编辑、去个人信息与付费内容确认、发布/撤回；公开表单首次为空，只回填既有公开稿 | 3.13 |
| `DeploymentChecks` | 发布整顿 | 服务端只读部署诊断与首次配置步骤；按业务分组的语义列表 + StatusBadge + 修复链接 + 原生 details/summary 验收步骤（可键盘展开）；小屏纵向排列，不输出配置值 | 3.13 |
| `AISettingsForm` | AI 设置 | 共享生成连接、知识库连接、分身指令与开关；凭据不回显、版本冲突保留输入，合成连接检查须显式确认 | 3.13 |
| `KnowledgeIndexPanel` | AI 设置 | 单一当前步骤、默认初次／增量选择、来源与片段进度、明确暂停与恢复；结果自动恢复，已完成步骤仅留摘要，历史清理折叠 | 3.13 |
| `KnowledgeEvaluationReport` | AI 设置 | 错配问题优先，以警示边框、浅底、图标及文字高亮；返回来源可逐项核对采纳至独立草稿，原报告不变；未确定阈值时明确候选含义，分数收进技术详情 | 3.13 |
| `KnowledgeQuestionGenerator` | AI 设置 | 有界分批自动出题、范围许可、进度保存与未知结果手动恢复 | 3.13 |
| `KnowledgeAnswerPreview` | AI 设置 | 单题回答、默认匿名视角、独立费用确认、不创建真实会话 | 3.13 |
| `KnowledgeEvaluationEditor` | AI 设置 | 编辑／发送确认／结果互斥；来源采纳追加而不替换原预设，支持逐项移除及保留草稿回看原报告；未改问题不重复发送，修改后重新确认费用 | 3.13 |
| `SettingsForm` / `ServiceForm` | 站点基础信息、首页五块、名片与商业配置；服务六要素、价格容量和状态；标准字段表单及错误反馈 | 3.13 |
| `EventDetailsForm` | 活动时间、地点、报名说明、名额、会员类型与票价；活动状态单向流转；保存验证及并发冲突提示 | 3.13 |
| `SeriesSettingsForm` / `SeriesPublication` | 专辑统一设置；元数据清单、选择范围、分页、预览右栏、整批确认、原任务查询与重试；正文与权限变更由站主确认 | 3.13 |
| `SeriesCreateForm` / `ContentControls` | 草稿专辑创建；README 选择与上架；暂停 / 恢复 / 归档确认；操作反馈与并发更新检查；文章类附「编辑内容」入口（/admin/content?article=id 装载）。复用 Input / Button 与原生 select | 3.13 |
| `AdminLoginForm` / `AdminDashboard` | 站主 magic link 表单、无权限态、独立加载的指标卡和常用入口；复用 Input / Button 与语义列表 | 3.13 |
| `AdminDataTable` / `AdminResourcePage` | TanStack 受控服务端表格、筛选工具栏、手机摘要卡、20/50/100 分页和错误状态 | 3.13 |
| `SkillManager` | 公开介绍编辑入口、私有包上传与状态查询、不可变版本清单、当前版本和使用方式设置；失败保留输入，不自动重新上传 | Skill 契约 |
| `ConversationBody` / `ConversationBubble` / `ConversationComposer` | 分身与 Skill 共用的滚动消息区、双侧气泡、多行输入与发送控件；Enter 发送、Shift+Enter 换行、输入法组合不误发送；只共用展示，不合并请求、授权或会话 | 2.3 / Skill 契约 |
| `SkillDelivery` / `SkillChat` / `SkillChatProvider` | Skill 专属右栏中的授权下载与可复制、可撤销安装说明，使用地球／电脑图标切换模式；同页右栏内显示 Skill 用途、输入要求、文本能力边界及对话；跨模式、主题与抽屉保留输入，会话状态独立并按版本隔离，模型图片不自动加载 | Skill 契约 |
| `ContentWorkbench` / `PublicationFeedback` | frontmatter 字段、文件导入、图片上传（附件可直选为封面）、草稿下载、显式发布与诊断 / 安全重试；不加载数据库正文到浏览器 | 3.13 |
| `MediaBrowser` / `MediaPicker` / `ImageField` | 站主专用分页图片网格、上传进度、描述编辑与归档；同一选择器用于正文、封面、横幅、头像、Logo 与自定义 HTML。模态框管理焦点，图片保持原色；归档不删除已有引用 | 素材库契约 |
| `MarkdownEditor` | **CodeMirror 6**（成熟第三方库，MIT，Obsidian 同款）：markdown 语法高亮 / 行号 / 快捷键 + 自写图片上传/拖拽插入（服务端即刻传 Storage 插入规范 URL）+ frontmatter 表单态；dynamic import 仅客户端加载；**硬要求：`<!-- paywall -->` HTML 注释可见可移（编辑器保持源码编辑形态）**；插入付费切点按钮 / `⌘/Ctrl + Shift + P`；重复调用定位已有切点。通过快捷操作栏打开 `PreviewPane` | 3.13 后台 |
| `PreviewPane` | 复用 `ProseReader` 同一渲染管线 + 图片渲染 + 付费墙**匿名视角截断**与切点高亮；切点调整即时重渲染（预览只是渲染，落库仍走发布函数） | 3.13 / 页面 §3.13 |
| `EntryForms`（服务/活动/名片） | Form + Input/Textarea/Select 组合：服务六要素、event_details 字段与生命周期 Select、名片 identity/constraints（保存即 /card、/card.json 生效） | 3.13 |
| `CustomHtmlBody` | 自定义 HTML 正文渲染容器（渲染时再净化）；/p/[slug] 与首页自定义区共用 | 3.13.5 |
| `PageEditorRoute` / `CustomZoneEditor` | 自定义页列表与编辑器（预览/编辑切换 + AI 生成初稿）；站点配置里的首页自定义区编辑块（从页面复制 + 预览） | 3.13 |
| `CardPanel`（/card 分区） | 完整形态为 /card 中列内容卡片（供给 / 约束 / 不接 / 协议 / 实证，统一 SectionCard 容器）；compact 变体为右栏轻量名片（头像居中、无站名/协议/实证分区）；与 /card.json 同一数据函数 | 3.11 |

---

## 7 · 验证

维护源生成检查、实际表面对比度、匿名主路径、键盘焦点与抽屉互斥、四档宽度、主题持久化和编辑内容保留均属于回归范围。截图和浏览器夹具位于 `tests/browser/`；夹具不连接真实数据库，不替代完整部署验收。

## 8 · 后台组件

AdminNavigation 提供任务分组，AdminDataTable 只接收当前授权页的元数据。AdminResourcePage 负责领域映射；页面不建立任意表 CRUD。SeriesSettingsForm 管理通用专辑介绍和导航，类型扩展保持专用表单。StarterContent 只通过服务端动作载入版本化模板。

SecuritySettingsForm 提供人机校验开关、公开 Site Key、留空保留的密码输入与显式删除；失败保留输入，成功更新配置版本，不把保存成功当成真实挑战通过。

全文编辑使用 ContentWorkbench / MarkdownEditor；自定义页使用 PageEditorRoute，预览与保存双道净化。CustomHtmlWithWidgets 服务端替换 cp-pricing/cp-subscribe，PricingPlans 复用业务价格与购买入口，不在 HTML 内保存价格快照。

后台预览使用既有快捷栏：桌面非模态、窄屏抽屉；失败不清空输入，关闭不丢草稿。关联操作保留对象 ID 与返回位置，URL 不携带正文或凭据。

自定义页面使用同源语义 CSS 与受控 Lucide 图标槽；系统提示词约束页面、分节和卡片层级，生成结果另做结构校验，见[自定义页面契约](../contracts/custom-pages.md)。

### Obsidian 手册管理器

插件使用 Obsidian 原生控件与主题变量。每份手册在自身展开区完成操作；列表按本地／线上／本次操作三列对照，正文差异使用左右两栏，差异和读取错误分别表达。进度只更新当前条目，不重建整页。主操作为上传草稿，网页设置提供固定入口；不提供发布、权限或线上删除控件。

手册插件使用三步进度（比对文稿 → 上传草稿 → 网页发布），每条手册仅当前步骤突出主操作；其余动作使用次级样式。已完成发布的线上状态可回传到本地；子目录文件不会造成根目录手册的待同步误报。
