import { NavigationManager } from "@/components/admin/navigation-manager";

export default function NavigationFixture() {
  return (
    <section className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">导航</h1>
      <NavigationManager
        data={{
          version: "fixture-version",
          commit: "abc1234",
          rows: [
            { id: 1, kind: "page", label: "收费方案", icon: "credit-card", url: null, page_id: 1, series_id: null, section: null, access: "public", enabled: true, child: false, href: "/p/pricing", problem: null },
            { id: 2, kind: "section", label: "旧栏目", icon: "flask", url: null, page_id: null, series_id: null, section: "removed-lab", access: "login", enabled: true, child: false, href: "/lab/removed-lab", problem: "本次部署中不存在，前台已隐藏" },
          ],
          pages: [
            { id: 1, title: "收费方案", href: "/p/pricing", live: true, note: "已发布" },
            { id: 2, title: "关于", href: "/p/about", live: false, note: "草稿" },
          ],
          series: [{ id: 3, title: "使用指南", href: "/handbooks/guide", live: true, note: "手册 · 已上架" }],
          sections: [
            { name: "git-lab", title: "Git 实验室", description: "练习", icon: "git-branch", tier: "standard", path: "/lab/git-lab", dependencies: [], budgetKb: 100, tokens: false },
          ],
        }}
      />
    </section>
  );
}
