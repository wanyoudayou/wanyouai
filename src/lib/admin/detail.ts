import "server-only";
import { notFound, redirect } from "next/navigation";
import { getAdminIdentity } from "./session";
import { safeAdminReturn } from "./list-query";
export async function requireOwner() {
  if (!(await getAdminIdentity()).owner) redirect("/admin");
}
export function numericId(value: string) {
  if (!/^[1-9]\d{0,14}$/.test(value) || !Number.isSafeInteger(Number(value)))
    notFound();
  return Number(value);
}
/** 与 list-query 的 safeAdminReturn 同一规则；数组参数（重复的查询键）一律回退。 */
export function adminReturn(
  value: string | string[] | undefined,
  fallback: string,
) {
  return typeof value === "string" ? safeAdminReturn(value, fallback) : fallback;
}
