/** Read one selected object's children without relying on the Data API row cap. */
export async function readRelatedPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await fetchPage(offset, offset + 499);
    if (error || !data) throw new Error("关联明细暂时不可用，请稍后重试");
    rows.push(...data);
    if (data.length < 500) return { data: rows, error: null };
  }
}
