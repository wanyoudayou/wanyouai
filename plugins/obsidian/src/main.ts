import { FileSystemAdapter, Plugin, TFile, TFolder, type TAbstractFile } from "obsidian";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { HandbookRequestError } from "./client";
import { HandbookConnection } from "./connection";
import { snapshot, type VaultReader } from "./snapshot";
import { Sync, type Journal } from "./sync";
import { inventoryFiles, loadFolders, type Binding } from "./manager";
import { ensureReadme } from "./readme";
import { HandbookView, HandbookSettings } from "./view";
import { safeVaultPath, siteOrigin, type Handbook } from "../../../packages/handbook-protocol/src";
export type Settings = { origin: string; secretRef: string; secretOrigin: string; folders: string[]; bindings: Binding[]; journals: Record<string, Journal> };
const VIEW = "wanyou-handbooks";
const blank: Settings = { origin: "", secretRef: "", secretOrigin: "", folders: [], bindings: [], journals: {} };

export default class HandbooksPlugin extends Plugin {
  settings: Settings = structuredClone(blank);
  private connection = new HandbookConnection(ref => this.app.secretStorage.getSecret(ref));
  private statusRead: Promise<void> | null = null;
  private lastStatusRead = 0;
  connectionError = "";
  private saves: Promise<void> = Promise.resolve();
  async onload() {
    const data = await this.loadData(); this.settings = { ...structuredClone(blank), ...data, folders: data?.folders ?? [...new Set<string>((data?.bindings ?? []).map((b: Binding) => b.folder))] };
    for (const binding of this.settings.bindings) binding.changed = true;
    this.registerView(VIEW, leaf => new HandbookView(leaf, this));
    this.addRibbonIcon("book-up", "OPC手册管理器", () => void this.open());
    this.addCommand({ id: "open-handbooks", name: "打开我的本地手册", callback: () => void this.open() });
    this.addSettingTab(new HandbookSettings(this.app, this));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFolder && file.path !== "/") menu.addItem(item => item.setTitle("上传到 OPC 站").setIcon("book-up").onClick(() => void this.open(file.path)));
    }));
    const markChanged = (file: TAbstractFile, oldPath?: string) => {
        let changed = false;
        for (const binding of this.settings.bindings) if (file.path === binding.folder || (file.path.startsWith(binding.folder + "/") && !file.path.slice(binding.folder.length + 1).includes("/") && /\.md$/i.test(file.path)) || binding.images.includes(file.path) || (oldPath && (oldPath === binding.folder || (oldPath.startsWith(binding.folder + "/") && !oldPath.slice(binding.folder.length + 1).includes("/") && /\.md$/i.test(oldPath)) || binding.images.includes(oldPath)))) { binding.changed = true; changed = true; }
        if (changed) void this.save();
        if (changed || this.settings.folders.some(folder => file.path === folder || file.path.startsWith(folder + "/") || oldPath === folder || oldPath?.startsWith(folder + "/"))) this.refresh();
    };
    this.registerEvent(this.app.vault.on("modify", file => markChanged(file)));
    this.registerEvent(this.app.vault.on("create", file => markChanged(file)));
    this.registerEvent(this.app.vault.on("delete", file => markChanged(file)));
    this.registerEvent(this.app.vault.on("rename", markChanged));
    this.app.workspace.onLayoutReady(() => { if (this.canConnect) void this.refreshOnlineStatus(); });
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => { if (leaf?.view.getViewType() === VIEW) void this.refreshOnlineStatus(); }));
    this.registerDomEvent(window, "focus", () => { if (this.app.workspace.getActiveViewOfType(HandbookView)) void this.refreshOnlineStatus(); });
  }
  save() {
    const data = structuredClone(this.settings);
    const saved = this.saves.then(() => this.saveData(data));
    this.saves = saved.catch(() => {});
    return saved;
  }
  disconnect() { this.connection.clear(); this.connectionError = ""; this.lastStatusRead = 0; this.refresh(); }
  get canConnect() { return !!this.settings.origin && !!this.settings.secretRef && !!this.settings.secretOrigin; }
  get connected() { return !!this.connection.peek(this.settings); }
  get readingStatus() { return !!this.statusRead; }
  async connect() {
    if (!this.settings.secretRef) throw new Error("请先在 OPC手册管理器设置中填写并保存手册上传凭据。");
    try { await this.connection.ensure(this.settings); const origin = siteOrigin(this.settings.origin); if (origin !== this.settings.origin) { this.settings.origin = origin; await this.save(); } this.connectionError = ""; }
    catch (error) { this.connectionError = (error as Error).message; throw error; }
  }
  client() { const current = this.connection.peek(this.settings); if (!current) throw new Error("连接尚未恢复，请重试读取线上状态。"); return current.client; }
  info() { this.client(); return this.connection.peek(this.settings)!.info; }
  async refreshOnlineStatus(force = false) {
    if (this.statusRead) return this.statusRead;
    if (!this.canConnect || (!force && Date.now() - this.lastStatusRead < 15000)) return;
    this.lastStatusRead = Date.now();
    const work = (async () => {
      try {
        await this.connect(); const origin = this.settings.origin; const handbooks = await this.handbooks();
        for (const binding of this.settings.bindings.filter(b => b.origin === origin)) {
          const series = handbooks.find(s => s.id === binding.series.id);
          if (!series) { binding.onlineMissing = true; continue; }
          const inventory = await this.sync(() => {}).inventory(series.slug);
          if (origin !== this.settings.origin) return;
          const files = inventoryFiles(inventory);
          if (JSON.stringify(binding.files) !== JSON.stringify(files) || binding.series.updated_at !== series.updated_at) for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as HandbookView).onlineUpdated(binding.folder);
          binding.series = series; binding.files = files; binding.onlineMissing = false; binding.onlineCheckedAt = new Date().toISOString();
          if (binding.digest) { try { binding.changed = (await snapshot(this.reader(), binding.folder, series.slug, inventory)).digest !== binding.digest; } catch { binding.changed = true; } }
        }
        await this.save(); this.connectionError = "";
      } catch (error) {
        if (error instanceof HandbookRequestError && error.status === 401) this.connection.clear();
        this.connectionError = (error as Error).message;
      }
    })();
    this.statusRead = work; this.refresh();
    try { await work; } finally { if (this.statusRead === work) this.statusRead = null; this.refresh(); }
  }
  sync(progress: (text: string) => void) { const origin = this.settings.origin; this.settings.journals[origin] ??= {}; return new Sync(this.client(), this.settings.journals[origin], () => this.save(), progress); }
  async handbooks() {
    const items: Handbook[] = [];
    for (let page = 1; ; page++) { const result = await this.client().get<{ items: Handbook[]; total: number }>("list", { page: String(page) }); items.push(...result.items); if (page * 100 >= result.total) return items; }
  }
  async loadFolders(paths: string[]) {
    const result = loadFolders(this.settings.folders, paths); this.settings.folders = result.folders; await this.save(); this.refresh(); return result;
  }
  async open(folder?: string) {
    if (folder && !this.settings.folders.includes(folder)) await this.loadFolders([folder]);
    const leaf = this.app.workspace.getLeavesOfType(VIEW)[0] ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW, active: true }); await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view as HandbookView; view.selected = folder ?? view.selected; view.render(); return view;
  }
  refresh() { for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as HandbookView).refresh(); }
  private async vaultPath(path: string) {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("当前版本只支持桌面本地笔记库。");
    safeVaultPath(path); const root = await realpath(adapter.getBasePath()); const target = await realpath(resolve(root, path)); const rel = relative(root, target);
    if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel) || target !== resolve(root, path)) throw new Error("不读取或创建笔记库之外的文件或符号链接。");
    safeVaultPath(rel); return stat(target);
  }
  async ensureReadme(folder: string, allowCreate: boolean) {
    if (!(await this.vaultPath(folder)).isDirectory()) throw new Error("所选路径不是手册文件夹。");
    return ensureReadme({ paths: () => this.app.vault.getFiles().map(file => file.path), create: (path, content) => this.app.vault.create(path, content) }, folder, allowCreate);
  }
  reader(): VaultReader {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("当前版本只支持桌面本地笔记库。");
    const verify = async (path: string, max: number) => {
      const info = await this.vaultPath(path); if (!info.isFile() || info.size > max) throw new Error(`${path}：文件大小超限或不是普通文件。`);
      return this.app.vault.getAbstractFileByPath(path);
    };
    return {
      markdownFiles: folder => this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + "/")).map(f => f.path),
      readText: async path => { const file = await verify(path, 2 * 1024 * 1024); if (!(file instanceof TFile)) throw new Error("笔记不存在。"); return this.app.vault.read(file); },
      resolve: (reference, source) => this.app.metadataCache.getFirstLinkpathDest(reference, source)?.path ?? null,
      readImage: async path => { const file = await verify(path, 10 * 1024 * 1024); if (!(file instanceof TFile)) throw new Error("图片不存在。"); return new Uint8Array(await this.app.vault.readBinary(file)); },
    };
  }
}
