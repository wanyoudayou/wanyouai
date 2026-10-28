"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck, FileCheck2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { filesRequest } from "@/lib/importing/client";
import { AdminPanelPortal, useAdminPanel } from "./admin-panel";
import { RevisionReview } from "./revision-review";
import type {
  BatchInput,
  BatchResult,
  PendingRevision,
} from "@/lib/importing/batch";
const accessNames: Record<string, string> = {
  public: "公开",
  registered: "登录后阅读",
  subscriber: "订阅会员",
  paid: "付费阅读",
};
export function SeriesPublication({
  series,
  settingsDirty = false,
}: {
  series: {
    id: number;
    slug: string;
    status: string;
    updated_at: string;
    readme_article_id: number | null;
  };
  settingsDirty?: boolean;
}) {
  const router = useRouter();
  const panel = useAdminPanel();
  const [items, setItems] = useState<PendingRevision[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [readme, setReadme] = useState("");
  const [activate, setActivate] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [problems, setProblems] = useState<
    NonNullable<BatchResult["problems"]>
  >([]);
  const [task, setTask] = useState<BatchInput | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [review, setReview] = useState<PendingRevision | null>(null);
  async function reload() {
    setLoading(true);
    try {
      const data = await filesRequest<{
        total: number;
        items: PendingRevision[];
      }>({ op: "batchList", series: series.id });
      setItems(data.items);
      setTotal(data.total);
      setSelected(data.items.map((i) => i.id));
      setPage(1);
      setConfirmed(false);
      setProblems([]);
      const intro = data.items.filter(
        (i) => /^readme\.(md|markdown)$/i.test(i.path) && i.access === "public",
      );
      setReadme(
        !series.readme_article_id && intro.length === 1 ? intro[0].slug : "",
      );
    } catch (e) {
      setTotal(null);
      setMessage((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let alive = true;
    filesRequest<{ total: number; items: PendingRevision[] }>({
      op: "batchList",
      series: series.id,
    })
      .then((data) => {
        if (!alive) return;
        setItems(data.items);
        setTotal(data.total);
        setSelected(data.items.map((i) => i.id));
        const intro = data.items.filter(
          (i) =>
            /^readme\.(md|markdown)$/i.test(i.path) && i.access === "public",
        );
        if (!series.readme_article_id && intro.length === 1)
          setReadme(intro[0].slug);
      })
      .catch((e) => {
        if (alive) setMessage(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [series.id, series.readme_article_id]);
  async function finish(result: BatchResult) {
    setMessage(result.message);
    setProblems(result.problems ?? []);
    if (result.ok) {
      setTask(null);
      setUnknown(false);
      setRetryable(false);
      await reload();
      router.refresh();
    } else {
      setTask(null);
      setConfirmed(false);
    }
  }
  async function publish(retry = false) {
    const input =
      retry && task
        ? task
        : {
            series: series.id,
            expected: series.updated_at,
            request: crypto.randomUUID(),
            ids: selected,
            activate,
            readme: readme || null,
          };
    setTask(input);
    setBusy(true);
    setUnknown(false);
    setRetryable(false);
    setMessage("正在校验所选文稿，全部通过后一次发布。请等待结果…");
    try {
      await finish(
        await filesRequest<BatchResult>({ op: "batchPublish", input }),
      );
    } catch (e) {
      setUnknown(true);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function query() {
    if (!task) return;
    setBusy(true);
    try {
      const result = await filesRequest<BatchResult>({
        op: "batchStatus",
        request: task.request,
      });
      if (result.ok) await finish(result);
      else {
        setMessage(result.message);
        setRetryable(true);
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked =
    busy || unknown || loading || settingsDirty || series.status === "archived";
  const visible = items.slice((page - 1) * 20, page * 20);
  const totalPages = Math.max(1, Math.ceil(items.length / 20));
  const toggle = (id: number) => {
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id],
    );
    setConfirmed(false);
  };
  const candidates = items.filter(
    (i) => selected.includes(i.id) && i.access === "public",
  );
  const validReadme =
    (!readme || candidates.some((i) => i.slug === readme)) &&
    (!activate || !!series.readme_article_id || !!readme);
  return (
    <section
      className="space-y-5 rounded-xl border bg-card p-5 sm:p-6"
      aria-label="全辑审核与发布"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FileCheck2 className="size-5" />
            待发布更新
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            核对本次章节与阅读权限，一次确认发布。未选中的草稿和线上原文保留。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={locked}
          onClick={() => {
            void reload();
            router.refresh();
          }}
        >
          <RefreshCw className="size-4" />
          刷新清单
        </Button>
      </header>
      {loading ? (
        <p role="status">正在读取待发布文稿…</p>
      ) : total === null ? (
        <p>清单读取失败，暂不能发布。</p>
      ) : total === 0 ? (
        <div className="flex items-center gap-3 rounded-lg bg-muted/40 p-5">
          <CheckCheck className="size-5 text-muted-foreground" />
          <div>
            <p className="font-medium">没有待发布更新</p>
            <p className="text-sm text-muted-foreground">
              新的上传或编辑会出现在这里；返回插件后会同步线上状态。
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={locked}
                checked={selected.length === items.length}
                onChange={(e) => {
                  setSelected(e.target.checked ? items.map((i) => i.id) : []);
                  setConfirmed(false);
                }}
              />
              选择本批全部 {items.length} 篇
            </label>
            <span>
              共 {total} 篇待发布 · 已选 {selected.length} 篇
            </span>
          </div>
          {total > items.length && (
            <p className="text-sm text-muted-foreground">
              本批列出前 {items.length}{" "}
              篇；发布后继续下一批，其余文稿不会被隐式发布。
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border">
            <table className="block w-full text-left text-sm sm:table">
              <thead className="hidden border-b bg-muted/40 sm:table-header-group">
                <tr>
                  <th className="whitespace-nowrap p-3">选择</th>
                  <th className="whitespace-nowrap p-3">文稿</th>
                  <th className="whitespace-nowrap p-3">阅读权限</th>
                  <th className="whitespace-nowrap p-3">核对</th>
                </tr>
              </thead>
              <tbody className="block divide-y sm:table-row-group">
                {visible.map((item) => (
                  <tr
                    key={item.id}
                    className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 sm:table-row sm:p-0 ${problems.some((p) => p.id === item.id) ? "bg-destructive/5" : ""}`}
                  >
                    <td className="row-span-3 pt-1 sm:p-3">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${item.title}`}
                        checked={selected.includes(item.id)}
                        disabled={locked}
                        onChange={() => toggle(item.id)}
                      />
                    </td>
                    <td className="min-w-0 sm:p-3">
                      <p className="font-medium">{item.title}</p>
                      <p className="break-all text-xs text-muted-foreground">
                        {item.path} · 修订 v{item.version}
                      </p>
                      {problems
                        .filter((p) => p.id === item.id)
                        .map((p) => (
                          <p
                            key={p.message}
                            className="mt-1 text-xs text-destructive"
                          >
                            {p.message}
                          </p>
                        ))}
                    </td>
                    <td className="col-start-2 whitespace-nowrap text-muted-foreground sm:p-3">
                      <span className="sm:hidden">阅读权限： </span>
                      {accessNames[item.access] ?? item.access}
                    </td>
                    <td className="col-start-2 sm:p-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={(e) => {
                            setReview(item);
                            panel.show(
                              `核对文稿 · ${item.title}`,
                              e.currentTarget,
                            );
                          }}
                        >
                          预览
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          asChild
                        >
                          <Link
                            href={`/admin/content?revision=${item.id}&returnTo=${encodeURIComponent(`/admin/collections/${series.id}`)}`}
                          >
                            编辑
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-3 text-sm">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || busy}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <span>
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages || busy}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
          <fieldset disabled={locked} className="space-y-4 border-t pt-4">
            {!series.readme_article_id && (
              <label className="block space-y-2 text-sm">
                公开介绍（README）
                <select
                  className="block h-10 w-full rounded-md border bg-background px-3"
                  value={readme}
                  onChange={(e) => {
                    setReadme(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="">本次不设置</option>
                  {candidates.map((i) => (
                    <option key={i.id} value={i.slug}>
                      {i.title} · {i.path}
                    </option>
                  ))}
                </select>
                <span className="block text-xs text-muted-foreground">
                  只能选择本批公开章节，上架前必须绑定公开介绍。
                </span>
              </label>
            )}
            {series.status === "draft" && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={activate}
                  onChange={(e) => {
                    setActivate(e.target.checked);
                    setConfirmed(false);
                  }}
                />
                <span>
                  发布成功后同时上架专辑
                  <span className="block text-xs text-muted-foreground">
                    不勾选则保持未上架，读者暂不可见。
                  </span>
                </span>
              </label>
            )}
            {!validReadme && (
              <p className="text-sm text-destructive">
                请先选中一篇公开介绍，并将其设为 README。
              </p>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                我已核对所选 {selected.length} 篇文稿及阅读权限，确认
                {activate ? "发布并上架专辑" : "更新线上正文"}。
                {selected.length < total && "未选中文稿保持原状。"}
              </span>
            </label>
          </fieldset>
          {!unknown && (
            <Button
              disabled={
                locked || !selected.length || !confirmed || !validReadme
              }
              onClick={() => publish()}
            >
              {busy
                ? "正在校验与发布…"
                : activate
                  ? `发布 ${selected.length} 篇并上架专辑`
                  : `发布选中的 ${selected.length} 篇`}
            </Button>
          )}
        </>
      )}
      {settingsDirty && (
        <p className="text-sm text-muted-foreground">
          请先保存上方专辑设置，再确认发布。
        </p>
      )}
      <p role="status" aria-live="polite" className="break-words text-sm">
        {message}
      </p>
      {unknown && (
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy} onClick={query}>
            查询本次发布结果
          </Button>
          {retryable && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => publish(true)}
            >
              重试同一任务
            </Button>
          )}
        </div>
      )}
      {review && (
        <AdminPanelPortal>
          <RevisionReview
            id={review.id}
            autoLoad
            readOnly
            onPublished={() => {
              panel.close();
              setReview(null);
              void reload();
              router.refresh();
            }}
          />
        </AdminPanelPortal>
      )}
    </section>
  );
}
