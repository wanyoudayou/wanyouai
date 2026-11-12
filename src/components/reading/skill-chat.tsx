"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/reading/chat-markdown";
import { ConversationBody, ConversationBubble, ConversationComposer } from "@/components/reading/conversation";

type Turn = { id: string; question: string; answer: string | null; state: string };

/** Update shareable conversation state without a route transition or exposing question text. */
function rememberSession(session: string) {
  const url = new URL(window.location.href);
  if (session) url.searchParams.set("session", session); else url.searchParams.delete("session");
  window.history.replaceState(null, "", url);
}

function useSkillConversation({ skill, title, guide, initialSession }: { skill: number; title: string; guide: string; initialSession?: string }) {
  const [session, setSession] = useState(initialSession ?? "");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(!!initialSession);
  const [unknown, setUnknown] = useState(false);
  const [version, setVersion] = useState("");
  const inFlight = useRef(false);
  const readTurns = async (id: string, signal: AbortSignal) => {
    const response = await fetch(`/api/skills/chat?skill=${skill}&session=${encodeURIComponent(id)}`, { cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    return data as { turns: Turn[]; version: string };
  };
  const applyTurns = (data: { turns: Turn[]; version: string }) => {
    setTurns(data.turns); setVersion(data.version);
    setUnknown(data.turns.some(turn => turn.state === "running"));
  };
  useEffect(() => {
    if (!initialSession) return;
    let active = true;
    const controller = new AbortController();
    void readTurns(initialSession, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
      .then(data => { if (active) applyTurns(data); })
      .catch(error => { if (active) { setUnknown(true); setMessage(error instanceof Error ? error.message : "对话暂时无法读取，请查询状态。"); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; controller.abort(); };
    // The provider is keyed by Skill identity; toggling panels never reloads or submits a turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession, skill]);

  async function send() {
    if (busy || inFlight.current || unknown || !question.trim()) return;
    inFlight.current = true;
    const current = session || crypto.randomUUID();
    const id = crypto.randomUUID(); const text = question;
    setSession(current); setBusy(true); setMessage(""); rememberSession(current);
    setTurns(rows => [...rows, { id, question: text, answer: null, state: "running" }]);
    try {
      const response = await fetch("/api/skills/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill, session: current, id, question: text }), signal: AbortSignal.timeout(55000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message);
      applyTurns(await readTurns(current, AbortSignal.timeout(15000))); setQuestion("");
    } catch (error) { setUnknown(true); setMessage(error instanceof Error ? error.message : "响应中断，请查询状态；不会重复提交问题。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function refresh() {
    if (busy || inFlight.current || !session) return;
    inFlight.current = true; setBusy(true);
    try { applyTurns(await readTurns(session, AbortSignal.timeout(15000))); setMessage("状态已更新。"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "状态暂时不可读。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function reset() {
    if (busy || inFlight.current) return;
    setSession(""); setTurns([]); setQuestion(""); setUnknown(false); setVersion(""); setMessage(""); rememberSession("");
  }
  return { title, guide, session, turns, question, setQuestion, message, busy, unknown, version, send, refresh, reset };
}

const SkillChatContext = createContext<ReturnType<typeof useSkillConversation> | null>(null);

/** State lives above desktop/drawer surfaces, separate from the avatar and other Skills. */
export function SkillChatProvider({ children, ...config }: Parameters<typeof useSkillConversation>[0] & { children: ReactNode }) {
  const value = useSkillConversation(config);
  return <SkillChatContext.Provider value={value}>{children}</SkillChatContext.Provider>;
}

export function SkillChat() {
  const chat = useContext(SkillChatContext);
  if (!chat) throw new Error("SkillChat must be rendered inside SkillChatProvider");
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <ConversationBody scrollKey={chat.turns}>
      <section className="min-w-0 space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
        <h2 className="font-semibold">正在使用：{chat.title}</h2>
        <p className="whitespace-pre-wrap">{chat.guide || "描述你希望完成的文本任务，并提供所需背景和输入。"}</p>
        <p className="text-xs text-muted-foreground">可阅读当前 Skill 包中的文本资料；不会执行脚本、联网或修改文件。每次提交可能产生模型费用，最多调用模型 3 次。{chat.version && `当前对话固定使用 v${chat.version}。`}</p>
      </section>
      <div aria-live="polite" className="flex min-w-0 flex-col gap-3">{chat.turns.map(turn => <div key={turn.id} className="flex min-w-0 flex-col gap-3">
        <ConversationBubble user>{turn.question}</ConversationBubble>
        <ConversationBubble>{turn.answer ? <ChatMarkdown markdown={turn.answer} allowImages={false} /> : <p className="text-muted-foreground">{turn.state === "running" ? "正在处理…" : turn.state === "unknown" ? "本轮结果未确认，已派发调用可能计费。" : "本轮未生成回答。"}</p>}</ConversationBubble>
      </div>)}</div>
    </ConversationBody>
    <div className="space-y-2 border-t p-3">
      <p role="status" className="text-sm" aria-live="polite">{chat.message}</p>
      <ConversationComposer value={chat.question} onChange={chat.setQuestion} onSubmit={() => void chat.send()} disabled={chat.busy} sendDisabled={chat.unknown} label="输入问题" placeholder="输入你希望完成的任务…" maxLength={8000} />
      <div className="flex flex-wrap items-center gap-1">
        {chat.session && <Button type="button" size="sm" variant="ghost" disabled={chat.busy} onClick={() => void chat.refresh()}>查询本轮状态</Button>}
        <Button type="button" size="sm" variant="ghost" disabled={chat.busy} onClick={chat.reset}>新建对话</Button>
        <span className="ml-auto text-xs text-muted-foreground">Enter 发送 · Shift+Enter 换行</span>
      </div>
      <p className="text-xs text-muted-foreground">AI 生成 · 仅供参考 · 合作请转人工</p>
    </div>
  </div>;
}
