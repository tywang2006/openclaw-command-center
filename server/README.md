# OpenClaw Command Center - Backend Server

Express + WebSocket backend that bridges the filesystem (OpenClaw agent data) with the React frontend dashboard.

## Architecture

```
server/
├── index.js          # Main Express server + WebSocket setup
├── watcher.js        # Chokidar file watcher for agent data
├── routes/
│   └── api.js        # REST API endpoints
└── parsers/
    └── jsonl.js      # JSONL session file parser
```

## Server Configuration

- **Host**: `127.0.0.1`
- **Port**: `5100`
- **WebSocket Path**: `/ws`
- **Data Source**: `/root/.openclaw/workspace`

## API Endpoints

### `GET /api/departments`
Returns merged department configuration and status.

**Response:**
```json
{
  "departments": [
    {
      "id": "coo",
      "name": "总指挥部",
      "agent": "COO 面试",
      "emoji": "⚡",
      "status": "active",
      "lastSeen": "2026-03-06T16:00:00Z",
      "currentTask": "组织架构初始化",
      "sessionCount": 0
    }
  ],
  "lastUpdated": "2026-03-06T16:00:00Z"
}
```

### `GET /api/departments/:id/memory`
Returns a department's MEMORY.md content.

**Response:**
```json
{
  "departmentId": "coo",
  "content": "# Memory content...",
  "exists": true
}
```

### `GET /api/departments/:id/daily/:date?`
Returns department's daily log (defaults to today YYYY-MM-DD).

**Response:**
```json
{
  "departmentId": "engineering",
  "date": "2026-03-06",
  "content": "# Daily log...",
  "exists": true
}
```

### `GET /api/bulletin`
Returns bulletin board content.

**Response:**
```json
{
  "content": "# Bulletin board markdown...",
  "exists": true,
  "lastModified": "2026-03-06T16:00:00Z"
}
```

### `GET /api/requests`
Lists all cross-department request files.

**Response:**
```json
{
  "requests": [
    {
      "filename": "request-001.md",
      "content": "Request content...",
      "created": "2026-03-06T15:00:00Z",
      "modified": "2026-03-06T16:00:00Z"
    }
  ]
}
```

### `GET /api/activity/:topicId?tail=50`
Returns last N messages from matching JSONL session file.

**Query params:**
- `tail` - Number of messages to return (default: 50)

**Response:**
```json
{
  "topicId": "1234",
  "sessionFile": "20260306-topic-1234.jsonl",
  "messages": [
    {
      "type": "user",
      "role": "user",
      "text": "User message",
      "timestamp": "2026-03-06T16:00:00Z"
    },
    {
      "type": "assistant",
      "role": "assistant",
      "text": "Assistant response",
      "toolName": "bash",
      "timestamp": "2026-03-06T16:00:01Z"
    }
  ],
  "count": 2
}
```

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-06T16:00:00Z",
  "uptime": 123.45,
  "wsClients": 1
}
```

## WebSocket Events

### Client → Server
Connect to `ws://127.0.0.1:5100/ws`

### Server → Client

**Event: `connected`** - Initial state sent on connection
```json
{
  "event": "connected",
  "data": {
    "departments": [...],
    "status": {...},
    "bulletin": "...",
    "requests": [...]
  },
  "timestamp": "2026-03-06T16:00:00Z"
}
```

**Event: `status:update`** - Agent status changed
```json
{
  "event": "status:update",
  "data": {
    "lastUpdated": "2026-03-06T16:00:00Z",
    "agents": {...}
  },
  "timestamp": "2026-03-06T16:00:00Z"
}
```

**Event: `bulletin:update`** - Bulletin board updated
```json
{
  "event": "bulletin:update",
  "data": {
    "content": "# Updated bulletin..."
  },
  "timestamp": "2026-03-06T16:00:00Z"
}
```

**Event: `memory:update`** - Department memory updated
```json
{
  "event": "memory:update",
  "data": {
    "deptId": "engineering",
    "content": "# Updated memory..."
  },
  "timestamp": "2026-03-06T16:00:00Z"
}
```

**Event: `request:new`** - New cross-department request
```json
{
  "event": "request:new",
  "data": {
    "filename": "request-002.md",
    "content": "...",
    "created": "2026-03-06T16:00:00Z",
    "modified": "2026-03-06T16:00:00Z"
  },
  "timestamp": "2026-03-06T16:00:00Z"
}
```

**Event: `activity:new`** - New activity in session file
```json
{
  "event": "activity:new",
  "data": {
    "deptId": "main",
    "topicId": "1234",
    "sessionFile": "20260306-topic-1234.jsonl",
    "messages": [...]
  },
  "timestamp": "2026-03-06T16:00:00Z"
}
```

## File Watching

The watcher monitors these paths:
- `departments/status.json` - Agent status
- `departments/bulletin/board.md` - Bulletin board
- `departments/*/memory/MEMORY.md` - Department memories (7 departments)
- `departments/bulletin/requests/*.md` - Cross-department requests
- `agents/main/sessions/*-topic-*.jsonl` - Session activity logs

**JSONL Tail-Follow:**
- Maintains byte offset per file
- Only reads new content appended since last read
- Efficient for large session files

**Exclusions:**
- Files starting with `.deleted.`
- Files starting with `.bak`

## Running the Server

```bash
# Install dependencies
npm install

# Start in production mode
npm start

# Start in development mode with auto-reload
npm run dev
```

## Data Structure

Expected workspace structure:
```
/root/.openclaw/workspace/
├── departments/
│   ├── config.json
│   ├── status.json
│   ├── bulletin/
│   │   ├── board.md
│   │   └── requests/
│   │       └── *.md
│   ├── coo/
│   │   └── memory/
│   │       └── MEMORY.md
│   ├── engineering/
│   │   └── memory/
│   │       └── MEMORY.md
│   └── ...
└── agents/
    └── main/
        └── sessions/
            └── *-topic-*.jsonl
```

## JSONL Parser

The parser handles OpenClaw session files with these message types:
- `user` - User input
- `assistant` - AI responses (may include tool_use blocks)
- `system` - System messages
- `progress` - Progress updates

Each parsed message includes:
- `type` - Message type
- `role` - Role (user/assistant/system)
- `text` - Extracted text content
- `toolName` - Tool name if tool_use/tool_result
- `timestamp` - Message timestamp

## Production Deployment

The server serves static files from `../dist/` for the built React frontend. Build the frontend first:

```bash
npm run build
```

Then the Express server will serve the SPA at the root path, with API routes under `/api`.
