import { redirect } from "next/navigation";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { DeploymentChecks } from "@/components/admin/deployment-checks";
import { getAdminIdentity } from "@/lib/admin/session";
import { getDeploymentReport } from "@/lib/admin/deployment-checks-server";

import { StarterContent } from "@/components/admin/starter-content";
import { getStarterStatus } from "@/lib/starter/server";

export const metadata = {
  title: "部署检查",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await getAdminIdentity()).owner) redirect("/admin");
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10 lg:px-8">
      <h1 className="text-2xl font-medium">部署检查与首次配置</h1>
      <AdminTabs active="setup" />
      <StarterContent status={await getStarterStatus()} />
      <DeploymentChecks report={await getDeploymentReport()} />
    </div>
  );
}
