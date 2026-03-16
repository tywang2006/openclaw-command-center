import fs from 'fs';
import path from 'path';

/**
 * Base workspace path - derived from environment or default OpenClaw home
 */
export const BASE_PATH = process.env.OPENCLAW_WORKSPACE || path.join(
  process.env.OPENCLAW_HOME || path.join(process.env.HOME || '/root', '.openclaw'),
  'workspace'
);

export const OPENCLAW_HOME = path.join(BASE_PATH, '..');

/**
 * Persistent data directory for Command Center state (password, encryption key, etc.).
 * Stored under ~/.openclaw/command-center/ so npm package updates don't wipe user data.
 */
export const DATA_DIR = path.join(OPENCLAW_HOME, 'command-center');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Safely read JSON file
 */
export function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
    return null;
  } catch (error) {
    console.error(`Error reading JSON file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Atomically write file (write to tmp, then rename)
 */
export function safeWriteFileSync(filePath, data) {
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Safely read text file
 */
export function readTextFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return '';
  } catch (error) {
    console.error(`Error reading text file ${filePath}:`, error.message);
    return '';
  }
}

/**
 * Parse YAML value (arrays, booleans, strings)
 */
export function parseValue(value) {
  const arrayMatch = value.match(/^\[(.*)\]$/);
  if (arrayMatch) {
    return arrayMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '') return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse YAML frontmatter from SKILL.md-style files
 */
export function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };

  const body = content.slice(match[0].length).trim();
  const frontmatter = {};
  let currentKey = null;
  let currentValue = [];

  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) {
      if (currentKey) frontmatter[currentKey] = parseValue(currentValue.join('\n').trim());
      currentKey = kv[1];
      currentValue = [kv[2]];
    } else if (currentKey && line.trim()) {
      currentValue.push(line);
    }
  }
  if (currentKey) frontmatter[currentKey] = parseValue(currentValue.join('\n').trim());

  return { frontmatter, body };
}
