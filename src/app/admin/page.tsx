import {
  parseListQuery,
  listQueryString,
  type RawListQuery,
} from "@/lib/admin/list-query";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminIdentity } from "@/lib/admin/session";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { Button } from "@/components/ui/button";
import { signOutAdmin } from "./actions";
export const metadata: Metadata = {
  title: "站主后台",
  robots: { index: false, follow: false },
};
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<RawListQuery>;
}) {
  const identity = await getAdminIdentity();
  const raw = await searchParams;
  const notice = typeof raw.notice === "string" ? raw.notice : undefined;
  const hasOwnerNotice = ["owner-unconfigured", "not-owner", "owner-check-failed"].includes(notice ?? "");
  const tab = typeof raw.tab === "string" ? raw.tab : undefined;
  const legacy: Record<string, string> = {
    blog: "articles",
    albums: "collections",
    users: "users",
    inbox: "inbox",
    pages: "pages",
  };
  if (tab && legacy[tab])
    redirect(`/admin/${legacy[tab]}${listQueryString(parseListQuery(raw))}`);
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12 lg:px-8">
      <h1 className="text-2xl font-medium">站主后台</h1>
      {notice === "invalid-link" && (
        <p role="alert" className="text-sm text-muted-foreground">
          登录链接无效、已过期，或站主身份暂时无法验证，请重新申请。
        </p>
      )}
      {notice === "owner-unconfigured" && (
        <p role="alert" className="text-sm text-muted-foreground">
          首次认领前，请部署者在服务端配置 OWNER_EMAIL，重新部署后再登录。
        </p>
      )}
      {notice === "not-owner" && (
        <p role="alert" className="text-sm text-muted-foreground">
          当前邮箱不是本站指定站主，无法认领后台。
        </p>
      )}
      {notice === "owner-check-failed" && (
        <p role="alert" className="text-sm text-muted-foreground">
          邮箱已验证，但站主身份暂时无法验证。请部署者核对当前环境的 SUPABASE_SERVICE_ROLE_KEY 与 Supabase 项目，修正后重新部署并登录。
        </p>
      )}
      {!identity.user ? (
        <>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            使用邮件中的验证码或登录链接。首次部署时，只有预先配置的站主邮箱可以认领后台。
          </p>
          <AdminLoginForm />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="break-all text-sm text-muted-foreground">
              {identity.user.email}
            </p>
            <div className="flex items-center gap-2">
              {identity.owner && (
                <Button asChild variant="outline">
                  <a
                    href="/admin/export"
                    download
                    aria-describedby="export-purpose"
                  >
                    导出内容与数据
                  </a>
                </Button>
              )}
              <form action={signOutAdmin}>
                <Button type="submit" variant="outline">
                  退出登录
                </Button>
              </form>
            </div>
          </div>
          {identity.owner ? (
            <>
              <p id="export-purpose" className="text-sm text-muted-foreground">
                导出文章供阅读编辑，导出业务表格供统计对账。图片附件需另存；导出包不支持整站恢复。
              </p>
              <p className="text-sm text-muted-foreground">
                首次部署或更新配置后，打开
                <Link
                  href="/admin/setup"
                  className="ml-1 underline underline-offset-4"
                >
                  部署检查与首次配置
                </Link>
                ，按步骤完成名片、内容和功能验收。
              </p>
              <AdminDashboard />
              <section className="grid gap-3 sm:grid-cols-2">
                <Button asChild>
                  <Link href="/admin/articles">管理内容</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/admin/payments">查看收款与权益</Link>
                </Button>
              </section>
            </>
          ) : !hasOwnerNotice ? (
            <p role="alert" className="text-sm text-muted-foreground">
              当前账户尚无站主权限。首次认领请核对当前环境的 OWNER_EMAIL，然后退出并从本页重新登录；已有站点请使用原站主账户。
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
