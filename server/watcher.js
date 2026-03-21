import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { parseJsonlLine, readFromOffset } from './parsers/jsonl.js';
import { BASE_PATH, readJsonFile, readTextFile } from './utils.js';
import { createLogger } from './logger.js';
import { safeBroadcast } from './broadcast.js';

const log = createLogger('Watcher');

// Track file offsets for JSONL files (tail-follow mode)
const fileOffsets = new Map();

/**
 * Broadcast message to all connected WebSocket clients
 */
function broadcast(wss, event, data) {
  const result = safeBroadcast(wss, { event, data, timestamp: new Date().toISOString() });
  log.info('Broadcast', { event, dataKeys: Object.keys(data).join(', '), sent: result.sent, skipped: result.skipped });
}

/**
 * Extract department ID from file path
 */
function extractDepartmentId(filePath) {
  const match = filePath.match(/departments\/([^\/]+)\//);
  return match ? match[1] : null;
}

/**
 * Extract topic ID from session filename
 */
function extractTopicId(filename) {
  const match = filename.match(/-topic-([^\.]+)\.jsonl$/);
  return match ? match[1] : null;
}

/**
 * Handle status.json changes
 */
function handleStatusChange(wss, filePath) {
  const status = readJsonFile(filePath);
  if (status) {
    broadcast(wss, 'status:update', status);
  }
}

/**
 * Handle bulletin board.md changes
 */
function handleBulletinChange(wss, filePath) {
  const content = readTextFile(filePath);
  broadcast(wss, 'bulletin:update', { content });
}

/**
 * Handle department MEMORY.md changes
 */
function handleMemoryChange(wss, filePath) {
  const deptId = extractDepartmentId(filePath);
  if (!deptId) return;

  const content = readTextFile(filePath);
  broadcast(wss, 'memory:update', { deptId, content });
}

/**
 * Handle cross-department request file changes
 */
function handleRequestChange(wss, filePath) {
  const filename = path.basename(filePath);
  const content = readTextFile(filePath);

  let created, modified;
  try {
    const stats = fs.statSync(filePath);
    created = stats.birthtime.toISOString();
    modified = stats.mtime.toISOString();
  } catch {
    // File may have been deleted between event and stat
    return;
  }

  broadcast(wss, 'request:new', {
    filename,
    content,
    created,
    modified
  });
}

/**
 * Handle JSONL session file changes (tail-follow mode)
 */
function handleSessionChange(wss, filePath) {
  const filename = path.basename(filePath);
  const topicId = extractTopicId(filename);

  // Get or initialize offset for this file
  const currentOffset = fileOffsets.get(filePath) || 0;

  // Read only new content since last offset
  const { lines, newOffset } = readFromOffset(filePath, currentOffset);

  if (lines.length > 0) {
    const messages = lines
      .map(line => parseJsonlLine(line))
      .filter(msg => msg !== null);

    if (messages.length > 0) {
      const deptId = extractDepartmentId(filePath) || 'main';

      broadcast(wss, 'activity:new', {
        deptId,
        topicId,
        sessionFile: filename,
        messages
      });
    }

    // Update offset
    fileOffsets.set(filePath, newOffset);
  }
}

/**
 * Initialize file offsets for existing JSONL files
 */
function initializeOffsets() {
  const sessionsDir = path.join(BASE_PATH, 'agents', 'main', 'sessions');

  if (!fs.existsSync(sessionsDir)) {
    return;
  }

  const files = fs.readdirSync(sessionsDir)
    .filter(file => file.endsWith('.jsonl') && !file.startsWith('.deleted') && !file.startsWith('.bak'));

  files.forEach(file => {
    const filePath = path.join(sessionsDir, file);
    try {
      const stats = fs.statSync(filePath);
      fileOffsets.set(filePath, stats.size); // Start at end of existing files
    } catch (error) {
      log.error('Error initializing offset for file', { filePath, error: error.message });
    }
  });

  log.info('Initialized offsets for session files', { fileCount: files.length });
}

/**
 * Get full initial state for new WebSocket connections
 */
function getInitialState() {
  const state = {
    departments: [],
    status: null,
    bulletin: '',
    requests: [],
    timestamp: new Date().toISOString()
  };

  try {
    // Load departments config and status
    const configPath = path.join(BASE_PATH, 'departments', 'config.json');
    const statusPath = path.join(BASE_PATH, 'departments', 'status.json');

    const config = readJsonFile(configPath) || { departments: {} };
    const status = readJsonFile(statusPath) || { agents: {} };

    state.status = status;

    // Merge department info
    state.departments = Object.entries(config.departments || {})
      .sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99))
      .map(([id, dept]) => {
        const agentStatus = status.agents[id] || {};
        return {
          id,
          ...dept,
          status: agentStatus.status || 'idle',
          lastSeen: agentStatus.lastSeen || null,
          currentTask: agentStatus.currentTask || null,
          sessionCount: agentStatus.sessionCount || 0
        };
      });

    // Load bulletin
    const bulletinPath = path.join(BASE_PATH, 'departments', 'bulletin', 'board.md');
    state.bulletin = readTextFile(bulletinPath);

    // Load requests
    const requestsDir = path.join(BASE_PATH, 'departments', 'bulletin', 'requests');
    if (fs.existsSync(requestsDir)) {
      const files = fs.readdirSync(requestsDir)
        .filter(file => file.endsWith('.md') && !file.startsWith('.deleted') && !file.startsWith('.bak'));

      state.requests = files.map(file => {
        const filePath = path.join(requestsDir, file);
        const content = readTextFile(filePath);
        const stats = fs.statSync(filePath);

        return {
          filename: file,
          content,
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString()
        };
      });
    }
  } catch (error) {
    log.error('Error building initial state', { error });
  }

  return state;
}

/**
 * Load department IDs from config
 */
function loadDepartmentIds() {
  try {
    const configPath = path.join(BASE_PATH, 'departments', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return Object.keys(config.departments || {});
  } catch { return []; }
}

/**
 * Create and configure file watcher
 */
function createWatcher(wss) {
  // Initialize offsets before watching
  initializeOffsets();

  const departments = loadDepartmentIds();

  // Define watch paths (chokidar v5 no longer supports globs, watch directories instead)
  const watchPaths = [
    path.join(BASE_PATH, 'departments', 'config.json'),
    path.join(BASE_PATH, 'departments', 'status.json'),
    path.join(BASE_PATH, 'departments', 'bulletin', 'board.md'),
    path.join(BASE_PATH, 'departments', 'bulletin', 'requests'),
    path.join(BASE_PATH, 'agents', 'main', 'sessions')
  ];

  // Add department memory files
  departments.forEach(dept => {
    watchPaths.push(path.join(BASE_PATH, 'departments', dept, 'memory', 'MEMORY.md'));
  });

  const watcher = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    },
    ignored: /(\.deleted\.|\.bak)/
  });

  watcher
    .on('add', filePath => {
      log.info('File added', { filePath });
      if (filePath.includes('requests/') && filePath.endsWith('.md')) {
        handleRequestChange(wss, filePath);
      } else if (filePath.endsWith('.jsonl')) {
        // Initialize offset for new session file
        try {
          const stats = fs.statSync(filePath);
          fileOffsets.set(filePath, stats.size);
        } catch {
          fileOffsets.set(filePath, 0);
        }
      }
    })
    .on('change', filePath => {
      log.info('File changed', { filePath });

      if (filePath.endsWith('config.json') && filePath.includes('departments')) {
        broadcast(wss, 'departments:updated', {});
      } else if (filePath.endsWith('status.json')) {
        handleStatusChange(wss, filePath);
      } else if (filePath.endsWith('board.md')) {
        handleBulletinChange(wss, filePath);
      } else if (filePath.endsWith('MEMORY.md')) {
        handleMemoryChange(wss, filePath);
      } else if (filePath.includes('requests/') && filePath.endsWith('.md')) {
        handleRequestChange(wss, filePath);
      } else if (filePath.endsWith('.jsonl')) {
        handleSessionChange(wss, filePath);
      }
    })
    .on('error', error => {
      log.error('Watcher error', { error });
    })
    .on('ready', () => {
      log.info('Ready and watching for changes');
      log.info('Watching paths', { pathCount: watchPaths.length });
    });

  return watcher;
}

export {
  createWatcher,
  getInitialState
};
