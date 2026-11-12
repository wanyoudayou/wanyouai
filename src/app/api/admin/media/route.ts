import { getAdminIdentity } from "@/lib/admin/session";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { readBoundedBody } from "@/lib/publishing/request-body";
import { listMediaAssets, getMediaAsset } from "@/lib/media/repository";
import { prepareMediaUpload, finishMediaUpload } from "@/lib/media/uploads";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MediaLibraryError } from "@/lib/media/types";
export const runtime = "nodejs";
export const maxDuration = 60;
const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  try {
    if (!(await getAdminIdentity()).owner)
      return reply({ message: "需要站主登录。" }, 401);
    return reply(
      await listMediaAssets(
        Object.fromEntries(new URL(request.url).searchParams),
      ),
    );
  } catch {
    return reply({ message: "素材暂时无法读取，请重试。" }, 503);
  }
}
export async function POST(request: Request) {
  try {
    if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL))
      return reply({ message: "请求来源无效。" }, 403);
    const identity = await getAdminIdentity();
    if (!identity.owner || !identity.user)
      return reply({ message: "需要站主登录。" }, 401);
    let data;
    try {
      data = JSON.parse(
        (await readBoundedBody(request, 16384)).toString("utf8"),
      );
    } catch {
      return reply({ message: "请求无效或过大。" }, 422);
    }
    if (data.op === "prepare")
      return reply(await prepareMediaUpload(data, identity.user.id));
    if (typeof data.id !== "string" || !/^[a-f0-9-]{36}$/.test(data.id))
      return reply({ message: "素材标识无效。" }, 422);
    if (data.op === "finish")
      return reply(await finishMediaUpload(data.id, identity.user.id));
    if (data.op === "usage") {
      const db = await createSupabaseServerClient();
      const result = await db.rpc("media_asset_usage", { p_id: data.id });
      if (result.error || !result.data) throw new Error("Usage unavailable");
      return reply(result.data);
    }
    if (data.op === "edit") {
      if (
        typeof data.name !== "string" ||
        !data.name.trim() ||
        data.name.length > 200 ||
        typeof data.alt !== "string" ||
        data.alt.length > 500 ||
        typeof data.archived !== "boolean"
      )
        return reply({ message: "请检查名称与替代文字。" }, 422);
      const db = await createSupabaseServerClient();
      const result = await db
        .from("media_assets")
        .update({
          name: data.name.trim(),
          alt: data.alt,
          archived: data.archived,
        })
        .eq("id", data.id)
        .select("id");
      if (result.error || !result.data?.length)
        throw new Error("Asset update unavailable");
      return reply({ asset: await getMediaAsset(data.id) });
    }
    return reply({ message: "未知操作。" }, 422);
  } catch (error) {
    return reply(
      {
        message:
          error instanceof MediaLibraryError
            ? error.message
            : "素材服务暂时不可用；请保留文件后重试。",
        ...(error instanceof MediaLibraryError && error.code
          ? { code: error.code }
          : {}),
      },
      error instanceof MediaLibraryError ? 422 : 503,
    );
  }
}
