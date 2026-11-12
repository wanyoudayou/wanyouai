import { SeriesWorkflow } from "@/components/admin/series-settings-form";
import { FolderImport } from "@/components/admin/folder-import";
export default function Page() {
  return (
    <div className="mx-auto min-w-0 max-w-5xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">手册审核与发布</h1>
      <SeriesWorkflow
        chapters={[]}
        series={{
          title: "演示手册",
          task: null,
          tags: [],
          audiences: [],
          nav_enabled: false,
          nav_label: null,
          nav_order: 0,
          featured: false,
          price: 2,
          type: "handbook",
          id: 3,
          slug: "manual",
          status: "draft",
          updated_at: "2026-10-27T00:00:00Z",
          readme_article_id: null,
        }}
      />
      <FolderImport
        initialScope="series:manual"
        series={[{ id: 3, slug: "manual", title: "手册", type: "handbook" }]}
      />
    </div>
  );
}
