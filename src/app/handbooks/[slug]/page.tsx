import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSeries, getSeriesSeo } from "@/lib/get-series";
import { getSiteConfig } from "@/lib/get-site-config";
import { getReader } from "@/lib/reading/viewer";
import { hasEntitlement } from "@/lib/reading/access";
import { SeriesDetail } from "@/components/reading/series-detail";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ article?: string | string[] }>;
}
export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  return getSeriesSeo(
    "handbook",
    (await params).slug,
    (await searchParams).article,
  );
}
export default async function DetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { article } = await searchParams;
  if (Array.isArray(article)) notFound();
  const [data, site, reader] = await Promise.all([
    getSeries("handbook", slug, article),
    getSiteConfig(),
    getReader(),
  ]);
  const viewer = {
    loggedIn: reader.userId !== null,
    subscribed: hasEntitlement(reader, "subscription", null),
  };
  if (!data) notFound();
  return <SeriesDetail data={data} site={site} viewer={viewer} />;
}
