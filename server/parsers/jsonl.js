import fs from 'fs';
import path from 'path';

/**
 * Parse a single JSONL line from OpenClaw session files
 * @param {string} line - Single line from JSONL file
 * @returns {Object|null} Parsed message object or null if invalid
 */
function parseJsonlLine(line) {
  if (!line || !line.trim()) {
    return null;
  }

  try {
    const data = JSON.parse(line);
    const result = {
      type: data.type || 'unknown',
      role: data.role || data.type,
      text: '',
      timestamp: data.timestamp || new Date().toISOString()
    };

    // Extract text content based on message structure
    if (data.message) {
      if (typeof data.message === 'string') {
        result.text = data.message;
      } else if (data.message.content) {
        if (typeof data.message.content === 'string') {
          result.text = data.message.content;
        } else if (Array.isArray(data.message.content)) {
          // Content is an array of blocks
          const textBlocks = [];
          const toolBlocks = [];

          for (const block of data.message.content) {
            if (typeof block === 'string') {
              textBlocks.push(block);
            } else if (block.type === 'text' && block.text) {
              textBlocks.push(block.text);
            } else if (block.type === 'tool_use') {
              toolBlocks.push(block.name || 'unknown_tool');
              result.toolName = block.name;
            } else if (block.type === 'tool_result') {
              toolBlocks.push(`result:${block.tool_use_id || 'unknown'}`);
              result.toolName = `result:${block.tool_use_id || 'unknown'}`;
            }
          }

          result.text = textBlocks.join('\n');
          if (toolBlocks.length > 0 && !result.text) {
            result.text = `[Tool: ${toolBlocks.join(', ')}]`;
          }
        }
      }
    } else if (data.content) {
      // Direct content field
      if (typeof data.content === 'string') {
        result.text = data.content;
      } else if (Array.isArray(data.content)) {
        const textBlocks = data.content
          .filter(block => block.type === 'text' && block.text)
          .map(block => block.text);
        result.text = textBlocks.join('\n');
      }
    }

    // Handle progress messages
    if (data.type === 'progress' && data.progress) {
      result.text = `Progress: ${data.progress.message || JSON.stringify(data.progress)}`;
    }

    return result;
  } catch (error) {
    console.error('Error parsing JSONL line:', error.message);
    return null;
  }
}

/**
 * Read last N lines from a file efficiently
 * @param {string} filePath - Path to the file
 * @param {number} count - Number of lines to read from the end
 * @returns {Array<string>} Array of lines
 */
function readLastLines(filePath, count) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return [];
    }

    // For small files, just read the whole thing
    if (stat.size < 10000) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      return lines.slice(-count);
    }

    // For larger files, read chunks from the end
    const bufferSize = Math.min(stat.size, 65536); // 64KB chunks
    const fd = fs.openSync(filePath, 'r');
    const lines = [];
    let position = stat.size;
    let remainingBytes = stat.size;

    try {
      while (lines.length < count && remainingBytes > 0) {
        const chunkSize = Math.min(bufferSize, remainingBytes);
        position -= chunkSize;
        remainingBytes -= chunkSize;

        const buffer = Buffer.alloc(chunkSize);
        fs.readSync(fd, buffer, 0, chunkSize, position);

        const chunk = buffer.toString('utf8');
        const chunkLines = chunk.split('\n');

        // Prepend to lines array
        for (let i = chunkLines.length - 1; i >= 0; i--) {
          if (chunkLines[i].trim()) {
            lines.unshift(chunkLines[i]);
            if (lines.length >= count * 2) { // Read a bit extra to be safe
              break;
            }
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }

    return lines.slice(-count);
  } catch (error) {
    console.error(`Error reading last lines from ${filePath}:`, error.message);
    return [];
  }
}

/**
 * Read new content from a JSONL file starting from a byte offset
 * @param {string} filePath - Path to the file
 * @param {number} offset - Starting byte offset
 * @returns {Object} { lines: Array<string>, newOffset: number }
 */
function readFromOffset(filePath, offset) {
  try {
    if (!fs.existsSync(filePath)) {
      return { lines: [], newOffset: offset };
    }

    const stat = fs.statSync(filePath);
    if (stat.size <= offset) {
      return { lines: [], newOffset: offset };
    }

    const fd = fs.openSync(filePath, 'r');
    const bufferSize = stat.size - offset;
    const buffer = Buffer.alloc(bufferSize);

    try {
      fs.readSync(fd, buffer, 0, bufferSize, offset);
      const content = buffer.toString('utf8');
      const lines = content.split('\n').filter(line => line.trim());

      return {
        lines,
        newOffset: stat.size
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    console.error(`Error reading from offset in ${filePath}:`, error.message);
    return { lines: [], newOffset: offset };
  }
}

export {
  parseJsonlLine,
  readLastLines,
  readFromOffset
};
