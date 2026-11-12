/** CSV 单元格：引号转义 + 公式注入防护。纯函数，供导出、名单与用户 CSV 共用。 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  // 表格软件会把 = + - @ 及制表/回车开头的文本当作公式执行；纯数字保持原值，便于统计。
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: (string | number | null | undefined)[]): string {
  return values.map(csvCell).join(",");
}
