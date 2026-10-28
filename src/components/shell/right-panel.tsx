"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import {
  AtSignIcon,
  BotIcon,
  PanelRightCloseIcon,
  XIcon,
  GlobeIcon,
  MonitorIcon,
  DownloadIcon,
} from "lucide-react";

import { ConversationBody, ConversationBubble, ConversationComposer } from "@/components/reading/conversation";
import { SkillChat, SkillChatProvider } from "@/components/reading/skill-chat";
import { useReadingShell } from "@/components/reading/reading-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CardPanel } from "@/components/card/card-panel";
import { cn } from "@/lib/utils";
import type { PanelPlaceholder } from "@/types/panel";
import { TurnstileWidget } from "@/components/shared/turnstile-widget";

// 气泡 Markdown 渲染与正文同一管线，按需分包加载（首条分身回复时才拉取）。
const ChatMarkdown = dynamic(
  () =>
    import("@/components/reading/chat-markdown").then((m) => m.ChatMarkdown),
  { ssr: false },
);

/**
 * 右栏 = 对话区（与分身）。问答走 /api/avatar/ask（检索全域、注入分级、AI 标注）。
 * 钉载：文章页自动带当前文章 slug；@引用手动加钉（封顶 3）。
 * 匿名：站点开启匿名入口且配置 Turnstile 时才可用，否则提示登录。
 */

interface ChatMessage {
  role: "user" | "avatar";
  content: string;
}

interface MentionItem {
  slug: string;
  title: string;
  kind: string;
}

interface RightPanelApi {
  available: boolean;
  ask: (question: string, pins?: string[], turnstileToken?: string) => void;
  escalate: (message: string) => void;
  setPlaceholder: (placeholder: PanelPlaceholder) => void;
}

/** 分身对话区只出现的页面：首页 + 内文详情页（博客/手册/技能/服务）。 */
export function isAvatarPage(pathname: string): boolean {
  return (
    pathname === "/" ||
    /^\/(blog|collections|handbooks|skills|services)\/[^/]+/.test(pathname)
  );
}

const RightPanelContext = createContext<RightPanelApi>({
  available: false,
  ask: () => {},
  escalate: () => {},
  setPlaceholder: () => {},
});

export function useRightPanel(): RightPanelApi {
  return useContext(RightPanelContext);
}

/** 桌面右栏折叠状态（≥1280 生效）：由 Provider 持有，骨架据此调整第三列宽度。 */
const RightPanelCollapseContext = createContext<{
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
}>({
  collapsed: false,
  setCollapsed: () => {},
});

export function useRightPanelCollapse() {
  return useContext(RightPanelCollapseContext);
}

function EmptyStateView({ placeholder }: { placeholder: PanelPlaceholder }) {
  if (placeholder.kind === "card") {
    return (
      <div className="p-4">
        <CardPanel card={placeholder.card} compact />
      </div>
    );
  }
  if (placeholder.kind === "tips") {
    return (
      <div className="space-y-2 p-4">
        <p className="text-sm font-medium">{placeholder.title}</p>
        <ul className="space-y-1.5 text-sm leading-[1.7] text-muted-foreground">
          {placeholder.items.map((tip, index) => (
            <li key={index} className="rounded-lg border bg-muted/50 px-3 py-2">
              {tip}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <p className="py-8 text-center text-sm leading-[1.7] text-muted-foreground">
      站主的分身坐在这里。
      <br />
      先用一句问题开场，例如「这份手册适合我吗？」
    </p>
  );
}

/** 「思考中」动效：三点循环累加（. → .. → ...），不可见占位保持宽度稳定。 */
function ThinkingBubble() {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => setDots((d) => (d % 3) + 1), 400);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex justify-start">
      <p
        className="rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
        role="status"
        aria-label="分身正在思考"
      >
        思考中{".".repeat(dots)}
        <span className="invisible" aria-hidden>
          {".".repeat(3 - dots)}
        </span>
      </p>
    </div>
  );
}

function ChatPanel({
  messages,
  sending,
  onAsk,
  onEscalate,
  placeholder,
  needTurnstile,
  turnstileSiteKey,
  className,
}: {
  messages: ChatMessage[];
  sending: boolean;
  onAsk: (question: string, pins: string[], turnstileToken?: string) => void;
  onEscalate: (message: string) => void;
  placeholder: PanelPlaceholder;
  needTurnstile: boolean;
  turnstileSiteKey: string | null;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const [chips, setChips] = useState<MentionItem[]>([]);
  const [candidates, setCandidates] = useState<MentionItem[]>([]);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [escalating, setEscalating] = useState(false);
  const [escalation, setEscalation] = useState("");
  const mentionMatch = /@([^\s@]{0,30})$/.exec(draft);
  useEffect(() => {
    const q = mentionMatch?.[1];
    const timer = setTimeout(
      async () => {
        if (q === undefined) {
          setCandidates([]);
          return;
        }
        try {
          const res = await fetch(
            `/api/avatar/mentions?q=${encodeURIComponent(q)}`,
          );
          const data = await res.json();
          setCandidates(Array.isArray(data.items) ? data.items : []);
        } catch {
          setCandidates([]);
        }
      },
      q === undefined ? 0 : 250,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionMatch?.[0]]);

  const pickMention = (item: MentionItem) => {
    setChips((prev) =>
      prev.some((c) => c.slug === item.slug)
        ? prev
        : [...prev, item].slice(0, 3),
    );
    setDraft((prev) => prev.replace(/@[^\s@]{0,30}$/, ""));
    setCandidates([]);
  };

  const submit = () => {
    const question = draft.trim();
    if (!question || sending) return;
    if (needTurnstile && !turnstileToken) return;
    onAsk(
      question,
      chips.map((c) => c.slug),
      turnstileToken ?? undefined,
    );
    setDraft("");
    setChips([]);
    setTurnstileToken(null);
    setTurnstileKey((k) => k + 1); // Turnstile token 一次性，重挂组件取新 token
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <ConversationBody scrollKey={`${messages.length}:${messages.at(-1)?.content.length ?? 0}:${sending}`}>
        {messages.length === 0 ? <EmptyStateView placeholder={placeholder} /> : messages.map((message, index) => (
          <ConversationBubble key={index} user={message.role === "user"}>
            {message.role === "user" ? message.content : message.content === "" ? <span className="text-muted-foreground"> </span> : <ChatMarkdown markdown={message.content} />}
          </ConversationBubble>
        ))}
        {sending && <ThinkingBubble />}
      </ConversationBody>
      {!escalating && chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t px-3 pt-2 pb-3">
          {chips.map((chip) => (
            <span
              key={chip.slug}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
            >
              @{chip.title}
              <button
                type="button"
                aria-label={`移除 ${chip.title}`}
                onClick={() =>
                  setChips((prev) => prev.filter((c) => c.slug !== chip.slug))
                }
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative border-t p-3">
        {candidates.length > 0 && (
          <ul className="absolute inset-x-3 bottom-full z-10 mb-1 max-h-48 overflow-y-auto rounded-lg border bg-popover shadow-md">
            {candidates.map((item) => (
              <li key={item.slug}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                  onClick={() => pickMention(item)}
                >
                  <AtSignIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {item.kind}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {needTurnstile && turnstileSiteKey && (
          <TurnstileWidget
            key={turnstileKey}
            siteKey={turnstileSiteKey}
            onToken={setTurnstileToken}
          />
        )}
        {escalating ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              给站主留言（会进入收件箱并邮件提醒站主；每日限 3 条）
            </p>
            <textarea
              value={escalation}
              onChange={(event) => setEscalation(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="想请站主本人回答什么？需要的话留下联系方式。"
              aria-label="给站主留言"
              className="block w-full resize-none rounded-2xl border bg-muted/40 p-3 text-sm leading-[1.7] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!escalation.trim()}
                onClick={() => {
                  onEscalate(escalation.trim());
                  setEscalation("");
                  setEscalating(false);
                }}
              >
                提交留言
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEscalating(false)}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <>
            <ConversationComposer value={draft} onChange={setDraft} onSubmit={submit} disabled={sending}
              sendDisabled={needTurnstile && !turnstileToken} label="向站主的分身提问" placeholder="向站主的分身提问…（@ 引用站内内容）" maxLength={2000} />
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-2 text-xs"
                onClick={() => setEscalating(true)}
                aria-label="转人工"
              >
                转人工
              </Button>
              <span className="text-xs text-muted-foreground">
                Enter 发送 · Shift+Enter 换行
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface PanelState {
  messages: ChatMessage[];
  sending: boolean;
  placeholder: PanelPlaceholder;
  onAsk: (question: string, pins: string[], turnstileToken?: string) => void;
  onEscalate: (message: string) => void;
  avatarModel: string | null;
  avatarEnabled: boolean;
  needTurnstile: boolean;
  turnstileSiteKey: string | null;
}

const RightPanelStateContext = createContext<PanelState | null>(null);

function subscribeViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const panelSurface = () => window.innerWidth >= 1280 ? "desktop" : window.innerWidth >= 768 ? "right" : "bottom";
const serverPanelSurface = () => "desktop";

/** Desktop sidebar and narrow-screen drawers share the same Skill conversation state. */
export function RightPanelSurfaces() {
  const reading = useReadingShell();
  const chat = reading?.skillPanel?.chat;
  const pathname = usePathname();
  const key = `${pathname}:${chat?.skill ?? (reading?.skillPanel ? "skill" : "avatar")}`;
  return chat ? <SkillChatProvider key={key} {...chat}><RightPanelContent /></SkillChatProvider> : <RightPanelContent key={key} />;
}

function RightPanelContent() {
  const state = useContext(RightPanelStateContext);
  if (!state) {
    throw new Error(
      "RightPanelSurfaces must be rendered inside RightPanelProvider",
    );
  }
  const { avatarEnabled } = state;
  const pathname = usePathname();
  const reading = useReadingShell();
  const skillPanel = reading?.skillPanel;
  const [skillMode, setSkillMode] = useState(skillPanel?.initialMode ?? "download");
  const onlineAvailable = !!(skillPanel?.chat || skillPanel?.online);
  const switchSkillMode = () => {
    const mode = skillMode === "download" ? "online" : "download";
    setSkillMode(mode);
    const url = new URL(window.location.href);
    if (mode === "online") url.searchParams.set("panel", "online"); else url.searchParams.delete("panel");
    window.history.replaceState(null, "", url);
  };
  const hasSkillPanel = !!skillPanel;
  const { collapsed, setCollapsed } = useRightPanelCollapse();
  const panelAvailable = !!skillPanel || avatarEnabled;
  const visible = panelAvailable && isAvatarPage(pathname);
  const [tab, setTab] = useState("conversation");
  const surface = useSyncExternalStore(subscribeViewport, panelSurface, serverPanelSurface);
  const [sheetOpen, setSheetOpen] = useState(skillPanel?.initialMode === "online");
  const sheetSide = surface === "bottom" ? "bottom" : "right";

  const openSheet = useCallback(() => setSheetOpen(true), []);

  useEffect(() => {
    const close = () => setSheetOpen(false);
    window.addEventListener("wanyou:open-navigation", close);
    return () => window.removeEventListener("wanyou:open-navigation", close);
  }, []);

  useEffect(() => {
    const open = () => {
      setTab("conversation");
      setCollapsed(false);
      if (window.innerWidth < 1280)
        openSheet();
    };
    window.addEventListener("wanyou:open-reading-panel", open);
    return () => window.removeEventListener("wanyou:open-reading-panel", open);
  }, [openSheet, setCollapsed]);

  const { onAsk } = state;
  const articleSlug = reading?.articleSlug ?? null;
  const ask = useCallback(
    (question: string, pins: string[], turnstileToken?: string) => {
      // 钉载：文章页自动带当前章节 slug（可信来源 = 服务端渲染上下文，不含正文）
      const merged = [...(articleSlug ? [articleSlug] : []), ...pins].slice(
        0,
        4,
      );
      setCollapsed(false);
      onAsk(question, merged, turnstileToken);
      if (window.innerWidth < 1280) {
        openSheet();
      }
    },
    [onAsk, openSheet, articleSlug, setCollapsed],
  );

  const panel = (className?: string, inSheet = false) => (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className={cn("flex items-start justify-between gap-2 border-b px-4 py-3", inSheet && hasSkillPanel && "pr-14")}>
        <div className="min-w-0">
          <p className="text-sm font-medium">{skillPanel ? skillMode === "download" ? "下载安装Skill" : "在线测试Skill" : "站主分身"}</p>
          <p className="text-xs text-muted-foreground">
            {skillPanel ? onlineAvailable ? <button type="button" className="text-left text-primary underline underline-offset-4" onClick={switchSkillMode}>{skillMode === "download" ? "切换成在线测试" : "切换成下载安装"}</button> : "下载后在你使用的 Agent 中安装" : avatarEnabled
              ? "AI 生成 · 仅供参考 · 合作请转人工"
              : "站主暂未开启分身"}
          </p>
        </div>
        {/* 折叠符号：桌面右栏收起为窄条（<1280 本来就是窄条，故仅在 xl 显示） */}
        {skillPanel ? onlineAvailable && <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={switchSkillMode} aria-label={skillMode === "download" ? "打开 Skill 在线测试" : "打开 Skill 下载安装"} title={skillMode === "download" ? "在线测试" : "本机安装"}>{skillMode === "download" ? <GlobeIcon /> : <MonitorIcon />}</Button> : <Button
          variant="ghost"
          size="icon"
          className="hidden size-7 shrink-0 xl:inline-flex"
          onClick={() => setCollapsed(true)}
          aria-label="收起对话区"
          title="收起对话区"
        >
          <PanelRightCloseIcon />
        </Button>}
      </div>
      {skillPanel ? <>
        <div hidden={skillMode !== "download"} className="min-h-0 flex-1 overflow-y-auto p-4">{skillPanel.content}</div>
        {skillMode === "online" && (skillPanel.chat ? <SkillChat /> : <div className="min-h-0 flex-1 overflow-y-auto p-4">{skillPanel.online}</div>)}
      </> : reading ? (
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList className="mx-4 mt-3">
            <TabsTrigger value="conversation">
              {reading.discussion ? "本页讨论" : "私聊"}
            </TabsTrigger>
            <TabsTrigger value="outline">本页目录</TabsTrigger>
          </TabsList>
          <TabsContent
            value="conversation"
            className="flex min-h-0 flex-1 flex-col"
          >
            <ChatPanel
              messages={state.messages}
              sending={state.sending}
              onAsk={ask}
              onEscalate={state.onEscalate}
              placeholder={state.placeholder}
              needTurnstile={state.needTurnstile}
              turnstileSiteKey={state.turnstileSiteKey}
            />
          </TabsContent>
          <TabsContent
            value="outline"
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {reading.outline}
          </TabsContent>
        </Tabs>
      ) : (
        <ChatPanel
          messages={state.messages}
          sending={state.sending}
          onAsk={ask}
          onEscalate={state.onEscalate}
          placeholder={state.placeholder}
          needTurnstile={state.needTurnstile}
          turnstileSiteKey={state.turnstileSiteKey}
        />
      )}
    </div>
  );

  if (!panelAvailable || (!visible && !sheetOpen)) return null;

  return (
    <>
      {/* xl+：展开 = 三栏常显；折叠 = 完全收起（不保留窄条），右上角机器人图标展开 */}
      {visible && (hasSkillPanel || !collapsed) && (
        <aside className="opc-glass hidden min-h-0 border-l xl:block">
          {panel("sticky top-0 h-dvh")}
        </aside>
      )}
      {visible && collapsed && !hasSkillPanel && (
        <Button
          className="fixed top-4 right-4 z-40 hidden rounded-full border bg-background shadow-sm xl:inline-flex"
          size="icon"
          variant="ghost"
          onClick={() => setCollapsed(false)}
          aria-label="展开对话区"
          title={skillPanel ? "下载安装Skill" : "问分身"}
        >
          {skillPanel ? <DownloadIcon /> : <BotIcon />}
        </Button>
      )}

      {/* 1024–1280：无窄条，右上角机器人图标点开右侧滑出 */}
      <Button
        className="fixed top-4 right-4 z-40 hidden rounded-full border bg-background shadow-sm md:inline-flex xl:hidden"
        size="icon"
        variant="ghost"
        onClick={openSheet}
        aria-label={skillPanel ? "打开 Skill 面板" : "打开对话区"}
        title={skillPanel ? "下载安装Skill" : "问分身"}
      >
        {skillPanel ? <DownloadIcon /> : <BotIcon />}
      </Button>

      <Sheet open={sheetOpen && surface !== "desktop"} onOpenChange={setSheetOpen}>
        <SheetContent
          side={sheetSide}
          className={cn(
            "w-full gap-0 p-0 sm:max-w-md",
            sheetSide === "bottom" && "h-[80dvh] max-h-[80dvh]",
          )}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{skillPanel ? skillMode === "download" ? "下载安装Skill" : "在线测试Skill" : "站主分身"}</SheetTitle>
          </SheetHeader>
          {panel(undefined, true)}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function RightPanelProvider({
  avatarModel,
  avatarEnabled,
  avatarAnonymous,
  turnstileSiteKey,
  loggedIn,
  children,
}: {
  avatarModel: string | null;
  avatarEnabled: boolean;
  avatarAnonymous: boolean;
  turnstileSiteKey: string | null;
  loggedIn: boolean;
  children: React.ReactNode;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [placeholder, setPlaceholder] = useState<PanelPlaceholder>({
    kind: "default",
  });
  const [collapsed, setCollapsed] = useState(false);

  const needTurnstile = !loggedIn && avatarAnonymous && !!turnstileSiteKey;

  const ask = useCallback(
    async (question: string, pins: string[] = [], turnstileToken?: string) => {
      if (!avatarEnabled) {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: question },
          {
            role: "avatar",
            content:
              "站主分身当前未开启。可以先浏览名片与内容目录，或稍后再试。",
          },
        ]);
        return;
      }
      setMessages((prev) => [...prev, { role: "user", content: question }]);
      setSending(true);
      try {
        const res = await fetch("/api/avatar/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question,
            pins,
            ...(turnstileToken ? { turnstileToken } : {}),
          }),
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as {
            message?: string;
          } | null;
          setMessages((prev) => [
            ...prev,
            {
              role: "avatar",
              content: data?.message ?? "分身暂时不可用，请稍后再试。",
            },
          ]);
          return;
        }
        // 流式：先插入空气泡，逐段追加（生成层实时可见；非生成路径一次性出现）
        setMessages((prev) => [...prev, { role: "avatar", content: "" }]);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const delta = decoder.decode(value, { stream: true });
          if (delta) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "avatar")
                next[next.length - 1] = {
                  ...last,
                  content: last.content + delta,
                };
              return next;
            });
          }
        }
        // 流结束但气泡为空（异常路径兜底）：替换为降级文案，不留空白气泡
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "avatar" && last.content === "")
            next[next.length - 1] = {
              ...last,
              content: "分身暂时不可用，请稍后再试。",
            };
          return next;
        });
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "avatar", content: "网络异常，请稍后再试。" },
        ]);
      } finally {
        setSending(false);
      }
    },
    [avatarEnabled],
  );

  const escalate = useCallback(async (message: string) => {
    setMessages((prev) => [
      ...prev,
      { role: "user", content: `【转人工】${message}` },
    ]);
    try {
      const res = await fetch("/api/avatar/escalate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      setMessages((prev) => [
        ...prev,
        {
          role: "avatar",
          content: data?.message ?? "已转达站主，会尽快回复。",
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "avatar", content: "网络异常，请稍后再试。" },
      ]);
    }
  }, []);

  const handleSetPlaceholder = useCallback((next: PanelPlaceholder) => {
    setPlaceholder(next);
  }, []);

  return (
    <RightPanelCollapseContext.Provider value={{ collapsed, setCollapsed }}>
      <RightPanelContext.Provider
        value={{ available: avatarEnabled, ask, escalate, setPlaceholder: handleSetPlaceholder }}
      >
        <RightPanelStateContext.Provider
          value={{
            messages,
            sending,
            placeholder,
            onAsk: ask,
            onEscalate: escalate,
            avatarModel,
            avatarEnabled,
            needTurnstile,
            turnstileSiteKey,
          }}
        >
          {children}
        </RightPanelStateContext.Provider>
      </RightPanelContext.Provider>
    </RightPanelCollapseContext.Provider>
  );
}
