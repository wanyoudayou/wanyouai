"use client";
import { useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";
import { Button } from "@/components/ui/button";
import { paywallEdit } from "@/lib/admin/paywall-edit";
import { basicSetup } from "codemirror";

export default function MarkdownEditor({ value, onChange, disabled, onImage, onPaywall, insertRequest }: { value: string; onChange: (value: string) => void; disabled: boolean; onImage: (file: File) => Promise<void>; onPaywall: () => void; insertRequest?: { id: string; text: string } }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onImage, onPaywall });
  const editable = useRef(new Compartment());
  function insertPaywall(editor = view.current) {
    if (!editor || editor.state.readOnly) return false;
    const edit = paywallEdit(editor.state.doc.toString(), editor.state.selection.main.head);
    if ("existing" in edit) editor.dispatch({ selection: { anchor: edit.existing }, scrollIntoView: true });
    else editor.dispatch({ changes: { from: edit.at, insert: edit.insert }, selection: { anchor: edit.anchor }, scrollIntoView: true });
    editor.focus();
    callbacks.current.onPaywall();
    return true;
  }
  useEffect(() => { callbacks.current = { onChange, onImage, onPaywall }; }, [onChange, onImage, onPaywall]);
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({ parent: host.current, extensions: [
      basicSetup, markdown(), EditorView.lineWrapping,
      syntaxHighlighting(HighlightStyle.define([
        { tag: tags.heading, color: "var(--foreground)", fontWeight: "600" },
        { tag: tags.comment, color: "var(--primary)", backgroundColor: "var(--accent)" },
        { tag: [tags.link, tags.url, tags.keyword], color: "var(--primary)" },
        { tag: [tags.string, tags.number, tags.meta], color: "var(--foreground)" },
        { tag: tags.emphasis, fontStyle: "italic" },
        { tag: tags.strong, fontWeight: "600" },
      ])),
      editable.current.of(EditorView.editable.of(true)),
      EditorView.contentAttributes.of({ "aria-label": "Markdown 正文", spellcheck: "false" }),
      EditorView.updateListener.of((update) => { if (update.docChanged) callbacks.current.onChange(update.state.doc.toString()); }),
      keymap.of([{ key: "Mod-Shift-p", run: (editor) => insertPaywall(editor), preventDefault: true }, { key: "Mod-s", run: () => true }]),
      EditorView.domEventHandlers({ drop(event) {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        event.preventDefault();
        if (editor.contentDOM.contentEditable === "true") void callbacks.current.onImage(files[0]);
        return true;
      } }),
      EditorView.theme({ "&": { color: "var(--foreground)", backgroundColor: "var(--background)" }, ".cm-content": { minHeight: "24rem", fontFamily: "var(--font-mono)" }, ".cm-scroller": { overflow: "auto" }, ".cm-gutters": { backgroundColor: "var(--muted)", color: "var(--muted-foreground)", border: "none" }, ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--accent)" }, "&.cm-focused": { outline: "2px solid var(--ring)" } }),
    ] });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure([EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)]) }); }, [disabled]);
  useEffect(() => {
    const editor=view.current;
    if(!editor || !insertRequest || editor.state.readOnly) return;
    const {from,to}=editor.state.selection.main;
    editor.dispatch({changes:{from,to,insert:insertRequest.text},selection:{anchor:from+insertRequest.text.length},scrollIntoView:true});
    editor.focus();
  },[insertRequest]);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => insertPaywall()}>插入付费切点</Button><span className="text-xs text-muted-foreground">⌘ / Ctrl + Shift + P</span></div>
    <div ref={host} className="min-w-0 overflow-hidden rounded-lg border text-sm" />
  </div>;
}
