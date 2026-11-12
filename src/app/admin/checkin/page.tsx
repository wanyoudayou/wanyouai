import Link from "next/link";
import { getAdminIdentity } from "@/lib/admin/session";
import { CheckinScanner } from "@/components/admin/checkin-scanner";
import { Button } from "@/components/ui/button";

export const metadata = { title: "活动核销", robots: { index: false, follow: false } };

/** 站主手机端核销台：现场打开本页扫报名者的核销二维码；未登录引导 magic link。 */
export default async function CheckinAdminPage() {
  const identity = await getAdminIdentity();
  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-medium">活动核销</h1>
        <p className="text-sm text-muted-foreground">现场扫描报名者出示的核销二维码，或粘贴核销链接。</p>
      </header>
      {identity.owner ? (
        <CheckinScanner />
      ) : (
        <div className="space-y-3 rounded-xl border p-4 text-sm">
          <p>本页仅站主可用。{identity.user ? "当前账户不是站主。" : "请先登录站主账户。"}</p>
          {!identity.user && <Button size="sm" asChild><Link href="/admin">去登录</Link></Button>}
        </div>
      )}
    </div>
  );
}
