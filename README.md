# DSH Desktop

将 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）封装为 Windows 桌面应用的 Electron 壳：深色现代界面、系统托盘、自包含后端，端用户无需安装 Node.js 即可使用。

## 功能特性

- **深色现代界面**：zinc 色板设计令牌重映射，不修改任何 DSH 源码
- **系统托盘**：关闭窗口最小化到托盘，托盘菜单支持「打开 / 退出」，黑色大鲸鱼图标
- **自包含**：安装包捆绑完整 DSH 后端与全部依赖，开箱即用，无需安装 Node.js 或 Web DSH
- **数据随安装目录**：会话、设置、凭据全部保存在应用目录 `data\` 下，卸载即清空、拷贝即便携
- **完整 DSH 能力**：会话历史、模型切换、思考强度、Agent 预设、工作流、任务、权限审批，与 Web 版一致
- **零端口冲突**：后端自动分配空闲端口，可与已有的 DSH Web 实例并行运行

## 系统要求

- Windows 10/11 x64

## 安装与使用

1. 下载 `DSH-Desktop-Setup-<版本>.exe`，双击安装（可自选安装目录）
2. 首次启动等待 1-3 分钟（建立 profile 依赖链接）
3. 在「设置 → 模型」中配置自己的 API Key
4. 开始对话

## 从源码构建

```powershell
# 安装依赖（国内网络请配置镜像，见下）
npm.cmd install

# 开发运行
npm start

# 打包 Windows 安装器（输出到 dist\）
npm.cmd run dist
```

镜像配置（GitHub 直连不通时）：

```powershell
$env:electron_config_cache = "D:\DSH\smoke-test\dsh-desktop\.electron-cache"
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

## 工作原理

- 主进程以 Electron 自带 Node 运行时启动 DSH 后端（`dsh web --port 0`），解析输出中的 URL 后打开窗口
- 暗色皮肤 `src/theme-codex.css` 在每次页面加载后注入，将 DSH 设计令牌（`--dsw-static-*`）重映射为 zinc 色板
- 数据目录：Electron 状态与 DSH 数据均位于安装目录 `data\` 下，与其他 DSH 安装完全隔离

## 更新与维护

官方 DSH 更新后：升级本地 DSH 安装 → 重新执行 `npm.cmd run dist` 打包 → 发布新版本安装器。前端随 DSH 包自动更新，无需改动前端代码；安装到同一目录时 `data\` 数据保留。

## 图标

- 图标为 DeepSeek 鲸鱼（黑色），来源为 DSH 自带 `favicon.svg`，由 `tools/icon-capture.js` 光栅化生成
- 更换图标：替换 `assets/` 下对应文件后重新打包

## 项目结构

```
src/main.js            主进程（后端启动、皮肤注入、托盘、截图/E2E 自验证）
src/theme-codex.css    暗色皮肤（zinc 色板）
src/preload.js         preload 缝隙（预留）
assets/                应用图标（鲸鱼）
scripts/stage-dsh.ps1  打包前暂存 dsh 依赖（electron-builder 会丢弃根级 node_modules）
tools/icon-capture.js  图标光栅化工具
```

## 许可

MIT
