"use client";
import { useActionState, useEffect, useState } from "react";
import { loadPageForCopy, previewPageHtml } from "@/app/admin/pages-actions";
import { CustomHtmlBody } from "@/components/custom/custom-html-body";
import { saveSettings } from "@/app/admin/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageField, MediaPicker } from "./media-library";
import { assetImageHtml } from "@/lib/media/html";
import {
  HOME_BLOCK_TITLES,
  SOCIAL_PLATFORMS,
  type FactBadgeType,
  type SocialPlatform,
} from "@/types/site";
import type { SiteContext } from "@/lib/get-site-config";
const facts: Record<FactBadgeType, string> = {
  series_count: "专辑数",
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
  const fields = [
    ["tagline", "站点简介", site.tagline ?? ""],
    ["ask_placeholder", "首页提问提示", site.home.askPlaceholder],
    ["banner_light_url", "首页横幅 · 浅色模式", site.home.bannerLightUrl ?? ""],
    ["banner_dark_url", "首页横幅 · 深色模式", site.home.bannerDarkUrl ?? ""],
    [
      "amount",
      "年度订阅价格（留空表示未开通订阅）",
      String(site.commerce.subscriptionPrice?.amount ?? ""),
    ],
    ["currency", "币种", site.commerce.subscriptionPrice?.currency ?? "CNY"],
  ];
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="updated" value={updated} />
      <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-[1.7] text-muted-foreground">
        设置首页展示、订阅与收款、政策和页脚。站主资料在「站主名片」管理，模型与额度在「站主分身」管理。
      </p>
      <fieldset disabled={pending} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(([name, label, value]) =>
            name.startsWith("banner_") ? (
              <ImageField
                key={name}
                name={name}
                label={label}
                defaultValue={value}
                disabled={pending}
              />
            ) : (
              <label key={name} className="space-y-1 text-sm">
                {label}
                <Input name={name} defaultValue={value} maxLength={2048} />
              </label>
            ),
          )}
          <label className="space-y-1 text-sm">
            退款政策页面（自定义页；结算页与页脚的「退款政策」指向它）
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
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              name="hero_enabled"
              defaultChecked={site.home.heroEnabled}
            />
            显示首页横幅
          </label>
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          横幅按外观模式切换，每一版留空时使用对应的内置背景。浅色模式使用深色文字，深色模式使用浅色文字。
        </p>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            name="footer_credit"
            defaultChecked={site.footerCredit}
          />
          显示 Powered by 万有AI
        </label>
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
        <h2 className="text-lg font-medium">在线收款</h2>
        <label className="block max-w-md space-y-1 text-sm">
          左栏订阅按钮落点（默认名片页；选自定义页时，该页内需插入 cp-subscribe
          占位符，跳转自动定位到订阅按钮）
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
        </label>
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
          所选渠道需已在 zpay 商户中心开通，否则买家无法完成支付。
        </p>
        <p className="text-sm text-muted-foreground">
          {zpayReady
            ? "支付通道已配置，保存后前台购买按钮即点亮。"
            : "收款商户尚未配置完成，勾选也不会点亮前台购买。"}
        </p>
        <p className="text-sm text-muted-foreground">
          提醒：在线收款为四方支付通道，存在资金冻结风险，请勤提现、余额不过夜。
        </p>
        <h2 className="text-lg font-medium">首页五块</h2>
        <p className="text-sm text-muted-foreground">
          按显示顺序设置，五个内容区块各出现一次；名片 Hero
          是固定首屏，用上方开关控制显隐。
        </p>
        {site.home.blocks.map((block, i) => (
          <div
            key={i}
            className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"
          >
            <label className="text-sm">
              第 {i + 1} 块
              <select
                name={`block.${i}.type`}
                defaultValue={block.type}
                className="mt-1 block w-full rounded-md border bg-background p-2"
              >
                {Object.entries(HOME_BLOCK_TITLES).map(([type, title]) => (
                  <option key={type} value={type}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={`block.${i}.enabled`}
                defaultChecked={block.enabled}
              />
              显示
            </label>
            {(
              [
                ["title", "标题", block.title],
                ["empty_text", "空态文案", block.empty_text ?? ""],
                ["cta_label", "入口文案", block.cta_label ?? ""],
                ["limit", "展示条数", String(block.limit)],
              ] as const
            ).map(([key, label, value]) => (
              <label key={key} className="text-sm">
                {label}
                <Input
                  name={`block.${i}.${key}`}
                  defaultValue={value}
                  maxLength={120}
                />
              </label>
            ))}
          </div>
        ))}
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
        <Button disabled={pending}>
          {pending ? "保存中…" : "保存站点配置"}
        </Button>
      </fieldset>
      <p role="status" className="text-sm">
        {state.message}
      </p>
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
    previewPageHtml(html).then((result) => {
      if (!stale && result.ok) {
        setPreview(result.html);
        setPreviewStale(false);
      }
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
  const [rows, setRows] = useState(links.length ? links : []);
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
            setRows([...rows, { platform: "x", label: "", url: "" }])
          }
        >
          添加平台
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有平台露出。</p>
      ) : null}
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-sm">
            平台
            <select
              name={`social.${i}.platform`}
              defaultValue={row.platform}
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
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            删除
          </Button>
        </div>
      ))}
    </section>
  );
}
