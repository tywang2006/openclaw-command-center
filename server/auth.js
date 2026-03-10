import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PASSWORD_FILE = path.join(__dirname, '../.auth_password');
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Token storage: Map<token, timestamp>
const activeTokens = new Map();

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
    // Legacy plain text — verify directly
    return password === stored;
  }
  const [salt, hash] = stored.split(':');
  const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === testHash;
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
  // Default password if file doesn't exist
  return 'openclaw';
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
  // Clean up expired tokens on each request
  cleanupExpiredTokens();

  // Exempt /auth/login path (relative to /api mount point)
  if (req.path === '/auth/login') {
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

  const storedPassword = getStoredPassword();

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
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      error: 'currentPassword and newPassword are required'
    });
  }

  const storedPassword = getStoredPassword();

  if (!verifyPassword(currentPassword, storedPassword)) {
    return res.status(401).json({
      success: false,
      error: 'Current password is incorrect'
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'New password must be at least 6 characters'
    });
  }

  try {
    // Hash the new password before storing
    const hashedPassword = hashPassword(newPassword);
    fs.writeFileSync(PASSWORD_FILE, hashedPassword, 'utf8');
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

export { authRouter };
