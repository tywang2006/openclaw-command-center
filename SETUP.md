# Quick Setup Guide

## Prerequisites
- Node.js >= 18.0.0
- npm >= 8.0.0

## Installation

```bash
cd /root/.openclaw/workspace/command-center
npm install
```

## Development

### Option 1: Full Stack (Recommended)
```bash
# Terminal 1: Start backend server (port 5100)
npm run server

# Terminal 2: Start frontend dev server (port 5173)
npm run dev
```
Then open: http://localhost:5173/cmd/

### Option 2: Backend Only (Production Build)
```bash
# Build frontend
npm run build

# Start server (serves built frontend + API + WebSocket)
npm start
```
Then open: http://localhost:5100/cmd/

## File Structure Created

```
command-center/
├── index.html                     ✓ Vite HTML entry
├── package.json                   ✓ Dependencies
├── tsconfig.json                  ✓ TypeScript config
├── vite.config.ts                 ✓ Vite config
│
├── src/
│   ├── main.tsx                   ✓ React entry
│   ├── App.tsx                    ✓ Main layout
│   ├── App.css                    ✓ Layout styles
│   ├── index.css                  ✓ Global pixel art styles
│   ├── wsApi.ts                   ✓ Stub (no VS Code)
│   ├── notificationSound.ts       ✓ Audio stub
│   │
│   ├── hooks/
│   │   └── useAgentState.ts       ✓ WebSocket state hook
│   │
│   └── components/
│       ├── OfficeCanvas.tsx       ✓ Pixel office (simplified)
│       ├── OfficeCanvas.css       ✓
│       ├── SidePanel.tsx          ✓ Tabbed panel
│       ├── SidePanel.css          ✓
│       ├── BulletinTab.tsx        ✓ Markdown bulletin
│       ├── BulletinTab.css        ✓
│       ├── MemoryTab.tsx          ✓ Department memory
│       ├── MemoryTab.css          ✓
│       ├── RequestsTab.tsx        ✓ Cross-dept requests
│       ├── RequestsTab.css        ✓
│       ├── ActivityTab.tsx        ✓ Real-time log
│       ├── ActivityTab.css        ✓
│       ├── StatusBar.tsx          ✓ Bottom status cards
│       └── StatusBar.css          ✓
│
├── public/assets/                 (Already exists)
│   ├── characters/                ✓ char_0.png - char_5.png
│   ├── walls.png                  ✓
│   └── default-layout.json        ✓
│
├── src/office/                    (Already exists - game engine)
│   ├── engine/                    ✓ Core rendering
│   ├── sprites/                   ✓ Character sprites
│   ├── layout/                    ✓ Furniture & tiles
│   └── constants.ts               ✓
│
└── server/                        (Already exists)
    ├── index.js                   ✓ Express + WS server
    └── routes/api.js              ✓ REST endpoints
```

## Features

### Layout
- Header: Title + connection status + time
- Left panel (60%): Pixel office canvas
- Right panel (40%): 4 tabs (Bulletin, Memory, Requests, Activity)
- Bottom bar: 7 department status cards

### Controls
- **Left click** character: Select/deselect department
- **Middle mouse drag**: Pan camera
- **Ctrl + scroll**: Zoom in/out

### Live Updates
- WebSocket connection auto-reconnects
- Real-time department status updates
- Activity log auto-scrolls
- Bulletin markdown rendering

## Verify Installation

```bash
# Check all React files exist
ls -1 src/components/*.tsx
ls -1 src/hooks/*.ts
ls src/App.tsx src/main.tsx src/index.css

# Check config files
ls package.json tsconfig.json vite.config.ts index.html

# Should see:
# ✓ 6 component files (OfficeCanvas, SidePanel, 4 tabs, StatusBar)
# ✓ 1 hook file (useAgentState)
# ✓ All config files present
```

## Troubleshooting

### Port already in use
```bash
# Change port in vite.config.ts or server/index.js
# Or kill existing process:
lsof -ti:5100 | xargs kill
lsof -ti:5173 | xargs kill
```

### Missing dependencies
```bash
npm install --force
```

### TypeScript errors
```bash
npx tsc --noEmit
# Check for import errors
```

## Next Steps

1. Start development servers
2. Open http://localhost:5173/cmd/
3. Verify WebSocket connects (green dot in header)
4. Click department status cards to select
5. Check activity log for real-time updates

---

Built with React 18 + TypeScript + Vite
