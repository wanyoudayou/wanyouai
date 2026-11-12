import { DeploymentChecks } from "@/components/admin/deployment-checks";
import { inspectDeployment } from "@/lib/admin/deployment-checks";

export default async function Page() {
  const report = await inspectDeployment({
    isOwner: async () => true,
    env: () => ({
      SITE_URL: "https://site.example",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-fixture",
      SUPABASE_SERVICE_ROLE_KEY: "private-fixture-only",
      PUBLISH_TOKEN: "private-fixture-only".repeat(2),
      RESEND_API_KEY: "private-fixture-only",
    }),
    schemaVersion: async () => "fixture",
    site: async () => ({ identityReady: true, paymentEnabled: false, paymentChannelsReady: false, avatarEnabled: false, avatarModelReady: false }),
    aiStatus: async () => ({ generation: "disabled", embedding: "disabled", knowledge: "disabled", avatar: "disabled" }),
    mediaReady: async () => true,
    hasPublishedContent: async () => true,
    mailQueue: async () => ({ dead: 0, oldest_due_seconds: 0 }),
  }, "fixture");
  return (
    <div className="mx-auto w-full max-w-5xl min-w-0 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">部署检查与首次配置</h1>
      <DeploymentChecks report={report} />
    </div>
  );
}
