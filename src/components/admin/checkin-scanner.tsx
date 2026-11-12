"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// BarcodeDetector 不在 TS DOM 标准库内，最小声明
declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
  static getSupportedFormats(): Promise<string[]>;
}

type ScanResult = { ok: boolean; message: string };

function extractToken(text: string): string | null {
  const match =
    text.match(/\/checkin\/([0-9a-f-]{36})/i) ??
    text.match(/^([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

/** 站主手机端扫码核销：摄像头扫报名者的核销二维码；不支持扫码的浏览器走手动粘贴。 */
export function CheckinScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [supported] = useState(
    () => typeof window === "undefined" || "BarcodeDetector" in window,
  );
  const [result, setResult] = useState<ScanResult | null>(null);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  const submit = async (raw: string) => {
    const token = extractToken(raw.trim());
    if (!token) {
      setResult({ ok: false, message: "未识别到有效核销码" });
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => null);
      setResult(
        res.ok && data?.ok
          ? {
              ok: true,
              message: data.message?.includes("此前已核销")
                ? "该报名此前已核销（重复出示属正常）"
                : "核销成功 ✓",
            }
          : { ok: false, message: data?.message ?? "核销失败，请重试" },
      );
    } catch {
      setResult({ ok: false, message: "网络异常，请重试" });
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!streamRef.current) return;
        try {
          if (videoRef.current && videoRef.current.readyState >= 2) {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              stopScan();
              await submit(codes[0].rawValue);
              return;
            }
          }
        } catch {
          /* 单帧失败继续 */
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setResult({
        ok: false,
        message: "无法打开摄像头，请检查授权，或改用下方手动输入",
      });
    }
  };

  const stopScan = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  };

  // 支持性在首渲染即判定（客户端组件，无 SSR 窗口期问题）；effect 只负责卸载时关摄像头
  useEffect(() => () => stopScan(), []);

  return (
    <div className="space-y-4">
      {supported ? (
        <div className="space-y-3">
          <video
            ref={videoRef}
            className={`aspect-square w-full rounded-xl bg-foreground/5 object-cover ${scanning ? "" : "hidden"}`}
            muted
            playsInline
          />
          {!scanning ? (
            <Button onClick={startScan} className="w-full">
              打开摄像头扫码
            </Button>
          ) : (
            <Button variant="outline" onClick={stopScan} className="w-full">
              停止扫码
            </Button>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          当前浏览器不支持扫码（建议使用 Chrome / Edge / 新版
          Safari），请用下方手动输入。
        </p>
      )}

      {result && (
        <p
          role="status"
          className={`rounded-lg border p-3 text-sm ${result.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/40 bg-destructive/5 text-destructive"}`}
        >
          {result.message}
        </p>
      )}

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(manual);
        }}
      >
        <label className="block space-y-1 text-sm">
          手动输入（粘贴核销链接或核销码）
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            className="block w-full rounded-md border bg-background p-2 text-sm"
            placeholder="https://…/checkin/xxxxxxxx-xxxx-…"
          />
        </label>
        <Button type="submit" variant="outline" size="sm" disabled={busy}>
          核销
        </Button>
      </form>
    </div>
  );
}
