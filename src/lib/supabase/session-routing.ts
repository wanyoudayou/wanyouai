// These routes authorize through a provider signature/Bearer, or always read anonymously.
// Refreshing a browser session here adds an unrelated Auth dependency before their deadline.
// /api/publish is not listed: it also accepts the owner's browser session.
const independent = new Set([
  "/card.json", "/llms.txt", "/api/payments/notify",
  "/api/cron/mail-outbox", "/api/cron/expiry-reminder", "/api/cron/payment-reconcile",
  "/api/skills/install",
]);
const independentPrefixes = ["/api/handbooks/v1/"];
export const needsSessionRefresh = (pathname: string) =>
  !independent.has(pathname) && !independentPrefixes.some((prefix) => pathname.startsWith(prefix));
