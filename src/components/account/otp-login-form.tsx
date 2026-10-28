"use client";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SendState = { message: string; sent?: boolean };
type SendAction = (prev: SendState, form: FormData) => Promise<SendState>;
type VerifyAction = (prev: { message: string }, form: FormData) => Promise<{ message: string }>;

/**
 * 邮箱免密登录：可输入邮件里的验证码，也可打开登录链接。
 * 新 Free 项目的默认邮件模板只有链接；配置自定义 SMTP 后可加入验证码。
 */
export function OtpLoginForm({ sendAction, verifyAction, emailLabel, note }: {
  sendAction: SendAction;
  verifyAction: VerifyAction;
  emailLabel: string;
  note: string;
}) {
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [sendState, sendFormAction, sending] = useActionState(async (prev: SendState, form: FormData) => {
    const result = await sendAction(prev, form);
    if (!result.sent) return result;
    setEmail(String(form.get("email") ?? "").trim());
    setStage("code");
    return { message: "" };
  }, { message: "" });
  const [verifyState, verifyFormAction, verifying] = useActionState(verifyAction, { message: "" });

  if (stage === "code") {
    return (
      <form action={verifyFormAction} className="flex w-full max-w-md flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        <p className="text-sm text-muted-foreground">登录邮件已发送至 <strong className="text-foreground">{email}</strong>。若邮件有数字验证码，请在下方输入；若只有登录链接，请在发起登录的同一浏览器打开。</p>
        <label htmlFor="otp-code" className="text-sm font-medium">验证码（邮件提供时填写）</label>
        <Input id="otp-code" name="token" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6,10}" maxLength={10} required autoFocus placeholder="●●●●●●" disabled={verifying} className="tracking-[0.5em] text-center text-lg" />
        <div className="flex gap-2">
          <Button type="submit" disabled={verifying}>{verifying ? "验证中…" : "验证并登录"}</Button>
          <Button type="button" variant="ghost" onClick={() => setStage("email")}>更换邮箱</Button>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{verifyState.message}</p>
      </form>
    );
  }
  return (
    <form action={sendFormAction} className="flex w-full max-w-md flex-col gap-4">
      <label htmlFor="login-email" className="text-sm font-medium">{emailLabel}</label>
      <Input id="login-email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" disabled={sending} />
      <Button type="submit" disabled={sending}>{sending ? "正在发送…" : "发送登录邮件"}</Button>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{sendState.message}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </form>
  );
}
