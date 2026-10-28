import { renderDiagram } from "@/lib/reading/diagram";

export function MermaidDiagram({ source }: { source: string }) {
  let svg: string;
  try { svg = renderDiagram(source); } catch {
    return <div className="space-y-2"><p className="text-sm text-muted-foreground">图表暂不可渲染，以下为源代码。</p><pre><code>{source}</code></pre></div>;
  }
  return <div role="img" aria-label="文中图表" className="mermaid-diagram overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}
