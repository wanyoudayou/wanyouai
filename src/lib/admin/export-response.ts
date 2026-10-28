type ExportDependencies = {
  getIdentity: () => Promise<{ owner: boolean }>;
  buildArchive: (now: Date) => Promise<Uint8Array>;
};

/** Stream only a completed archive, respecting download backpressure and cancellation. */
function archiveStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.byteLength) {
        bytes = new Uint8Array(0);
        controller.close();
        return;
      }
      const end = Math.min(offset + 64 * 1024, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
    cancel() { bytes = new Uint8Array(0); },
  }, { highWaterMark: 0 });
}

/** The production route and tests share this owner gate and failure boundary. */
export async function createSiteExportResponse({ getIdentity, buildArchive }: ExportDependencies): Promise<Response> {
  const startedAt = performance.now();
  let authorizedAt = startedAt;
  const timing = () => `auth;dur=${Math.round(authorizedAt - startedAt)}, export;dur=${Math.round(performance.now() - authorizedAt)}`;
  const failure = (message: string, status: number) => new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "server-timing": timing() },
  });
  let identity: { owner: boolean };
  try {
    identity = await getIdentity();
  } catch {
    authorizedAt = performance.now();
    return failure("暂时无法验证站主身份，请稍后重试；没有生成导出文件。", 503);
  }
  authorizedAt = performance.now();
  if (!identity.owner) return failure("需要站主身份", 403);
  const now = new Date();
  let zip: Uint8Array;
  try {
    zip = await buildArchive(now);
  } catch {
    // Do not copy SDK/database error text (which may contain data) into logs or responses.
    console.error("站点导出失败：归档未完成");
    return failure("导出未完成，请稍后重试；没有生成部分文件。", 503);
  }
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  return new Response(archiveStream(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="wanyou-export-${stamp}.zip"`,
      "content-length": String(zip.byteLength),
      "cache-control": "no-store",
      "server-timing": timing(),
    },
  });
}
