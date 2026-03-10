# OpenClaw Command Center

A pixel-art office visualization and control panel for [OpenClaw](https://github.com/openclaw) AI agents. Manage departments, chat with AI agents, monitor activity, and orchestrate workflows — all from a retro-style virtual office.

```
Browser (React 18 + Canvas 2D)
  ├── Pixel Office (department characters + zoom)
  ├── Right Panel (Chat / Bulletin / Memory / Activity / Scheduler / Stats / Capabilities)
  └── Bottom Status Bar (department cards + context menu)
       ↓ WebSocket
Express + ws (port 5100)
  ├── chokidar (file watcher)
  ├── REST API (/api/*)
  └── gateway.js → OpenClaw Gateway (ws://127.0.0.1:18789)
```

## Quick Start

### Interactive Installer

```bash
# Clone and run the interactive installer:
git clone https://github.com/openclaw/command-center.git ~/.openclaw/workspace/command-center
cd ~/.openclaw/workspace/command-center
bash install.sh
```

The installer offers **two modes**:

**Beginner Mode** (12 steps) — full setup from scratch:
1. Check prerequisites (Node.js >= 18, npm, pm2)
2. Overwrite warning (if existing OpenClaw found)
3. Install OpenClaw globally
4. Run `openclaw setup --wizard` (interactive)
5. Configure model provider
6. Configure Gateway
7. Start Gateway service
8. Verify Gateway health (15 retries)
9. Install npm dependencies
10. Set password, generate .env, configure departments
11. Build frontend + generate office layout + start PM2
12. Final health check

**Existing User Mode** (8 steps) — Command Center only:
1. Check prerequisites
2. Detect OpenClaw config and extract auth token
3. Verify Gateway is running
4. Install dependencies
5. Configure (password, .env, departments)
6. Build and start service
7. Auto-configure Nginx (if detected)
8. Final health check

Features: bilingual (中文/English), whiptail menus with plain-text fallback, retry/skip/abort on failure, animated spinners, Chinese npm mirror hints.

Access at **http://localhost:5100/cmd/**

### Manual Setup

```bash
git clone https://github.com/openclaw/command-center.git
cd command-center
npm install
cp .env.example .env          # edit as needed
npm run build                 # build frontend
node server/index.js          # start server
```

## Features

**Pixel Office**
- Canvas-rendered office with animated sprite characters per department
- Auto-expanding grid layout (4 offices per row, grows with departments)
- Click a character to select their department for chat

**Department Management**
- Create / edit / delete departments from the UI
- Right-click (desktop) or long-press (mobile) a status bar card to edit
- Each department has: name, icon (16 choices), color (8 presets), optional Telegram Topic ID
- Dynamic config — no code changes needed to add departments

**AI Chat**
- Chat with any department's AI agent through OpenClaw Gateway
- Sub-agent creation for parallel tasks
- Streaming responses with real-time text display
- Image and document upload (PDF, DOCX, XLSX, PPTX)
- Conversation export (Markdown / HTML)
- Slash commands with autocomplete hints (type `/` to see all)

**Slash Commands**

| Command | Alias | Description |
|---------|-------|-------------|
| `/dept` | `/部门` | Create/manage departments |
| `/broadcast` | `/广播` | Broadcast message to all departments |
| `/export` | `/导出` | Export current conversation |
| `/status` | `/状态` | View system status |
| `/clear` | `/清屏` | Clear current chat |
| `/help` | `/帮助` | Show all commands |

**Integrations**
- Telegram bidirectional messaging (auto-syncs with group topics)
- Gmail SMTP email sending
- Google Drive backup
- Voice input (OpenAI Whisper transcription)
- Webhook notifications

**Monitoring**
- Real-time activity feed from all departments
- Gateway connection stats and latency
- Token usage tracking
- Scheduled task management (cron)
- Workflow automation builder

**Mobile**
- Responsive layout with swipe gestures
- Mobile navigation bar and drawer menu
- Touch-optimized department picker

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_HOME` | `~/.openclaw` | OpenClaw root directory |
| `CMD_PORT` | `5100` | Server port |
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | Gateway WebSocket URL |
| `OPENCLAW_AUTH_TOKEN` | *(from openclaw.json)* | Gateway auth token |
| `TELEGRAM_BOT_TOKEN` | | Telegram bot token |
| `TELEGRAM_GROUP_ID` | | Telegram group ID |

### Department Config

Departments are defined in `~/.openclaw/workspace/departments/config.json`:

```json
{
  "departments": {
    "engineering": {
      "name": "Engineering",
      "agent": "CTO",
      "icon": "wrench",
      "color": "#00d4aa",
      "hue": 180,
      "telegramTopicId": 1430,
      "order": 1
    }
  },
  "defaultDepartment": "engineering"
}
```

Departments can also be managed through the UI:
- Click the `+` button on the status bar to create
- Right-click (desktop) or long-press (mobile) a department card to edit/delete
- Type `/dept` in chat to create via slash command

### Linking Telegram Topics

1. Create a department in Command Center (with or without a Topic ID)
2. In Telegram, create a topic in your group
3. Right-click the department card in the status bar → Edit
4. Enter the Telegram Topic ID and save

The department will now sync bidirectionally with that Telegram topic.

## Development

```bash
npm run dev        # Vite dev server (hot reload, proxies API to :5100)
npm run build      # Production build (tsc + vite)
npm run server     # Start Express server only
```

Frontend runs on Vite with proxy to the Express backend. The base URL is `/cmd/` for reverse proxy compatibility.

## Deployment

### PM2 (Recommended)

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # auto-start on reboot
```

### Nginx Reverse Proxy

```nginx
location /cmd/ {
    proxy_pass http://127.0.0.1:5100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

### Health Check

```
GET /health
```

Returns server status, uptime, WebSocket client count, and Gateway connection state.

## Project Structure

```
command-center/
├── server/                    # Express backend
│   ├── index.js               # HTTP + WebSocket server
│   ├── gateway.js             # OpenClaw Gateway client
│   ├── agent.js               # AI chat via Gateway
│   ├── utils.js               # Shared utilities (BASE_PATH, file helpers)
│   ├── auth.js                # Password auth (scrypt, timing-safe)
│   ├── watcher.js             # File change monitor
│   ├── layout-generator.js    # Dynamic office layout
│   └── routes/                # API route modules
│       ├── api.js             # Core CRUD + chat
│       ├── capabilities.js    # System capabilities
│       ├── cron.js            # Scheduled tasks
│       ├── workflows.js       # Automation workflows
│       └── ...                # email, drive, voice, etc.
├── src/                       # React frontend
│   ├── App.tsx                # Main app + ErrorBoundary
│   ├── components/            # UI components
│   │   ├── OfficeCanvas.tsx   # Pixel office renderer
│   │   ├── ChatPanel.tsx      # Department chat
│   │   ├── StatusBar.tsx      # Department cards
│   │   ├── DeptFormModal.tsx  # Create/edit departments
│   │   └── ...                # 16 more components
│   ├── hooks/
│   │   ├── useAgentState.ts   # WebSocket state manager
│   │   └── useMobile.ts      # Mobile detection
│   ├── office/                # Pixel art engine
│   ├── i18n/                  # Chinese + English translations
│   └── utils/
├── scripts/
│   └── migrate-config.js     # Config format migration
├── install.sh                 # Interactive installer (bilingual, 2 modes)
├── ecosystem.config.cjs       # PM2 config
└── public/assets/             # Sprites + layout
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Canvas 2D
- **Backend**: Express, WebSocket (ws), chokidar
- **AI**: OpenClaw Gateway (protocol 3-5)
- **Auth**: scrypt password hashing + timing-safe comparison
- **Process**: PM2
- **i18n**: Chinese / English

## License

MIT
