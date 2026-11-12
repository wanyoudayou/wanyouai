import test from "node:test";
import assert from "node:assert/strict";
import { anonymousDraftPreview } from "../src/lib/admin/preview";
import { importMarkdown, exportMarkdown, replaceDraftImage, newPublication } from "../src/lib/admin/draft";
import { prepareImageUpload } from "../src/lib/publishing/upload";
import { paywallEdit } from '../src/lib/admin/paywall-edit';
import { readBoundedBody } from "../src/lib/publishing/request-body";
import sharp from "sharp";
const fm = { title: "测试", slug: "draft-test", type: "blog" as const, access: "paid" as const, price: 10 };

test('anonymous preview never returns gated body, including invalid cutpoints', () => {
  const md = "公开预览\n\n<!-- paywall -->\n\nNEVER_PREVIEW_PRIVATE";
  assert.equal(anonymousDraftPreview(md, 'paid').markdown, '公开预览');
  assert.equal(anonymousDraftPreview('NEVER_PREVIEW_PRIVATE', 'subscriber').markdown, '');
  assert.equal(anonymousDraftPreview(md, 'owner').markdown, '');
  assert.equal(anonymousDraftPreview('```\n<!-- paywall -->\n```\nSECRET', 'paid').markdown, '');
  assert.equal(anonymousDraftPreview(md, 'public').markdown, md);
});
test('Markdown roundtrip and malformed YAML cannot become editable field objects', () => {
  const draft = importMarkdown(exportMarkdown(fm, '正文'));
  assert.deepEqual(draft.frontmatter, fm);
  assert.equal(draft.markdown.trim(), '正文');
  for (const text of ['---\ntitle: [nested]\n---\nx', '---\na: &a [*a]\n---\nx', '---\ntitle: a\ntitle: b\n---\nx']) assert.throws(() => importMarkdown(text));
});
test('image replacement touches image nodes and immutable attempts survive later edits', () => {
  const draft = replaceDraftImage('![图](assets/a.png)\n\n`![图](assets/a.png)`', 'assets/a.png', 'https://storage.test/image.png');
  assert.equal(draft.replaced, true);
  assert.ok(draft.markdown.includes('`![图](assets/a.png)`'));
  const fields = { ...fm };
  const attempt = newPublication(fields, 'old', []);
  fields.title = 'edited';
  assert.equal(attempt.frontmatter.title, fm.title);
  assert.notEqual(newPublication(fields, 'old', []).client_request_id, attempt.client_request_id);
});
test('upload validates raster bytes and converts SVG before any storage write', async () => {
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  const first = await prepareImageUpload(bytes, 'image/png', 'draft-test', 'assets/a.png');
  const repeat = await prepareImageUpload(bytes, 'image/png', 'draft-test', 'renamed.png');
  assert.equal(first.media.storage_path, repeat.media.storage_path);
  assert.equal(first.media.width, 3);
  await assert.rejects(prepareImageUpload(bytes, 'application/pdf', 'draft-test', 'x.pdf'));
  await assert.rejects(prepareImageUpload(bytes, 'image/jpeg', 'draft-test', 'x.jpg'));
  await assert.rejects(prepareImageUpload(bytes, 'image/png', '../x', 'x.png'));
  const svg = Buffer.from('<svg width="3" height="2" xmlns="http://www.w3.org/2000/svg"><script>PRIVATE_SCRIPT</script><image href="http://127.0.0.1/private"/><rect width="3" height="2" fill="red"/></svg>');
  const converted = await prepareImageUpload(svg, 'image/svg+xml', 'draft-test', 'x.svg');
  assert.equal(converted.media.mime_type, 'image/png');
  assert.equal((await sharp(converted.bytes).metadata()).format, 'png');
  assert.equal(Buffer.from(converted.bytes).includes(Buffer.from('PRIVATE_SCRIPT')), false);
});
test('request size limit applies to streamed bytes, independent of declared content length', async () => {
  const request = new Request('http://localhost', { method: 'POST', body: '123456', headers: { 'content-length': '1' } });
  await assert.rejects(readBoundedBody(request, 5));
  assert.equal((await readBoundedBody(new Request('http://localhost', { method: 'POST', body: '12345' }), 5)).toString(), '12345');
});

test('ordinary Markdown and incomplete metadata import as editable drafts', () => {
  const plain = importMarkdown('# 普通文章\n\n正文', 'my-first-post.md');
  assert.equal(plain.frontmatter.title, '普通文章');
  assert.equal(plain.frontmatter.slug, 'my-first-post');
  assert.equal(plain.markdown, '# 普通文章\n\n正文');
  const partial = importMarkdown('---\ntitle: 未完成草稿\naccess: paid\ncustom: ignored\n---\n正文', '中文文件.md');
  assert.equal(partial.frontmatter.slug, '');
  assert.equal(partial.frontmatter.access, 'paid');
  assert.deepEqual(partial.ignored, ['custom']);
  assert.throws(() => importMarkdown('---\naccess: [paid]\n---\n正文'));
  assert.throws(() => importMarkdown('---\ntitle: broken'));
});
test('paywall insertion creates one standalone cut and repeat invocation only selects it', () => {
  const text = '公开介绍。受限正文';
  const edit = paywallEdit(text, 5);
  assert.ok('insert' in edit);
  const updated = text.slice(0, edit.at) + edit.insert + text.slice(edit.at);
  assert.equal(anonymousDraftPreview(updated, 'paid').markdown, '公开介绍。');
  assert.ok('existing' in paywallEdit(updated, updated.length));
  assert.equal(anonymousDraftPreview(updated, 'public').publicWithPaywall, true);
  assert.equal(anonymousDraftPreview(updated, 'public').markdown, updated);
});
