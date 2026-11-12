"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { useActionState, useState } from "react";
import { saveService } from "@/app/admin/services/actions";
import {
  allowedServiceStates,
  PROTOCOL_FIELDS,
  STATUS_LABELS,
} from "@/lib/admin/service-input";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PROTOCOL_EXAMPLES: Record<string, string> = {
  scope: "包含哪些工作、不包含哪些工作",
  deliverable: "客户最终拿到什么，例如书面报告、源文件、一次复盘通话",
  cadence: "例如：确认后 3 个工作日内启动，10 个工作日内交付，含 1 轮修改",
  compensation: "例如：报价确认后全款预付，线下转账",
  exit: "例如：启动前可全额退款；交付后不退款，可终止后续服务",
  ownership: "例如：交付物归客户所有；双方对对方资料保密",
};
export type ManagedService = {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  deliverables: string[];
  duration: string | null;
  price: number | null;
  capacity_per_month: number | null;
  sort: number;
  protocol_snapshot: Record<string, string> | null;
  status: string;
  updated_at: string;
};
export function ServiceForm({ service }: { service?: ManagedService }) {
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const router = useRouter();
  const returnTo = useSearchParams().get("returnTo");
  const [state, action, pending] = useActionState(
    async (previous: { message: string }, form: FormData) => {
      const result = await saveService(previous, form);
      if ("id" in result) {
        setDirty(false);
        router.replace(
          `/admin/services/${result.id}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`,
        );
        router.refresh();
      }
      return result;
    },
    { message: "" },
  );
  const [status, setStatus] = useState(service?.status ?? "draft");
  const area = "block min-h-24 w-full rounded-md border bg-background p-2 text-sm";
  const group = "space-y-4 rounded-xl border bg-card p-4 sm:p-5";
  const form = (
    <form
      action={action}
      onChange={() => setDirty(true)}
      className="space-y-5"
    >
      <input type="hidden" name="id" value={service?.id ?? ""} />
      <input type="hidden" name="updated" value={service?.updated_at ?? ""} />
      <fieldset disabled={pending} className="space-y-5">
        <section className={group} aria-labelledby="service-basic">
          <h2 id="service-basic" className="font-medium">基本信息</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              标题
              <Input name="title" required maxLength={200} defaultValue={service?.title} />
            </label>
            <label className="space-y-1 text-sm">
              网址标识
              <Input
                name="slug"
                required
                readOnly={!!service}
                defaultValue={service?.slug}
                placeholder="例如 business-review"
              />
              <span className="block text-xs text-muted-foreground">
                访问地址 /services/标识，创建后不能修改。
              </span>
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              简介
              <textarea
                name="summary"
                defaultValue={service?.summary ?? ""}
                maxLength={1000}
                placeholder="一两句话说明这项服务帮客户解决什么问题"
                className={cn(area, "min-h-16")}
              />
            </label>
          </div>
        </section>
        <section className={group} aria-labelledby="service-offer">
          <h2 id="service-offer" className="font-medium">价格与交付</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              价格（元）
              <Input name="price" type="number" min="0" max="99999999.99" step="0.01" defaultValue={service?.price ?? ""} placeholder="留空表示询价" />
            </label>
            <label className="space-y-1 text-sm">
              交付周期
              <Input name="duration" defaultValue={service?.duration ?? ""} maxLength={200} placeholder="例如 10 个工作日" />
            </label>
            <label className="space-y-1 text-sm">
              每月容量
              <Input name="capacity_per_month" type="number" min="0" max="999999" step="1" defaultValue={service?.capacity_per_month ?? ""} placeholder="留空不限" />
            </label>
            <label className="space-y-1 text-sm sm:col-span-3">
              交付清单（每行一项）
              <textarea
                name="deliverables"
                defaultValue={service?.deliverables.join("\n")}
                maxLength={3000}
                placeholder={"例如：\n一份书面诊断报告\n一次 60 分钟复盘通话"}
                className={area}
              />
            </label>
          </div>
        </section>
        <section className={group} aria-labelledby="service-terms">
          <div className="space-y-1">
            <h2 id="service-terms" className="font-medium">合作条款</h2>
            <p className="text-sm text-muted-foreground">
              草稿可以先空着；上架前六项都需要填写，并在报价与协议中留存快照。
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(PROTOCOL_FIELDS).map(([key, label]) => (
              <label key={key} className="space-y-1 text-sm">
                {label}
                <textarea
                  name={key}
                  defaultValue={service?.protocol_snapshot?.[key] ?? ""}
                  maxLength={3000}
                  placeholder={PROTOCOL_EXAMPLES[key]}
                  className={area}
                />
              </label>
            ))}
          </div>
        </section>
        <section className={group} aria-labelledby="service-listing">
          <h2 id="service-listing" className="font-medium">上架</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              状态
              <select
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="block w-full rounded-md border bg-background p-2"
              >
                {allowedServiceStates(service?.status ?? "draft").map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              排序（小值在前）
              <Input name="sort" type="number" min="-999999" max="999999" defaultValue={service?.sort ?? 0} />
            </label>
            {status === "archived" && (
              <label className="flex gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="archive_notice" required />
                确认归档，归档后不可恢复。
              </label>
            )}
          </div>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending}>{pending ? "保存中…" : "保存服务"}</Button>
          <p role="status" className="text-sm">
            {state.message}
          </p>
        </div>
      </fieldset>
    </form>
  );
  if (!service) return form;
  return (
    <details open className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">
        {`${service.title} · ${STATUS_LABELS[service.status]}`}
      </summary>
      {service.status === "archived" ? (
        <p className="mt-3 text-sm">已归档，不可恢复。</p>
      ) : (
        <div className="mt-4">{form}</div>
      )}
    </details>
  );
}
