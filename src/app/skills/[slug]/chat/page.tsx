import { notFound, redirect } from "next/navigation";
import { getSkill } from "@/lib/skills/repository";
import { uuid } from "@/lib/skills/types";
export const metadata = { title: "Skill 文本对话", robots: { index: false, follow: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ session?: string }> }) {
  const { slug } = await params; const { session } = await searchParams;
  const item = await getSkill(slug); if (!item) notFound();
  const query = new URLSearchParams({ panel: "online" });
  if (uuid(session)) query.set("session", session!);
  redirect(`/skills/${slug}${item.settings.online_enabled ? `?${query}` : ""}`);
}
