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
 *   });
 */

const locks = new Map();

/**
 * Execute `fn` while holding an exclusive lock on `filePath`.
 * Multiple callers targeting the same file are serialized via a promise chain.
 */
export function withFileLock(filePath, fn) {
  const prev = locks.get(filePath) || Promise.resolve();
  const next = prev.then(fn, fn); // run fn regardless of previous result
  // Clean up the map entry when the chain settles (avoid memory leak)
  const cleanup = next.then(
    () => { if (locks.get(filePath) === cleanup) locks.delete(filePath); },
    () => { if (locks.get(filePath) === cleanup) locks.delete(filePath); }
  );
  locks.set(filePath, cleanup);
  return next;
}

/**
 * Per-key mutex for in-memory resources (e.g. meeting IDs).
 * Prevents concurrent processing of the same logical entity.
 */
const mutexes = new Map();

export function withMutex(key, fn) {
  const prev = mutexes.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const cleanup = next.then(
    () => { if (mutexes.get(key) === cleanup) mutexes.delete(key); },
    () => { if (mutexes.get(key) === cleanup) mutexes.delete(key); }
  );
  mutexes.set(key, cleanup);
  return next;
}
