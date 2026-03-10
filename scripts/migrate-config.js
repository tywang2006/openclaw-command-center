#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Emoji to icon mapping
const EMOJI_TO_ICON = {
  '⚡': 'bolt',
  '🔧': 'wrench',
  '🔍': 'search',
  '📊': 'chart',
  '🎨': 'palette',
  '📋': 'clipboard',
  '⛓️': 'chain',
};

// Default colors and hues per icon type
const ICON_COLORS = {
  bolt: { color: '#fbbf24', hue: 45 },
  wrench: { color: '#00d4aa', hue: 160 },
  search: { color: '#60a5fa', hue: 220 },
  chart: { color: '#a78bfa', hue: 260 },
  palette: { color: '#f472b6', hue: 330 },
  clipboard: { color: '#4ade80', hue: 140 },
  chain: { color: '#f97316', hue: 25 },
  default: { color: '#94a3b8', hue: 200 },
};

/**
 * Detect if config is in old format (topicId as key) or new format (deptId as key)
 */
function isOldFormat(departments) {
  if (!departments || typeof departments !== 'object') {
    return false;
  }

  const keys = Object.keys(departments);
  if (keys.length === 0) {
    return false;
  }

  // Old format: keys are numeric strings (topicIds like "1", "1430")
  // New format: keys are alphanumeric strings (deptIds like "coo", "engineering")
  const firstKey = keys[0];

  // If key is purely numeric, it's old format
  return /^\d+$/.test(firstKey);
}

/**
 * Convert emoji to icon name
 */
function emojiToIcon(emoji) {
  return EMOJI_TO_ICON[emoji] || 'bolt';
}

/**
 * Get color and hue for an icon
 */
function getIconColors(icon) {
  return ICON_COLORS[icon] || ICON_COLORS.default;
}

/**
 * Convert old format to new format
 */
function convertToNewFormat(oldConfig) {
  const { departments: oldDepts, defaultDepartment, groupId } = oldConfig;

  const newDepartments = {};
  const entries = Object.entries(oldDepts);

  entries.forEach(([topicId, dept], index) => {
    const { id: deptId, name, agent, emoji } = dept;

    // Convert emoji to icon
    const icon = emojiToIcon(emoji);
    const { color, hue } = getIconColors(icon);

    // Create new department entry with deptId as key
    newDepartments[deptId] = {
      name,
      agent,
      icon,
      color,
      hue,
      telegramTopicId: parseInt(topicId, 10),
      order: index,
    };
  });

  return {
    departments: newDepartments,
    defaultDepartment,
    groupId,
  };
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('🔄 Starting department config migration...\n');

  // Get config path from environment or default
  const openclawHome = process.env.OPENCLAW_HOME || path.join(process.env.HOME || '/root', '.openclaw');
  const configPath = path.join(openclawHome, 'workspace', 'departments', 'config.json');

  console.log(`📂 Config path: ${configPath}`);

  // Check if config exists
  try {
    await fs.access(configPath);
  } catch (error) {
    console.error(`❌ Config file not found: ${configPath}`);
    process.exit(1);
  }

  // Read current config
  let configContent;
  try {
    configContent = await fs.readFile(configPath, 'utf-8');
  } catch (error) {
    console.error(`❌ Failed to read config file: ${error.message}`);
    process.exit(1);
  }

  let currentConfig;
  try {
    currentConfig = JSON.parse(configContent);
  } catch (error) {
    console.error(`❌ Failed to parse config JSON: ${error.message}`);
    process.exit(1);
  }

  // Check if already in new format
  if (!isOldFormat(currentConfig.departments)) {
    console.log('✅ Config is already in new format. Nothing to migrate.');
    console.log('\nCurrent departments:');
    Object.entries(currentConfig.departments).forEach(([deptId, dept]) => {
      console.log(`  - ${deptId}: ${dept.name} (${dept.icon})`);
    });
    process.exit(0);
  }

  console.log('\n📋 Old format detected. Converting...\n');

  // Show what we're converting
  console.log('Old departments (topicId → deptId):');
  Object.entries(currentConfig.departments).forEach(([topicId, dept]) => {
    console.log(`  ${topicId} → ${dept.id}: ${dept.name} (${dept.emoji})`);
  });

  // Convert to new format
  const newConfig = convertToNewFormat(currentConfig);

  // Create backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${configPath}.bak.${timestamp}`;

  try {
    await fs.writeFile(backupPath, configContent, 'utf-8');
    console.log(`\n💾 Backup created: ${backupPath}`);
  } catch (error) {
    console.error(`❌ Failed to create backup: ${error.message}`);
    process.exit(1);
  }

  // Write new config
  try {
    await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
    console.log(`✅ New config written: ${configPath}`);
  } catch (error) {
    console.error(`❌ Failed to write new config: ${error.message}`);
    console.error(`   Backup is available at: ${backupPath}`);
    process.exit(1);
  }

  // Print summary
  console.log('\n📊 Migration Summary:');
  console.log(`   Departments migrated: ${Object.keys(newConfig.departments).length}`);
  console.log(`   Default department: ${newConfig.defaultDepartment}`);
  console.log(`   Group ID: ${newConfig.groupId}`);

  console.log('\n✨ New departments:');
  Object.entries(newConfig.departments).forEach(([deptId, dept]) => {
    console.log(`  - ${deptId}: ${dept.name}`);
    console.log(`    Agent: ${dept.agent}`);
    console.log(`    Icon: ${dept.icon}, Color: ${dept.color}, Hue: ${dept.hue}`);
    console.log(`    Telegram Topic: ${dept.telegramTopicId}, Order: ${dept.order}`);
  });

  console.log('\n✅ Migration completed successfully!');
}

// Run migration
migrate().catch((error) => {
  console.error('\n❌ Migration failed:', error);
  process.exit(1);
});
