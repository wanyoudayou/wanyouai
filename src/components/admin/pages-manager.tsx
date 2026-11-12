"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useActionState } from "react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { CustomHtmlBody } from "@/components/custom/custom-html-body";
import { savePageAction, previewPageHtml } from "@/app/admin/pages-actions";
import type { CustomPageRow } from "@/lib/admin/pages";

import { useUnsavedChanges } from "./use-unsaved-changes";
import { MediaPicker } from "./media-library";
import { assetImageHtml } from "@/lib/media/html";
const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档",
};
const STATUS_TONE: Record<string, "free" | "owned" | "paused"> = {
  draft: "paused",
  published: "owned",
  archived: "paused",
};
const PLACEMENT_LABEL: Record<string, string> = {
  nav: "左侧栏",
  footer: "底部",
  none: "不固定",
};

/** 页面管理（/admin?tab=pages）：列表 + 编辑（预览/编辑切换 + AI 生成初稿 + 导航设置）。 */
export function PagesManager({
  pages,
  avatarReady,
}: {
  pages: CustomPageRow[];
  avatarReady: boolean;
}) {
  const [editing, setEditing] = useState<CustomPageRow | "new" | null>(null);
  if (editing)
    return (
      <PageEditor
        page={editing === "new" ? null : editing}
        avatarReady={avatarReady}
        onDone={() => setEditing(null)}
      />
    );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          自定义页面对外地址为 /p/网址标识；发布位置可选左侧栏 / 底部 / 不固定。
        </p>
        <Button size="sm" onClick={() => setEditing("new")}>
          新建页面
        </Button>
      </div>
      {pages.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          还没有自定义页面。点击「新建页面」创建第一个，或用 AI 生成初稿。
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {pages.map((page) => (
            <li
              key={page.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{page.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  /p/{page.slug} ·{" "}
                  {PLACEMENT_LABEL[page.placement] ?? page.placement}
                  {page.nav_label && page.placement !== "none"
                    ? `「${page.nav_label}」#${page.nav_order}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge tone={STATUS_TONE[page.status] ?? "paused"}>
                  {STATUS_LABEL[page.status] ?? page.status}
                </StatusBadge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(page)}
                >
                  编辑
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PageEditor({
  page,
  avatarReady,
  onDone,
}: {
  page: CustomPageRow | null;
  avatarReady: boolean;
  onDone: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: { message: string; ok: boolean }, form: FormData) => {
      const result = await savePageAction(previous, form);
      if (result.ok) setDirty(false);
      return result;
    },
    { message: "", ok: false },
  );
  useUnsavedChanges(dirty);
  const router = useRouter();
  const returnTo = useSearchParams().get("returnTo");
  useEffect(() => {
    if (state.ok && "id" in state && typeof state.id === "number") {
      router.replace(
        `/admin/pages/${state.id}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`,
      );
      router.refresh();
    }
  }, [state, router, returnTo]);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [html, setHtml] = useState(page?.html ?? "");
  const [preview, setPreview] = useState("");
  const [previewStale, setPreviewStale] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState("");

  // 预览即时净化（与保存/前台同一管线）
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

  const generate = async () => {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    setAiMessage("");
    try {
      const res = await fetch("/api/admin/pages/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt, requestId: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiMessage(data.message ?? "生成失败");
        return;
      }
      if (html.trim() && !window.confirm("用生成结果覆盖当前编辑器内容？"))
        return;
      setHtml(data.html);
      setDirty(true);
      setPreviewStale(true);
      setAiMessage("已生成初稿，可在编辑器里继续调整。");
    } catch {
      setAiMessage("网络异常，请稍后再试。");
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!dirty || window.confirm("有未保存的修改，确定返回？"))
              onDone();
          }}
        >
          ← 返回列表
        </Button>
        <div className="flex gap-1 rounded-lg border p-0.5">
          {(["edit", "preview"] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? "default" : "ghost"}
              onClick={() => setMode(m)}
            >
              {m === "edit" ? "编辑" : "预览"}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2 rounded-lg border p-4">
        <p className="text-sm font-medium">
          AI 生成初稿{avatarReady ? "" : "（请先在 AI 设置中检查共享生成连接）"}
        </p>
        <div className="flex items-start gap-2">
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            maxLength={2000}
            rows={5}
            placeholder="描述页面内容与结构，例如：一个订阅权益说明页，含三种身份对比卡片和行动号召。迭代时：把当前 HTML 和修改意见一起粘贴进来，可基于现状改进。"
            disabled={!avatarReady || aiBusy}
            className="block w-full resize-y rounded-md border bg-background p-2 text-sm leading-[1.7] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={generate}
            disabled={!avatarReady || aiBusy || !aiPrompt.trim()}
          >
            {aiBusy ? "生成中…" : "生成初稿"}
          </Button>
        </div>
        {aiMessage && (
          <p className="text-xs text-muted-foreground">{aiMessage}</p>
        )}
      </div>

      <form
        action={action}
        onChange={() => setDirty(true)}
        className="space-y-4"
      >
        <input type="hidden" name="id" value={page?.id ?? ""} />
        <input type="hidden" name="updated_at" value={page?.updated_at ?? ""} />
        <input type="hidden" name="html" value={html} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            标题
            <Input
              name="title"
              defaultValue={page?.title ?? ""}
              maxLength={120}
              required
            />
          </label>
          <label className="space-y-1 text-sm">
            网址标识（/p/…）
            <Input
              name="slug"
              defaultValue={page?.slug ?? ""}
              maxLength={61}
              placeholder="my-landing"
              required
              pattern="[a-z0-9][a-z0-9-]*"
            />
          </label>
          <label className="space-y-1 text-sm">
            描述（SEO 摘要，可空）
            <Input
              name="description"
              defaultValue={page?.description ?? ""}
              maxLength={200}
            />
          </label>
          <label className="space-y-1 text-sm">
            状态
            <select
              name="status"
              defaultValue={page?.status ?? "draft"}
              className="block w-full rounded-md border bg-background p-2"
            >
              {Object.entries(STATUS_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            发布位置
            <select
              name="placement"
              defaultValue={page?.placement ?? "none"}
              className="block w-full rounded-md border bg-background p-2"
            >
              {Object.entries(PLACEMENT_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            显示名称（左栏/页脚链接文字；留空用页面标题）
            <Input
              name="nav_label"
              defaultValue={page?.nav_label ?? ""}
              maxLength={40}
            />
          </label>
          <label className="space-y-1 text-sm">
            导航排序号（越小越靠前）
            <Input
              name="nav_order"
              type="number"
              defaultValue={page?.nav_order ?? 0}
            />
          </label>
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
        {mode === "edit" ? (
          <label className="block space-y-1 text-sm">
            页面 HTML（只用 cp-* 语义类，保存时自动净化；插入 &lt;div
            class=&quot;cp-subscribe&quot;&gt;&lt;/div&gt;
            可在该位置放置实时订阅按钮，价格与开关随站点配置）
            <textarea
              value={html}
              onChange={(e) => {
                setHtml(e.target.value);
                setPreviewStale(true);
              }}
              rows={18}
              className="block w-full rounded-md border bg-background p-3 font-mono text-xs leading-relaxed"
              placeholder={
                '<section class="cp-section cp-center">\n  <h1 class="cp-h1">标题</h1>\n  <p class="cp-lead">一句话说明</p>\n  <a class="cp-cta" href="https://…">立即预约</a>\n</section>'
              }
            />
          </label>
        ) : (
          <div className="rounded-lg border p-5" aria-label="页面预览">
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

        <div className="flex items-center gap-3">
          <Button disabled={pending}>{pending ? "保存中…" : "保存页面"}</Button>
          <p role="status" className="text-sm text-muted-foreground">
            {state.message}
          </p>
        </div>
      </form>
    </div>
  );
}
