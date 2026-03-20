import express from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { DATA_DIR, BASE_PATH } from '../utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const execFileAsync = promisify(execFile);

// Allowed directories for document processing
const ALLOWED_DIRS = [
  path.resolve(path.join(DATA_DIR, 'uploads')),
  path.resolve(path.join(BASE_PATH, 'departments')),
];

// Document processing endpoint
router.post('/documents/process', async (req, res) => {
  try {
    const { filePath, operation = 'extract' } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }

    const resolvedPath = path.resolve(filePath);
    if (!ALLOWED_DIRS.some(dir => resolvedPath.startsWith(dir + path.sep) || resolvedPath === dir)) {
      return res.status(403).json({ error: 'Access denied: file path is outside allowed directories' });
    }

    // Check if file exists
    try {
      await fs.access(resolvedPath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    const scriptPath = path.join(__dirname, '../../skills/document-processing/doc-process.py');
    const { stdout, stderr } = await execFileAsync('python3', [scriptPath, resolvedPath], { timeout: 60_000 });

    if (stderr) {
      console.error('Document processing error:', stderr);
    }

    const result = JSON.parse(stdout);
    res.json(result);
  } catch (err) {
    console.error('[Documents] Process error:', err.message);
    res.status(500).json({ error: 'Document processing failed' });
  }
});

// List supported formats
router.get('/documents/formats', async (req, res) => {
  res.json({
    supported: [
      { ext: '.pdf', name: 'PDF', operations: ['extract_text', 'ocr', 'split', 'merge'] },
      { ext: '.docx', name: 'Word Document', operations: ['extract_text', 'extract_tables'] },
      { ext: '.xlsx', name: 'Excel Spreadsheet', operations: ['extract_data', 'convert_csv', 'convert_json'] },
      { ext: '.pptx', name: 'PowerPoint', operations: ['extract_text', 'extract_slides'] },
    ],
    requirements: {
      python: ['PyPDF2', 'python-docx', 'openpyxl', 'python-pptx'],
      system: ['poppler-utils (for PDF)', 'tesseract-ocr (for OCR)']
    }
  });
});

// Check if dependencies are installed
router.get('/documents/status', async (req, res) => {
  try {
    const checks = await Promise.all([
      execFileAsync('python3', ['-c', 'import PyPDF2']).then(() => true).catch(() => false),
      execFileAsync('python3', ['-c', 'from docx import Document']).then(() => true).catch(() => false),
      execFileAsync('python3', ['-c', 'import openpyxl']).then(() => true).catch(() => false),
      execFileAsync('python3', ['-c', 'from pptx import Presentation']).then(() => true).catch(() => false),
      execFileAsync('which', ['pdftotext']).then(() => true).catch(() => false),
      execFileAsync('which', ['tesseract']).then(() => true).catch(() => false),
    ]);

    res.json({
      ready: checks.every(Boolean),
      dependencies: {
        PyPDF2: checks[0],
        python_docx: checks[1],
        openpyxl: checks[2],
        python_pptx: checks[3],
        poppler: checks[4],
        tesseract: checks[5],
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
