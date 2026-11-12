import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";

const assets = new URL("fixture/public/assets/", import.meta.url);
mkdirSync(assets, { recursive: true });
for (const name of ["hero-cloud-glass.svg", "hero-terminal-wave.svg"])
  copyFileSync(
    new URL(`../../public/assets/${name}`, import.meta.url),
    new URL(name, assets),
  );

writeFileSync(
  new URL("custom-banner.svg", assets),
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="700"><path fill="#BFC9DB" d="M0 0h1600v700H0z"/><circle cx="1200" cy="350" r="240" fill="#7C6CFF"/></svg>',
);
