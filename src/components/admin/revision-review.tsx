"use client";
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {filesRequest} from '@/lib/importing/client';
import {PreviewPane} from './preview-pane';
import {PublicationFeedback} from './publication-feedback';
import type {PublishInput,PublishResponse} from '@/lib/publishing/types';
type Review={id:number;path:string;version:number;snapshot:Omit<PublishInput,'client_request_id'>;preview:string;publication:PublishResponse|null};
export function RevisionReview({id,autoLoad,onPublished,readOnly=false}:{id:number;autoLoad?:boolean;onPublished:()=>void;readOnly?:boolean}) {
  const [review,setReview]=useState<Review|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [result,setResult]=useState<PublishResponse|null>(null);
  useEffect(()=>{
    if(!autoLoad)return;
    let alive=true;
    const run=async()=>{setBusy(true);setReview(null);try{const data=await filesRequest<Review>({op:'review',id});if(alive){setMessage('');setReview(data);}}catch(e){if(alive)setMessage((e as Error).message);}finally{if(alive)setBusy(false);}};
    const timer=setTimeout(run,0);
    return ()=>{alive=false;clearTimeout(timer);};
  },[autoLoad,id]);
  async function publish(){setBusy(true);try{const r=await filesRequest<PublishResponse>({op:'publish',id});setResult(r);if(r.status!=='blocked'){setMessage('已发布，线上内容已更新。');onPublished();}}catch(e){setMessage((e as Error).message+' 可重试原修订，不会重复创建版本。');}finally{setBusy(false);}}
  return <div className="-m-5 flex h-full flex-col">
    <section className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" aria-label="修订审核">
      {review ? <><h2 className="break-all font-medium">{review.path} · 修订 {review.version}</h2><p className="text-sm">{review.snapshot.frontmatter.title} · {review.snapshot.frontmatter.access}</p><details><summary className="cursor-pointer">查看待发布原文</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">{review.snapshot.markdown}</pre></details><PreviewPane markdown={review.preview} access={review.snapshot.frontmatter.access} disabled={busy} onRestrict={()=>setMessage('请在导入文件中修改阅读权限后重新导入。')} /></> : <p className="text-sm text-muted-foreground">{busy?'正在加载预览与原文…':'未加载修订。'}</p>}
      <PublicationFeedback result={result} message={message}/>
    </section>
    <div className="shrink-0 border-t bg-background p-5 pt-3">
      {review && <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href={`/admin/content?revision=${review.id}`}>编辑此修订</Link></Button>
        {!readOnly && <Button disabled={busy||!!review.publication||!!result?.article} onClick={publish}>{review.publication?'此修订已发布':busy?'正在处理…':'确认发布此修订'}</Button>}
      </div>}
    </div>
  </div>;
}
