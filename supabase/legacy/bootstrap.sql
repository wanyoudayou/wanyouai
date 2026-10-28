-- Neutral singleton configuration. No owner, content, credentials or sale price.
-- Existing site configuration is preserved; this file is not an upgrade migration.
insert into public.site_config (
  id, site_name, tagline, owner_name, footer_credit,
  identity, constraints, contact, commerce, avatar_config, home_config
) values (
  1, '我的站点', null, '站主（待配置）', true,
  '{"one_liner":"站点初始化完成，请站主配置名片","languages":["zh-CN"],"timezone":"UTC","focus_areas":[],"show_subscription_card":false}'::jsonb,
  '{"working_hours":"待站主配置","response_time":"待站主配置","current_load":"待站主配置","exclusions":[]}'::jsonb,
  '{"booking_page":""}'::jsonb,
  '{"payment_enabled":false,"payment_channels":[],"subscription_price":null,"refund_policy_page":"","subscribe_page":""}'::jsonb,
  '{"enabled":false,"anonymous_entry":false}'::jsonb,
  '{"hero":{"ask_placeholder":"想了解什么？","enabled":true,"tone":"light"},"fact_badges":[],"blocks":[{"type":"blog","enabled":true,"title":"博客","limit":6},{"type":"handbook","enabled":true,"title":"手册","limit":6},{"type":"skill","enabled":true,"title":"技能","limit":6},{"type":"event","enabled":true,"title":"活动","limit":6},{"type":"service","enabled":true,"title":"服务","limit":6}]}'::jsonb
) on conflict (id) do nothing;
