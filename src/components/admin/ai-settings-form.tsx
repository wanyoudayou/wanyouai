"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { BotIcon, BookOpenIcon, FileCodeIcon, PlugIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AI_TARGETS } from "@/lib/ai/connections";
import { AVATAR_FIXED_POLICY, DEFAULT_AVATAR_INSTRUCTIONS } from "@/lib/ai/policy";
import type { AISettingsView } from "@/lib/ai/settings";
import { saveAISettings, migrateLegacyAI } from "@/app/admin/ai/actions";
import { KnowledgeIndexPanel } from "@/components/admin/knowledge-index-panel";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
function draftFromView(view: AISettingsView) {
  return {
    generation: !!view.generation, baseUrl: view.generation?.baseUrl ?? "https://api.deepseek.com", protocol: view.generation?.protocol ?? "chat", model: view.generation?.model ?? "", generationKey: "",
    embedding: !!view.embedding, reuse: view.embeddingKeyShared, embeddingKey: "", enabled: view.avatarEnabled,
    anonymous: view.anonymousEntry, instructions: view.ownerInstructions, limit: view.monthlyLimit === null ? "" : String(view.monthlyLimit),
  };
}
export function AISettingsForm({ initial }: { initial: AISettingsView }) {
  const [view, setView] = useState(initial);
  const [configOpen, setConfigOpen] = useState(!initial.embedding?.verifiedAt);
  const configuration = useRef<HTMLDetailsElement>(null);
  const openConfiguration = () => {
    setConfigOpen(true);
    requestAnimationFrame(() => { configuration.current?.scrollIntoView({ block: "start" }); configuration.current?.querySelector("summary")?.focus(); });
  };
  const [saving, startTransition] = useTransition();
  const [checking, setChecking] = useState<"generation" | "embedding" | null>(null);
  const checkLock = useRef(false);
  const [checkMessages, setCheckMessages] = useState({ generation: "", embedding: "" });
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const pending = saving || checking !== null || knowledgeBusy;
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState(() => draftFromView(initial));
  const [probeConsent, setProbeConsent] = useState(false);
  const target = AI_TARGETS.find(target => target.baseUrl === draft.baseUrl)!;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFromView(view));
  const patch = (value: Partial<typeof draft>) => setDraft(current => ({ ...current, ...value }));
  const update = (result: { message: string; view?: AISettingsView }) => {
    setMessage(result.message);
    if (result.view) { setView(result.view); setDraft(draftFromView(result.view)); setCheckMessages({ generation: "", embedding: "" }); setProbeConsent(false); }
  };
  async function check(purpose: "generation" | "embedding") {
      if (checkLock.current || pending || dirty || !probeConsent) return;
      checkLock.current = true; setChecking(purpose);
      setCheckMessages(current => ({ ...current, [purpose]: "正在检查已保存的连接，请等待；不会自动重试。" }));
      try {
        const response = await fetch("/api/admin/ai/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose, consent: probeConsent, requestId: crypto.randomUUID() }), signal: AbortSignal.timeout(50000) });
        const result = await response.json() as { message?: string; view?: AISettingsView };
        setCheckMessages(current => ({ ...current, [purpose]: result.message ?? "结果暂时不可用，请刷新确认。" }));
        if (response.ok && result.view) { setView(result.view); setDraft(draftFromView(result.view)); }
      } catch { setCheckMessages(current => ({ ...current, [purpose]: "检查结果暂时无法确认；请刷新查看已保存状态，不自动重复调用。" })); }
      finally { checkLock.current = false; setChecking(null); }
  }
  return <div className="space-y-6">
    <details ref={configuration} open={configOpen} onToggle={event => setConfigOpen(event.currentTarget.open)} className="space-y-5 rounded-xl border bg-card p-4 sm:p-5">
      <summary className="cursor-pointer font-semibold">模型连接与分身设置<span className="mt-1 block text-sm font-normal text-muted-foreground">向量连接{view.embedding?.verifiedAt ? "已检查" : view.embedding ? "待检查" : "待配置"} · 生成连接{view.generation?.verifiedAt ? "已检查" : view.generation ? "待检查" : "待配置"} · 分身{view.avatarEnabled ? "开关已开启" : "开关未开启"}</span></summary>
      <p className="text-sm text-muted-foreground">首次填写连接，保存后检查。已经通过的连接不用反复检查；日常更新文章只需使用下方知识库流程。</p>
    <form className="space-y-6" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      startTransition(async () => { try { update(await saveAISettings(form)); } catch { setMessage("保存未确认，输入已保留，请刷新核对。"); } });
    }}>
      <input type="hidden" name="revision" value={view.revision} />
      <fieldset disabled={pending} className="space-y-6">
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><PlugIcon className="size-4" />共享生成模型</h2>
          <p className="text-sm text-muted-foreground">分身问答与页面初稿共用此连接，各自使用独立的任务规则。新目标须填写对应 Key；留空保留同一目标的已有 Key。</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="generation_enabled" checked={draft.generation} onChange={event => patch({ generation: event.target.checked })} />配置生成连接</label>
          {draft.generation && <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm">接口根地址<select className={selectClass} name="generation_base_url" value={draft.baseUrl} onChange={event => {
              const next = AI_TARGETS.find(target => target.baseUrl === event.target.value)!;
              patch({ baseUrl: next.baseUrl, protocol: next.protocols[0], reuse: next.baseUrl === "https://api.siliconflow.cn/v1" && draft.reuse });
            }}>{AI_TARGETS.map(target => <option key={target.baseUrl} value={target.baseUrl}>{target.name} · {target.baseUrl}</option>)}</select></label>
            <label className="space-y-2 text-sm">接口协议<select className={selectClass} name="generation_protocol" value={draft.protocol} onChange={event => patch({ protocol: event.target.value as typeof draft.protocol })}>{target.protocols.filter(protocol => protocol !== "embeddings").map(protocol => <option key={protocol} value={protocol}>{protocol === "chat" ? "Chat Completions" : protocol === "responses" ? "Responses" : "Anthropic Messages"}</option>)}</select></label>
            <label className="space-y-2 text-sm">模型标识<Input name="generation_model" maxLength={160} value={draft.model} onChange={event => patch({ model: event.target.value })} /></label>
            <label className="space-y-2 text-sm">生成 API Key<Input name="generation_key" type="password" autoComplete="new-password" maxLength={1024} value={draft.generationKey} onChange={event => patch({ generationKey: event.target.value })} placeholder={view.generation ? "已保存；留空保留同一目标的 Key" : "填写该供应商的 Key"} /></label>
          </div>}
          <p className="text-sm">已保存的连接：{view.generation ? `${view.generation.model} · ${view.generation.verifiedAt ? "检查通过" : "待检查"}` : "未配置"}</p>
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><BookOpenIcon className="size-4" />知识库与语义检索</h2>
          <p className="text-sm text-muted-foreground">分身必需。当前接入硅基流动中国区的 BAAI/bge-m3，原生 1024 维；生成接口兼容不代表提供 Embeddings。</p>
          <label className="flex items-center gap-2 text-sm"><input name="embedding_enabled" type="checkbox" checked={draft.embedding} onChange={event => patch({ embedding: event.target.checked })} />配置知识库向量连接</label>
          {draft.embedding && <>
            <p className="break-all text-sm">https://api.siliconflow.cn/v1 · BAAI/bge-m3</p>
            <label className="flex items-center gap-2 text-sm"><input name="embedding_reuse" type="checkbox" disabled={!draft.generation || draft.baseUrl !== "https://api.siliconflow.cn/v1"} checked={draft.reuse} onChange={event => patch({ reuse: event.target.checked, embeddingKey: "" })} />显式复用同一硅基流动生成连接的 Key</label>
            {!draft.reuse && <label className="block space-y-2 text-sm">向量 API Key<Input name="embedding_key" type="password" autoComplete="new-password" maxLength={1024} value={draft.embeddingKey} onChange={event => patch({ embeddingKey: event.target.value })} placeholder={view.embedding ? "已保存；留空保留" : "填写硅基流动 Key"} /></label>}
          </>}
          <p className="text-sm">已保存的连接：{view.embedding ? `${view.embedding.model} · ${view.embedding.verifiedAt ? "检查通过" : "待检查"}` : "未配置"}。保存和检查连接不会自动发送文章或建立索引。</p>
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><BotIcon className="size-4" />站主分身</h2>
          <label className="flex items-center gap-2 text-sm"><input name="avatar_enabled" type="checkbox" checked={draft.enabled} onChange={event => patch({ enabled: event.target.checked })} />启用知识库分身（连接和索引就绪后才对外开放）</label>
          <label className="flex items-center gap-2 text-sm"><input name="anonymous_entry" type="checkbox" checked={draft.anonymous} onChange={event => patch({ anonymous: event.target.checked })} />允许匿名提问（另需<a className="text-primary underline" href="/admin/security">人机校验</a>）</label>
          <div className="space-y-2 text-sm"><label htmlFor="ai-owner-instructions">分身指令</label><textarea id="ai-owner-instructions" name="owner_instructions" rows={6} maxLength={8000} className="w-full rounded-md border border-input bg-background p-3 text-sm" value={draft.instructions} onChange={event => patch({ instructions: event.target.value })} /></div>
          <Button type="button" variant="outline" onClick={() => patch({ instructions: DEFAULT_AVATAR_INSTRUCTIONS })}>恢复默认指令</Button>
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">固定规则（不可编辑）</summary><p className="mt-2 leading-6">{AVATAR_FIXED_POLICY}</p></details>
          <label className="block space-y-2 text-sm">每月生成次数上限（分身、页面、出题与回答预演合计；留空不设上限）<Input name="monthly_limit" type="number" min={0} max={1000000} value={draft.limit} onChange={event => patch({ limit: event.target.value })} /></label>
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold"><FileCodeIcon className="size-4" />自定义页面生成</h2>
          <p className="text-sm text-muted-foreground">使用共享生成连接，系统设计规则由项目维护，不读取分身指令、会话或知识库正文。仅生成可编辑草稿，不自动发布；分身关闭不影响此功能。</p>
          <Link className="text-sm text-primary underline" href="/admin/pages">管理独立页面</Link>
        </section>
        <div className="flex flex-wrap gap-3"><Button type="submit" disabled={!dirty}>{saving ? "正在保存…" : "保存全部 AI 配置"}</Button>
          {view.canMigrate && <Button variant="outline" type="button" disabled={dirty} onClick={() => {
            const data = new FormData(); data.set("revision", view.revision);
            startTransition(async () => { try { update(await migrateLegacyAI(data)); } catch { setMessage("迁移结果未确认，请刷新查看。"); } });
          }}>迁入现有 AI 配置</Button>}</div>
      </fieldset>
      <p role="status" aria-live="polite" className="text-sm">{message}</p>
    </form>
    <section className="space-y-4 rounded-xl border bg-card p-5" aria-label="连接检查">
      <h2 className="font-semibold">检查已保存的连接</h2>
      <p className="text-sm text-muted-foreground">知识库使用本站已发布或暂停的文章及公开问答。可以使用自己的内容，无需导入示例；向量连接检查通过后即可建立索引，生成连接用于之后的分身问答。</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={probeConsent} disabled={pending} onChange={event => setProbeConsent(event.target.checked)} className="mt-1" /><span>允许本次向供应商发送固定合成测试文字。每次检查最多两次请求，可能计费；不读取实际文章、不启用分身、不自动重试。</span></label>
      {dirty && <p className="text-sm text-muted-foreground">有未保存的修改，请先保存；检查只使用已保存的连接。</p>}
      <div className="grid gap-4 sm:grid-cols-2">{(["generation", "embedding"] as const).map(purpose => <div key={purpose} className="min-w-0 space-y-2">
        <Button type="button" variant="outline" aria-busy={checking === purpose} disabled={pending || dirty || !probeConsent || !view[purpose]} onClick={() => check(purpose)}>{checking === purpose ? `正在检查${purpose === "generation" ? "生成" : "向量"}连接…` : `检查${purpose === "generation" ? "生成" : "向量"}连接`}</Button>
        <p role="status" aria-live="polite" className="text-sm">{checkMessages[purpose] || (view[purpose]?.verifiedAt ? `检查通过 · ${new Date(view[purpose]!.verifiedAt!).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : view[purpose] ? "尚未检查。" : "先填写并保存对应连接。")}</p>
      </div>)}</div>
    </section>
    <Button type="button" variant="outline" disabled={pending || dirty || !view.embedding?.verifiedAt} onClick={() => setConfigOpen(false)}>配置已就绪，前往知识库流程</Button>
    {dirty && <p className="text-sm">有未保存的修改，请先保存。</p>}
    </details>
    <KnowledgeIndexPanel settingsRevision={view.revision} onConfigure={openConfiguration} available={!dirty && !!view.embedding?.verifiedAt} disabled={pending || dirty} generationReady={!!view.generation?.verifiedAt} avatarEnabled={view.avatarEnabled} onBusyChange={setKnowledgeBusy} />
  </div>;
}
