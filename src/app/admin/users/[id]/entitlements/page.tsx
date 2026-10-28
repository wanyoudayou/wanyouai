import { AdminReturnLink } from "@/components/admin/return-link";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner, adminReturn } from "@/lib/admin/detail";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AccountRecords } from "@/components/admin/account-records";
import type { RawListQuery } from "@/lib/admin/list-query";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawListQuery>;
}) {
  await requireOwner();
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const { data, error } =
    await createSupabaseServiceClient().auth.admin.getUserById(id);
  if (error && error.status !== 404)
    throw new Error("用户资料暂时不可用，请稍后重试");
  if (!data.user) notFound();
  const raw = await searchParams;
  const back = adminReturn(raw.returnTo, "/admin/users");
  const suffix = `?returnTo=${encodeURIComponent(back)}`;
  return (
    <section className="mx-auto max-w-6xl space-y-6 p-6">
      <AdminReturnLink fallback="/admin/users">返回用户列表</AdminReturnLink>
      <h1 className="break-all text-2xl font-semibold">{data.user.email}</h1>
      <nav className="flex gap-4 text-primary">
        <Link href={`/admin/users/${id}${suffix}`}>收款订单</Link>
        <Link href={`/admin/users/${id}/entitlements${suffix}`}>权益记录</Link>
      </nav>
      <AccountRecords userId={id} kind="entitlements" params={raw} />
    </section>
  );
}
