"use client";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, type MediaAsset } from "./types";
const attempts = new Map<string, string>();
class MediaRequestError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export async function mediaRequest(data: object) {
  const response = await fetch("/api/admin/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new MediaRequestError(
      result.message || "素材操作失败，请重试。",
      result.code,
    );
  return result;
}
export async function uploadLibraryImage(
  file: File,
  progress: (message: string) => void = () => {},
): Promise<{ asset: MediaAsset; sourceHash: string; uploadId: string }> {
  const mime =
    file.type ||
    (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
        svg: "image/svg+xml",
      } as Record<string, string>
    )[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (
    !IMAGE_ACCEPT.split(",").includes(mime) ||
    !file.size ||
    file.size > MAX_IMAGE_BYTES
  )
    throw new Error("请选择 10 MiB 以内的图片。");
  progress("正在读取图片…");
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const name = file.name.replace(/[\x00-\x1f]/g, "").slice(0, 200) || "图片";
  const key = `${name}:${sha256}`;
  let id = attempts.get(key);
  if (!id) {
    id = crypto.randomUUID();
    attempts.set(key, id);
  }
  let prepared;
  try {
    prepared = await mediaRequest({
      op: "prepare",
      id,
      name,
      mime,
      size: file.size,
      sha256,
    });
  } catch (error) {
    if (error instanceof MediaRequestError && error.code === "UPLOAD_EXPIRED")
      attempts.delete(key);
    throw error;
  }
  if (prepared.asset) return { ...prepared, uploadId: id };
  const signed = new URL(prepared.signedUrl);
  const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (
    signed.origin !== base.origin ||
    !signed.pathname.startsWith("/storage/v1/object/upload/sign/media-uploads/")
  )
    throw new Error("上传地址无效。");
  progress("正在上传 0%…");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signed.toString());
    xhr.timeout = 120000;
    xhr.setRequestHeader("Content-Type", mime);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(
          `正在上传 ${Math.round((event.loaded / event.total) * 100)}%…`,
        );
    };
    // An earlier attempt may have reached Storage after its response was lost.
    xhr.onload = () =>
      (xhr.status >= 200 && xhr.status < 300) || xhr.status === 409
        ? resolve()
        : reject(new Error("上传未完成，请重新选择同一文件重试。"));
    xhr.onerror = xhr.ontimeout = () =>
      reject(new Error("上传连接中断，请重新选择同一文件重试。"));
    xhr.send(new Blob([file], { type: mime }));
  });
  progress("正在校验图片…");
  return { ...(await mediaRequest({ op: "finish", id })), uploadId: id };
}
