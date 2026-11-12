import { getColumnItems, type ColumnKind } from "@/lib/get-columns";
import { getSiteConfig } from "@/lib/get-site-config";
import {
  ListBrowser,
  type ListEmptySpec,
} from "@/components/list/list-browser";
import { PanelPlaceholder } from "@/components/shell/panel-placeholder";
import type { ToolbarChip } from "@/components/list/list-toolbar";

/** 类型栏目页（契约 3.4）：一套组件三个预设（handbook / skill / event）。 */

const COLUMN_META: Record<
  ColumnKind,
  { title: string; searchPlaceholder: string; empty: ListEmptySpec }
> = {
  collection: {
    title: "专辑",
    searchPlaceholder: "搜索专辑…",
    empty: {
      title: "暂无专辑",
      action: { href: "/blog", label: "去博客看看" },
    },
  },
  handbook: {
    title: "手册",
    searchPlaceholder: "搜索手册…",
    empty: {
      title: "手册编写中",
      action: { href: "/blog", label: "去博客看看" },
    },
  },
  skill: {
    title: "技能",
    searchPlaceholder: "搜索技能…",
    empty: {
      title: "技能整理中",
      action: { href: "/blog", label: "去博客看看" },
    },
  },
  event: {
    title: "活动",
    searchPlaceholder: "搜索活动…",
    empty: {
      title: "暂无排期",
      action: { href: "/blog", label: "去博客看看" },
    },
  },
};

const TIPS: Record<ColumnKind, { title: string; items: string[] }> = {
  collection: {
    title: "按目录阅读",
    items: [
      "先阅读介绍页了解内容与适用范围",
      "按章节目录顺序阅读，也可选择所需主题",
      "访问权限与购买权益以页面说明为准",
    ],
  },
  handbook: {
    title: "可以这样用手册",
    items: [
      "先用搜索找主题，比逐章翻更快",
      "付费章节的完整内容订阅后可读",
      "购买整本手册含后续更新",
    ],
  },
  skill: {
    title: "可以这样用技能",
    items: [
      "技能卡上的文件清单就是交付物预览",
      "完整文件包的下载功能尚未开放",
      "先查看文件清单，了解技能交付物",
    ],
  },
  event: {
    title: "可以这样用活动",
    items: [
      "活动时间与票价见详情，符合条件后可在线报名",
      "活动沉淀（纪要 / 资料）按参会资格解锁",
      "会员活动的票价以报名块为准",
    ],
  },
};

export async function TypeColumn({ kind }: { kind: ColumnKind }) {
  const site = await getSiteConfig();
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";
  const items = await getColumnItems(kind, currency);
  const meta = COLUMN_META[kind];

  const freeCount = items.filter((item) =>
    item.accesses?.includes("public"),
  ).length;
  const subscriberCount = items.filter((item) =>
    item.accesses?.some(
      (access) => access === "subscriber" || access === "paid",
    ),
  ).length;
  const registeredCount = items.filter((item) =>
    item.accesses?.includes("registered"),
  ).length;
  const chips: ToolbarChip[] = [
    { key: "all", label: "全部", count: items.length },
    { key: "free", label: "免费", count: freeCount },
    { key: "registered", label: "注册", count: registeredCount },
    { key: "subscriber", label: "订阅", count: subscriberCount },
    { key: "single", label: "单篇", count: 0 },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-8">
      <PanelPlaceholder value={{ kind: "tips", ...TIPS[kind] }} />
      <div className="flex flex-col gap-8">
        <h1 className="text-2xl leading-snug font-medium">{meta.title}</h1>
        <ListBrowser
          variant={kind}
          items={items}
          timezone={site.identity.timezone}
          chips={chips}
          searchPlaceholder={meta.searchPlaceholder}
          empty={meta.empty}
        />
      </div>
    </div>
  );
}
