import { publicMetadata } from "@/lib/seo/server";

import { TypeColumn } from "@/components/list/type-column";

export async function generateMetadata() {
  return publicMetadata("活动", "/events");
}

export default function EventsPage() {
  return <TypeColumn kind="event" />;
}
