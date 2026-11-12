import { publicMetadata } from "@/lib/seo/server";

import { TypeColumn } from "@/components/list/type-column";

export async function generateMetadata() {
  return publicMetadata("手册", "/handbooks");
}

export default function HandbooksPage() {
  return <TypeColumn kind="handbook" />;
}
