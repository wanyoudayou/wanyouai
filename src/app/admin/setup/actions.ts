"use server";
import { revalidatePath } from "next/cache";
import { publishNextStarterChapter } from "@/lib/starter/server";
export async function initializeStarterStep() {
  try {
    const progress = await publishNextStarterChapter();
    if (progress.completed) revalidatePath("/", "layout");
    return {
      ok: true,
      ...progress,
      message: progress.completed
        ? "收费方案与使用指南已创建并加入侧栏。"
        : `已完成 ${progress.count}/8 篇，继续导入。`,
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const message =
      code === "STARTER_SLUG_CONFLICT"
        ? "已有同名页面、专辑或文章，未覆盖任何内容。请在内容管理中检查 pricing、getting-started 及指南文章标识。"
        : ["STARTER_CONTENT_CHANGED", "STARTER_TEMPLATE_CHANGED"].includes(code)
          ? "模板或已导入内容发生修改，为保护现有编辑已停止。请在专辑和页面中检查已保留的内容。"
          : "本步结果暂时无法确认。内容不会被清空；稍后点击继续会先读取数据库进度。";
    return { ok: false, count: 0, completed: false, message };
  }
}
