"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { manageContent } from "@/app/admin/manage-actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
const ARCHIVE_AFTER_MS = 92 * 86_400_000; // 停售满 3 个月（≈92 天）才可归档（权益保留期）
type Item = {
  id: number;
  status: string;
  updated_at: string;
  paused_at?: string | null;
  readme_article_id?: number | null;
  featured?: boolean;
  price?: number | null;
  type?: string;
  access?: string;
};
type Chapter = { id: number; slug: string; title: string };
export function ContentControls({
  kind,
  item,
  now,
  chapters = [],
  versions = [],
}: {
  kind: "article" | "series";
  item: Item;
  now: string;
  chapters?: Chapter[];
  versions?: { version: number; created_at: string }[];
}) {
  const nowMs = Date.parse(now); // 服务端渲染时刻，由服务端详情读取注入（保持渲染纯净）
  const [state, action, pending] = useActionState(manageContent, {
    ok: false,
    message: "",
  });
  const [requestId, setRequestId] = useState("");
  const [operation, setOperation] = useState("");
  const editEntry =
    kind === "article" ? (
      <Button
        asChild
        variant="outline"
        size="sm"
        className="w-full justify-start"
      >
        <Link href={`/admin/content?article=${item.id}`}>
          编辑内容（载入工作台）
        </Link>
      </Button>
    ) : null;
  if (item.status === "archived")
    return (
      <div className="space-y-3">
        {editEntry}
        <p className="text-xs text-muted-foreground">
          已归档，不可阅读或恢复。
        </p>
      </div>
    );
  if (kind === "article" && item.status === "draft")
    return (
      <div className="space-y-3">
        {editEntry}
        <p className="text-xs text-muted-foreground">
          草稿可编辑后通过发布管线发布。
        </p>
      </div>
    );
  return (
    <form action={action} className="space-y-3">
      {editEntry}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="updated" value={item.updated_at} />
      <input type="hidden" name="request_id" value={requestId} />
      <input
        type="hidden"
        name="action"
        value={
          ["readme", "featured", "price", "version"].includes(operation)
            ? operation
            : "status"
        }
      />
      <fieldset disabled={pending} className="space-y-3">
        <div className="flex flex-col gap-2" aria-label="可用操作">
          {[
            ...(kind === "series"
              ? [
                  {
                    value: "featured",
                    label: item.featured ? "取消置顶" : "置顶精选",
                  },
                  { value: "readme", label: "设置公开 README" },
                ]
              : [{ value: "version", label: "回滚到历史版本" }]),
            ...((kind === "series" && item.type !== "event") ||
            (kind === "article" &&
              item.type === "blog" &&
              item.access === "paid")
              ? [{ value: "price", label: "修改价格" }]
              : []),
            ...(item.status === "draft" && kind === "series"
              ? [{ value: "published", label: "上架专辑" }]
              : []),
            ...(item.status === "published"
              ? [{ value: "paused", label: "暂停销售（仍可阅读）" }]
              : []),
            ...(item.status === "paused"
              ? [
                  { value: "published", label: "恢复发布" },
                  { value: "archived", label: "归档（停止阅读）" },
                ]
              : []),
          ].map(({ value, label }) => {
            const archiveBlocked =
              value === "archived" &&
              (!item.paused_at ||
                Date.parse(item.paused_at) > nowMs - ARCHIVE_AFTER_MS);
            const eligibleDate = item.paused_at
              ? new Date(
                  Date.parse(item.paused_at) + ARCHIVE_AFTER_MS,
                ).toLocaleDateString("zh-CN")
              : "";
            return (
              <span key={value}>
                <Button
                  type="button"
                  variant={operation === value ? "secondary" : "outline"}
                  className="h-auto min-h-9 w-full justify-start whitespace-normal text-left"
                  aria-pressed={operation === value}
                  disabled={archiveBlocked}
                  onClick={() => {
                    setOperation(value);
                    setRequestId(crypto.randomUUID());
                  }}
                >
                  {label}
                </Button>
                {archiveBlocked && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    停售满 3 个月后可归档（{eligibleDate} 起；权益保留期）。
                  </span>
                )}
              </span>
            );
          })}
        </div>
        {kind === "series" && item.type === "event" ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/events/${item.id}`}>报名名单 / 核销</Link>
          </Button>
        ) : null}
        {operation === "price" ? (
          <label className="block text-sm">
            价格（元）
            <Input
              onChange={() => setRequestId(crypto.randomUUID())}
              name="value"
              type="number"
              min={kind === "article" ? "0.01" : "0"}
              max="999999.99"
              step="0.01"
              required
              defaultValue={item.price ?? 0}
            />
          </label>
        ) : operation === "version" ? (
          <label className="block text-sm">
            历史版本号
            <select
              name="value"
              required
              onChange={() => setRequestId(crypto.randomUUID())}
              className="mt-2 block w-full rounded-md border bg-background p-2"
            >
              <option value="">选择当前页历史版本</option>
              {versions.map((version) => (
                <option key={version.version} value={version.version}>
                  版本 {version.version} ·{" "}
                  {new Date(version.created_at).toISOString().slice(0, 16)} UTC
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              恢复该版本的正文及发布属性，保留历史；当前暂停状态不变。同内容不新增版本。
            </span>
          </label>
        ) : operation === "readme" ? (
          <label className="block text-sm">
            公开 README
            <Input
              name="value"
              required
              defaultValue={
                chapters.find(
                  (chapter) => chapter.id === item.readme_article_id,
                )?.slug ?? ""
              }
              placeholder="填写本专辑公开章节的 slug"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              填写本专辑已发布公开章节的标识；可在下方章节列表中查找。保存时会验证归属与公开权限。
            </span>
          </label>
        ) : (
          <input
            type="hidden"
            name="value"
            value={
              operation === "featured" ? String(!item.featured) : operation
            }
          />
        )}
        {operation === "paused" && (
          <p className="text-xs text-muted-foreground">
            停售不停读：已购读者可继续阅读；将自动向付费购买者发送停售通知邮件（含
            3 个月权益保留期，未配置邮件则仅停售不通知）。
          </p>
        )}
        {operation === "archived" && (
          <label className="flex items-start gap-2 text-sm">
            <input
              name="archive_notice"
              type="checkbox"
              required
              className="mt-1"
            />
            <span>
              确认归档：归档后所有读者停止阅读且不可恢复，不自动退款；归档不发送邮件（停售时已通知，权益保留期已满）。
            </span>
          </label>
        )}
        {operation && (
          <Button size="sm" disabled={pending}>
            {pending ? "保存中…" : "确认操作"}
          </Button>
        )}
      </fieldset>
      <p role="status" className="text-sm">
        {state.message}
      </p>
    </form>
  );
}
