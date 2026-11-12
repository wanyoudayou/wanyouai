"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { adminCallbackUrl, validAdminEmail } from "@/lib/admin/auth-flow";
import { bootstrapAdminOwner } from "@/lib/admin/owner-bootstrap-server";

export async function requestAdminLink(_previous: { message: string }, form: FormData) {
  const email = form.get("email");
  if (!validAdminEmail(email)) return { message: "请输入有效邮箱。" };
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: adminCallbackUrl(process.env.SITE_URL), shouldCreateUser: true } });
    if (error) return { message: "暂时无法发送登录邮件，请稍后重试或检查站点邮件配置。" };
    return { message: `登录邮件已发送至 ${email.trim()}。请按邮件内容输入验证码或打开登录链接；只有站主可以进入后台。`, sent: true };
  } catch { return { message: "登录服务暂时不可用，请稍后重试。" }; }
}

/** OTP 核销（站主侧同用户侧一条链路）。 */
export async function verifyAdminOtp(_previous: { message: string }, form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const token = String(form.get("token") ?? "").trim();
  if (!validAdminEmail(email) || !/^\d{6,10}$/.test(token)) return { message: "请输入邮箱与数字验证码。" };
  const client = await createSupabaseServerClient();
  const { error } = await client.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { message: "验证码错误或已过期，请重新获取。" };
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return { message: "登录状态暂时无法验证，请重新获取验证码。" };
  let outcome;
  try { outcome = await bootstrapAdminOwner(client, user); }
  catch {
    // OTP has already written the session cookie, so the login form may disappear.
    revalidatePath("/", "layout");
    redirect("/admin?notice=owner-check-failed");
  }
  revalidatePath("/", "layout");
  if (outcome === "unconfigured") redirect("/admin?notice=owner-unconfigured");
  if (outcome === "not_allowed" || outcome === "already_claimed") redirect("/admin?notice=not-owner");
  redirect("/admin");
}

export async function signOutAdmin() {
  const client = await createSupabaseServerClient();
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw new Error("退出失败，请重试");
  revalidatePath("/", "layout");
  redirect("/admin");
}
