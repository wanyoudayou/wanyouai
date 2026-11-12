"use client";
import { requestAdminLink, verifyAdminOtp } from "@/app/admin/actions";
import { OtpLoginForm } from "@/components/account/otp-login-form";

/** 站主登录与用户侧共用邮箱免密表单。 */
export function AdminLoginForm() {
  return (
    <OtpLoginForm
      sendAction={requestAdminLink}
      verifyAction={verifyAdminOtp}
      emailLabel="站主邮箱"
      note="只有站主可以进入后台；按邮件内容使用验证码或登录链接。"
    />
  );
}
