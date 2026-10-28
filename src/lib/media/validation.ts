import { createHash } from "node:crypto";
import { prepareImageUpload } from "@/lib/publishing/upload";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, MediaLibraryError } from "./types";
export function uploadDescriptor(value: unknown) {
  const data = value as Record<string, unknown> | null;
  if (
    !data ||
    typeof data.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(data.id) ||
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.length > 200 ||
    /[\x00-\x1f]/.test(data.name) ||
    typeof data.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.sha256) ||
    typeof data.mime !== "string" ||
    !IMAGE_ACCEPT.split(",").includes(data.mime) ||
    !Number.isSafeInteger(data.size) ||
    Number(data.size) < 1 ||
    Number(data.size) > MAX_IMAGE_BYTES
  )
    throw new MediaLibraryError(
      "请选择 10 MiB 以内的 PNG、JPEG、WebP、GIF 或 SVG 图片。",
    );
  return {
    id: data.id,
    name: data.name,
    sha256: data.sha256,
    mime: data.mime,
    size: Number(data.size),
  };
}
export async function validateStagedImage(
  bytes: Uint8Array,
  ticket: {
    byte_size: number;
    source_hash: string;
    mime_type: string;
    name: string;
  },
) {
  if (
    bytes.byteLength !== ticket.byte_size ||
    bytes.byteLength > MAX_IMAGE_BYTES
  )
    throw new MediaLibraryError("文件大小与上传记录不一致。");
  if (createHash("sha256").update(bytes).digest("hex") !== ticket.source_hash)
    throw new MediaLibraryError("文件内容与上传记录不一致。");
  try {
    return await prepareImageUpload(
      bytes,
      ticket.mime_type,
      "library",
      ticket.name,
    );
  } catch {
    throw new MediaLibraryError("图片无法安全解码，请换用有效图片。");
  }
}
