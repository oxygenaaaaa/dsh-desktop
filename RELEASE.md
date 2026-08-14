# DSH Desktop — GitHub 发布清单

## 1. 建仓库并推送源码

推送到 GitHub 前确认仓库里**不含**这些目录（`.gitignore` 已排除）：

- `node_modules/`、`dist/`（构建产物）
- `.npm-cache/`、`.electron-cache/`、`.userdata/`
- `shots/`（验证截图与报告，含对话内容，不入库）

```powershell
cd <项目目录>
git init -b main
git add .
git commit -m "DSH Desktop v0.1.0"
# 关联远端后: git push -u origin main
```

## 2. 打标签并发布 Release

```powershell
git tag v0.1.0
git push origin v0.1.0
```

GitHub 上 Create a new release → 选 `v0.1.0` → 上传附件：

- `dist\DSH-Desktop-Setup-0.1.0.exe`（安装器，用户下载这个）

## 3. Release 文案模板（中文）

```markdown
# DSH Desktop v0.1.0

将 DeepSeek Harness 封装为 Windows 桌面应用：Codex 风格暗色界面 + 系统托盘 + 自包含后端。

## 安装

下载 `DSH-Desktop-Setup-0.1.0.exe`，双击安装（可自选安装目录）。
**无需安装 Node.js**。

## 首次使用

1. 打开 DSH Desktop
2. 进入「设置 → 模型」，填入自己的 DeepSeek（或其他兼容）API Key
3. 开始对话

## 功能

- Codex 风格暗色界面（zinc 配色，不修改 DSH 源码）
- 关闭窗口最小化到系统托盘（黑色大鲸鱼图标）
- 完整 DSH 能力：会话历史、模型切换、思考强度、Agent 预设、工作流、任务、权限审批
- 数据保存在应用目录 `data\` 下（卸载即清空、拷贝即便携）

## 系统要求

- Windows 10/11 x64
```

## 4. 后续版本

改完代码后重新打包：

```powershell
npm.cmd run dist
```

产物在 `dist\`，版本号在 `package.json` 的 `version` 字段。官方 DSH 更新后：
升级本地 DSH 安装 → 重新打包 → 发布新版本（前端随 DSH 包自动更新）。
