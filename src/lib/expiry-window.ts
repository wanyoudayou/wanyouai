/** 订阅到期提醒窗口：ends_at ∈ (now+6d, now+7d]。每日 cron 扫一次即可全覆盖且天然不重不漏。 */
export function isInReminderWindow(endsAtIso: string, now: Date): boolean {
  const ends = Date.parse(endsAtIso);
  if (!Number.isFinite(ends)) return false;
  const t = now.getTime();
  return ends > t + 6 * 86_400_000 && ends <= t + 7 * 86_400_000;
}
