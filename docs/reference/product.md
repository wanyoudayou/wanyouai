# 万有AI · 单OPC版 MVP PRD

> **阅读指引**：§2 是范围契约；§4–§6 是需求主体（可直接开工）；§9 是发布标准；§11 补充安全与用量规则。

图片素材作为站主内容资产统一管理：独立上传、文章与专辑导入、封面和站点选图共用 Supabase 素材库。图片公开读取，目录仅站主可管理；归档保留引用，不提供物理删除，具体边界见[素材库契约](../contracts/media-library.md)。

---

## §1 产品定位

> **万有AI 是开源（MIT）的 OPC 站点系统：内容、订阅、服务、活动、数字分身，一站自持，对人与 Agent 双向可读。每个 OPC 部署自己的实例，实例间以开放协议（card.json / llms.txt）互操作。**

| 维度   | 定义                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 部署形态 | Next.js on Vercel + Supabase 托管；仓库首次公开须通过发布门槛，域名与数据自持 |
| 数据主权 | 内容、订单、权益、用户数据全归站主，一键导出                                                                                            |
| 服务对象 | 站主（OPC 本人，唯一管理员）+ 访客（匿名/注册/订阅）+ Agent（机器访客）                                                                       |
| 差异化  | OPC CARD 对 Agent 可读（/card.json + /llms.txt）；服务协议六要素；对话回流内容资产                                                      |


**三条产品红线**：
1. **开源 ≠ SaaS ≠ 多租户**：一个部署 = 一个 OPC；
2. **可部署性是一等需求**：非技术 OPC 能按 README 一键部署出自己的实例；
3. **AGENTS.md 是部署与贡献的共同宪法**：环境变量、状态机语义、发布协议，人与 Agent 共读。

---

## §2 MVP 范围契约

| #   | 域        | 内容                                                                                                                                                             |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 内容       | 博客 + 手册/活动专辑 + 独立 Skill+ 篇内付费墙 + 状态机                                                                                                                           |
| 2   | 交易       | 账户（邮箱注册）+ 订单 + 在线支付（zpay，易支付协议兼容）+ Entitlement 权益并集                                                                                                 |
| 3   | 购买粒度     | 订阅（包年，全站）/ 专辑与 Skill（永久，含更新）/ 单篇（永久，仅独立付费文章）                                                                                                                          |
| 4   | 服务       | 服务页 + 六要素协议 + 询价表单 + 简易履约管道 + 交易锚定评价                                                                                                                           |
| 5   | 活动       | 活动即专辑（series + event_details 1:1）+ 两类（会员专享/开放）+ 票务复用订单 + 沉淀=专辑内文章（类型解耦）                                                                                        |
| 6   | 数字分身     | **一个**分身：RAG、身份分层引用、转人工（HITL）                                                                                                                                  |
| 7   | Agent 接口 | /card.json + /llms.txt（发布时增量重生成）                                                                                                                               |
| 8 | 供给侧 | Web 文件夹导入/待发布修订、内容工作台、唯一站主后台与可配置站点 |
| 9   | 底座       | 邮件通知 + 每日备份 + AGENTS.md 部署宪法                                                                                                                                   |
| 10 | 开源工程 | MIT、中文部署文档、Vercel 导入、整合 SQL、CI 与可关闭署名；首次公开前完成发布验收 |

---

## §3 身份与权限分层

| 身份          | 取得方式                       | 可读范围               | 分身日配额           |
| ----------- | -------------------------- | ------------------ | --------------- |
| 匿名          | —                          | public 内容 + 付费文预览段 | 少量生成轮次（按 IP 软限）  |
| 注册用户        | 邮箱注册                       | + registered 内容    | 中等（如 20 轮）      |
| 订阅会员        | 包年订阅                       | 全站付费内容 + 订阅专属内容 | 高（如 100 轮，成本护栏） |
| 站主          | 部署者                        | 全部 + 后台            | —               |
| Agent（机器访客） | fetch /card.json、/llms.txt | 与匿名同（付费正文永不下发）     | 走声明式接口，不占聊天配额   |

---

## §4 功能需求

> 各路由的块级页面结构、三态分支与空态，见配套文档《[页面契约](pages.md)》。

### 4.1 首页

- **名片 Hero**：第一人称一句话（帮谁·做什么·交付什么）+ 事实徽章行（只放可验证事实，不自陈声誉）+ **问句输入框**（首屏一句话提问直连分身：提交唤起右栏对话并带入问题）+ 专注领域与「不做什么」摘要；订阅入口位于侧栏，AI 读取链接位于名片页的可展开区域
- 其余五块按内容类型分区：博客（最新文章）· 手册 · 技能 · 活动（进行中/报名中）· 服务——五块固定模板，site_config 只管显隐/顺序/文案；名片 Hero 是固定首屏（`hero.enabled` 控制显隐），不参与五块排序
- **内容动态调用**：手册/技能分区取**站主精选优先**（置顶 featured 排前，其余按更新；未标精选回退最新 published——部署零配置即有内容）；博客 / 活动 / 服务分区按时间与状态自动，随发布更新（发布通道 revalidate）；**无个性化、无算法推荐**——所有人看到同一首页，精选是站主编辑动作，不是推荐系统

### 4.2 内容（核心模块）

**内容组织**：专辑是文章集合，包含手册与活动；独立 Skill 是文章的变体，介绍与私有交付包分别管理。文章类型为 `blog`、`chapter`、`skill`。旧普通专辑保留 ID 转为手册，旧技能系列通过固定映射保留章节和权益。

| 类型 | 形态 | 说明 |
|---|---|---|
| 手册 | `series.type=handbook` | README 与章节组成的知识内容，支持按专辑购买与订阅 |
| 活动 | `series.type=event` | 介绍、报名、核销和活动沉淀 |
| Skill | `articles.type=skill` + `skills` | 公开介绍、私有不可变版本包、授权下载及可选文本对话 |
| 博客 | `articles.type=blog` | 独立时序文章，可公开或按阅读权限发布 |

**公共字段**：标题 / 摘要 / 封面 / 标签 / `access` / `<!-- paywall -->` 切点（受限内容缺省无预览，访问由 `access` 决定）；专辑级另有两个可选字段——`task`（**任务一句话**：「用它做什么」——详情页 landing 首行、/llms.txt 条目句、card.json skills 条目三处同源）、`audiences`（**职业 / 人群标签**：详情页静态 chips）。

**媒体嵌入（MVP 媒体类型 = 图片）**：
- 网页文件夹导入仅扫描根目录 Markdown，图片及其他附件忽略；文稿先保存草稿，图片在编辑器素材库补插后再发布。Obsidian 插件解析根目录笔记实际引用的 Vault 内图片（包括共享附件目录），校验并上传到公开素材库；无关文件与子目录笔记不上传。
- Web 渲染：图片 → next/image（管道尺寸转 width）；SVG 消毒或发布时转 PNG；mermaid 组件
- **越界媒体硬失败**：视频 / 音频 / PDF 嵌入 → 发布 BLOCKED（明确报错，不静默坏链）
- 图片存公开桶，哈希名不是访问控制。图片不得承载需要权限保护的正文或私密资料；受限文件另走经审查的下载能力。

**README 机制**（手册与活动）：
- README = 专辑内一篇 chapter（`series.readme_article_id` 指向）——**内容对象而非字段**：享有正文表、版本、切块、聊天室的完整机制；专辑首页自动加载——相当于落地页 / 说明页（活动即介绍页）
- README **须为公开章节**：绑定时验证同专辑归属、公开阅读权限与已发布状态；付费墙标记不截断公开章节，其他章节仍按各自权限判定
- 作用：陈列结构、使用说明、更新日志——先让读者（和 Agent）看懂"这是什么"，再谈付费

**Skill 的交付与使用**：介绍全文公开；免费包登录后使用，收费包检查直接购买、有效订阅或站主身份。独立包不进入公开素材库或全站向量索引；在线模式仅支持绑定包内文本读取，不运行脚本。宿主请求结构化输出并由代码校验动作；会话固定版本并逐轮验权，不以格式合规代替效果验收。完整限制与接口见 [Skill 契约](../contracts/skills.md)。

**Obsidian 手册上传**：插件使用可撤销的手册专用凭据，只读取选定 Vault 文件夹及实际引用图片，单向上传为线上草稿；详情、价格、权限与发布在网页后台完成。左右列表比对后可明确以本地内容覆盖线上草稿，保留历史；比对后再次变化则停止。仅在线上的内容不删除，线上状态可静默刷新到本地，部分成功按原任务恢复。见 [手册同步协议](../contracts/handbook-sync.md)。

**状态机**：`draft → published ⇄ paused → archived`
- `paused` = 停售不停读（已购可读，不再新售）——下架的 MVP 语义
- `archived` = 停读，**不退款**；告知义务前移到订单支付页（「知识性数字虚拟商品，一经售出概不退款」），停售时以注册邮箱发送停售通知（**含 3 个月权益保留期**），停售满 3 个月后才可归档，归档静默不通知

**互动**：
- **文章公共聊天室**：**聊天室不是独立容器**——分身只有一个、索引只有一份（§4.6）；文章页入口 = 钉载该文可读部分 + 检索加权，门票改变席位（初始视角）与对话归宿（挂该文、可公开），不改变可探索范围（全域检索，验权只看用户权益）。从文章进入的访客在室内与分身对话（按 §3 配额，缓存与检索命中优先应答），参与者实时可见；首页/站外唤起的分身对话为 1:1 私聊，不挂文章、不公开
- **审核公开**：房间对话默认待审核，站主审核后设置公开属性；公开后所有人可读（含匿名，无权益门槛、无积分消耗），公开时去除个人身份信息
- **信用背书**：讨论区是信用背书，公开阅读永远免费（无权益门槛、无付费墙）；公开讨论的存在与规模是文章的置信度信号（展示公开讨论数等事实，不做算法评分）；公开对话进入检索层，相似问题被历史讨论直接命中
- 落地评价：注册且可读该文的用户可评（效果图 + 评分 + 文字）——评价资格与阅读资格绑定；评分 + 公开讨论共同构成文章置信度

### 4.3 会员与交易

**空白部署配置**：年度订阅价格可以未配置（`subscription_price = null`），此时不提供年度订阅商品；站主仍可开通单篇、专辑或活动收款。已填写的年度价格必须大于零。中性安装不预设站主售价、收款或分身开关。

**购买粒度与权益属性**：

| 粒度 | 范围 | 期限 |
|---|---|---|
| 订阅（包年） | 全站付费内容 + 订阅专属内容（`subscriber`）+ 分身高配额 | 1 年，可续 |
| 专辑 | 专辑全部文章 + **后续更新** | 永久 |
| Skill | 指定 Skill 的合法版本下载与站主启用的文本对话 | 永久，受生命周期约束 |
| 单篇 | 仅该篇（**仅独立付费文章可单买，专辑内文章不单卖**） | 永久 |

**双轨并列（成交页纪律）**：单买与订阅**同屏共存、交叉引导**——专辑 / 单篇购买按钮旁固定放**订阅交叉卡**（「订阅解锁全站付费内容与专属内容，本专辑 / 本篇也包含在内」+ 订阅价 + 入口）；已订阅者不显示（与「成交后停止销售暴露」同一纪律），全站订阅包含付费单篇，不再引导订阅者重复购买。

**在线支付（唯一收款通道）**：
1. 用户下单 → 唤起平台支付 → 回调验签 → Entitlement 自动开通 + 邮件通知——收款全链路零人工环节
2. 订单状态独立于支付状态：`paid ≠ fulfilled`，失败可重试
3. `payment_events` 表以 `provider + event_id` 唯一索引持久入箱——回调与查单补漏共用同一幂等入口
4. 退款：**内容购买不可退款**（已读即签收），规则一页明示；支付成功但权益未开通的异常订单由站主人工处理
5. 平台商户订单号独立于本站自增订单 ID，在数据库创建时生成并保持不变；支付发起、查单与回调均按该编号绑定，避免重新安装或多个 OPC 复用一个商户账户时的历史订单号碰撞。
6. 无浏览器返回且异步通知丢失时，由独立定时查单补漏：`orders.reconcile_checked_at` 记录最近认领，服务端专用 RPC 原子认领超过 10 分钟的待付单，同一待付单 30 分钟内不重复查询；查单确认已付仍走原子结算与权益邮件入箱。调度配置不属于数据库安装脚本，必须由部署者单独启用和验证。

**PaymentProvider 架构（单实现 zpay，易支付协议兼容）**：
- **协议为事实标准，平台可换**：`ZPAY_PID / ZPAY_KEY` + base URL 三项配置即启用；平台失效换 base URL + 商户密钥即可切换，代码零改动
- **接口职责唯一**：「让订单 pending → paid」，仅三个方法：发起收款 / 验回调 / 查单补漏；`paid` 之后的权益开通、邮件、退款单一后置路径；接口与 `orders.provider` 列（创建时锁定，对账依据）为通道扩展位（Stripe 待国际受众出现再议）
- **未配置状态如实呈现**：未填写支付配置时，购买入口显示「暂未开通在线收款」——完成收款配置是开店前提，系统不提供站外绕行收款方式
- **回调纪律**：验签 + 金额强校验（回调金额 ≠ 订单金额即拒）+ 5s 内应答 `success` + 重复通知幂等跳过；回调丢失走查单 API 补单
- **灰色通道风险明示**：四方支付为无牌照资金归集，可被封 / 跑路——勤提现、余额不过夜；商品名需含具体商品描述（平台风控）；开源仓库零密钥预置，README 如实披露风险，开通与否由站主自行决策

订单列表、详情与支付返回页提供对应文章、专辑或活动的站内直链；链接不改变目标内容的阅读权限。年度订阅从权益开通起有效一年，到期即按有效期失去订阅权限，无需等待定时任务；单独购买的永久单篇、专辑权益保留，不自动续费。

**Entitlement 模型**（权益是唯一权利源）：`type / targetId / startsAt / endsAt / permanent / revokedAt / 来源[订单|管理员]`

**邮件通知**：注册验证 / 权益开通 / 订阅到期前 7 天提醒（**明示已购专辑与单篇不受影响**）/ 停售通知（含 3 个月权益保留期，停售动作即发；归档静默）。

### 4.4 服务

- **服务页** = 结构化内容：服务内容 / 交付物 / 工期 / 价格 / 容量（每月 N 单，展示 current_load）/ 协议
- **六要素协议**：

| 要素 | 内容 |
|---|---|
| 范围 Scope | 做什么 / 不做什么 |
| 交付 Deliverable | 可验收的具体产出 |
| 节奏 Cadence | 时间表 + 检查点 |
| 酬劳 Compensation | 金额 / 时点 / 形式 |
| 退出 Exit | 终止条件 + 通知期 + 款物处理 |
| 归属 Ownership | IP / 客户关系 / 数据归属（NDA 子项） |

- **成交与履约**：询价与报价在线记录，客户可接受报价；双方主体/联系方式与服务六要素共八项条款逐项确认，协议快照确认后才可开工。额外签约与服务付款在线下完成，站点不接入电子签或服务支付建模。
- **询价**：表单字段 `intent / budget_range / deadline / context_links` → 站主收件箱 + 邮件；Agent 可依 card.json 的 protocol 字段提交同结构
- **履约管道**由站主和客户各自的受控动作驱动，非自由修改状态：
  `inquiry → quoted(报价单) → booked(客户接受报价或站主成交登记) → in_progress(检查点) → delivered(交付单) → accepted(客户验收) → settled(结案)`；delivered → in_progress 允许客户「要求修改」回退（修改意见入 revision_notes，可多次）
- **履约权威入口**：站主与客户会话分别通过受控事务函数操作；整单验收只能由订单客户提交。条款经客户确认且站主开工后才可启动或交付检查点；`settled` / `declined` 订单与检查点只读留档。会话用户无 bookings / milestones 直接写权限。
- **订单追踪（客户侧）**：booked 起订单对客户可见——里程碑时间线（检查点：名称 / 预计 / 实际）、当前阶段 + 预计时长、**待办归属**（待站主 / 待客户 / 待第三方）——客户任何时刻知道"到哪了、卡在谁"；第三方依赖与等待期原样呈现，与 exclusions「承诺过程、不承诺结果」同一立场；数据全部来自履约管道既有状态与检查点，不另建流程
- **评价**：仅已结算订单的交易对手可评，append-only，展示于服务页
- 伙伴 → 静态外链名录页，不做数据结构

### 4.5 活动

- **活动即专辑（series type='event'）**：主表统一（§4.2 万物皆专辑）；活动 = 专辑 + 一行 `event_details`（1:1：时间 / 地点 / 报名 / 名额 / 会员专享|开放 / 票价 / 生命周期）；介绍 = 专辑 README（默认全开放——**门槛在报名，不在阅读**）；**沉淀 = 专辑内普通文章（chapter）**，性质以标题 / 标签表达，不设类型枚举——纪要 / 反馈 / 资料是编辑习惯，不是结构约束（活动非标性高，与类型解耦）
- **两类活动**：**会员专享**——订阅会员的交付之一，会员免费参加，非会员可单独购票；**开放**——对所有人，免费或收费
- **报名资格**：会员专享 = 有效订阅 ∨ 已购票；开放 = 任何人（收费活动购票后报名）；购票复用订单系统（支付通道同 §4.3），票 = Entitlement(type='event', target=活动)；**免费开放活动到场核销 = 免费发票**（QR 扫码或名单标记 → 同型 Entitlement · source='checkin' · 永久；发票需站内账户，纯邮箱报名者核销时经 magic link 绑定后发放）
- **沉淀解锁 = 参会资格（与报名资格同构）**：有效订阅 ∨ 持有效活动票——已付成本者资格即证明（未到场可读），零成本者到场核销即证明（报名未核销仅见公开面）；纪要 access 统一 `subscriber`，活动专辑内该分支加验票（§6）；未参会者见预览 + 订阅引导（报名期的收费活动加购票入口）；本版不承诺扩展资料包通用下载能力
- **生命周期**：`upcoming → registering → ended`（event_details.state）；发布与归档复用 series 状态机
- 编辑指引（非结构约束）：公开沉淀进入分身检索层；反馈 / 成果站主策展，手动创作不接收自动回流；活动的公开面由 README（默认全开放）与博客承载——需公开的复盘 / 预告写入 README 或发博客，纪要与资料留给参会者

### 4.6 数字分身

- 一个分身服务本站知识库问答。来源为已发布／暂停文章及站主审核的公开问答稿；草稿、归档和私人原始会话排除。分身未启用、生成连接不可用或知识库未就绪时，前台不展示分身入口，服务端拒绝生成。
- `/admin/ai` 统一管理共享生成连接、向量连接与索引、站主指令、分身与匿名开关、月度上限。生成支持受信目标的 Chat Completions、Responses、Anthropic Messages；向量首个兼容组合为硅基流动中国区 BAAI/bge-m3 原生 1024 维。
- 连接凭据服务端私有，管理界面只收到必要元数据与密钥存在状态。连接与设置同事务保存，版本冲突不覆盖；改变目标产生新连接版本。同一供应商复用凭据须显式选择，不跨平台自动借用。
- 固定的权限、资料与引用纪律不可编辑；站主可编辑补充指令。提示词不含凭据。后台页面生成共用生成连接，但使用独立、不可编辑的设计提示词，不读取分身指令、会话或知识库。
- 分身补充指令支持 Markdown 原文编辑与本地预览，保存和发送均保留原文。推荐模板包含角色、职责、表达、资料不足处理和业务引导；显式载入、覆盖前确认、可撤销，保存后才生效，不自动替换已有指令。模板不新增工具、语义路由执行器或公开 card 字段。
- 检索查询活动代际的完整向量索引，以精确余弦分数过滤；模型、连接与索引代际绑定。分片覆盖全文，不限制前 64 片或截取片段开头。站主确认文字发送范围后才启动供应商调用；付费正文同样会发送给向量供应商。
- 发布或修改内容同事务登记来源版本，旧来源立即退出检索；后台按有界批次建立增量候选，复用同连接与处理规则下摘要、覆盖一致的已确认向量，不写入活动索引；候选验收后切换，不让发布等待外部模型。全量重建不复用旧向量。超时或未知结果停止，失败项由站主确认可能重复计费后手动重试。
- 知识库启用由站主明确决定，不要求问题测试、固定题数或命中率。服务端与数据库强制完整覆盖、当前来源版本和已验证连接；正文权限独立强制。可选诊断允许 1–100 个已核对的问题，按固定检索规则展示 Top-5 来源命中与库外返回；分数不是回答正确率。题目标注变化不修改向量、运行阈值或原报告。兼容增量同步沿用正在使用的规则，更新完成可直接确认切换；模型或重要内容变化建议用相同问题比较。
- 错配结果以文字、图标和警示底色显示。站主确认返回来源确实包含答案后，可逐项加入该题的可接受来源草稿（每题最多 3 个），保留原预设；不自动采纳整组结果。采纳不修改原题、原始检索结果、旧得分或启用状态。草稿可单独移除来源、下载或取消；新检查须重新确认费用，服务端重新校验来源与题目结构。“无答案”题采纳后改为有答案题，重新检查题数组合。已改写或移除的问题不能采纳旧问题的检索来源。
- 全域检索包含受限片段，候选命中后必须由代码校验文章、父专辑生命周期与读者权益。授权正文才能进入模型上下文；未授权命中仅返回标题、权限提示与合法链接。公开目录、README、预览和站主公开稿按当前阅读规则处理，不依赖模型自行保密。
- 文章入口与 `@引用` 仅改变达到相关性门槛的候选优先级，最多三个引用，不把无关片段强行注入，也不绕权限。所有入口使用同一知识库与分身。
- 缓存按读者、有效权益、来源版本、活动代际及配置版本隔离，匿名问题不写入跨访客缓存。缓存命中先于查询向量与生成预算，不消耗模型请求。无相关资料或只有未解锁正文时不发起生成；故障不回退通用聊天或关键词后备问答。
- 生成前原子预留预算，查询向量有独立频控。未派发生成可释放；派发后未知结果保留额度，不自动重试。月度次数不是账单金额封顶，达到月限额暂停生成并尽力通知站主。限额见[配额契约](../development/avatar-quota.md)。
- 回答附来源，界面常驻「AI 生成 · 仅供参考 · 合作请转人工」，不展示模型名。转人工留言按账户／IP 限频。原始会话只对当事人与站主可见，公开稿由站主另行编辑、脱敏和确认。
- 匿名分身必须同时开启匿名入口并通过固定 hostname、action 的 Turnstile 校验；已登录用户不走此校验。匿名访客点击发送后才弹出校验，通过后自动发送该问题并关闭弹窗；取消或失败保留问题和引用，不发送 AI 请求，每次发送使用独立校验令牌。匿名服务询价在启用人机校验时另行验证，Supabase Auth 登录校验独立。

### 4.7 Agent 对外接口

**/card.json**（schema：`youai.card/0.2`）：
- 输出 `identity / capabilities(services+content_offerings+skills) / constraints / protocol(inquiry+human_channel+escalation) / evidence / source_of_truth`；`evidence` 当前为空对象，不输出 `pricing_policy`、私有包清单或下载授权。字段与过滤规则见[机器名片映射](../contracts/card-mapping.md)。
- 纪律：**事实而非命令**（只陈述"我接受什么"，不发指令）；focus_areas 自由标签；**声誉不自陈**（只放指向交易锚定评价的 URL）；与人类页 /card **同源渲染**
- 协议要点：`escalation: 所有订单最终由本人确认；agent 可完成信息交换与材料准备`

**/llms.txt**（内容地图）：
- 文章条目标明公开、注册、订阅或单独付费的阅读级别；专辑附已配置的任务说明，独立 Skill 链接指向公开介绍。
- 仅在验证同专辑归属与公开权限后输出 README 全文。其他条目只输出标题、链接与摘要／试读；受限正文不进入输出。
- 内容发布使公开目录缓存失效；后续请求按同一匿名目录生成，与 card.json 联动。

**服务端纪律**：付费正文对未授权请求**不下发**（服务端权威，非前端隐藏）；两者带 `Cache-Control + ETag`；schema 版本字段留演进空间。

**详情页 JSON-LD（页内机器可读定价）**：专辑详情页与单卖文章页 SSR HTML 内嵌 schema.org——兼容的旧 skill 专辑 `SoftwareApplication`、手册 / 活动专辑与单卖文章 `Product`，均附 `offers: {price, priceCurrency, availability}`（price 与页内同源：手册 / skill=series.price，活动=event_details.ticket_price，独立文章=article.price；availability 随状态机：published→InStock、paused→SoldOut，活动 ended→SoldOut）。与 card.json / llms.txt 同一数据源纪律，不另维护——价格是公开事实，机器可读即导购（Agent 与搜索引擎共用）。

### 4.7.5 自定义页面与首页自定义区

- **自定义页面**：突破 Markdown 表达力的富样式页面（landing / 专题页），路由 `/p/[slug]`，一律公开，状态机从简 `draft → published ⇄ archived`；`placement` 发布位置三档：左侧栏 / 底部（页脚链接区）/ 不固定（默认）。
- **样式能力 = 内置语义类体系（cp-*）**：约 20 个语义类（布局/排版/组件）静态定义在 globals.css，动态 HTML 的 class 白名单即此集合——Tailwind 按需生成决定了动态内容的样式必须预定义。禁 script / style / iframe / form / 事件属性 / 自由 class。
- **净化管线**：保存时 + 渲染/读取时双道 sanitize-html 白名单（href 仅 https/mailto/站内，img src 仅 https 或 `/` 开头，_blank 自动加 rel）。
- **后台**：/admin「页面」tab——列表 + 编辑器（预览/编辑切换）+ **AI 生成初稿**（使用共享生成连接，system prompt 携带 cp-* 规范与容器约束，只产出草稿不落库；生成连接未检查通过时如实不可用）。
- **首页自定义区**：`home_config.custom_zone`（启用开关 + HTML），渲染在 Hero 与五个内容区块之间；可从任意自定义页复制内容再独立编辑。
- **边界**：自定义页不进 llms.txt / card.json；导出（/admin/export）包含页面 HTML 与元数据 CSV。
- **预约与退款政策 = 页面选择器**：`contact.booking_page` / `commerce.refund_policy_page` 选自定义页 slug，页脚「预约」、服务详情 CTA、名片协议区、card.json `booking_url`（绝对站内地址）、结算页与页脚「退款政策」全部解析到 `/p/{slug}`；历史外链字段（booking_url / refund_policy_url）仅兼容保留，表单不再提供。

### 4.8 供给侧（站主后台）

后台按任务分组：概览；内容管理（文章、专辑、独立页面）；业务管理（收款订单、服务与履约、用户与权益、收件箱）；站点设置（首页与导航、站主名片、AI 设置）；维护（部署检查、数据导出）。

站点设置另设“安全与人机校验”，由站主保存 Turnstile 密钥对与开关，保护匿名分身及匿名询价；Secret Key 私有，停用不被旧环境配置重新开启。Supabase Auth 的登录验证仍独立配置。

- 文章按逻辑文档合并正式版本与待审核修订，纯待审核与无导入记录的历史文章均可管理；生命周期和修订状态分开显示。
- 列表服务端先授权、筛选和计数，再分页，默认 20，可选 50/100，稳定排序。失败不显示为零条。全文仅在选定对象并验权后读取。
- 发布、导入、审核复用统一发布管线；收款订单只查询追踪，不增加人工支付或授予权益旁路。`/admin/orders` 仍管理服务履约。
- 编辑失败保留内容；保存冲突不覆盖；结果未知先确认状态。工作台支持草稿下载和普通页面链接的离开提醒；浏览器关闭提醒受浏览器能力限制，不替代主动保存。
- 独立页可放置白名单 `cp-pricing` 或 `cp-subscribe`，公开输出时由服务端生成真实方案。普通 HTML 保存和读取均净化。
- 首次站主设置可载入版本化示例：`/p/pricing` 与免费普通专辑 `getting-started`（八篇功能和部署说明）。可选空站；既有站点主动导入；同名冲突和已有编辑停止，不覆盖。章节沿统一发布流程创建，全部成功后启用默认导航。
- 主题偏好属于访客浏览器；站主业务配置不保存主题。首页横幅分别配置浅色与深色背景，未配置时使用对应的内置背景；文字直接构图，不嵌套圆角面板。首页仍保留原五类区块，不因组件库增加额外类型。

---

## §5 核心数据模型与状态机

**权益通知可靠性**：新支付结算与权益邮件任务同事务，独立 worker 发送；邮件失败不撤销权益。租约 / token 防并发确认，同键同正文在 23 小时安全窗口内重试，终止后人工对账；历史支付不补发。到期 / 停售等邮件不在权益队列范围。安装 / 调度及验证边界见 [邮件运维](../operations/payment-mail-outbox.md)。

导入数据：`content_files` 保存 scope（blog / skill / series:slug）、相对路径、唯一文章标识与阅读顺序；`content_file_revisions` 保存单文件递增修订、输入 hash、原始发布快照、线上基线时间、幂等请求 ID 与发布结果；`content_assets` 保存项目相对路径、原始图片 hash 与已校验媒体清单。全部启用 RLS，仅站主读取、服务端权威写入。`content_file_heads` 使用 security_invoker，只返回最新修订元数据。`articles.sort_order` 用于专辑阅读顺序。待发布修订独立于文章生命周期，不向公开正文表或检索 chunks 写入正文。


```
app_schema_version(id=1, version, applied_at)  -- 工程结构版本；API 角色不可写，仅 service_role 可读
email_outbox(id UUID, order_id UNIQUE, entitlement_id UNIQUE, snapshot JSONB,
             status[pending|processing|retry|sent|dead], attempts, next_attempt_at,
             lease_token?, lease_until?, message?, provider_fingerprint?, started_at?,
             provider_message_id?, last_error?, created_at, updated_at) -- 权益邮件任务；仅 service_role 访问
avatar_usage(id, user_id?, ip?, model, tokens_in, tokens_out, created_at, request_id? UNIQUE,
             generation_state[reserved|dispatched|succeeded|unknown|released], reservation_expires_at?)
site_config(single row: home_config / identity / constraints / contact / commerce / avatar_config)
publish_requests(client_request_id UNIQUE, status, response)  -- 发布幂等重放箱
series(title, type[collection|handbook|skill|event], readme_article_id?, price, status, tags[], task?, audiences[], featured, nav_enabled, nav_label, nav_order)  -- 手册与活动；collection/skill 仅兼容旧数据；README = 指针指向的 chapter；task = 任务一句话；audiences = 职业人群标签；featured = 置顶（首页对应类型分区内排前）
articles(title, slug, type[blog|chapter|skill], access[public|registered|subscriber|paid],
         series_id?, price?, paywall_offset, status, tags[], ...)   -- price = 单篇购买价，仅 blog 独立付费文章生效
skill_details(series_id, download_url, file_manifest)        -- 旧技能展示兼容数据，不作为新包交付权威
skills(id=articles.id, price, current_release?, online_enabled, usage_guide, legacy_series_id?, revision)
skill_releases(id, skill_id, version, package_sha256, manifest, online_eligible) -- 私有、不可变
skill_sessions(user_id, release_id) / skill_turns(session_id, request_hash, state) -- 私有会话
handbook_credentials(owner_id, token_hash, revoked_at?) / handbook_sync_operations(id, credential_id, request_hash, response)
event_details(series_id, starts_at, location_text, registration, capacity,
              kind[member|open], ticket_price, state[upcoming|registering|ended])
registrations(series_id, user_id?, email, status, UNIQUE(series_id,email))   -- 活动报名名单（后台导出）
entitlements(user_id, type[subscription|series|single|event|skill], target_id?,
             starts_at, ends_at?, permanent, revoked_at?, source[order|admin|checkin])   -- checkin = 免费活动核销发票
orders(user_id, sku_type[subscription|series|single|event|skill], target_id, amount, provider[zpay], merchant_order_no[新单唯一 32 位数字；历史终态保留旧数字], status[pending|paid|fulfilled|failed|refunded])
payment_events(provider[zpay], event_id UNIQUE, payload)     -- 幂等收件箱：回调与查单补漏共用；服务付款线下完成，不入此表
services(slug, deliverables, price, capacity, protocol_snapshot)
bookings(service_id, user_id?, email, intent, budget_range?, deadline?, context_links?,
         agreement_snapshot?, agreed_at?, status[inquiry|quoted|booked|in_progress|delivered|accepted|settled])
milestones(booking_id, title, owner_party[owner|client|third], expected?, actual?, status[todo|doing|done], sort)
evaluations(booking_id UNIQUE, rating, content)              -- 交易锚定，append-only（仅已结算 booking 可评）
article_reviews(article_id, user_id, rating?, content)       -- 带评分 = 落地评价；无评分 = 评论（含站主总结评论）
conversations(article_id?, user_id, summary_md, status[pending|public|hidden]) -- 私有原始会话；public 表示已审核，不授予原文读取权
conversation_messages(conversation_id, role[user|avatar], content)           -- 私有原始消息，仅当事人与站主读取
conversation_publications(conversation_id, article_id?, question_md, answer_md, updated_at) -- 站主整理的公开稿，不存对话者身份
article_chunks(article_id, chunk_type[catalog|readme|preview|body], content, embedding)  -- 清单层人人可读；body 层 RLS 同 article_bodies
```

**状态机汇总**：

| 对象 | 状态机 | 关键语义 |
|---|---|---|
| 内容 | draft → published ⇄ paused → archived | paused = 停售不停读 |
| 订单 | pending → paid → fulfilled / failed；核对未付款且不会再支付的旧单可由受信运维 pending → failed | paid ≠ fulfilled；人工关单须停收款、留存备份与对账依据，不能删除或伪造已付 |
| 订阅权益 | active → expiring(7d) → expired | 续费 = 新权益；到期不影响永久权益 |
| 服务履约 | inquiry → quoted → booked → in_progress → delivered → accepted → settled；delivered → in_progress 允许要求修改回退 | 站主报价/交付带快照；客户接受报价即成单、验收或打回 |
| 活动 | upcoming → registering → ended → archived | 纪要关联博客 |

---

## §6 阅读权限规则

**访问级别**（文章属性）：`public`（含匿名）/ `registered` / `subscriber`（仅订阅会员）/ `paid`；受控文章（subscriber / paid）可设 `<!-- paywall -->` 切点，之前为公开预览，之后为受限正文；无切点则全文受限。

**README 例外**：三形态专辑的 README（chapter）默认全开放（忽略 access 与付费墙标记，`bodies_read` 专项放行）；Skill 的打包下载需权益校验。

**付费权益**（用户属性，**并集生效、最宽松优先**——不是等级覆盖）：

1. 有效订阅（包年）→ 全站付费内容 + 订阅专属内容（`subscriber`）可读；
2. 已购专辑（永久）→ 专辑全部文章及后续更新可读；专辑内文章不单卖；
3. 已购单篇（永久）→ 仅独立付费文章支持单篇购买；
4. 订阅到期不影响 2、3 项权益（到期提醒中明示）。

**订阅专属规则**：`subscriber` 内容不可购买——不参与单篇/专辑销售，权益判定认有效订阅与活动票（Entitlement type='event' 仅解锁所在活动专辑的沉淀，§4.5）；转化引导唯一指向订阅（活动沉淀的购票入口只在报名期出现）；发布 lint 对「subscriber 文章位于定价专辑」给警告。

**下架语义**：采用 `paused`——停售不停读（已购可读、不再新售）。

```text
visible(user, article):
  if article.access == "public":     return 全文（任何人）
  if article.access == "registered": return 全文（注册即读）
  if article.access == "subscriber": return (有效订阅 ∨ 持所在活动的有效票) ? 全文 : preview + 订阅引导   -- 活动票 = Entitlement(type='event')，购票/核销发放（§4.5）

  preview = paywall 切点之前的部分
  if user 匿名: return preview + 购买引导
  E = 有效权益并集（订阅未过期 ∨ 已购所在专辑 ∨ 已购本篇）
  if E 命中:   return 全文
  else:        return preview + 购买引导
```

---

## §7 非功能需求

| 域 | 要求 |
|---|---|
| 安全 | 权限判定在服务端（付费段不渲染，非前端隐藏）；注册/询价/分身对话速率限制；分身成本熔断（§4.6）；备份加密 |
| 运维 | 托管平台承载计算与数据库；站主按备份恢复手册安排数据库、Auth、Storage 与配置备份，按实际套餐核对保留策略 |
| 可部署性 | Vercel 导入 + Supabase install/verify；后台配置与唯一站主认领，站主信息零硬编码，署名可关闭 |
| 邮件 | Supabase Auth SMTP 负责登录；Resend 负责事务邮件；邮件与查单调度分别配置 |
| 反牢笼 | 内容与业务数据导出：Markdown 供阅读编辑、CSV 供统计对账，保留配置及原始 JSON 供查阅。不承诺 ZIP 整包回灌、账号/权益恢复或整站迁移；图片附件另存，事故恢复走数据库/Storage 备份流程。导出须验权、完整且可读取，约 23 MB 托管容量专项不作为发布门槛；见 docs/operations/content-export.md。 |
| 性能 | 单OPC规模（百级内容 / 千级用户），首页 < 2s（动态块走缓存 / ISR，发布时 revalidate，无逐请求查库）；无高并发要求 |
| 前端风格 | shadcn/ui + Tailwind CSS，Workspace UI（详见 [前端技术栈](../development/frontend-stack.md)） |

---

## §8 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 全栈框架 | Next.js（App Router） | 与 shadcn 同生态；单一可部署物；SSR 对 SEO 与 llms.txt 同源渲染友好 |
| UI | shadcn/ui + Tailwind | [前端技术栈](../development/frontend-stack.md) 结论 |
| 编辑器 | CodeMirror 6（后台内容工作台） | 成熟的源码编辑型库（MIT，Obsidian 同款）；markdown 高亮/快捷键；编辑器硬要求：`<!-- paywall -->` HTML 注释**可见可移**（源码编辑形态保证此点） |
| 数据与认证 | Supabase（Postgres + Auth + Storage + RLS） | 邮箱注册开箱即用；正文分列存储（preview 匿名可读 / body 走 RLS 查权益），数据库层硬闸；Skill 文件包 = 私有桶 + 签名 URL；pgvector 供分身检索 |
| 部署 | Vercel | 零运维、预览部署、自定义域名；Deploy Button 支撑开源一键部署 |
| LLM | DeepSeek（默认，后台可换） | API Key / 模型名 / 月度限额后台可配；月度限额 = 站级熔断护栏（§4.6） |
| 邮件 | Resend（事务邮件）+ Supabase Auth 邮件 | 注册验证走 Auth，权益开通 / 到期提醒走 Resend |

> 数据库采用标准 PostgreSQL，源码和数据可自持；当前维护的部署路径为 Vercel + Supabase。Docker 自部署不是本版本已验收的一键入口。
> 托管费用、资源限额与备份保留以平台当前套餐为准；运维方案不把免费层可用等同于生产保障。
> 部署者须在目标地区验证域名、Auth、数据库与支付可达性；更换平台需要重新验证权限、协议和恢复能力。
> 选型为默认推荐而非硬约束；若以可部署性与 RLS 语义等价为验收标准，等价技术栈可平替。

---

## §9 发布标准

首次公开即正式版本，公开前仓库保持私有。可选能力以完整配置开关提供，默认关闭不免除已开启路径的闭环验收。服务线下付款是产品设计。

发布须满足：

1. 陌生部署者只按 README 及链接，在自己的 GitHub、Supabase、Vercel 创建空实例，完成 Storage、Auth/SMTP、唯一站主认领和配置。
2. 文件夹与工作台分别完成带图、付费切点、匿名预览和发布；数据库 install → verify 全部通过。
3. 在线支付的订阅、专辑、单篇权益闭环和邮件可用；查单补漏与重复结算幂等通过。平台实测证据与受控故障测试明确区分。
4. 服务询价、报价/条款确认、检查点、交付、客户验收和交易锚定评价贯通；活动发布、报名、核销与纪要资格贯通。
5. 分身套话无未授权正文泄露；导出文件可读取复用，署名开关可用；不以整包恢复或大包容量作为发布承诺。
6. 最终提交必需检查全绿，无已知阻断缺陷，生产依赖审计已处理，素材许可明确；Production Ready/Source 与提交一致。

当前完成项、版本和未满足门槛见[发布状态](../development/release-status.md)，安全场景见[验收矩阵](../contracts/acceptance-matrix.md)。任何缺环不得以“稍后补齐”宣称正式可发布。

## §10 指标

| 维度 | 指标 | 说明 |
|---|---|---|
| 收入 | MRR（订阅 + 折算）、内容单笔收入、服务结算额 | 北极星 |
| 转化 | 付费转化率（注册→付费）、专辑→订阅升级率 | |
| 留存 | 订阅续费率、已购用户复购率 | |
| Agent 前瞻 | card.json / llms.txt 抓取量、Agent 询价数 | 差异化验证 |
| 分身效率 | 转人工前的自助解决率、分身日均成本 | 成本护栏 |

---

## §11 权限、缓存与生成用量

### 原始会话、公开稿与缓存

公开问答由站主明确编辑，表单首次为空；原始答复不会因切换 public 自动公开。旧公开会话升级后保持私有，需整理新公开稿；撤回删除公开稿而保留原始记录。关联内容不再可见时，公开稿也不进入匿名 Data API / 分身检索。

生成缓存先重新计算已授权检索上下文：键包含版本、账户、问题、钉载、上下文和模型配置；权益撤销、内容归档或公开稿变化会失配。匿名生成不读写共享答案缓存；公开问答仍可复用检索。旧版缓存保留但新版不会命中。缓存命中仍不调模型、不计生成配额，但需要检索成本。

归档保留期除 manage_content 外，也由 articles / series 的数据库触发器约束普通 API owner：不可直接跳到 archived，也不可回拨 paused_at。可信 service_role / 数据库维护者保留修复与导入能力。


### 生成额度与执行期限

`ai_calls` 为新调用账本，连接版本、任务、请求 ID、状态、期限与 token 用量分别记录。注册分身日限额 20、有效订阅 100、匿名同 IP 5，站主免分身日限额但遵守站级月限额；页面生成与分身共用月预算。查询向量与连接检查独立限频，不当成免费调用。历史 `avatar_usage` 用量保留并参与月预算和本人今日统计。

调用状态为 reserved → dispatched → succeeded / unknown；仅 reserved 可 released 或过期。状态变更由受信服务端的原子 RPC 控制；浏览器不能读取私有账本或调预算 RPC。个人中心仅通过无用户 ID 参数的本人统计函数获得当日总量，未知统计不显示为零。外部请求和响应均有期限／容量边界，失败不输出供应商原始错误或凭据。

### 手册上传、修订与整辑发布

专辑生命周期决定整辑可见性，章节阅读权限决定谁能阅读全文，待发布修订决定新上传何时替换线上正文。Obsidian 始终只上传草稿，网页可一次审核并发布整辑所选更新，保留历史版本；新手册可在同次提交绑定公开介绍并上架。整批出现冲突或发布错误时全部保留原状。

篇内标记只设置公开预览边界，不改变阅读权限。受限内容使用第一个有效顶层标记，无标记则公开正文预览为空；多个标记或代码示例中的标记不阻断发布。已授权读者仍可阅读全文，公开文章不因标记而收费。
