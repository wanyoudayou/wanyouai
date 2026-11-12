import { createHash } from "node:crypto";
import { renderMermaidSVG } from "beautiful-mermaid";
import sanitizeHtml from "sanitize-html";

/** 生成结果也按 SVG 白名单消毒；不允许脚本、HTML、样式或外链。 */
export function renderDiagram(source: string): string {
  if (source.length > 20000) throw new Error("图表过长");
  const prefix = `diagram-${createHash("sha256").update(source).digest("hex").slice(0, 12)}-`;
  const svg = renderMermaidSVG(source, { bg: "var(--background)", fg: "var(--foreground)", transparent: true });
  return sanitizeHtml(svg, {
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
    allowedTags: ["svg", "g", "defs", "marker", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan"],
    allowedAttributes: { "*": ["id", "class", "viewBox", "width", "height", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "d", "dx", "dy", "points", "transform", "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "text-anchor", "font-size", "font-weight", "dominant-baseline", "markerWidth", "markerHeight", "refX", "refY", "orient", "marker-end", "marker-start"] },
    transformTags: { "*": (tagName, attributes) => {
      const attribs = { ...attributes };
      if (attribs.id) attribs.id = prefix + attribs.id;
      for (const key of ["fill", "stroke"]) {
        if (attribs[key] && !/^(none|currentColor|var\(--[\w-]+\))$/.test(attribs[key])) delete attribs[key];
      }
      for (const key of ["marker-end", "marker-start"]) {
        const match = /^url\(#([\w-]+)\)$/.exec(attribs[key] ?? "");
        if (match) attribs[key] = `url(#${prefix}${match[1]})`; else delete attribs[key];
      }
      return { tagName, attribs };
    } },
  });
}
