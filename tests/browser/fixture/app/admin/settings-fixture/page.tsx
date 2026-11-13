import { SettingsForm } from "@/components/admin/settings-form";
import {
  normalizeAvatarConfig, normalizeCommerceConfig, normalizeConstraintsConfig, normalizeContactConfig,
  normalizeHomeConfig, normalizeIdentityConfig,
} from "@/types/site";

export default function Page() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <SettingsForm
        updated="2026-11-13T00:00:00Z"
        zpayReady={false}
        avatarKeySet={false}
        site={{
          siteName: "示例工作室",
          tagline: "内容、服务与合作",
          ownerName: "站主",
          footerCredit: true,
          home: normalizeHomeConfig({ hero: { banner_enabled: false, subtitle: "把经验整理成手册与服务。", layout: "left" } }),
          identity: normalizeIdentityConfig({ one_liner: "让知识与服务，成为你的事业。", languages: ["zh-CN"], timezone: "Asia/Shanghai", focus_areas: [] }),
          constraints: normalizeConstraintsConfig({}),
          contact: normalizeContactConfig({}),
          commerce: normalizeCommerceConfig({}),
          avatar: normalizeAvatarConfig({}),
        }}
      />
    </div>
  );
}
