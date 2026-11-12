export type SectionDecision =
  | { state: "missing" }
  | { state: "login" }
  | { state: "subscribe" }
  | { state: "open"; preview: boolean };

/**
 * 栏目访问判定（纯函数，便于回归）：
 * 登记表没有 → 404；导航未启用 → 仅站主预览，其他人 404；
 * 登录可见 / 订阅可见在服务端判定，站主始终可进入。
 */
export function decideSectionAccess(input: {
  registered: boolean;
  enabled: boolean;
  access: "public" | "login" | "subscriber" | null;
  loggedIn: boolean;
  subscribed: boolean;
  owner: boolean;
}): SectionDecision {
  if (!input.registered) return { state: "missing" };
  if (input.owner) return { state: "open", preview: !input.enabled };
  if (!input.enabled) return { state: "missing" };
  if (input.access === "login" && !input.loggedIn) return { state: "login" };
  if (input.access === "subscriber" && !input.loggedIn) return { state: "login" };
  if (input.access === "subscriber" && !input.subscribed) return { state: "subscribe" };
  return { state: "open", preview: false };
}
