"use client";
import { useRouter } from "next/navigation";
import { RevisionReview } from "./revision-review";
export function RevisionPage({
  id,
  returnTo,
}: {
  id: number;
  returnTo: string;
}) {
  const router = useRouter();
  return (
    <div className="m-5 min-h-[70dvh] rounded-xl border bg-card p-5">
      <RevisionReview
        id={id}
        autoLoad
        onPublished={() => {
          router.push(returnTo);
          router.refresh();
        }}
      />
    </div>
  );
}
