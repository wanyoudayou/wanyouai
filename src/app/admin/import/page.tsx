import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {getAdminIdentity} from '@/lib/admin/session';
import {createSupabaseServerClient} from '@/lib/supabase/server';
import {FolderImport} from '@/components/admin/folder-import';
export const metadata:Metadata={title:'文件导入与审核',robots:{index:false,follow:false}};
export default async function ImportPage({searchParams}:{searchParams:Promise<{series?:string}>}) {
  if(!(await getAdminIdentity()).owner)redirect('/admin');
  const db=await createSupabaseServerClient();
  const {data,error}=await db.from('series').select('id,slug,title,type').neq('status','archived').order('title');
  if(error)throw new Error('专辑目录暂不可用');
  const selected=(await searchParams).series;
  const scope=data.some(s=>s.slug===selected)?'series:'+selected:'blog';
  return <div className="mx-auto max-w-5xl space-y-6 px-6 py-10"><Link href="/admin?tab=albums" className="text-sm underline">返回后台</Link><h1 className="text-2xl font-medium">文件导入与审核</h1><FolderImport series={data} initialScope={scope}/></div>;
}
