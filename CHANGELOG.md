# Changelog

All notable changes to **openclaw-command-center** will be documented in this file.

## [1.8.0] - 2026-03-21

### Added
- **WCAG accessibility overhaul**: Comprehensive improvements across 41 files — focus-visible outlines, dialog `role`/`aria-modal`, keyboard navigation (Escape to close), `aria-label` on icon buttons, heading hierarchy (`h1`→`h2`→`h3`), skip-to-content link, ARIA live regions for streaming responses, form label associations
- **Structured logging**: Server-side structured logging with consistent format and levels
- **API route decomposition**: Monolithic `api.js` split into modular route files under `server/routes/`

### Fixed
- **50-agent test-fix loop**: Security hardening, performance optimizations, memory leak fixes across server and client
- **WCAG contrast**: `--text-muted` contrast ratio improved to meet WCAG AA (4.5:1)
- **WebSocket token leakage**: Sanitize WS message logging to prevent auth token exposure
- **Workflow persistence**: Workflow run results now persist correctly; delay validation aligned with execution
- **MemoryTab search**: Corrected to use `/api/search` endpoint
- **Watcher performance**: File watcher ignores `node_modules`/`dist`/`.git`, cleans up stale file offsets
- **Search rate limiting**: Added rate limiting to `/api/search` endpoint
- **Audit log security**: Secure audit log file permissions, reduce sensitive data in logs
- **Backup path traversal**: Defense-in-depth path traversal protection on `restoreFromBackup`
- **SetupWizard**: Handles POST success as WebSocket fallback
- **Gateway log spam**: Suppress verbose gateway logs, fix SPA `sendFile` errors, clean shutdown
- **CSS cleanup**: Error handling hardening, dead CSS removal

### Removed
- Unused PNG character sprites (`char_0–5.png`) and `walls.png` — engine uses procedural sprites
- Dead PNG-loading code path in `spriteData.ts`

## [1.6.3] - 2026-03-18

### Improved
- Added CONTRIBUTING.md (bilingual contributing guide)
- Added CODE_OF_CONDUCT.md (Contributor Covenant 2.1)
- Added GitHub issue templates (bug report + feature request)
- Added `main` and `exports` fields to package.json
- Improved Snyk package health score

## [1.6.2] - 2026-03-18

### Improved
- Added `homepage` and `bugs` fields to package.json for npm discoverability
- Completed `.env.example` with all supported environment variables (CMD_HOST, CORS_ORIGIN, OPENCLAW_WORKSPACE, GATEWAY_DEBUG)
- Added `ecosystem.config.cjs` and `.env.example` to npm package files
- Added inline PM2 ecosystem config example in README
- Synced CHANGELOG.md with README changelog (was lagging behind at 1.3.1)

## [1.6.1] - 2026-03-18

### Security
- OAuth token files now written with 0o600 permissions (3 locations)
- Removed filesystem path exposure from setup API response
- Sanitized error messages in setup/skills/voice/files routes (no more raw error.message to client)
- Added 10MB upload size limit to Drive upload endpoint

### Fixed
- Meeting setImmediate async error handling race condition
- Meeting negotiation withMutex wrapped in Promise.resolve for safe catch

### Chores
- Updated .gitignore: added IDE dirs, agent-generated reports, test output, refactoring WIP
- Updated .dockerignore: added sensitive files (encryption key, integrations, audit log)

## [1.6.0] - 2026-03-18

### Added
- **Negotiation voting**: Multi-round AI debate with voting in meeting room
- **Action item extraction**: AI auto-extracts action items on meeting end
- **Trust scores**: Department reliability leaderboard
- **Sub-agent delegation**: sessions_spawn non-blocking delegation (fixes deadlock)
- **Mobile responsive**: Responsive layout for tablet (768px) and phone (480px)
- **Broadcast modal**: Dashboard broadcast replaced blocking prompt() with modal UI
- **Bulletin clear button**: Clear broadcast responses in bulletin board
- **CommandPalette tabs**: Added meeting, requests, skills, guide tabs

### Fixed
- **Chinese IME**: Enter key no longer sends message during IME composition
- **Gateway reconnect**: Fixed listener leak on reconnect destroying new connection
- **Dashboard chart**: Fixed division by zero in SVG chart rendering
- **Dashboard broadcast**: Fixed parameter name mismatch (message -> command)
- **CronTab PUT**: Fixed message payload nesting mismatch
- **CronTab chart**: Fixed division by zero in duration chart
- **sourceDept validation**: Added path traversal protection
- **Password validation**: Frontend min length synced with backend (8 chars)
- **WS 1008 reconnect loop**: Auth-revoked close code now clears token and reloads
- **Meeting negotiation cleanup**: Negotiation state properly reset on meeting end
- **Meeting memory leak**: Ended meetings removed from Map after 5 minutes
- **Skills tags**: Tags now correctly sent as array (was string)
- **Time validation**: Autobackup time regex rejects invalid times (was accepting "99:99")
- **YAML injection**: Skills frontmatter now escapes user input
- **WorkflowEditor alert**: Replaced blocking alert() with status message
- **chat() safety return**: Added defensive return after retry exhaustion
- **Workflow lock**: Restructured to release file lock during AI execution

### Security
- Path traversal protection on sourceDept parameter
- YAML frontmatter injection prevention in skills
- Gateway listener cleanup prevents connection hijacking

## [1.5.0] - 2026-03-17

### Added

- **Meeting Room**: Real-time multi-department discussion with sequential responses — each department sees previous responses for genuine cross-department interaction
- **Meeting templates**: Quick-create standup, weekly review, tech review, product sync with SVG icons
- **Auto-send topic**: Meeting topic auto-sent on creation to kick off department discussion immediately
- **Meeting minutes export**: Auto-export to Google Drive on meeting end with formatted markdown
- **Tab bar redesign**: 2-row 6-column CSS grid layout fitting 12 tabs with shortened labels
- **Command Palette (Cmd+K)**: Fuzzy search for departments, tabs, and actions with keyboard navigation
- **PWA support**: Progressive Web App with service worker, manifest.json, offline shell caching, iOS/Android install
- **Chat panel decomposition**: Split into ChatInput, ChatMessages, ChatToolbar, SubAgentPanel components
- **Chat retry route**: Retry failed department messages via `/api/chat-retry`
- **Push notifications route**: Web Push subscription management via `/api/push`
- **Passive wheel fix**: OfficeCanvas uses native `addEventListener` with `{ passive: false }` — no more console errors

### Changed

- MeetingRoom CSS: all hardcoded purple colors replaced with charcoal theme CSS variables
- Meeting department responses: sequential instead of parallel (real discussion vs broadcast)
- i18n labels shortened for compact tab layout (en + zh)
- Package description and keywords updated for npm discoverability

### Security

- Input sanitization and auth hardening improvements
- Rate limiting enhancements on sensitive routes

## [1.4.0] - 2026-03-16

### Fixed

- **Gateway device auth (breaking)**: OpenClaw 2026.3.x requires Ed25519 challenge-response device authentication. Gateway client now generates a per-installation keypair, waits for `connect.challenge` nonce, signs the handshake payload, and includes the `device` field. Fixes `missing scope: operator.write` / `operator.read` errors after OpenClaw upgrade.

### Added

- **PWA support**: Progressive Web App with offline shell caching, manifest.json, service worker, and iOS/Android install support
- **Command Palette (Cmd+K)**: Fuzzy search command palette for quick navigation (departments, tabs, actions) with keyboard shortcuts
- **System config panel**: Gateway configuration, model management, agent defaults, channel settings directly from the UI (SystemTab)
- **Setup wizard**: First-run onboarding flow with password creation and OpenClaw detection (SetupWizard)
- **Login panel improvements**: Better error handling, setup wizard integration
- **Guide tab redesign**: Responsive layout, improved mobile styling, clearer instructions
- **Gateway config API**: `GET/PUT /api/system/gateway`, `GET/PUT /api/system/models`, `GET/PUT /api/system/agents`, `GET/PUT /api/system/channels` endpoints
- **Auth hardening**: Constant-time password comparison, brute-force protection improvements

### Changed

- Package description updated to "超哥办公室 — OpenClaw 指挥中心"
- Gateway handshake requests `operator.write` and `operator.read` scopes (required since OpenClaw 2026.3.x)
- i18n keys expanded for new system config, setup, and guide features (en + zh)

## [1.3.1] - 2026-03-12

### Added

- Multi-platform installer (DMG, Windows, npm CLI, Linux .run)
- Department management and metrics dashboard
- Integration upgrades (webhooks, Google Sheets)
- Sub-agent visibility, escalation, and skills management tab
- In-app Guide tab with beginner-friendly usage instructions
- OpenClaw config panel in SystemTab
- App launch menu (launch/reinstall/uninstall)
- Auto-install OpenClaw in setup, auto-start Gateway on launch

### Fixed

- Gateway `offEvent` + background retry, metrics div-by-zero, workflows error handling
- WS auth via first-message, streaming performance, error boundaries, broadcast race
- DMG/installer build audit — branding, password hashing, runtime bugs
- Inline auto-pair CJS, remove stale layout, auto-generate on startup
- Gateway auth token resolution + dynamic layout for fresh installs
- Stop Gateway reconnect loop on fatal errors (NOT_PAIRED, AUTH_FAILED)
- macOS bash 3.2 compatibility (no associative arrays)

### Security

- Harden server, fix remaining code review findings
- Fix critical/high findings from codebase security review

## [1.2.0] - 2026-03-09

### Added

- Capabilities dashboard: channels, plugins, skills, models overview
- Gmail integration (SMTP via App Password)
- Google Drive backup (Service Account)
- Voice input (OpenAI Whisper API)
- Chat export (Markdown / HTML download)
- Integration config management with test/reset

### Changed

- Merged SkillsTab into IntegrationsTab
- Rebranded OpenClaw to ChaoClaw across user-facing strings

## [1.1.0] - 2026-03-07

### Added

- Gateway event listening (agent streaming, health, tick, connect.challenge)
- Telegram messages display in real-time in the app
- Sub-agent details + pixel office display
- 4x2 multi-room pixel office layout with department positioning
- Memory editing in MemoryTab (edit + save)
- Pixel sprite quality upgrade (8 core sprites rewritten)
- OpenClaw Telegram plugin enabled

### Fixed

- StatusBar department card height consistency
- Sub-agents persist after page refresh
- StatusBar bottom card content truncation

## [1.0.0] - 2026-03-06

### Added

- Initial release: React 19 + Express + WebSocket dashboard
- OpenClaw Gateway integration (replace direct Kimi API calls)
- 7-department pixel office with Canvas 2D rendering
- Department chat, broadcast, sub-agent management
- Real-time file watching + WebSocket push
- Zoom slider for pixel office
