"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { insertImageText } from "@/lib/importing/paths";
export type Attachment = { name: string; url: string; width: number; height: number };

/** 本篇已上传的图片（点击插入光标处），以及插入外部图片链接。 */
export function AttachmentLibrary({
  items,
  disabled,
  onInsert,
}: {
  items: Attachment[];
  disabled: boolean;
  onInsert: (text: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [message, setMessage] = useState("");
  return (
    <section className="space-y-3" aria-label="本篇图片">
      {items.length > 0 && (
        <>
          <h2 className="text-sm font-medium">本篇图片 · 点击插入光标处</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {items.map((item) => (
              <button
                key={item.url + item.name}
                type="button"
                disabled={disabled}
                title={item.name}
                className="min-w-0 space-y-1 rounded-lg border p-1.5 text-left hover:bg-accent disabled:opacity-50"
                onClick={() =>
                  onInsert(
                    `![${item.name.replace(/[\\\[\]\r\n]/g, " ")}|${item.width}x${item.height}](<${item.url}>)`,
                  )
                }
              >
                {/* Validated uploads use the public media bucket; native image keeps signed/external configuration out of this UI. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt={item.name} className="h-16 w-full object-contain" />
                <span className="block truncate text-xs text-muted-foreground">{item.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">插入外部图片链接</summary>
        <fieldset disabled={disabled} className="mt-3 grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
          <label className="block space-y-2">
            图片 URL
            <Input type="url" value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="block space-y-2">
            替代文本
            <Input value={alt} onChange={(e) => setAlt(e.target.value)} />
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              try {
                onInsert(insertImageText(url, alt));
                setUrl("");
                setAlt("");
                setMessage("");
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            插入到正文
          </Button>
          <p role="status" className="text-sm sm:col-span-3 empty:hidden">
            {message}
          </p>
        </fieldset>
      </details>
    </section>
  );
}
