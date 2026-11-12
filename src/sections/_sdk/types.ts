/** 栏目可见的访问者信息：只有布尔结论，不暴露会话、邮箱或权益明细。 */
export interface SectionViewer {
  loggedIn: boolean;
  subscribed: boolean;
  owner: boolean;
}

/** 栏目根组件（`src/sections/<name>/page.tsx` 的默认导出）接收的参数。 */
export interface SectionProps {
  /** `/lab/<name>/` 之后的子路径段，例如 `/lab/demo/a/b` → `["a", "b"]`。 */
  path: string[];
  viewer: SectionViewer;
}
