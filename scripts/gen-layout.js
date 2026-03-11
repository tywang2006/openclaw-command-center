#!/usr/bin/env node

/**
 * Office Layout Generator (CLI wrapper)
 * Reads department config and generates a dynamic layout.
 * Writes to both public/assets/ and dist/assets/ so both dev and production work.
 */

import { generateAndSave } from '../server/layout-generator.js';

try {
  const result = generateAndSave();
  if (result.departmentCount > 0) {
    console.log(`Layout generated: ${result.departmentCount} departments, ${result.furnitureCount} furniture, ${result.seatCount} seats`);
  } else {
    console.log('No departments found — layout generation skipped');
  }
} catch (err) {
  console.error('Layout generation failed:', err.message);
  process.exit(1);
}
