import Link from "next/link";
import { requireOwner } from "@/lib/admin/detail";
export default async function Page() {
  await requireOwner();
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">数据导出与维护</h1>
      <p className="leading-7 text-muted-foreground">
        导出的 Markdown 可阅读和编辑，业务 CSV
        可统计与对账。图片附件需另存，导出包不能恢复整站。数据库、账户与 Storage
        的恢复应按仓库的备份恢复指南执行。
      </p>
      <a
        href="/admin/export"
        download
        className="inline-flex rounded-lg bg-primary px-4 py-2 text-primary-foreground"
      >
        导出内容与业务数据
      </a>
      <p>
        <Link href="/admin/setup" className="text-primary underline">
          部署与配置检查
        </Link>
      </p>
    </section>
  );
}
