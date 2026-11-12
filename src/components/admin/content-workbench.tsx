"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AdminPanelPortal, useAdminPanel } from "./admin-panel";
import { AdminTabs } from "./admin-tabs";
import { PreviewPane } from "./preview-pane";
import { AttachmentLibrary, type Attachment } from "./attachment-library";
import { RevisionReview } from "./revision-review";
import { filesRequest } from "@/lib/importing/client";
import { PublicationFeedback } from "./publication-feedback";
import {
  EMPTY_FRONTMATTER,
  exportMarkdown,
  importMarkdown,
  mergeDraftMedia,
  newPublication,
  replaceDraftImage,
} from "@/lib/admin/draft";
import type {
  Frontmatter,
  Media,
  PublishInput,
  PublishResponse,
} from "@/lib/publishing/types";
const MarkdownEditor = dynamic(() => import("./markdown-editor"), {
  ssr: false,
  loading: () => (
    <p className="p-4 text-sm text-muted-foreground">正在加载编辑器…</p>
  ),
});
import { useUnsavedChanges } from "./use-unsaved-changes";
import { ImageField, MediaPicker } from "./media-library";
import { uploadLibraryImage } from "@/lib/media/client";
import { assetMedia } from "@/lib/media/types";
const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70";
export function ContentWorkbench({
  series,
  initialType = "blog",
  initialDraft,
  initialSeries,
}: {
  initialDraft?: {
    id: number;
    path: string;
    frontmatter: Frontmatter;
    markdown: string;
    media: Media[];
    attachments: Attachment[];
  };
  initialType?: Frontmatter["type"];
  initialSeries?: string;
  series: { slug: string; title: string; type: string }[];
}) {
  const { show } = useAdminPanel();
  const router = useRouter();
  const [frontmatter, setFrontmatter] = useState<Frontmatter>(
    () =>
      initialDraft?.frontmatter ?? {
        ...EMPTY_FRONTMATTER,
        type: initialType,
        ...(initialType === "chapter"
          ? { series_slug: initialSeries ?? series[0]?.slug ?? "" }
          : {}),
      },
  );
  const [markdown, setMarkdown] = useState(initialDraft?.markdown ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>(
    initialDraft?.attachments ?? [],
  );
  const [insertRequest, setInsertRequest] = useState<{
    id: string;
    text: string;
  }>();
  const [savedRevision, setSavedRevision] = useState<number>();
  const [expectedRevision, setExpectedRevision] = useState(
    initialDraft?.id ?? 0,
  );
  const [documentPath, setDocumentPath] = useState(initialDraft?.path ?? "");
  const [media, setMedia] = useState<Media[]>(initialDraft?.media ?? []);
  const [importStatus, setImportStatus] = useState("");
  const [importing, setImporting] = useState(false);
  const [sourcePath, setSourcePath] = useState("");
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attempt, setAttempt] = useState<PublishInput | null>(null);
  const [result, setResult] = useState<PublishResponse | null>(null);
  const [message, setMessage] = useState("");
  const snapshot = JSON.stringify([frontmatter, markdown, media]);
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  useUnsavedChanges(snapshot !== savedSnapshot);
  const locked = pending || uploading || importing || attempt !== null;

  async function loadFile(file: File) {
    if (locked) return;
    setImporting(true);
    setImportStatus("正在读取文件…");
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("Markdown 文件不能超过 2 MiB。");
      const imported = importMarkdown(await file.text(), file.name);
      if ((initialType === "skill" || initialDraft?.frontmatter.type === "skill") && imported.frontmatter.type !== "skill") {
        imported.frontmatter = { ...imported.frontmatter, type: "skill", access: "public" };
        delete imported.frontmatter.price; delete imported.frontmatter.series_slug;
      }
      setFrontmatter(imported.frontmatter);
      setMarkdown(imported.markdown);
      setMedia([]);
      setAttachments([]);
      setResult(null);
      setSavedRevision(undefined);
      setExpectedRevision(0);
      setDocumentPath(file.name);
      setMessage("");
      setImportStatus(
        `已导入「${file.name}」。请检查标题、文章地址和阅读权限。${imported.ignored.length ? `未导入的文件属性：${imported.ignored.join("、")}。` : ""}`,
      );
    } catch (error) {
      setImportStatus(
        error instanceof Error ? error.message : "文件无法导入，原草稿已保留。",
      );
    } finally {
      setImporting(false);
    }
  }
  async function uploadImage(file: File) {
    if (locked) return;
    setUploading(true);
    setMessage("");
    try {
      const { asset } = await uploadLibraryImage(file, setMessage);
      const data = { url: asset.url };
      const uploaded = assetMedia(asset, sourcePath || file.name);
      setMedia((items) => mergeDraftMedia(items, uploaded));
      setAttachments((items) => [
        ...items.filter((i) => i.name !== uploaded.source_path),
        {
          name: uploaded.source_path,
          url: data.url,
          width: uploaded.width,
          height: uploaded.height,
        },
      ]);
      setMarkdown((value) => {
        const replacement = replaceDraftImage(
          value,
          uploaded.source_path,
          data.url,
        );
        return replacement.replaced ? replacement.markdown : value;
      });
      setFrontmatter((fm) =>
        fm.cover === uploaded.source_path ? { ...fm, cover: data.url } : fm,
      );
      setMessage(
        "图片已加入附件库，点击缩略图插入正文。已匹配的缺图引用自动补齐。",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "图片上传失败，请重试。",
      );
    } finally {
      setUploading(false);
    }
  }
  function enablePaywall() {
    if (locked || frontmatter.type === "skill") return;
    setFrontmatter((fm) =>
      fm.access === "public" ? { ...fm, access: "paid" } : fm,
    );
    setMessage(
      frontmatter.access === "public"
        ? "已启用付费阅读。切点前为公开预览，切点后为受限正文；独立博客还需填写单篇价格。"
        : "付费切点已定位，预览会按当前阅读权限更新。",
    );
  }
  function downloadDraft() {
    const url = URL.createObjectURL(
      new Blob([exportMarkdown(frontmatter, markdown)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${/^[a-z0-9-]+$/.test(frontmatter.slug) ? frontmatter.slug : "draft"}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function submit(andPublish = false) {
    if (pending || uploading) return;
    const normalized = { ...frontmatter };
    if (!normalized.cover) delete normalized.cover;
    const request =
      attempt ??
      newPublication(
        {
          ...normalized,
          ...(frontmatter.tags
            ? {
                tags: frontmatter.tags.map((tag) => tag.trim()).filter(Boolean),
              }
            : {}),
        },
        markdown,
        media,
      );
    setAttempt(request);
    setPending(true);
    setResult(null);
    setMessage("正在保存修订…");
    try {
      const scope =
        request.frontmatter.type === "chapter"
          ? "series:" + request.frontmatter.series_slug
          : request.frontmatter.type === "skill" ? "skill" : "blog";
      const path = documentPath || request.frontmatter.slug + ".md";
      const candidate = { scope, path, input: request, hashes: {} };
      const checked = await filesRequest<{ expected: number; change: string }>({
        op: "compare",
        candidate,
      });
      if (expectedRevision && checked.expected !== expectedRevision)
        throw new Error("云端已有其他修订，请在文件目录审核最新版本。");
      const saved = await filesRequest<{ id: number }>({
        op: "stage",
        candidate,
        expected: checked.expected,
      });
      setSavedSnapshot(snapshot);
      setSavedRevision(saved.id);
      setExpectedRevision(saved.id);
      setDocumentPath(path);
      setAttempt(null);
      if (andPublish) {
        // 「保存并直接发布」：同一管线串联 stage → commit，幂等不变；被 lint 阻断则回落审核面板
        const published = await filesRequest<PublishResponse>({
          op: "publish",
          id: saved.id,
        });
        if (published.status === "blocked") {
          setMessage("发布被规则阻断，请在下方审核面板查看原因并处理。");
        } else {
          setResult(published);
          setSavedRevision(undefined);
          setMessage("已发布，线上内容已更新。");
          router.refresh();
        }
      } else {
        setMessage(
          "修订已保存或匹配到已有版本。请在下方审核面板确认发布状态。",
        );
      }
    } catch (error) {
      setAttempt(null);
      setMessage((error as Error).message + " 草稿已保留，可修正后重试保存。");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <AdminTabs active={frontmatter.type === "chapter" ? "albums" : "blog"} />
      <fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
        {(
          [
            ["title", "标题"],
            ["slug", "文章地址标识（slug）"],
            ["summary", "摘要"],
            ["cover", "封面图片地址（可选）"],
          ] as const
        ).map(([key, label]) =>
          key === "cover" ? (
            <ImageField
              key={key}
              label={label}
              value={frontmatter.cover ?? ""}
              disabled={locked}
              onChange={(url) => setFrontmatter({ ...frontmatter, cover: url })}
            />
          ) : (
            <label key={key} className="space-y-2 text-sm">
              {label}
              <Input
                disabled={
                  key === "slug" &&
                  media.some(
                    (item) => !item.storage_path.startsWith("media/library/"),
                  )
                }
                placeholder={key === "slug" ? "例如 my-first-post" : undefined}
                aria-describedby={key === "slug" ? "slug-help" : undefined}
                value={frontmatter[key] ?? ""}
                onChange={(event) =>
                  setFrontmatter({ ...frontmatter, [key]: event.target.value })
                }
                maxLength={key === "slug" ? 120 : key === "title" ? 180 : 500}
              />
              {key === "slug" && (
                <span
                  id="slug-help"
                  className="block break-all text-xs leading-5 text-muted-foreground"
                >
                  用于文章网址的固定标识，需 2–120 个小写字母、数字或短横线。
                  {frontmatter.type !== "chapter"
                    ? `网址示例：/${frontmatter.type === "skill" ? "skills" : "blog"}/${frontmatter.slug || "my-first-post"}`
                    : `章节参数：?article=${frontmatter.slug || "chapter-one"}`}
                  。相同标识会更新原文章，请勿用于不同内容。
                </span>
              )}
            </label>
          ),
        )}
        <label className="space-y-2 text-sm">
          内容类型
          <select
            className={selectClass}
            aria-label="内容类型"
            aria-describedby={frontmatter.type === "skill" ? "skill-type-help" : undefined}
            value={frontmatter.type}
            disabled={initialType === "skill" || initialDraft?.frontmatter.type === "skill"}
            onChange={(event) => {
              const type = event.target.value as Frontmatter["type"];
              setFrontmatter((fm) => {
                const next = { ...fm, type };
                delete next.price;
                delete next.series_slug;
                if (type === "chapter")
                  next.series_slug = series[0]?.slug ?? "";
                return next;
              });
            }}
          >
            <option value="blog">独立博客</option>
            <option value="chapter">专辑章节</option>
            {frontmatter.type === "skill" && <option value="skill">Skill 公开介绍</option>}
          </select>
          {frontmatter.type === "skill" && <span id="skill-type-help" className="block text-xs text-muted-foreground">已固定为 Skill 公开介绍。</span>}
        </label>
        <label className="space-y-2 text-sm">
          阅读权限
          <select
            className={selectClass}
            aria-label="阅读权限"
            aria-describedby={frontmatter.type === "skill" ? "skill-access-help" : undefined}
            value={frontmatter.access}
            disabled={frontmatter.type === "skill"}
            onChange={(event) => {
              const access = event.target.value as Frontmatter["access"];
              setFrontmatter((fm) => {
                const next = { ...fm, access };
                delete next.price;
                return next;
              });
            }}
          >
            <option value="public">公开</option>
            <option value="registered">注册可读</option>
            <option value="subscriber">订阅可读</option>
            <option value="paid">付费可读</option>
          </select>
          {frontmatter.type === "skill" && <span id="skill-access-help" className="block text-xs text-muted-foreground">介绍全文公开；文件下载和在线测试按 Skill 权益控制。</span>}
        </label>
        {frontmatter.type === "chapter" && (
          <label className="space-y-2 text-sm">
            所属专辑
            <select
              className={selectClass}
              value={frontmatter.series_slug ?? ""}
              onChange={(event) =>
                setFrontmatter({
                  ...frontmatter,
                  series_slug: event.target.value,
                })
              }
            >
              <option value="">请选择专辑</option>
              {series.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {frontmatter.type === "blog" && frontmatter.access === "paid" && (
          <label className="space-y-2 text-sm">
            单篇价格（元）
            <Input
              type="number"
              min="0.01"
              max="999999.99"
              step="0.01"
              value={frontmatter.price ?? ""}
              onChange={(event) =>
                setFrontmatter({
                  ...frontmatter,
                  price: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
        )}
        <label className="space-y-2 text-sm">
          标签（英文逗号分隔）
          <Input
            value={frontmatter.tags?.join(",") ?? ""}
            onChange={(event) =>
              setFrontmatter({
                ...frontmatter,
                tags: event.target.value.split(","),
              })
            }
          />
        </label>
      </fieldset>
      <fieldset disabled={locked} className="space-y-4 rounded-lg border p-4">
        <label className="block space-y-2 text-sm">
          导入 .md 文件（替换当前草稿）
          <Input
            type="file"
            accept=".md,.markdown,text/markdown"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
              event.target.value = "";
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          支持普通 Markdown 或带文件属性的
          Markdown，缺少的发布信息可在上方补齐。
        </p>
        <p role="status" aria-live="polite" className="break-words text-sm">
          {importStatus}
        </p>
        <label className="block space-y-2 text-sm">
          原图片引用路径（可选，用于补齐缺图）
          <Input
            placeholder="例如 assets/diagram.png"
            value={sourcePath}
            onChange={(event) => setSourcePath(event.target.value)}
          />
        </label>
        <label className="block space-y-2 text-sm">
          上传图片（也可拖入编辑器）
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadImage(file);
              event.target.value = "";
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          图片上传后公开可访问；正文的阅读权限不保护图片 URL。每次上传一张，最大
          10 MiB。已上传图片可在全站素材库重复选用。
        </p>
      </fieldset>
      <MediaPicker
        disabled={locked}
        label="从素材库插入正文"
        onSelect={(asset) =>
          setInsertRequest({
            id: crypto.randomUUID(),
            text: `![${(asset.alt || asset.name).replace(/[\\\[\]\r\n]/g, " ")}](<${asset.url}>)`,
          })
        }
      />
      <AttachmentLibrary
        items={attachments}
        disabled={locked}
        onInsert={(text) => setInsertRequest({ id: crypto.randomUUID(), text })}
      />
      <div className="min-w-0 space-y-4">
        <Button
          type="button"
          variant="outline"
          onClick={(event) => show("匿名预览", event.currentTarget)}
        >
          匿名预览
        </Button>
        <section className="min-w-0 space-y-3">
          <h2 className="text-lg font-medium">Markdown 正文</h2>
          <p className="text-xs text-muted-foreground">
            在正文光标处插入付费切点；已有切点时会跳转定位。
          </p>
          <MarkdownEditor
            value={markdown}
            onChange={setMarkdown}
            disabled={locked}
            onImage={uploadImage}
            onPaywall={enablePaywall}
            insertRequest={insertRequest}
          />
        </section>
        <AdminPanelPortal>
          <PreviewPane
            markdown={markdown}
            access={frontmatter.access}
            onRestrict={enablePaywall}
            disabled={locked}
          />
        </AdminPanelPortal>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => submit()} disabled={pending || uploading}>
          {pending ? "正在保存…" : attempt ? "重试保存" : "保存待发布修订"}
        </Button>
        <Button
          variant="outline"
          onClick={() => submit(true)}
          disabled={pending || uploading}
          title="保存并立即确认发布（仍走同一发布管线，幂等不变）"
        >
          保存并直接发布
        </Button>
        <Button variant="outline" onClick={downloadDraft}>
          下载草稿
        </Button>
      </div>
      {savedRevision && (
        <RevisionReview
          key={savedRevision}
          id={savedRevision}
          autoLoad
          onPublished={() => router.refresh()}
        />
      )}
      <PublicationFeedback result={result} message={message} />
    </div>
  );
}
