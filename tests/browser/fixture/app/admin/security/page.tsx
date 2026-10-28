import { SecuritySettingsForm } from "@/components/admin/security-settings-form";
export default function Page() {
  return <div className="mx-auto w-full max-w-3xl min-w-0 space-y-5 p-4">
    <h1 className="text-2xl font-semibold">安全与人机校验</h1>
    <SecuritySettingsForm config={{ enabled: true, siteKey: "synthetic-site-key-a", source: "database" }} updated="2026-10-20T00:00:00Z" keySet canMigrate={false} />
  </div>;
}
