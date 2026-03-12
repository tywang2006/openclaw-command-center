/**
 * AES-256-GCM encryption utilities for credential storage.
 *
 * Key management:
 *   - A 32-byte master key is stored in `.encryption_key` (hex-encoded, 64 chars).
 *   - The file is auto-generated on first use and set to mode 0600.
 *   - The key is independent of the user login password so that password
 *     changes do not invalidate encrypted credentials.
 *
 * Ciphertext format (stored as a single string):
 *   enc:v1:<base64 blob>
 *
 * The base64 blob decodes to: iv (12 bytes) || authTag (16 bytes) || ciphertext
 *
 * This module uses only the Node.js built-in `node:crypto` — zero extra deps.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const KEY_FILE = path.join(__dirname, '../.encryption_key');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;        // NIST recommended for GCM
const AUTH_TAG_LENGTH = 16;   // 128-bit authentication tag
const ENCRYPTED_PREFIX = 'enc:v1:';

// Sensitive field paths that must be encrypted (dot-notation).
const SENSITIVE_FIELDS = [
  'gmail.appPassword',
  'drive.serviceAccountKey',
  'voice.apiKeyOverride',
  'gogcli.clientCredentials',
  'google-sheets.serviceAccountKey',
];

// --------------------------------------------------------------------------
// Key management
// --------------------------------------------------------------------------

let _cachedKey = null;

/**
 * Return (or create) the 256-bit master encryption key.
 * @returns {Buffer} 32-byte encryption key
 */
export function getEncryptionKey() {
  if (_cachedKey) return _cachedKey;

  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (hex.length !== 64) {
      throw new Error('[Crypto] .encryption_key is malformed (expected 64 hex chars)');
    }
    _cachedKey = Buffer.from(hex, 'hex');
  } else {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(KEY_FILE, 0o600); } catch { /* best effort */ }
    console.log('[Crypto] Generated new encryption key at', KEY_FILE);
    _cachedKey = key;
  }

  return _cachedKey;
}

// --------------------------------------------------------------------------
// Low-level encrypt / decrypt
// --------------------------------------------------------------------------

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * @param {string} plaintext
 * @param {Buffer} key - 32-byte encryption key
 * @returns {string} "enc:v1:<base64>"
 */
export function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: iv || authTag || ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return ENCRYPTED_PREFIX + packed.toString('base64');
}

/**
 * Decrypt a value previously produced by encrypt().
 * @param {string} encoded - "enc:v1:..." string
 * @param {Buffer} key - 32-byte encryption key
 * @returns {string} Original plaintext
 */
export function decrypt(encoded, key) {
  if (!encoded.startsWith(ENCRYPTED_PREFIX)) {
    throw new Error('[Crypto] Value does not have the expected enc:v1: prefix');
  }

  const packed = Buffer.from(encoded.slice(ENCRYPTED_PREFIX.length), 'base64');

  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('[Crypto] Encrypted payload is too short');
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** @param {*} value @returns {boolean} */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Resolve dot-path to { parent, key }.
 * e.g. "gmail.appPassword" → { parent: config.gmail, key: "appPassword" }
 */
function resolvePath(obj, dotPath) {
  const parts = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== 'object') return null;
    current = current[parts[i]];
  }
  if (current == null || typeof current !== 'object') return null;
  return { parent: current, key: parts[parts.length - 1] };
}

// --------------------------------------------------------------------------
// High-level: encrypt / decrypt sensitive fields in config object
// --------------------------------------------------------------------------

/**
 * Encrypt all sensitive fields in-place before writing to disk.
 * @param {object} config - Config object (mutated in-place)
 * @param {Buffer} key
 * @returns {object} Same config reference
 */
export function encryptSensitiveFields(config, key) {
  for (const fieldPath of SENSITIVE_FIELDS) {
    const ref = resolvePath(config, fieldPath);
    if (!ref) continue;

    let value = ref.parent[ref.key];
    if (value === null || value === undefined || value === '') continue;
    if (isEncrypted(value)) continue;

    // Objects (e.g. serviceAccountKey) are stringified first
    if (typeof value === 'object') {
      value = JSON.stringify(value);
    }

    ref.parent[ref.key] = encrypt(String(value), key);
  }
  return config;
}

/**
 * Decrypt all sensitive fields in-place after reading from disk.
 * @param {object} config - Config object (mutated in-place)
 * @param {Buffer} key
 * @returns {object} Same config reference
 */
export function decryptSensitiveFields(config, key) {
  for (const fieldPath of SENSITIVE_FIELDS) {
    const ref = resolvePath(config, fieldPath);
    if (!ref) continue;

    const value = ref.parent[ref.key];
    if (value === null || value === undefined || value === '') continue;
    if (!isEncrypted(value)) continue;

    let decrypted = decrypt(value, key);

    // serviceAccountKey / clientCredentials should be parsed back into an object
    if (fieldPath === 'drive.serviceAccountKey' || fieldPath === 'google-sheets.serviceAccountKey' || fieldPath === 'gogcli.clientCredentials') {
      try { decrypted = JSON.parse(decrypted); } catch {
        console.warn(`[Crypto] Failed to parse decrypted ${fieldPath} as JSON`);
      }
    }

    ref.parent[ref.key] = decrypted;
  }
  return config;
}

/**
 * Detect legacy plaintext sensitive fields and encrypt them.
 * @param {object} config
 * @param {Buffer} key
 * @returns {number} Number of fields migrated
 */
export function migratePlaintextFields(config, key) {
  let migrated = 0;

  for (const fieldPath of SENSITIVE_FIELDS) {
    const ref = resolvePath(config, fieldPath);
    if (!ref) continue;

    let value = ref.parent[ref.key];
    if (value === null || value === undefined || value === '') continue;
    if (isEncrypted(value)) continue;

    if (typeof value === 'object') {
      value = JSON.stringify(value);
    }
    ref.parent[ref.key] = encrypt(String(value), key);
    migrated++;
  }

  return migrated;
}

export { SENSITIVE_FIELDS, ENCRYPTED_PREFIX };
