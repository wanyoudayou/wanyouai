export async function filesRequest<T>(body:unknown):Promise<T> {
  const response=await fetch('/api/admin/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok) throw new Error(data.message||'请求失败，请重试。');
  return data as T;
}
export async function fileHash(file:File) {
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
