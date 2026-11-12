import {
  authenticatePublisher,
  createPublisherStore,
} from "@/lib/publishing/server";
import { prepareImageUpload } from "@/lib/publishing/upload";
import { readBoundedBody } from "@/lib/publishing/request-body";
import { registerMedia } from "@/lib/media/repository";
export const runtime = "nodejs";
const response = (data: object, status: number) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  try {
    if (!(await authenticatePublisher(request)))
      return response({ message: "需要站主登录或有效发布凭据。" }, 401);
    let prepared: Awaited<ReturnType<typeof prepareImageUpload>>;
    try {
      const bytes = await readBoundedBody(request, 12 * 1024 * 1024);
      const form = await new Response(bytes, {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error();
      prepared = await prepareImageUpload(
        new Uint8Array(await file.arrayBuffer()),
        file.type,
        String(form.get("slug") ?? ""),
        String(form.get("source_path") || file.name),
      );
    } catch {
      return response(
        {
          message: "图片请求无效：请检查 slug、图片类型、尺寸及 10 MiB 限制。",
        },
        422,
      );
    }
    const store = createPublisherStore().media;
    await store.upload(
      prepared.media.storage_path,
      prepared.bytes,
      prepared.media.mime_type,
    );
    await registerMedia(
      prepared.media,
      prepared.bytes.byteLength,
      prepared.media.source_path.split("/").pop() || "图片",
    );
    return response(
      {
        media: prepared.media,
        url: store.publicUrl(prepared.media.storage_path),
      },
      200,
    );
  } catch {
    return response({ message: "图片存储暂时不可用，请稍后重试。" }, 500);
  }
}
