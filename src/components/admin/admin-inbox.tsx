"use client";
import { useActionState } from "react";
import { resolveInboxItem, reviewConversation } from "@/app/admin/inbox-actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { InboxIcon } from "lucide-react";
import type { getInboxData } from "@/lib/admin/inbox";

type Data = Awaited<ReturnType<typeof getInboxData>>;
const KIND_LABEL: Record<string, string> = { escalation: "转人工", inquiry: "服务询价" };

/** 收件箱：转人工/询价留言处理 + 会话审核公开。 */
export function AdminInbox({ data }: { data: Data }) {
  const [resolveState, resolveAction, resolving] = useActionState(resolveInboxItem, { message: "" });
  const [reviewState, reviewAction, reviewing] = useActionState(reviewConversation, { message: "" });
  return <div className="space-y-8 py-4">
    <section aria-label="留言" className="space-y-3">
      <h2 className="text-base font-medium">留言（{data.items.filter((i) => i.status === "open").length} 待处理）</h2>
      {data.items.length === 0 ? <EmptyState Icon={InboxIcon} title="收件箱是空的" /> : <ul className="divide-y rounded-lg border">
        {data.items.map((item) => <li key={item.id} className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{KIND_LABEL[item.kind] ?? item.kind} · {item.contact ?? "匿名"} · {new Date(item.created_at).toLocaleString("zh-CN")}</span>
            {item.status === "open" ? (
              <form action={resolveAction}><input type="hidden" name="id" value={item.id} /><Button size="sm" variant="outline" disabled={resolving}>标记已处理</Button></form>
            ) : <span>已处理</span>}
          </div>
          <p className="text-sm leading-[1.7] whitespace-pre-wrap">{String((item.payload as { message?: string }).message ?? "")}</p>
        </li>)}
      </ul>}
      <p role="status" className="text-xs text-muted-foreground">{resolveState.message}</p>
    </section>

    <section aria-label="会话审核" className="space-y-3">
      <h2 className="text-base font-medium">会话与公开问答（{data.pending.filter(c => !c.publication).length} 待整理）</h2>
      <p className="text-xs text-muted-foreground">原始对话仅当事人与站主可见。请另行整理可公开的问题与答复，移除个人信息和受限正文；公开稿将进入站内检索，可修改或撤回。</p>
      {data.pending.length === 0 ? <p className="text-sm text-muted-foreground">没有待处理或已公开的问答。</p> : <ul className="divide-y rounded-lg border">
        {data.pending.map((item) => <li key={item.id} className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{item.articleTitle ? `《${item.articleTitle}》· ` : ""}{new Date(item.created_at).toLocaleString("zh-CN")}</span>
            <span>{item.publication ? "已有公开稿" : "待整理公开稿"}</span>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">问：{item.preview}</p>
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">查看私有原始对话</summary>
            <div className="mt-2 space-y-2 break-words">{item.originalMessages.map((message, index) => <p key={index} className="whitespace-pre-wrap">{message.role === "user" ? "用户" : "分身"}：{message.content}</p>)}</div>
          </details>
          <form key={item.publication?.updated_at ?? "new"} action={reviewAction} className="space-y-3">
            <input type="hidden" name="id" value={item.id} />
            <label className="block space-y-1 text-sm"><span>公开问题</span><textarea className="block min-h-20 w-full rounded-md border bg-background p-2" name="question" required maxLength={2000} defaultValue={item.publication?.question_md ?? ""} placeholder="重新整理可公开的问题，勿包含个人身份或联系方式" /></label>
            <label className="block space-y-1 text-sm"><span>公开答复</span><textarea className="block w-full rounded-md border bg-background p-2" name="answer" required maxLength={12000} rows={4} defaultValue={item.publication?.answer_md ?? ""} placeholder="填写可公开的答复，勿复制付费正文或私人对话" /></label>
            <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" name="confirmed" required className="mt-0.5" /><span>已检查公开稿，移除个人信息及付费或其他受限正文。</span></label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" name="value" value="public" disabled={reviewing}>{item.publication ? "更新公开稿" : "发布公开稿"}</Button>
              <Button size="sm" variant="ghost" name="value" value="hidden" formNoValidate disabled={reviewing}>{item.publication ? "撤回公开稿" : "隐藏会话"}</Button>
            </div>
          </form>
        </li>)}
      </ul>}
      <p role="status" className="text-xs text-muted-foreground">{reviewState.message}</p>
    </section>
  </div>;
}
