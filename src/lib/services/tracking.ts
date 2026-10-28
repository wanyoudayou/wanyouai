/** 服务订单追踪展示逻辑（纯函数，可测）。 */

export const BOOKING_STAGES: Record<string, { label: string; clientHint: string }> = {
  inquiry: { label: "询价已收到", clientHint: "站主已收到你的询价，会通过你留下的邮箱回复。" },
  quoted: { label: "报价待你确认", clientHint: "站主已发送报价单，请在下方查看并选择接受或谢绝。" },
  booked: { label: "已成交待开工", clientHint: "站主正在完善订单条款；条款发送给你确认后，你同意即开工。" },
  in_progress: { label: "交付中", clientHint: "站主正在交付，按检查点推进。" },
  delivered: { label: "已交付待验收", clientHint: "交付物已提交，请在下方验收；如需修改可说明修改意见。" },
  accepted: { label: "已验收待结案", clientHint: "你已验收，等待站主结案。" },
  settled: { label: "已结案", clientHint: "本订单已结案，感谢合作。欢迎留下评价。" },
  declined: { label: "已婉拒", clientHint: "很遗憾本单未能成交，欢迎换个需求再试。" },
};

export type MilestoneLike = { id?: number; title: string; owner_party: "owner" | "client" | "third"; expected_at: string | null; actual_at: string | null; status: "todo" | "doing" | "done"; sort: number;
  /** 站主发给客户的需求请求与客户的文字反馈（不作为开工卡点） */
  client_request?: string | null; client_requested_at?: string | null; client_response?: string | null; client_responded_at?: string | null; completion_note?: string | null;
  /** 节点级客户验收：accepted_at 确认时间；objection_note/objected_at 最近驳回 */
  accepted_at?: string | null; objection_note?: string | null; objected_at?: string | null;
  /** 交互留痕：deliver/objection/request/response/accept 追加式日志 */
  events?: { type: string; note?: string; at?: string }[] };

/** 检查点是否有待客户反馈的请求。 */
export function hasPendingRequest(ms: MilestoneLike): boolean {
  return !!ms.client_requested_at && !!ms.client_request && (!ms.client_responded_at || ms.client_responded_at < ms.client_requested_at);
}

export const PARTY_LABEL: Record<string, string> = { owner: "待站主", client: "待你（客户）", third: "待第三方" };

/** 当前待办归属：第一个未完成检查点的归属；全部完成则按阶段语义（交付中=待站主、已交付=待客户）。 */
export function pendingParty(status: string, milestones: MilestoneLike[]): { party: string; milestoneTitle: string | null; clientWaiting: boolean; expectedAt: string | null } {
  const current = [...milestones].sort((a, b) => a.sort - b.sort).find((m) => m.status !== "done");
  if (current) return { party: PARTY_LABEL[current.owner_party] ?? current.owner_party, milestoneTitle: current.title, clientWaiting: current.owner_party === "client", expectedAt: current.expected_at };
  if (status === "in_progress" || status === "booked") return { party: PARTY_LABEL.owner, milestoneTitle: null, clientWaiting: false, expectedAt: null };
  if (status === "delivered") return { party: PARTY_LABEL.client, milestoneTitle: null, clientWaiting: true, expectedAt: null };
  return { party: "—", milestoneTitle: null, clientWaiting: false, expectedAt: null };
}
