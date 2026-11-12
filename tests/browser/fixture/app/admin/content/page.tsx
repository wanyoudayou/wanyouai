import { ContentWorkbench } from "@/components/admin/content-workbench";
export default function Page() {
  return (
    <section className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">内容工作台</h1>
      <ContentWorkbench
        initialType="chapter"
        initialSeries="example"
        series={[{ slug: "example", title: "示例专辑", type: "collection" }]}
      />
    </section>
  );
}
