# OpenClaw Command Center — User Guide / 使用说明

> Bilingual documentation: English sections followed by Chinese (中文) translations.
>
> 双语文档：每节先英文后中文。

---

## Table of Contents / 目录

1. [Overview / 概述](#1-overview--概述)
2. [Installation / 安装](#2-installation--安装)
3. [Quick Deploy / 快速部署](#3-quick-deploy--快速部署)
4. [Login / 登录](#4-login--登录)
5. [Interface Layout / 界面布局](#5-interface-layout--界面布局)
6. [Pixel Office / 像素办公室](#6-pixel-office--像素办公室)
7. [Chat / 对话](#7-chat--对话)
8. [Bulletin Board / 公告广播](#8-bulletin-board--公告广播)
9. [Memory / 记忆管理](#9-memory--记忆管理)
10. [Activity Feed / 活动日志](#10-activity-feed--活动日志)
11. [Scheduler / 定时任务](#11-scheduler--定时任务)
12. [Skills & Workflows / 技能与工作流](#12-skills--workflows--技能与工作流)
13. [Dashboard / 统计面板](#13-dashboard--统计面板)
14. [Notifications / 通知系统](#14-notifications--通知系统)
15. [Session Replay / 会话回放](#15-session-replay--会话回放)
16. [Header Controls / 顶栏控件](#16-header-controls--顶栏控件)
17. [Keyboard & Tips / 快捷键与技巧](#17-keyboard--tips--快捷键与技巧)
18. [Troubleshooting / 故障排查](#18-troubleshooting--故障排查)

---

## 1. Overview / 概述

**English:**

OpenClaw Command Center is a visual management dashboard for your OpenClaw AI agent system. It provides a pixel-art office interface where each department is represented by a character, and you can chat with AI agents, broadcast commands, manage memories, schedule tasks, and monitor performance — all from a single web UI.

**Key capabilities:**
- Chat with 7 department AI agents via OpenClaw Gateway
- Pixel-art office with real-time status animations (thinking, errors, tool usage)
- Company-wide broadcast commands with department-by-department responses
- Memory management with version history and restore
- Cron job scheduler with execution history charts
- Multi-step workflow editor for cross-department automation
- Real-time streaming chat output
- Performance dashboard with token usage tracking
- Session recording and replay
- Browser notifications for errors, slow responses, and gateway disconnects
- Bilingual interface (English / Chinese)

**中文：**

OpenClaw 指挥中心是 OpenClaw AI 代理系统的可视化管理面板。它提供了一个像素风格的办公室界面，每个部门由一个像素小人代表，你可以与 AI 代理对话、广播命令、管理记忆、调度定时任务、监控性能 — 全部在一个网页中完成。

**核心功能：**
- 通过 OpenClaw Gateway 与 7 个部门 AI 代理对话
- 像素办公室实时显示状态动画（思考中、错误、工具使用）
- 全公司广播命令，各部门逐一回复
- 记忆管理，支持版本历史与恢复
- 定时任务调度，带执行历史图表
- 多步骤工作流编辑器，支持跨部门自动化
- 实时流式聊天输出
- 性能面板，含 Token 用量统计
- 会话录制与回放
- 浏览器通知（错误、慢响应、网关断连）
- 双语界面（英文/中文）

---

## 2. Installation / 安装

**English:**

```bash
# One-click install with default password "openclaw"
bash scripts/install.sh

# Or specify a custom password
bash scripts/install.sh mypassword
```

**Prerequisites:**
- Node.js >= 18
- npm
- pm2 (auto-installed if missing)
- OpenClaw Gateway running at `ws://127.0.0.1:18789`
- nginx (optional, for reverse proxy)

The installer will:
1. Check dependencies (node, npm, pm2)
2. Copy project files to `~/.openclaw/workspace/command-center`
3. Set login password
4. Install npm dependencies
5. Build the frontend (TypeScript + Vite)
6. Configure and start PM2 process
7. Optionally configure nginx reverse proxy at `/cmd/`

**中文：**

```bash
# 一键安装（默认密码 "openclaw"）
bash scripts/install.sh

# 或指定自定义密码
bash scripts/install.sh mypassword
```

**前置要求：**
- Node.js >= 18
- npm
- pm2（缺少时自动安装）
- OpenClaw Gateway 运行在 `ws://127.0.0.1:18789`
- nginx（可选，用于反向代理）

安装脚本会：
1. 检查依赖（node、npm、pm2）
2. 复制项目文件到 `~/.openclaw/workspace/command-center`
3. 设置登录密码
4. 安装 npm 依赖
5. 构建前端（TypeScript + Vite）
6. 配置并启动 PM2 进程
7. 可选配置 nginx 反向代理到 `/cmd/`

---

## 3. Quick Deploy / 快速部署

**English:**

After making code changes, use the deploy script to rebuild and restart:

```bash
bash scripts/deploy.sh
```

Or manually:

```bash
cd ~/.openclaw/workspace/command-center
npm run build          # Build frontend
pm2 restart openclaw-cmd  # Restart server
```

**中文：**

修改代码后，使用部署脚本一键重建并重启：

```bash
bash scripts/deploy.sh
```

或手动操作：

```bash
cd ~/.openclaw/workspace/command-center
npm run build              # 构建前端
pm2 restart openclaw-cmd   # 重启服务
```

---

## 4. Login / 登录

**English:**

Open `http://<your-ip>/cmd/` (with nginx) or `http://127.0.0.1:5100/cmd/` (direct).

Enter the password set during installation (default: `openclaw`). The session persists via a token stored in `localStorage`.

To change the password:
```bash
echo 'newpassword' > ~/.openclaw/workspace/command-center/.auth_password
```

**中文：**

打开 `http://<你的IP>/cmd/`（通过 nginx）或 `http://127.0.0.1:5100/cmd/`（直连）。

输入安装时设定的密码（默认：`openclaw`）。登录后 token 保存在 `localStorage` 中。

修改密码：
```bash
echo '新密码' > ~/.openclaw/workspace/command-center/.auth_password
```

---

## 5. Interface Layout / 界面布局

**English:**

The interface has four main areas:

```
┌──────────────────────────────────────────────────┐
│  Header: Title | Notifications | EN/中 | ⛶ | GW  │
├─────────────────────┬────────────────────────────┤
│                     │  Tab Bar: Chat | Bulletin  │
│   Pixel Office      │  | Memory | Activity |     │
│   (Canvas)          │  Scheduler | Skills | Stats│
│                     ├────────────────────────────┤
│                     │                            │
│                     │  Tab Content Area           │
│                     │                            │
├─────────────────────┴────────────────────────────┤
│  Status Bar: [COO] [Engineering] [Operations]... │
└──────────────────────────────────────────────────┘
```

- **Left panel**: Pixel office with department characters
- **Right panel**: 7 tabs for different functions (collapsible)
- **Top header**: Clock, gateway status, notifications, language toggle, fullscreen, logout
- **Bottom status bar**: Click department cards to select the active department

**中文：**

界面分为四个主要区域：

```
┌──────────────────────────────────────────────────┐
│  顶栏: 标题 | 通知 | EN/中 | ⛶ | GW             │
├─────────────────────┬────────────────────────────┤
│                     │  标签栏: 对话 | 公告 | 记忆  │
│   像素办公室          │  | 活动 | 定时 | 技能 | 统计│
│   (Canvas)          ├────────────────────────────┤
│                     │                            │
│                     │  标签内容区                   │
│                     │                            │
├─────────────────────┴────────────────────────────┤
│  状态栏: [总指挥部] [技术开发部] [运维监控部]...     │
└──────────────────────────────────────────────────┘
```

- **左面板**: 像素办公室，显示部门角色
- **右面板**: 7 个功能标签页（可收起）
- **顶栏**: 时钟、网关状态、通知、语言切换、全屏、登出
- **底部状态栏**: 点击部门卡片选择活动部门

---

## 6. Pixel Office / 像素办公室

**English:**

The left panel shows a pixel-art office with animated characters representing each department. Features:

- **Character states**: Idle (sitting), walking, typing (active)
- **Thinking animation**: Green bouncing dots appear above a character when its agent is processing
- **Error flash**: Red flash overlay when an agent encounters an error
- **Tool labels**: When an agent uses a tool (e.g., file read, web search), the tool name appears below the character in green
- **Collaboration arrows**: Animated dashed arrows between departments that have active cross-department requests
- **Sub-agents**: Created sub-agents appear as additional characters near their parent department
- **Zoom control**: Slider in the bottom-right corner (zoom in/out)
- **Department names**: Displayed below each character with emoji prefix

Click a character or use the bottom status bar to select a department.

**中文：**

左面板展示一个像素风格的办公室，动画角色代表各部门。功能包括：

- **角色状态**: 空闲（坐着）、行走、打字（活跃）
- **思考动画**: 代理处理时，角色上方出现绿色跳动圆点
- **错误闪烁**: 代理遇到错误时，角色显示红色闪烁
- **工具标签**: 代理使用工具时（如读文件、网页搜索），工具名以绿色显示在角色下方
- **协作箭头**: 有跨部门请求时，部门间显示动态虚线箭头
- **子代理**: 创建的子代理作为额外角色显示在父部门附近
- **缩放控制**: 右下角滑块（放大/缩小）
- **部门名称**: 显示在角色下方，带 emoji 前缀

点击角色或使用底部状态栏选择部门。

---

## 7. Chat / 对话

**English:**

Select a department (via status bar or pixel office), then use the **Chat** tab to communicate:

- **Send messages**: Type in the input box, press Enter to send (Shift+Enter for newline)
- **Paste images**: Paste screenshots directly (Ctrl+V) or click the upload button (max 4MB)
- **Streaming output**: Watch the AI response stream in real-time with a blinking cursor
- **Chat history**: Previous messages load automatically when selecting a department
- **Sub-agents**: Click `+` to create a sub-agent with a name and task. Sub-agents have independent conversation threads
- **Persona preview**: Click the `ℹ` icon to view the department's persona/role description
- **Daily log**: Click the calendar icon to browse daily activity logs by date
- **Timer shortcut**: Click the clock icon to create a scheduled task directly from chat

**中文：**

选择部门（通过状态栏或像素办公室），然后在**对话**标签页通信：

- **发送消息**: 在输入框输入，按 Enter 发送（Shift+Enter 换行）
- **粘贴图片**: 直接粘贴截图（Ctrl+V）或点击上传按钮（最大 4MB）
- **流式输出**: 实时观看 AI 回复，带闪烁光标
- **聊天历史**: 选择部门时自动加载历史消息
- **子代理**: 点击 `+` 创建子代理，设定名字和任务。子代理有独立对话线程
- **角色预览**: 点击 `ℹ` 图标查看部门的角色/职责描述
- **每日日志**: 点击日历图标按日期浏览日活动日志
- **定时快捷方式**: 点击时钟图标直接从对话中创建定时任务

---

## 8. Bulletin Board / 公告广播

**English:**

The **Bulletin** tab lets you broadcast a command to all departments simultaneously:

1. Type your command in the broadcast input
2. Press Enter or click Send
3. Wait ~30 seconds for all departments to respond
4. View each department's execution plan/response

This is useful for company-wide directives like "Write a status report" or "Review yesterday's tasks".

**中文：**

**公告**标签页可以同时向所有部门广播命令：

1. 在广播输入框输入命令
2. 按 Enter 或点击发送
3. 等待约 30 秒，所有部门回复
4. 查看各部门的执行计划/回复

适用于全公司指令，如"写一份状态报告"或"回顾昨天的任务"。

---

## 9. Memory / 记忆管理

**English:**

The **Memory** tab manages each department's persistent memory (stored as `MEMORY.md` files):

- **View**: Select a department to see its current memory content
- **Edit**: Click "Edit Memory" to modify, then Save or Cancel
- **History**: Click the clock icon to view version history
  - Each save creates an automatic backup
  - Browse previous versions with timestamps
  - Preview any version's content
  - Restore a previous version with one click

**中文：**

**记忆**标签页管理各部门的持久化记忆（存储为 `MEMORY.md` 文件）：

- **查看**: 选择部门查看当前记忆内容
- **编辑**: 点击"编辑记忆"修改，然后保存或取消
- **历史**: 点击时钟图标查看版本历史
  - 每次保存自动创建备份
  - 按时间戳浏览历史版本
  - 预览任意版本内容
  - 一键恢复到历史版本

---

## 10. Activity Feed / 活动日志

**English:**

The **Activity** tab shows a real-time feed of all department interactions:

- Messages from all sources: chat UI, Telegram, Gateway events, cron jobs
- Each entry shows department icon, timestamp, source badge (YOU/BOT), and message text
- Auto-scrolls to latest activity

**Session Replay controls** appear at the top (see [Session Replay](#15-session-replay--会话回放) section).

**中文：**

**活动**标签页显示所有部门交互的实时动态：

- 来自所有来源的消息：聊天界面、Telegram、Gateway 事件、定时任务
- 每条记录显示部门图标、时间戳、来源标签（YOU/BOT）和消息文本
- 自动滚动到最新活动

顶部显示**会话回放**控制按钮（见[会话回放](#15-session-replay--会话回放)章节）。

---

## 11. Scheduler / 定时任务

**English:**

The **Scheduler** tab manages cron jobs that automatically run commands on a schedule:

**Creating a task:**
1. Click `+ Create`
2. Fill in: name, schedule (interval in minutes or cron expression), message content
3. Optionally assign to a specific department and/or sub-agent
4. Set timeout (seconds)
5. Click "Create Scheduled Task"

**Managing tasks:**
- **Enable/Disable**: Toggle tasks on/off
- **Run Now**: Trigger immediate execution
- **Edit**: Modify message, schedule, or assignment
- **Delete**: Remove with confirmation
- **Execution History**: Expand a task to see a bar chart of recent executions (green = success, red = failure, bar height = duration)
- **Filter**: Filter by department or view all/global tasks

**中文：**

**定时**标签页管理按计划自动运行命令的定时任务：

**创建任务：**
1. 点击 `+ 创建`
2. 填写：名称、调度方式（间隔分钟数或 cron 表达式）、消息内容
3. 可选分配到特定部门和/或子代理
4. 设置超时时间（秒）
5. 点击"创建定时任务"

**管理任务：**
- **启用/禁用**: 切换任务开关
- **立即执行**: 触发立即运行
- **编辑**: 修改消息、调度方式或分配
- **删除**: 确认后删除
- **执行历史**: 展开任务查看最近执行的柱状图（绿色=成功，红色=失败，高度=耗时）
- **筛选**: 按部门筛选或查看全部/全局任务

---

## 12. Skills & Workflows / 技能与工作流

**English:**

The **Skills** tab shows all available OpenClaw skills and provides a workflow editor:

**Skills Browser:**
- Browse all registered skills with name, summary, tags, and version
- Search by name, description, or tags
- Click a skill to view full details and usage instructions
- Skills are invoked automatically by AI agents when relevant keywords appear in conversation

**Workflow Editor** (click "Workflows" button):
- Create multi-step automated workflows that run across departments
- Each step defines: target department, message/command, delay before next step
- Save workflows for reuse
- Run a workflow: steps execute sequentially, with results shown per-step
- View execution results: success/failure status, AI response, and duration for each step

**中文：**

**技能**标签页展示所有可用的 OpenClaw 技能，并提供工作流编辑器：

**技能浏览器：**
- 浏览所有已注册技能，显示名称、摘要、标签和版本
- 按名称、描述或标签搜索
- 点击技能查看完整详情和使用说明
- 在对话中提到相关关键词时，AI 代理会自动调用技能

**工作流编辑器**（点击"工作流"按钮）：
- 创建跨部门的多步骤自动化工作流
- 每个步骤定义：目标部门、消息/命令、执行间延迟
- 保存工作流以便重复使用
- 运行工作流：步骤按顺序执行，逐步显示结果
- 查看执行结果：每步的成功/失败状态、AI 回复和耗时

---

## 13. Dashboard / 统计面板

**English:**

The **Stats** tab shows real-time performance metrics:

**Global Stats:**
- Total messages sent
- Average response time
- Error rate percentage
- Server uptime

**Gateway Status:**
- Connection status (Connected/Disconnected)
- Latency, pending requests, active streams, uptime

**Per-Department Metrics:**
- Message count and error count
- Average response time
- Mini bar chart of recent response times

**Token Usage:**
- Input/output token counts per department
- Total token consumption

**Recent Permissions:**
- Log of recent tool permission events with department and timestamp

**中文：**

**统计**标签页显示实时性能指标：

**全局统计：**
- 总消息数
- 平均响应时间
- 错误率百分比
- 服务器运行时间

**网关状态：**
- 连接状态（已连接/已断开）
- 延迟、待处理请求、活跃流、运行时间

**各部门指标：**
- 消息数和错误数
- 平均响应时间
- 最近响应时间迷你柱状图

**Token 用量：**
- 各部门输入/输出 token 数
- 总 token 消耗

**最近权限：**
- 最近的工具权限事件日志，含部门和时间戳

---

## 14. Notifications / 通知系统

**English:**

Click the bell icon in the header to configure browser notifications:

- **Enable Notifications**: Master toggle (requests browser permission)
- **Error alerts**: Get notified when a department encounters an error
- **Gateway disconnect**: Get notified when the gateway connection drops
- **Slow responses**: Get notified when AI response time exceeds threshold

Preferences are saved in `localStorage` and persist across sessions.

**中文：**

点击顶栏的铃铛图标配置浏览器通知：

- **启用通知**: 主开关（请求浏览器权限）
- **错误提醒**: 部门遇到错误时通知
- **网关断连**: 网关连接断开时通知
- **慢响应提醒**: AI 响应超时时通知

偏好设置保存在 `localStorage` 中，跨会话持久化。

---

## 15. Session Replay / 会话回放

**English:**

The Activity tab includes recording and replay controls:

**Recording:**
1. Click "Record" to start capturing all WebSocket events
2. The indicator shows real-time event count
3. Click "Stop" to save the recording

**Playback:**
1. Click "Replay" to see saved recordings
2. Click "Play" on any recording to replay events into the activity feed
3. Events play back at 4x speed by default
4. Click "Stop" to cancel playback

**Deleting:**
- Click "Delete" next to any saved replay to remove it

Replays are saved as JSON files in the `replays/` directory.

**中文：**

活动标签页包含录制和回放控制：

**录制：**
1. 点击"录制"开始捕获所有 WebSocket 事件
2. 指示器实时显示事件数量
3. 点击"停止"保存录制

**回放：**
1. 点击"回放"查看已保存的录制
2. 点击任一录制的"播放"将事件回放到活动流
3. 默认 4 倍速回放
4. 点击"停止"取消回放

**删除：**
- 点击已保存回放旁的"删除"移除

回放以 JSON 文件保存在 `replays/` 目录。

---

## 16. Header Controls / 顶栏控件

**English:**

From left to right in the header:

| Control | Function |
|---------|----------|
| Title | "OpenClaw Office" / "超哥办公室" |
| Bell icon | Notification preferences dropdown |
| EN/中 | Toggle English/Chinese interface |
| Fullscreen icon | Enter/exit fullscreen mode |
| Logout icon | Log out (clears auth token) |
| GW dot | Gateway connection status (green = connected) |
| Status dot | WebSocket connection status |
| Clock | Current time display |

**中文：**

顶栏从左到右的控件：

| 控件 | 功能 |
|------|------|
| 标题 | "OpenClaw Office" / "超哥办公室" |
| 铃铛图标 | 通知偏好设置下拉菜单 |
| EN/中 | 切换英文/中文界面 |
| 全屏图标 | 进入/退出全屏模式 |
| 登出图标 | 登出（清除认证 token） |
| GW 圆点 | 网关连接状态（绿色=已连接） |
| 状态圆点 | WebSocket 连接状态 |
| 时钟 | 当前时间显示 |

---

## 17. Keyboard & Tips / 快捷键与技巧

**English:**

| Action | Shortcut |
|--------|----------|
| Send message | Enter |
| New line in message | Shift + Enter |
| Paste screenshot | Ctrl + V (in chat input) |

**Tips:**
- Click the panel toggle arrow (between left/right panels) to collapse the right panel for a full pixel office view
- The pixel office zoom slider is in the bottom-right corner of the canvas
- Sub-agents appear as separate characters in the pixel office and have independent chat threads
- Gateway latency is shown in the GW tooltip (hover over the GW indicator)
- The dashboard auto-refreshes every 10 seconds

**中文：**

| 操作 | 快捷键 |
|------|--------|
| 发送消息 | Enter |
| 消息中换行 | Shift + Enter |
| 粘贴截图 | Ctrl + V（在聊天输入框中） |

**技巧：**
- 点击左右面板之间的折叠箭头可收起右面板，获得完整像素办公室视图
- 像素办公室缩放滑块在画布右下角
- 子代理在像素办公室中显示为独立角色，有独立对话线程
- 网关延迟显示在 GW 提示框中（鼠标悬停 GW 指示器）
- 统计面板每 10 秒自动刷新

---

## 18. Troubleshooting / 故障排查

**English:**

| Problem | Solution |
|---------|----------|
| "Gateway not connected" | Ensure OpenClaw Gateway is running: `ws://127.0.0.1:18789` |
| Login fails | Check password: `cat ~/.openclaw/workspace/command-center/.auth_password` |
| Chat returns error | Check PM2 logs: `pm2 logs openclaw-cmd --lines 50` |
| Page won't load | Rebuild: `bash scripts/deploy.sh` |
| WS disconnected | Check server is running: `pm2 status openclaw-cmd` |
| Departments not showing | Verify config: `cat ~/.openclaw/workspace/departments/config.json` |
| Nginx 502 | Ensure PM2 process is running, check port 5100 |

**PM2 commands:**
```bash
pm2 logs openclaw-cmd          # View logs
pm2 restart openclaw-cmd       # Restart
pm2 stop openclaw-cmd          # Stop
pm2 status                     # Check status
```

**中文：**

| 问题 | 解决方案 |
|------|---------|
| "网关未连接" | 确保 OpenClaw Gateway 运行中：`ws://127.0.0.1:18789` |
| 登录失败 | 检查密码：`cat ~/.openclaw/workspace/command-center/.auth_password` |
| 对话返回错误 | 检查 PM2 日志：`pm2 logs openclaw-cmd --lines 50` |
| 页面无法加载 | 重新构建：`bash scripts/deploy.sh` |
| WS 断开连接 | 检查服务运行：`pm2 status openclaw-cmd` |
| 部门未显示 | 验证配置：`cat ~/.openclaw/workspace/departments/config.json` |
| Nginx 502 | 确保 PM2 进程运行，检查端口 5100 |

**PM2 命令：**
```bash
pm2 logs openclaw-cmd          # 查看日志
pm2 restart openclaw-cmd       # 重启
pm2 stop openclaw-cmd          # 停止
pm2 status                     # 检查状态
```

---

## Architecture / 系统架构

```
Browser (React 19 + Vite + Canvas 2D)
  ├── Pixel Office (7+ characters, zoom)
  ├── Right Panel (7 tabs)
  └── Status Bar (department cards)
       │
       │ WebSocket + REST API
       ▼
Express + ws (port 5100)
  ├── server/index.js       — Main server, WS hub, event routing
  ├── server/gateway.js     — OpenClaw Gateway client
  ├── server/agent.js       — Chat, broadcast, sub-agents, memory
  ├── server/watcher.js     — File system watcher → WS push
  ├── server/auth.js        — Password authentication
  └── server/routes/
       ├── api.js           — Departments, memory, persona, daily logs
       ├── cron.js          — Scheduler CRUD + execution
       ├── skills.js        — Skills listing
       ├── metrics.js       — Performance metrics + permissions
       ├── workflows.js     — Multi-step workflow CRUD + run
       └── replay.js        — Session recording + playback
```
