"use client";

import { ContentLoadError } from "@/components/list/content-load-error";

export default function Error({ retry }: { retry: () => void }) {
  return <ContentLoadError retry={retry} />;
}
