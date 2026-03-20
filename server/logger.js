/**
 * Structured logger with traceId support.
 * Outputs JSON lines in production, readable format in development.
 * Drop-in replacement for console.log with component + traceId context.
 */

const IS_PROD = process.env.NODE_ENV === 'production';

function formatJson(level, component, msg, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...meta,
  };
  return JSON.stringify(entry);
}

function formatReadable(level, component, msg, meta) {
  const traceStr = meta.traceId ? ` trace=${meta.traceId}` : '';
  const { traceId, ...rest } = meta;
  const extraStr = Object.keys(rest).length > 0 ? ' ' + JSON.stringify(rest) : '';
  return `[${component}]${traceStr} ${msg}${extraStr}`;
}

function log(level, component, msg, meta = {}) {
  const formatted = IS_PROD
    ? formatJson(level, component, msg, meta)
    : formatReadable(level, component, msg, meta);

  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
}

/**
 * Create a scoped logger for a component.
 * @param {string} component - Component name (e.g., 'Agent', 'Gateway', 'Chat')
 * @returns Logger with info/warn/error methods
 */
export function createLogger(component) {
  return {
    info(msg, meta = {}) { log('info', component, msg, meta); },
    warn(msg, meta = {}) { log('warn', component, msg, meta); },
    error(msg, meta = {}) { log('error', component, msg, meta); },
  };
}
