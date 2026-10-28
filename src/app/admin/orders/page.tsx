import { AdminResourcePage } from "@/components/admin/admin-resource-page";
import type { RawListQuery } from "@/lib/admin/list-query";
export const metadata = {
  title: "服务履约",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawListQuery>;
}) {
  return <AdminResourcePage resource="bookings" params={await searchParams} />;
}
