/**
 * 栏目可用的唯一主站接口。栏目代码只能从这里、自己的目录、React/Next 公共 API
 * 以及 manifest 登记的依赖导入；新增能力先在这里经审查后再提供。
 */
export { Button } from "@/components/ui/button";
export { Input } from "@/components/ui/input";
export { Badge } from "@/components/ui/badge";
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
export { Separator } from "@/components/ui/separator";
export { Skeleton } from "@/components/ui/skeleton";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
export { StatusBadge } from "@/components/shared/status-badge";
export { Callout } from "@/components/shared/callout";
export { EmptyState } from "@/components/shared/empty-state";
export { cn } from "@/lib/utils";
export { SectionHeader, SectionBody } from "./layout";
export { usePersistentState } from "./storage";
export type { SectionProps, SectionViewer } from "./types";
