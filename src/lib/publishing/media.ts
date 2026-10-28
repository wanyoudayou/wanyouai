import { createHash } from "node:crypto";
import sharp from "sharp";
import sanitizeHtml from "sanitize-html";
import { inspectMarkdown } from "./markdown";
import {
  diagnostic,
  type PublishInput,
  type Diagnostic,
  type Media,
} from "./types";
import { canonicalMediaPath, isLegacySupabaseMediaUrl } from "./media-url";

export type MediaStore = {
  download(path: string): Promise<Uint8Array | null>;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  publicUrl(path: string): string;
  lookup?(paths: string[]): Promise<Media[]>;
};
const formats: Record<string, { ext: string; format: string }> = {
  "image/png": { ext: "png", format: "png" },
  "image/jpeg": { ext: "jpg", format: "jpeg" },
  "image/webp": { ext: "webp", format: "webp" },
  "image/gif": { ext: "gif", format: "gif" },
  "image/svg+xml": { ext: "svg", format: "svg" },
};
export async function resolveMedia(input: PublishInput, store: MediaStore) {
  const diagnostics: Diagnostic[] = [];
  const urls = new Map<string, string>();
  const verifiedPaths = new Map<string, string>();
  const seen = new Set<string>();
  const images = inspectMarkdown(
    input.markdown,
    input.frontmatter.access,
  ).images;
  const localPaths = [
    ...new Set(
      [...images.map((image) => image.url), input.frontmatter.cover ?? ""]
        .map(canonicalMediaPath)
        .filter((path): path is string => !!path),
    ),
  ];
  if (localPaths.length > 100)
    return {
      markdown: input.markdown,
      cover: input.frontmatter.cover ?? null,
      diagnostics: [
        diagnostic(
          "SCHEMA_INVALID",
          "每篇最多引用 100 张素材库图片。",
          "/media",
        ),
      ],
    };
  const registry = new Map(
    (
      (await store.lookup?.([
        ...new Set([
          ...localPaths,
          ...input.media.map((item) => item.storage_path),
        ]),
      ])) ?? []
    ).map((item) => [item.storage_path, item]),
  );
  const suppliedPaths = new Set(input.media.map((item) => item.storage_path));
  const candidates = [
    ...input.media,
    ...localPaths
      .filter((path) => !suppliedPaths.has(path) && registry.has(path))
      .map((path) => ({
        ...registry.get(path)!,
        source_path: store.publicUrl(path),
      })),
  ];
  for (const [index, media] of candidates.entries()) {
    const path = `/media/${index}`;
    const format = formats[media.mime_type];
    if (!format) {
      diagnostics.push(
        diagnostic("MEDIA_TYPE_BLOCKED", "只支持图片媒体。", path),
      );
      continue;
    }
    const registered = registry.get(media.storage_path);
    const shared =
      registered &&
      ["sha256", "mime_type", "width", "height"].every(
        (key) => registered[key as keyof Media] === media[key as keyof Media],
      );
    if (
      seen.has(media.source_path) ||
      (!shared &&
        media.storage_path !==
          `media/${input.frontmatter.slug}/${media.sha256}.${format.ext}`)
    ) {
      diagnostics.push(
        diagnostic(
          "SCHEMA_INVALID",
          "图片源路径必须唯一，存储路径必须与 slug、hash 和类型一致。",
          path,
        ),
      );
      continue;
    }
    seen.add(media.source_path);
    const bytes = await store.download(media.storage_path);
    if (!bytes) {
      diagnostics.push(diagnostic("MEDIA_MISSING", "存储对象不存在。", path));
      continue;
    }
    if (bytes.byteLength > 10 * 1024 * 1024) {
      diagnostics.push(
        diagnostic("MEDIA_TYPE_BLOCKED", "单张图片不能超过 10 MiB。", path),
      );
      continue;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== media.sha256) {
      diagnostics.push(
        diagnostic("MEDIA_HASH_MISMATCH", "图片字节与声明 hash 不一致。", path),
      );
      continue;
    }
    let finalPath = media.storage_path;
    let converted: Buffer | undefined;
    try {
      let safeBytes = bytes;
      if (format.format === "svg") {
        // Remove external resources and active content before invoking the SVG decoder.
        safeBytes = sanitizeSvgSource(bytes);
      }
      const decoder = sharp(safeBytes, { limitInputPixels: 40_000_000 });
      const metadata = await decoder.metadata();
      if (
        metadata.format !== format.format ||
        metadata.width !== media.width ||
        metadata.height !== media.height
      ) {
        diagnostics.push(
          diagnostic(
            "SCHEMA_INVALID",
            "图片实际格式或尺寸与清单不一致。",
            path,
          ),
        );
        continue;
      }
      // Fully decode, rather than trusting a file header or supplied MIME type.
      const png = await decoder.png().toBuffer();
      if (format.format === "svg") {
        const hash = createHash("sha256").update(png).digest("hex");
        finalPath = `media/${input.frontmatter.slug}/${hash}.png`;
        converted = png;
      }
    } catch {
      diagnostics.push(
        diagnostic("MEDIA_TYPE_BLOCKED", "图片无法安全解码。", path),
      );
      continue;
    }
    if (converted) await store.upload(finalPath, converted, "image/png");
    const finalUrl = store.publicUrl(finalPath);
    urls.set(media.source_path, finalUrl);
    urls.set(store.publicUrl(media.storage_path), finalUrl);
    verifiedPaths.set(media.storage_path, finalUrl);
  }
  function resolve(url: string, path: string) {
    if (urls.has(url)) return urls.get(url)!;
    if (/^https:\/\//i.test(url)) {
      for (const [storagePath, currentUrl] of verifiedPaths) {
        if (isLegacySupabaseMediaUrl(url, storagePath)) return currentUrl;
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        diagnostics.push(diagnostic("SCHEMA_INVALID", "图片 URL 无效。", path));
        return url;
      }
      if (
        parsed.username ||
        parsed.password ||
        /\.(svg|pdf|mp4|mp3|webm|wav|ogg|mov)(?:$)/i.test(parsed.pathname)
      ) {
        diagnostics.push(
          diagnostic(
            "MEDIA_TYPE_BLOCKED",
            "外部图片必须是安全的 HTTPS 位图地址。",
            path,
          ),
        );
        return url;
      }
      // Never fetch arbitrary URLs with service credentials or from the server network.
      diagnostics.push(
        diagnostic(
          "EXTERNAL_IMAGE",
          "外链图片未本地化，未验证其可达性。",
          path,
          "warning",
        ),
      );
      return url;
    }
    diagnostics.push(
      diagnostic("MEDIA_MISSING", "图片缺少已验证的媒体清单项。", path),
    );
    return url;
  }
  let markdown = input.markdown;
  for (const image of inspectMarkdown(
    markdown,
    input.frontmatter.access,
  ).images.reverse()) {
    const url = resolve(image.url, "/markdown");
    const alt = image.alt.replace(/[\\\[\]\r\n]/g, " ");
    markdown =
      markdown.slice(0, image.start) +
      `![${alt}](<${url.replace(/[<>\r\n]/g, "")}>)` +
      markdown.slice(image.end);
  }
  const cover = input.frontmatter.cover
    ? resolve(input.frontmatter.cover, "/frontmatter/cover")
    : null;
  return { markdown, cover, diagnostics };
}
export type { Media };

export function sanitizeSvgSource(bytes: Uint8Array) {
  const svg = sanitizeHtml(Buffer.from(bytes).toString("utf8"), {
    allowedTags: [
      "svg",
      "g",
      "path",
      "rect",
      "circle",
      "ellipse",
      "line",
      "polyline",
      "polygon",
      "title",
      "desc",
    ],
    allowedAttributes: {
      "*": [
        "viewBox",
        "xmlns",
        "width",
        "height",
        "d",
        "x",
        "y",
        "x1",
        "x2",
        "y1",
        "y2",
        "cx",
        "cy",
        "r",
        "rx",
        "ry",
        "points",
        "fill",
        "stroke",
        "stroke-width",
        "transform",
        "opacity",
      ],
    },
    parser: { lowerCaseAttributeNames: false },
    transformTags: {
      "*": (tagName, attribs) => ({
        tagName,
        attribs: Object.fromEntries(
          Object.entries(attribs).filter(
            ([key, value]) =>
              !["fill", "stroke"].includes(key) ||
              /^(?:none|transparent|currentColor|#[a-fA-F0-9]{3,8}|[a-zA-Z]+)$/.test(
                value,
              ),
          ),
        ),
      }),
    },
  });
  return Buffer.from(svg);
}
