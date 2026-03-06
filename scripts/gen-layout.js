#!/usr/bin/env node

/**
 * Office Layout Generator
 * Generates a pixel office with 7 departments + lobby in a 4×2 grid with hallways.
 * Each office has a main desk/chair (department head) and 3 sub-agent workstations.
 * Furniture UIDs are stable (dept-{name}-{item}) for deterministic seat assignment.
 */

import fs from 'fs';
import path from 'path';

// Configuration
const COLS = 45;
const ROWS = 22;
const OFFICE_WIDTH = 10;
const OFFICE_HEIGHT = 9;
const HALLWAY_HEIGHT = 2;

// Tile types
const TILE = {
  WALL: 0,
  FLOOR_1: 1,
  FLOOR_2: 2,
  FLOOR_3: 3,
  FLOOR_4: 4,
  FLOOR_5: 5,
  FLOOR_6: 6,
  FLOOR_7: 7,
  VOID: 8,
};

// Department floor colors (hue/saturation/brightness/contrast for tileColors)
const DEPT_COLORS = {
  coo:         { h: 340, s: 25, b: -40, c: -20 },
  engineering: { h: 180, s: 30, b: -50, c: -25 },
  operations:  { h: 50,  s: 35, b: -45, c: -20 },
  research:    { h: 120, s: 25, b: -50, c: -25 },
  product:     { h: 270, s: 25, b: -40, c: -20 },
  admin:       { h: 30,  s: 35, b: -45, c: -20 },
  blockchain:  { h: 210, s: 30, b: -50, c: -25 },
  lobby:       { h: 28,  s: 50, b: -50, c: -37 },
};

const WALL_COLOR = { h: 214, s: 30, b: -100, c: -55 };

// Department configuration: name, floor tile, grid position
const DEPARTMENTS = [
  // Top row (door opens downward to hallway)
  { name: 'coo',         floor: TILE.FLOOR_2, col: 1,  row: 1  },
  { name: 'engineering', floor: TILE.FLOOR_1, col: 12, row: 1  },
  { name: 'operations',  floor: TILE.FLOOR_6, col: 23, row: 1  },
  { name: 'research',    floor: TILE.FLOOR_3, col: 34, row: 1  },
  // Bottom row (door opens upward to hallway)
  { name: 'product',     floor: TILE.FLOOR_5, col: 1,  row: 12 },
  { name: 'admin',       floor: TILE.FLOOR_4, col: 12, row: 12 },
  { name: 'blockchain',  floor: TILE.FLOOR_7, col: 23, row: 12 },
  { name: 'lobby',       floor: TILE.FLOOR_2, col: 34, row: 12 },
];

// Per-department decoration variety
const DEPT_DECOR = {
  coo:         { shelf: 'ASSET_18',  plant: 'ASSET_140' },
  engineering: { shelf: 'ASSET_18',  plant: 'ASSET_141' },
  operations:  { shelf: 'ASSET_17',  plant: 'ASSET_142' },
  research:    { shelf: 'ASSET_18',  plant: 'ASSET_143' },
  product:     { shelf: 'ASSET_17',  plant: 'ASSET_140' },
  admin:       { shelf: 'ASSET_18',  plant: 'ASSET_141' },
  blockchain:  { shelf: 'ASSET_18',  plant: 'ASSET_142' },
};

function coordToIndex(col, row) {
  return row * COLS + col;
}

function initializeLayout() {
  const tiles = new Array(COLS * ROWS).fill(TILE.VOID);
  const tileColors = new Array(COLS * ROWS).fill(null);
  return { tiles, tileColors };
}

/**
 * Draw an office room with walls, floor, and a 2-tile door opening.
 */
function createOffice(tiles, tileColors, dept) {
  const { col: startCol, row: startRow, floor, name } = dept;
  const isTopRow = startRow < 10;
  const color = DEPT_COLORS[name];

  for (let r = 0; r < OFFICE_HEIGHT; r++) {
    for (let c = 0; c < OFFICE_WIDTH; c++) {
      const col = startCol + c;
      const row = startRow + r;
      const idx = coordToIndex(col, row);

      const isWall = r === 0 || r === OFFICE_HEIGHT - 1 || c === 0 || c === OFFICE_WIDTH - 1;

      if (isWall) {
        const doorRow = isTopRow ? OFFICE_HEIGHT - 1 : 0;
        const doorCol1 = Math.floor(OFFICE_WIDTH / 2) - 1;
        const doorCol2 = doorCol1 + 1;

        if (r === doorRow && (c === doorCol1 || c === doorCol2)) {
          tiles[idx] = floor;
          tileColors[idx] = color;
        } else {
          tiles[idx] = TILE.WALL;
          tileColors[idx] = WALL_COLOR;
        }
      } else {
        tiles[idx] = floor;
        tileColors[idx] = color;
      }
    }
  }
}

/**
 * Create the hallway connecting top and bottom office rows.
 */
function createHallway(tiles, tileColors) {
  const hallwayStartRow = 10;
  for (let r = 0; r < HALLWAY_HEIGHT; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      const row = hallwayStartRow + r;
      const idx = coordToIndex(c, row);
      tiles[idx] = TILE.FLOOR_2;
      tileColors[idx] = null;
    }
  }
}

/**
 * Add furniture to a department office.
 * Each office gets: main desk + computer + chair (dept head), bookshelf, plant,
 * and 3 sub-agent workstations (coffee table + chair each).
 *
 * Layout for top-row office (door at bottom, cols 3-4 of inner area):
 *   Row 0: [shelf][shelf] [ ] [desk][desk] [ ] [tbl2][tbl2]
 *   Row 1: [shelf][shelf] [ ] [desk][desk] [ ] [tbl2][tbl2]
 *   Row 2: [plant] [ ]   [ ] [chair-M][ ] [ ] [ ]  [ch-2]
 *   Row 3: [ ] [tbl0][tbl0] [ ]   [ ] [tbl1][tbl1] [ ]
 *   Row 4: [ ] [tbl0][tbl0] [ ]   [ ] [tbl1][tbl1] [ ]
 *   Row 5: [ ] [ch-0] [ ]   [ ]   [ ]  [ ]  [ ] [ch-1]
 *   Row 6: [ ]   [ ]  [ ]  {door} {door} [ ]  [ ]  [ ]
 *
 * Bottom-row offices are vertically mirrored (door at top).
 */
function addDepartmentFurniture(dept) {
  const { col: startCol, row: startRow, name } = dept;
  const isTopRow = startRow < 10;
  const furniture = [];
  const decor = DEPT_DECOR[name];

  // Inner area start (after walls)
  const iC = startCol + 1;
  const iR = startRow + 1;

  const uid = (label) => `dept-${name}-${label}`;

  if (isTopRow) {
    // === TOP ROW: door at bottom (inner row 6), back wall at top (inner row 0) ===

    // Back wall: bookshelf (2×2) at top-left
    furniture.push({ uid: uid('shelf'), type: decor.shelf, col: iC + 0, row: iR + 0 });

    // Back wall: main desk (2×2) at top-center
    furniture.push({ uid: uid('desk'), type: 'ASSET_7', col: iC + 3, row: iR + 0 });
    // Computer on desk (surface item, same position)
    furniture.push({ uid: uid('computer'), type: 'ASSET_90', col: iC + 3, row: iR + 0 });

    // Back wall: sub-agent workstation 2 table at top-right
    furniture.push({ uid: uid('table-sub2'), type: 'ASSET_NEW_112', col: iC + 6, row: iR + 0 });

    // Row 2: plant at left, main chair at center, sub-chair 2 at right
    furniture.push({ uid: uid('plant'), type: decor.plant, col: iC + 0, row: iR + 2 });
    furniture.push({ uid: uid('chair-main'), type: 'ASSET_49', col: iC + 3, row: iR + 2 });
    furniture.push({ uid: uid('chair-sub2'), type: 'ASSET_49', col: iC + 7, row: iR + 2 });

    // Middle: sub-agent workstation 0 (left) and 1 (right) tables
    furniture.push({ uid: uid('table-sub0'), type: 'ASSET_NEW_112', col: iC + 1, row: iR + 3 });
    furniture.push({ uid: uid('table-sub1'), type: 'ASSET_NEW_112', col: iC + 5, row: iR + 3 });

    // Sub-agent chairs below their tables
    furniture.push({ uid: uid('chair-sub0'), type: 'ASSET_49', col: iC + 1, row: iR + 5 });
    furniture.push({ uid: uid('chair-sub1'), type: 'ASSET_49', col: iC + 7, row: iR + 5 });

  } else {
    // === BOTTOM ROW: door at top (inner row 0), back wall at bottom (inner row 6) ===

    // Row 1: sub-agent chairs near door
    furniture.push({ uid: uid('chair-sub0'), type: 'ASSET_49', col: iC + 1, row: iR + 1 });
    furniture.push({ uid: uid('chair-sub1'), type: 'ASSET_49', col: iC + 7, row: iR + 1 });

    // Middle: sub-agent workstation 0 (left) and 1 (right) tables
    furniture.push({ uid: uid('table-sub0'), type: 'ASSET_NEW_112', col: iC + 1, row: iR + 2 });
    furniture.push({ uid: uid('table-sub1'), type: 'ASSET_NEW_112', col: iC + 5, row: iR + 2 });

    // Row 4: main chair at center, sub-chair 2 at right
    furniture.push({ uid: uid('chair-main'), type: 'ASSET_49', col: iC + 3, row: iR + 4 });
    furniture.push({ uid: uid('chair-sub2'), type: 'ASSET_49', col: iC + 7, row: iR + 4 });

    // Back wall: plant at far left (1×2 at iR+5), bookshelf (2×2) offset right
    furniture.push({ uid: uid('plant'), type: decor.plant, col: iC + 0, row: iR + 5 });
    furniture.push({ uid: uid('shelf'), type: decor.shelf, col: iC + 1, row: iR + 5 });

    // Back wall: main desk (2×2) at bottom-center
    furniture.push({ uid: uid('desk'), type: 'ASSET_7', col: iC + 3, row: iR + 5 });
    // Computer on desk
    furniture.push({ uid: uid('computer'), type: 'ASSET_90', col: iC + 3, row: iR + 5 });

    // Back wall: sub-agent workstation 2 table at bottom-right
    furniture.push({ uid: uid('table-sub2'), type: 'ASSET_NEW_112', col: iC + 6, row: iR + 5 });
  }

  return furniture;
}

/**
 * Add lobby furniture (break room / meeting area).
 * No department head — just a meeting table, chairs, vending machine, water cooler.
 */
function addLobbyFurniture(dept) {
  const { col: startCol, row: startRow } = dept;
  const iC = startCol + 1;
  const iR = startRow + 1;
  const furniture = [];

  const uid = (label) => `lobby-${label}`;

  // Center meeting table
  furniture.push({ uid: uid('table'), type: 'ASSET_NEW_112', col: iC + 3, row: iR + 2 });

  // Chairs around the table
  furniture.push({ uid: uid('chair-0'), type: 'ASSET_49', col: iC + 3, row: iR + 1 });
  furniture.push({ uid: uid('chair-1'), type: 'ASSET_49', col: iC + 4, row: iR + 4 });

  // Vending machine (2×2) at back-left
  furniture.push({ uid: uid('vending'), type: 'ASSET_40', col: iC + 0, row: iR + 5 });

  // Water cooler (1×2) at back-right
  furniture.push({ uid: uid('cooler'), type: 'ASSET_42', col: iC + 7, row: iR + 5 });

  // Plants for decoration
  furniture.push({ uid: uid('plant-0'), type: 'ASSET_143', col: iC + 0, row: iR + 2 });
  furniture.push({ uid: uid('plant-1'), type: 'ASSET_141', col: iC + 7, row: iR + 2 });

  // Trash bin
  furniture.push({ uid: uid('bin'), type: 'ASSET_44', col: iC + 2, row: iR + 5 });

  return furniture;
}

/**
 * Add hallway decorations (plants at the ends).
 */
function addHallwayFurniture() {
  const furniture = [];
  // Plants at hallway endpoints
  furniture.push({ uid: 'hallway-plant-left',  type: 'ASSET_140', col: 1,  row: 10 });
  furniture.push({ uid: 'hallway-plant-right', type: 'ASSET_143', col: 43, row: 10 });
  return furniture;
}

/**
 * Generate the complete office layout.
 */
function generateLayout() {
  console.log('Generating office layout...');

  const { tiles, tileColors } = initializeLayout();
  const furniture = [];

  // Hallway
  console.log('Creating hallway...');
  createHallway(tiles, tileColors);
  furniture.push(...addHallwayFurniture());

  // Offices
  DEPARTMENTS.forEach((dept) => {
    console.log(`Creating ${dept.name} office...`);
    createOffice(tiles, tileColors, dept);

    if (dept.name === 'lobby') {
      console.log('Adding lobby furniture...');
      furniture.push(...addLobbyFurniture(dept));
    } else {
      console.log(`Adding furniture to ${dept.name}...`);
      furniture.push(...addDepartmentFurniture(dept));
    }
  });

  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles,
    tileColors,
    furniture,
  };
}

/**
 * Main
 */
function main() {
  try {
    console.log('=== Office Layout Generator ===\n');

    const layout = generateLayout();

    const outputPath = '/root/.openclaw/workspace/command-center/public/assets/default-layout.json';
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(layout, null, 2));

    // Stats
    const chairCount = layout.furniture.filter(f =>
      f.type === 'ASSET_49' || f.type === 'ASSET_33' || f.type === 'ASSET_34' ||
      f.type === 'ASSET_NEW_110' || f.type === 'ASSET_NEW_111'
    ).length;

    console.log('\nLayout generation complete!');
    console.log(`  Grid: ${COLS}x${ROWS} (${COLS * ROWS} tiles)`);
    console.log(`  Departments: ${DEPARTMENTS.length}`);
    console.log(`  Furniture: ${layout.furniture.length} items`);
    console.log(`  Seats (chairs): ${chairCount}`);
    console.log(`  File: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);

    // Print seat UIDs for reference
    console.log('\n  Department seat UIDs:');
    DEPARTMENTS.filter(d => d.name !== 'lobby').forEach(d => {
      console.log(`    ${d.name}: dept-${d.name}-chair-main`);
    });

  } catch (error) {
    console.error('Error generating layout:', error);
    process.exit(1);
  }
}

main();
