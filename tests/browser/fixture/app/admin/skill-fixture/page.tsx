import { SkillManager } from "@/components/admin/skill-manager";
import { SkillDelivery } from "@/components/reading/skill-delivery";
import { HandbookConnections } from "@/components/admin/handbook-connections";
import type { SkillRelease } from "@/lib/skills/types";

const release: SkillRelease = { id: "10000000-0000-4000-8000-000000000001", skill_id: 1, version: "1.0.0", notes: "初始版本", package_sha256: "a".repeat(64), byte_size: 128, skill_name: "text-helper", description: "文本助手", online_eligible: true, created_at: "2026-10-24T00:00:00Z", manifest: [{ path: "SKILL.md", size: 50, sha256: "b".repeat(64), text: true }] };
export default function Page() {
  return <div className="mx-auto w-full min-w-0 max-w-3xl space-y-8 p-4">
    <h1 className="text-2xl font-semibold">管理 SKILL</h1>
    <SkillManager initial={{ id: 1, price: 10, online_enabled: true, usage_guide: "输入一段文字", current_release: release.id, revision: 1, legacy_series_id: null }} initialReleases={{ items: [release], total: 21, page: 1 }} currentRelease={release} />
    <section aria-label="交付"><h2>已购用户交付</h2><SkillDelivery release={release.id} version={release.version} /></section>
    <section aria-label="连接"><h2>Obsidian 手册连接</h2><HandbookConnections /></section>
  </div>;
}
