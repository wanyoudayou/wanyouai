import Link from "next/link";
import { requireOwner, numericId, adminReturn } from "@/lib/admin/detail";
import { RevisionPage } from "@/components/admin/revision-page";
import type { RawListQuery } from "@/lib/admin/list-query";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawListQuery>;
}) {
  await requireOwner();
  const returnTo = adminReturn(
    (await searchParams).returnTo,
    "/admin/articles",
  );
  return (
    <section className="p-6">
      <Link href={returnTo} className="text-sm text-primary">
        返回列表
      </Link>
      <RevisionPage id={numericId((await params).id)} returnTo={returnTo} />
    </section>
  );
}
