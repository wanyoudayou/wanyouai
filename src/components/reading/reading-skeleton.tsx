import { Skeleton } from "@/components/ui/skeleton";

export function ReadingSkeleton() {
  return <div className="mx-auto max-w-3xl space-y-6 px-6 py-10 lg:px-8" role="status" aria-label="正在加载内容">
    <Skeleton className="h-9 w-3/4" /><Skeleton className="h-5 w-1/3" />
    {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-5 w-full" />)}
  </div>;
}
