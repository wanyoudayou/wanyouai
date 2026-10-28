import Link from "next/link";

/** Footer 收在中栏底部（页面契约 2.2）：© 站名 · 退款政策 · 底部自定义页 · 联系方式。 */
export function SiteFooter({
  siteName,
  credit,
  refundPolicyUrl,
  contactHref,
  contactLabel,
  pages = [],
}: {
  siteName: string;
  credit: boolean;
  refundPolicyUrl: string | null;
  contactHref: string | null;
  contactLabel: string | null;
  pages?: { href: string; label: string }[];
}) {
  return (
    <footer className="border-t px-6 py-6 text-xs text-muted-foreground lg:px-8">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>© {new Date().getFullYear()} {siteName}</span>
        {refundPolicyUrl ? (
          <Link
            href={refundPolicyUrl}
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            退款政策
          </Link>
        ) : null}
        {/* 发布位置 = 底部 的自定义页（按 nav_order 排） */}
        {pages.map((page) => (
          <Link
            key={page.href}
            href={page.href}
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            {page.label}
          </Link>
        ))}
        {contactHref && contactLabel ? (
          <Link
            href={contactHref}
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            {contactLabel}
          </Link>
        ) : null}
        {credit ? <span className="ml-auto">Powered by 万有AI</span> : null}
      </p>
    </footer>
  );
}
