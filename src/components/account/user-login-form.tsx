"use client";
import { requestUserLink, verifyUserOtp } from "@/app/login/actions";
import { OtpLoginForm } from "@/components/account/otp-login-form";

/** 用户侧登录（页面契约 3.10）：邮箱验证码或登录链接；无密码、无第三方。 */
export function UserLoginForm() {
  return (
    <OtpLoginForm
      sendAction={requestUserLink}
      verifyAction={verifyUserOtp}
      emailLabel="邮箱"
      note="无密码登录：按邮件内容输入验证码或打开登录链接。新邮箱首次登录即自动注册。"
    />
  );
}
