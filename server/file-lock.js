/**
 * Per-file promise-chain lock for serializing read-modify-write operations.
 * Prevents data loss from concurrent writes to the same JSON file.
 *
 * Usage:
 *   const result = await withFileLock('/path/to/file.json', async () => {
 *     const data = readFile();
 *     data.foo = 'bar';
 *     writeFile(data);
 *     return data;
 *   }, { timeout: 30000, maxQueue: 10 });
 */

const locks = new Map();
const lockQueues = new Map();

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_QUEUE = 10;

/**
 * Execute `fn` while holding an exclusive lock on `filePath`.
 * Multiple callers targeting the same file are serialized via a promise chain.
 *
 * @param {string} filePath - The file path to lock
 * @param {Function} fn - The async function to execute
 * @param {Object} options - Options object
 * @param {number} options.timeout - Max wait time in ms (default: 30000)
 * @param {number} options.maxQueue - Max queued operations (default: 10)
 * @returns {Promise} Result of fn execution
 */
export function withFileLock(filePath, fn, options = {}) {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;

  // Check queue length
  const queueSize = lockQueues.get(filePath) || 0;
  if (queueSize >= maxQueue) {
    // Return a microtask-scheduled rejection to avoid sync unhandled rejection
    return Promise.resolve().then(() => {
      throw new Error(
        `File lock queue full for ${filePath} (${queueSize} operations queued, max ${maxQueue})`
      );
    });
  }

  // Increment queue counter
  lockQueues.set(filePath, queueSize + 1);

  const prev = locks.get(filePath) || Promise.resolve();

  // Wrap in a promise that handles both timeout and execution
  const next = new Promise((resolve, reject) => {
    let timeoutId;
    let settled = false;

    // Set up timeout
    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(
          `File lock timeout for ${filePath} after ${timeout}ms (queue: ${lockQueues.get(filePath) || 0})`
        ));
      }
    }, timeout);

    // Wait for previous lock and execute
    prev.then(
      () => {
        if (settled) return; // Already timed out, don't execute
        clearTimeout(timeoutId);
        return fn();
      },
      () => {
        if (settled) return; // Already timed out, don't execute
        clearTimeout(timeoutId);
        return fn();
      }
    ).then(
      (result) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    );
  }).finally(() => {
    // Decrement queue counter
    const current = lockQueues.get(filePath) || 1;
    if (current <= 1) {
      lockQueues.delete(filePath);
    } else {
      lockQueues.set(filePath, current - 1);
    }
  });

  // Clean up the map entry when the chain settles (avoid memory leak)
  const cleanup = next.then(
    (result) => {
      if (locks.get(filePath) === cleanup) locks.delete(filePath);
      return result;
    },
    (error) => {
      if (locks.get(filePath) === cleanup) locks.delete(filePath);
      throw error;
    }
  );

  // Prevent unhandled rejection on cleanup promise while it's in the map
  // This doesn't affect the caller's promise (next), only the chain continuation
  cleanup.catch(() => {
    // Silently handle errors in the cleanup chain - errors are still
    // propagated to the caller via the returned 'next' promise
  });

  locks.set(filePath, cleanup);
  return next;
}

/**
 * Per-key mutex for in-memory resources (e.g. meeting IDs).
 * Prevents concurrent processing of the same logical entity.
 */
const mutexes = new Map();
const mutexQueues = new Map();

/**
 * Execute `fn` while holding an exclusive mutex on `key`.
 * Multiple callers targeting the same key are serialized via a promise chain.
 *
 * @param {string} key - The mutex key
 * @param {Function} fn - The async function to execute
 * @param {Object} options - Options object
 * @param {number} options.timeout - Max wait time in ms (default: 30000)
 * @param {number} options.maxQueue - Max queued operations (default: 10)
 * @returns {Promise} Result of fn execution
 */
export function withMutex(key, fn, options = {}) {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;

  // Check queue length
  const queueSize = mutexQueues.get(key) || 0;
  if (queueSize >= maxQueue) {
    // Return a microtask-scheduled rejection to avoid sync unhandled rejection
    return Promise.resolve().then(() => {
      throw new Error(
        `Mutex queue full for ${key} (${queueSize} operations queued, max ${maxQueue})`
      );
    });
  }

  // Increment queue counter
  mutexQueues.set(key, queueSize + 1);

  const prev = mutexes.get(key) || Promise.resolve();

  // Wrap in a promise that handles both timeout and execution
  const next = new Promise((resolve, reject) => {
    let timeoutId;
    let settled = false;

    // Set up timeout
    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(
          `Mutex timeout for ${key} after ${timeout}ms (queue: ${mutexQueues.get(key) || 0})`
        ));
      }
    }, timeout);

    // Wait for previous lock and execute
    prev.then(
      () => {
        if (settled) return; // Already timed out, don't execute
        clearTimeout(timeoutId);
        return fn();
      },
      () => {
        if (settled) return; // Already timed out, don't execute
        clearTimeout(timeoutId);
        return fn();
      }
    ).then(
      (result) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    );
  }).finally(() => {
    // Decrement queue counter
    const current = mutexQueues.get(key) || 1;
    if (current <= 1) {
      mutexQueues.delete(key);
    } else {
      mutexQueues.set(key, current - 1);
    }
  });

  // Clean up the map entry when the chain settles (avoid memory leak)
  const cleanup = next.then(
    (result) => {
      if (mutexes.get(key) === cleanup) mutexes.delete(key);
      return result;
    },
    (error) => {
      if (mutexes.get(key) === cleanup) mutexes.delete(key);
      throw error;
    }
  );

  // Prevent unhandled rejection on cleanup promise while it's in the map
  // This doesn't affect the caller's promise (next), only the chain continuation
  cleanup.catch(() => {
    // Silently handle errors in the cleanup chain - errors are still
    // propagated to the caller via the returned 'next' promise
  });

  mutexes.set(key, cleanup);
  return next;
}
