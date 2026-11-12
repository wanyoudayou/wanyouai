import { createHash } from "node:crypto";
import sharp from "sharp";
import { resolveMedia, sanitizeSvgSource } from "./media";
import type { Media } from "./types";

const formats: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
export async function prepareImageUpload(bytes: Uint8Array, mime: string, slug: string, sourcePath: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || slug.length > 120) throw new Error("请先填写有效的文章 slug。");
  if (!sourcePath || sourcePath.length > 2048 || /[\r\n<>]/.test(sourcePath)) throw new Error("图片引用路径无效。");
  if (!formats[mime] || bytes.byteLength > 10 * 1024 * 1024) throw new Error("仅支持 10 MiB 以内的图片。");
  const header = Buffer.from(bytes.subarray(0, 12));
  const signatureMatches = mime === "image/svg+xml"
    || (mime === "image/png" && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    || (mime === "image/jpeg" && header[0] === 255 && header[1] === 216 && header[2] === 255)
    || (mime === "image/webp" && header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP")
    || (mime === "image/gif" && ["GIF87a", "GIF89a"].includes(header.subarray(0, 6).toString()));
  if (!signatureMatches) throw new Error("图片类型与文件字节不一致。");
  const metadata = await sharp(mime === "image/svg+xml" ? sanitizeSvgSource(bytes) : bytes, { limitInputPixels: 40_000_000 }).metadata();
  const hash = createHash("sha256").update(bytes).digest("hex");
  let media: Media = { source_path: sourcePath, storage_path: `media/${slug}/${hash}.${formats[mime]}`, sha256: hash, mime_type: mime, width: metadata.width ?? 0, height: metadata.height ?? 0 };
  if (media.width < 1 || media.height < 1 || media.width > 20000 || media.height > 20000) throw new Error("图片尺寸超出范围。");
  let output = bytes;
  const result = await resolveMedia({ client_request_id: "upload", frontmatter: { slug, title: "图片校验", type: "blog", access: "public" }, markdown: "", media: [media] }, {
    download: async () => bytes,
    publicUrl: (path) => `https://media.invalid/${path}`,
    upload: async (path, data, type) => {
      output = data;
      media = { ...media, storage_path: path, sha256: createHash("sha256").update(data).digest("hex"), mime_type: type };
    },
  });
  if (result.diagnostics.some((d) => d.severity === "error")) throw new Error("图片格式或内容无法安全解码。");
  if (output.byteLength > 10 * 1024 * 1024) throw new Error("转换后的图片超过 10 MiB。");
  return { media, bytes: output };
}
