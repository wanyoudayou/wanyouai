"use client";
import { useActionState } from "react";
import { saveCardSettings } from "@/app/admin/card/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageField } from "./media-library";
import type { SiteContext } from "@/lib/get-site-config";
import {
  CustomZoneEditor,
  SocialLinksEditor,
} from "@/components/admin/settings-form";

/** 名片配置表单（/admin/card）：名片基础 + 联系与约束 + 自媒体平台露出 + 名片自定义区。 */
export function CardSettingsForm({
  site,
  updated,
  customPages = [],
  avatarKeySet,
}: {
  site: SiteContext;
  updated: string;
  customPages?: { slug: string; title: string; html?: string }[];
  avatarKeySet: boolean;
}) {
  const [state, action, pending] = useActionState(saveCardSettings, {
    message: "",
    updated: "",
  });
  const bookingPageSlug = site.contact.bookingUrl?.startsWith("/p/")
    ? site.contact.bookingUrl.slice(3)
    : "";
  const fields = [
    [
      "site_name",
      "站名（必填；显示在左栏顶部、名片页与页脚署名）",
      site.siteName,
    ],
    ["owner_name", "站主名称（必填；名片身份行）", site.ownerName],
    [
      "timezone",
      "时区（必填；IANA 标识，例如 Asia/Shanghai）",
      site.identity.timezone,
    ],
    ["working_hours", "工作时间（必填）", site.constraints.workingHours ?? ""],
    ["response_time", "响应时间（必填）", site.constraints.responseTime ?? ""],
    ["current_load", "当前容量（必填）", site.constraints.currentLoad ?? ""],
    [
      "email",
      "联系邮箱（与预约页面至少填一项；建议使用公开联系邮箱）",
      site.contact.email ?? "",
    ],
    ["logo_url", "站点 Logo（留空使用站名首字）", site.identity.logoUrl ?? ""],
    ["avatar_url", "站主头像", site.identity.avatarUrl ?? ""],
  ] as const;
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="updated" value={state.updated || updated} />
      <fieldset disabled={pending} className="space-y-6">
        <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-[1.7] text-muted-foreground">
          这里管「你是谁」：首次保存请填写站名、站主、一句话，以及联系邮箱或预约页面；服务语言使用
          zh-CN、en 这样的代码。首页外观、收款与分身请去「站点配置」。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(([name, label, value]) =>
            name === "logo_url" || name === "avatar_url" ? (
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
            预约页面（自定义页；名片 CTA、页脚与服务详情的「预约」入口指向它）
            <select
              name="booking_page"
              defaultValue={bookingPageSlug}
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
        </div>
        <label className="block space-y-1 text-sm">
          一句话介绍（必填；1–2 句，支持换行；显示在首页大横幅与名片头部）
          <textarea
            name="one_liner"
            defaultValue={site.identity.oneLiner}
            rows={2}
            maxLength={180}
            className="block w-full rounded-md border bg-background p-2"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              [
                "languages",
                "服务语言代码（必填；每行一项，例如 zh-CN、en）",
                site.identity.languages,
              ],
              ["focus_areas", "专注领域（每行一项）", site.identity.focusAreas],
              [
                "exclusions",
                "不接事项（每行一项）",
                site.constraints.exclusions,
              ],
            ] as const
          ).map(([name, label, values]) => (
            <label key={name} className="space-y-1 text-sm">
              {label}
              <textarea
                name={name}
                defaultValue={values.join("\n")}
                maxLength={3000}
                className="block min-h-24 w-full rounded-md border bg-background p-2"
              />
            </label>
          ))}
        </div>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            name="show_subscription_card"
            defaultChecked={site.identity.showSubscriptionCard}
          />
          在名片页显示订阅方案卡片（左列 profile 下方，左栏订阅按钮的默认落点）
        </label>
        <SocialLinksEditor links={site.identity.socialLinks} />
        <CustomZoneEditor
          html={site.identity.customZone.html}
          enabled={site.identity.customZone.enabled}
          pages={customPages}
          fieldPrefix="card_zone"
          title="名片自定义区"
          description="显示在名片页右列；容器无样式，内容由 cp-* 卡片各自独立平铺；可编辑/预览/AI 生成。"
          aiContext="card"
          avatarReady={avatarKeySet}
        />
        <Button disabled={pending}>
          {pending ? "保存中…" : "保存名片配置"}
        </Button>
      </fieldset>
      <p role="status" className="text-sm">
        {state.message}
      </p>
    </form>
  );
}
