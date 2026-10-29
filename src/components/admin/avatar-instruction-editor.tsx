"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatMarkdown } from "@/components/reading/chat-markdown";
import { DEFAULT_AVATAR_INSTRUCTIONS } from "@/lib/ai/policy";

export function AvatarInstructionEditor({ value, savedValue, onChange, disabled }: {
  value: string; savedValue: string; onChange: (value: string) => void; disabled: boolean;
}) {
  const [mode, setMode] = useState("edit");
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  const [beforeTemplate, setBeforeTemplate] = useState<string | null>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const templateButton = useRef<HTMLButtonElement>(null);
  const usingTemplate = value === DEFAULT_AVATAR_INSTRUCTIONS;
  const loadTemplate = () => {
    if (disabled) return;
    setBeforeTemplate(value);
    onChange(DEFAULT_AVATAR_INSTRUCTIONS);
    setConfirmTemplate(false);
    setMode("edit");
    requestAnimationFrame(() => source.current?.focus());
  };
  return <div role="group" aria-label="分身指令编辑器" className="min-w-0 space-y-3 text-sm">
    <label htmlFor="ai-owner-instructions" className="font-medium">分身指令</label>
    <p id="ai-instructions-help" className="text-muted-foreground">用 Markdown 的标题、列表和强调组织角色、语气与引导规则。保存的是原文；切换预览不修改内容、不调用模型。不要填写密钥或私密资料。</p>
    {/* The source tab unmounts during preview; form submission always keeps the raw text. */}
    <input type="hidden" name="owner_instructions" value={value} />
    <Tabs value={mode} onValueChange={setMode}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList aria-label="分身指令视图">
          <TabsTrigger value="edit" disabled={disabled}>编辑</TabsTrigger>
          <TabsTrigger value="preview" disabled={disabled}>预览</TabsTrigger>
        </TabsList>
        <Button ref={templateButton} type="button" variant="outline" size="sm" disabled={disabled || usingTemplate || confirmTemplate} onClick={() => {
          if (value.trim()) setConfirmTemplate(true); else loadTemplate();
        }}>载入推荐模板</Button>
      </div>
      <TabsContent value="edit">
        <textarea ref={source} id="ai-owner-instructions" rows={16} maxLength={8000} disabled={disabled}
          aria-describedby="ai-instructions-help ai-instructions-count"
          className="min-h-72 w-full resize-y rounded-lg border border-input bg-background p-3 font-mono text-sm leading-7 focus-visible:outline-2 focus-visible:outline-ring"
          value={value} onChange={event => onChange(event.target.value)} />
      </TabsContent>
      <TabsContent value="preview">
        <div role="region" aria-label="分身指令预览" className="max-h-96 min-h-72 min-w-0 overflow-y-auto rounded-lg border border-input bg-background p-4 [overflow-wrap:anywhere]">
          {value.trim() ? <ChatMarkdown markdown={value} allowImages={false} /> : <p className="text-muted-foreground">尚无指令。可以载入推荐模板，或返回编辑填写。</p>}
        </div>
      </TabsContent>
    </Tabs>
    <p id="ai-instructions-count" className="text-xs text-muted-foreground">{value.length.toLocaleString("zh-CN")} / 8,000 字符 · {value === savedValue ? "与已保存内容一致" : "尚未保存，点击下方“保存全部 AI 配置”后生效"}</p>
    {confirmTemplate && <div role="group" aria-label="确认替换分身指令" className="space-y-3 rounded-lg border bg-muted/40 p-3">
      <p>载入推荐模板会替换编辑框内的全部指令，包括尚未保存的修改。替换后仍需点击“保存全部 AI 配置”才会生效。</p>
      <p className="text-muted-foreground">模板包含角色、职责、表达方式、资料不足处理、业务引导和来源规则，可在下方展开查看。</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={disabled} onClick={loadTemplate}>替换当前指令</Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => {
          setConfirmTemplate(false);
          requestAnimationFrame(() => templateButton.current?.focus());
        }}>保留当前指令</Button>
      </div>
    </div>}
    {beforeTemplate !== null && usingTemplate && <div className="flex flex-wrap items-center gap-2" role="status">
      <span>{value === savedValue ? "当前模板指令已保存。" : "推荐模板已载入当前草稿，保存后生效。"}</span>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => {
        onChange(beforeTemplate); setBeforeTemplate(null); setMode("edit");
        requestAnimationFrame(() => source.current?.focus());
      }}>撤销载入</Button>
    </div>}
    <details>
      <summary className="cursor-pointer text-muted-foreground">查看推荐模板</summary>
      <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 font-mono text-xs leading-6">{DEFAULT_AVATAR_INSTRUCTIONS}</pre>
    </details>
    <p className="text-xs text-muted-foreground">指令可调整回答方式，不能新增工具、改变权限或替代知识库。固定规则由系统另行附加。</p>
  </div>;
}
