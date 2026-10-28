import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "@/components/shared/status-badge";
import type {
  DeploymentCheck,
  DeploymentReport,
} from "@/lib/admin/deployment-checks";

const states: Record<
  DeploymentCheck["status"],
  { label: string; tone: StatusBadgeTone }
> = {
  ready: { label: "符合条件", tone: "owned" },
  disabled: { label: "未启用", tone: "free" },
  skipped: { label: "已有站主，免检查", tone: "free" },
  incomplete: { label: "待配置", tone: "paused" },
  error: { label: "检查未通过", tone: "paused" },
  unverified: { label: "待人工验收", tone: "registered" },
};

export function DeploymentChecks({ report }: { report: DeploymentReport }) {
  return (
    <div className="space-y-8">
      <div className="rounded-xl border bg-muted/30 p-5 text-sm leading-6">
        <p>
          按顺序完成：检查部署配置 → 填写名片 → 发布内容 → 验收已启用的功能。
        </p>
        <p className="mt-2 text-muted-foreground">
          服务端配置只检查是否填写及格式；远程项目只做读取检查。这些检查不修改数据库、不发送邮件、不发起支付，也不显示密钥。修改部署环境变量后重新部署，再刷新本页。
        </p>
        <form action="/admin/setup" method="get" className="mt-3">
          <Button type="submit" variant="outline">
            刷新检查
          </Button>
        </form>
      </div>
      {report.sections.map((section) => (
        <section
          key={section.title}
          aria-label={section.title}
          className="space-y-3"
        >
          <h2 className="text-lg font-medium">{section.title}</h2>
          {section.description && (
            <p className="text-sm leading-6 text-muted-foreground">{section.description}</p>
          )}
          <ul className="divide-y rounded-xl border">
            {section.checks.map((check) => (
              <li key={check.id} className="space-y-2 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="break-all text-sm font-medium">
                    {check.title}
                  </h3>
                  <StatusBadge tone={states[check.status].tone}>
                    {states[check.status].label}
                  </StatusBadge>
                </div>
                <p className="break-words text-sm leading-6 text-muted-foreground">
                  {check.hint}
                </p>
                {check.steps && check.status !== "disabled" && (
                  <details className="text-sm leading-6">
                    <summary className="w-fit cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                      如何验收
                    </summary>
                    <ol className="mt-2 list-decimal space-y-2 pl-5 text-muted-foreground">
                      {check.steps.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  </details>
                )}
                {check.href && (
                  <Link
                    href={check.href}
                    className="inline-block text-sm underline underline-offset-4"
                  >
                    {check.hrefLabel ?? "前往配置"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
