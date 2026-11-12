import { AdminResourcePage } from "@/components/admin/admin-resource-page";
import type { RawListQuery } from "@/lib/admin/list-query";
import { EVENT_SCOPE } from "@/lib/admin/series-scopes";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawListQuery>;
}) {
  return (
    <AdminResourcePage
      resource="collections"
      params={await searchParams}
      scope={EVENT_SCOPE}
    />
  );
}
