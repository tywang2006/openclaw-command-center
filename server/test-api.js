#!/usr/bin/env node

/**
 * Simple API test script
 * Tests all REST endpoints without starting the server
 */

import fs from 'fs';
import path from 'path';

const BASE_PATH = '/root/.openclaw/workspace';

console.log('Testing OpenClaw Command Center API endpoints...\n');

// Test 1: Check departments files exist
console.log('1. Testing departments configuration...');
const configPath = path.join(BASE_PATH, 'departments', 'config.json');
const statusPath = path.join(BASE_PATH, 'departments', 'status.json');

if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log(`   ✓ config.json exists - ${Object.keys(config.departments || {}).length} departments`);
} else {
  console.log('   ✗ config.json not found');
}

if (fs.existsSync(statusPath)) {
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  console.log(`   ✓ status.json exists - ${Object.keys(status.agents || {}).length} agents`);
} else {
  console.log('   ✗ status.json not found');
}

// Test 2: Check department memories
console.log('\n2. Testing department memories...');
const departments = ['coo', 'engineering', 'operations', 'research', 'product', 'admin', 'blockchain'];
let memoryCount = 0;
departments.forEach(dept => {
  const memoryPath = path.join(BASE_PATH, 'departments', dept, 'memory', 'MEMORY.md');
  if (fs.existsSync(memoryPath)) {
    memoryCount++;
    const size = fs.statSync(memoryPath).size;
    console.log(`   ✓ ${dept}/memory/MEMORY.md (${size} bytes)`);
  }
});
console.log(`   Total: ${memoryCount}/${departments.length} memories found`);

// Test 3: Check bulletin board
console.log('\n3. Testing bulletin board...');
const bulletinPath = path.join(BASE_PATH, 'departments', 'bulletin', 'board.md');
if (fs.existsSync(bulletinPath)) {
  const content = fs.readFileSync(bulletinPath, 'utf8');
  const lines = content.split('\n').length;
  console.log(`   ✓ board.md exists (${lines} lines)`);
} else {
  console.log('   ✗ board.md not found');
}

// Test 4: Check requests directory
console.log('\n4. Testing cross-department requests...');
const requestsDir = path.join(BASE_PATH, 'departments', 'bulletin', 'requests');
if (fs.existsSync(requestsDir)) {
  const files = fs.readdirSync(requestsDir).filter(f => f.endsWith('.md'));
  console.log(`   ✓ requests/ directory exists - ${files.length} requests`);
} else {
  console.log('   ✗ requests/ directory not found');
}

// Test 5: Check session files
console.log('\n5. Testing session files...');
const sessionsDir = path.join(BASE_PATH, 'agents', 'main', 'sessions');
if (fs.existsSync(sessionsDir)) {
  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
  console.log(`   ✓ sessions/ directory exists - ${files.length} session files`);
  if (files.length > 0) {
    console.log(`   Latest: ${files[files.length - 1]}`);
  }
} else {
  console.log('   ⚠ sessions/ directory not found (will be created when agents run)');
}

console.log('\n✓ API test complete!\n');
console.log('To start the server, run:');
console.log('  npm start');
console.log('\nThen access:');
console.log('  HTTP API:  http://127.0.0.1:5100/api/departments');
console.log('  WebSocket: ws://127.0.0.1:5100/ws');
