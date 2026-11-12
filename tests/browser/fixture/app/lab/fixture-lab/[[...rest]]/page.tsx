export default async function FixtureLab({ params }: { params: Promise<{ rest?: string[] }> }) {
  const { rest = [] } = await params;
  return (
    <section data-section="fixture-lab" className="p-6">
      <h1 className="text-2xl font-semibold">实验栏目内容</h1>
      <p>子路径：{rest.join("/") || "（根）"}</p>
    </section>
  );
}
