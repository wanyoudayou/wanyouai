"use client";
import { useState, type InputHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { skillFolderFiles, packageFolder, skillRequest, uploadSkill } from "@/lib/skills/client";
import type { SkillSettings, SkillRelease } from "@/lib/skills/types";
import { useUnsavedChanges } from "./use-unsaved-changes";

type Releases = { items: SkillRelease[]; total: number; page: number };
export function SkillManager({ initial, initialReleases, currentRelease }: { initial: SkillSettings; initialReleases: Releases; currentRelease?: SkillRelease | null }) {
  const [settings, setSettings] = useState(initial); const [saved, setSaved] = useState(JSON.stringify(initial));
  const [releases, setReleases] = useState(initialReleases);
  const [knownReleases, setKnownReleases] = useState(currentRelease ? [...initialReleases.items.filter(r => r.id !== currentRelease.id), currentRelease] : initialReleases.items); const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState<ReturnType<typeof skillFolderFiles> | null>(null);
  const [version, setVersion] = useState(""); const [notes, setNotes] = useState("");
  const [attempt, setAttempt] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  useUnsavedChanges(saved !== JSON.stringify(settings));
  async function refresh(page = releases.page) {
    const response = await fetch(`/api/admin/skills?id=${initial.id}&page=${page}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.message);
    setReleases(result.releases);
    setKnownReleases(rows => [...rows.filter(r => !result.releases.items.some((next: SkillRelease) => next.id === r.id)), ...result.releases.items]);
  }
  async function run(action: () => Promise<void>) { setBusy(true); setMessage(""); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作未完成。"); } finally { setBusy(false); } }
  function selectFiles(files: File[], isFolder: boolean) {
    setMessage(""); setAttempt(null); setFile(null); setFolder(null);
    try { if (isFolder) setFolder(skillFolderFiles(files)); else setFile(files[0] ?? null); }
    catch (error) { setMessage(error instanceof Error ? error.message : "文件无法读取。"); }
  }
  const selected = knownReleases.find(r => r.id === settings.current_release);
  return <div className="space-y-6"><section className="bg-card space-y-4 rounded-xl border p-5"><h2 className="text-lg font-semibold">1. 上传私有版本包</h2>
    <p className="text-sm text-muted-foreground">选择包含 SKILL.md 的 ZIP 或文件夹。包内可有脚本和附件；网站只支持文本对话，不运行脚本。ZIP 上限 20 MiB，解压上限 50 MiB，最多 500 个文件。</p>
    <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm">ZIP 文件<Input type="file" accept=".zip,application/zip" disabled={busy || !!attempt} onChange={e => selectFiles(Array.from(e.target.files ?? []), false)} /></label>
      <label className="space-y-2 text-sm">或选择文件夹<Input type="file" multiple {...({ webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>)} disabled={busy || !!attempt} onChange={e => selectFiles(Array.from(e.target.files ?? []), true)} /></label></div>
    {file && <p className="text-sm">{file.name} · {(file.size / 1048576).toFixed(2)} MiB</p>}
    {folder && <details open><summary className="text-sm">包含 {folder.included.length} 个文件，排除 {folder.excluded.length} 个文件</summary><div className="max-h-48 overflow-auto text-xs"><ul>{folder.included.map(f => <li key={f.path}>{f.path}</li>)}</ul>{folder.excluded.length > 0 && <p className="mt-3">已排除：{folder.excluded.join("、")}</p>}</div></details>}
    <label className="block space-y-2 text-sm">版本号（发布后不可覆盖）<Input value={version} disabled={busy || !!attempt} onChange={e => setVersion(e.target.value)} placeholder="例如 1.0.0" maxLength={64} /></label>
    <label className="block space-y-2 text-sm">更新说明<textarea className="min-h-24 w-full rounded-md border bg-background p-3" value={notes} disabled={busy || !!attempt} onChange={e => setNotes(e.target.value)} maxLength={8000} /></label>
    <div className="flex flex-wrap gap-3"><Button disabled={busy || !!attempt || (!file && !folder) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(version)} onClick={() => run(async () => {
      const source = file ?? await packageFolder(folder!.included); setFile(source);
      const id = crypto.randomUUID(); setAttempt(id);
      const release = await uploadSkill(source, { id, skillId: initial.id, version, notes }, setMessage);
      setAttempt(null); setMessage(`版本 ${release.version} 已保存。请在第 2 步选择并保存当前版本。`); await refresh(1);
    })}>上传并校验</Button>
    {attempt && <><Button variant="outline" disabled={busy} onClick={() => run(async () => { const result = await skillRequest({ op: "finish", id: attempt }); setAttempt(null); await refresh(1); setMessage(`版本 ${result.release.version} 已保存，请选择当前版本。`); })}>查询并确认本次上传</Button><Button variant="ghost" disabled={busy} onClick={() => { setAttempt(null); setMessage("可重新选择文件；未完成的暂存文件不会作为已发布版本使用。"); }}>结束本次上传</Button></>}
    </div></section>
    <section className="bg-card space-y-4 rounded-xl border p-5"><h2 className="text-lg font-semibold">2. 选择交付版本与使用方式</h2>
      <label className="block space-y-2 text-sm">当前版本<select className="h-10 w-full rounded-md border bg-background px-3" value={settings.current_release ?? ""} disabled={busy} onChange={e => setSettings({ ...settings, current_release: e.target.value || null, online_enabled: false })}><option value="">尚未选择（不显示购买或下载）</option>{settings.current_release && !releases.items.some(r => r.id === settings.current_release) && <option value={settings.current_release}>{selected?.version ?? "已选版本"}（在其他页）</option>}{releases.items.map(r => <option key={r.id} value={r.id}>{r.version}</option>)}</select></label>
      <label className="block space-y-2 text-sm">购买价格（元，0 为登录后免费使用）<Input type="number" min="0" max="999999.99" step="0.01" value={settings.price} disabled={busy} onChange={e => setSettings({ ...settings, price: Number(e.target.value) })} /></label>
      <label className="block space-y-2 text-sm">使用引导<textarea aria-label="使用引导" className="min-h-24 w-full rounded-md border bg-background p-3" maxLength={8000} disabled={busy} value={settings.usage_guide} onChange={e => setSettings({ ...settings, usage_guide: e.target.value })} placeholder="说明用途、用户需要提供的信息以及输出形式。" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={settings.online_enabled} disabled={busy || !selected?.online_eligible} onChange={e => setSettings({ ...settings, online_enabled: e.target.checked })} />启用在线文本对话（使用后台 AI 设置中的模型连接；不要求全站知识库）</label>
      {selected && !selected.online_eligible && <p className="text-sm text-muted-foreground">此版本的 SKILL.md 超过在线读取上限，可正常下载；请精简核心指令后上传新版本再启用对话。</p>}
      <Button disabled={busy || saved === JSON.stringify(settings)} onClick={() => run(async () => { const result = await skillRequest({ op: "save", ...settings }); const next = { ...settings, revision: result.revision }; setSettings(next); setSaved(JSON.stringify(next)); setMessage("当前版本与使用配置已保存。"); })}>保存使用配置</Button>
    </section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">版本记录</h2>{releases.items.map(r => <details className="rounded-lg border p-4" key={r.id}><summary>{r.version} · {(r.byte_size / 1048576).toFixed(2)} MiB · {r.manifest.length} 个文件</summary><p className="mt-3 whitespace-pre-wrap text-sm">{r.notes || "未填写更新说明。"}</p><p className="mt-2 break-all text-xs">SHA-256：{r.package_sha256}</p><ul className="mt-3 max-h-48 overflow-auto text-xs">{r.manifest.map(f => <li key={f.path}>{f.path} · {f.size} 字节{f.text ? " · 可供在线读取" : " · 下载附件"}</li>)}</ul></details>)}
      {!releases.total && <p className="text-sm text-muted-foreground">尚无版本。完成上传后在这里查看文件清单。</p>}
      <div className="flex items-center gap-3"><Button variant="outline" disabled={busy || releases.page <= 1} onClick={() => run(() => refresh(releases.page - 1))}>上一页</Button><span className="text-sm">共 {releases.total} 个版本</span><Button variant="outline" disabled={busy || releases.page * 20 >= releases.total} onClick={() => run(() => refresh(releases.page + 1))}>下一页</Button></div>
    </section><details className="rounded-lg border p-4"><summary>暂存文件维护</summary><p className="my-3 text-sm text-muted-foreground">只清理超过有效期一小时、尚未发布的上传文件，每次最多 10 项。已发布版本和历史交付不会删除。</p><Button variant="outline" disabled={busy} onClick={() => run(async () => { const result = await skillRequest({ op: "cleanup", id: initial.id }); setMessage(`已清理 ${result.removed} 项过期上传。`); })}>清理过期上传</Button></details><p aria-live="polite" role="status" className="whitespace-pre-wrap text-sm">{busy ? "处理中 · " : ""}{message}</p>
  </div>;
}
