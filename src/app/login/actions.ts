"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { userCallbackUrl, validUserEmail } from "@/lib/account/auth-flow";

export async function requestUserLink(_previous: { message: string }, form: FormData) {
  const email = form.get("email");
  if (!validUserEmail(email)) return { message: "请输入有效邮箱。" };
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: userCallbackUrl(process.env.SITE_URL), shouldCreateUser: true } });
    if (error) return { message: "暂时无法发送登录邮件，请稍后重试。" };
    return { message: `登录邮件已发送至 ${email.trim()}。请按邮件内容输入验证码或打开登录链接。`, sent: true };
  } catch { return { message: "登录服务暂时不可用，请稍后重试。" }; }
}

/** OTP 核销（验证码优先、链接兜底，适配跨设备与邮件扫描器）。 */
export async function verifyUserOtp(_previous: { message: string }, form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const token = String(form.get("token") ?? "").trim();
  if (!validUserEmail(email) || !/^\d{6,10}$/.test(token)) return { message: "请输入邮箱与数字验证码。" };
  const client = await createSupabaseServerClient();
  const { error } = await client.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { message: "验证码错误或已过期，请重新获取。" };
  // 登录态变化影响全站骨架（左栏身份区、订阅 pill 等）
  revalidatePath("/", "layout");
  redirect("/me");
}
