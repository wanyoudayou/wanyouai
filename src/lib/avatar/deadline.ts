/** Reject promptly even when a transport's promise does not honor AbortSignal. */
export function withinSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Request aborted"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function providerSignal(parent?: AbortSignal, timeoutMs = 20_000): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(parent ? [parent] : [])]);
}
