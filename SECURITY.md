# 安全反馈

维护范围以 [GitHub Releases](https://github.com/wanyoudayou/wanyouai/releases) 中的最新稳定版本为准。应用和数据库按[升级说明](docs/operations/database-upgrade.md)配套更新；安全边界与验证方法见[安全审查摘要](docs/development/security-review.md)。

## 私下报告

请使用仓库 **Security → Advisories → Report a vulnerability** 私下提交。若公开仓库暂未显示该按钮，请通过普通 Issue 仅告知“需要私密安全报告渠道”，不要附漏洞细节、凭据或用户资料；等待维护者提供私密渠道后再发送。

私密报告请包含：受影响版本 / 提交号、触发前提、最小复现、预期 / 实际权限及影响范围。只使用自己的测试实例和模拟数据，不读取其他部署者的数据，不向真实收件人批量发信，也不发起非本人授权的支付。请勿附真实数据库 dump、密钥、付费原文或个人信息。

维护者收到报告后核实影响范围，协调修复、回归与披露。修复验证和部署建议明确后再公开细节；当前不承诺尚未建立保障能力的响应时限或赏金。

## 部署者自查

维护服务端密钥、Supabase Auth / SMTP、支付及邮件供应商账户的访问权限。发现凭据外泄时先撤销 / 轮换对应凭据，保留脱敏证据并检查异常操作；删掉公开文本不等于旧凭据失效。数据库授权核对使用当前 `verify.sql`，恢复使用[恢复手册](docs/operations/backup-and-restore.md)，不要通过临时放宽 RLS 来绕过故障。
