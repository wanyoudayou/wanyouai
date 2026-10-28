import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/admin/detail";
export default async function Page() {
  await requireOwner();
  redirect("/admin/ai");
}
