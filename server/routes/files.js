import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const execFileAsync = promisify(execFile);

// ── Directories ──────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const OUTPUTS_DIR = path.join(__dirname, '../../outputs');

async function ensureDirs() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.mkdir(OUTPUTS_DIR, { recursive: true });
}

// ── Logging helper ───────────────────────────────────────────
function log(level, msg, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    module: 'files',
    message: msg,
    ...meta,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ── File type constants ──────────────────────────────────────
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.xlsx', '.pptx',
  '.txt', '.csv', '.json', '.md',
]);

// MIME ↔ extension mapping for double-checking
const MIME_TO_EXT = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': ['.txt', '.csv', '.md'],
  'text/csv': '.csv',
  'text/markdown': '.md',
  'application/json': '.json',
};

// Magic-byte signatures for binary formats
const MAGIC_BYTES = {
  '.pdf': { offset: 0, bytes: Buffer.from('%PDF') },
  '.docx': { offset: 0, bytes: Buffer.from([0x50, 0x4B, 0x03, 0x04]) }, // ZIP (OOXML)
  '.xlsx': { offset: 0, bytes: Buffer.from([0x50, 0x4B, 0x03, 0x04]) },
  '.pptx': { offset: 0, bytes: Buffer.from([0x50, 0x4B, 0x03, 0x04]) },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ── Helpers ──────────────────────────────────────────────────

/** Sanitise a user-supplied filename to prevent traversal / special chars */
function sanitizeFilename(name) {
  // Strip directory components and null bytes
  let clean = path.basename(name).replace(/\0/g, '');
  // Replace anything that isn't alphanumeric, dot, dash, underscore
  clean = clean.replace(/[^a-zA-Z0-9._\-]/g, '_');
  // Collapse multiple dots (prevents hidden-file tricks)
  clean = clean.replace(/\.{2,}/g, '.');
  return clean || 'unnamed';
}

/** Verify magic bytes of an uploaded file match the claimed extension */
async function verifyMagicBytes(filePath, ext) {
  const sig = MAGIC_BYTES[ext];
  if (!sig) return true; // text formats — no signature to check

  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(sig.bytes.length);
    await handle.read(buf, 0, sig.bytes.length, sig.offset);
    return buf.equals(sig.bytes);
  } finally {
    await handle.close();
  }
}

/** Check MIME type is consistent with the file extension */
function mimeMatchesExt(mime, ext) {
  const expected = MIME_TO_EXT[mime];
  if (!expected) return true; // unknown MIME — allow (extension is already validated)
  if (Array.isArray(expected)) return expected.includes(ext);
  return expected === ext;
}

// ── Processing queue ─────────────────────────────────────────
// In-memory queue. Each job: { id, filePath, originalName, ext, status, result, error, createdAt }
const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000; // auto-purge after 1 h
let queueProcessing = false;
const pendingQueue = [];

function createJob(filePath, originalName, ext) {
  const id = crypto.randomUUID();
  const job = {
    id,
    filePath,
    originalName,
    ext,
    status: 'queued',
    result: null,
    error: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  pendingQueue.push(id);
  log('info', 'Job queued', { jobId: id, file: originalName });
  processQueue(); // kick off if idle
  return job;
}

async function processQueue() {
  if (queueProcessing) return;
  queueProcessing = true;

  while (pendingQueue.length > 0) {
    const jobId = pendingQueue.shift();
    const job = jobs.get(jobId);
    if (!job) continue;

    job.status = 'processing';
    log('info', 'Processing job', { jobId, file: job.originalName });

    try {
      if (['.pdf', '.docx', '.xlsx', '.pptx'].includes(job.ext)) {
        const scriptPath = path.join(__dirname, '../../skills/document-processing/doc-process.py');
        // Safe: filePath is controlled (multer destination + uuid name)
        const { stdout } = await execFileAsync(
          'python3', [scriptPath, job.filePath],
          { timeout: 60_000 },
        );
        const parsed = JSON.parse(stdout);
        if (parsed.success) {
          job.result = parsed;
        } else {
          job.error = parsed.error || 'Processing failed';
        }
      } else {
        // Text-based files
        const content = await fs.readFile(job.filePath, 'utf8');
        job.result = { text: content };
      }
      job.status = 'done';
      log('info', 'Job done', { jobId, file: job.originalName });
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
      log('error', 'Job failed', { jobId, file: job.originalName, error: err.message });
    }
  }

  queueProcessing = false;
}

// Periodic cleanup of old jobs
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000);

// ── Multer configuration ────────────────────────────────────
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await ensureDirs();
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const uniquePrefix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
    const safeName = sanitizeFilename(file.originalname);
    cb(null, `${uniquePrefix}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error(`Unsupported file type "${ext}". Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`));
    }
    if (!mimeMatchesExt(file.mimetype, ext)) {
      return cb(new Error(`MIME type "${file.mimetype}" does not match extension "${ext}"`));
    }
    cb(null, true);
  },
});

// ── Multer error handler middleware ─────────────────────────
function handleMulterError(err, _req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024} MB` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
}

// ══════════════════════════════════════════════════════════════
// Routes
// ══════════════════════════════════════════════════════════════

// ── POST /files/upload ──────────────────────────────────────
// Synchronous processing (waits for result).
router.post('/files/upload', upload.single('file'), handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { path: filePath, originalname: originalName } = req.file;
    const ext = path.extname(originalName).toLowerCase();

    // Verify magic bytes for binary formats
    const magicOk = await verifyMagicBytes(filePath, ext);
    if (!magicOk) {
      await fs.unlink(filePath).catch(() => {});
      log('warn', 'Magic-byte mismatch, file rejected', { file: originalName, ext });
      return res.status(400).json({ error: 'File content does not match its extension' });
    }

    log('info', 'File uploaded', {
      file: originalName,
      size: req.file.size,
      ext,
    });

    const result = {
      success: true,
      originalName,
      storedName: req.file.filename,
      fileType: ext,
      size: req.file.size,
      processed: false,
    };

    // Extract text/content based on file type
    if (['.pdf', '.docx', '.xlsx', '.pptx'].includes(ext)) {
      const scriptPath = path.join(__dirname, '../../skills/document-processing/doc-process.py');
      const { stdout } = await execFileAsync(
        'python3', [scriptPath, filePath],
        { timeout: 60_000 },
      );
      const processResult = JSON.parse(stdout);
      if (processResult.success) {
        result.extracted = processResult;
        result.processed = true;
      }
    } else {
      const content = await fs.readFile(filePath, 'utf8');
      result.extracted = { text: content };
      result.processed = true;
    }

    res.json(result);
  } catch (err) {
    log('error', 'Upload processing error', { error: err.message });
    res.status(500).json({ error: 'File processing failed' });
  }
});

// ── POST /files/upload/async ────────────────────────────────
// Queues processing and immediately returns a job ID.
router.post('/files/upload/async', upload.single('file'), handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { path: filePath, originalname: originalName } = req.file;
    const ext = path.extname(originalName).toLowerCase();

    const magicOk = await verifyMagicBytes(filePath, ext);
    if (!magicOk) {
      await fs.unlink(filePath).catch(() => {});
      return res.status(400).json({ error: 'File content does not match its extension' });
    }

    const job = createJob(filePath, originalName, ext);

    res.status(202).json({
      success: true,
      jobId: job.id,
      status: job.status,
      pollUrl: `/api/files/job/${job.id}`,
    });
  } catch (err) {
    log('error', 'Async upload error', { error: err.message });
    res.status(500).json({ error: 'Failed to queue file for processing' });
  }
});

// ── GET /files/job/:jobId ───────────────────────────────────
// Poll the status of an async processing job.
router.get('/files/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({
    jobId: job.id,
    status: job.status,
    originalName: job.originalName,
    result: job.result,
    error: job.error,
  });
});

// ── GET /files/download/:filename ───────────────────────────
// Supports Range requests for resume / partial downloads.
router.get('/files/download/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;

    // Security: reject directory traversal and path separators
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = path.join(OUTPUTS_DIR, filename);

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Parse Range header, e.g. "bytes=0-1023"
      const match = range.match(/^bytes=(\d+)-(\d*)$/);
      if (!match) {
        return res.status(416).json({ error: 'Invalid Range header' });
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.status(416).json({ error: 'Range not satisfiable' });
      }

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', end - start + 1);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

      const stream = createReadStream(filePath, { start, end });
      stream.on('error', (err) => {
        log('error', 'Stream error during ranged download', { filename, error: err.message });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Download failed' });
        }
      });
      stream.pipe(res);
    } else {
      // Full download
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

      const stream = createReadStream(filePath);
      stream.on('error', (err) => {
        log('error', 'Stream error during download', { filename, error: err.message });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Download failed' });
        }
      });
      stream.pipe(res);
    }
  } catch (err) {
    log('error', 'Download error', { error: err.message });
    res.status(500).json({ error: 'Download failed' });
  }
});

// ── GET /files/list ─────────────────────────────────────────
router.get('/files/list', async (req, res) => {
  try {
    await ensureDirs();
    const files = await fs.readdir(UPLOADS_DIR);
    const fileList = await Promise.all(
      files.map(async (f) => {
        const stat = await fs.stat(path.join(UPLOADS_DIR, f));
        return {
          name: f,
          size: stat.size,
          created: stat.birthtime,
        };
      }),
    );
    res.json({ files: fileList });
  } catch (err) {
    log('error', 'List files error', { error: err.message });
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// ── DELETE /files/:filename ─────────────────────────────────
router.delete('/files/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = path.join(UPLOADS_DIR, filename);
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    await fs.unlink(filePath);
    log('info', 'File deleted', { filename });
    res.json({ success: true, deleted: filename });
  } catch (err) {
    log('error', 'Delete file error', { error: err.message });
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ── POST /files/convert ─────────────────────────────────────
// SECURITY FIX: Only accept stored filenames (not arbitrary paths).
// The file must exist in UPLOADS_DIR; user cannot supply absolute paths.
router.post('/files/convert', async (req, res) => {
  try {
    const { filename, targetFormat } = req.body;

    if (!filename || !targetFormat) {
      return res.status(400).json({ error: 'filename and targetFormat are required' });
    }

    // Validate filename — must be a plain name, no path components
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const allowedTargets = ['csv', 'json', 'txt'];
    if (!allowedTargets.includes(targetFormat)) {
      return res.status(400).json({ error: `Target format must be one of: ${allowedTargets.join(', ')}` });
    }

    const filePath = path.join(UPLOADS_DIR, filename);
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Source file not found' });
    }

    await ensureDirs();
    const ext = path.extname(filename).toLowerCase();
    const baseName = path.basename(filename, ext);
    const outName = `${baseName}-converted.${targetFormat}`;
    const outputPath = path.join(OUTPUTS_DIR, outName);

    // Use a dedicated Python conversion script with proper argument passing
    // Passing paths as separate args avoids shell injection
    const scriptPath = path.join(__dirname, '../scripts/convert.py');

    try {
      await fs.access(scriptPath);
    } catch {
      // Fallback: write a minimal self-contained converter
      // This avoids command injection by passing file paths as proper arguments
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(scriptPath, CONVERT_SCRIPT);
    }

    const { stdout, stderr } = await execFileAsync(
      'python3', [scriptPath, filePath, outputPath, targetFormat],
      { timeout: 30_000 },
    );

    if (stderr) {
      log('warn', 'Conversion stderr', { stderr: stderr.substring(0, 500) });
    }

    log('info', 'File converted', { source: filename, target: outName });

    res.json({
      success: true,
      outputFile: outName,
      downloadUrl: `/api/files/download/${encodeURIComponent(outName)}`,
    });
  } catch (err) {
    log('error', 'Convert error', { error: err.message });
    res.status(500).json({ error: 'Conversion failed' });
  }
});

// ── Embedded conversion script ──────────────────────────────
// Used as a fallback if server/scripts/convert.py doesn't exist yet.
const CONVERT_SCRIPT = `#!/usr/bin/env python3
"""Minimal document converter. Usage: convert.py <input> <output> <format>"""
import sys, json, csv, os

def main():
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: convert.py <input> <output> <format>"}))
        sys.exit(1)

    src, dst, fmt = sys.argv[1], sys.argv[2], sys.argv[3]
    ext = os.path.splitext(src)[1].lower()

    if ext == '.xlsx' and fmt == 'csv':
        import openpyxl
        wb = openpyxl.load_workbook(src)
        ws = wb.active
        with open(dst, 'w', newline='') as f:
            writer = csv.writer(f)
            for row in ws.iter_rows(values_only=True):
                writer.writerow(row)
    elif ext == '.xlsx' and fmt == 'json':
        import openpyxl
        wb = openpyxl.load_workbook(src)
        ws = wb.active
        headers = [cell.value for cell in ws[1]]
        data = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            data.append(dict(zip(headers, [v if v is not None else "" for v in row])))
        with open(dst, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    elif ext == '.docx' and fmt == 'txt':
        from docx import Document
        doc = Document(src)
        with open(dst, 'w') as f:
            f.write('\\n'.join(p.text for p in doc.paragraphs))
    elif ext in ('.csv', '.txt', '.md', '.json') and fmt in ('txt', 'json', 'csv'):
        import shutil
        shutil.copy2(src, dst)
    else:
        print(json.dumps({"error": f"Conversion from {ext} to {fmt} not supported"}))
        sys.exit(1)

    print(json.dumps({"success": True}))

if __name__ == '__main__':
    main()
`;

export default router;
