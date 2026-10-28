type RequestOptions = { timeoutMs?: number; signal?: AbortSignal; fetchImpl?: typeof fetch; retryReadOnce?: boolean };

function isTransientReadFailure(error: unknown) {
  return error instanceof Error && (
    error.name === "TimeoutError" ||
    (error instanceof TypeError && /fetch failed|failed to fetch|network/i.test(error.message))
  );
}

/** Shared transport for server reads with an explicit deadline. No credentials are stored here. */
export function supabaseRequestOptions({ timeoutMs, signal, fetchImpl = fetch, retryReadOnce = false }: RequestOptions = {}) {
  if (!timeoutMs && !signal && !retryReadOnce) return {};
  // Keep SDK retries disabled: Retry-After can exceed the caller's deadline.
  // Only opted-in, idempotent reads may retry a transport failure once.
  return { db: { retry: false }, global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const incoming = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const attempts = retryReadOnce && (method === "GET" || method === "HEAD") ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const signals = [signal, incoming, timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined].filter((s): s is AbortSignal => !!s);
      try {
        return await fetchImpl(input, { ...init, signal: signals.length ? AbortSignal.any(signals) : undefined });
      } catch (error) {
        if (attempt + 1 === attempts || signal?.aborted || incoming?.aborted || !isTransientReadFailure(error)) throw error;
      }
    }
    throw new Error("Supabase read retry exhausted");
  } } };
}
