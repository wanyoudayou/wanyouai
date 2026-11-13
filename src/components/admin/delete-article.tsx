"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteArticle } from "@/app/admin/manage-actions";
import { Button } from "@/components/ui/button";

/** Deletes a free blog post or chapter nobody has paid for; paid content uses pause → archive. */
export function DeleteArticle({
  id,
  updated,
  access,
  readme,
  after,
}: {
  id: number;
  updated: string;
  access: string;
  readme: boolean;
  after: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(deleteArticle, { ok: false, message: "" });
  useEffect(() => {
    if (state.ok) router.replace(after);
  }, [state.ok, after, router]);
  const blocked = !["public", "registered"].includes(access)
    ? "付费或订阅内容不能删除，请使用暂停与归档。"
    : readme
      ? "此章节是专辑 README，先在专辑设置中更换 README 后才能删除。"
      : "";
  return (
    <section aria-label="删除内容" className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-medium">删除</h2>
      <p className="text-sm text-muted-foreground">
        用于误发布的免费内容：删除正文、历史版本与导入记录，释放网址标识。已有订单或购买权益的内容不能删除。
      </p>
      {blocked ? (
        <p className="text-sm">{blocked}</p>
      ) : !open ? (
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          删除这篇内容
        </Button>
      ) : (
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="updated" value={updated} />
          <label className="flex items-start gap-2 text-sm">
            <input name="confirm" type="checkbox" required className="mt-1" />
            <span>确认删除：读者将无法再打开这篇内容，删除后不能恢复。</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "删除中…" : "确认删除"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              取消
            </Button>
          </div>
        </form>
      )}
      <p role="status" className="text-sm">
        {state.message}
      </p>
    </section>
  );
}
