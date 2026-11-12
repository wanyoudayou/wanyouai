"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};
const clientHref = () => {
  const here = `${window.location.pathname}${window.location.search}`;
  return here === "/login" ? "/login" : `/login?next=${encodeURIComponent(here)}`;
};
const serverHref = () => "/login";

/** 登录入口：带上当前站内地址，登录后回到原页面（服务端再校验 next）。 */
export function LoginLink({ children, className }: { children: React.ReactNode; className?: string }) {
  const href = useSyncExternalStore(noSubscription, clientHref, serverHref);
  return <Link href={href} className={className}>{children}</Link>;
}
