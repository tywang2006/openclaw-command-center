# OpenClaw Command Center - Frontend

A React 18 dashboard for monitoring and managing OpenClaw agent activities. Features a pixel art office visualization with real-time WebSocket updates.

## Architecture

### Tech Stack
- **React 18.3** with TypeScript
- **Vite 5.4** for build tooling
- **WebSocket** for real-time communication
- **Marked** for markdown rendering
- Custom pixel art game engine (from pixel-agents)

### Project Structure

```
/root/.openclaw/workspace/command-center/
├── index.html                 # HTML entry point
├── package.json              # Dependencies & scripts
├── tsconfig.json             # TypeScript config
├── vite.config.ts            # Vite build config
├── src/
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Main app layout
│   ├── index.css             # Global styles (pixel art theme)
│   ├── wsApi.ts              # WebSocket stub (no VS Code)
│   ├── notificationSound.ts  # Audio stub
│   ├── hooks/
│   │   └── useAgentState.ts  # WebSocket state management
│   ├── components/
│   │   ├── OfficeCanvas.tsx       # Pixel office renderer
│   │   ├── SidePanel.tsx          # Tabbed info panel
│   │   ├── BulletinTab.tsx        # Markdown bulletin board
│   │   ├── MemoryTab.tsx          # Department memory viewer
│   │   ├── RequestsTab.tsx        # Cross-dept requests
│   │   ├── ActivityTab.tsx        # Real-time activity log
│   │   └── StatusBar.tsx          # Bottom status cards
│   ├── office/                    # Game engine (copied from pixel-agents)
│   │   ├── engine/                # Core rendering & state
│   │   ├── sprites/               # Character sprites
│   │   ├── layout/                # Furniture & tile layout
│   │   └── types.ts               # Type definitions
│   └── constants.ts               # Game constants
├── public/
│   └── assets/
│       ├── characters/            # char_0.png - char_5.png
│       ├── walls.png
│       └── default-layout.json
└── server/
    ├── index.js                   # Express + WebSocket server
    ├── watcher.js                 # File watching for updates
    └── routes/
        └── api.js                 # REST API endpoints
```

## Components

### Main Layout (App.tsx)
- **Header**: Title, connection status, current time
- **Left Panel (60%)**: OfficeCanvas with pixel characters
- **Right Panel (40%)**: Tabbed info panel (4 tabs)
- **Bottom Bar**: 7 department status cards

### OfficeCanvas (Simplified)
Unlike the pixel-agents editor version, this is **view-only**:
- Renders office with game engine
- Click characters to select/deselect departments
- Pan with **middle mouse button**
- Zoom with **Ctrl + scroll wheel**
- Shows character name labels above each character

### Side Panel Tabs

1. **📢 公告板 (Bulletin)**: Markdown bulletin board
2. **🧠 记忆 (Memory)**: Selected department's memory
3. **📨 请求 (Requests)**: Cross-department requests
4. **📡 活动 (Activity)**: Real-time activity log (auto-scrolls)

### Status Bar
7 department mini-cards with:
- Emoji icon
- Department name
- Status dot (active/idle/offline)
- Current task preview

## Department → Character Mapping

| Department  | ID           | Emoji | Character | Palette | Color   |
|-------------|--------------|-------|-----------|---------|---------|
| COO         | coo          | ⚡    | char_0    | 0       | Magenta |
| CTO         | engineering  | 🔧    | char_1    | 1       | Cyan    |
| SRE         | operations   | 🔍    | char_2    | 2       | Yellow  |
| Research    | research     | 📊    | char_3    | 3       | Green   |
| Product     | product      | 🎨    | char_4    | 4       | Purple  |
| Admin       | admin        | 📋    | char_5    | 5       | Orange  |
| Blockchain  | blockchain   | ⛓️    | char_0    | 0 + 180° hue | Blue |

## State Management

### useAgentState Hook
Centralized WebSocket state management:

```typescript
interface AgentState {
  departments: Department[]        // 7 departments
  bulletin: string                 // Markdown content
  memories: Map<string, string>    // deptId → markdown
  requests: Request[]              // Cross-dept requests
  activities: Activity[]           // Real-time log
  selectedDeptId: string | null    // UI selection
  connected: boolean               // WS status
}
```

### WebSocket Events

Server → Client:
- `connected`: Connection established
- `status:update`: Department status changed
- `bulletin:update`: Bulletin updated
- `memory:update`: Department memory updated
- `request:new`: New cross-dept request
- `activity:new`: New activity log entry

## Styling

### Design System
- **Background**: `#0a0a14` (dark navy)
- **Panel**: `#1e1e2e` (lighter navy)
- **Border**: `#2a2a4a` (blue-gray)
- **Accent**: `#00d4aa` (teal/cyan)
- **Text**: `#e0e0e0` (light gray)
- **Font**: Monospace (Consolas, Monaco, Courier New)

### Pixel Art Style
- **NO border-radius** anywhere
- Sharp shadows: `2px 2px 0px #0a0a14`
- No gradients or blur effects
- Crisp, retro aesthetic

## API Endpoints

### REST API
- `GET /api/departments`: List all departments with status

### WebSocket
- `ws://localhost:5100/ws`: Real-time updates

## Development

```bash
# Install dependencies
npm install

# Start dev server (frontend only)
npm run dev
# → http://localhost:5173/cmd/

# Start backend server (WebSocket + API)
npm run server
# → http://localhost:5100

# Build for production
npm run build
# → dist/

# Preview production build
npm run preview
```

## Production Setup

The frontend is built to be served under the `/cmd/` path (see `vite.config.ts` base).

```bash
# Build frontend
npm run build

# Serve with backend
npm start
# → http://localhost:5100/cmd/
```

Server configuration:
- Static files: `dist/` directory
- API: `/api/*`
- WebSocket: `/ws`
- Frontend: `/cmd/*`

## Configuration

### Vite Proxy (Development)
```typescript
server: {
  proxy: {
    '/api': 'http://127.0.0.1:5100',
    '/ws': { target: 'ws://127.0.0.1:5100', ws: true }
  }
}
```

### TypeScript
- **Strict mode** enabled
- **No implicit any**
- **ES2020** target
- **React JSX** transform
- **Module bundler** resolution

## Browser Support

Requires modern browser with:
- ES2020 support
- WebSocket API
- Canvas 2D API
- CSS Grid & Flexbox

Tested on:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Performance Notes

- Canvas rendering at 60 FPS
- WebSocket auto-reconnects every 3 seconds
- Activity log limited to last 200 entries
- Requests limited to last 100 entries
- Efficient sprite caching for zoom levels

## Differences from pixel-agents

This is a **simplified, view-only** version:
- **Removed**: Editor toolbar, furniture placement, tile painting
- **Removed**: Save/load UI, undo/redo
- **Removed**: VS Code extension integration
- **Added**: Real-time WebSocket updates
- **Added**: Department status tracking
- **Added**: Tabbed info panel
- **Simplified**: Click to select, middle-drag to pan, Ctrl+wheel to zoom

## Troubleshooting

### WebSocket won't connect
- Check backend server is running on port 5100
- Verify firewall allows WebSocket connections
- Check browser console for connection errors

### Characters not appearing
- Ensure `/assets/characters/char_*.png` exist
- Check `/assets/default-layout.json` is valid
- Verify network tab for 404 errors

### TypeScript errors
```bash
# Rebuild type definitions
npm run build
```

### Canvas is blank
- Check browser console for errors
- Verify office state initialized
- Check canvas dimensions are non-zero

## Future Enhancements

Potential additions:
- [ ] Chat interface for agents
- [ ] Task queue visualization
- [ ] Performance metrics graphs
- [ ] Audio notifications for events
- [ ] Dark/light theme toggle
- [ ] Export logs to JSON/CSV
- [ ] Filter activities by department
- [ ] Search in bulletin/memories

---

**Built with React 18 + TypeScript + Vite**
