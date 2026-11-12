"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { safeAdminReturn } from "@/lib/admin/list-query";
import { PageEditor } from "./pages-manager";
import type { CustomPageRow } from "@/lib/admin/pages";
export function PageEditorRoute({
  page,
  avatarReady,
}: {
  page: CustomPageRow | null;
  avatarReady: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <PageEditor
      page={page}
      avatarReady={avatarReady}
      onDone={() =>
        router.push(safeAdminReturn(params.get("returnTo"), "/admin/pages"))
      }
    />
  );
}
