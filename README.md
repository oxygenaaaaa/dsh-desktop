# DSH Desktop

**由 DeepSeek 打造** —— 基于 DeepSeek Harness（DSH）的 Windows 桌面客户端：深色现代界面、系统托盘、自包含后端，无需安装 Node.js，安装即用。

## 功能

- 深色现代界面（zinc 配色，不改动 DSH 源码）
- 关闭窗口最小化到系统托盘（黑色鲸鱼图标）
- 安装包自包含完整 DSH 后端与依赖，开箱即用
- 完整 DSH 能力：会话、模型切换、思考强度、Agent 预设、工作流、任务、权限审批
- 数据保存在应用目录 `data\`，卸载即清空、拷贝即便携

## 系统要求

- Windows 10/11 x64

## 安装与使用

1. 下载 `DSH-Desktop-Setup-<版本>.exe`，双击安装（可自选安装目录）
2. 打开应用，进入「设置 → 模型」，填写自己的 DeepSeek（或其他兼容）API Key
3. 开始对话

## 从源码构建

```powershell
npm install     # 国内网络请配置 npmmirror 镜像
npm start       # 开发运行
npm run dist    # 打包安装器（输出到 dist\）
```

## 许可

MIT

---

**Built with DeepSeek** 🐳
