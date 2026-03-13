# Vaaagle AI Music Player (Electron)

一个基于 Electron + React 的 AI 音乐播放器示例项目，提供歌曲搜索、播放、歌词、下载、收藏与 AI 推荐能力。

## 功能概览

- OpenAI Compatible AI 推荐（可配置 `baseUrl` / `apiKey` / `model`）
- AI 高可用策略（超时重试、备用端点回退、本地关键词降级）
- AI 连通性测试（设置弹窗内一键检测）
- 歌曲搜索 / 播放 / 封面 / 歌词（LRC 同步滚动）
- 多音乐源自动兜底（默认：`netease` / `kuwo` / `joox` / `bilibili`）
- 播放模式（列表循环 / 随机播放 / 单曲循环）
- 下首播放队列（插队播放、移除）
- 歌曲下载到本地 `Downloads/VaaagleMusic`
- 收藏夹与播放历史（SQLite3 本地持久化）

## 第三方音乐接口出处声明


本项目默认音乐接口地址来自公开第三方服务“GD音乐台(music.gdstudio.xyz)”：

- 默认 `music.apiBase`：`https://music-api.gdstudio.xyz/api.php`
- 接口用途：搜索、获取播放链接、封面与歌词
- 在代码中的调用位置：`electron/musicService.js`

说明：

- 该接口由第三方提供，本项目仅作客户端接入示例
- 本项目与该第三方服务及其上游内容平台无隶属、授权或担保关系
- 若第三方服务策略变更、下线或限制访问，应用相关能力会受影响

## 免责声明

- 本软件仅用于个人学习、技术研究与合法范围内的音乐信息检索演示
- 软件不内置受保护音频资源，不主动存储、制作、分发受保护内容
- 软件内展示信息与播放链接来自用户配置或第三方公开接口
- 用户需自行确保使用行为符合所在地法律法规与平台条款（含版权相关要求）
- 因使用本软件产生的任何争议、索赔或损失，由使用者自行承担

## 快速开始

```bash
npm install
npm run dev
```

若 Electron 下载较慢，可使用镜像：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
```

## 配置说明

- 默认配置文件：`config/defaults.json`
- 运行后用户配置：`%APPDATA%/app/config.json`（由 `app.getPath('userData')` 决定）

常用可配置项：

- `openai.baseUrl`
- `openai.apiKey`
- `openai.model`
- `openai.backupEndpoints`（每项包含 `baseUrl` / `apiKey` / `model`）
- `openai.requestTimeoutMs` / `openai.connectTimeoutMs` / `openai.maxRetries`
- `music.apiBase`
- `music.source`
- `music.sources`
- `music.searchCount`
- `music.bitrate`

## 打包与发布

> 输出目录统一为 `release/`

- `npm run build`：仅构建前端资源（Vite）
- `npm run dist:win`：Windows 打包（默认 target，含 nsis + portable）
- `npm run dist:setup`：Windows 安装包（NSIS）
- `npm run dist:portable`：Windows 绿色版（Portable）
- `npm run dist:web`：Windows Web 安装器（NSIS Web）

相关配置见 `package.json` 中 `build` 字段（`appId`、`productName`、`asar`、`win.target`、`nsis` 等）。

## 基本架构

### 分层结构

- 渲染进程（UI）：`src/main.jsx`、`src/App.jsx`、`src/styles.css`
- 主进程（桌面能力）：`electron/main.js`
- 安全桥接（IPC 白名单接口）：`electron/preload.js`

### 业务模块

- AI 推荐服务：`electron/aiService.js`
- 音乐接口服务：`electron/musicService.js`
- 收藏/历史数据库：`electron/favoritesDb.js`
- 配置读写与合并：`electron/configStore.js`

### 数据与流程

- UI 通过 `preload` 暴露的 API 发起请求
- 主进程负责调度 AI、音乐接口、数据库、文件下载
- 本地状态持久化在 SQLite（收藏/历史）和用户配置文件中

## 音乐 API 对接说明

当前实现的接口类型：

- `types=search`：搜索
- `types=url`：获取播放链接
- `types=pic`：获取封面
- `types=lyric`：获取歌词

默认音乐源为 `netease`，可在配置中切换或扩展。
