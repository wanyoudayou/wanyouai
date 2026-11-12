"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CornerDownRightIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { saveNavigationAction, type NavigationSaveState } from "@/app/admin/navigation/actions";
import type { AdminNavRow, NavigationAdminData } from "@/lib/admin/navigation";
import { NAV_ICON_NAMES, navIcon } from "@/lib/navigation/icons";
import { sectionPath } from "@/lib/sections/registry";
import type { NavItemKind } from "@/lib/navigation/types";
import type { NavAccess } from "@/lib/navigation/validate";
import { cn } from "@/lib/utils";
import { useUnsavedChanges } from "./use-unsaved-changes";

type Draft = Omit<AdminNavRow, "id"> & { key: string };

const KIND_LABEL: Record<NavItemKind, string> = {
  external: "外部链接",
  page: "独立页面",
  series: "手册与活动",
  section: "代码栏目",
  group: "父级目录",
};
const ACCESS_LABEL: Record<NavAccess, string> = {
  public: "免费",
  login: "登录可见",
  subscriber: "订阅可见",
};
const select = "h-9 rounded-md border bg-background px-2 text-sm";

let sequence = 0;
const nextKey = () => `new-${++sequence}`;

function toPayload(items: Draft[]) {
  return items.map(({ kind, label, icon, url, page_id, series_id, section, access, enabled, child }) => ({
    kind,
    label,
    icon,
    url,
    page_id,
    series_id,
    section,
    access,
    enabled,
    child,
  }));
}

/** 子项只能紧跟父级目录；任何操作之后都按这一规则修正层级。 */
function normalize(items: Draft[]): Draft[] {
  let inGroup = false;
  return items.map((item) => {
    if (item.kind === "group") {
      inGroup = true;
      return item.child ? { ...item, child: false } : item;
    }
    if (item.child && !inGroup) return { ...item, child: false };
    if (!item.child) inGroup = false;
    return item;
  });
}

/** 顶层项所占的区间 [start, end)：父级目录连同它的子项一起移动。 */
function blockEnd(items: Draft[], start: number) {
  let end = start + 1;
  if (items[start].kind === "group") while (end < items.length && items[end].child) end++;
  return end;
}

function groupStart(items: Draft[], index: number) {
  let start = index;
  while (start > 0 && items[start].child) start--;
  return start;
}

export function NavigationManager({ data }: { data: NavigationAdminData }) {
  const router = useRouter();
  const initial = useMemo<Draft[]>(
    () => data.rows.map(({ id, ...row }) => ({ ...row, key: `row-${id}` })),
    [data.rows],
  );
  const [items, setItems] = useState<Draft[]>(initial);
  const [state, action, pending] = useActionState<NavigationSaveState, FormData>(
    saveNavigationAction,
    { ok: false, message: "" },
  );
  // 与最近一次读取的服务端列表比较；保存成功并刷新后自然回到“无修改”。
  const dirty = JSON.stringify(toPayload(items)) !== JSON.stringify(toPayload(initial));
  useUnsavedChanges(dirty);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  // 刷新返回前沿用保存结果中的新版本，避免连续保存误报冲突。
  const version = state.ok && state.version && dirty ? state.version : data.version;

  const change = (next: Draft[]) => setItems(normalize(next));
  const update = (key: string, patch: Partial<Draft>) =>
    change(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const moveUp = (index: number) => {
    if (items[index].child) {
      const next = [...items];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return change(next);
    }
    const end = blockEnd(items, index);
    const previous = groupStart(items, index - 1);
    change([...items.slice(0, previous), ...items.slice(index, end), ...items.slice(previous, index), ...items.slice(end)]);
  };
  const moveDown = (index: number) => {
    if (items[index].child) {
      const next = [...items];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return change(next);
    }
    const end = blockEnd(items, index);
    const nextEnd = blockEnd(items, end);
    change([...items.slice(0, index), ...items.slice(end, nextEnd), ...items.slice(index, end), ...items.slice(nextEnd)]);
  };
  const canMoveUp = (index: number) => (items[index].child ? !!items[index - 1]?.child : index > 0);
  const canMoveDown = (index: number) =>
    items[index].child ? !!items[index + 1]?.child : blockEnd(items, index) < items.length;
  /** 顶层链接紧跟在某个目录（或它的子项）之后时，可以移入该目录。 */
  const canIndent = (index: number) =>
    !items[index].child && items[index].kind !== "group" && index > 0 &&
    (items[index - 1].kind === "group" || items[index - 1].child);
  const outdent = (index: number) => {
    const end = blockEnd(items, groupStart(items, index));
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(end - 1, 0, { ...item, child: false });
    change(next);
  };
  const remove = (index: number) => {
    // 删除目录时保留其子项，提升为顶层链接。
    const end = blockEnd(items, index);
    change([
      ...items.slice(0, index),
      ...items.slice(index + 1, end).map((item) => ({ ...item, child: false })),
      ...items.slice(end),
    ]);
  };
  const childCount = (index: number) => blockEnd(items, index) - index - 1;

  const used = (kind: NavItemKind, id: number | string) =>
    items.some((item) =>
      kind === "page"
        ? item.page_id === id
        : kind === "series"
          ? item.series_id === id
          : item.section === id,
    );

  const add = (draft: Draft, groupKey: string | null) => {
    const start = groupKey ? items.findIndex((item) => item.key === groupKey) : -1;
    if (start < 0) return change([...items, { ...draft, child: false }]);
    const end = blockEnd(items, start);
    change([...items.slice(0, end), { ...draft, child: true }, ...items.slice(end)]);
  };

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4">
        <input type="hidden" name="version" value={version} />
        <input type="hidden" name="items" value={JSON.stringify(toPayload(items))} />
        <section aria-label="自定义导航" className="rounded-xl border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <h2 className="font-medium">自定义导航</h2>
              <p className="text-xs text-muted-foreground">
                显示在首页、博客、手册等内置导航之后，按列表顺序排列；父级目录在侧栏中折叠显示子项；代码栏目只在电脑端侧栏显示。
              </p>
            </div>
            <span className="text-xs text-muted-foreground">{items.length} / 50</span>
          </header>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              还没有自定义导航。可在下方添加外部链接、页面、手册、代码栏目或父级目录。
            </p>
          ) : (
            <ol className="divide-y">
              {items.map((item, index) => {
                const Icon = navIcon(item.icon);
                const group = item.kind === "group";
                const problem = group ? (childCount(index) ? null : "没有子项，前台不显示") : item.problem;
                const target = group ? (childCount(index) ? `${childCount(index)} 个子项` : "—") : item.href;
                return (
                  <li
                    key={item.key}
                    data-nav-child={item.child ? "" : undefined}
                    className={cn(
                      "grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center",
                      item.child && "pl-10",
                      !item.enabled && "opacity-70",
                    )}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {item.child && <CornerDownRightIcon className="size-4 shrink-0 text-muted-foreground" aria-label="子项" />}
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <Input
                        aria-label={`第 ${index + 1} 项名称`}
                        value={item.label}
                        maxLength={40}
                        className="h-9 w-44"
                        onChange={(event) => update(item.key, { label: event.target.value })}
                      />
                      <select
                        aria-label={`第 ${index + 1} 项图标`}
                        className={select}
                        value={item.icon}
                        onChange={(event) => update(item.key, { icon: event.target.value })}
                      >
                        {NAV_ICON_NAMES.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <StatusBadge tone={group ? "info" : "neutral"}>{KIND_LABEL[item.kind]}</StatusBadge>
                      <span className="min-w-0 truncate text-xs text-muted-foreground" title={target}>
                        {target}
                      </span>
                      {problem && <StatusBadge tone="warning">{problem}</StatusBadge>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.kind === "section" && (
                        <select
                          aria-label={`第 ${index + 1} 项访问级别`}
                          className={select}
                          value={item.access}
                          onChange={(event) => update(item.key, { access: event.target.value as NavAccess })}
                        >
                          {Object.entries(ACCESS_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      )}
                      <label className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(event) => update(item.key, { enabled: event.target.checked })}
                        />
                        启用
                      </label>
                      {canIndent(index) && (
                        <Button type="button" variant="ghost" size="icon" aria-label={`将 ${item.label} 移入上方目录`} title="移入上方目录" onClick={() => update(item.key, { child: true })}>
                          <IndentIncreaseIcon />
                        </Button>
                      )}
                      {item.child && (
                        <Button type="button" variant="ghost" size="icon" aria-label={`将 ${item.label} 移出目录`} title="移出目录" onClick={() => outdent(index)}>
                          <IndentDecreaseIcon />
                        </Button>
                      )}
                      <Button type="button" variant="ghost" size="icon" aria-label={`上移 ${item.label}`} disabled={!canMoveUp(index)} onClick={() => moveUp(index)}>
                        <ArrowUpIcon />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`下移 ${item.label}`} disabled={!canMoveDown(index)} onClick={() => moveDown(index)}>
                        <ArrowDownIcon />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`移除 ${item.label}`} title={group ? "移除目录，子项保留为顶层链接" : undefined} onClick={() => remove(index)}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3">
          <Button disabled={pending || !dirty}>{pending ? "正在保存…" : "保存导航"}</Button>
          {dirty && !pending && (
            <Button type="button" variant="ghost" onClick={() => setItems(initial)}>
              放弃修改
            </Button>
          )}
          <p role="status" className={cn("text-sm", state.ok ? "text-muted-foreground" : "text-destructive")}>
            {pending ? "" : dirty ? "有未保存的修改。" : state.message}
          </p>
        </div>
      </form>
      <AddNavItem
        data={data}
        used={used}
        full={items.length >= 50}
        groups={items.filter((item) => item.kind === "group").map((item) => ({ key: item.key, label: item.label }))}
        onAdd={add}
      />
      <p className="text-xs text-muted-foreground">
        代码栏目来自本次部署的栏目登记表；删除栏目代码并重新部署后，对应导航会标为“本次部署中不存在”并在前台隐藏。
        {data.commit ? ` 当前部署：${data.commit}` : ""}
      </p>
    </div>
  );
}

function AddNavItem({
  data,
  used,
  full,
  groups,
  onAdd,
}: {
  data: NavigationAdminData;
  used: (kind: NavItemKind, id: number | string) => boolean;
  full: boolean;
  groups: { key: string; label: string }[];
  onAdd: (draft: Draft, groupKey: string | null) => void;
}) {
  const [kind, setKind] = useState<NavItemKind>("external");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState("");
  const [parent, setParent] = useState("");
  const [message, setMessage] = useState("");
  const base = { url: null, page_id: null, series_id: null, section: null, access: "public" as NavAccess, enabled: true, problem: null, child: false };
  const options =
    kind === "page"
      ? data.pages.filter((page) => !used("page", page.id)).map((page) => ({ value: String(page.id), label: `${page.title}（${page.note}）` }))
      : kind === "series"
        ? data.series.filter((series) => !used("series", series.id)).map((series) => ({ value: String(series.id), label: `${series.title}（${series.note}）` }))
        : kind === "section"
          ? data.sections.filter((section) => !used("section", section.name)).map((section) => ({ value: section.name, label: `${section.title}（${section.path}）` }))
          : [];
  const into = kind === "group" || !groups.some((group) => group.key === parent) ? null : parent;

  const add = () => {
    setMessage("");
    if (kind === "group") {
      if (!label.trim()) return setMessage("请填写目录名称。");
      onAdd({ ...base, key: nextKey(), kind, label: label.trim(), icon: "folder", href: "—" }, null);
    } else if (kind === "external") {
      let href: string;
      try {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== "https:") throw new Error();
        href = parsed.href;
      } catch {
        setMessage("请填写完整的 https 地址。");
        return;
      }
      if (!label.trim()) {
        setMessage("请填写导航名称。");
        return;
      }
      onAdd({ ...base, key: nextKey(), kind, label: label.trim(), icon: "external-link", url: href, href }, into);
    } else if (kind === "page") {
      const page = data.pages.find((option) => String(option.id) === target);
      if (!page) return setMessage("请选择页面。");
      onAdd({ ...base, key: nextKey(), kind, label: page.title.slice(0, 40), icon: "file-text", page_id: page.id, href: page.href, problem: page.live ? null : "页面未发布，前台暂不显示" }, into);
    } else if (kind === "series") {
      const series = data.series.find((option) => String(option.id) === target);
      if (!series) return setMessage("请选择手册或活动。");
      onAdd({ ...base, key: nextKey(), kind, label: series.title.slice(0, 40), icon: series.href.startsWith("/events") ? "calendar" : "book-open", series_id: series.id, href: series.href, problem: series.live ? null : "专辑未上架，前台暂不显示" }, into);
    } else {
      const section = data.sections.find((option) => option.name === target);
      if (!section) return setMessage("请选择代码栏目。");
      onAdd({ ...base, key: nextKey(), kind, label: section.title.slice(0, 40), icon: section.icon, section: section.name, href: sectionPath(section.name) }, into);
    }
    setLabel("");
    setUrl("");
    setTarget("");
  };

  return (
    <section aria-label="添加导航" className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="font-medium">添加导航</h2>
      <fieldset disabled={full} className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block">类型</span>
          <select
            aria-label="导航类型"
            className={select}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as NavItemKind);
              setTarget("");
              setMessage("");
            }}
          >
            {Object.entries(KIND_LABEL).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        {kind === "external" || kind === "group" ? (
          <label className="space-y-1 text-sm">
            <span className="block">名称</span>
            <Input aria-label={kind === "group" ? "目录名称" : "导航名称"} value={label} maxLength={40} className="h-9 w-40" onChange={(event) => setLabel(event.target.value)} />
          </label>
        ) : null}
        {kind === "external" ? (
          <label className="min-w-64 flex-1 space-y-1 text-sm">
            <span className="block">链接地址</span>
            <Input type="url" value={url} placeholder="https://" className="h-9" onChange={(event) => setUrl(event.target.value)} />
          </label>
        ) : kind !== "group" ? (
          <label className="min-w-64 flex-1 space-y-1 text-sm">
            <span className="block">目标</span>
            <select aria-label="导航目标" className={cn(select, "w-full")} value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">{options.length ? "请选择" : "没有可添加的项目"}</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {kind !== "group" && groups.length > 0 && (
          <label className="space-y-1 text-sm">
            <span className="block">放入目录</span>
            <select aria-label="放入目录" className={select} value={into ?? ""} onChange={(event) => setParent(event.target.value)}>
              <option value="">不放入（顶层）</option>
              {groups.map((group) => (
                <option key={group.key} value={group.key}>
                  {group.label || "未命名目录"}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button type="button" variant="outline" onClick={add}>
          加入列表
        </Button>
      </fieldset>
      {kind === "section" && data.sections.length === 0 && (
        <p className="text-sm text-muted-foreground">
          本次部署还没有代码栏目。开发者用本地 skill 在仓库中创建栏目并部署后，会出现在这里。
        </p>
      )}
      {kind === "group" && (
        <p className="text-sm text-muted-foreground">
          父级目录本身不是链接，在侧栏中点击右侧箭头展开或收起；添加后，可在其他项的“放入目录”中选择它，或在列表中用“移入上方目录”调整。没有子项的目录前台不显示。
        </p>
      )}
      <p role="status" className="text-sm text-destructive empty:hidden">
        {full ? "自定义导航已达 50 项上限。" : message}
      </p>
      <p className="text-xs text-muted-foreground">加入列表后，点击上方「保存导航」才会生效。</p>
    </section>
  );
}
