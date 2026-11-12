import { requireOwner } from "@/lib/admin/detail";
import { loadNavigationAdmin } from "@/lib/admin/navigation";
import { NavigationManager } from "@/components/admin/navigation-manager";

export const metadata = { title: "导航", robots: { index: false, follow: false } };

export default async function NavigationPage() {
  await requireOwner();
  const data = await loadNavigationAdmin();
  return (
    <section className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">导航</h1>
        <p className="text-sm text-muted-foreground">
          管理左侧栏中内置导航之后的自定义项：外部链接、独立页面、手册与活动，以及本次部署包含的代码栏目。保存后立即生效。
        </p>
      </header>
      <NavigationManager data={data} />
    </section>
  );
}
