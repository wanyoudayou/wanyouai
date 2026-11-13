"use client";
import { useActionState, useEffect, useState } from "react";
import { loadPageForCopy, previewPageHtml } from "@/app/admin/pages-actions";
import { CustomHtmlBody } from "@/components/custom/custom-html-body";
import { saveSettings } from "@/app/admin/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { ImageField, MediaPicker } from "./media-library";
import { assetImageHtml } from "@/lib/media/html";
import { CURRENCY_OPTIONS } from "@/lib/format";
import { SocialIcon } from "@/components/card/social-icon";
import { SUBSCRIPTION_HINT_ICON_LABELS, SUBSCRIPTION_HINT_ICON_NAMES, SUBSCRIPTION_HINT_TEXT_MAX } from "@/lib/subscription-hint";
import {
  HERO_ACTION_LABEL_MAX,
  ONE_LINER_MAX,
  HERO_CHAT_LABEL,
  HERO_IMAGE_ALT_MAX,
  HERO_SUBTITLE_MAX,
  HOME_BLOCK_TITLES,
  SOCIAL_PLATFORMS,
  type FactBadgeType,
  type SocialPlatform,
} from "@/types/site";
import type { SiteContext } from "@/lib/get-site-config";
const facts: Record<FactBadgeType, string> = {
  series_count: "手册与活动数",
  article_count: "文章数",
  subscription_price: "订阅价格",
  service_capacity: "服务容量",
};
export function SettingsForm({
  site,
  updated,
  zpayReady,
  avatarKeySet,
  customPages = [],
}: {
  site: SiteContext;
  updated: string;
  zpayReady: boolean;
  avatarKeySet: boolean;
  customPages?: { slug: string; title: string; html?: string }[];
}) {
  const [state, action, pending] = useActionState(saveSettings, {
    message: "",
  });
  const refundPageSlug = site.commerce.refundPolicyUrl?.startsWith("/p/")
    ? site.commerce.refundPolicyUrl.slice(3)
    : "";
  const subscribePageSlug = site.commerce.subscribePage ?? "";
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const textField = (name: string, label: string, value: string) => (
    <label key={name} className="space-y-1 text-sm">
      {label}
      <Input name={name} defaultValue={value} maxLength={2048} />
    </label>
  );
  return (
    <form
      action={action}
      onChange={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
      className="space-y-6"
    >
      <input type="hidden" name="updated" value={updated} />
      <p className="text-sm text-muted-foreground">
        站名、Logo 与一句话在这里管理；站主资料与联系方式在「站主名片」，模型与额度在「AI 设置」。两个分页共用一次保存。
      </p>
      <fieldset disabled={pending} className="min-w-0">
        <Tabs defaultValue="home" className="space-y-6">
          <TabsList aria-label="站点配置分组">
            <TabsTrigger value="home">首页与展示</TabsTrigger>
            <TabsTrigger value="commerce">收款与价格</TabsTrigger>
          </TabsList>
          <TabsContent value="home" forceMount className="space-y-8 data-[state=inactive]:hidden">
            <section className="space-y-4" aria-labelledby="settings-logo">
              <div className="space-y-1">
                <h2 id="settings-logo" className="text-lg font-medium">LOGO</h2>
                <p className="text-sm text-muted-foreground">显示在左栏顶部；站名同时用于名片页、页脚署名与浏览器标题。</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  站名（必填）
                  <Input name="site_name" defaultValue={site.siteName} maxLength={120} required />
                </label>
                <label className="space-y-1 text-sm">
                  LOGO 小标题
                  <Input name="tagline" defaultValue={site.tagline ?? ""} maxLength={300} />
                </label>
                <ImageField
                  name="logo_url"
                  label="站点 Logo（留空使用站名首字）"
                  defaultValue={site.identity.logoUrl ?? ""}
                  disabled={pending}
                />
              </div>
            </section>
            <HeroSettings site={site} disabled={pending} />
            <CustomZoneEditor
              html={site.home.customZone.html}
              enabled={site.home.customZone.enabled}
              pages={customPages}
              fieldPrefix="custom_zone"
              title="首页自定义区"
              description="显示在首页大横幅与内容区块之间，可编辑、预览或从自定义页复制。"
              aiContext="section"
              avatarReady={avatarKeySet}
            />
            <section className="space-y-3">
              <h2 className="text-lg font-medium">首页内容区块</h2>
              <p className="text-sm text-muted-foreground">
                按显示顺序排列，五种内容各出现一次；未勾选“显示”的区块不在首页出现。
              </p>
              <ol className="space-y-3">
                {site.home.blocks.map((block, i) => (
                  <li key={i} className="rounded-lg border bg-card p-4">
                    <div className="grid gap-3 sm:grid-cols-[3rem_minmax(0,10rem)_minmax(0,1fr)_6rem_auto] sm:items-end">
                      <span className="text-sm text-muted-foreground sm:pb-2">第 {i + 1} 块</span>
                      <label className="space-y-1 text-sm">
                        内容
                        <select
                          name={`block.${i}.type`}
                          defaultValue={block.type}
                          className="block w-full rounded-md border bg-background p-2"
                        >
                          {Object.entries(HOME_BLOCK_TITLES).map(([type, title]) => (
                            <option key={type} value={type}>
                              {title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-sm">
                        标题
                        <Input name={`block.${i}.title`} defaultValue={block.title} maxLength={120} />
                      </label>
                      <label className="space-y-1 text-sm">
                        展示条数
                        <Input name={`block.${i}.limit`} defaultValue={String(block.limit)} maxLength={120} />
                      </label>
                      <label className="flex items-center gap-2 text-sm sm:pb-2">
                        <input
                          type="checkbox"
                          name={`block.${i}.enabled`}
                          defaultChecked={block.enabled}
                        />
                        显示
                      </label>
                    </div>
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer text-muted-foreground">
                        空态与入口文案
                      </summary>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1">
                          空态文案
                          <Input name={`block.${i}.empty_text`} defaultValue={block.empty_text ?? ""} maxLength={120} placeholder="留空使用默认文案" />
                        </label>
                        <label className="space-y-1">
                          入口文案
                          <Input name={`block.${i}.cta_label`} defaultValue={block.cta_label ?? ""} maxLength={120} placeholder="留空使用“查看全部”" />
                        </label>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </section>
            <section className="space-y-3">
              <h2 className="text-lg font-medium">首页事实徽章</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.entries(facts).map(([type, label]) => (
                  <div key={type} className="space-y-2">
                    <label className="flex gap-2 text-sm">
                      <input
                        name={`fact.${type}`}
                        type="checkbox"
                        defaultChecked={site.home.factBadges.some(
                          (badge) => badge.type === type,
                        )}
                      />
                      {label}
                    </label>
                    <Input
                      aria-label={`${label}文案`}
                      name={`fact.${type}.label`}
                      defaultValue={
                        site.home.factBadges.find((badge) => badge.type === type)
                          ?.label ?? ""
                      }
                      maxLength={40}
                      placeholder="留空使用默认文案"
                    />
                  </div>
                ))}
              </div>
            </section>
            <section className="space-y-3">
              <h2 className="text-lg font-medium">页脚</h2>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  name="footer_credit"
                  defaultChecked={site.footerCredit}
                />
                显示 Powered by 万有AI
              </label>
            </section>
          </TabsContent>
          <TabsContent value="commerce" forceMount className="space-y-8 data-[state=inactive]:hidden">
            <section className="space-y-4">
              <h2 className="text-lg font-medium">订阅价格</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {textField(
                  "amount",
                  "年度订阅价格（留空表示未开通订阅）",
                  String(site.commerce.subscriptionPrice?.amount ?? ""),
                )}
                <label className="space-y-1 text-sm">
                  币种
                  <select
                    name="currency"
                    defaultValue={currency}
                    className="block w-full rounded-md border bg-background p-2"
                  >
                    {CURRENCY_OPTIONS.some(([code]) => code === currency) ? null : (
                      <option value={currency}>{currency}</option>
                    )}
                    {CURRENCY_OPTIONS.map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <span className="block text-xs text-muted-foreground">
                    用于全站价格显示。在线收款按人民币结算，开通收款时请选人民币。
                  </span>
                </label>
                <label className="space-y-1 text-sm">
                  订阅按钮图标
                  <select
                    name="subscription_hint_icon"
                    defaultValue={site.commerce.subscriptionHint?.icon ?? ""}
                    className="block w-full rounded-md border bg-background p-2"
                  >
                    <option value="">不显示图标</option>
                    {SUBSCRIPTION_HINT_ICON_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {SUBSCRIPTION_HINT_ICON_LABELS[name]}
                      </option>
                    ))}
                  </select>
                  <span className="block text-xs text-muted-foreground">
                    显示在订阅购买按钮的价格前。
                  </span>
                </label>
                <label className="space-y-1 text-sm">
                  订阅按钮提示
                  <Input
                    name="subscription_hint_text"
                    defaultValue={site.commerce.subscriptionHint?.text ?? ""}
                    maxLength={SUBSCRIPTION_HINT_TEXT_MAX}
                    placeholder="如：约每月一杯美式"
                  />
                  <span className="block text-xs text-muted-foreground">
                    选了图标或填写提示后，订阅按钮下方显示按年价折算的月均金额，提示接在其后；两项都留空则不显示。仅作展示，不改变订单金额。
                  </span>
                </label>
                <label className="space-y-1 text-sm">
                  左栏订阅按钮落点
                  <select
                    name="subscribe_page"
                    defaultValue={subscribePageSlug}
                    className="block w-full rounded-md border bg-background p-2"
                  >
                    <option value="">默认（名片页 /card#pricing）</option>
                    {customPages.map((page) => (
                      <option key={page.slug} value={page.slug}>
                        {page.title}（/p/{page.slug}#pricing）
                      </option>
                    ))}
                  </select>
                  <span className="block text-xs text-muted-foreground">
                    选自定义页时，该页需插入 cp-subscribe 占位符，跳转后自动定位到订阅按钮。
                  </span>
                </label>
                <label className="space-y-1 text-sm">
                  退款政策页面
                  <select
                    name="refund_policy_page"
                    defaultValue={refundPageSlug}
                    className="block w-full rounded-md border bg-background p-2"
                  >
                    <option value="">不设置</option>
                    {customPages.map((page) => (
                      <option key={page.slug} value={page.slug}>
                        {page.title}（/p/{page.slug}）
                      </option>
                    ))}
                  </select>
                  <span className="block text-xs text-muted-foreground">
                    结算页与页脚的“退款政策”指向这个自定义页。
                  </span>
                </label>
              </div>
            </section>
            <section className="space-y-3">
              <h2 className="text-lg font-medium">在线收款</h2>
              <p className="text-sm text-muted-foreground">
                {zpayReady
                  ? "收款商户已配置，保存后前台购买按钮即点亮。"
                  : "收款商户尚未配置完成，勾选也不会点亮前台购买。"}
              </p>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  name="payment_enabled"
                  defaultChecked={site.commerce.paymentEnabled}
                />
                开通在线收款（zpay）
              </label>
              <div className="flex flex-wrap gap-4 text-sm">
                {(
                  [
                    ["alipay", "支付宝"],
                    ["wxpay", "微信支付"],
                  ] as const
                ).map(([channel, label]) => (
                  <label key={channel} className="flex gap-2">
                    <input
                      type="checkbox"
                      name={`channel.${channel}`}
                      defaultChecked={site.commerce.paymentChannels.includes(channel)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                所选渠道需已在 zpay 商户中心开通，否则买家无法完成支付。在线收款为四方支付通道，存在资金冻结风险，请勤提现、余额不过夜。
              </p>
            </section>
          </TabsContent>
        </Tabs>
        <div className="sticky bottom-0 z-10 mt-8 flex flex-wrap items-center gap-3 border-t bg-background/95 py-4 backdrop-blur">
          <Button disabled={pending}>
            {pending ? "保存中…" : "保存站点配置"}
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {state.message || (dirty ? "有未保存的修改" : "")}
          </p>
        </div>
      </fieldset>
    </form>
  );
}

/** 首页自定义区（Hero 与五块之间）：启用开关 + HTML 编辑 + 预览/编辑切换 + 从自定义页复制。 */
export function CustomZoneEditor({
  html: initialHtml,
  enabled,
  pages,
  fieldPrefix,
  title,
  description,
  aiContext,
  avatarReady,
}: {
  html: string;
  enabled: boolean;
  pages: { slug: string; title: string; html?: string }[];
  fieldPrefix: string;
  title: string;
  description: string;
  aiContext?: "page" | "section" | "card";
  avatarReady?: boolean;
}) {
  const [html, setHtml] = useState(initialHtml);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [preview, setPreview] = useState("");
  const [previewStale, setPreviewStale] = useState(true);
  const [copySlug, setCopySlug] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState("");

  useEffect(() => {
    if (mode !== "preview" || !previewStale) return;
    let stale = false;
    // 失败（含会话过期）也要结束“更新中”状态并提示，不能让预览永远停在加载中。
    previewPageHtml(html).then((result) => {
      if (stale) return;
      if (result.ok) setPreview(result.html);
      else setAiMessage("预览暂时不可用，请确认登录状态后重试；编辑内容已保留。");
      setPreviewStale(false);
    }).catch(() => {
      if (stale) return;
      setAiMessage("预览暂时不可用，请稍后重试；编辑内容已保留。");
      setPreviewStale(false);
    });
    return () => {
      stale = true;
    };
  }, [mode, previewStale, html]);

  const copyFrom = async () => {
    if (!copySlug || aiBusy) return;
    setAiBusy(true);
    try {
      const result = await loadPageForCopy(copySlug);
      if (!result.ok) {
        setAiMessage("页面暂时无法读取，原有内容已保留。");
        return;
      }
      if (html.trim() && !window.confirm("用所选页面的内容覆盖当前编辑区？")) return;
      setHtml(result.html);
      setPreviewStale(true);
    } catch {
      setAiMessage("页面暂时无法读取，原有内容已保留。");
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={fieldPrefix + "_enabled"}
              defaultChecked={enabled}
            />
            启用
          </label>
          <div className="flex gap-1 rounded-lg border p-0.5">
            {(["edit", "preview"] as const).map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={mode === m ? "default" : "ghost"}
                onClick={() => setMode(m)}
              >
                {m === "edit" ? "编辑" : "预览"}
              </Button>
            ))}
          </div>
        </div>
      </div>
      {aiContext ? (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <p className="text-sm font-medium">
            AI 生成初稿{avatarReady ? "" : "（请先在 AI 设置中检查共享生成连接）"}
          </p>
          <textarea
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            maxLength={2000}
            rows={4}
            disabled={!avatarReady || aiBusy}
            placeholder={
              aiContext === "card"
                ? "描述名片区内容，例如：工作经历要点 + 合作方式说明"
                : "描述区块内容与结构意图"
            }
            className="block w-full resize-y rounded-md border bg-background p-2 text-sm leading-[1.7] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!avatarReady || aiBusy || !aiPrompt.trim()}
              onClick={async () => {
                setAiBusy(true);
                setAiMessage("");
                try {
                  const res = await fetch("/api/admin/pages/generate", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      prompt: aiPrompt,
                      requestId: crypto.randomUUID(),
                      context: aiContext,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    setAiMessage(data.message ?? "生成失败");
                    return;
                  }
                  if (
                    html.trim() &&
                    !window.confirm("用生成结果覆盖当前编辑区内容？")
                  )
                    return;
                  setHtml(data.html);
                  setPreviewStale(true);
                  setAiMessage("已生成初稿，可在编辑区继续调整。");
                } catch {
                  setAiMessage("网络异常，请稍后再试。");
                } finally {
                  setAiBusy(false);
                }
              }}
            >
              {aiBusy ? "生成中…" : "生成初稿"}
            </Button>
            {aiMessage && (
              <span className="text-xs text-muted-foreground">{aiMessage}</span>
            )}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={copySlug}
          onChange={(event) => setCopySlug(event.target.value)}
          className="rounded-md border bg-background p-2"
        >
          <option value="">从自定义页复制内容…</option>
          {pages.map((page) => (
            <option key={page.slug} value={page.slug}>
              {page.title}（/p/{page.slug}）
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={copyFrom}
          disabled={!copySlug}
        >
          复制到编辑区
        </Button>
      </div>
      {mode === "edit" && (
        <MediaPicker
          label="插入素材图片"
          onSelect={(asset) => {
            setHtml((value) => value + "\n" + assetImageHtml(asset));
            setPreviewStale(true);
          }}
        />
      )}
      {/* 提交字段必须是常驻 hidden input：textarea 只在编辑模式渲染，预览态若由 textarea 承载字段会被清空 */}
      <input type="hidden" name={fieldPrefix + "_html"} value={html} />
      {mode === "edit" ? (
        <textarea
          value={html}
          onChange={(event) => {
            setHtml(event.target.value);
            setPreviewStale(true);
          }}
          rows={12}
          maxLength={200000}
          className="block w-full rounded-md border bg-background p-3 font-mono text-xs leading-relaxed"
          placeholder={'<section class="cp-section cp-grid-2">…</section>'}
        />
      ) : (
        <div className="rounded-lg border p-5" aria-label="自定义区预览">
          {previewStale ? (
            <p role="status" className="text-sm text-muted-foreground">
              正在更新预览…
            </p>
          ) : preview ? (
            <CustomHtmlBody html={preview} />
          ) : (
            <p className="text-sm text-muted-foreground">还没有内容。</p>
          )}
        </div>
      )}
    </section>
  );
}

/** 自媒体平台露出编辑器：预设平台 + 自定义，逐条添加（最多 8 条）。 */
export function SocialLinksEditor({
  links,
}: {
  links: {
    platform: SocialPlatform;
    label: string;
    url: string;
    note?: string;
  }[];
}) {
  // 每行带稳定 id 作为 key：删除中间行时，非受控输入不会错位到相邻行。
  const [rows, setRows] = useState(() => links.map((link) => ({ ...link, rowId: crypto.randomUUID() })));
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">自媒体平台露出</h2>
          <p className="text-sm text-muted-foreground">
            显示在名片「实证」区：预设 X / GitHub / 小红书 / 小宇宙 /
            公众号，或自定义平台；逐条添加，最多 8 条。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={rows.length >= 8}
          onClick={() =>
            setRows([...rows, { platform: "x", label: "", url: "", rowId: crypto.randomUUID() }])
          }
        >
          添加平台
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有平台露出。</p>
      ) : null}
      {rows.map((row, i) => (
        <div key={row.rowId} className="flex flex-wrap items-end gap-2">
          <SocialIcon platform={row.platform} className="mb-0.5" />
          <label className="space-y-1 text-sm">
            平台
            <select
              name={`social.${i}.platform`}
              defaultValue={row.platform}
              onChange={(event) =>
                setRows(rows.map((item) => item.rowId === row.rowId ? { ...item, platform: event.target.value as SocialPlatform } : item))
              }
              className="block w-36 rounded-md border bg-background p-2"
            >
              {Object.entries(SOCIAL_PLATFORMS).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            显示名
            <Input
              name={`social.${i}.label`}
              defaultValue={row.label}
              maxLength={40}
              placeholder="如：@dayou"
              className="w-44"
            />
          </label>
          <label className="space-y-1 text-sm">
            链接
            <Input
              name={`social.${i}.url`}
              defaultValue={row.url}
              maxLength={2048}
              placeholder="https://…"
              className="w-64"
            />
          </label>
          <label className="space-y-1 text-sm">
            补充说明（可选）
            <Input
              name={`social.${i}.note`}
              defaultValue={row.note ?? ""}
              maxLength={80}
              placeholder="如：每周更新"
              className="w-44"
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRows(rows.filter((item) => item.rowId !== row.rowId))}
          >
            删除
          </Button>
        </div>
      ))}
    </section>
  );
}

/** 首页首屏：一句话与副标题、布局（左对齐可配右侧图片）、行动按钮（至少勾选一个）与横幅背景图。 */
function HeroSettings({ site, disabled }: { site: SiteContext; disabled: boolean }) {
  const hero = site.home.hero;
  const [layout, setLayout] = useState(hero.layout);
  const [image, setImage] = useState(hero.imageUrl ?? "");
  const [subscribe, setSubscribe] = useState(hero.actions.subscribe.enabled);
  const [chat, setChat] = useState(hero.actions.chat.enabled);
  const [banner, setBanner] = useState(site.home.bannerEnabled);
  const subscribeReady = site.commerce.paymentEnabled && !!site.commerce.subscriptionPrice;
  const warnings = [
    subscribe && !subscribeReady ? "订阅按钮需要先设置订阅价格并开通在线收款，否则首页不显示。" : null,
    chat && !site.avatar.enabled ? "和我聊聊需要先在 AI 设置中开启分身，否则首页不显示。" : null,
  ].filter(Boolean);
  return (
    <section className="space-y-5" aria-labelledby="settings-hero">
      <h2 id="settings-hero" className="text-lg font-medium">首页首屏</h2>
      <div className="space-y-4">
        <label className="block space-y-1 text-sm">
          一句话介绍（必填；1–2 句，支持换行；显示在首页首屏与名片头部）
          <textarea name="one_liner" defaultValue={site.identity.oneLiner} rows={2} maxLength={ONE_LINER_MAX} required
            className="block w-full rounded-md border bg-background p-2" />
        </label>
        <label className="block space-y-1 text-sm">
          副标题（可选）
          <Input name="hero_subtitle" defaultValue={hero.subtitle ?? ""} maxLength={HERO_SUBTITLE_MAX}
            placeholder="一两句补充：帮谁、解决什么、怎么交付" />
        </label>
      </div>
      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1">布局</legend>
        <div className="flex flex-wrap gap-4">
          {([["center", "居中"], ["left", "左对齐（可配右侧图片）"]] as const).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="hero_layout" value={value} checked={layout === value}
                onChange={() => setLayout(value)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {layout === "left" ? (
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <ImageField name="hero_image_url" label="右侧图片（可选，随滚动视差缩放；窄屏不显示）" defaultValue={image}
            onChange={setImage} disabled={disabled} />
          <label className="space-y-1 text-sm">
            图片替代文字{image ? "（必填）" : ""}
            <Input name="hero_image_alt" defaultValue={hero.imageAlt ?? ""} maxLength={HERO_IMAGE_ALT_MAX}
              required={!!image} placeholder="描述图片内容，供读屏与图片加载失败时显示" />
          </label>
        </div>
      ) : (
        <>
          {image && <input type="hidden" name="hero_image_url" value={image} />}
          {hero.imageAlt && <input type="hidden" name="hero_image_alt" value={hero.imageAlt} />}
        </>
      )}
      <fieldset className="space-y-3 text-sm">
        <legend className="mb-1">按钮（至少勾选一个）</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="hero_action_subscribe" checked={subscribe}
                onChange={(event) => setSubscribe(event.target.checked)} />
              订阅按钮
            </label>
            <Input name="hero_action_subscribe_label" aria-label="订阅按钮文字" defaultValue={hero.actions.subscribe.label ?? ""}
              maxLength={HERO_ACTION_LABEL_MAX} placeholder="默认：订阅 · 价格 / 年" />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="hero_action_chat" checked={chat}
                onChange={(event) => setChat(event.target.checked)} />
              和我聊聊
            </label>
            <Input name="hero_action_chat_label" aria-label="和我聊聊按钮文字" defaultValue={hero.actions.chat.label ?? ""}
              maxLength={HERO_ACTION_LABEL_MAX} placeholder={`默认：${HERO_CHAT_LABEL}`} />
          </div>
        </div>
        {!subscribe && !chat && <p role="alert" className="text-destructive">至少勾选一个按钮。</p>}
        {warnings.map((warning) => <p key={warning} className="text-muted-foreground">{warning}</p>)}
        <p className="text-xs leading-6 text-muted-foreground">
          勾选和我聊聊时，首页右侧分身栏默认收起，访客点按钮后展开并直接输入。订阅按钮链接到订阅说明页，已订阅读者看到会员剩余天数。
        </p>
      </fieldset>
      <fieldset className="space-y-3 text-sm">
        <legend className="mb-1">横幅背景图</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="banner_enabled" checked={banner}
            onChange={(event) => setBanner(event.target.checked)} />
          显示首页横幅图
        </label>
        <div className="grid items-start gap-4 sm:grid-cols-2" aria-disabled={!banner || undefined}
          data-muted={!banner || undefined}>
          <ImageField name="banner_light_url" label="首页横幅图 · 浅色模式"
            defaultValue={site.home.bannerLightUrl ?? ""} disabled={disabled} />
          <ImageField name="banner_dark_url" label="首页横幅图 · 深色模式"
            defaultValue={site.home.bannerDarkUrl ?? ""} disabled={disabled} />
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          {banner
            ? "横幅按外观模式切换，每一版留空时使用对应的内置背景。浅色模式使用深色文字，深色模式使用浅色文字。"
            : "已关闭横幅图：首屏文字与按钮照常显示在页面底色上，底部加一条浅分隔线；已选图片保留。"}
        </p>
      </fieldset>
    </section>
  );
}
