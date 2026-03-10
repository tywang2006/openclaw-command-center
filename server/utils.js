import fs from 'fs';
import path from 'path';

/**
 * Base workspace path - derived from environment or default OpenClaw home
 */
export const BASE_PATH = process.env.OPENCLAW_WORKSPACE || path.join(
  process.env.OPENCLAW_HOME || path.join(process.env.HOME || '/root', '.openclaw'),
  'workspace'
);

/**
 * Safely read JSON file
 * @param {string} filePath - Absolute path to JSON file
 * @returns {object|null} Parsed JSON object or null on error
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
 * Safely read text file
 * @param {string} filePath - Absolute path to text file
 * @returns {string} File content or empty string on error
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
