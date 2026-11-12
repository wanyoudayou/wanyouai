import { readJson } from "@/lib/http-client";

export async function filesRequest<T>(body:unknown):Promise<T> {
  const response=await fetch('/api/admin/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  // 平台超时等非 JSON 错误页也给出中文提示，而不是解析异常。
  return readJson<T>(response,'请求失败或超时，请保留文件后重试。');
}
export async function fileHash(file:File) {
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
