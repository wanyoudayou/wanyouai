"use client";
import { useActionState, useState } from "react";
import { saveSeriesSettings } from "@/app/admin/collections/actions";
import { manageContent } from "@/app/admin/manage-actions";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SeriesPublication } from "./series-publication";
export type SeriesSettings = {
  id: number;
  title: string;
  task: string | null;
  tags: string[];
  audiences: string[];
  nav_enabled: boolean;
  nav_label: string | null;
  nav_order: number;
  updated_at: string;
  status: string;
  featured: boolean;
  price: number | null;
  type: string;
  readme_article_id: number | null;
};
type Props = {
  series: SeriesSettings & { slug: string };
  chapters: { id: number; title: string; slug: string }[];
};
export function SeriesWorkflow(props: Props) {
  const [dirty, setDirty] = useState(false);
  return (
    <>
      <SeriesSettingsForm {...props} onDirtyChange={setDirty} />
      <SeriesPublication series={props.series} settingsDirty={dirty} />
    </>
  );
}
export function SeriesSettingsForm({
  series,
  chapters,
  onDirtyChange,
}: Props & { onDirtyChange?: (dirty: boolean) => void }) {
  const [state, action, pending] = useActionState(saveSeriesSettings, {
    message: "",
  });
  const [lifecycle, lifecycleAction, transitioning] = useActionState(
    manageContent,
    { ok: false, message: "" },
  );
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const locked = series.status === "archived";
  return (
    <section
      className="rounded-xl border bg-card p-5 sm:p-6"
      aria-label="专辑设置"
    >
      <form
        action={action}
        onChange={() => {
          setDirty(true);
          onDirtyChange?.(true);
        }}
        className="space-y-5"
      >
        <div>
          <h2 className="text-lg font-semibold">专辑设置</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            统一设置展示信息、价格和导航。保存后，再到下方核对待发布更新。
          </p>
        </div>
        <input type="hidden" name="id" value={series.id} />
        <input type="hidden" name="updated" value={series.updated_at} />
        <fieldset
          disabled={pending || transitioning || locked}
          className="grid gap-5 sm:grid-cols-2"
        >
          <label className="space-y-2 text-sm">
            标题
            <Input
              name="title"
              required
              maxLength={200}
              defaultValue={series.title}
            />
          </label>
          <label className="space-y-2 text-sm">
            简介
            <Input
              name="task"
              maxLength={300}
              defaultValue={series.task ?? ""}
            />
          </label>
          <label className="space-y-2 text-sm">
            标签（逗号分隔）
            <Input name="tags" defaultValue={series.tags.join(",")} />
          </label>
          <label className="space-y-2 text-sm">
            适用人群（逗号分隔）
            <Input name="audiences" defaultValue={series.audiences.join(",")} />
          </label>
          <label className="space-y-2 text-sm">
            公开介绍（README）
            <select
              name="readme_article_id"
              className="h-10 w-full rounded-md border bg-background px-3"
              defaultValue={series.readme_article_id ?? ""}
            >
              <option value="">发布整辑时选择介绍文稿</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <span className="block text-xs text-muted-foreground">
              这里只列出已发布的公开章节；新上传的 README 在下方发布时绑定。
            </span>
          </label>
          {series.type !== "event" ? (
            <label className="space-y-2 text-sm">
              专辑价格
              <Input
                name="price"
                type="number"
                min="0"
                max="999999.99"
                step="0.01"
                defaultValue={series.price ?? 0}
              />
              <span className="block text-xs text-muted-foreground">
                价格不自动改变章节阅读权限；付费章节需配置有效售价。
              </span>
            </label>
          ) : (
            <input type="hidden" name="price" value="0" />
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="featured"
              defaultChecked={series.featured}
            />
            置顶精选
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="nav_enabled"
              defaultChecked={series.nav_enabled}
            />
            加入侧栏目录
          </label>
          <label className="space-y-2 text-sm">
            侧栏名称
            <Input
              name="nav_label"
              maxLength={80}
              defaultValue={series.nav_label ?? ""}
              placeholder="留空使用标题"
            />
          </label>
          <label className="space-y-2 text-sm">
            目录顺序
            <Input
              name="nav_order"
              type="number"
              min={-10000}
              max={10000}
              defaultValue={series.nav_order}
            />
          </label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending || transitioning || locked}>
            {pending ? "正在保存…" : "保存专辑设置"}
          </Button>
          <p role="status" className="text-sm">
            {state.message}
          </p>
        </div>
      </form>
      <div className="mt-6 border-t pt-5">
        <h3 className="font-medium">上架与生命周期</h3>
        <p className="my-3 text-sm text-muted-foreground">
          {
            (
              {
                draft: "未上架：读者暂不可见。可以在下方一次发布章节并上架。",
                published: "已上架：上传新草稿不会自动替换线上正文。",
                paused: "已暂停销售，已有阅读权限继续有效。",
                archived: "已归档，停止阅读，不可恢复。",
              } as Record<string, string>
            )[series.status]
          }
        </p>
        {dirty && (
          <p className="mb-3 text-sm text-muted-foreground">
            请先保存上方设置，再发布或变更上架状态。
          </p>
        )}
        {!locked && (
          <form action={lifecycleAction} className="space-y-3">
            <fieldset disabled={dirty} className="space-y-3">
              <input type="hidden" name="kind" value="series" />
              <input type="hidden" name="id" value={series.id} />
              <input type="hidden" name="updated" value={series.updated_at} />
              <input type="hidden" name="action" value="status" />
              <div className="flex flex-wrap gap-3">
                {series.status === "draft" && series.readme_article_id && (
                  <Button
                    variant="outline"
                    name="value"
                    value="published"
                    disabled={transitioning || pending}
                  >
                    上架已发布内容
                  </Button>
                )}
                {series.status === "published" && (
                  <Button
                    variant="outline"
                    name="value"
                    value="paused"
                    disabled={transitioning || pending}
                    onClick={(e) => {
                      if (
                        !window.confirm(
                          "暂停销售此专辑？已有权益继续有效，并按现有邮件配置通知直接购买者。",
                        )
                      )
                        e.preventDefault();
                    }}
                  >
                    暂停销售
                  </Button>
                )}
                {series.status === "paused" && (
                  <Button
                    variant="outline"
                    name="value"
                    value="published"
                    disabled={transitioning || pending}
                  >
                    恢复上架
                  </Button>
                )}
              </div>
              {series.status === "paused" && (
                <details>
                  <summary className="cursor-pointer text-sm">归档专辑</summary>
                  <p className="my-3 text-sm text-muted-foreground">
                    暂停满三个月后才可归档；归档后停止阅读且不可恢复。
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input name="archive_notice" type="checkbox" />
                    确认停止阅读并归档
                  </label>
                  <Button
                    className="mt-3"
                    variant="outline"
                    name="value"
                    value="archived"
                    disabled={transitioning || pending}
                  >
                    确认归档
                  </Button>
                </details>
              )}
              <p role="status" className="text-sm">
                {lifecycle.message}
              </p>
            </fieldset>
          </form>
        )}
      </div>
    </section>
  );
}
