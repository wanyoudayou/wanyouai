import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { FixtureShell } from "./shell";
import "../../../../src/app/globals.css";
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <FixtureShell>{children}</FixtureShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
