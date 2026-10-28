import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

let bundle: string;
// Obsidian supplies these native controls at runtime. The harness renders the
// actual plugin view in a browser, with only platform controls and data replaced.
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: `
    import { HandbookView } from './plugins/obsidian/src/view';
    import { TFile, TFolder } from 'obsidian';
    const binding={origin:'https://example.test',folder:'manual-a',series:{id:1,slug:'manual-a',title:'本地手册 A',status:'draft'},files:{},images:[],changed:true,failures:[{path:'第一章.md',message:'原任务尚未确认'}]};
    const files=[new TFile('manual-a/Readme.md')];
    const app={vault:{getAbstractFileByPath:(p)=>new TFolder(p,files.filter(f=>f.path.startsWith(p+'/')))}};
    const inventory={files:[],assets:[],onlineArticles:[],total:0,page:1};
    const plugin={settings:{origin:'https://example.test',folders:['manual-a','manual-b'],bindings:[binding],journals:{}},connected:true,canConnect:true,readingStatus:false,connectionError:'',
      save:async()=>{},connect:async()=>{},refreshOnlineStatus:async()=>{},reader:()=>({markdownFiles:()=>[]}),info:()=>({}),handbooks:async()=>[binding.series],
      sync:(progress)=>({reconcile:async()=>{progress('正在查询原任务');await new Promise(r=>window.finishRecovery=r);return {confirmed:1,unfinished:0,blocked:0}},inventory:async()=>inventory,saveDrafts:async(_s,_c,_b,_i,_info,overwrites)=>{window.uploads=(window.uploads||0)+1;window.overwrites=[...overwrites];return inventory}})};
    const view=new HandbookView({app},plugin);view.selected='manual-a';view.render();
    document.body.append(view.contentEl);window.view=view;window.uploads=0;window.open=(url)=>{window.openedUrl=url;return null};
    window.showComparison=()=>{
      const note=path=>({path,candidate:{input:{frontmatter:{access:'registered'},markdown:'# '+path}}});
      const first=note('第一章.md'),second=note('新增.md');
      const online={id:10,slug:'old',title:'线上第一章',status:'published',version:2,updated_at:'2026-10-27T00:00:00Z'};
      const current={...inventory,files:[{id:4,path:first.path,article_slug:'old',online,latest:{id:4,version:1,publication:{article:{version:1}}}},{id:5,path:'仅线上.md',article_slug:'retained',latest:null}],onlineArticles:[online,{id:11,slug:'web-created',title:'网页新文稿',status:'published',version:1,updated_at:'2026-10-27T00:00:00Z'}]};
      view.prepared={binding,snapshot:{notes:[first,second],images:[],ignored:[]},compared:[{note:first,check:{change:'changed',version:1,onlineChanged:true,input:first.candidate.input,previousMarkdown:'线上修改',previousMarkdownSource:'published'}},{note:second,check:{change:'new',version:0,onlineChanged:false,input:second.candidate.input,previousMarkdown:''}}],inventory:current,overwrites:new Set()};view.render();
    };
    window.onlineChanged=()=>{binding.series.status='published';view.onlineUpdated(binding.folder);view.refresh()};
    window.showUnchanged=(pending=false)=>{
      window.showComparison();
      const prepared=view.prepared;
      prepared.compared.forEach((item,index)=>{
        item.check.change='unchanged';item.check.onlineChanged=false;
        if(!prepared.inventory.files.some(f=>f.path===item.note.path))prepared.inventory.files.push({path:item.note.path,latest:{id:index+20,version:1}});
      });
      binding.files={chapter:{version:1,publishedVersion:pending?undefined:1,draftVersion:pending?1:undefined}};
      view.render();
    };
    window.showMissingImage=()=>{window.showUnchanged();view.prepared.snapshot.images=[{path:'_assets/image.png',vaultPath:'附件/image.png',hash:'new-image',bytes:new Uint8Array([1])}];view.render()};
  `, resolveDir: process.cwd() }, bundle: true, platform: "browser", format: "iife", write: false, plugins: [{ name: "obsidian-platform", setup(b) {
    b.onResolve({ filter: /^(obsidian|node:crypto|node:path|node:https)$/ }, args => ({ path: args.path, namespace: "platform" }));
    b.onLoad({ filter: /.*/, namespace: "platform" }, ({ path }) => ({ contents: path === "obsidian" ? `
      const proto=HTMLElement.prototype;
      proto.empty=function(){this.replaceChildren()};proto.addClass=function(c){this.classList.add(c)};proto.setText=function(t){this.textContent=t};proto.toggle=function(v){this.hidden=!v};
      proto.createEl=function(tag,o={}){const el=document.createElement(tag);if(o.text)el.textContent=o.text;if(o.cls)el.className=o.cls;for(const [k,v] of Object.entries(o.attr||{}))el.setAttribute(k,v);this.append(el);return el};proto.createDiv=function(o){return this.createEl('div',o)};
      export class TFile{constructor(path){this.path=path;this.name=path.split('/').pop()}}
      export class TFolder{constructor(path,children=[]){this.path=path;this.children=children}}
      export class ItemView{constructor(leaf){this.app=leaf.app;this.contentEl=document.createElement('div')}}
      export class Modal{constructor(app){this.app=app;this.contentEl=document.createElement('div')}open(){this.contentEl.setAttribute('role','dialog');document.body.append(this.contentEl);this.onOpen()}close(){this.contentEl.remove()}}
      export class Notice{};export class PluginSettingTab{};
      class Control{constructor(el){this.el=el;this.inputEl=el;this.selectEl=el;this.toggleEl=el}setButtonText(t){this.el.textContent=t;return this}setDisabled(v){this.el.disabled=v;return this}setCta(){this.el.classList.add('mod-cta');return this}setWarning(){return this}onClick(fn){this.el.onclick=fn;return this}setValue(v){if(this.el.type==='checkbox')this.el.checked=v;else this.el.value=v;return this}setPlaceholder(v){this.el.placeholder=v;return this}onChange(fn){this.el.oninput=()=>fn(this.el.type==='checkbox'?this.el.checked:this.el.value);return this}addOption(k,v){const o=new Option(v,k);this.el.add(o);return this}addOptions(o){for(const [k,v]of Object.entries(o))this.addOption(k,v);return this}}
      export class Setting{constructor(parent){this.el=parent.createDiv({cls:'setting-item'});const info=this.el.createDiv({cls:'setting-item-info'});this.label=info.createEl('label');this.controls=this.el.createDiv({cls:'setting-item-control'})}setName(t){this.label.textContent=t;return this}setDesc(t){this.el.createEl('p',{text:t});return this}setClass(c){this.el.className=c;return this}addButton(fn){fn(new Control(this.controls.createEl('button')));return this}addText(fn){fn(new Control(this.controls.createEl('input')));return this}addDropdown(fn){fn(new Control(this.controls.createEl('select')));return this}addToggle(fn){const el=this.controls.createEl('input');el.type='checkbox';fn(new Control(el));return this}}
    ` : path === "node:crypto" ? "export const randomUUID=()=>crypto.randomUUID();export const createHash=()=>({update(){return this},digest(){return 'f'.repeat(64)}});" : path === "node:https" ? "export const request=()=>{throw Error('Network is not allowed in this view fixture')};" : "export const posix={};" }));
  } }] });
  bundle = result.outputFiles[0].text;
});

// A minimal host theme for visual inspection; application code still uses Obsidian controls.
async function renderHost(page: import('@playwright/test').Page, dark = false) {
  await page.setContent(`<style>
    body{font:14px/1.5 system-ui;margin:0;background:var(--background-primary);color:var(--text-normal);--background-primary:${dark?'#1e1e1e':'#ffffff'};--background-primary-alt:${dark?'#242424':'#fafafa'};--background-secondary:${dark?'#282828':'#f5f5f5'};--background-modifier-border:${dark?'#444':'#ddd'};--text-normal:${dark?'#ddd':'#222'};--text-muted:${dark?'#aaa':'#666'};--text-error:${dark?'#ff7878':'#b11'};--interactive-accent:#7852d6;--radius-m:8px;--radius-s:4px;--font-ui-large:18px;--font-small:13px;--font-smallest:12px;--font-semibold:600;--font-medium:500}
    *{box-sizing:border-box}button,input,select{font:inherit}button,select{border:1px solid var(--background-modifier-border);border-radius:5px;background:var(--background-primary-alt);color:var(--text-normal);padding:6px 12px}button.mod-cta{background:var(--interactive-accent);color:white}button:disabled{opacity:.45}button:focus-visible{outline:2px solid var(--interactive-accent)}.setting-item{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0}.setting-item-control{display:flex;align-items:center;gap:8px}input[type=checkbox]{accent-color:var(--interactive-accent)}
  </style>`);
  await page.addStyleTag({ content: await readFile('plugins/obsidian/styles.css','utf8') });
  await page.addScriptTag({ content: bundle });
}

test("draft upload compares both lists, keeps online-only documents and requires explicit overwrite", async ({ page }, info) => {
  await renderHost(page);
  await page.evaluate(() => { (window as unknown as { showComparison(): void }).showComparison(); });
  const row = page.locator(".opc-handbook-row").first();
  await expect(row.getByRole("columnheader", { name: "本地文稿" })).toBeVisible(); await expect(row.getByRole("columnheader", { name: "线上文稿" })).toBeVisible();
  await expect(row.getByText("仅在线上，保留，不删除", { exact: true })).toBeVisible(); await expect(row.getByText("网页创建，保留，不删除", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发布手册", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "连接站点", exact: true })).toHaveCount(0);
  const upload = row.getByRole("button", { name: "确认上传草稿", exact: true }); const checks = row.getByRole("checkbox");
  await expect(upload).toBeDisabled(); await expect(checks.last()).toBeDisabled();
  await row.getByLabel("确认覆盖：第一章.md").check(); await expect(checks.last()).toBeEnabled();
  await checks.last().check(); await expect(upload).toBeEnabled();
  await row.getByLabel("确认覆盖：第一章.md").uncheck(); await expect(upload).toBeDisabled(); await expect(checks.last()).not.toBeChecked();
  await row.getByLabel("确认覆盖：第一章.md").check(); await checks.last().check();
  await page.screenshot({ path: info.outputPath("draft-list-comparison.png"), fullPage: true });
  await upload.click(); await expect(row.getByRole("status")).toContainText("草稿上传完成");
  expect(await page.evaluate(() => (window as unknown as { uploads: number }).uploads)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { overwrites: string[] }).overwrites)).toEqual(["第一章.md"]);
  await row.getByRole("button", { name: "打开网页手册设置" }).click(); expect(await page.evaluate(() => (window as unknown as { openedUrl: string }).openedUrl)).toBe("https://example.test/admin/collections/1");
});

test("progress stays in the handbook, creation has no permissions or publish options, and remote state refreshes", async ({ page }) => {
  await page.setContent("<style>body{font-family:system-ui}</style>"); await page.addScriptTag({ content: bundle });
  const first=page.locator("details.opc-handbook-row").first(),second=page.locator("details.opc-handbook-row").nth(1);
  await first.getByRole("button", { name:"查询未确认任务" }).click(); await expect(first.getByRole("status")).toHaveText("正在查询原任务");
  await first.evaluate(el=>{el.dataset.identity="stable"});
  await page.evaluate(()=>{const view=(window as unknown as {view:{progress(s:string):void;refresh():void}}).view;view.progress('仍在查询');view.refresh()});
  await expect(first).toHaveAttribute("data-identity","stable"); await expect(first.getByRole("status")).toHaveText("仍在查询");
  await page.evaluate(()=>(window as unknown as {finishRecovery():void}).finishRecovery()); await expect(first.getByRole("status")).toContainText("查询完成");
  await page.evaluate(()=>(window as unknown as {onlineChanged():void}).onlineChanged()); await expect(first.locator(":scope > summary")).toContainText("线上手册：已发布");
  await second.locator(":scope > summary").click(); await second.getByRole("button",{name:"上传为新手册草稿／关联手册"}).click();
  const dialog=page.getByRole("dialog");await expect(dialog.getByRole("heading",{name:"上传手册草稿"})).toBeVisible();
  await expect(dialog.getByText("新文稿默认阅读权限",{exact:true})).toHaveCount(0); await expect(dialog.getByText("只保存线上草稿",{exact:true})).toHaveCount(0);
  const submit=dialog.getByRole("button",{name:"确认目标并比对"}); await expect(submit).toBeDisabled(); await dialog.getByRole("checkbox").check(); await expect(submit).toBeEnabled();
});

for (const pending of [false, true]) test(`unchanged documents require no upload and ${pending ? "lead to web review" : "finish the workflow"}`, async ({ page }) => {
  await renderHost(page);
  await page.evaluate(value => (window as unknown as { showUnchanged(pending: boolean): void }).showUnchanged(value), pending);
  const row = page.locator(".opc-handbook-row").first();
  await expect(row.locator(":scope > summary")).toContainText("比对完成，文稿均已同步");
  await expect(row.getByText("本地文稿与线上一致，无需上传。", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "确认上传草稿", exact: true })).toHaveCount(0);
  await expect(row.getByRole("checkbox")).toHaveCount(0);
  await expect(row.getByText(pending ? "线上还有未发布草稿，请点击上方“打开网页手册设置”审核发布。" : "当前没有待上传或待发布的文稿，可以继续在 Obsidian 编辑。", { exact: true })).toBeVisible();
  if (pending) await expect(row.getByRole("button", { name: "打开网页手册设置", exact: true })).toHaveClass(/mod-cta/);
  expect(await page.evaluate(() => (window as unknown as { uploads: number }).uploads)).toBe(0);
});

test("unchanged text still offers upload when a referenced image is missing online", async ({ page }) => {
  await renderHost(page);
  await page.evaluate(() => (window as unknown as { showMissingImage(): void }).showMissingImage());
  const row = page.locator(".opc-handbook-row").first();
  await expect(row.getByText("本地文稿与线上一致，无需上传。", { exact: true })).toHaveCount(0);
  await row.getByRole("checkbox").check();
  await expect(row.getByRole("button", { name: "确认上传草稿", exact: true })).toBeEnabled();
});

for(const dark of [false,true])test(`plugin host theme ${dark?'dark':'light'}: narrow pane keeps actions inside the handbook`,async({page},info)=>{
  await page.setViewportSize({width:640,height:900});await renderHost(page,dark);
  await page.evaluate(()=>(window as unknown as {showComparison():void}).showComparison());
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('.opc-handbook-row').first().getByRole('button',{name:'确认上传草稿'})).toBeVisible();
  await page.screenshot({path:info.outputPath(`plugin-${dark?'dark':'light'}.png`),fullPage:true});
});
