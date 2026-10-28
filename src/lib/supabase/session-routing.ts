// These routes authorize through a provider signature/Bearer, or always read anonymously.
// Refreshing a browser session here adds an unrelated Auth dependency before their deadline.
const independent = new Set([
  "/card.json", "/llms.txt", "/api/payments/notify",
  "/api/cron/mail-outbox", "/api/cron/expiry-reminder",
]);
export const needsSessionRefresh = (pathname: string) => !independent.has(pathname);
