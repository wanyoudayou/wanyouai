# __TITLE__

__DESCRIPTION__

- 路径：`/lab/__NAME__`
- 档位：__TIER__
- 维护人：
- 独占依赖与理由：无

## 目录

- `manifest.json`：栏目登记信息，修改后运行 `npm run sections:build`。
- `page.tsx`：栏目根组件（服务端），接收 `path` 子路径与 `viewer` 访问者信息。
- `components/`：栏目私有组件；交互组件需要 `"use client"`。
- `styles.module.css`：栏目样式，只用 token。

规则见 `docs/development/custom-sections.md`。
