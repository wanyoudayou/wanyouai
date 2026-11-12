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
  return (
    <details open className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">
        {service
          ? `${service.title} · ${STATUS_LABELS[service.status]}`
          : "创建服务"}
      </summary>
      {service?.status === "archived" ? (
        <p className="mt-3 text-sm">已归档，不可恢复。</p>
      ) : (
        <form
          action={action}
          onChange={() => setDirty(true)}
          className="mt-4 space-y-4"
        >
          <input type="hidden" name="id" value={service?.id ?? ""} />
          <input
            type="hidden"
            name="updated"
            value={service?.updated_at ?? ""}
          />
          <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              标题
              <Input
                name="title"
                required
                maxLength={200}
                defaultValue={service?.title}
              />
            </label>
            <label className="text-sm">
              网址标识（用于 /services/标识）
              <Input
                name="slug"
                required
                readOnly={!!service}
                defaultValue={service?.slug}
                placeholder="business-review"
              />
            </label>
            <label className="text-sm">
              简介
              <Input
                name="summary"
                defaultValue={service?.summary ?? ""}
                maxLength={1000}
              />
            </label>
            <label className="text-sm">
              交付周期
              <Input
                name="duration"
                defaultValue={service?.duration ?? ""}
                maxLength={200}
              />
            </label>
            <label className="text-sm">
              价格（元）
              <Input
                name="price"
                type="number"
                min="0"
                max="99999999.99"
                step="0.01"
                defaultValue={service?.price ?? ""}
              />
            </label>
            <label className="text-sm">
              每月容量
              <Input
                name="capacity_per_month"
                type="number"
                min="0"
                max="999999"
                step="1"
                defaultValue={service?.capacity_per_month ?? ""}
              />
            </label>
            <label className="text-sm">
              排序（小值在前）
              <Input
                name="sort"
                type="number"
                min="-999999"
                max="999999"
                defaultValue={service?.sort ?? 0}
              />
            </label>
            <label className="text-sm">
              状态
              <select
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="block w-full rounded-md border bg-background p-2"
              >
                {allowedServiceStates(service?.status ?? "draft").map(
                  (value) => (
                    <option key={value} value={value}>
                      {STATUS_LABELS[value]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              交付清单（每行一项）
              <textarea
                name="deliverables"
                defaultValue={service?.deliverables.join("\n")}
                maxLength={3000}
                className="block min-h-24 w-full rounded-md border bg-background p-2"
              />
            </label>
            {Object.entries(PROTOCOL_FIELDS).map(([key, label]) => (
              <label key={key} className="text-sm">
                {label}
                <textarea
                  name={key}
                  defaultValue={service?.protocol_snapshot?.[key] ?? ""}
                  maxLength={3000}
                  className="block min-h-24 w-full rounded-md border bg-background p-2"
                />
              </label>
            ))}
            {status === "archived" && (
              <label className="flex gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="archive_notice" required />
                确认归档，归档后不可恢复。
              </label>
            )}
            <Button disabled={pending}>
              {pending ? "保存中…" : "保存服务"}
            </Button>
          </fieldset>
          <p role="status" className="text-sm">
            {state.message}
          </p>
        </form>
      )}
    </details>
  );
}
