/** 极简 store-only（不压缩）ZIP 构建器。纯函数、无依赖，供 tsx 单测直接导入。 */
import { Buffer } from "node:buffer";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { path: string; content: string | Uint8Array };

/** 构建 ZIP（store 方法，UTF-8 文件名）。路径统一用 /，禁止 .. 与绝对路径。 */
export function buildZip(entries: ZipEntry[], date = new Date()): Uint8Array {
  if (entries.length > 0xffff) throw new Error("导出文件数超出 ZIP32 上限");
  const encoder = new TextEncoder();
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff;
  const dosDate = ((((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff);
  const planned: { nameBytes: Uint8Array; content: ZipEntry["content"]; dataLength: number; offset: number }[] = [];
  let localSize = 0;
  let centralSize = 0;
  for (const entry of entries) {
    const name = entry.path.replace(/\\/g, "/");
    if (name.includes("..") || name.startsWith("/")) throw new Error("非法导出路径: " + name);
    const nameBytes = encoder.encode(name);
    const dataLength = typeof entry.content === "string" ? Buffer.byteLength(entry.content, "utf8") : entry.content.byteLength;
    if (nameBytes.length > 0xffff || dataLength > 0xffffffff || localSize + 30 + nameBytes.length + dataLength > 0xffffffff) {
      throw new Error("导出大小超出 ZIP32 上限");
    }
    planned.push({ nameBytes, content: entry.content, dataLength, offset: localSize });
    localSize += 30 + nameBytes.length + dataLength;
    centralSize += 46 + nameBytes.length;
  }
  if (centralSize > 0xffffffff || localSize + centralSize + 22 > 0xffffffff) throw new Error("导出大小超出 ZIP32 上限");

  // Encode directly into the final buffer: a second full set of encoded entries
  // would otherwise remain live alongside the finished archive at peak memory.
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let centralAt = localSize;
  for (const { nameBytes, content, dataLength, offset } of planned) {
    const dataAt = offset + 30 + nameBytes.length;
    const target = out.subarray(dataAt, dataAt + dataLength);
    if (typeof content === "string") {
      const result = encoder.encodeInto(content, target);
      if (result.read !== content.length || result.written !== dataLength) throw new Error("导出文本编码长度异常");
    } else {
      target.set(content);
    }
    const crc = crc32(target);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, dosTime, true);
    view.setUint16(offset + 12, dosDate, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, dataLength, true);
    view.setUint32(offset + 22, dataLength, true);
    view.setUint16(offset + 26, nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(nameBytes, offset + 30);

    view.setUint32(centralAt, 0x02014b50, true);
    view.setUint16(centralAt + 4, 20, true);
    view.setUint16(centralAt + 6, 20, true);
    view.setUint16(centralAt + 8, 0x0800, true);
    view.setUint16(centralAt + 10, 0, true);
    view.setUint16(centralAt + 12, dosTime, true);
    view.setUint16(centralAt + 14, dosDate, true);
    view.setUint32(centralAt + 16, crc, true);
    view.setUint32(centralAt + 20, dataLength, true);
    view.setUint32(centralAt + 24, dataLength, true);
    view.setUint16(centralAt + 28, nameBytes.length, true);
    view.setUint32(centralAt + 42, offset, true);
    out.set(nameBytes, centralAt + 46);
    centralAt += 46 + nameBytes.length;
  }
  view.setUint32(centralAt, 0x06054b50, true);
  view.setUint16(centralAt + 8, entries.length, true);
  view.setUint16(centralAt + 10, entries.length, true);
  view.setUint32(centralAt + 12, centralSize, true);
  view.setUint32(centralAt + 16, localSize, true);
  return out;
}

/** CSV 转义（与 roster/users 同一约定）。 */
export function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 由表头与行构建 CSV。 */
export function buildCsv(header: string[], rows: (string | number | null)[][]): string {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(row.map((v) => csvEscape(v === null ? "" : String(v))).join(","));
  return lines.join("\n") + "\n";
}
