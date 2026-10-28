import { ReadingShellBridge } from "@/components/reading/reading-shell";
import { SkillDelivery } from "@/components/reading/skill-delivery";
export default async function Page({ searchParams }: { searchParams: Promise<{ offline?: string; panel?: string; session?: string; locked?: string }> }) {
  const { offline, panel, session, locked } = await searchParams;
  const online = !offline;
  return <article className="p-6">
    <ReadingShellBridge value={{ pathname: "/skills/text-helper", navigation: null, outline: null, discussion: false, skillPanel: {
      content: <SkillDelivery release="10000000-0000-4000-8000-000000000001" version="1.0.0" />,
      initialMode: online && panel === "online" ? "online" : "download",
      ...(online ? locked ? { online: <p>登录后即可确认此 Skill 的使用权限。</p> } : { chat: { skill: 1, title: "文本助手", guide: "先提供一段文字，再说明改写目标。", initialSession: session } } : {}),
    } }} />
    <h1>文本助手</h1><p>这里是公开的 Skill 介绍。</p>
  </article>;
}
