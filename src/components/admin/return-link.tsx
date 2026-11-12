"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { safeAdminReturn } from "@/lib/admin/list-query";
export function AdminReturnLink({
  fallback,
  children,
}: {
  fallback: string;
  children: React.ReactNode;
}) {
  const params = useSearchParams();
  return (
    <Link
      href={safeAdminReturn(params.get("returnTo"), fallback)}
      className="text-sm text-primary"
    >
      {children}
    </Link>
  );
}
