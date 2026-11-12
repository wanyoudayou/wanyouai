"use client";
/* eslint-disable @next/next/no-img-element -- Public library thumbnails must preserve the original asset URL. */
import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { ImageIcon, UploadIcon, XIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IMAGE_ACCEPT, type MediaAsset } from "@/lib/media/types";
import { mediaRequest, uploadLibraryImage } from "@/lib/media/client";
import {
  lastPage,
  listQueryString,
  parseListQuery,
  type ListQuery,
} from "@/lib/admin/list-query";

type Catalog = { items: MediaAsset[]; total: number; query: ListQuery };
export function MediaBrowser({
  onChoose,
  onBusy,
  standalone = false,
}: {
  onChoose?: (asset: MediaAsset) => void;
  onBusy?: (busy: boolean) => void;
  standalone?: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState(() =>
    parseListQuery(standalone ? Object.fromEntries(params) : {}),
  );
  const [draft, setDraft] = useState(query.q);
  const [resource, setResource] = useState<{
    key: string;
    data?: Catalog;
    error?: string;
  }>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<MediaAsset>();
  const [name, setName] = useState("");
  const [alt, setAlt] = useState("");
  const [usage, setUsage] = useState<Record<string, number>>();
  const fileInput = useRef<HTMLInputElement>(null);
  const detail = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected)
      detail.current?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [selected]);
  const urlQuery = standalone ? params.toString() : "";
  const requestKey = `${standalone ? urlQuery : listQueryString(query)}:${refresh}`;
  const loading = resource?.key !== requestKey;
  const data = !loading ? resource?.data : undefined;
  const error = !loading ? resource?.error : undefined;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const current = standalone
      ? parseListQuery(Object.fromEntries(new URLSearchParams(urlQuery)))
      : query;
    fetch(`/api/admin/media${listQueryString(current)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        return result as Catalog;
      })
      .then((result) => {
        if (active) setResource({ key: requestKey, data: result });
      })
      .catch(() => {
        if (active)
          setResource({
            key: requestKey,
            error: controller.signal.aborted
              ? "读取超时，请重试。"
              : "素材暂时无法读取，请重试。",
          });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, refresh, standalone, urlQuery, requestKey]);
  function go(changes: Partial<ListQuery>) {
    const updated = { ...(data?.query ?? query), ...changes };
    if (standalone) router.push(pathname + listQueryString(updated));
    else setQuery(updated);
    setSelected(undefined);
  }
  function markBusy(value: boolean) {
    setBusy(value);
    onBusy?.(value);
  }
  async function upload(files: File[]) {
    if (busy) return;
    markBusy(true);
    setMessage("");
    try {
      if (files.length > 50) throw new Error("一次最多选择 50 张图片。");
      for (const [index, file] of files.entries()) {
        await uploadLibraryImage(file, (text) =>
          setMessage(`${index + 1}/${files.length} · ${file.name} · ${text}`),
        );
      }
      setMessage(`已上传并校验 ${files.length} 张图片。`);
      setRefresh((value) => value + 1);
    } catch (failure) {
      setMessage(
        failure instanceof Error
          ? failure.message
          : "上传失败，已完成的图片仍保留在素材库。",
      );
      setRefresh((value) => value + 1);
    } finally {
      markBusy(false);
    }
  }
  async function edit(archived: boolean) {
    if (!selected || busy) return;
    markBusy(true);
    try {
      await mediaRequest({ op: "edit", id: selected.id, name, alt, archived });
      setMessage("素材已保存；已有引用保持可用。");
      setSelected(undefined);
      setRefresh((value) => value + 1);
    } catch (failure) {
      setMessage(
        failure instanceof Error ? failure.message : "保存失败，输入已保留。",
      );
    } finally {
      markBusy(false);
    }
  }
  const current = data?.query ?? query;
  const pages = data ? lastPage(data.total, current.pageSize) : 1;
  return (
    <div className="min-w-0 space-y-4">
      <p className="text-xs leading-6 text-muted-foreground">
        图片上传后公开可访问，付费正文的权限不保护图片地址。支持
        PNG、JPEG、WebP、GIF；SVG 校验后转为 PNG。每张不超过 10 MiB。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <UploadIcon className="size-4" />
          上传图片
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={IMAGE_ACCEPT}
          className="sr-only"
          aria-label="上传素材图片"
          disabled={busy}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) void upload(files);
            event.target.value = "";
          }}
        />
        <Input
          type="search"
          aria-label="搜索素材"
          placeholder="搜索图片名称"
          value={draft}
          maxLength={120}
          className="w-44"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              go({ q: draft.trim(), page: 1 });
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => go({ q: draft.trim(), page: 1 })}
        >
          查询
        </Button>
        {standalone && (
          <select
            aria-label="素材状态"
            value={current.status === "archived" ? "archived" : "ready"}
            onChange={(event) => go({ status: event.target.value, page: 1 })}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          >
            <option value="ready">可选用</option>
            <option value="archived">已归档</option>
          </select>
        )}
        <select
          aria-label="素材排序"
          value={current.sort}
          onChange={(event) => go({ sort: event.target.value, page: 1 })}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="newest">最近上传</option>
          <option value="oldest">最早上传</option>
          <option value="title">名称排序</option>
        </select>
        <select
          aria-label="图片格式"
          value={current.type}
          onChange={(event) => go({ type: event.target.value, page: 1 })}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="">全部格式</option>
          {["png", "jpeg", "webp", "gif"].map((type) => (
            <option key={type} value={type}>
              {type.toUpperCase()}
            </option>
          ))}
        </select>
        <select
          aria-label="素材每页数量"
          value={current.pageSize}
          onChange={(event) =>
            go({ pageSize: Number(event.target.value), page: 1 })
          }
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          {[20, 50, 100].map((size) => (
            <option key={size} value={size}>
              每页 {size} 张
            </option>
          ))}
        </select>
      </div>
      <p role="status" aria-live="polite" className="break-words text-sm">
        {message}
      </p>
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取素材…
        </p>
      ) : error ? (
        <div role="alert" className="space-y-2">
          <p>{error}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRefresh((value) => value + 1)}
          >
            重新加载
          </Button>
        </div>
      ) : (
        data && (
          <>
            <p className="text-xs text-muted-foreground">
              {data.total === 0
                ? "0 张图片"
                : `共 ${data.total} 张 · 第 ${current.page} / ${pages} 页`}
            </p>
            {data.items.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {data.items.map((asset) => (
                  <li key={asset.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (onChoose) onChoose(asset);
                        else {
                          setSelected(asset);
                          setName(asset.name);
                          setAlt(asset.alt);
                          setUsage(undefined);
                        }
                      }}
                      className="w-full overflow-hidden rounded-xl border bg-card text-left hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="flex aspect-[4/3] items-center justify-center bg-muted/40 p-2">
                        <img
                          src={asset.url}
                          alt={asset.alt || asset.name}
                          loading="lazy"
                          className="max-h-full max-w-full object-contain"
                        />
                      </span>
                      <span className="block truncate px-3 pt-2 text-sm font-medium">
                        {asset.name}
                      </span>
                      <span className="block px-3 pb-3 pt-1 text-xs text-muted-foreground">
                        {asset.width} × {asset.height} ·{" "}
                        {(asset.byte_size / 1024).toFixed(0)} KB
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                {current.q
                  ? "没有匹配的图片，请修改搜索条件。"
                  : "暂无图片，可以先上传。"}
              </p>
            )}
            {data.total > 0 && (
              <nav
                aria-label="素材分页"
                className="flex items-center justify-between gap-2"
              >
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || current.page <= 1}
                  onClick={() => go({ page: current.page - 1 })}
                >
                  上一页
                </Button>
                <span className="text-sm">
                  第 {current.page} / {pages} 页
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || current.page >= pages}
                  onClick={() => go({ page: current.page + 1 })}
                >
                  下一页
                </Button>
              </nav>
            )}
          </>
        )
      )}
      {selected && (
        <section
          ref={detail}
          className="space-y-3 rounded-xl border bg-card p-4"
          aria-label="素材详情"
        >
          <h2 className="font-medium">素材详情</h2>
          <label className="block space-y-1 text-sm">
            名称
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
            />
          </label>
          <label className="block space-y-1 text-sm">
            替代文字（供选图时使用）
            <Input
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
              maxLength={500}
            />
          </label>
          <p className="break-all text-xs text-muted-foreground">
            {selected.url}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              markBusy(true);
              try {
                setUsage(await mediaRequest({ op: "usage", id: selected.id }));
              } catch {
                setMessage("引用信息暂时不可用，请重试。");
              } finally {
                markBusy(false);
              }
            }}
          >
            检查已有引用
          </Button>
          {usage && (
            <p className="text-xs leading-6 text-muted-foreground">
              正文与封面 {usage.articles} · 历史版本 {usage.versions} · 导入修订{" "}
              {usage.revisions} · 导入附件 {usage.imports} · 独立页面{" "}
              {usage.pages} · 站点配置 {usage.settings}
              。相同图片内容合并检查，不含尚未保存的草稿。
            </p>
          )}
          <p className="text-xs leading-6 text-muted-foreground">
            归档只隐藏选图入口，不删除文件，也不修改文章、历史版本或站点配置。修改替代文字不会反向覆盖已发布正文。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void edit(selected.archived)}
            >
              保存
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void edit(!selected.archived)}
            >
              {selected.archived ? "恢复选用" : "归档"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setSelected(undefined)}
            >
              关闭详情
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
export function MediaPicker({
  onSelect,
  disabled,
  label = "从素材库选择",
}: {
  onSelect: (asset: MediaAsset) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          <ImageIcon className="size-4" />
          {label}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
        <Dialog.Content
          className="fixed inset-x-3 top-[5dvh] z-[81] mx-auto max-h-[90dvh] max-w-4xl overflow-y-auto rounded-2xl border bg-background p-4 shadow-xl sm:p-6"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-xl font-semibold">
                选择图片素材
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                点击图片选用，或先上传新图片。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label="关闭素材库"
              >
                <XIcon className="size-4" />
              </Button>
            </Dialog.Close>
          </div>
          <MediaBrowser
            onBusy={setBusy}
            onChoose={(asset) => {
              onSelect(asset);
              setOpen(false);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ImageField({
  name,
  label,
  value: controlled,
  defaultValue = "",
  onChange,
  disabled,
}: {
  name?: string;
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (url: string) => void;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(defaultValue);
  const value = controlled ?? local;
  function change(url: string) {
    setLocal(url);
    onChange?.(url);
  }
  return (
    <div className="space-y-2 text-sm">
      <label className="block space-y-1">
        {label}
        <Input
          name={name}
          value={value}
          onChange={(event) => change(event.target.value)}
          maxLength={2048}
          disabled={disabled}
          placeholder="从素材库选择，或填写图片地址"
        />
      </label>
      <MediaPicker
        disabled={disabled}
        onSelect={(asset) => change(asset.url)}
      />
      {value.startsWith("/media/") && (
        <img
          src={value}
          alt="当前选用图片"
          className="max-h-24 max-w-full rounded-lg border object-contain"
        />
      )}
    </div>
  );
}
