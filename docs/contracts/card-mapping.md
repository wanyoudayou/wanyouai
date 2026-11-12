# card.json 映射契约

`/card` 与 `/card.json` 共用 `getCardData` 和匿名公开目录；机器结构为 [youai.card/0.2](../card.schema.json)，实现见 [machine-output.ts](../../src/lib/machine-output.ts)。本文描述当前输出，不承诺尚未输出的字段。

## 顶层与身份

| 字段 | 来源 |
|---|---|
| `schema` | 常量 `youai.card/0.2` |
| `generated_at` | 目录中参与数据的最新 updated_at，UTC ISO；同一版本请求不变 |
| `identity` | site_config 的站主、站名、一句话、语言、时区、专注领域；site 来自 SITE_URL，links 当前为空对象 |
| `capabilities` | 已发布服务、技能和可对外导购的内容 |
| `constraints` | 工作时间、响应时间、当前负载、不接事项 |
| `protocol` | 固定询价字段、公开联系渠道和转人工声明 |
| `evidence` | 当前为空对象；人类页面的评价正文不写入机器名片 |
| `source_of_truth` | `${SITE_URL}/card` |

当前实现不输出 `pricing_policy` 或技能 `download_url`，即使 schema 容许它们。不得因清理文案补造这些接口。

## 服务

匿名目录只取 published 服务；输出还要求 price 非空、六要素协议有效。字段：

```text
id = services.slug
name = services.title
deliverables = services.deliverables
duration = services.duration（空时为空串）
price = { amount: services.price, currency: 站点币种, model: "per_project" }
capacity = 每月容量与站点当前负载的事实描述
agreement_url = ${SITE_URL}/card#service-${slug}
inquiry_endpoint = ${SITE_URL}/api/services/inquire
```

paused/draft/archived 不作为供给输出。服务详情页提供询价表单，交易与安排由站主确认。

## 技能与内容供给

专辑必须 published，具有公开 README 正文，且 README 属于同一专辑。保留的旧技能系列输出 title、`/skills/{slug}` 与 free/paid-series。独立 Skill 以公开介绍与扩展设置为来源，只有已发布且选择有效版本包时才进入 `skills`，免费项为 `registered`，收费项为 `paid-skill`；不输出包清单、内容或私有直链。已映射旧系列不重复输出。

手册使用 `/handbooks/{slug}`，活动使用 `/events/{slug}`；活动还须 upcoming/registering，价格取 event_details.ticket_price。独立付费博客要求 published + paid，使用 `/blog/{slug}`。付费项输出一次性价格；免费项省略 price，有 task 时附任务描述。ended 活动、paused 供给和 subscriber 文章不作为可购买项目。

## 询价与人工渠道

```json
{
  "accepted_fields": ["intent", "budget_range", "deadline", "context_links"],
  "note": "请通过服务详情页提交询价，合作安排由站主确认。"
}
```

字段顺序保持不变。询价端点在各服务项的 inquiry_endpoint 中，不在 protocol.inquiry 添加 endpoint。

human_channel 的 email/booking_url 仅非空时输出；预约页选择器解析成 `${SITE_URL}/p/{slug}`，历史 HTTPS 外链兼容保留。后台名片保存要求至少一个有效联系渠道。

escalation 固定为“所有订单最终由本人确认；agent 可完成信息交换与材料准备。”

## llms.txt 与权限

同一匿名目录生成文本。公开/注册文章只输出标题摘要；订阅/付费文章只输出标题预览。公开 README 在确认同专辑归属与公开 access 后才读取 body。正文授权状态不改变机器输出；draft/paused/archived、ended 活动不进供给目录。

目录取数对任意访问身份固定 anon；`/card.json` 不取人类页面专用评价正文。原始私有会话、付费正文与长期 Storage 签名链接不能进入机器输出。

## 缓存与失败

```text
Cache-Control: public, max-age=3600
ETag: SHA-256（确定顺序的最终响应字节）
```

支持 If-None-Match 的弱标签、列表与 `*`，数据成功获取后匹配返回 304。每请求最多 6 秒，分页与 README 共用 10 秒截止；源异常取消剩余读取并返回 503/no-store，不能把空目录缓存成成功。网络失败不保证 304。

站点设置、内容发布、服务状态等变更 revalidate `/card`、`/card.json` 和相关机器路由；活动详情更新同步父专辑时间。日期和 ETag 不随请求随机变化。

## 手册与兼容地址

旧 `collection` 保留 ID 转为 `handbook`，机器 URL 使用 `/handbooks/{slug}`；原 `/collections` 地址重定向。手册保留 `content_offerings.type=series`，独立 Skill 使用 `skills` 分组。暂停、草稿与归档对象不进入可售目录。
