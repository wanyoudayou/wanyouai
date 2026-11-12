import type { Metadata } from "next";
import Link from "next/link";
import { getAdminIdentity } from "@/lib/admin/session";
import { getUserIdentity } from "@/lib/account/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteConfig } from "@/lib/get-site-config";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/shared/callout";
import { StatusBadge } from "@/components/shared/status-badge";
import { ScanLineIcon, InfoIcon } from "lucide-react";
import { confirmCheckin } from "./actions";
import { loginHref } from "@/lib/account/auth-flow";

export const metadata: Metadata = { title: "活动核销", robots: { index: false, follow: false } };

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 核销链接页：站主 = 核销操作台；报名者本人 = 凭证展示；匿名/他人 = 提示。 */
export default async function CheckinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const failed = (await searchParams).error === "1";
  if (!uuidRe.test(token)) return <Shell><Callout Icon={InfoIcon} title="链接无效"><p>这不是有效的活动核销链接。</p></Callout></Shell>;
  // checkin_lookup 只返回标题与状态；报名邮箱仅在站主会话下返回。
  const client = await createSupabaseServerClient();
  const [{ data: lookup }, admin, { user }, site] = await Promise.all([
    client.rpc("checkin_lookup", { p_token: token }),
    getAdminIdentity(),
    getUserIdentity(),
    getSiteConfig(),
  ]);
  const registration = lookup as null | { found: boolean; title?: string | null; status?: string; created_at?: string; is_self?: boolean; has_account?: boolean; email?: string };
  if (!registration?.found) return <Shell><Callout Icon={InfoIcon} title="链接无效"><p>没有找到对应的报名记录，请与报名者核对链接。</p></Callout></Shell>;
  const isOwner = admin.owner;
  const isSelf = registration.is_self === true;

  return <Shell>
    <header className="space-y-1">
      <p className="text-sm text-muted-foreground">活动核销</p>
      <h1 className="text-2xl font-medium">{registration.title ?? "活动"}</h1>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <StatusBadge tone={registration.status === "attended" ? "owned" : "free"}>{registration.status === "attended" ? "已到场" : registration.status === "registered" ? "已报名" : "已取消"}</StatusBadge>
        <span>报名于 {registration.created_at ? formatDateTime(registration.created_at, site.identity.timezone) : "—"}</span>
      </div>
    </header>

    {isOwner && failed ? <Callout Icon={InfoIcon} title="核销未完成"><p>请刷新确认当前状态后重试；报名已取消的记录不可核销。</p></Callout> : null}
    {isOwner ? (
      <section className="space-y-3 rounded-xl border p-4">
        <p className="text-sm">报名者：<strong>{registration.email}</strong>{registration.has_account ? "" : "（尚无站内账户）"}</p>
        {registration.status === "registered" ? (
          <form action={confirmCheckin}>
            <input type="hidden" name="token" value={token} />
            <Button size="sm">确认到场核销</Button>
            <p className="mt-2 text-xs text-muted-foreground">核销后：免费活动自动开通纪要权限（有账户者）；付费活动票随订单已发。</p>
          </form>
        ) : registration.status === "attended" ? (
          <p className="text-sm text-muted-foreground">该报名此前已核销（重复出示属正常）。</p>
        ) : (
          <p className="text-sm text-muted-foreground">该报名已取消，不可核销。</p>
        )}
      </section>
    ) : isSelf ? (
      <Callout Icon={ScanLineIcon} title="请出示本页给工作人员">
        <p>工作人员（站主）打开本链接即可完成到场核销。{registration.status === "registered" ? "核销后，活动纪要将对到场的你自动解锁。" : ""}</p>
      </Callout>
    ) : (
      <Callout Icon={InfoIcon} title="这是活动核销链接">
        <p>{user ? "当前账户与报名邮箱不一致。" : "如果这是你的报名，请用报名邮箱登录后出示本页。"}核销需由站主操作。</p>
        <p className="mt-2"><Link href={loginHref(`/checkin/${token}`)} className="underline">去登录</Link></p>
      </Callout>
    )}
  </Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-xl space-y-6 px-6 py-12">{children}</div>;
}
