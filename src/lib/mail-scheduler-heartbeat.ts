/** Optional success signal for an independent, operator-selected cron monitor. */
export async function sendMailSchedulerHeartbeat(
  rawUrl: string | undefined,
  request: typeof fetch = fetch,
): Promise<void> {
  if (!rawUrl) return;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return;

  try {
    const response = await request(url, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2500),
    });
    // Stream cancellation may wait on a remote body; it must not hold the worker open.
    void response.body?.cancel().catch(() => {});
  } catch {
    // A missing ping is reported by the independent monitor. Never log its URL.
  }
}
