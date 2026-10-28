"use client";
import { useActionState, useState } from "react";
import { updateDisplayName } from "@/app/me/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** 昵称编辑（个人中心）：点击激活编辑态，保存/取消。 */
export function NicknameEditor({ current }: { current: string | null }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(async (prev: { ok: boolean; message: string }, form: FormData) => {
    const result = await updateDisplayName(prev, form);
    if (result.ok) setEditing(false);
    return result;
  }, { ok: false, message: "" });
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="group inline-flex items-center gap-2 text-left" title="点击编辑昵称">
        <span className="text-lg font-medium">{current || "未设置昵称"}</span>
        <span className="text-xs text-muted-foreground underline-offset-4 group-hover:underline">编辑</span>
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Input name="display_name" defaultValue={current ?? ""} maxLength={40} placeholder="输入昵称（留空清除）" className="h-8 w-52" autoFocus />
      <Button size="sm" disabled={pending}>{pending ? "保存中…" : "保存"}</Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>取消</Button>
      {state.message && <p role="status" className="w-full text-xs text-muted-foreground">{state.message}</p>}
    </form>
  );
}
