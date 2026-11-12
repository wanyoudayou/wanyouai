# 万有AI 文档索引

第一次部署从[项目 README](../README.md)开始。每个部署使用自己的项目、域名、密钥和站主配置。

## 部署

- [逐步部署指南](deployment/guide.md)：从创建项目到站主认领与验收。
- [Skill 发布与使用](deployment/skills.md)、[Obsidian 手册发布](deployment/obsidian.md)：私有包、文本对话与本地笔记同步。
- [Resend 邮箱验证码登录](deployment/email-login.md)：发件域、SMTP 参数、OTP 邮件模板与首次／再次登录验证。
- [环境变量契约](contracts/environment.md)、[Supabase 安全配置](contracts/supabase-security.md)、[数据库安装与升级](../supabase/README.md)：配置与 SQL 的当前规则。

站主认领后，可在「部署检查」载入可编辑的使用指南与收费方案。指南按八篇章节组织功能、安装、发布、配置与维护；部署步骤来自本目录的同一份维护文档。详细来源见[默认内容说明](../content/starter/README.md)。

## 运维

- [数据库升级](operations/database-upgrade.md)、[备份与恢复](operations/backup-and-restore.md)、[迁移历史衔接](operations/migration-history.md)、[历史媒体迁移](operations/media-relocation.md)。
- [内容与业务数据导出](operations/content-export.md)：Markdown 阅读编辑与 CSV 分析。
- [权益邮件队列](operations/payment-mail-outbox.md)、[邮件调度](operations/mail-scheduler.md)、[支付查单补漏](operations/payment-reconcile-scheduler.md)。

## 产品与接口

- [产品与权限规则](reference/product.md)、[页面行为](reference/pages.md)、[线框图](reference/wireframes.md)、[设计令牌与组件](reference/design-tokens.md)。
- [自定义页面设计与生成约束](contracts/custom-pages.md)。
- [Skill 契约](contracts/skills.md)、[手册同步协议](contracts/handbook-sync.md)。
- [图片素材库](contracts/media-library.md)：上传、复用、归档、旧图登记与暂存维护。
- [发布 API](contracts/publish-api.md)、[支付 API](contracts/payment-api.md)、[站点配置 Schema](contracts/site-config.schema.json)、[机器名片映射](contracts/card-mapping.md)。

## 开发维护

- [贡献指南](../CONTRIBUTING.md)、[测试说明](../tests/README.md)、[工具说明](../scripts/README.md)、[CI](development/ci.md)、[真实数据库并发](development/database-concurrency.md)。
- [系统模块与数据边界](development/system-architecture.md)。
- [AI 配置与知识库工程规则](development/ai-settings-plan.md)：共享连接、任务提示词隔离、知识库启用与诊断边界。
- [AI SDK 接入与维护](development/ai-sdk-migration.md)：直接供应商映射、安全出站、依赖升级验证与应用回退。
- [Embedding 实施规格](development/embedding-implementation.md)：1024 维模型与接口、显式联网检查、可恢复索引、代际切换及验收。
- [前端技术栈](development/frontend-stack.md)、[分身配额](development/avatar-quota.md)、[导出一致性](development/export-consistency.md)、[规模基线](development/scale-performance.md)。
- [安全审查摘要](development/security-review.md)、[发布状态](development/release-status.md)、[安全反馈](../SECURITY.md)。
- [版本验证与发布](development/releasing.md)：显式冒烟清单、可重复源码与插件打包、校验和发布顺序。
- [许可证](../LICENSE)、[第三方告知](../THIRD_PARTY_NOTICES.md)。
