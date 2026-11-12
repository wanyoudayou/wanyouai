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
import { AdminDashboard, AdminTodo } from "@/components/admin/admin-dashboard";
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
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold">站主后台</h1>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="break-all text-sm text-muted-foreground">
              {identity.user.email}
            </p>
            <form action={signOutAdmin}>
              <Button type="submit" variant="ghost" size="sm">
                退出登录
              </Button>
            </form>
          </div>
          {identity.owner ? (
            <>
              <AdminTodo />
              <section aria-labelledby="metrics-heading" className="space-y-3">
                <h2 id="metrics-heading" className="text-base font-medium">本月数据</h2>
                <AdminDashboard />
              </section>
              <p className="text-sm text-muted-foreground">
                首次部署或更新配置后，打开
                <Link
                  href="/admin/setup"
                  className="mx-1 text-primary underline underline-offset-4"
                >
                  部署检查
                </Link>
                按步骤完成验收；导出内容与业务数据在
                <Link
                  href="/admin/maintenance"
                  className="mx-1 text-primary underline underline-offset-4"
                >
                  数据导出与维护
                </Link>
                。
              </p>
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
