# 使用 Resend 配置邮箱验证码登录

本应用已提供验证码输入界面。站主从 `/admin` 登录，普通用户从 `/login` 登录；Supabase Auth 生成并验证验证码，Resend 通过 SMTP 发送邮件。无需编写 Edge Function 或登录发信接口。

先按[部署指南](guide.md#3-vercel-部署)完成 Vercel Production 部署。正式上线推荐先[绑定自有网站域名](guide.md#4-配置自有域名推荐)，确认固定 HTTPS 地址与 `SITE_URL` 一致，再配置 Auth 与登录邮件。网站暂用 Vercel 默认域名也能运行，但使用 Resend 发信必须先验证自己控制的发件域名；不能用 `*.vercel.app` 代替。网站和邮件可分别使用 `www.example.com`、`auth.example.com`，无需购买两个根域名。Resend 的验证域是 [SMTP 对接前置条件](https://resend.com/docs/send-with-supabase-smtp)。

## 先区分两种邮件

| 用途 | 配置位置 | 必需内容 |
| --- | --- | --- |
| 登录验证码、登录链接 | Supabase → Authentication → Emails → SMTP Settings；Email Templates | SMTP 发件人和凭据、验证码模板、Auth 回调地址 |
| 付款后的权益通知等事务邮件 | Vercel 环境变量及[邮件调度](../operations/payment-mail-outbox.md) | `RESEND_API_KEY`、`EMAIL_FROM` 与队列调度 |

只填写 Vercel 的 `RESEND_API_KEY` **不会启用邮箱验证码登录**。登录邮件不经过应用邮件队列，不需要 `CRON_SECRET`。下面的配置须在自己的 Supabase 项目中保存；安装 SQL、导入示例内容均不会代为设置 SMTP 或邮件模板。

## 免费项目：先保存自定义 SMTP，再编辑模板

**2026 年 6 月 3 日起新建的 Supabase Free 托管项目，使用默认 SMTP 时不能修改 Auth 邮件模板。启用并保存自定义 SMTP 后，即可编辑模板，无需仅为此升级 Supabase 套餐。** 这是 [Supabase 的模板自定义规则](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)。此前创建的免费项目与 Pro 及以上项目不受这项新建项目限制；公开登录仍须按 [SMTP 指南](https://supabase.com/docs/guides/auth/auth-smtp)配置自己的发信服务。

| 新建 Free 项目的发信配置 | Email Templates 状态 | 下一步 |
|---|---|---|
| Supabase 默认 SMTP | 不可自定义 | 先完成本页的 Resend 准备和 Supabase SMTP 配置 |
| 已启用并保存自定义 SMTP | 可自定义 | 编辑 Confirm sign up 和 Magic link or OTP 两份模板 |

本指南采用 **Resend 作为自定义 SMTP 服务商**；Supabase 并不限定使用 Resend，其他兼容 SMTP 服务也可以。只注册 Resend、验证域名或在 Vercel 填写 API Key，都不能代替在 Supabase 启用并保存自定义 SMTP。

操作顺序：**Resend 验证发件域并创建 API Key → Supabase SMTP Settings 启用、填写并保存 → Email Templates 编辑并保存两份模板 → 实际登录收信验证**。

## 1. 在 Resend 准备发件域和密钥

以下用站点 `https://www.example.com`、发件域 `auth.example.com` 举例；请替换为自己控制的域名。

1. 登录 [Resend](https://resend.com)，打开 **Domains → Add Domain**，添加 `auth.example.com`。
2. 在域名的 DNS 服务商处，按 Resend 页面逐条填写记录的类型、名称、值和优先级。使用 Resend 为该域生成的 SPF、DKIM 等记录，不复制其他项目的 DNS 值；已有同名 SPF 记录时先核对，避免重复配置。
3. 回到 Resend 核验，等发件域显示 **Verified**。可使用 `no-reply@auth.example.com` 发信，无需先创建同名收件邮箱；若验证的是其他域，发件地址也须属于那个已验证域。
4. 打开 **API Keys → Create API Key**，例如命名为 `supabase-auth`，选择 **Sending access**，限定到刚验证的发件域。创建后立即复制并安全保存完整 API Key；它将作为 Supabase SMTP 的 Password，**不加 `Bearer`、引号或空格**。
5. 登录发件域关闭邮件跟踪，尤其是 **Click tracking**，避免供应商改写一次性登录链接。

可为应用事务邮件另建一枚密钥，方便独立轮换。两处可以使用同一个 Resend 账号，但须分别保存配置。域名及凭据规则见 [Resend 域名说明](https://resend.com/docs/dashboard/domains/introduction)、[API Key 说明](https://resend.com/docs/dashboard/api-keys/introduction)。

## 2. 在 Supabase 启用并保存自定义 SMTP

打开自己的 Supabase 项目 → **Authentication → Emails → SMTP Settings**，启用 **Enable custom SMTP**，逐项填写：

| Supabase 表单字段 | 本例填写值 | 来源与注意事项 |
| --- | --- | --- |
| Sender email address | `no-reply@auth.example.com` | 自选的已验证域下地址；这里只填地址，不填 `名称 <地址>` |
| Sender name | `我的站点` | 读者看到的发件人名称，可改为自己的站名 |
| Host | `smtp.resend.com` | Resend SMTP 固定主机 |
| Port number | `465` | 本例使用隐式 SSL/TLS；若选择 STARTTLS，则使用 `587` |
| Username | `resend` | 固定值，不是发件邮箱或 Resend 登录邮箱 |
| Password | Resend 中 `supabase-auth` 密钥的完整值 | 不是 Supabase anon/service-role key，也不是邮箱登录密码 |

点击 **Save changes**，确认保存成功；重新打开同一项目的 **SMTP Settings**，确认 **Enable custom SMTP** 保持开启。完成后再进入 Email Templates。仅填表但未保存时，新建 Free 项目的模板仍不可编辑。这些参数只保存在 Supabase Dashboard，**不需要增加应用的 `SMTP_*` 环境变量**。参见 [Resend 对接 Supabase SMTP](https://resend.com/docs/send-with-supabase-smtp)、[SMTP 端口与加密方式](https://resend.com/docs/send-with-smtp)。

Supabase 默认 SMTP 只向项目组织成员发信，不能用于公开登录；自定义 SMTP 还负责让非组织成员的普通用户正常收信。相关限制见 [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)。

## 3. 配置验证码邮件模板

前置条件：已在**同一 Supabase 项目**启用并保存自定义 SMTP。然后在 **Authentication → Emails → Email Templates** 分别打开下面两个模板，**两处都保存**：

| 模板 | 用途 | Subject 示例 |
| --- | --- | --- |
| Confirm sign up / Confirm signup | 尚未验证的新用户首次登录 | `登录验证码` |
| Magic link or OTP / Magic Link | 已验证用户再次登录 | `登录验证码` |

本应用允许首次登录时创建账户，新用户可能收到注册确认邮件；只修改 Magic Link 模板会遗漏首次登录。此行为可核对 [Supabase Auth 的新用户处理](https://github.com/supabase/auth/blob/master/internal/api/magic_link.go)。

每个模板的 **Body** 都替换为仓库中 [supabase/templates/login.html](../../supabase/templates/login.html) 的完整内容，然后保存。GitHub 页面请打开 **Raw** 后复制 HTML，不要复制网页预览，也不要连同 Markdown 的代码围栏一起粘贴。

模板的关键部分如下：

```html
<p>请回到发起登录的页面，输入以下验证码：</p>
<p>{{ .Token }}</p>
<p>也可在发起登录的同一浏览器打开：<a href="{{ .ConfirmationURL }}">登录本站</a></p>
```

- `{{ .Token }}` 是 Supabase 自动替换的数字验证码，必须保留原样，不手填测试数字。
- `{{ .ConfirmationURL }}` 是完整的一次性验证链接，必须保留原样；不要替换成首页、`{{ .RedirectTo }}` 或自行拼接的 `token_hash` 地址。
- `{{ .SiteURL }}` 用来标识登录的站点，由下面的 Auth Site URL 提供；模板无需硬编码个人品牌或实例域名。
- 验证码与链接属于同一次登录请求，只需使用其中一种；已经成功登录后，同一封邮件不能再用于另一次登录。

完整模板不包含固定有效分钟数、外部字体或图片。可调整文案与样式，但须保留上述变量；变量规则见 [Supabase 邮件模板](https://supabase.com/docs/guides/auth/auth-email-templates)。

## 4. 配置站点、回调与有效期

Vercel **Production** 的 `SITE_URL` 填自己的固定站点根地址。本例为：

```text
SITE_URL=https://www.example.com
```

在 Supabase **Authentication → URL Configuration** 保存：

```text
Site URL:       https://www.example.com
Redirect URLs:  https://www.example.com/auth/callback
                https://www.example.com/login/callback
```

`/auth/callback` 用于站主登录，`/login/callback` 用于普通用户登录。Preview 使用独立测试 Supabase 项目，在测试项目设置对应地址，不修改生产项目的 Site URL。应用环境的 `SITE_URL` 改动后须重新部署，Dashboard 的 SMTP 和模板改动保存后即可用于新发起的登录请求。

**从 Vercel 默认域名切换到自有域名**：先绑定新域名并确认 HTTPS；在 Redirect URLs 中新增新域名的两条精确回调，暂留旧条目，再将 Supabase Site URL 与 Vercel Production `SITE_URL` 替换为新根地址并重新部署。新域名登录验证通过、旧地址不再用于登录且此前登录邮件过期后，删除不再使用的旧回调。Site URL 保持一个主地址；Redirect URLs 只保留实际需要的地址，完整步骤见[域名切换](guide.md#后续改用自有域名)。

换域名后从新域名重新发起登录。保留旧回调白名单不会迁移浏览器会话；旧邮件链接失效时，在新域名重新申请验证码／链接。

在 **Authentication → Sign In / Providers → Email** 核对 Email 登录已启用；公开接受新用户时允许注册，保持邮箱验证开启。在同一 Email 设置页将 **Email OTP length** 设为 **6** 并保存，这是验证码位数，不是 **Minimum password length**（密码长度）；模板的 `{{ .Token }}` 会输出实际生成的验证码，仅修改模板文案不能改变位数。再在 **Email OTP expiration** 中查看或设置有效期（单位：秒，例如 `600` 为 10 分钟）。在 **Authentication → Rate Limits** 核对发信限额，并兼顾 Resend 的额度；不要为解决一次限频错误直接取消限制。界面分组以当前 Dashboard 为准，规则见 [Supabase 邮箱免密登录](https://supabase.com/docs/guides/auth/auth-email-passwordless)。

验证码可在手机收信后输入电脑上的登录页面。链接采用 PKCE 流程，须在发起请求的**同一浏览器及设备**打开；普通窗口与无痕窗口也不是同一个会话。跨设备优先使用验证码，见 [PKCE 说明](https://supabase.com/docs/guides/auth/sessions/pkce-flow)。

## 5. 在实际站点验证

1. 从固定 Production 域名访问 `/admin`，填写 Vercel `OWNER_EMAIL` 指定的站主邮箱，收到设置保存后新申请的邮件，确认验证码为 6 位，再在原页面输入。全新站点应完成站主认领并进入后台；已认领站点仍以数据库中的站主身份为准。
2. 使用一个**不属于 Supabase 项目组织、且尚未注册**的邮箱访问 `/login`，确认首次收到的邮件也含验证码，输入后进入 `/me`。它应能使用普通账户，不能认领站主。
3. 退出该普通账户，按项目限频要求等待后重新请求邮件，确认再次登录仍能用验证码。
4. 如需验证链接兜底，另发起一次独立登录请求，在发起请求的同一浏览器打开新邮件中的链接，确认站主回到 `/admin`、普通用户回到 `/me`。不要重复使用已核销的验证码或链接。

模板预览、Resend 显示已发送或 `/admin/setup` 配置检查，均不能代替实际收信和成功登录。原始验证码、登录链接和完整密钥不应放入验收截图、工单或仓库。

## 常见问题

| 现象 | 核对方法 |
| --- | --- |
| 验证码已通过，但没有站主权限或显示站主验证失败 | 核对 Vercel 当前环境的 `SUPABASE_SERVICE_ROLE_KEY`：从 `NEXT_PUBLIC_SUPABASE_URL` 指向的 Supabase 项目取得 `sb_secret_…` Secret key 或 Legacy `service_role`，不能填 `sb_publishable_…` / anon 公钥；Vercel 的 Secret 类型不改变密钥权限。修正后重新部署，退出并从 `/admin` 获取新验证码登录。若提示邮箱不匹配，另核对 `OWNER_EMAIL`；已有站主不会因改值转移 |
| 邮件只有链接，没有数字验证码 | 检查两个模板的 Body 都含 `{{ .Token }}`，已保存到正确的 Supabase 项目，并重新请求邮件 |
| 老用户有验证码，新用户没有 | 补齐 Confirm sign up 模板，再按限频要求重新发起首次登录 |
| 模板编辑被锁定 | 回到同一 Supabase 项目的 SMTP Settings，确认 Enable custom SMTP 已开启且保存成功，再重新打开模板页；新建 Free 项目使用默认 SMTP 时不可编辑。仅在 Resend 或 Vercel 保存密钥不会解锁 |
| 普通用户收不到，组织成员能收到 | 检查是否仍在使用 Supabase 默认 SMTP，而不是已保存的 Resend SMTP |
| 提示发送失败或限频 | 在 Supabase Auth 日志核对请求时间和错误；检查 SMTP 凭据、发件域、Supabase 发信限额与 Resend 额度。按提示等待或修正配置，不连续重发 |
| Resend 已接受但收件箱没有 | 检查 Resend 邮件记录中的投递、退信或拦截状态，核对 DNS 与垃圾邮件箱；“已发送”不等于已送达 |
| 验证码无效或已过期 | 核对请求邮箱与邮件，使用最新一次请求的验证码；已使用的码不可复用，过期后再按限频要求请求 |
| 链接失效或回跳错误 | 核对固定站点、两条完整回调和同浏览器会话；关闭链接跟踪，检查邮件安全扫描。链接和验证码可能共用一次性凭据，扫描已消耗链接时需重新请求并使用新码 |

邮件预取与链接跟踪的限制见 [Supabase 邮件模板注意事项](https://supabase.com/docs/guides/auth/auth-email-templates#limitations)。
