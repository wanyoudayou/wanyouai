# 第三方组件与素材说明

万有AI 自有代码见根目录 [MIT 许可证](LICENSE)。npm 包、随安装取得的原生库和仓库内引入的第三方文件保留各自的许可证；根目录 MIT 声明不改变这些条款。`package-lock.json` 锁定具体版本，源码仓库不提交 `node_modules/`。

依赖具体版本以 package-lock.json 为准，源码包不包含 node_modules。以下组件需要单独注意；这不是全部依赖的许可证全文。分发构建物时须按目标平台的实际包含内容重新盘点。

| 组件 | 锁定版本 | 许可证 / 来源 | 分发提示 |
|---|---:|---|---|
| `@img/sharp-libvips-*` | 1.3.4 | 锁文件标记 `LGPL-3.0-or-later`；[上游第三方清单](https://github.com/lovell/sharp-libvips/blob/main/THIRD-PARTY-NOTICES.md)列出 libvips 及其依赖的独立许可证 | `sharp` 按平台安装原生库。若分发含原生库的构建物，应按实际打包内容保留相应许可证和告知。 |
| `elkjs` | 0.11.1 | [EPL-2.0](https://github.com/kieler/elkjs/blob/master/LICENSE.md) | 保留上游许可证，不将该包标为 MIT。 |
| `caniuse-lite` | 1.0.30001810 | [CC BY 4.0](https://github.com/browserslist/caniuse-lite/blob/main/LICENSE) | 数据来源标注为 [caniuse.com](https://caniuse.com/)；具体归属说明见[上游 README](https://github.com/browserslist/caniuse-lite/blob/main/README.md#license)。 |
| `ai` 与 `@ai-sdk/*` | 以锁文件为准 | [Apache-2.0](https://github.com/vercel/ai/blob/main/LICENSE) | 供应商调用适配；分发包含这些包的构建物时保留实际安装包的版权、许可证及适用 NOTICE。Zod 为其校验依赖，保留上游 MIT 许可。 |
| `.agents/skills/` 中的 Supabase Agent Skills | 开发辅助仓库快照 | [上游 MIT](https://github.com/supabase/agent-skills/blob/main/LICENSE) | 完整许可见[仓库中的 `.agents/LICENSE`](https://github.com/wanyoudayou/wanyouai/blob/main/.agents/LICENSE)；下载源码包按 `.gitattributes` 排除此开发辅助目录。 |

`public/assets/hero-cloud-glass.svg` 与 `hero-terminal-wave.svg` 是本项目的主题矢量绘制，适用代码 MIT 条款。

Skill ZIP 解析使用 `yauzl`（MIT），打包使用 `fflate`（MIT）。Obsidian 插件构建根据 esbuild 实际模块清单收集完整许可证，随安装包提供 `LICENSE` 与 `THIRD_PARTY_LICENSES.txt`；Obsidian API 作为宿主依赖不打入插件。

本文件用于识别发行物中的独立许可。发布源码、容器或可执行构建物时，应按**实际包含的文件**复核并附上适用的完整许可证文本与版权告知；仅凭锁文件元数据不能证明某个发行包已履行全部告知要求。

## shadcn Tailwind stylesheet

The unmodified `dist/tailwind.css` from [shadcn 4.21.0](https://www.npmjs.com/package/shadcn/v/4.21.0) is included at [src/styles/vendor/shadcn-tailwind.css](src/styles/vendor/shadcn-tailwind.css), with its [MIT license](src/styles/vendor/SHADCN_LICENSE.md). The generator CLI is not required to build or deploy this project.
