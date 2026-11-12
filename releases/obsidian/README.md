# OPC手册管理器安装包

[下载安装包](wanyou-handbooks.zip) · [SHA-256 校验文件](wanyou-handbooks.zip.sha256)

此目录提供可直接安装的桌面 Obsidian 插件，随 Git 仓库和源码包交付。版本号位于包内 `manifest.json`，无需先编译网站。

解压后，将 `wanyou-handbooks` 文件夹放入 Vault 的 `.obsidian/plugins/`，在 Obsidian 的「设置 → 第三方插件」启用 OPC手册管理器。升级时先停用插件，替换发布文件，保留原 `data.json`，再启用。

完整安装、连接和上传步骤见[使用指南](../../docs/deployment/obsidian.md)。需要校验下载文件时，在 ZIP 与校验文件所在目录执行：

```bash
shasum -a 256 -c wanyou-handbooks.zip.sha256
```
