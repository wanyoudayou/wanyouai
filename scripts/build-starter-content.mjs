import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("content/starter/manifest.json", root), "utf8"),
);
const allowed = new Set([
  "content/starter/overview.md",
  "content/starter/publishing.md",
  "content/starter/navigation.md",
  "docs/deployment/guide.md",
]);
if (
  manifest.version !== 1 ||
  manifest.articles.length !== 8 ||
  new Set(manifest.articles.map((a) => a.slug)).size !== 8
)
  throw new Error("Invalid starter manifest");
const parse = markdown => unified().use(remarkParse).use(remarkGfm).parse(markdown);
const textOf = node => node.value ?? node.children?.map(textOf).join("") ?? "";
const sourceAnchor = title => title.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/\s/g, "-");
function selectSections(markdown, article) {
  if (!article.sections) return markdown;
  if (!Array.isArray(article.sections) || !article.sections.length) throw new Error("Invalid starter sections");
  const nodes = parse(markdown).children;
  const parts = article.sections.map(title => {
    const matches = nodes.filter(node => node.type === "heading" && textOf(node) === title);
    if (matches.length !== 1) throw new Error(`Starter section missing or ambiguous: ${article.source}: ${title}`);
    const heading = matches[0], start = nodes.indexOf(heading);
    let end = start + 1;
    while (end < nodes.length && !(nodes[end].type === "heading" && nodes[end].depth <= heading.depth)) end++;
    const offset = heading.position.start.offset;
    let part = markdown.slice(offset, nodes[end]?.position.start.offset);
    // Keep a proper outline under the chapter title, without touching fenced examples.
    for (const node of nodes.slice(start, end).filter(node => node.type === "heading").reverse()) {
      const at = node.position.start.offset - offset;
      part = part.slice(0, at) + "#".repeat(node.depth - heading.depth + 2) + part.slice(at + node.depth);
    }
    return part.trim();
  });
  return `# ${article.title}\n\n${parts.join("\n\n")}\n`;
}
const chapters = manifest.articles.map(article => {
  if (!allowed.has(article.source))
    throw new Error(`Not a public starter source: ${article.source}`);
  return { ...article, markdown: selectSections(readFileSync(new URL(article.source, root), "utf8"), article) };
});
const routes = new Map();
for (const chapter of chapters) {
  const url = `/handbooks/getting-started?article=${chapter.slug}`;
  if (chapters.filter(other => other.source === chapter.source).length === 1) routes.set(chapter.source, url);
  let index = 0;
  visit(parse(chapter.markdown), "heading", node => {
    // Reading pages use section-N IDs, rather than GitHub's heading slugs.
    routes.set(`${chapter.source}#${sourceAnchor(textOf(node))}`, `${url}#section-${++index}`);
  });
}
function rewriteLinks(markdown, source) {
  const links = [];
  visit(parse(markdown), "link", node => { links.push(node); });
  for (const node of links.reverse()) {
    if (/^(?:https?:|mailto:|\/)/.test(node.url)) continue;
    const [relative, fragment] = node.url.split("#", 2);
    const resolved = relative ? path.posix.normalize(path.posix.join(path.posix.dirname(source), relative)) : source;
    const hidden = resolved.startsWith("docs/development/") || resolved.startsWith("..") || /\.local-archive|\.codex|\.aws/.test(resolved) || (path.posix.basename(resolved).startsWith(".env") && path.posix.basename(resolved) !== ".env.example");
    const target = routes.get(`${resolved}${fragment ? `#${fragment}` : ""}`) ?? `https://github.com/wanyoudayou/wanyouai/blob/main/${resolved}${fragment ? `#${fragment}` : ""}`;
    const label = node.children.length ? markdown.slice(node.children[0].position.start.offset, node.children.at(-1).position.end.offset) : "";
    const replacement = hidden ? label : `[${label}](${target}${node.title ? ` ${JSON.stringify(node.title)}` : ""})`;
    markdown = markdown.slice(0, node.position.start.offset) + replacement + markdown.slice(node.position.end.offset);
  }
  return markdown;
}
const articles = chapters.map((article, index) => {
  const markdown = rewriteLinks(article.markdown, article.source);
  return {
    client_request_id: `starter_v1_${index}`,
    frontmatter: {
      title: article.title,
      slug: article.slug,
      type: "chapter",
      series_slug: "getting-started",
      access: "public",
    },
    markdown,
    media: [],
  };
});
if (manifest.pricing !== "content/starter/pricing.html")
  throw new Error("Invalid Pricing source");
const payload = {
  version: manifest.version,
  id: manifest.id,
  pricing: readFileSync(new URL(manifest.pricing, root), "utf8"),
  articles,
};
const content =
  JSON.stringify(
    {
      ...payload,
      hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    },
    null,
    2,
  ) + "\n";
const target = new URL("src/generated/starter-content.json", root);
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== content)
    throw new Error("Starter content drifted. Run npm run starter:build.");
  console.log("Starter content matches its public source whitelist.");
} else {
  mkdirSync(new URL("src/generated/", root), { recursive: true });
  writeFileSync(target, content);
  console.log("Generated starter content from explicit public sources.");
}
