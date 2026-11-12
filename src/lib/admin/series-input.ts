export function parseSeriesInput(form: FormData) {
  const title = String(form.get("title") ?? "").trim();
  const slug = String(form.get("slug") ?? "").trim();
  const type = String(form.get("type") ?? "");
  const rawPrice = String(form.get("price") ?? "").trim();
  if (!title || title.length > 200)
    throw new Error("请输入不超过 200 字的标题");
  if (!/^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$/.test(slug))
    throw new Error(
      "网址标识需为 2–120 位小写英文字母、数字或连字符，首尾不能是连字符",
    );
  if (type !== "handbook" && type !== "event") throw new Error("请选择手册或活动。Skill 请从独立入口创建。");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(rawPrice))
    throw new Error("价格应为 0–999999.99，最多两位小数");
  if (type === "event" && Number(rawPrice) !== 0)
    throw new Error("活动票价需在活动详情中配置，此处请填 0");
  const task = String(form.get("task") ?? "").trim();
  if (task.length > 300) throw new Error("任务说明不超过 300 字");
  const list = (key: string) => {
    const values = String(form.get(key) ?? "")
      .split(/[,，]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length > 20 || values.some((value) => value.length > 50))
      throw new Error("标签最多 20 个，每个不超过 50 字");
    return [...new Set(values)];
  };
  return {
    title,
    slug,
    type,
    task: task || null,
    tags: list("tags"),
    audiences: list("audiences"),
    price: Number(rawPrice),
    status: "draft",
  };
}
