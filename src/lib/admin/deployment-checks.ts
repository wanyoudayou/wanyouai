import {
  inspectConfig,
  optionalGroups,
  type ConfigStatus,
} from "../config/registry.mjs";

export type DeploymentCheck = {
  id: string;
  title: string;
  status: ConfigStatus | "unverified";
  hint: string;
  href?: string;
  hrefLabel?: string;
  steps?: string[];
};
export type DeploymentReport = {
  sections: { title: string; description?: string; checks: DeploymentCheck[] }[];
};
export type SetupSite = {
  identityReady: boolean;
  paymentEnabled: boolean;
  paymentChannelsReady: boolean;
  avatarEnabled: boolean;
  avatarModelReady: boolean;
};
export type DeploymentGateway = {
  isOwner(): Promise<boolean>;
  env(): Record<string, string | undefined>;
  schemaVersion(): Promise<string>;
  site(): Promise<SetupSite>;
  aiStatus(): Promise<{ generation: ConfigStatus; embedding: ConfigStatus; knowledge: ConfigStatus; avatar: ConfigStatus }>;
  turnstileStatus?(): Promise<ConfigStatus>;
  mediaReady(): Promise<boolean>;
  hasPublishedContent(): Promise<boolean>;
  mailQueue(): Promise<{ dead: number; oldest_due_seconds: number }>;
};

/** Authorization precedes every environment read and authority probe. Errors never enter the report. */
export async function inspectDeployment(
  gateway: DeploymentGateway,
  expectedVersion: string,
): Promise<DeploymentReport> {
  if (!(await gateway.isOwner())) throw new Error("需要站主身份");
  const env = gateway.env();
  const config = inspectConfig(env, { existingSite: true });
  const groupTitles: Record<string, string> = {
    payment: "在线支付环境配置",
    transactional_email: "事务邮件（权益通知等）环境配置",
    turnstile: "人机校验配置",
  };
  const checks: DeploymentCheck[] = config.map((check) => {
    const group = optionalGroups.find((group) => group.id === check.id);
    const missing =
      group?.keys.filter((key) => {
        const value = env[key]?.trim();
        return !value || /^(your-|replace-)/i.test(value);
      }) ?? [];
    let detail = "";
    if (check.status === "incomplete") {
      detail = missing.length > 0
        ? `缺少：${missing.join("、")}。`
        : check.id === "transactional_email"
          ? "EMAIL_FROM 格式检查未通过；应填写已验证域的发件地址。"
          : "变量已填写，但格式检查未通过。";
    }
    return {
      ...check,
      title: groupTitles[check.id] ?? check.id,
      hint: detail + (check.id === "transactional_email"
        ? "检查当前部署的 RESEND_API_KEY 与 EMAIL_FROM；登录验证码由 Supabase SMTP 发送，能收到登录邮件不代表这里已配置。保存 Vercel 变量后须重新部署。"
        : check.hint),
    };
  });
  const turnstileCheck = checks.find(check => check.id === "turnstile");
  if (turnstileCheck) {
    try { turnstileCheck.status = gateway.turnstileStatus ? await gateway.turnstileStatus() : turnstileCheck.status; }
    catch { turnstileCheck.status = "error"; }
    turnstileCheck.hint = turnstileCheck.status === "error"
      ? "配置暂时无法读取，未判定通过。"
      : "在安全与人机校验中管理开关与密钥对，保存后立即生效；配置齐全不代表真实挑战已验收。";
    turnstileCheck.href = "/admin/security";
  }
  checks.push({
    id: "owner",
    title: "站主身份",
    status: "ready",
    hint: "当前登录账户已通过数据库站主身份校验。",
  });
  const runtime: DeploymentCheck[] = [];
  const onboarding: DeploymentCheck[] = [];
  async function probe(
    id: string,
    title: string,
    hint: string,
    href: string | undefined,
    run: () => Promise<DeploymentCheck["status"]>,
  ) {
    let status: DeploymentCheck["status"];
    try {
      status = await run();
    } catch {
      status = "error";
    }
    return {
      id,
      title,
      status,
      hint:
        status === "error"
          ? "暂时无法完成此项检查。请检查服务连接与权限后刷新；未判定为通过。"
          : hint,
      href,
    };
  }
  let site: SetupSite | null = null;
  const [schema, siteCheck, media, publication] = await Promise.all([
    probe(
      "schema",
      "数据库版本",
      `必须与当前代码版本 ${expectedVersion} 完全一致；不一致时按数据库升级说明处理。版本一致不替代完整权限验收。`,
      undefined,
      async () =>
        (await gateway.schemaVersion()) === expectedVersion
          ? "ready"
          : "incomplete",
    ),
    probe(
      "site_config",
      "站点配置读取",
      "检查真实配置记录，不使用默认内容回退。",
      "/admin/settings",
      async () => {
        site = await gateway.site();
        return "ready";
      },
    ),
    probe(
      "media",
      "图片素材存储",
      "在 Supabase Storage 创建公开图片桶与私有 media-uploads 暂存桶，设置大小和类型限制，步骤见部署指南第 2.4 节。此项只读检查桶设置，实际上传请到素材库测试。",
      "/admin/media",
      async () => ((await gateway.mediaReady()) ? "ready" : "incomplete"),
    ),
    probe(
      "publication",
      "发布第一篇内容",
      "通过内容工作台发布，再退出登录检查公开内容与受限预览。已有公开演示文章也会计为此项存在内容；请自行确认是要发布的作品。",
      "/admin/content",
      async () =>
        (await gateway.hasPublishedContent()) ? "ready" : "incomplete",
    ),
  ]);
  let aiResult: ReturnType<DeploymentGateway["aiStatus"]> | undefined;
  const aiStatus = () => aiResult ??= gateway.aiStatus();
  const [identity, payment, avatar] = await Promise.all([
    probe(
      "identity",
      "填写名片与站点名称",
      "填写站名、站主名、一句话介绍，以及联系邮箱或预约页面；服务语言使用 zh-CN、en 等代码。保存后到 /card 检查公开名片。",
      "/admin/card",
      async () => {
        if (!site) throw new Error();
        return site.identityReady ? "ready" : "incomplete";
      },
    ),
    probe(
      "payment_runtime",
      "在线收款开关与配置",
      "在站点配置中启用并选择支付渠道，同时完成 zpay 三值配置；通过仅表示配置齐全，真实小额支付仍需验收。",
      "/admin/settings",
      async () => {
        if (!site) throw new Error();
        if (!site.paymentEnabled) return "disabled";
        return site.paymentChannelsReady &&
          config.find((check) => check.id === "payment")?.status === "ready"
          ? "ready"
          : "incomplete";
      },
    ),
    probe(
      "avatar_runtime",
      "分身开关与配置",
      "在 AI 设置中保存并检查连接，完整构建并确认启用知识库，再打开分身。未就绪不提供通用聊天。",
      "/admin/ai",
      async () => {
        if (!site) throw new Error();
        return (await aiStatus()).avatar;
      },
    ),
  ]);
  for (const [id, title, key] of [["ai_generation", "共享生成连接", "generation"], ["embedding", "知识库向量连接", "embedding"], ["ai_knowledge", "知识库索引", "knowledge"]] as const) {
    runtime.push(await probe(id, title, "在 AI 设置中查看保存、检查与索引状态与可选诊断结果；此页只读，不发送模型请求。", "/admin/ai", async () => (await aiStatus())[key]));
  }
  runtime.push(schema, siteCheck, media, payment, avatar);
  runtime.push(
    await probe(
      "mail_queue",
      "权益邮件队列",
      "队列存在终止任务或超过 10 分钟的到期积压时需处理。启用事务邮件后，按部署指南配置每分钟邮件调度；空队列不代表发信或调度已通过验收。未启用发信时仍显示已有队列的异常。",
      undefined,
      async () => {
        const health = await gateway.mailQueue();
        return health.dead > 0 || health.oldest_due_seconds > 600
          ? "incomplete"
          : "ready";
      },
    ),
  );
  onboarding.push(identity, publication);
  const cronConfigured =
    Boolean(env.CRON_SECRET?.trim()) &&
    !/^(your-|replace-)/i.test(env.CRON_SECRET?.trim() ?? "");
  runtime.push({
    id: "cron",
    title: "自动任务鉴权配置",
    status:
      config.find((check) => check.id === "transactional_email")?.status === "disabled" &&
      payment.status === "disabled"
        ? "disabled"
        : cronConfigured
          ? "ready"
          : "unverified",
    hint: "邮件发送、支付查单和到期提醒共用独立 CRON_SECRET。保存 Vercel 变量后重新部署；分钟任务需另行建立，每日到期提醒已随代码声明。本项不检查执行记录。已有外部调度使用 PUBLISH_TOKEN 时须单独核对。",
  });
  const auth: DeploymentCheck = {
    id: "auth",
    title: "登录邮件（Supabase SMTP）与回跳验收",
    status: "unverified",
    hint: "此项无法从应用环境变量自动判断；请在 Supabase 配置 SMTP、两份邮件模板和回调地址。建议 Email OTP length 设为 6。登录邮件不依赖应用事务邮件变量或调度。",
    steps: [
      "从正式域名 /admin 用站主邮箱获取新验证码，确认邮件为 6 位并能进入后台。",
      "在另一浏览器从 /login 用普通邮箱首次登录、退出后再次登录；两次都能收信，且普通账户不能进入后台。",
      "另发起一次登录，在发起请求的同一浏览器打开新邮件中的登录链接，确认回到本站正确页面。每次请求只使用验证码或链接其中一种。",
    ],
  };
  const mailAcceptance: DeploymentCheck = {
    id: "mail_acceptance",
    title: "事务邮件与调度验收",
    status: config.find((check) => check.id === "transactional_email")?.status === "disabled"
      ? "disabled" : "unverified",
    hint: "启用后按以下步骤核对；本页不会发送邮件。配置齐全和空队列均不能替代实际送达。",
    steps: [
      "按部署指南启用每分钟 /api/cron/mail-outbox 调度，查看任务记录与应用日志，确认请求通过鉴权且成功执行。",
      "对自己明确同意接收通知的一笔测试购买，核对买家已收到权益通知、队列无积压且没有重复邮件；如同时验收支付，可共用同一笔测试订单。",
      "使用订阅到期提醒时，到 Vercel Crons 核对 expiry-reminder 的执行记录；分钟邮件任务不能替代每日提醒任务。",
    ],
  };
  const paymentAcceptance: DeploymentCheck = {
    id: "payment_acceptance",
    title: "收款、权益与重复通知验收",
    status: payment.status === "error" ? "error"
      : payment.status === "disabled" ? "disabled" : "unverified",
    hint: "只验收已开启的在线收款。以下付款由你自行操作，本页不扣款、不授予权益。",
    href: "/admin/payments",
    hrefLabel: "查看收款订单",
    steps: [
      "用普通买家账户购买自己的小额测试商品并实际付款；返回本站后订单显示已支付，文章或专辑正文解锁，订单可打开对应内容。",
      "换用未购或匿名账户打开同一内容，应只显示允许的预览和购买／登录提示。",
      "按支付运维说明对同一笔已付测试订单重发一次通知，核对仍只有一次权益与通知任务；核对 payment-reconcile 分钟任务成功执行。",
    ],
  };
  const avatarAcceptance: DeploymentCheck = {
    id: "avatar_acceptance",
    title: "分身回答与权限验收",
    status: avatar.status === "error" ? "error"
      : avatar.status === "disabled" ? "disabled" : "unverified",
    hint: "启用分身后再测试；生成请求可能产生模型费用。匿名提问另需开启匿名开关并配置 Turnstile。",
    href: "/admin/avatar",
    steps: [
      "用普通登录账户提问公开内容，确认正常回答、引用能打开；问题涉及未购正文时，只能获得允许的摘要或试读链接，不能出现受限正文。",
      "若开启匿名提问，在无痕窗口完成 Turnstile 后提问；未完成或校验失败时不得生成回答。未开启匿名提问则应提示登录。",
      "设置适合自己的每月生成次数上限；达到限额时应明确提示，不重复自动生成。次数限制不是供应商费用上限。",
    ],
  };
  const manual: DeploymentCheck[] = [
    {
      id: "reading",
      title: "首页、发布与访问权限",
      status: "unverified",
      hint: "使用正式固定域名，分别检查站主、普通用户和匿名访问。",
      href: "/admin/content",
      hrefLabel: "管理测试内容",
      steps: [
        "在无痕窗口打开首页，应直接显示本站，不要求登录 Vercel；检查桌面和手机布局、深浅主题及侧栏入口。",
        "在后台上传一张图片并发布带图文章；打开前台确认文字和图片，再修改发布一次，确认更新可见。",
        "发布一篇带预览的受限测试文章：站主可读，未购普通用户和匿名只能看预览；匿名查看页面源代码及 /llms.txt 均不应含受限正文。已配置收款时另做已购账户检查。",
        "在专辑或独立页面更改侧栏名称和排序，前台应同步；收费方案只展示已配置的真实价格和可用操作。",
      ],
    },
    {
      id: "security",
      title: "数据库与存储权限",
      status: "unverified",
      hint: "自动版本和桶设置检查不替代权限检查。以下核对不需要往业务库载入测试夹具。",
      steps: [
        "在 Supabase SQL Editor 执行源码 supabase/verify.sql，确认每项 passed 为 true；按部署指南核对 Data API 开启、Automatically expose new tables 关闭及自动 RLS。",
        "检查 Supabase Advisors 的错误项，按安全配置文档处理；公开图片桶与私有 media-uploads 暂存桶应保持各自公开／私有设置，不添加普通用户任意写入策略。",
        "若自行修改权限规则，在独立测试库运行权限回归后再升级本站；不要在业务库执行测试夹具。",
      ],
    },
    {
      id: "release",
      title: "备份与发布演练",
      status: "unverified",
      hint: "按备份与恢复指南操作，记录自己使用的源码版本、备份位置和核对结果。此页不保存人工结论。",
      steps: [
        "备份数据库、Auth、Storage 对象与迁移历史；妥善保管环境配置。后台内容 ZIP 只供内容复用，不是整站备份。",
        "在独立空项目验证恢复，再确认恢复后的内容、图片和访问权限；不要覆盖正在使用的站点。",
        "上线前核对 Vercel Production / Current 的 Source 提交和正式域名；升级或回滚先按数据库升级文档确认结构兼容。",
      ],
    },
  ];
  const optional = new Set([
    "payment",
    "transactional_email",
    "turnstile",
    "embedding",
    "ai_generation",
    "ai_knowledge",
    "payment_runtime",
    "avatar_runtime",
    "mail_queue",
    "cron",
  ]);
  const allChecks = [...checks, ...runtime];
  const select = (...ids: string[]) =>
    allChecks.filter((check) => ids.includes(check.id));
  return {
    sections: [
      {
        title: "必需：部署与访问条件",
        checks: allChecks.filter((check) => !optional.has(check.id)),
      },
      {
        title: "首次配置：站点与内容",
        checks: onboarding,
      },
      {
        title: "邮件：登录与业务通知",
        description: "登录邮件在 Supabase 配置；事务邮件在 Vercel 配置。两处可以使用同一个 Resend 账号，但必须分别保存配置。",
        checks: [auth, ...select("transactional_email", "mail_queue"), mailAcceptance],
      },
      {
        title: "可选：支付收款",
        checks: [...select("payment", "payment_runtime"), paymentAcceptance],
      },
      {
        title: "可选：自动任务",
        description: "邮件和支付需要的分钟任务分别配置；只收登录邮件无需启用这些任务。操作步骤见部署指南第 6.3 节。",
        checks: select("cron"),
      },
      {
        title: "可选：AI 分身与匿名人机验证",
        description: "AI 设置统一管理生成、必需的知识库与分身。匿名提问还需人机校验；已登录用户不触发此校验。",
        checks: [
          ...select("ai_generation", "embedding", "ai_knowledge", "avatar_runtime", "turnstile"),
          avatarAcceptance,
        ],
      },
      {
        title: "人工确认：基础站点验收",
        description: "展开每项的操作步骤并核对结果。人工结论由你记录，此页始终显示待人工验收；可选功能关闭时无需为它配置或测试。",
        checks: manual,
      },
    ],
  };
}
