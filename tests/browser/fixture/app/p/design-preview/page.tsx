import { CustomHtmlWithWidgets } from "@/components/custom/custom-html-widgets";
export default async function Page() {
  const html = `<section class="cp-section"><h1 class="cp-h1">清楚的内容与行动</h1><p class="cp-lead">从页面、区块到卡片，使用同一套视觉层级。</p><div class="cp-grid-2"><article class="cp-card"><span class="cp-icon" data-icon="shield-check"></span><h2 class="cp-h3">权限边界</h2><p class="cp-muted">说明真正实现的能力，不生成虚构功能。</p></article><a class="cp-card" href="/collections/example"><span class="cp-icon" data-icon="book-open"></span><h2 class="cp-h3">阅读使用指南</h2><p class="cp-muted">整个卡片是一个真实链接。</p></a></div></section><section class="cp-section cp-inverse"><h2 class="cp-h2">有意义的强调区域</h2><p class="cp-muted">局部反白保持文字、卡片和操作的完整语义。</p><article class="cp-card"><h3 class="cp-h3">反白区域内的说明</h3><p class="cp-muted">卡片自身的表面与文字也保持可读。</p><a class="cp-cta-secondary" href="/collections/example"><span class="cp-icon" data-icon="arrow-right"></span>查看完整指南</a></article></section>`;
  return (
    <div className="mx-auto max-w-5xl p-6">
      <CustomHtmlWithWidgets html={html} />
    </div>
  );
}
