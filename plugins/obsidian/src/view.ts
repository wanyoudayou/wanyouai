import { ItemView, Modal, Notice, PluginSettingTab, Setting, TFile, TFolder, type App, type ButtonComponent, type TextComponent, type WorkspaceLeaf } from "obsidian";
import { randomUUID } from "node:crypto";
import type HandbooksPlugin from "./main";
import { inventoryFiles, statusLabel, versionLabel, type Binding } from "./manager";
import { digest, snapshot, type Snapshot } from "./snapshot";
import { PartialSyncError, needsDraftUpload, requiresOverwrite, type Compared } from "./sync";
import { safeVaultPath, siteOrigin, type Inventory } from "../../../packages/handbook-protocol/src";
function hasReadme(app: App, folder: string) {
  const file = app.vault.getAbstractFileByPath(folder);
  return file instanceof TFolder && file.children.some(f => f instanceof TFile && f.name.toLowerCase() === "readme.md");
}
class Confirm extends Modal {
  constructor(app: App, private message: string, private action: () => Promise<void>) { super(app); }
  onOpen() {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl).addButton(b => b.setButtonText("取消").onClick(() => this.close())).addButton(b => b.setButtonText("确认移除").setWarning().onClick(() => { this.close(); void this.action().catch(e => new Notice((e as Error).message)); }));
  }
  onClose() { this.contentEl.empty(); }
}

/** Selecting multiple folders changes this device's list only, with no remote writes. */
class LoadFolders extends Modal {
  constructor(app: App, private plugin: HandbooksPlugin) { super(app); }
  onOpen() {
    const el = this.contentEl; el.createEl("h2", { text: "载入本地手册文件夹" });
    el.createEl("p", { text: "可勾选多个当前 Vault 内的文件夹。这里只加入管理列表，创建线上手册时才读取并上传文稿。每份手册只扫描文件夹根目录，不扫描子目录笔记。" });
    const folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => {
      if (!(f instanceof TFolder)) return false;
      try { safeVaultPath(f.path); return f.path !== "/"; } catch { return false; }
    }).sort((a, b) => a.path.localeCompare(b.path));
    const selected = new Set<string>(); let filter = "";
    const filterRow = el.createDiv();
    const list = el.createDiv({ cls: "opc-handbook-folder-list" }); const status = el.createEl("p", { attr: { role: "status" } });
    let submit: ButtonComponent;
    const renderList = () => {
      list.empty();
      for (const folder of folders.filter(f => f.path.toLowerCase().includes(filter.toLowerCase()))) {
        const loaded = this.plugin.settings.folders.includes(folder.path);
        new Setting(list).setName(folder.path).setDesc(loaded ? "已在本地列表" : hasReadme(this.app, folder.path) ? "包含 README.md" : "载入后需补充根目录 README.md").addToggle(t => t.setValue(loaded || selected.has(folder.path)).setDisabled(loaded).onChange(value => {
          if (value) selected.add(folder.path); else selected.delete(folder.path);
          submit.setDisabled(!selected.size).setButtonText(`载入选中文件夹（${selected.size}）`);
        }));
      }
    };
    new Setting(filterRow).setName("筛选文件夹").addText(t => t.setPlaceholder("输入文件夹名称").onChange(value => { filter = value; renderList(); }));
    new Setting(el).addButton(b => b.setButtonText("取消").onClick(() => this.close())).addButton(b => submit = b.setButtonText("载入选中文件夹（0）").setCta().setDisabled(true).onClick(async () => {
      b.setDisabled(true);
      try {
        const result = await this.plugin.loadFolders([...selected]);
        if (result.skipped.length) { status.setText(`已载入 ${result.added.length} 项。跳过：${result.skipped.join("；")}`); selected.clear(); renderList(); b.setButtonText("载入选中文件夹（0）"); }
        else this.close();
      } catch (e) { status.setText((e as Error).message); b.setDisabled(false); }
    }));
    renderList();
  }
  onClose() { this.contentEl.empty(); }
}

class CreateHandbook extends Modal {
  constructor(app: App, private plugin: HandbooksPlugin, private folder: string) { super(app); }
  async onOpen() {
    const el = this.contentEl; el.createEl("h2", { text: "上传手册草稿" });
    el.createEl("p", { text: `本地文件夹：${this.folder}。内容统一保存为线上草稿，详情与发布请到网页后台设置。只读取根目录 Markdown 及其实际引用图片，子目录和无关文件忽略。图片进入公开素材库。` });
    let createReadme = false;
    let submit: ButtonComponent;
    const missingReadme = !hasReadme(this.app, this.folder);
    if (missingReadme) new Setting(el).setName("创建空白 README.md").setDesc("当前文件夹缺少手册介绍。勾选后在根目录创建空文件并继续绑定，之后可在 Obsidian 补写；其内容会全文公开。文件名不区分大小写，已有文件不会覆盖。").addToggle(t => t.onChange(value => { createReadme = value; submit?.setDisabled(!value); }));
    const status = el.createEl("p", { attr: { role: "status" } });
    try {
      await this.plugin.connect();
      const list = await this.plugin.handbooks(); let selected = "new", title = this.folder.split("/").pop()!, slug = `handbook-${digest(`${this.plugin.settings.origin}\n${this.folder}`).slice(0, 16)}`;
      const choice = new Setting(el).setName("线上目标");
      const fields = el.createDiv();
      choice.addDropdown(d => { d.addOption("new", "新建线上手册"); for (const item of list) d.addOption(String(item.id), `关联已有：${item.title}`); d.onChange(value => { selected = value; fields.toggle(value === "new"); }); });
      new Setting(fields).setName("手册名称").addText(t => t.setValue(title).onChange(value => title = value));
      new Setting(fields).setName("网址标识").setDesc("已自动生成，可以直接保留；自定义时使用小写英文字母、数字和连字符。").addText(t => t.setValue(slug).onChange(value => slug = value));
      new Setting(el).addButton(b => b.setButtonText("取消").onClick(() => this.close())).addButton(b => submit = b.setButtonText("确认目标并比对").setCta().setDisabled(missingReadme).onClick(async () => {
        b.setDisabled(true); status.setText("正在确认线上手册…");
        try {
          if (this.plugin.settings.bindings.some(item => item.origin === this.plugin.settings.origin && item.folder === this.folder)) throw new Error("这个文件夹已有绑定，请从列表同步。");
          if (selected === "new" && (!/^[a-z0-9][a-z0-9-]{1,119}$/.test(slug) || !title.trim())) throw new Error("请填写有效的名称和网址标识。");
          await this.plugin.ensureReadme(this.folder, createReadme);
          let series = list.find(item => String(item.id) === selected);
          if (selected === "new") {
            const created = await this.plugin.sync(() => {}).operation<{ id: number }>(`create:${slug}`, "create", { slug, title: title.trim() });
            series = (await this.plugin.handbooks()).find(item => item.id === created.id);
          }
          if (!series) throw new Error("线上手册未找到，请重新连接后检查。");
          if (this.plugin.settings.bindings.some(item => item.origin === this.plugin.settings.origin && (item.series.id === series!.id || item.folder === this.folder))) throw new Error("这个线上手册或本地文件夹已有绑定，请使用已有条目。");
          const binding: Binding = { origin: this.plugin.settings.origin, folder: this.folder, series, digest: "", images: [], files: {}, changed: true };
          this.plugin.settings.bindings.push(binding); await this.plugin.save(); this.close();
          const view = await this.plugin.open(this.folder); await view.prepare(binding);
        } catch (e) { status.setText((e as Error).message); b.setDisabled(false); }
      }));
    } catch (e) { status.setText((e as Error).message); }
  }
  onClose() { this.contentEl.empty(); }
}

export class HandbookSettings extends PluginSettingTab {
  constructor(app: App, private plugin: HandbooksPlugin) { super(app, plugin); }
  display() {
    const el = this.containerEl; el.empty(); el.createEl("h2", { text: "OPC手册管理器" });
    el.createEl("p", { text: "在网站后台 → Obsidian 连接创建手册上传凭据，把它粘贴到下方。凭据保存在 Obsidian 密钥库，保存后不回显。" });
    let credential: TextComponent;
    new Setting(el).setName("站点首页").setDesc("填写固定 HTTPS 域名。更换站点后需重新填写该站点的凭据。").addText(t => t.setValue(this.plugin.settings.origin).setPlaceholder("https://www.example.com").onChange(async value => {
      this.plugin.settings.origin = value.trim(); this.plugin.settings.secretRef = ""; this.plugin.settings.secretOrigin = ""; credential?.setValue(""); this.plugin.disconnect(); await this.plugin.save();
    }));
    new Setting(el).setName("手册上传凭据").setDesc(this.plugin.settings.secretRef ? "已保存，留空使用现有凭据；填写新值可以替换。" : "粘贴网站生成的 whp_ 开头的完整凭据。").addText(t => {
      credential = t; t.inputEl.type = "password"; t.inputEl.autocomplete = "off"; t.setPlaceholder(this.plugin.settings.secretRef ? "已保存，留空保持" : "whp_…");
    });
    const status = el.createEl("p", { attr: { role: "status" } });
    new Setting(el).addButton(b => b.setButtonText("保存凭据并连接").setCta().onClick(async () => {
      b.setDisabled(true);
      try {
        const origin = siteOrigin(this.plugin.settings.origin); const token = credential.getValue().trim();
        if (token) {
          if (!/^whp_[a-f0-9]{64}$/.test(token)) throw new Error("请粘贴网站生成的完整手册上传凭据（whp_ 开头），不要填写 Supabase 密钥。");
          const ref = this.plugin.settings.secretOrigin === origin && this.plugin.settings.secretRef ? this.plugin.settings.secretRef : `opc-handbooks-${randomUUID()}`;
          this.app.secretStorage.setSecret(ref, token); this.plugin.settings.secretRef = ref; this.plugin.settings.secretOrigin = origin; this.plugin.disconnect(); await this.plugin.save(); credential.setValue("");
        }
        await this.plugin.connect(); status.setText("连接成功。打开“我的本地手册”载入文件夹，创建或同步线上手册。");
      } catch (e) { status.setText((e as Error).message); }
      finally { b.setDisabled(false); }
    }));
  }
}

type Prepared = { binding: Binding; snapshot: Snapshot; compared: Compared[]; inventory: Inventory; overwrites: Set<string> };
function hasPendingUploads({ compared, inventory, snapshot: frozen }: Prepared) {
  return compared.some(item => needsDraftUpload(item, inventory)) || frozen.images.some(image => !inventory.assets.some(asset => asset.path === image.path && asset.source_hash === image.hash));
}
const states: Record<string, string> = { draft: "草稿", published: "已发布", paused: "已暂停", archived: "已归档" };
function onlineLabel(file: Inventory["files"][number]) {
  return [file.online ? `${states[file.online.status] ?? file.online.status} v${file.online.version}` : "未发布", file.latest && !file.latest.publication?.article ? `草稿修订 v${file.latest.version}` : ""].filter(Boolean).join(" · ");
}
export class HandbookView extends ItemView {
  selected = "";
  private busy = false;
  private messages = new Map<string, string>();
  private statuses = new Map<string, HTMLElement>();
  private prepared: Prepared | null = null;
  constructor(leaf: WorkspaceLeaf, private plugin: HandbooksPlugin) { super(leaf); }
  getViewType() { return "wanyou-handbooks"; }
  getDisplayText() { return "我的本地手册"; }
  getIcon() { return "book-up"; }
  async onOpen() { this.render(); await this.plugin.refreshOnlineStatus(); }
  refresh() {
    if (this.busy) return;
    if (this.prepared && this.prepared.binding.origin !== this.plugin.settings.origin) { this.prepared = null; this.message = "站点已更换，请重新读取并比对。"; }
    if (!this.prepared) this.render();
  }
  onlineUpdated(folder: string) {
    if (!this.busy && this.prepared?.binding.folder === folder) { this.prepared = null; this.messages.set(folder, "线上状态已有更新，请重新比对后上传。"); }
  }
  private set message(text: string) { this.messages.set(this.selected, text); }
  private async run(work: () => Promise<void>) {
    if (this.busy) return; this.busy = true; this.render();
    try { await work(); } catch (error) { this.message = (error as Error).message; }
    finally { this.busy = false; this.render(); }
  }
  private progress = (text: string) => { this.message = text; this.statuses.get(this.selected)?.setText(text); };
  async prepare(binding: Binding) {
    if (this.busy) return; this.selected = binding.folder; this.prepared = null;
    this.message = "正在读取线上文稿，与本地逐项比对…";
    return this.run(async () => {
      await this.plugin.connect();
      if (binding.origin !== this.plugin.settings.origin) throw new Error("站点已变更，请重新绑定。");
      const series = (await this.plugin.handbooks()).find(item => item.id === binding.series.id);
      if (!series) { binding.onlineMissing = true; await this.plugin.save(); throw new Error("线上手册不存在或已归档，请解除本机绑定后重新上传。"); }
      binding.series = series; binding.onlineMissing = false;
      const sync = this.plugin.sync(this.progress); await sync.reconcile(series.slug);
      const inventory = await sync.inventory(series.slug);
      const frozen = await snapshot(this.plugin.reader(), binding.folder, series.slug, inventory);
      const compared = await sync.compare(frozen);
      this.prepared = { binding, snapshot: frozen, compared, inventory, overwrites: new Set() };
      binding.files = inventoryFiles(inventory); binding.onlineCheckedAt = new Date().toISOString(); await this.plugin.save();
      this.message = compared.some(item => item.error) ? "比对有错误，请查看对应文稿。" : !hasPendingUploads(this.prepared) ? "比对完成，本地文稿与线上一致，无需上传。" : compared.some(requiresOverwrite) ? "本地与线上有内容差异，请左右核对，并逐项确认需要覆盖的草稿。" : "比对完成。确认清单后上传为草稿，再到网页后台设置与发布。";
    });
  }
  private recover(binding: Binding) {
    this.selected = binding.folder; this.prepared = null;
    return this.run(async () => {
      await this.plugin.connect(); const sync = this.plugin.sync(this.progress); const result = await sync.reconcile(binding.series.slug);
      binding.files = inventoryFiles(await sync.inventory(binding.series.slug)); binding.onlineCheckedAt = new Date().toISOString();
      this.message = `查询完成：${result.confirmed} 个任务已完成，${result.unfinished} 个尚无完成记录，${result.blocked} 个被校验阻断。本次没有重新上传。请重新比对后继续。`;
      await this.plugin.save();
    });
  }
  render() {
    const el = this.contentEl; const scroll = el.scrollTop; const focused = el.contains(document.activeElement) && document.activeElement instanceof HTMLButtonElement ? document.activeElement.textContent : null; el.empty(); this.statuses.clear(); el.addClass("wanyou-handbooks");
    el.createEl("h2", { text: "我的本地手册" });
    el.createEl("p", { text: "只管理根目录文稿和引用图片。先比对、再上传草稿，最后到网页后台一次发布；本地删除不会删除线上文稿。" });
    new Setting(el).setName(this.plugin.settings.origin || "请先在插件设置中保存站点与凭据")
      .setDesc(this.plugin.readingStatus ? "正在后台读取线上状态…" : this.plugin.connectionError || (this.plugin.connected ? "已自动恢复连接；返回本页时会静默刷新线上状态。" : "保存过的连接会自动恢复，无需每次手动连接。"))
      .addButton(b => b.setButtonText("批量载入文件夹").setDisabled(this.busy).onClick(() => new LoadFolders(this.app, this.plugin).open()))
      .addButton(b => b.setButtonText("刷新线上状态").setDisabled(this.busy || !this.plugin.canConnect || this.plugin.readingStatus).onClick(() => void this.plugin.refreshOnlineStatus(true)));
    const bindings = this.plugin.settings.bindings.filter(b => b.origin === this.plugin.settings.origin);
    if (!this.plugin.settings.folders.length) el.createEl("p", { text: "点击“批量载入文件夹”，勾选当前 Vault 内要管理的手册。" });
    for (const folder of this.plugin.settings.folders) {
      const binding = bindings.find(b => b.folder === folder); const readme = hasReadme(this.app, folder);
      const prepared = this.prepared?.binding === binding ? this.prepared : null;
      const row = el.createEl("details", { cls: `opc-handbook-row${this.selected === folder ? " is-selected" : ""}` }); row.open = this.selected === folder;
      const summary = row.createEl("summary"); summary.createEl("span", { text: binding?.series.title ?? folder.split("/").pop()!, cls: "opc-handbook-title" });
      summary.createEl("span", { text: folder, cls: "opc-handbook-path" });
      const hasErrors = prepared?.compared.some(i => i.error);
      const hasUpdates = prepared ? hasPendingUploads(prepared) : false;
      summary.createEl("span", { text: prepared ? hasErrors ? "比对有错误，请查看对应文稿" : hasUpdates ? "比对完成，待确认上传草稿" : "比对完成，文稿均已同步" : statusLabel(binding), cls: hasErrors || (!prepared && binding?.failures?.length) || binding?.onlineMissing ? "opc-handbook-error" : "opc-handbook-state" });
      if (binding) {
        summary.createEl("span", { text: `线上手册：${states[binding.series.status] ?? binding.series.status} · ${versionLabel(binding)}`, cls: "opc-handbook-path" });
        if (binding.onlineCheckedAt) summary.createEl("span", { text: `线上状态读取于 ${new Date(binding.onlineCheckedAt).toLocaleString()}`, cls: "opc-handbook-path" });
      }
      row.addEventListener("toggle", () => {
        if (!row.isConnected) return;
        if (this.busy) { row.open = this.selected === folder; return; }
        if (row.open && this.selected !== folder) { this.selected = folder; this.render(); }
        else if (!row.open && this.selected === folder) { this.selected = ""; this.render(); }
      });
      const detail = row.createDiv({ cls: "opc-handbook-detail" });
      const steps = detail.createEl("ol", { cls: "opc-handbook-steps", attr: { "aria-label": "手册上传流程" } });
      const hasPendingDrafts = binding && Object.values(binding.files).some(file => file.draftVersion);
      let stage = 0;
      if (binding) {
        if (prepared) stage = hasUpdates ? 1 : hasPendingDrafts ? 2 : 3;
        else if (!binding.changed && !binding.failures?.length) stage = hasPendingDrafts ? 2 : 3;
      }
      ["比对文稿", "上传草稿", "网页发布"].forEach((text, index) => steps.createEl("li", { text: `${index + 1}. ${text}`, cls: index < stage ? "is-complete" : index === stage ? "is-current" : "", attr: index === stage ? { "aria-current": "step" } : {} }));
      this.statuses.set(folder, detail.createEl("p", { text: this.messages.get(folder) ?? "", attr: { role: "status", "aria-live": "polite" } }));
      const actions = new Setting(detail).setClass("opc-handbook-actions");
      if (!binding) actions.addButton(b => b.setButtonText("上传为新手册草稿／关联手册").setCta().setDisabled(this.busy || !this.plugin.canConnect).onClick(() => new CreateHandbook(this.app, this.plugin, folder).open()));
      else if (!binding.onlineMissing) {
        actions.addButton(b => { b.setButtonText(prepared ? "重新比对" : binding.failures?.length ? "重新比对未完成项" : "比对本地与线上"); if (!prepared && (binding.changed || binding.failures?.length)) b.setCta(); return b.setDisabled(this.busy || !this.plugin.canConnect || !readme).onClick(() => void this.prepare(binding)); });
        if (binding.failures?.length && !prepared) actions.addButton(b => b.setButtonText("查询未确认任务").setDisabled(this.busy || !this.plugin.canConnect).onClick(() => void this.recover(binding)));
        actions.addButton(b => { b.setButtonText("打开网页手册设置"); if ((prepared ? !hasUpdates : !binding.changed) && hasPendingDrafts) b.setCta(); return b.onClick(() => window.open(`${binding.origin}/admin/collections/${binding.series.id}`, "_blank", "noopener,noreferrer")); });
      }
      if (binding?.onlineMissing) actions.addButton(b => b.setButtonText("解除无效绑定").setDisabled(this.busy).onClick(() => new Confirm(this.app, "解除这份手册的本机绑定？本地文件保留，随后可以重新上传。", async () => {
        this.plugin.settings.bindings = this.plugin.settings.bindings.filter(b => b !== binding);
        const journal = this.plugin.settings.journals[binding.origin]; if (journal?.[`create:${binding.series.slug}`]?.done) delete journal[`create:${binding.series.slug}`];
        this.prepared = null; await this.plugin.save(); this.render();
      }).open()));
      actions.addButton(b => b.setButtonText("移出本地列表").setDisabled(this.busy).onClick(() => new Confirm(this.app, `移除“${folder}”的本机管理和绑定？本地文件、线上文稿均保留。`, async () => {
        this.plugin.settings.folders = this.plugin.settings.folders.filter(p => p !== folder);
        this.plugin.settings.bindings = this.plugin.settings.bindings.filter(b => b !== binding);
        if (this.selected === folder) { this.selected = ""; this.prepared = null; }
        await this.plugin.save(); this.render();
      }).open()));
      if (!readme) {
        let create = false; let button: ButtonComponent;
        new Setting(detail).setName("创建空白 README.md").setDesc("勾选后只在该文件夹根目录新建空白介绍，不覆盖已有文件。").addToggle(t => t.setDisabled(this.busy).onChange(v => { create = v; button.setDisabled(!v || this.busy); }))
          .addButton(b => button = b.setButtonText("创建空白介绍").setDisabled(true).onClick(() => { this.selected = folder; void this.run(async () => { await this.plugin.ensureReadme(folder, create); this.message = "README.md 已创建，可以继续上传草稿。"; }); }));
      }
      if (binding?.failures?.length) {
        const history = detail.createEl("details", { attr: prepared ? {} : { open: "" } }); history.createEl("summary", { text: "上次未完成记录" });
        for (const f of binding.failures) history.createEl("p", { text: `${f.path}：${f.message}`, cls: "opc-handbook-error" });
      }
      if (prepared) this.preview(detail, prepared);
    }
    el.scrollTop = scroll;
    if (focused) [...el.querySelectorAll("button")].find(b => b.textContent === focused && !b.disabled)?.focus({ preventScroll: true });
  }
  private preview(el: HTMLElement, prepared: Prepared) {
    const { compared, inventory, snapshot: frozen, binding, overwrites } = prepared;
    el.createEl("h4", { text: "本地 → 线上：上传前比对" });
    el.createEl("p", { text: `${compared.length} 篇本地文稿，${frozen.images.length} 张引用图片。上传只更新草稿，不改变当前公开正文。仅在线上的文稿全部保留。` });
    let confirmed = false; let submit: ButtonComponent;
    const ready = () => !compared.some(i => i.error || !i.check || (requiresOverwrite(i) && !overwrites.has(i.note.path)));
    const update = () => { confirmation.setDisabled(this.busy || !ready()); submit.setDisabled(this.busy || !confirmed || !ready()); nextStep.setText(ready() ? "清单已就绪，勾选确认后可上传草稿。" : "请先处理上方错误，或逐项确认需要覆盖的内容差异。"); };
    const table = el.createDiv({ cls: "opc-handbook-comparison" }).createEl("table");
    const header = table.createEl("thead").createEl("tr"); for (const text of ["本地文稿", "线上文稿", "本次操作"]) header.createEl("th", { text, attr: { scope: "col" } });
    const body = table.createEl("tbody");
    for (const item of compared) {
      const file = inventory.files.find(f => f.path === item.note.path); const article = inventory.onlineArticles?.find(a => a.slug === item.check?.input.frontmatter.slug); const tr = body.createEl("tr", { cls: item.error ? "opc-handbook-problem" : requiresOverwrite(item) ? "opc-handbook-difference" : "" });
      tr.createEl("td", { text: item.note.path });
      tr.createEl("td", { text: file ? `${file.path} · ${onlineLabel(file)}` : article ? `${article.title} · ${states[article.status] ?? article.status} v${article.version}` : "线上暂无对应文稿" });
      const action = tr.createEl("td");
      if (item.error) action.createEl("p", { text: item.error, cls: "opc-handbook-error" });
      else if (requiresOverwrite(item)) new Setting(action).setName("用本地覆盖线上草稿").setDesc("本地与线上不同。勾选后保留历史，另存本地版本为新草稿；不会删除文稿或自动发布。").addToggle(t => {
        t.toggleEl.setAttribute("aria-label", `确认覆盖：${item.note.path}`); t.setValue(overwrites.has(item.note.path)).setDisabled(this.busy).onChange(v => { if (v) overwrites.add(item.note.path); else overwrites.delete(item.note.path); confirmed = false; confirmation.setValue(false); update(); });
      });
      else action.setText(item.check?.change === "unchanged" ? "相同，跳过" : file ? "更新线上草稿" : "新增草稿");
      const diff = body.createEl("tr").createEl("td", { attr: { colspan: "3" } }).createEl("details");
      diff.createEl("summary", { text: `查看正文比对：${item.note.path}` });
      const columns = diff.createDiv({ cls: "opc-handbook-diff" });
      const local = columns.createDiv(); local.createEl("p", { text: "本地待上传正文" }); local.createEl("pre", { text: item.note.candidate.input.markdown });
      const remote = columns.createDiv(); remote.createEl("p", { text: item.check?.previousMarkdownSource === "published" ? "线上已发布正文" : "线上最新草稿" }); remote.createEl("pre", { text: item.check?.previousMarkdown ?? "暂无正文或读取未成功" });
    }
    for (const file of inventory.files.filter(f => !frozen.notes.some(n => n.path === f.path))) {
      const row = body.createEl("tr"); row.createEl("td", { text: "本地无此文件" }); row.createEl("td", { text: `${file.path} · ${onlineLabel(file)}` }); row.createEl("td", { text: "仅在线上，保留，不删除" });
    }
    for (const article of (inventory.onlineArticles ?? []).filter(a => !inventory.files.some(f => f.article_slug === a.slug) && !compared.some(i => i.check?.input.frontmatter.slug === a.slug))) {
      const row = body.createEl("tr"); row.createEl("td", { text: "本地未绑定" }); row.createEl("td", { text: `${article.title} · ${states[article.status] ?? article.status} v${article.version}` }); row.createEl("td", { text: "网页创建，保留，不删除" });
    }
    const images = el.createEl("details"); images.createEl("summary", { text: "本次上传的公开图片" }); for (const i of frozen.images) images.createEl("p", { text: `${i.vaultPath} · ${(i.bytes.byteLength / 1024).toFixed(1)} KiB` });
    if (frozen.ignored.length) { const skipped = el.createEl("details"); skipped.createEl("summary", { text: `扫描说明（${frozen.ignored.length} 项）` }); for (const notice of frozen.ignored) skipped.createEl("p", { text: notice }); }
    if (!hasPendingUploads(prepared)) {
      el.createEl("p", { text: "本地文稿与线上一致，无需上传。" });
      el.createEl("p", { text: Object.values(binding.files).some(file => file.draftVersion) ? "线上还有未发布草稿，请点击上方“打开网页手册设置”审核发布。" : "当前没有待上传或待发布的文稿，可以继续在 Obsidian 编辑。" });
      return;
    }
    const nextStep = el.createEl("p", { text: ready() ? "清单已就绪，勾选确认后可上传草稿。" : "请先处理上方错误，或逐项确认需要覆盖的内容差异。" });
    let confirmation: import("obsidian").ToggleComponent;
    new Setting(el).setName("确认将以上本地文稿上传为草稿").setDesc("引用图片进入公开素材库。正文、价格、阅读权限与发布在网页后台管理。").addToggle(t => { confirmation = t; t.setDisabled(this.busy || !ready()).onChange(v => { confirmed = v; update(); }); });
    new Setting(el).addButton(b => submit = b.setButtonText("确认上传草稿").setCta().setDisabled(true).onClick(() => void this.run(async () => {
      if (!confirmed || !ready() || binding.origin !== this.plugin.settings.origin) return;
      await this.plugin.connect(); binding.images = frozen.images.map(i => i.vaultPath); await this.plugin.save();
      try {
        const current = await this.plugin.sync(this.progress).saveDrafts(frozen, compared, binding.series, inventory, this.plugin.info(), overwrites);
        binding.files = inventoryFiles(current); binding.series = (await this.plugin.handbooks()).find(s => s.id === binding.series.id) ?? binding.series;
        binding.digest = frozen.digest; binding.outcome = "draft"; binding.failures = []; binding.lastSyncedAt = binding.onlineCheckedAt = new Date().toISOString(); binding.changed = true;
        try { const now = await snapshot(this.plugin.reader(), binding.folder, binding.series.slug, current); binding.changed = now.digest !== frozen.digest; } catch { /* A later local edit is separate from the completed upload. */ }
        this.prepared = null; this.message = "草稿上传完成。点击“打开网页手册设置”配置详情、核对阅读权限并发布。"; await this.plugin.save();
      } catch (error) {
        binding.changed = true; binding.outcome = "partial"; binding.failures = error instanceof PartialSyncError ? error.failures : [{ path: "本次上传", message: (error as Error).message, kind: "completion" }]; this.prepared = null;
        try { binding.files = inventoryFiles(await this.plugin.sync(this.progress).inventory(binding.series.slug)); } catch { /* Unknown results stay unresolved until a read succeeds. */ }
        await this.plugin.save(); throw error;
      }
    })));
  }
}
