import { FileQuestionIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

export default function NotFound() {
  return <div className="px-6 py-16"><EmptyState Icon={FileQuestionIcon} title="内容不存在或已下架" action={{ href: "/", label: "返回首页" }} /></div>;
}
