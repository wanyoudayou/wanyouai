import { notFound, permanentRedirect } from "next/navigation";
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ article?: string | string[] }> }) {
  const { slug } = await params; const { article } = await searchParams;
  if (Array.isArray(article)) notFound();
  permanentRedirect(`/handbooks/${encodeURIComponent(slug)}${article ? `?article=${encodeURIComponent(article)}` : ""}`);
}
