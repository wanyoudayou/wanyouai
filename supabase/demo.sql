-- Generated OPTIONAL demo content from legacy seed.sql; does not change site configuration.
-- Fresh, unused instances only. Includes labelled fictional paid examples, no Auth users.
begin;
do $guard$
begin
  if (select count(*) from public.site_config)<>1 then
    raise exception 'Install and initialize site_config before loading demo content.';
  end if;
  if exists(select 1 from public.articles) or exists(select 1 from public.series)
    or exists(select 1 from public.services) or exists(select 1 from public.custom_pages)
    or exists(select 1 from public.orders) or exists(select 1 from public.bookings)
    or exists(select 1 from public.profiles) then
    raise exception 'Demo import requires an unused instance. Existing data will not be changed.';
  end if;
end;
$guard$;
do $$
declare
  v_handbook_id bigint;
  v_skill_id bigint;
  v_event_id bigint;
  v_article_id bigint;
begin
  -- Paid handbook -------------------------------------------------------------
  insert into series (slug, type, title, price, status, tags, task, audiences, featured)
  values (
    'demo-selection-handbook', 'handbook', '跨境选品手册', 199.00, 'published',
    '{选品,跨境}', '用它建立可复用的选品判断框架', '{中小卖家,独立站运营}', true
  ) returning id into v_handbook_id;

  insert into articles (
    series_id, type, slug, title, summary, access, preview_md, status, published_at, tags
  ) values (
    v_handbook_id, 'chapter', 'demo-selection-handbook-readme',
    '跨境选品手册 · README', '这套手册解决什么问题、适合谁、如何使用。',
    'public', E'## 这套手册解决什么问题\n\n先用三页建立一个可复用的选品判断框架，再进入具体品类检查。\n\n### 适合谁\n- 中小卖家\n- 独立站运营者\n\n### 不适合谁\n- 寻找代运营服务的团队\n- 希望承诺销量的品牌',
    'published', now(), '{README,方法论}'
  ) returning id into v_article_id;
  update series set readme_article_id = v_article_id where id = v_handbook_id;
  insert into article_bodies (article_id, content) values (
    v_article_id,
    E'## 这套手册解决什么问题\n\n先用三页建立一个可复用的选品判断框架，再进入具体品类检查。\n\n### 适合谁\n- 中小卖家\n- 独立站运营者\n\n### 不适合谁\n- 寻找代运营服务的团队\n- 希望承诺销量的品牌\n\n### 更新说明\n- v1：建立初版选品评分卡。'
  );
  insert into article_versions (article_id, version, content_hash, snapshot)
  values (v_article_id, 1, md5('demo-selection-handbook-readme-v1'),
          jsonb_build_object('title', '跨境选品手册 · README', 'version', 1));
  insert into article_chunks (article_id, series_id, access, chunk_type, chunk_no, content)
  values (v_article_id, v_handbook_id, 'public', 'readme', 0, '跨境选品手册 README：建立选品判断框架，适合中小卖家与独立站运营者。');

  insert into articles (
    series_id, type, slug, title, summary, access, preview_md, status, published_at, tags
  ) values (
    v_handbook_id, 'chapter', 'demo-selection-scorecard',
    '选品评分卡', '用需求、竞争、物流、合规与利润五个维度判断品类。',
    'paid', E'## 选品评分卡\n\n这一章给出五个维度的评分表。\n\n### 公开预览\n- 需求强度：搜索趋势与复购迹象\n- 竞争密度：头部集中度与差异化空间',
    'published', now(), '{选品,评分卡}'
  ) returning id into v_article_id;
  insert into article_bodies (article_id, content) values (
    v_article_id,
    E'## 选品评分卡\n\n<!-- paywall -->\n\n### 完整评分维度\n- 需求强度：搜索趋势与复购迹象\n- 竞争密度：头部集中度与差异化空间\n- 物流约束：体积、重量、破损率\n- 合规风险:认证、售后与禁售限制\n- 利润结构:采购、履约、广告与退货'
  );
  insert into article_versions (article_id, version, content_hash, snapshot)
  values (v_article_id, 1, md5('demo-selection-scorecard-v1'),
          jsonb_build_object('title', '选品评分卡', 'version', 1));
  insert into article_chunks (article_id, series_id, access, chunk_type, chunk_no, content)
  values
    (v_article_id, v_handbook_id, 'paid', 'catalog', 0, '选品评分卡：五个维度的完整评分方法。'),
    (v_article_id, v_handbook_id, 'paid', 'preview', 1, '公开预览：需求强度与竞争密度。'),
    (v_article_id, v_handbook_id, 'paid', 'body', 2, 'DEMO-PAID-BODY selection scorecard full body');

  -- Third handbook chapter: a public workflow chapter.
  insert into articles (
    series_id, type, slug, title, summary, access, preview_md, status, published_at, tags
  ) values (
    v_handbook_id, 'chapter', 'demo-selection-workflow',
    '选品工作流', '从机会搜索到上架验证的五个步骤。', 'public',
    E'## 选品工作流\n\n1. 机会搜索\n2. 快速验证\n3. 小批量测试\n4. 数据复盘\n5. 放大或放弃',
    'published', now(), '{工作流}'
  ) returning id into v_article_id;
  insert into article_bodies (article_id, content) values (
    v_article_id,
    E'## 选品工作流\n\n1. 机会搜索\n2. 快速验证\n3. 小批量测试\n4. 数据复盘\n5. 放大或放弃\n\n每轮只验证一个变量，避免把市场噪音误判为产品机会。'
  );
  insert into article_versions (article_id, version, content_hash, snapshot)
  values (v_article_id, 1, md5('demo-selection-workflow-v1'),
          jsonb_build_object('title', '选品工作流', 'version', 1));
  insert into article_chunks (article_id, series_id, access, chunk_type, chunk_no, content)
  values (v_article_id, v_handbook_id, 'public', 'body', 0, '选品工作流：机会搜索、快速验证、小批量测试、数据复盘、放大或放弃。');

  -- Skill ----------------------------------------------------------------------
  insert into series (slug, type, title, price, status, tags, task, audiences, featured)
  values (
    'demo-agent-briefing-skill', 'skill', 'Agent 简报 Skill', 99.00, 'published',
    '{Agent,简报}', '用它把分散资料整理成结构化晨报', '{一人公司,内容团队}', false
  ) returning id into v_skill_id;

  insert into articles (
    series_id, type, slug, title, summary, access, preview_md, status, published_at, tags
  ) values (
    v_skill_id, 'chapter', 'demo-agent-briefing-skill-readme',
    'Agent 简报 Skill · README', '文件包结构、使用方式与输出样例。',
    'public', E'## Agent 简报 Skill\n\n这个 Skill 把分散资料整理为结构化晨报。\n\n### 文件包\n`SKILL.md`\n`templates/report.md`\n\n### 输出\n- 今日重点\n- 风险与依赖\n- 下一步动作',
    'published', now(), '{README,Agent}'
  ) returning id into v_article_id;
  update series set readme_article_id = v_article_id where id = v_skill_id;
  insert into article_bodies (article_id, content) values (
    v_article_id,
    E'## Agent 简报 Skill\n\n这个 Skill 把分散资料整理为结构化晨报。\n\n### 文件包\n`SKILL.md`\n`templates/report.md`\n\n### 输出\n- 今日重点\n- 风险与依赖\n- 下一步动作\n\n购买后下载完整文件包。'
  );
  insert into article_versions (article_id, version, content_hash, snapshot)
  values (v_article_id, 1, md5('demo-agent-briefing-skill-readme-v1'),
          jsonb_build_object('title', 'Agent 简报 Skill · README', 'version', 1));
  insert into article_chunks (article_id, series_id, access, chunk_type, chunk_no, content)
  values (v_article_id, v_skill_id, 'public', 'readme', 0, 'Agent 简报 Skill README：将分散资料整理成结构化晨报。');

  insert into skill_details (series_id, file_manifest)
  values (v_skill_id, $json$
    { "files": [ { "path": "SKILL.md", "size": 2048 }, { "path": "templates/report.md", "size": 1024 } ] }
  $json$::jsonb);

  -- Event -----------------------------------------------------------------------
  insert into series (slug, type, title, price, status, tags, task, audiences, featured)
  values (
    'demo-opc-review-event', 'event', '一人公司季度复盘会', 0, 'published',
    '{活动,复盘}', '用它完成一次季度经营复盘', '{一人公司,自由职业者}', false
  ) returning id into v_event_id;

  insert into event_details (
    series_id, starts_at, location_text, registration, capacity, kind, ticket_price, state
  ) values (
    v_event_id, now() + interval '7 days', '线上会议', '会员免费参加；非会员可购票。', '20 人', 'member', 49.00, 'registering'
  );

  insert into articles (
    series_id, type, slug, title, summary, access, preview_md, status, published_at, tags
  ) values (
    v_event_id, 'chapter', 'demo-opc-review-event-readme',
    '一人公司季度复盘会 · 活动介绍', '时间、议程、报名方式与参会资格。',
    'public', E'## 一人公司季度复盘会\n\n- 时间：演示数据中的 7 天后\n- 地点：线上会议\n- 议程：经营回顾 /瓶颈分析 /下季度计划\n\n会员免费参加，非会员可单独购票。',
    'published', now(), '{README,活动}'
  ) returning id into v_article_id;
  update series set readme_article_id = v_article_id where id = v_event_id;
  insert into article_bodies (article_id, content) values (
    v_article_id,
    E'## 一人公司季度复盘会\n\n- 时间：演示数据中的 7 天后\n- 地点：线上会议\n- 议程：经营回顾 /瓶颈分析 /下季度计划\n\n会员免费参加，非会员可单独购票。\n\n报名后参会；沉淀纪要按参会资格解锁。'
  );
  insert into article_versions (article_id, version, content_hash, snapshot)
  values (v_article_id, 1, md5('demo-opc-review-event-readme-v1'),
          jsonb_build_object('title', '一人公司季度复盘会 · 活动介绍', 'version', 1));
  insert into article_chunks (article_id, series_id, access, chunk_type, chunk_no, content)
  values (v_article_id, v_event_id, 'public', 'readme', 0, '一人公司季度复盘会：会员免费参加，非会员可购票，沉淀按参会资格解锁。');

  insert into articles (
    series_id, type, slug, title, summary, access, preview_md, status, published_at, tags
  ) values (
    v_event_id, 'chapter', 'demo-opc-review-event-notes',
    '季度复盘会纪要', '现场讨论、决议与后续行动。', 'subscriber',
    E'## 季度复盘会纪要\n\n参会后可读取完整纪要。', 'published', now(), '{纪要}'
  ) returning id into v_article_id;
  insert into article_bodies (article_id, content) values (
    v_article_id,
    E'## 季度复盘会纪要\n\n<!-- paywall -->\n\nDEMO-RESTRICTED-BODY:季度目标回顾、瓶颈归因、下季度行动清单。'
  );
  insert into article_versions (article_id, version, content_hash, snapshot)
  values (v_article_id, 1, md5('demo-opc-review-event-notes-v1'),
          jsonb_build_object('title', '季度复盘会纪要', 'version', 1));
  insert into article_chunks (article_id, series_id, access, chunk_type, chunk_no, content)
  values
    (v_article_id, v_event_id, 'subscriber', 'catalog', 0, '季度复盘会纪要：现场讨论、决议与后续行动。'),
    (v_article_id, v_event_id, 'subscriber', 'preview', 1, '参会后可读取完整纪要。'),
    (v_article_id, v_event_id, 'subscriber', 'body', 2, 'DEMO-RESTRICTED-BODY event notes');

  -- Blogs covering every access level ------------------------------------------
  insert into articles (type, slug, title, summary, access, preview_md, status, published_at, tags)
  values ('blog', 'demo-public-blog', '公开博客：为什么整站是一个工作区',
          '用同一套左中右骨架承载内容、交易与服务。', 'public',
          E'## 为什么整站是一个工作区\n\n左栏回答有什么，中栏回答在读什么，右栏回答可以聊什么。',
          'published', now(), '{产品设计}')
  returning id into v_article_id;
  insert into article_bodies values (
    v_article_id,
    E'## 为什么整站是一个工作区\n\n左栏回答有什么，中栏回答在读什么，右栏回答可以聊什么。这个骨架让店面与后台同构。'
  );
  insert into article_versions (article_id, version, content_hash, snapshot)
  values (v_article_id, 1, md5('demo-public-blog-v1'), jsonb_build_object('title', '公开博客：为什么整站是一个工作区', 'version', 1));
  insert into article_chunks (article_id, access, chunk_type, chunk_no, content)
  values (v_article_id, 'public', 'body', 0, '整站是一个工作区：左栏导航、中栏阅读、右栏交互。');

  insert into articles (type, slug, title, summary, access, preview_md, status, published_at, tags)
  values ('blog', 'demo-registered-blog', '注册可读：部署清单',
          '从 Supabase 到 Vercel 的基础检查项。', 'registered',
          E'## 部署清单\n\n注册后可读取完整清单。',
          'published', now(), '{部署}')
  returning id into v_article_id;
  insert into article_bodies values (
    v_article_id, E'## 部署清单\n\nDEMO-REGISTERED-BODY:环境变量、数据库迁移、RLS 抽查、构建与预览部署。'
  );
  insert into article_versions (article_id, version, content_hash, snapshot)
  values (v_article_id, 1, md5('demo-registered-blog-v1'), jsonb_build_object('title', '注册可读：部署清单', 'version', 1));
  insert into article_chunks (article_id, access, chunk_type, chunk_no, content) values
    (v_article_id, 'registered', 'catalog', 0, '部署清单：注册后可读。'),
    (v_article_id, 'registered', 'body', 1, 'DEMO-REGISTERED-BODY deployment checklist');

  insert into articles (type, slug, title, summary, access, preview_md, status, published_at, tags)
  values ('blog', 'demo-subscriber-blog', '订阅专享：季度经营复盘模板',
          '给一人公司使用的季度复盘模板。', 'subscriber',
          E'## 季度经营复盘模板\n\n订阅后可读取完整模板。',
          'published', now(), '{模板}')
  returning id into v_article_id;
  insert into article_bodies values (
    v_article_id, E'## 季度经营复盘模板\n\nDEMO-SUBSCRIBER-BODY:目标回顾、客户结构、现金流、产品化机会、下季行动。'
  );
  insert into article_versions (article_id, version, content_hash, snapshot)
  values (v_article_id, 1, md5('demo-subscriber-blog-v1'), jsonb_build_object('title', '订阅专享：季度经营复盘模板', 'version', 1));
  insert into article_chunks (article_id, access, chunk_type, chunk_no, content) values
    (v_article_id, 'subscriber', 'catalog', 0, '季度经营复盘模板：订阅后可读。'),
    (v_article_id, 'subscriber', 'body', 1, 'DEMO-SUBSCRIBER-BODY quarterly review template');

  insert into articles (type, slug, title, summary, access, price, preview_md, status, published_at, tags)
  values ('blog', 'demo-paid-single-blog', '单篇购买：选品检查表',
          '可打印的选品检查表。', 'paid', 19.00,
          E'## 选品检查表\n\n购买后可读取完整检查表。',
          'published', now(), '{选品}')
  returning id into v_article_id;
  insert into article_bodies values (
    v_article_id, E'## 选品检查表\n\n<!-- paywall -->\n\nDEMO-PAID-SINGLE-BODY:需求、竞争、物流、合规、利润与售后检查项。'
  );
  insert into article_versions (article_id, version, content_hash, snapshot)
  values (v_article_id, 1, md5('demo-paid-single-blog-v1'), jsonb_build_object('title', '单篇购买：选品检查表', 'version', 1));
  insert into article_chunks (article_id, access, chunk_type, chunk_no, content) values
    (v_article_id, 'paid', 'catalog', 0, '选品检查表：单篇购买。'),
    (v_article_id, 'paid', 'preview', 1, '购买后可读取完整检查表。'),
    (v_article_id, 'paid', 'body', 2, 'DEMO-PAID-SINGLE-BODY selection checklist');

  -- Published service for /card.json -------------------------------------------
  insert into services (
    slug, title, summary, deliverables, duration, price, capacity_per_month,
    protocol_snapshot, status, sort
  ) values (
    'demo-business-review', '一人公司经营诊断',
    '用一次结构化诊断明确下一步经营动作。',
    '{诊断报告,行动清单}', '5 个工作日', 4999.00, 4,
    $json$
{
  "scope": "梳理经营现状并输出诊断报告",
  "deliverable": "PDF 报告与行动清单",
  "cadence": "1 次访谈 + 5 个工作日交付",
  "compensation": "线下签约与结算",
  "exit": "双方书面确认后终止",
  "ownership": "客户数据归客户，方法论归站主"
}
$json$::jsonb,
    'published', 1
  );
end $$;
commit;
