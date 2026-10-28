import QRCode from "qrcode";

/** 核销二维码（SVG 字符串，服务端生成）：报名成功卡就地出示，无需进入核销页。 */
export async function checkinQrSvg(checkinUrl: string): Promise<string> {
  return QRCode.toString(checkinUrl, { type: "svg", margin: 1, width: 180, color: { dark: "#1a1a1a", light: "#ffffff" } });
}
