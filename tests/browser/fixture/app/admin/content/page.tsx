import { ContentWorkbench } from "@/components/admin/content-workbench";
export default function Page() {
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold">新建文章</h1>
      <ContentWorkbench
        initialType="chapter"
        initialSeries="example"
        series={[{ slug: "example", title: "示例手册", type: "collection" }]}
      />
    </section>
  );
}
