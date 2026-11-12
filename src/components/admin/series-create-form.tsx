"use client";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { createSeries } from "@/app/admin/manage-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function SeriesCreateForm() {
  const router = useRouter();
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
    <form action={action} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        先创建草稿，再发布公开 README
        并上架。活动还需在专辑详情保存时间与票价，再上架。
      </p>
      <fieldset disabled={pending} className="space-y-4">
        <label className="space-y-2 text-sm">
          专辑标题
          <Input name="title" required maxLength={200} />
        </label>
        <label className="space-y-2 text-sm">
          网址标识（slug）
          <Input
            name="slug"
            required
            minLength={2}
            maxLength={120}
            pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
            placeholder="opc-handbook"
          />
          <span className="block text-xs text-muted-foreground">
            用于链接，例如
            /handbooks/getting-started；小写英文、数字和连字符，创建后固定。
          </span>
        </label>
        <label className="space-y-2 text-sm">
          专辑类型
          <select
            name="type"
            className="block h-9 w-full rounded-md border bg-background px-3"
          >
            <option value="handbook">手册</option>
            <option value="event">活动</option>
          </select>
        </label>
        <label className="space-y-2 text-sm">
          价格（元）
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
            手册可填 0；活动此处填 0，票价单独配置。Skill 在独立入口管理。
          </span>
        </label>
        <label className="space-y-2 text-sm">
          任务一句话
          <Input
            name="task"
            maxLength={300}
            placeholder="帮助读者完成什么任务"
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
      </fieldset>
      <Button disabled={pending}>{pending ? "创建中…" : "创建草稿专辑"}</Button>
      <p role="status" className="text-sm">
        {state.message}
      </p>
    </form>
  );
}
