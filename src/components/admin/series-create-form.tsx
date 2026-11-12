"use client";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { BookOpenIcon, CalendarDaysIcon } from "lucide-react";
import { createSeries } from "@/app/admin/manage-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type CreatableSeriesType = "handbook" | "event";

const KINDS = [
  {
    value: "handbook",
    label: "手册",
    Icon: BookOpenIcon,
    hint: "多章节的长期内容，可整本定价出售。",
    slug: "opc-handbook",
    path: "/handbooks/",
  },
  {
    value: "event",
    label: "活动",
    Icon: CalendarDaysIcon,
    hint: "线下或线上活动，创建后设置时间、名额与票价。",
    slug: "spring-meetup",
    path: "/events/",
  },
] as const;

/** 先选类型，再只显示该类型需要的字段；Skill 在独立入口创建。 */
export function SeriesCreateForm({
  initialType = "handbook",
}: {
  initialType?: CreatableSeriesType;
}) {
  const router = useRouter();
  const [type, setType] = useState<CreatableSeriesType>(initialType);
  const kind = KINDS.find((item) => item.value === type) ?? KINDS[0];
  const [state, action, pending] = useActionState(
    async (previous: { ok: boolean; message: string }, form: FormData) => {
      const result = await createSeries(previous, form);
      if (result.ok && "id" in result)
        router.push(`/admin/collections/${result.id}`);
      return result;
    },
    { ok: false, message: "" },
  );
  return (
    <form action={action} className="space-y-6">
      <fieldset disabled={pending} className="space-y-6">
        <div role="radiogroup" aria-label="类型" className="grid gap-3 sm:grid-cols-2">
          {KINDS.map((item) => (
            <label
              key={item.value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                type === item.value && "border-primary bg-accent",
              )}
            >
              <input
                type="radio"
                name="type"
                value={item.value}
                checked={type === item.value}
                onChange={() => setType(item.value)}
                className="sr-only"
              />
              <item.Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span className="space-y-1">
                <span className="block font-medium">{item.label}</span>
                <span className="block text-sm text-muted-foreground">{item.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm sm:col-span-2">
            {kind.label}标题
            <Input name="title" required maxLength={200} />
          </label>
          <label className="space-y-2 text-sm">
            网址标识
            <Input
              name="slug"
              required
              minLength={2}
              maxLength={120}
              pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
              placeholder={`例如 ${kind.slug}`}
            />
            <span className="block text-xs text-muted-foreground">
              访问地址 {kind.path}标识；小写英文、数字和连字符，创建后不能修改。
            </span>
          </label>
          {type === "handbook" ? (
            <label className="space-y-2 text-sm">
              整本价格（元）
              <Input
                name="price"
                type="number"
                min="0"
                max="999999.99"
                step="0.01"
                defaultValue="0"
                required
              />
              <span className="block text-xs text-muted-foreground">
                0 表示不单独出售；章节是否收费在每章的阅读权限里设置。
              </span>
            </label>
          ) : (
            <input type="hidden" name="price" value="0" />
          )}
          <label className="space-y-2 text-sm sm:col-span-2">
            一句话说明
            <Input
              name="task"
              maxLength={300}
              placeholder={
                type === "event" ? "这场活动帮参与者解决什么" : "帮助读者完成什么任务"
              }
            />
          </label>
          <label className="space-y-2 text-sm">
            标签
            <Input name="tags" placeholder="用逗号分隔" maxLength={1020} />
          </label>
          <label className="space-y-2 text-sm">
            适用人群
            <Input name="audiences" placeholder="用逗号分隔" maxLength={1020} />
          </label>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending}>
          {pending ? "创建中…" : `创建${kind.label}草稿`}
        </Button>
        <p className="text-sm text-muted-foreground">
          {type === "event"
            ? "创建后设置时间、地点与票价，发布公开介绍后即可上架报名。"
            : "创建后发布公开介绍和章节，确认无误再上架。"}
        </p>
      </div>
      <p role="status" className="text-sm">
        {state.message}
      </p>
    </form>
  );
}
