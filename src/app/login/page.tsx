import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserIdentity } from "@/lib/account/session";
import { UserLoginForm } from "@/components/account/user-login-form";

export const metadata: Metadata = { title: "登录", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { user } = await getUserIdentity();
  if (user) redirect("/me");
  const notice = (await searchParams).notice;
  return <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
    <div className="space-y-2">
      <h1 className="text-2xl font-medium">登录</h1>
      <p className="text-sm text-muted-foreground">按邮件内容输入验证码或打开登录链接，无需密码。</p>
    </div>
    {notice === "invalid-link" && <p role="alert" className="text-sm text-muted-foreground">登录链接无效或已过期，请重新获取。</p>}
    <UserLoginForm />
    <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">返回首页</Link>
  </div>;
}
