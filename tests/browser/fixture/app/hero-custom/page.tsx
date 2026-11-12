import { HeroCard } from "@/components/home/hero-card";
export default async function Page({ searchParams }: { searchParams: Promise<{ dark?: string }> }) {
  const { dark } = await searchParams;
  return (
    <HeroCard
      oneLiner="浅深两套横幅，自动跟随外观模式"
      facts={[]}
      askPlaceholder="了解站点内容"
      focusAreas={["真实内容"]}
      exclusions={[]}
      bannerLightUrl="/assets/custom-banner.svg?theme=light"
      bannerDarkUrl={dark === "default" ? null : "/assets/custom-banner.svg?theme=dark"}
    />
  );
}
