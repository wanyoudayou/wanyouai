import { ChapterOrder } from "@/components/admin/chapter-order";
import { DeleteArticle } from "@/components/admin/delete-article";

export default function Page() {
  return (
    <div className="mx-auto min-w-0 max-w-3xl space-y-6 p-4 sm:p-6">
      <ChapterOrder
        seriesId={3}
        chapters={[
          { id: 11, title: "功能与使用方式", status: "published" },
          { id: 12, title: "名片、导航与收费方案", status: "published" },
          { id: 13, title: "Skill 发布与在线运行", status: "paused" },
        ]}
      />
      <DeleteArticle id={21} updated="2026-11-13T00:00:00Z" access="public" readme={false} after="/admin/articles" />
      <div data-testid="paid">
        <DeleteArticle id={22} updated="2026-11-13T00:00:00Z" access="paid" readme={false} after="/admin/articles" />
      </div>
    </div>
  );
}
