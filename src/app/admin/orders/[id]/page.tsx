import { AdminReturnLink } from "@/components/admin/return-link";
import { requireOwner, numericId } from "@/lib/admin/detail";
import { getBookingsData } from "@/lib/admin/bookings";
import { BookingPipeline } from "@/components/admin/booking-pipeline";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const data = await getBookingsData(numericId((await params).id));
  return (
    <section className="mx-auto max-w-6xl space-y-6 p-6">
      <AdminReturnLink fallback="/admin/orders">返回服务履约</AdminReturnLink>
      <h1 className="text-2xl font-semibold">履约详情</h1>
      <BookingPipeline bookings={data.active} closed={data.closed} />
    </section>
  );
}
