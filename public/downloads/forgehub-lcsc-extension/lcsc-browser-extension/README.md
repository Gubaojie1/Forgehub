# ForgeHub 立创 STEP 下载扩展

## 安装（Edge / Chrome）

1. 下载完整 ZIP 并解压到一个固定文件夹。
2. Edge 打开 `edge://extensions`；Chrome 打开 `chrome://extensions`。
3. 开启“开发人员模式”，点击“加载解压缩的扩展”，选择 ZIP 中的 `lcsc-browser-extension` 文件夹。
4. 双击 ZIP 根目录中的 `Install-ForgeHub-Helper.cmd`，按提示完成本机助手注册（不需要管理员权限）。
5. 回到 ForgeHub，刷新立创 3D 下载页面，确认状态显示“已连接”。

当前扩展匹配 ForgeHub 试运行地址 `47.99.63.33`、`hub.47.99.63.33.sslip.io` 以及本地开发地址。网站域名变更后，需要在 `manifest.json` 和 `background.js` 的允许站点列表中添加新域名，再重新打包扩展。

浏览器扩展通过 Native Messaging 调用本机助手。本机助手使用与桌面工具相同的 HTTP 请求方式访问立创接口，并把 STEP 文件保存到 Windows“下载”目录；ForgeHub 服务端不转发或保存 STEP 文件。
