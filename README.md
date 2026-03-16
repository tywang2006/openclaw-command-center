<div align="center">

# 超哥办公室 — OpenClaw 指挥中心

**AI 多代理虚拟办公室控制面板**

**AI Multi-Agent Virtual Office Dashboard**

[![npm version](https://img.shields.io/npm/v/openclaw-command-center.svg?style=flat-square&color=00d4aa)](https://www.npmjs.com/package/openclaw-command-center)
[![node](https://img.shields.io/node/v/openclaw-command-center.svg?style=flat-square&color=0096ff)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/openclaw-command-center.svg?style=flat-square&color=ffc832)](LICENSE)

将你的 AI 代理变成虚拟办公团队 — 像素风办公室、部门对话、子代理、定时任务、Gateway 流式通信、全套集成。

Turn your AI agents into a virtual office team — pixel-art office, department chat, sub-agents, cron jobs, Gateway streaming, full integrations.

---

[中文](#中文) | [English](#english)

</div>

---

<a id="中文"></a>

## 中文

### 这是什么？

OpenClaw 指挥中心是一个 Web 控制面板，将你的 AI 代理变成虚拟办公团队。每个"部门"都有独立的 AI 助手 — 用自然语言和它们对话、设置自动化任务、从复古像素风界面监控一切。

```
浏览器 (React 19 + Canvas 2D)
  ├── 像素办公室   ← 每个部门一个动画角色
  ├── 右侧面板     ← 对话 / 公告 / 记忆 / 定时 / 统计 / ...
  └── 底部状态栏   ← 部门卡片 + 快速切换
       ↓ WebSocket
Express + ws (端口 5100)
  ├── REST API (/api/*)
  └── gateway.js → OpenClaw 网关 (ws://127.0.0.1:18789)
```

### 核心功能

| 类别 | 功能说明 |
|------|---------|
| **AI 对话** | 自然语言与各部门助手交流，流式响应，子代理创建，图片/文档上传 (PDF/DOCX/XLSX)，对话导出 |
| **像素办公室** | Canvas 渲染的虚拟办公室，动画精灵角色，自动扩展的网格布局，点击角色选中部门 |
| **部门管理** | UI 内创建/编辑/删除，自定义图标和颜色，Telegram Topic 关联，右键菜单操作 |
| **定时任务** | 基于 Cron 的自动化，支持间隔或 Cron 表达式，执行历史记录，暂停/恢复/删除 |
| **集成服务** | Gmail 邮件发送、Google Drive 备份、语音输入 (Whisper)、Webhook 通知、Google Sheets |
| **全员广播** | 一条命令发给所有部门，收集全部回复，适合公司级协调 |
| **记忆系统** | 每部门独立 AI 记忆，手动编辑，版本历史，角色 (Persona) 配置 |
| **监控面板** | 网关状态、Token 用量、实时活动流、性能指标 |
| **移动端** | 响应式布局，滑动手势，触控优化，移动端抽屉菜单 |
| **双语界面** | 完整中英文 UI，一键切换 |

**斜杠命令：**

| 命令 | 别名 | 说明 |
|------|------|------|
| `/help` | `/帮助` | 显示所有命令 |
| `/dept` | `/部门` | 创建/管理部门 |
| `/broadcast` | `/广播` | 广播到所有部门 |
| `/export` | `/导出` | 导出当前对话 |
| `/status` | `/状态` | 查看系统状态 |
| `/clear` | `/清屏` | 清空当前聊天 |

### 快速开始

**方式一：交互式安装器（推荐）**

```bash
npx openclaw-command-center
```

或者克隆后运行：

```bash
git clone https://github.com/tywang2006/openclaw-command-center.git
cd openclaw-command-center
bash install.sh
```

安装器提供两种模式：
- **新手模式** — 从零搭建（OpenClaw + 网关 + 指挥中心）
- **已有用户模式** — 仅安装指挥中心（自动检测已有 OpenClaw 配置）

**方式二：手动安装**

```bash
git clone https://github.com/tywang2006/openclaw-command-center.git
cd openclaw-command-center
npm install
npm run build
node server/index.js
```

访问 **http://localhost:5100/cmd/**

### 配置说明

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENCLAW_HOME` | `~/.openclaw` | OpenClaw 根目录 |
| `CMD_PORT` | `5100` | 服务端口 |
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | 网关 WebSocket 地址 |
| `OPENCLAW_AUTH_TOKEN` | *(自动检测)* | 网关认证令牌 |

部门通过 UI 管理 — 点击状态栏 **+** 按钮，或在对话中输入 `/dept`。

### 部署

**PM2（推荐）：**

```bash
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

**Nginx 反向代理：**

```nginx
location /cmd/ {
    proxy_pass http://127.0.0.1:5100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

**健康检查：** `GET /health` — 返回服务器状态、运行时间、网关连接状态。

### 项目结构

```
command-center/
├── server/                # Express 后端
│   ├── index.js           #   HTTP + WebSocket 服务器
│   ├── gateway.js         #   OpenClaw 网关客户端
│   ├── agent.js           #   通过网关的 AI 对话
│   ├── auth.js            #   密码认证 (scrypt)
│   └── routes/            #   API 路由模块
├── src/                   # React 19 前端
│   ├── components/        #   20+ UI 组件
│   ├── office/            #   像素艺术引擎
│   ├── i18n/              #   中文 + 英文
│   └── hooks/             #   WebSocket 状态管理
├── install.sh             # 交互式安装器
└── dist/                  # 生产构建输出
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, TypeScript 5.9, Vite 7, Canvas 2D |
| 后端 | Express 5, WebSocket (ws), chokidar |
| AI | OpenClaw 网关 (协议 3-5) |
| 认证 | scrypt + 时序安全比较 |
| 进程 | PM2 |

---

<a id="english"></a>

## English

### What is this?

OpenClaw Command Center is a web-based dashboard that turns your AI agents into a virtual office team. Each "department" has its own AI assistant — chat with them in natural language, set up automated tasks, and monitor everything from a retro pixel-art interface.

```
Browser (React 19 + Canvas 2D)
  ├── Pixel Office   ← animated characters per department
  ├── Right Panel    ← Chat / Bulletin / Memory / Scheduler / Stats / ...
  └── Status Bar     ← department cards + quick switch
       ↓ WebSocket
Express + ws (port 5100)
  ├── REST API (/api/*)
  └── gateway.js → OpenClaw Gateway (ws://127.0.0.1:18789)
```

### Features

| Category | What you get |
|----------|-------------|
| **AI Chat** | Natural language conversation with department agents, streaming responses, sub-agent creation, image & document upload (PDF/DOCX/XLSX), conversation export |
| **Pixel Office** | Canvas-rendered office with animated sprite characters, auto-expanding grid layout, click-to-select departments |
| **Department Management** | Create / edit / delete from UI, custom icons & colors, Telegram topic linking, right-click context menu |
| **Scheduled Tasks** | Cron-based automation, interval or cron expression, execution history, pause/resume/delete |
| **Integrations** | Gmail SMTP, Google Drive backup, Voice input (Whisper), Webhook notifications, Google Sheets |
| **Team Broadcast** | One command to all departments, collect all responses, ideal for company-wide coordination |
| **Memory System** | Per-department AI memory, manual editing, version history, persona configuration |
| **Monitoring** | Gateway stats, token usage, real-time activity feed, performance metrics |
| **Mobile** | Responsive layout, swipe gestures, touch-optimized, mobile drawer menu |
| **i18n** | Full Chinese / English UI with one-click toggle |

**Slash Commands:**

| Command | Alias | Description |
|---------|-------|-------------|
| `/help` | `/帮助` | Show all commands |
| `/dept` | `/部门` | Create/manage departments |
| `/broadcast` | `/广播` | Broadcast to all departments |
| `/export` | `/导出` | Export current conversation |
| `/status` | `/状态` | View system status |
| `/clear` | `/清屏` | Clear current chat |

### Quick Start

**Option A: Interactive Installer (Recommended)**

```bash
npx openclaw-command-center
```

Or clone and run:

```bash
git clone https://github.com/tywang2006/openclaw-command-center.git
cd openclaw-command-center
bash install.sh
```

The installer offers two modes:
- **Beginner Mode** — full setup from scratch (OpenClaw + Gateway + Command Center)
- **Existing User Mode** — Command Center only (detects existing OpenClaw config)

**Option B: Manual Setup**

```bash
git clone https://github.com/tywang2006/openclaw-command-center.git
cd openclaw-command-center
npm install
npm run build
node server/index.js
```

Access at **http://localhost:5100/cmd/**

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_HOME` | `~/.openclaw` | OpenClaw root directory |
| `CMD_PORT` | `5100` | Server port |
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | Gateway WebSocket URL |
| `OPENCLAW_AUTH_TOKEN` | *(auto-detected)* | Gateway auth token |

Departments are managed through the UI — click **+** in the status bar, or type `/dept` in chat.

### Deployment

**PM2 (Recommended):**

```bash
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

**Nginx Reverse Proxy:**

```nginx
location /cmd/ {
    proxy_pass http://127.0.0.1:5100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

**Health Check:** `GET /health` — returns server status, uptime, gateway state.

### Project Structure

```
command-center/
├── server/                # Express backend
│   ├── index.js           #   HTTP + WebSocket server
│   ├── gateway.js         #   OpenClaw Gateway client
│   ├── agent.js           #   AI chat via Gateway
│   ├── auth.js            #   Password auth (scrypt)
│   └── routes/            #   API route modules
├── src/                   # React 19 frontend
│   ├── components/        #   20+ UI components
│   ├── office/            #   Pixel art engine
│   ├── i18n/              #   Chinese + English
│   └── hooks/             #   WebSocket state management
├── install.sh             # Interactive installer
└── dist/                  # Production build output
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5.9, Vite 7, Canvas 2D |
| Backend | Express 5, WebSocket (ws), chokidar |
| AI | OpenClaw Gateway (protocol 3-5) |
| Auth | scrypt + timing-safe comparison |
| Process | PM2 |

---

<div align="center">

MIT License | Made by [@tywang2006](https://github.com/tywang2006)

</div>
