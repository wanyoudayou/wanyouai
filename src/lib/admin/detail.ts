import "server-only";
import { notFound, redirect } from "next/navigation";
import { getAdminIdentity } from "./session";
export async function requireOwner() {
  if (!(await getAdminIdentity()).owner) redirect("/admin");
}
export function numericId(value: string) {
  if (!/^[1-9]\d{0,14}$/.test(value) || !Number.isSafeInteger(Number(value)))
    notFound();
  return Number(value);
}
export function adminReturn(
  value: string | string[] | undefined,
  fallback: string,
) {
  return typeof value === "string" &&
    /^\/admin(?:\/|\?|$)/.test(value) &&
    !/[\\\r\n]/.test(value)
    ? value
    : fallback;
}
