import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCustomHtml, isValidPageSlug, hasOnlyCpClasses } from '../src/lib/custom-pages/sanitize';
import { filterStalePageRef, normalizeContactConfig, normalizeHomeConfig } from '../src/types/site';

test('custom pages sanitize: 剥离危险内容，保留 cp-* 白名单', () => {
  const dirty = [
    '<section class="cp-section cp-grid-2" onclick="alert(1)" style="color:red">',
    '  <h1 class="cp-h1 custom-class">标题</h1>',
    '  <script>alert(2)</script>',
    '  <iframe src="https://evil.example"></iframe>',
    '  <a href="https://example.com" target="_blank">外链</a>',
    '  <a href="javascript:alert(3)">坏链</a>',
    '  <img src="/assets/logo.png" alt="logo" class="cp-img">',
    '  <img src="data:image/svg+xml;base64,AAAA" alt="x">',
    '</section>',
  ].join('');
  const clean = sanitizeCustomHtml(dirty);
  assert.ok(!clean.includes('script'), 'script 剥离');
  assert.ok(!clean.includes('iframe'), 'iframe 剥离');
  assert.ok(!clean.includes('onclick'), '事件属性剥离');
  assert.ok(!clean.includes('style='), '内联 style 剥离');
  assert.ok(!clean.includes('custom-class'), '非 cp class 剥离');
  assert.ok(!clean.includes('javascript:'), 'javascript 协议剥离');
  assert.ok(!clean.includes('data:image'), 'data URI 剥离');
  assert.ok(clean.includes('cp-section') && clean.includes('cp-grid-2') && clean.includes('cp-h1'), 'cp-* 保留');
  assert.ok(clean.includes('href="https://example.com"'), 'https 链接保留');
  assert.ok(clean.includes('rel="noopener noreferrer"'), '_blank 自动加 rel');
  assert.ok(clean.includes('src="/assets/logo.png"'), '站内图片路径保留');
  assert.ok(hasOnlyCpClasses(clean));
});

test('cp-subscribe 占位符原样保留（渲染时由 CustomHtmlWithWidgets 替换为实时订阅卡）', () => {
  const clean = sanitizeCustomHtml('<p class="cp-lead">权益说明</p><div class="cp-subscribe"></div><p>后续内容</p>');
  assert.ok(clean.includes('<div class="cp-subscribe"></div>'), '占位符保留且格式可匹配');
  assert.ok(hasOnlyCpClasses(clean));
});

test('custom pages sanitize: mailto 与锚点允许，表格结构保留', () => {
  const clean = sanitizeCustomHtml('<table><thead><tr><th colspan="2" class="cp-small">h</th></tr></thead><tbody><tr><td>1</td><td><a href="mailto:a@b.c">mail</a><a href="#top">锚</a></td></tr></tbody></table>');
  assert.ok(clean.includes('colspan="2"'));
  assert.ok(clean.includes('mailto:a@b.c'));
  assert.ok(clean.includes('href="#top"'));
});

test('slug 校验与 cp class 断言', () => {
  assert.ok(isValidPageSlug('my-landing'));
  assert.ok(isValidPageSlug('a'));
  assert.ok(!isValidPageSlug('Bad-Slug'));
  assert.ok(!isValidPageSlug('-lead'));
  assert.ok(!isValidPageSlug('x'.repeat(62)));
  assert.ok(!hasOnlyCpClasses('<div class="cp-card evil"></div>'));
});

test('home_config custom_zone 归一化：缺省关闭、启用读取', () => {
  const empty = normalizeHomeConfig({});
  assert.deepEqual(empty.customZone, { enabled: false, html: '' });
  const withZone = normalizeHomeConfig({ custom_zone: { enabled: true, html: '<p class="cp-lead">hi</p>' } });
  assert.deepEqual(withZone.customZone, { enabled: true, html: '<p class="cp-lead">hi</p>' });
});

test('页面选择器死引用按未配置降级（防死链）', () => {
  const published = new Set(['book-fde']);
  // 引用已发布页：保留并解析为 /p/{slug}
  const live = filterStalePageRef({ email: 'a@b.c', booking_page: 'book-fde' }, 'booking_page', published);
  assert.equal(normalizeContactConfig(live).bookingUrl, '/p/book-fde');
  // 引用被删除/下架页：按未配置降级
  const dead = filterStalePageRef({ email: 'a@b.c', booking_page: 'gone-page' }, 'booking_page', published);
  assert.equal(normalizeContactConfig(dead).bookingUrl, null);
  assert.deepEqual(dead, { email: 'a@b.c', booking_page: '' });
  // 空引用与非对象输入原样通过
  assert.deepEqual(filterStalePageRef({ email: 'a@b.c' }, 'booking_page', published), { email: 'a@b.c' });
  assert.equal(filterStalePageRef(null, 'booking_page', published), null);
});
