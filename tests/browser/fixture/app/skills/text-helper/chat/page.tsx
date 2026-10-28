import { redirect } from "next/navigation";
export default async function Page({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const query = new URLSearchParams({ panel: "online" });
  const { session } = await searchParams;
  if (session) query.set("session", session);
  redirect(`/skills/text-helper?${query}`);
}
