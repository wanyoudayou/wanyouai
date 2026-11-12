"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { DownloadIcon, EyeIcon, FileUpIcon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AdminPanelPortal, useAdminPanel } from "./admin-panel";
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
const ACCESS_HELP: Record<string, string> = {
  public: "任何人可读全文。",
  registered: "登录后可读；切点前的内容对访客公开。",
  subscriber: "有效订阅者可读；切点前的内容公开预览。",
  paid: "购买本篇、所属手册或订阅后可读；切点前的内容公开预览。",
  skill: "介绍全文公开；文件下载和在线使用按技能权益控制。",
};
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
  const markdownInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const markdownRef = useRef(markdown);
  useEffect(() => {
    markdownRef.current = markdown;
  }, [markdown]);

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
  async function uploadImage(file: File, insert = false) {
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
      const replacement = replaceDraftImage(
        markdownRef.current,
        uploaded.source_path,
        data.url,
      );
      if (replacement.replaced) setMarkdown(replacement.markdown);
      else if (insert)
        setInsertRequest({
          id: crypto.randomUUID(),
          text: `![${uploaded.source_path.replace(/[\\\[\]\r\n]/g, " ")}|${uploaded.width}x${uploaded.height}](<${data.url}>)`,
        });
      setFrontmatter((fm) =>
        fm.cover === uploaded.source_path ? { ...fm, cover: data.url } : fm,
      );
      setMessage(
        replacement.replaced
          ? "图片已上传，正文中对应的缺图已补齐。"
          : insert
            ? "图片已上传并插入正文光标处。"
            : "图片已上传，可在下方本篇图片中点击插入。",
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
    // 部分浏览器在点击后异步开始下载，立即回收会取消下载。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          // 阻断诊断交给发布反馈区展示，修订保留以便修正后重新发布。
          setResult(published);
          setMessage("发布被规则阻断，原因见下方；修订已保存，修正后可重新发布。");
        } else {
          setResult(published);
          setSavedRevision(undefined);
          setMessage("已发布，线上内容已更新。");
          router.refresh();
        }
      } else {
        setMessage(
          "已保存，线上内容未改变。可在下方核对后发布。",
        );
      }
    } catch (error) {
      setAttempt(null);
      setMessage((error as Error).message + " 草稿已保留，可修正后重试保存。");
    } finally {
      setPending(false);
    }
  }
  const dirty = snapshot !== savedSnapshot;
  const field = (
    key: "title" | "slug" | "summary",
    label: string,
    extra: Partial<ComponentProps<typeof Input>> = {},
  ) => (
    <Input
      aria-label={label}
      value={frontmatter[key] ?? ""}
      onChange={(event) =>
        setFrontmatter({ ...frontmatter, [key]: event.target.value })
      }
      {...extra}
    />
  );
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4">
        <label className="block space-y-2 text-sm">
          <span className="sr-only">标题</span>
          <Input
            aria-label="标题"
            disabled={locked}
            placeholder="文章标题"
            className="h-12 text-lg font-medium"
            value={frontmatter.title ?? ""}
            maxLength={180}
            onChange={(event) =>
              setFrontmatter({ ...frontmatter, title: event.target.value })
            }
          />
        </label>
        <input
          ref={markdownInput}
          type="file"
          hidden
          aria-label="导入 Markdown 文件"
          accept=".md,.markdown,text/markdown"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
            event.target.value = "";
          }}
        />
        <input
          ref={imageInput}
          type="file"
          hidden
          aria-label="上传图片"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadImage(file, true);
            event.target.value = "";
          }}
        />
        <MarkdownEditor
          value={markdown}
          onChange={setMarkdown}
          disabled={locked}
          onImage={(file) => uploadImage(file, true)}
          onPaywall={enablePaywall}
          insertRequest={insertRequest}
          toolbar={
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={locked}
                onClick={() => imageInput.current?.click()}
              >
                <UploadIcon className="size-4" aria-hidden />
                上传图片
              </Button>
              <MediaPicker
                disabled={locked}
                size="sm"
                label="从素材库插入"
                onSelect={(asset) =>
                  setInsertRequest({
                    id: crypto.randomUUID(),
                    text: `![${(asset.alt || asset.name).replace(/[\\\[\]\r\n]/g, " ")}](<${asset.url}>)`,
                  })
                }
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={locked}
                onClick={() => markdownInput.current?.click()}
              >
                <FileUpIcon className="size-4" aria-hidden />
                导入 .md
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={(event) => show("匿名预览", event.currentTarget)}
              >
                <EyeIcon className="size-4" aria-hidden />
                匿名预览
              </Button>
            </>
          }
        />
        <p className="text-xs text-muted-foreground">
          可直接把图片拖入正文。图片上传后公开可访问，阅读权限不保护图片地址；单张最大 10 MiB。
        </p>
        {importStatus && (
          <p role="status" aria-live="polite" className="break-words text-sm">
            {importStatus}
          </p>
        )}
        <AttachmentLibrary
          items={attachments}
          disabled={locked}
          onInsert={(text) => setInsertRequest({ id: crypto.randomUUID(), text })}
        />
        <AdminPanelPortal>
          <PreviewPane
            markdown={markdown}
            access={frontmatter.access}
            onRestrict={enablePaywall}
            disabled={locked}
          />
        </AdminPanelPortal>
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
      <aside className="min-w-0 space-y-4">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {pending
              ? "正在保存…"
              : dirty
                ? "有未保存的修改"
                : savedRevision
                  ? "修订已保存，尚未发布"
                  : "没有未保存的修改"}
          </p>
          <Button
            className="w-full"
            onClick={() => submit(true)}
            disabled={pending || uploading}
          >
            {pending ? "正在处理…" : attempt ? "重试发布" : "发布"}
          </Button>
          <Button
            className="w-full"
            variant="outline"
            onClick={() => submit()}
            disabled={pending || uploading}
            title="保存为待发布修订，不影响线上内容"
          >
            仅保存，不发布
          </Button>
          <Button className="w-full" variant="ghost" size="sm" onClick={downloadDraft}>
            <DownloadIcon className="size-4" aria-hidden />
            下载 Markdown
          </Button>
        </div>
        <fieldset
          disabled={locked}
          className="space-y-4 rounded-xl border bg-card p-4"
        >
          <legend className="sr-only">发布设置</legend>
          <h2 className="text-sm font-medium">发布设置</h2>
          <label className="block space-y-2 text-sm">
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
              <option value="blog">博客文章</option>
              <option value="chapter">手册或活动的章节</option>
              {frontmatter.type === "skill" && <option value="skill">技能公开介绍</option>}
            </select>
            {frontmatter.type === "skill" && <span id="skill-type-help" className="block text-xs text-muted-foreground">已固定为技能公开介绍。</span>}
          </label>
          {frontmatter.type === "chapter" && (
            <label className="block space-y-2 text-sm">
              所属手册或活动
              <select
                className={selectClass}
                aria-label="所属手册或活动"
                value={frontmatter.series_slug ?? ""}
                onChange={(event) =>
                  setFrontmatter({
                    ...frontmatter,
                    series_slug: event.target.value,
                  })
                }
              >
                <option value="">请选择</option>
                {series.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block space-y-2 text-sm">
            阅读权限
            <select
              className={selectClass}
              aria-label="阅读权限"
              aria-describedby="access-help"
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
            <span id="access-help" className="block text-xs leading-5 text-muted-foreground">
              {ACCESS_HELP[frontmatter.type === "skill" ? "skill" : frontmatter.access]}
            </span>
          </label>
          {frontmatter.type === "blog" && frontmatter.access === "paid" && (
            <label className="block space-y-2 text-sm">
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
        </fieldset>
        <fieldset
          disabled={locked}
          className="space-y-4 rounded-xl border bg-card p-4"
        >
          <legend className="sr-only">展示信息</legend>
          <h2 className="text-sm font-medium">展示信息</h2>
          <label className="block space-y-2 text-sm">
            摘要
            {field("summary", "摘要", { maxLength: 500, placeholder: "列表和分享时显示的一句话" })}
          </label>
          <ImageField
            label="封面（可选）"
            value={frontmatter.cover ?? ""}
            disabled={locked}
            onChange={(url) => setFrontmatter({ ...frontmatter, cover: url })}
          />
          <label className="block space-y-2 text-sm">
            标签
            <Input
              placeholder="用英文逗号分隔"
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
        <details className="group rounded-xl border bg-card p-4" open={!frontmatter.slug}>
          <summary className="cursor-pointer text-sm font-medium">
            网址与导入
          </summary>
          <fieldset disabled={locked} className="mt-4 space-y-4">
            <label className="block space-y-2 text-sm">
              网址标识
              {field("slug", "网址标识", {
                maxLength: 120,
                placeholder: "例如 my-first-post",
                "aria-describedby": "slug-help",
                disabled:
                  locked ||
                  media.some(
                    (item) => !item.storage_path.startsWith("media/library/"),
                  ),
              })}
              <span
                id="slug-help"
                className="block break-all text-xs leading-5 text-muted-foreground"
              >
                {frontmatter.type !== "chapter"
                  ? `访问地址 /${frontmatter.type === "skill" ? "skills" : "blog"}/${frontmatter.slug || "my-first-post"}`
                  : `章节参数 ?article=${frontmatter.slug || "chapter-one"}`}
                。小写字母、数字或短横线；相同标识会更新原文章。
              </span>
            </label>
            <label className="block space-y-2 text-sm">
              原图片引用路径
              <Input
                placeholder="例如 assets/diagram.png"
                value={sourcePath}
                onChange={(event) => setSourcePath(event.target.value)}
              />
              <span className="block text-xs leading-5 text-muted-foreground">
                导入的 Markdown 引用了本地图片时，先填写它的路径再上传，正文中的缺图会自动替换。
              </span>
            </label>
          </fieldset>
        </details>
      </aside>
    </div>
  );
}
