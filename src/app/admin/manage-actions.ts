"use server";
import {
  reviseArticle,
  ArticleRevisionError,
} from "@/lib/admin/article-revision";
import { sendPauseNotice } from "@/lib/admin/pause-notice";
import { revalidatePath } from "next/cache";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseSeriesInput } from "@/lib/admin/series-input";

function refreshContent() {
  revalidatePath("/", "layout");
}
export async function createSeries(
  _previous: { message: string; ok: boolean },
  form: FormData,
) {
  try {
    if (!(await getAdminIdentity()).owner)
      return { ok: false, message: "需要站主身份" };
    let input;
    try {
      input = parseSeriesInput(form);
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("series")
      .insert(input)
      .select("id")
      .single();
    if (error)
      return {
        ok: false,
        message:
          error.code === "23505"
            ? "此网址标识已存在，请查看已有专辑或换一个标识。"
            : "创建失败，请稍后重试。",
      };
    refreshContent();
    return {
      ok: true,
      id: Number(data.id),
      message:
        input.type === "event"
          ? "活动专辑已创建。请在「专辑」页对此专辑点「操作」：先展开「活动详情（时间 / 地点 / 票价）」保存详情，再发布公开 README 并上架；活动文档可在「文件导入与审核」批量导入。"
          : "草稿专辑已创建。请在「专辑」页对此专辑点「操作」，发布公开 README 并上架；章节文档可在「文件导入与审核」批量导入。",
    };
  } catch {
    return { ok: false, message: "创建服务暂时不可用，请稍后重试。" };
  }
}
export async function manageContent(
  _previous: { message: string; ok: boolean },
  form: FormData,
) {
  try {
    if (!(await getAdminIdentity()).owner)
      return { ok: false, message: "需要站主身份" };
    const kind = form.get("kind"),
      id = String(form.get("id") ?? ""),
      updated = String(form.get("updated") ?? "");
    const action = form.get("action"),
      value = form.get("value");
    if (
      !["article", "series"].includes(String(kind)) ||
      !/^\d+$/.test(id) ||
      !Number.isFinite(Date.parse(updated)) ||
      !["status", "readme", "featured", "price", "version"].includes(
        String(action),
      ) ||
      typeof value !== "string" ||
      value.length > 120
    )
      return { ok: false, message: "操作参数无效，请刷新后重试" };
    const client = await createSupabaseServerClient();
    if (kind === "article" && (action === "price" || action === "version")) {
      const requestId = String(form.get("request_id") ?? "");
      if (
        !/^[0-9a-f-]{36}$/i.test(requestId) ||
        (action === "price"
          ? !/^\d{1,6}(\.\d{1,2})?$/.test(value) || Number(value) <= 0
          : !/^[1-9]\d{0,8}$/.test(value))
      )
        return { ok: false, message: "价格或版本参数无效。" };
      try {
        const result = await reviseArticle(
          id,
          updated,
          requestId,
          action === "price"
            ? { price: Number(value) }
            : { version: Number(value) },
        );
        if (result.status !== "blocked") refreshContent();
        return {
          ok: result.status !== "blocked",
          message:
            result.status === "blocked"
              ? result.diagnostics.map((d) => d.message).join("；")
              : `已保存为版本 ${result.article?.version}。${result.diagnostics.map((d) => d.message).join("；")}`,
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof ArticleRevisionError
              ? error.message
              : "操作未完成，请刷新确认状态后重试。",
        };
      }
    }
    const { data, error } = await client.rpc("manage_content", {
      p_kind: kind,
      p_id: id,
      p_expected_updated_at: updated,
      p_action: action,
      p_value: value,
      p_archive_notice: form.get("archive_notice") === "on",
    });
    if (error)
      return {
        ok: false,
        message: "操作暂时不可用，请确认后台数据库升级已完成后重试。",
      };
    if (
      !data ||
      typeof data.ok !== "boolean" ||
      typeof data.message !== "string"
    )
      return { ok: false, message: "操作结果异常，请刷新确认内容状态。" };
    if (data.ok) refreshContent();
    let message = data.message as string;
    if (data.ok && String(action) === "status" && String(value) === "paused") {
      // 停售即通知：向直接购买者发送停售邮件（含 3 个月权益保留期）；归档静默。
      try {
        const notice = await sendPauseNotice(
          kind as "article" | "series",
          Number(id),
        );
        if (notice.notified > 0)
          message += `；已向 ${notice.notified} 位付费购买者发送停售通知（权益保留 3 个月）`;
        else if (notice.alreadySent) message += "；今日停售通知已发送过";
        else if (!notice.mailerConfigured)
          message += "；未配置邮件服务，未发送停售通知（可自行站外告知）";
      } catch (noticeError) {
        console.error("[mail] 停售通知流程异常", noticeError);
        message += "；停售通知发送失败，请自行通知付费购买者";
      }
    }
    return { ok: data.ok as boolean, message };
  } catch {
    return { ok: false, message: "操作中断，请刷新确认内容状态后重试。" };
  }
}

export async function saveEventDetails(
  _previous: { ok: boolean; message: string },
  form: FormData,
) {
  try {
    if (!(await getAdminIdentity()).owner)
      return { ok: false, message: "需要站主身份" };
    const id = String(form.get("id") ?? ""),
      updated = String(form.get("updated") ?? "");
    const startsAt = String(form.get("starts_at") ?? "");
    if (
      !/^\d+$/.test(id) ||
      !Number.isFinite(Date.parse(updated)) ||
      !Number.isFinite(Date.parse(startsAt)) ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(startsAt)
    )
      return {
        ok: false,
        message: "请填写带时区的有效活动时间，例如 2026-10-01T14:00:00+08:00。",
      };
    const details = Object.fromEntries(
      [
        "location_text",
        "registration",
        "capacity",
        "kind",
        "ticket_price",
        "state",
      ].map((key) => [key, String(form.get(key) ?? "").trim()]),
    );
    if (JSON.stringify(details).length > 6000)
      return { ok: false, message: "活动说明过长。" };
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("save_event_details", {
      p_id: id,
      p_expected_updated_at: updated,
      p_details: { ...details, starts_at: new Date(startsAt).toISOString() },
    });
    if (error || !data)
      return { ok: false, message: "保存失败，请确认数据库升级已完成后重试。" };
    if (data.ok) refreshContent();
    return { ok: data.ok === true, message: String(data.message) };
  } catch {
    return { ok: false, message: "保存中断，请刷新确认状态后重试。" };
  }
}
