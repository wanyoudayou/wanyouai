"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {insertImageText} from '@/lib/importing/paths';
export type Attachment={name:string;url:string;width:number;height:number};
export function AttachmentLibrary({items,disabled,onInsert}:{items:Attachment[];disabled:boolean;onInsert:(text:string)=>void}) {
  const [external,setExternal]=useState(false);
  const [url,setUrl]=useState('');
  const [alt,setAlt]=useState('');
  const [message,setMessage]=useState('');
  return <section className="space-y-3" aria-label="附件库"><h2 className="font-medium">附件库</h2><p className="text-xs text-muted-foreground">点击已上传的图片，插入正文光标位置。图片公开可访问。</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{items.map(item=><button key={item.url+item.name} type="button" disabled={disabled} className="min-w-0 space-y-2 rounded-lg border p-2 text-left hover:bg-accent disabled:opacity-50" onClick={()=>onInsert(`![${item.name.replace(/[\\\[\]\r\n]/g,' ')}|${item.width}x${item.height}](<${item.url}>)`)}>
    {/* Validated uploads use the public media bucket; native image keeps signed/external configuration out of this UI. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={item.url} alt={item.name} className="h-24 w-full object-contain"/><span className="block break-all text-xs">{item.name} · 点击插入</span></button>)}</div>{!items.length && <p className="text-sm text-muted-foreground">上传图片后会显示在这里。</p>}<Button type="button" variant="outline" disabled={disabled} onClick={()=>setExternal(!external)}>插入外部图片</Button>{external && <fieldset disabled={disabled} className="space-y-3 rounded-md border p-3"><label className="block space-y-2 text-sm">图片 URL<Input type="url" value={url} placeholder="https://…" onChange={e=>setUrl(e.target.value)}/></label><label className="block space-y-2 text-sm">替代文本<Input value={alt} onChange={e=>setAlt(e.target.value)}/></label><Button type="button" onClick={()=>{try{onInsert(insertImageText(url,alt));setExternal(false);setMessage('');}catch(e){setMessage((e as Error).message);}}}>插入到正文</Button><p role="status" className="text-sm">{message}</p></fieldset>}</section>;
}
