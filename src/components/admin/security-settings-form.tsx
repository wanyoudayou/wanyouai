"use client";
import { useActionState } from "react";
import { saveSecuritySettings } from "@/app/admin/security/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TurnstilePublicConfig } from "@/lib/turnstile-config";

export function SecuritySettingsForm({ config, updated, keySet, canMigrate }: {
  config: TurnstilePublicConfig; updated: string; keySet: boolean; canMigrate: boolean;
}) {
  const [state, action, pending] = useActionState(saveSecuritySettings, { message: "" });
  return <form action={action} className="space-y-5 rounded-xl border bg-card p-5">
    <input type="hidden" name="updated" value={state.updated ?? updated} />
    <fieldset disabled={pending} className="space-y-5">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={config.enabled} />启用人机校验</label>
      <label className="block space-y-2 text-sm">Site Key<Input name="site_key" defaultValue={config.siteKey ?? ""} maxLength={200} autoComplete="off" /></label>
      <label className="block space-y-2 text-sm">Secret Key<Input name="secret_key" type="password" maxLength={200} autoComplete="new-password" placeholder={keySet ? "已保存；留空保留当前密钥" : "填写同一 widget 的 Secret Key"} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clear_secret" />删除已保存的 Secret Key（须关闭人机校验）</label>
      <p className="text-sm text-muted-foreground">保护匿名分身提问与匿名服务询价。分身仍须单独开启匿名提问；此设置不改变 Supabase 的邮箱登录验证。</p>
      {config.source === "environment" && <p className="text-sm text-muted-foreground">当前尚未保存后台配置。保存后以本页为唯一生效来源，无需修改 Vercel 变量或重新部署。</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit">{pending ? "保存中…" : "保存配置"}</Button>
        {canMigrate && <Button type="submit" name="intent" value="migrate" variant="outline">迁移当前环境配置</Button>}</div>
    </fieldset>
    {state.message && <p role="status" className="text-sm">{state.message}</p>}
  </form>;
}
