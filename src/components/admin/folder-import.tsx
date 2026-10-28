"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminTabs } from "./admin-tabs";
import { RevisionReview } from "./revision-review";
import { AdminPanelPortal, useAdminPanel } from "./admin-panel";
import { importMarkdown } from "@/lib/admin/draft";
import { filesRequest } from "@/lib/importing/client";
import {
  projectPath,
} from "@/lib/importing/paths";
import { rootMarkdownPath } from "@/lib/importing/selection";
import type { Candidate } from "@/lib/importing/server";
import type { Media } from "@/lib/publishing/types";
type Inventory = {
  files: {
    id: number;
    path: string;
    article_slug: string;
    sort: number;
    latest: { id: number; version: number; publication: unknown } | null;
  }[];
  assets: { path: string; source_hash: string; media: Media }[];
};
type Row = {
  path: string;
  change: string;
  candidate?: Candidate;
  previousMarkdown?: string;
  expected?: number;
  error?: string;
  missingMedia?: string[];
  done?: boolean;
  id?: number;
};
type Selection =
  | { kind: "diff"; index: number }
  | { kind: "review"; id: number; path: string }
  | null;
const changes: Record<string, string> = {
  new: "新增",
  changed: "内容变化",
  existing: "同地址已有线上文章",
  unchanged: "无变化",
  unsupported: "未支持",
  failed: "失败",
};
const selectedRow =
  "border-primary bg-primary/5 ring-1 ring-inset ring-primary";
export function FolderImport({
  series,
  initialScope,
}: {
  series: { id: number; slug: string; title: string; type: string }[];
  initialScope: string;
}) {
  const panel = useAdminPanel();
  const [scope, setScope] = useState(initialScope);
  const [inventory, setInventory] = useState<Inventory>({
    files: [],
    assets: [],
  });
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function clearSelection() {
    setSelected(null);
    panel.close();
  }
  async function refresh() {
    setInventory(await filesRequest<Inventory>({ op: "inventory", scope }));
  }
  useEffect(() => {
    let alive = true;
    filesRequest<Inventory>({ op: "inventory", scope })
      .then((data) => {
        if (alive) setInventory(data);
      })
      .catch((e) => {
        if (alive) setMessage(e.message);
      });
    return () => {
      alive = false;
    };
  }, [scope]);
  async function compare() {
    setBusy(true);
    setRows([]);
    setSelected(null);
    panel.close();
    setMessage("正在读取文件并比对…");
    const result: Row[] = [];
    try {
      const selectedFiles = files.filter(file => rootMarkdownPath(file.webkitRelativePath || file.name));
      if (!selectedFiles.length) throw new Error("所选文件夹根目录没有 Markdown 文稿。");
      if (selectedFiles.length > 500) throw new Error("每批最多 500 篇根目录文稿，请分批导入。");
      if (selectedFiles.reduce((sum, f) => sum + f.size, 0) > 100 * 1024 * 1024) throw new Error("文稿总计不能超过 100 MiB。");
      const current = await filesRequest<Inventory>({ op: "inventory", scope });
      setInventory(current);
      const local = new Map<string, File>();
      for (const file of selectedFiles) {
        const path = projectPath(rootMarkdownPath(file.webkitRelativePath || file.name)!);
        if (local.has(path)) throw new Error(`路径重复：${path}`);
        local.set(path, file);
      }
      const hashes = Object.fromEntries(
        current.assets.map((a) => [a.path, a.source_hash]),
      );
      for (const [path, file] of [...local].sort(([a], [b]) =>
        a.localeCompare(b, "zh-CN", { numeric: true }),
      )) {
        try {
          if (file.size > 2 * 1024 * 1024)
            throw new Error("Markdown 不能超过 2 MiB。");
          const imported = importMarkdown(
            await file.text(),
            path.split("/").pop(),
          );
          const existing = current.files.find((f) => f.path === path);
          if (!/^---\r?\n[\s\S]*?\bslug\s*:/m.test(await file.text()))
            imported.frontmatter.slug = existing?.article_slug ?? "";
          const candidate: Candidate = {
            scope,
            path,
            folder: true,
            textOnly: true,
            input: {
              client_request_id: crypto.randomUUID(),
              frontmatter: imported.frontmatter,
              markdown: imported.markdown,
              media: [],
            },
            hashes,
          };
          const checked = await filesRequest<{
            missingMedia: string[];
            previousMarkdown: string;
            change: string;
            expected: number;
            input: Candidate["input"];
          }>({ op: "compare", candidate });
          candidate.input = checked.input;
          result.push({
            path,
            candidate,
            expected: checked.expected,
            previousMarkdown: checked.previousMarkdown,
            missingMedia: checked.missingMedia,
            change: checked.change,
          });
        } catch (e) {
          result.push({
            path,
            change: "failed",
            error: (e as Error).message,
          });
        }
      }
      const slugs = new Set<string>();
      for (const row of result) {
        if (!row.candidate) continue;
        const slug = row.candidate.input.frontmatter.slug;
        if (slugs.has(slug)) {
          row.error = "本批次有多个文档使用相同文章地址，请修正后重新比对。";
          row.candidate = undefined;
          row.change = "failed";
        } else slugs.add(slug);
      }
      setRows(result);
      setMessage(
        `已比对 ${local.size} 篇根目录文稿；忽略 ${files.length - selectedFiles.length} 个其他文件。确认后保存草稿；缺少的图片请在编辑器中补插。`,
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    setBusy(true);
    setMessage("正在保存文稿草稿…");
    const next = rows.map((r) => ({ ...r }));
    try {
      for (const row of next.filter(
        (r) =>
          r.change !== "unchanged" &&
          r.candidate &&
          !r.done,
      )) {
        try {
          const data = await filesRequest<{ id: number }>({
            op: "stage",
            candidate: row.candidate,
            expected: row.expected,
          });
          row.id = data.id;
          row.done = true;
          row.error = undefined;
        } catch (e) {
          row.error = (e as Error).message;
        }
        setRows(next.map((r) => ({ ...r })));
      }
      await refresh();
      setMessage(
        next.some((r) => r.error)
          ? "部分文件失败。可重试未完成项；已保存的修订不会重复。"
          : "草稿已保存。请到专辑设置检查整辑更新并发布；标注缺图的文稿请先进入编辑器补插图片。",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function move(index: number, offset: number) {
    setBusy(true);
    try {
      const ids = inventory.files.map((f) => f.id);
      [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
      await filesRequest({ op: "order", scope, ids });
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const album = series.find((s) => "series:" + s.slug === scope);
  const diffRow = selected?.kind === "diff" ? rows[selected.index] : undefined;
  return (
    <div className="min-w-0 space-y-6">
      <AdminTabs active={scope === "blog" ? "blog" : "albums"} />
      <label className="block space-y-2 text-sm">
        内容目录
        <select
          className="h-9 w-full rounded-md border bg-background px-3"
          disabled={busy}
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setRows([]);
            setFiles([]);
            setMessage("");
            clearSelection();
          }}
        >
          <option value="blog">博客草稿</option>
          {series.map((s) => (
            <option key={s.slug} value={"series:" + s.slug}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      {album &&
        ["collection", "handbook", "skill", "event"].includes(album.type) && (
          <section
            className="space-y-4 rounded-lg border p-4"
            aria-label="文件夹导入"
          >
            <h2 className="font-medium">导入文件夹</h2>
            <p className="text-sm text-muted-foreground">
              只导入所选文件夹根目录的 Markdown，直接放入专辑根目录。子目录、图片及其他文件会忽略；本地图片请导入后通过编辑器素材库补插，已有在线图片链接保留。每批最多 500 篇、合计 100 MiB。
            </p>
            <label className="block space-y-2 text-sm">
              选择文件夹
              <Input
                disabled={busy}
                type="file"
                multiple
                {...{ webkitdirectory: "" }}
                onChange={(e) => {
                  setFiles([...(e.target.files ?? [])]);
                  setRows([]);
                }}
              />
            </label>
            <Button disabled={busy || !files.length} onClick={compare}>
              {busy ? "正在处理…" : "比对云端文件"}
            </Button>
          </section>
        )}
      {!!rows.length && (
        <section className="space-y-4" aria-label="文件差异">
          <h2 className="font-medium">
            差异确认 · {rows.length} 篇文稿
          </h2>
          <ul className="divide-y rounded-lg border">
            {rows.map((r, index) => {
              const active =
                selected?.kind === "diff" && selected.index === index;
              return (
                <li
                  key={r.path}
                  data-active={active}
                  className={`flex items-start justify-between gap-3 p-3 transition-colors ${active ? selectedRow : ""}`}
                >
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm">{r.path}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.done ? "已保存" : changes[r.change]}
                      {r.error ? " · " + r.error : ""}
                      {r.missingMedia?.length ? ` · 待补插图片：${r.missingMedia.join("、")}` : ""}
                    </p>
                  </div>
                  {r.candidate && (
                    <Button
                      size="sm"
                      variant={active ? "default" : "outline"}
                      aria-pressed={active}
                      onClick={(event) => {
                        setSelected({ kind: "diff", index });
                        panel.show(`原文差异 · ${r.path}`, event.currentTarget);
                      }}
                    >
                      查看差异
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <Button
            disabled={
              busy ||
              rows.some((r) => !r.candidate) ||
              rows.every((r) => r.done || r.change === "unchanged")
            }
            onClick={upload}
          >
            确认上传 / 重试未完成项
          </Button>
        </section>
      )}
      <p role="status" className="break-words text-sm">
        {message}
      </p>
      {album && rows.some(r => r.done) && <Button asChild><Link href={`/admin/collections/${album.id}`}>前往专辑设置与全辑审核</Link></Button>}
      <section className="space-y-3" aria-label="云端文件清单">
        <h2 className="font-medium">云端文件清单</h2>
        <p className="text-xs text-muted-foreground">
          文档 {inventory.files.length} · 附件 {inventory.assets.length}
          。导入历史按修订保留，只有确认发布才更新线上文章。
        </p>
        {!inventory.files.length && (
          <p className="text-sm text-muted-foreground">还没有保存的文件。</p>
        )}
        <ul className="space-y-3">
          {inventory.files.map((f, index) => {
            const active =
              selected?.kind === "review" && selected.id === f.latest?.id;
            return (
              <li
                key={f.id}
                data-active={active}
                className={`flex items-start justify-between gap-3 rounded-lg border p-4 transition-colors ${active ? selectedRow : ""}`}
              >
                <div className="min-w-0">
                  <p className="break-all font-mono text-sm">{f.path}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {f.latest
                      ? `修订 ${f.latest.version} · ${f.latest.publication ? "已发布" : "待审核"}`
                      : "草稿"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    上移
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || index === inventory.files.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    下移
                  </Button>
                  {f.latest && (
                    <Button
                      size="sm"
                      variant={active ? "default" : "outline"}
                      aria-pressed={active}
                      onClick={(event) => {
                        setSelected({
                          kind: "review",
                          id: f.latest!.id,
                          path: f.path,
                        });
                        panel.show(`审核修订 · ${f.path}`, event.currentTarget);
                      }}
                    >
                      审核修订
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!!inventory.assets.length && (
          <details>
            <summary className="cursor-pointer text-sm">查看附件目录</summary>
            <ul>
              {inventory.assets.map((a) => (
                <li className="break-all py-2 font-mono text-xs" key={a.path}>
                  {a.path}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <AdminPanelPortal>
        {selected?.kind === "diff" && diffRow ? (
          <div className="space-y-5">
            {diffRow.error && (
              <p role="alert" className="text-sm">
                {diffRow.error}
              </p>
            )}
            <section>
              <h3 className="mb-2 text-xs text-muted-foreground">
                云端当前修订
              </h3>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 text-xs">
                {diffRow.previousMarkdown || "（无）"}
              </pre>
            </section>
            <section>
              <h3 className="mb-2 text-xs text-muted-foreground">本次导入</h3>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 text-xs">
                {diffRow.candidate?.input.markdown}
              </pre>
            </section>
          </div>
        ) : selected?.kind === "review" ? (
          <RevisionReview
            id={selected.id}
            autoLoad
            onPublished={() => void refresh()}
          />
        ) : null}
      </AdminPanelPortal>
    </div>
  );
}
