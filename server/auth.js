import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration — store in persistent DATA_DIR so npm updates don't wipe the password
const PASSWORD_FILE = path.join(DATA_DIR, '.auth_password');

// Auto-migrate from old location (inside npm package dir) to new persistent location
const OLD_PASSWORD_FILE = path.join(__dirname, '../.auth_password');
if (!fs.existsSync(PASSWORD_FILE) && fs.existsSync(OLD_PASSWORD_FILE)) {
  try {
    fs.copyFileSync(OLD_PASSWORD_FILE, PASSWORD_FILE);
    fs.unlinkSync(OLD_PASSWORD_FILE);
    console.log('[Auth] Migrated password file to persistent location:', PASSWORD_FILE);
  } catch (err) {
    console.warn('[Auth] Failed to migrate password file:', err.message);
  }
}
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Token storage: Map<token, timestamp>
const activeTokens = new Map();

// Periodic token cleanup every 5 minutes
setInterval(cleanupExpiredTokens, 5 * 60 * 1000);

/**
 * Check if a password file exists (i.e. password has been set by user)
 */
function isPasswordConfigured() {
  return fs.existsSync(PASSWORD_FILE);
}

/**
 * Hash a password using scrypt
 * @param {string} password - Plain text password
 * @returns {string} Salt and hash joined by ':'
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a password against stored hash
 * Supports both plain text (legacy) and hashed passwords
 * @param {string} password - Plain text password to verify
 * @param {string} stored - Stored password (plain or hashed)
 * @returns {boolean} True if password matches
 */
function verifyPassword(password, stored) {
  // Support both plain text (legacy) and hashed passwords
  if (!stored.includes(':')) {
    // Legacy plain text — verify directly (timing-safe comparison)
    const storedBuf = Buffer.from(stored);
    const passwordBuf = Buffer.from(password);
    // Pad to equal length to avoid timing leak
    const maxLen = Math.max(storedBuf.length, passwordBuf.length);
    const a = Buffer.concat([storedBuf, Buffer.alloc(maxLen - storedBuf.length)]);
    const b = Buffer.concat([passwordBuf, Buffer.alloc(maxLen - passwordBuf.length)]);
    return crypto.timingSafeEqual(a, b) && storedBuf.length === passwordBuf.length;
  }
  const [salt, hash] = stored.split(':');
  const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(testHash));
}

/**
 * Read password from .auth_password file
 * @returns {string} The stored password (plain or hashed)
 */
function getStoredPassword() {
  try {
    if (fs.existsSync(PASSWORD_FILE)) {
      return fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
    }
  } catch (error) {
    console.error('[Auth] Error reading password file:', error.message);
  }
  return null;
}

/**
 * Clean up expired tokens
 */
function cleanupExpiredTokens() {
  const now = Date.now();
  let removed = 0;
  for (const [token, timestamp] of activeTokens.entries()) {
    if (now - timestamp > TOKEN_EXPIRY_MS) {
      activeTokens.delete(token);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[Auth] Cleaned up ${removed} expired token(s)`);
  }
}

/**
 * Validate a token
 * @param {string} token - The token to validate
 * @returns {boolean} True if valid and not expired
 */
export function validateToken(token) {
  if (!token) return false;

  const timestamp = activeTokens.get(token);
  if (!timestamp) return false;

  // Check if token is expired
  if (Date.now() - timestamp > TOKEN_EXPIRY_MS) {
    activeTokens.delete(token);
    return false;
  }

  return true;
}

/**
 * Authentication middleware
 * Checks Bearer token in Authorization header
 */
export function authMiddleware(req, res, next) {
  // Exempt paths that don't need auth (relative to /api mount point)
  if (req.path === '/auth/login' || req.path === '/integrations/config/gogcli/oauth-redirect') {
    return next();
  }

  // Extract token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  if (!validateToken(token)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }

  // Token is valid, proceed
  next();
}

/**
 * Create auth router
 */
const authRouter = express.Router();

// Rate limiter for login attempts
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS)) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  if (record.count >= RATE_LIMIT_MAX) return false;
  record.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) loginAttempts.delete(ip);
  }
}, 60 * 1000);

/**
 * GET /api/auth/status
 * Returns whether a password has been configured (for first-run detection)
 */
authRouter.get('/status', (req, res) => {
  res.json({ passwordSet: isPasswordConfigured() });
});

/**
 * POST /api/auth/setup
 * First-time password creation. Only works if no password file exists yet.
 * Body: { password: string }
 */
authRouter.post('/setup', (req, res) => {
  if (isPasswordConfigured()) {
    return res.status(403).json({ success: false, error: 'Password already configured' });
  }

  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
  }

  try {
    const hashed = hashPassword(password);
    fs.writeFileSync(PASSWORD_FILE, hashed, { encoding: 'utf8', mode: 0o600 });
    console.log('[Auth] Initial password set by user via setup wizard');
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to save password' });
  }

  // Auto-login: issue token immediately
  const token = crypto.randomUUID();
  activeTokens.set(token, Date.now());

  res.json({ success: true, token, expiresIn: TOKEN_EXPIRY_MS });
});

/**
 * POST /api/auth/login
 * Body: { password: string }
 * Returns: { success: true, token: string } or 401 error
 */
authRouter.post('/login', (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({
      success: false,
      error: 'Password is required'
    });
  }

  const clientIp = req.ip || req.socket.remoteAddress;
  if (!checkLoginRateLimit(clientIp)) {
    return res.status(429).json({
      success: false,
      error: 'Too many login attempts. Try again in 1 minute.'
    });
  }

  const storedPassword = getStoredPassword();

  if (!storedPassword) {
    return res.status(403).json({
      success: false,
      error: 'No password configured. Use /api/auth/setup first.'
    });
  }

  if (!verifyPassword(password, storedPassword)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid password'
    });
  }

  // Generate a new UUID token
  const token = crypto.randomUUID();
  const timestamp = Date.now();

  // Store token with timestamp
  activeTokens.set(token, timestamp);

  console.log(`[Auth] New login successful, token issued (expires in 24h)`);
  console.log(`[Auth] Active tokens: ${activeTokens.size}`);

  res.json({
    success: true,
    token,
    expiresIn: TOKEN_EXPIRY_MS
  });
});

/**
 * POST /api/auth/logout (optional, for completeness)
 * Revokes the current token
 */
authRouter.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (activeTokens.has(token)) {
      activeTokens.delete(token);
      console.log(`[Auth] Token revoked, active tokens: ${activeTokens.size}`);
    }
  }

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

/**
 * PUT /api/auth/password
 * Change the system password
 * Body: { currentPassword, newPassword }
 */
authRouter.put('/password', (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress;
  if (!checkLoginRateLimit(clientIp)) {
    return res.status(429).json({
      success: false,
      error: 'Too many attempts. Try again in 1 minute.'
    });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      error: 'currentPassword and newPassword are required'
    });
  }

  const storedPassword = getStoredPassword();

  if (!storedPassword || !verifyPassword(currentPassword, storedPassword)) {
    return res.status(401).json({
      success: false,
      error: 'Current password is incorrect'
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'New password must be at least 8 characters'
    });
  }

  try {
    // Hash the new password before storing
    const hashedPassword = hashPassword(newPassword);
    fs.writeFileSync(PASSWORD_FILE, hashedPassword, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.error('[Auth] Error writing password file:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to save new password'
    });
  }

  // Clear all active tokens to force re-login
  const tokenCount = activeTokens.size;
  activeTokens.clear();
  console.log(`[Auth] Password changed, cleared ${tokenCount} active token(s)`);
  for (const cb of _tokensClaredCallbacks) { try { cb(); } catch {} }

  res.json({
    success: true,
    message: 'Password changed successfully'
  });
});

/**
 * GET /api/auth/verify
 * Verify if current token is valid
 */
authRouter.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'No token provided'
    });
  }

  const token = authHeader.substring(7);

  if (!validateToken(token)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }

  const timestamp = activeTokens.get(token);
  const expiresAt = new Date(timestamp + TOKEN_EXPIRY_MS).toISOString();

  res.json({
    success: true,
    valid: true,
    expiresAt
  });
});

const _tokensClaredCallbacks = [];
export function onTokensCleared(cb) { _tokensClaredCallbacks.push(cb); }

export { authRouter, isPasswordConfigured };
