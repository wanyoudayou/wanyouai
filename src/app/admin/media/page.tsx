import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin/session";
import { MediaBrowser } from "@/components/admin/media-library";
export default async function Page() {
  if (!(await getAdminIdentity()).owner) redirect("/admin");
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold">素材库</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          管理可公开展示的图片，供文章、专辑与站点配置重复选用。
        </p>
      </header>
      <MediaBrowser standalone />
    </section>
  );
}
