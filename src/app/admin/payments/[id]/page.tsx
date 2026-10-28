import { AdminReturnLink } from "@/components/admin/return-link";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner, numericId } from "@/lib/admin/detail";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getOrderContent } from "@/lib/orders/describe";
import { OrderContentLink } from "@/components/account/order-content-link";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const id = numericId((await params).id);
  const client = await createSupabaseServerClient();
  const { data: o, error } = await client
    .from("orders")
    .select(
      "id,user_id,merchant_order_no,sku_type,target_id,amount,status,created_at,updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("订单暂时不可用");
  if (!o) notFound();
  const [
    { data: rights, error: rightsError },
    { data: mail, error: mailError },
    content,
  ] = await Promise.all([
    client
      .from("entitlements")
      .select("id,type,target_id,starts_at,ends_at,revoked_at")
      .eq("source_ref", `order:${id}`),
    createSupabaseServiceClient()
      .from("email_outbox")
      .select("id,status,attempts,updated_at")
      .eq("order_id", id),
    getOrderContent(client, o),
  ]);
  return (
    <section className="mx-auto max-w-4xl space-y-6 p-6">
      <AdminReturnLink fallback="/admin/payments">返回收款订单</AdminReturnLink>
      <h1 className="text-2xl font-semibold">订单 #{id}</h1>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 rounded-xl border bg-card p-5">
        {Object.entries({
          商户订单号: o.merchant_order_no,
          商品: content.name,
          金额: o.amount,
          状态: o.status,
          创建时间: o.created_at,
          更新时间: o.updated_at,
        }).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all">{String(v)}</dd>
          </div>
        ))}
      </dl>
      <OrderContentLink content={content} />
      <Link
        href={`/admin/users/${o.user_id}`}
        className="inline-block text-primary underline"
      >
        查看购买账户与权益
      </Link>
      <section className="space-y-2">
        <h2 className="font-medium">本订单权益</h2>
        {rightsError ? (
          <p>暂时无法读取</p>
        ) : rights?.length ? (
          rights.map((r) => (
            <p key={r.id} className="text-sm">
              #{r.id} · {r.type} ·{" "}
              {r.revoked_at
                ? "已撤销"
                : r.ends_at
                  ? `有效至 ${r.ends_at}`
                  : "永久有效"}
            </p>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">尚无本订单开通的权益</p>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">权益通知</h2>
        {mailError ? (
          <p>暂时无法读取</p>
        ) : mail?.length ? (
          mail.map((m) => (
            <p key={m.id} className="text-sm">
              {m.status} · 尝试 {m.attempts} 次 · {m.updated_at}
            </p>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">尚无待发通知记录</p>
        )}
      </section>
    </section>
  );
}
