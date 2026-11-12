// Public example questions for the editable getting-started handbook.
export const KNOWLEDGE_EVALUATION_EXAMPLE = [
  ...[
    ["本站系统适合什么类型的经营者？", "overview"], ["手册、活动与 Skill 有什么区别？", "overview"],
    ["开始部署前需要准备哪些平台账户？", "preparation"], ["网站域名与邮件发件域名需要分别买吗？", "preparation"],
    ["新建 Supabase 项目后按什么顺序执行 SQL？", "supabase"], ["数据库校验出现 false 后应如何处理？", "supabase"],
    ["Vercel 的 SITE_URL 应填写哪种地址？", "vercel"], ["使用已有数据库可以重新运行安装 SQL 吗？", "supabase"],
    ["如何将章节导入手册并一次审核发布？", "publishing"], ["收费方案页如何展示真实订阅价格？", "navigation"],
    ["Can this project host several tenants or several site owners?", "overview"], ["隐藏导航能限制文章访问吗？", "overview"],
    ["Supabase 的公开密钥与服务端密钥如何区分？", "supabase"], ["安装数据库是否自动创建站主账户？", "supabase"],
    ["How do I configure callback URLs for owner and reader sign-in?", "vercel"], ["修改 Vercel 环境变量后怎样让网站使用新值？", "vercel"],
    ["待审核新版本会立即替换线上文章吗？", "publishing"], ["手册的侧栏名称和顺序在哪里修改？", "navigation"],
    ["登录验证码的 SMTP 与权益通知邮件是不是同一处配置？", "optional"], ["后台内容 ZIP 能直接当成整站灾难恢复备份吗？", "maintenance"],
  ].map(([question, section], index) => ({ question, expected: [`article:getting-started-${section}`], split: index < 10 ? "train" : "holdout" })),
  ...[
    "请告诉我明天彩票一等奖号码。", "帮我预测下个月的黄金最高价。", "写一份我所在城市未来七天的天气报告。", "给出圆周率的第十亿位数字。", "量子色动力学的严格质量间隙证明是什么？",
    "推荐附近现在营业的火锅店。", "我的快递现在具体在哪条街？", "Which team won tonight's basketball match?", "今天人民币对日元的实时汇率是多少？", "请诊断我昨晚头痛的医学原因。",
    "我在另一个电商网站购买的鞋子什么时候发货？", "请给我站外某笔支付宝转账的真实收据。", "请替我执行一次银行账户转账。", "What is the password to my home Wi-Fi router?", "我的手机当前剩余电量是多少？",
    "帮我读取个人电脑桌面上的秘密文件。", "我的独立外卖订单还要多久送到？", "请列出我没有提供的家庭成员身份证号码。", "请预报下一次地震发生的准确时间地点。", "现在国际空间站内有哪些宇航员？",
  ].map((question, index) => ({ question, expected: [] as string[], split: index < 10 ? "train" : "holdout" })),
];
