/**
 * SSRF (Server-Side Request Forgery) Protection Module
 *
 * Provides URL validation that blocks requests to private/internal networks,
 * including IPv4 private ranges, IPv6 private ranges, and DNS rebinding attacks.
 *
 * Usage:
 *   import { isPrivateUrl, validateUrlSafety } from '../ssrf-guard.js';
 *
 *   // Synchronous check (URL string only, no DNS resolution)
 *   if (isPrivateUrl(url)) { reject(); }
 *
 *   // Async check with DNS resolution (recommended for outbound requests)
 *   const result = await validateUrlSafety(url);
 *   if (!result.safe) { reject(result.reason); }
 */

import dns from 'node:dns';
import { createLogger } from './logger.js';

const log = createLogger('SSRFGuard');

// ---------------------------------------------------------------------------
// IPv4 private/reserved range checks
// ---------------------------------------------------------------------------

/**
 * Check if an IPv4 address string is in a private or reserved range.
 * Covers: loopback (127.0.0.0/8), link-local (169.254.0.0/16),
 * RFC1918 (10/8, 172.16/12, 192.168/16), broadcast, and 0.0.0.0/8.
 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false; // Not a valid IPv4 -- caller should handle
  }
  const [a, b] = parts;

  if (a === 0) return true;                              // 0.0.0.0/8 (current network)
  if (a === 10) return true;                             // 10.0.0.0/8
  if (a === 127) return true;                            // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true;               // 169.254.0.0/16 (link-local)
  if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12
  if (a === 192 && b === 168) return true;               // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;     // 100.64.0.0/10 (CGNAT / shared)
  if (a === 198 && (b === 18 || b === 19)) return true;  // 198.18.0.0/15 (benchmarking)
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 (IETF protocol)
  if (a === 192 && b === 0 && parts[2] === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && b === 51 && parts[2] === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && parts[2] === 113) return true;  // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true;                             // 224.0.0.0+ (multicast + reserved)

  return false;
}

// ---------------------------------------------------------------------------
// IPv6 private/reserved range checks
// ---------------------------------------------------------------------------

/**
 * Expand an IPv6 address to its full 8-group representation.
 * Returns null if the string is not a valid IPv6 address.
 */
function expandIPv6(ip) {
  // Handle IPv4-mapped IPv6  (e.g., ::ffff:127.0.0.1)
  const v4Suffix = ip.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Suffix) {
    const v4Parts = v4Suffix[1].split('.').map(Number);
    if (v4Parts.some(p => p > 255)) return null;
    const hex1 = ((v4Parts[0] << 8) | v4Parts[1]).toString(16);
    const hex2 = ((v4Parts[2] << 8) | v4Parts[3]).toString(16);
    ip = ip.replace(v4Suffix[0].slice(1), `${hex1}:${hex2}`);
  }

  // Expand ::
  if (ip.includes('::')) {
    const [left, right] = ip.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    if (missing < 0) return null;
    const middle = Array(missing).fill('0');
    ip = [...leftGroups, ...middle, ...rightGroups].join(':');
  }

  const groups = ip.split(':');
  if (groups.length !== 8) return null;

  const parsed = groups.map(g => parseInt(g, 16));
  if (parsed.some(isNaN)) return null;

  return parsed;
}

/**
 * Check if an IPv6 address is in a private or reserved range.
 * Covers: loopback (::1), link-local (fe80::/10), unique-local (fc00::/7),
 * IPv4-mapped (::ffff:0:0/96 with private IPv4), and other reserved ranges.
 */
function isPrivateIPv6(ip) {
  const groups = expandIPv6(ip);
  if (!groups) return true; // Invalid IPv6 -- block by default

  // ::1 (loopback)
  if (groups.every((g, i) => i < 7 ? g === 0 : g === 1)) return true;

  // :: (unspecified)
  if (groups.every(g => g === 0)) return true;

  const first = groups[0];

  // fe80::/10 (link-local) -- first 10 bits = 1111111010
  if ((first & 0xffc0) === 0xfe80) return true;

  // fc00::/7 (unique local address) -- first 7 bits = 1111110
  if ((first & 0xfe00) === 0xfc00) return true;

  // ff00::/8 (multicast)
  if ((first & 0xff00) === 0xff00) return true;

  // ::ffff:0:0/96 (IPv4-mapped) -- check the embedded IPv4 address
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 &&
      groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    const ipv4 = `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`;
    return isPrivateIPv4(ipv4);
  }

  // ::ffff:0:0:0/96 variant (deprecated IPv4-compatible)
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 &&
      groups[3] === 0 && groups[4] === 0 && groups[5] === 0 &&
      !(groups[6] === 0 && groups[7] <= 1)) {
    const ipv4 = `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`;
    return isPrivateIPv4(ipv4);
  }

  // 64:ff9b::/96 (NAT64 well-known prefix) -- check embedded IPv4
  if (groups[0] === 0x64 && groups[1] === 0xff9b &&
      groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
    const ipv4 = `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`;
    return isPrivateIPv4(ipv4);
  }

  // 100::/64 (discard prefix, RFC 6666)
  if (groups[0] === 0x100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return true;

  // 2001:db8::/32 (documentation range)
  if (groups[0] === 0x2001 && groups[1] === 0xdb8) return true;

  // 2001::/32 (Teredo tunneling) -- could tunnel to private IPv4
  if (groups[0] === 0x2001 && groups[1] === 0) return true;

  return false;
}

// ---------------------------------------------------------------------------
// IP address detection
// ---------------------------------------------------------------------------

/**
 * Check if a hostname string looks like an IP address (IPv4 or IPv6).
 */
function isIPAddress(host) {
  // IPv4: 4 groups of digits separated by dots
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6: contains colons (may be bracketed)
  if (host.includes(':')) return true;
  return false;
}

/**
 * Check if any IP address (v4 or v6) is private/reserved.
 */
function isPrivateIP(ip) {
  // Strip brackets from IPv6 (URL hostnames use [::1] notation)
  const cleaned = ip.replace(/^\[|\]$/g, '');

  // Try IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned)) {
    return isPrivateIPv4(cleaned);
  }

  // Try IPv6
  if (cleaned.includes(':')) {
    return isPrivateIPv6(cleaned);
  }

  // Unknown format -- block by default
  return true;
}

// ---------------------------------------------------------------------------
// Blocked hostnames
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',       // GCP metadata service
  'metadata',                        // Common cloud metadata alias
  'instance-data',                   // AWS metadata alias
]);

/**
 * Check if a hostname resolves to a well-known metadata or local service.
 * Cloud metadata services (169.254.169.254, fd00:ec2::254) are blocked via
 * the IPv4/IPv6 range checks, but blocking known hostnames adds defense in depth.
 */
function isBlockedHostname(hostname) {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  // Block .internal TLD (used by cloud providers for internal services)
  if (lower.endsWith('.internal')) return true;
  // Block .local (mDNS)
  if (lower.endsWith('.local')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synchronous SSRF check on a URL string.
 * Returns true if the URL targets a private/internal/blocked network.
 * Does NOT perform DNS resolution -- use validateUrlSafety() for full protection.
 *
 * @param {string} urlStr - The URL to validate
 * @param {object} options
 * @param {boolean} options.requireHttps - If true, block non-HTTPS URLs (default: true)
 * @returns {boolean} true if the URL should be blocked
 */
export function isPrivateUrl(urlStr, { requireHttps = true } = {}) {
  try {
    const parsed = new URL(urlStr);

    // Protocol check
    if (requireHttps) {
      if (parsed.protocol !== 'https:') return true;
    } else {
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true;
    }

    const host = parsed.hostname;
    if (!host) return true;

    // Check blocked hostnames
    if (isBlockedHostname(host)) return true;

    // If the hostname is an IP address, check ranges directly
    if (isIPAddress(host)) {
      return isPrivateIP(host);
    }

    // For domain names, we cannot check the resolved IP synchronously.
    // The DNS check is done in validateUrlSafety() for async callers.
    return false;
  } catch {
    return true; // Malformed URL -- block
  }
}

/**
 * Async SSRF check with DNS resolution.
 * Resolves the hostname and verifies that ALL resolved IPs are public.
 * This is the recommended check before making any outbound HTTP request
 * to a user-supplied URL.
 *
 * @param {string} urlStr - The URL to validate
 * @param {object} options
 * @param {boolean} options.requireHttps - If true, block non-HTTPS URLs (default: true)
 * @returns {Promise<{safe: boolean, reason?: string}>}
 */
export async function validateUrlSafety(urlStr, { requireHttps = true } = {}) {
  // First run the synchronous checks
  if (isPrivateUrl(urlStr, { requireHttps })) {
    return {
      safe: false,
      reason: 'URL targets a private/internal network or uses a disallowed protocol',
    };
  }

  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname;

    // If the hostname is already an IP, the synchronous check handled it
    if (isIPAddress(host)) {
      return { safe: true };
    }

    // Resolve DNS and check ALL returned addresses
    const resolver = new dns.promises.Resolver();
    resolver.setServers(['8.8.8.8', '1.1.1.1']); // Use public DNS to mitigate DNS rebinding via rogue local DNS

    let addresses = [];
    try {
      const v4 = await resolver.resolve4(host).catch(() => []);
      const v6 = await resolver.resolve6(host).catch(() => []);
      addresses = [...v4, ...v6];
    } catch {
      // DNS resolution failed entirely
      return { safe: false, reason: `DNS resolution failed for hostname: ${host}` };
    }

    if (addresses.length === 0) {
      return { safe: false, reason: `No DNS records found for hostname: ${host}` };
    }

    for (const addr of addresses) {
      if (isPrivateIP(addr)) {
        log.warn('DNS resolution returned private IP', { host, ip: addr });
        return {
          safe: false,
          reason: `Hostname "${host}" resolves to private/reserved IP address`,
        };
      }
    }

    return { safe: true };
  } catch (err) {
    log.error('URL safety validation error', { url: urlStr, error: err.message });
    return { safe: false, reason: 'URL validation failed' };
  }
}

/**
 * Validate a provider base URL for SSRF safety.
 * Similar to isPrivateUrl but allows http: for local development providers
 * only when explicitly opted in. By default requires https.
 *
 * @param {string} urlStr - The base URL to validate
 * @returns {boolean} true if the URL should be blocked
 */
export function isPrivateProviderUrl(urlStr) {
  return isPrivateUrl(urlStr, { requireHttps: true });
}

// Export internals for testing
export { isPrivateIPv4, isPrivateIPv6, isPrivateIP, isBlockedHostname };
