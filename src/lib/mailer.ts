// 注意：本文件故意不 import "server-only"——该包在纯 Node（tsx 测试）下是「毒药包」会抛错，
// 而 mailer 需要被单元测试直接导入。服务端约束由调用方（mail-outbox-server / archive-notice / cron route）保证。

/** Resend 事务邮件。RESEND_API_KEY + EMAIL_FROM 同配才启用，缺一返回 null（静默跳过，不阻断交易主链路）。 */
export type Mailer = {
  from: string;
  send(input: { to: string; subject: string; html: string; text: string }): Promise<void>;
};

export function mailerFromEnv(fetchImpl: typeof fetch = fetch): Mailer | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return null;
  return {
    from,
    async send({ to, subject, html, text }) {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
      });
      if (!response.ok) throw new Error(`Resend 发送失败：HTTP ${response.status}`);
    },
  };
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 唯一事务邮件布局：站名 / 标题 / 正文 / 权益摘要 / 回站链接。bodyHtml 由调用方用 escapeHtml 后的安全片段拼接。 */
export function renderMailHtml(input: { siteName: string; title: string; bodyHtml: string; summary?: string; ctaUrl: string; ctaLabel: string }): string {
  const site = escapeHtml(input.siteName);
  const summary = input.summary ? `<p style="margin:16px 0;padding:12px;background:#f6f6f6;border-radius:8px;font-size:14px;">${input.summary}</p>` : "";
  return `<div style="max-width:520px;margin:0 auto;font-family:system-ui,sans-serif;color:#222;">
  <p style="font-size:13px;color:#888;">${site}</p>
  <h1 style="font-size:18px;">${escapeHtml(input.title)}</h1>
  <div style="font-size:14px;line-height:1.7;">${input.bodyHtml}</div>
  ${summary}
  <p style="margin:24px 0;"><a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;">${escapeHtml(input.ctaLabel)}</a></p>
  <p style="font-size:12px;color:#aaa;">此邮件由 ${site} 自动发送，请勿直接回复。</p>
</div>`;
}

export { escapeHtml };
