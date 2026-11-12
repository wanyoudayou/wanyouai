---
name: new-section
description: Create, migrate or remove a code section (an interactive page under /lab/<name> that shares the site shell, sidebar and stack). Use when the user wants a custom interactive section in this repository, wants to port an existing small web project into the site as a section, or wants to delete one. Not for static pages (those are custom pages in /admin/pages) or for projects that should be deployed on their own (link them from /admin/navigation instead).
---

# Code sections

A code section lives in `src/sections/<name>/`, is served at `/lab/<name>`, and reaches the rest of the site only through `@/sections/_sdk`. The full rules are in `docs/development/custom-sections.md`; read it before writing code. `npm run sections:check` (part of `npm run contracts`) enforces them.

Never deploy, change the production database, push to `main`, or bypass branch protection. Commit, push and open a PR only after the user confirms.

## Decide first

Ask only what you cannot infer, then confirm in one message:

- **Is this a section at all?** Static text and images → a custom page in `/admin/pages`. A project with its own toolchain, backend or heavy custom stack → deploy it separately and add an external link in `/admin/navigation`. Otherwise continue.
- **Name**: lowercase, digits and hyphens, 2–40 chars (`^[a-z][a-z0-9-]{1,39}$`). The path is always `/lab/<name>`.
- **Title** (≤40 chars), **description** (≤200 chars), **icon** from `src/lib/navigation/icons.ts`.
- **Tier**: `standard` (site components, tokens and existing dependencies only) unless the section truly needs its own colour variables or an npm package; then `extended`.
- **Access** (free / login / subscriber) is chosen by the owner in `/admin/navigation`, not in code.

## Mode: new

1. `node scripts/new-section.mjs new <name> --title "…" --description "…" --icon <icon> --tier standard|extended`
   This copies `scripts/templates/section/`, writes the thin route `src/app/lab/<name>/[[...rest]]/page.tsx` and rebuilds the registry. Do not edit the thin route beyond what the script wrote.
2. Build the feature inside `src/sections/<name>/` only:
   - `page.tsx` is a server component receiving `{ path, viewer }`; put interaction in `components/*.tsx` with `"use client"`.
   - Import site UI from `@/sections/_sdk` (Button, Card, Tabs, Callout, EmptyState, StatusBadge, SectionHeader, usePersistentState, …). If something is missing, stop and propose adding it to `_sdk` as a separate, reviewed change.
   - Styles: `*.module.css` and Tailwind utilities using site tokens (`var(--primary)`, `bg-card`, …). No literal colours, no `:global`/`:root`/`html`/`body`. Extended tier: define `--<name>-*` variables in `tokens.json` with both `light` and `dark` values and list text/background pairs under `contrast`.
   - Reader progress belongs in `usePersistentState`. No server actions, route handlers, environment variables, migrations, `dangerouslySetInnerHTML`, remote fonts or third-party scripts.
3. Extended tier with a package: `npm install <pkg>` (exact version), add it to `manifest.json` `dependencies`, give the reason in the section `README.md`, and load heavy parts with `next/dynamic` or `import()`. Only MIT, Apache-2.0, BSD or ISC licences without asking; never a second React/Next, UI kit, styling system or state library without explicit approval.
4. Add a browser test under `tests/browser/` when the section has meaningful interaction, using the fixture app pattern there.

## Mode: migrate

Use for porting an existing project (for example a small React/Vite/esbuild app) into a section. Treat the source as reference material: read it, never run its install or build scripts.

1. Inventory the source: screens, state, data files, dependencies, styles. Map each dependency to an existing site package, an `_sdk` export, or a candidate extended-tier package; list the rest for the user.
2. Scaffold with mode **new**, then port screens into `components/`, static data into `data/`, and replace the source's vendored UI kit and CSS variables with `_sdk` components and site tokens. Drop its bundler, router, server, database and deployment config; sub-pages become `path` segments under `/lab/<name>/…`.
3. Keep behaviour, not the source structure. Note what was intentionally left out in the section README.

## Mode: remove

1. `node scripts/new-section.mjs remove <name>` deletes the section directory and thin route.
2. If it printed owned packages, run the printed `npm uninstall …`, then `npm run sections:build`.
3. Tell the user to delete the entry in `/admin/navigation` after the deployment (until then the admin page marks it "本次部署中不存在" and the sidebar hides it).

## Gates (all modes)

Run and fix until green, then report results faithfully:

```bash
npm run sections:build
npm run contracts
npm run docs:check
npm run lint
npm run typecheck
npm run build
npm run sections:budget
```

plus `npx playwright test <new spec>` when you added one.

## Hand-off

With the user's go-ahead: create a branch `section/<name>`, commit only the section directory, its thin route, `src/generated/sections.json`, generated token CSS, any browser test and (extended) `package.json`/`package-lock.json`, then open a PR whose description lists tier, owned packages with licences, and the measured budget. After it is merged and deployed, the owner adds the section in `/admin/navigation`, chooses free / login / subscriber access, and enables it.
