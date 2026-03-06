# OpenClaw Command Center - Backend Guide

## Quick Start

```bash
# Install dependencies (if not already done)
npm install

# Test the server configuration
node server/test-api.js

# Start the backend server
npm start

# Or start in development mode with auto-reload
npm run dev
```

The server will start at `http://127.0.0.1:5100`

## Backend Architecture

The Express backend serves as a **WebSocket bridge** between the filesystem (OpenClaw agent data) and the React frontend dashboard.

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  React Frontend │ ◄──WS──► │  Express Server  │ ◄──────► │  File Watcher   │
│  (Port 5173)    │         │  (Port 5100)     │         │  (Chokidar)     │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                    │                              │
                                    │                              │
                                    ▼                              ▼
                            ┌──────────────────┐         ┌─────────────────┐
                            │   REST API       │         │  OpenClaw Data  │
                            │   /api/*         │         │  /workspace/    │
                            └──────────────────┘         └─────────────────┘
```

## File Structure

```
server/
├── index.js              # Main Express server + WebSocket setup
├── watcher.js            # Chokidar file watcher (monitors workspace changes)
├── routes/
│   └── api.js           # REST API endpoints
├── parsers/
│   └── jsonl.js         # JSONL session file parser
├── test-api.js          # API testing utility
└── README.md            # Detailed API documentation
```

## Key Features

### 1. Real-time File Watching
The watcher monitors OpenClaw workspace files and broadcasts changes via WebSocket:
- `departments/status.json` - Agent status updates
- `departments/bulletin/board.md` - Bulletin board changes
- `departments/*/memory/MEMORY.md` - Department memory updates (7 departments)
- `departments/bulletin/requests/*.md` - Cross-department requests
- `agents/main/sessions/*-topic-*.jsonl` - Activity logs (tail-follow mode)

### 2. REST API Endpoints
All endpoints are prefixed with `/api`:

- `GET /api/departments` - List all departments with merged status
- `GET /api/departments/:id/memory` - Get department memory content
- `GET /api/departments/:id/daily/:date?` - Get daily logs
- `GET /api/bulletin` - Get bulletin board content
- `GET /api/requests` - List cross-department requests
- `GET /api/activity/:topicId?tail=50` - Get session activity

### 3. WebSocket Events
Connect to `ws://127.0.0.1:5100/ws` to receive:

- `connected` - Full initial state on connection
- `status:update` - Agent status changed
- `bulletin:update` - Bulletin board updated
- `memory:update` - Department memory updated
- `request:new` - New cross-department request
- `activity:new` - New activity in session files

### 4. JSONL Tail-Following
Efficiently tracks session files:
- Maintains byte offset per file
- Only reads new content appended since last read
- Parses OpenClaw message formats (user/assistant/system/progress)
- Extracts tool usage and results

## Data Source

All data is read from:
```
/root/.openclaw/workspace/
├── departments/
│   ├── config.json          # Department configuration
│   ├── status.json          # Agent status
│   ├── bulletin/
│   │   ├── board.md        # Cross-department announcements
│   │   └── requests/       # Collaboration requests
│   ├── coo/
│   │   ├── memory/
│   │   │   └── MEMORY.md   # Persistent memory
│   │   └── daily/
│   │       └── YYYY-MM-DD.md
│   └── ... (6 more departments)
└── agents/
    └── main/
        └── sessions/
            └── *-topic-*.jsonl  # Activity logs
```

## Configuration

Edit `server/index.js` to change:
- `HOST` - Default: `127.0.0.1`
- `PORT` - Default: `5100`
- `BASE_PATH` - Default: `/root/.openclaw/workspace`

## Production Deployment

1. Build the React frontend:
   ```bash
   npm run build
   ```

2. The built files go to `dist/`

3. Start the server:
   ```bash
   npm start
   ```

4. The server will:
   - Serve API endpoints at `/api/*`
   - Serve static frontend files from `dist/`
   - Serve `index.html` for all other routes (SPA mode)
   - Provide WebSocket at `/ws`

## Health Check

```bash
curl http://127.0.0.1:5100/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-03-06T17:00:00Z",
  "uptime": 123.45,
  "wsClients": 1
}
```

## Monitoring

The server logs all activity to stdout:
- `[WebSocket]` - WebSocket connection events
- `[Watcher]` - File system change events
- `[Broadcast]` - Messages sent to clients

Example:
```
[WebSocket] Client connected from ::ffff:127.0.0.1
[WebSocket] Sent initial state to ::ffff:127.0.0.1
[Watcher] File changed: /root/.openclaw/workspace/departments/status.json
[Broadcast] status:update: agents, lastUpdated
```

## Error Handling

- Invalid JSON files are logged but don't crash the server
- Missing files return empty/null values
- WebSocket errors are caught per-client
- File watcher errors are logged and ignored

## Security Considerations

⚠️ **Current setup is for local development only**

The server:
- Binds to `127.0.0.1` (localhost only)
- Has CORS enabled for all origins (`*`)
- Serves static files without authentication
- Has no rate limiting

For production deployment:
1. Remove or restrict CORS
2. Add authentication middleware
3. Implement rate limiting
4. Use HTTPS with proper certificates
5. Consider binding to specific network interface

## Troubleshooting

**Server won't start:**
```bash
# Check if port 5100 is already in use
lsof -i :5100

# Try a different port by editing server/index.js
```

**WebSocket not connecting:**
```bash
# Check that the path is correct: /ws
# Verify server is running: curl http://127.0.0.1:5100/health
```

**No file updates:**
```bash
# Verify workspace path exists
ls /root/.openclaw/workspace/departments/

# Check watcher logs in server output
```

**JSONL parsing errors:**
```bash
# Check session file format
tail /root/.openclaw/workspace/agents/main/sessions/*.jsonl
```

## Development

To modify the backend:

1. **Add new API endpoint**: Edit `server/routes/api.js`
2. **Add new file watcher**: Edit `server/watcher.js`
3. **Change message parsing**: Edit `server/parsers/jsonl.js`
4. **Add WebSocket event**: Edit `server/watcher.js` broadcast functions

Use `npm run dev` for auto-reload during development.

## Testing

```bash
# Test configuration and file access
node server/test-api.js

# Test server startup
timeout 5 node server/index.js

# Test API endpoint (server must be running)
curl http://127.0.0.1:5100/api/departments
```

## Next Steps

1. Build the React frontend that connects to this backend
2. Implement dashboard UI components
3. Add real-time visualizations for agent activity
4. Create admin controls for agent management
5. Add historical data and analytics

For detailed API documentation, see `server/README.md`
