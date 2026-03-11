/**
 * Runtime Office Layout Generator
 * Dynamically generates office layouts based on department configuration.
 * Each office has a main desk/chair (department head) and 3 sub-agent workstations.
 * Furniture UIDs are stable (dept-{name}-{item}) for deterministic seat assignment.
 */

import fs from 'fs';
import path from 'path';

// Configuration
const OFFICES_PER_ROW = 4;
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

const WALL_COLOR = { h: 214, s: 30, b: -100, c: -55 };

// Per-department decoration variety (cycling pattern)
const DECOR_PATTERNS = [
  { shelf: 'ASSET_18', plant: 'ASSET_140' },
  { shelf: 'ASSET_18', plant: 'ASSET_141' },
  { shelf: 'ASSET_17', plant: 'ASSET_142' },
  { shelf: 'ASSET_18', plant: 'ASSET_143' },
  { shelf: 'ASSET_17', plant: 'ASSET_140' },
  { shelf: 'ASSET_18', plant: 'ASSET_141' },
  { shelf: 'ASSET_18', plant: 'ASSET_142' },
];

function coordToIndex(col, row, cols) {
  return row * cols + col;
}

function initializeLayout(cols, rows) {
  const tiles = new Array(cols * rows).fill(TILE.VOID);
  const tileColors = new Array(cols * rows).fill(null);
  return { tiles, tileColors };
}

/**
 * Draw an office room with walls, floor, and a 2-tile door opening.
 */
function createOffice(tiles, tileColors, cols, startCol, startRow, floor, color, isTopRow) {
  for (let r = 0; r < OFFICE_HEIGHT; r++) {
    for (let c = 0; c < OFFICE_WIDTH; c++) {
      const col = startCol + c;
      const row = startRow + r;
      const idx = coordToIndex(col, row, cols);

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
 * Create hallways connecting office rows.
 */
function createHallways(tiles, tileColors, cols, numRows) {
  // Create hallways between each pair of office rows
  for (let hallwayIdx = 0; hallwayIdx < numRows - 1; hallwayIdx++) {
    const hallwayStartRow = 1 + (hallwayIdx + 1) * OFFICE_HEIGHT + hallwayIdx * HALLWAY_HEIGHT;

    for (let r = 0; r < HALLWAY_HEIGHT; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const row = hallwayStartRow + r;
        const idx = coordToIndex(c, row, cols);
        tiles[idx] = TILE.FLOOR_2;
        tileColors[idx] = null;
      }
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
function addDepartmentFurniture(startCol, startRow, name, isTopRow, decorIdx) {
  const furniture = [];
  const decor = DECOR_PATTERNS[decorIdx % DECOR_PATTERNS.length];

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
function addLobbyFurniture(startCol, startRow) {
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
function addHallwayFurniture(cols, numRows) {
  const furniture = [];

  // Add plants at each hallway's endpoints
  for (let hallwayIdx = 0; hallwayIdx < numRows - 1; hallwayIdx++) {
    const hallwayStartRow = 1 + (hallwayIdx + 1) * OFFICE_HEIGHT + hallwayIdx * HALLWAY_HEIGHT;

    furniture.push({
      uid: `hallway-${hallwayIdx}-plant-left`,
      type: 'ASSET_140',
      col: 1,
      row: hallwayStartRow
    });
    furniture.push({
      uid: `hallway-${hallwayIdx}-plant-right`,
      type: 'ASSET_143',
      col: cols - 2,
      row: hallwayStartRow
    });
  }

  return furniture;
}

/**
 * Generate the complete office layout from department configuration.
 * @param {Array} departments - Array of { id, hue, order } objects
 * @returns {Object} - Layout object with version, cols, rows, tiles, tileColors, furniture
 */
export function generateLayout(departments) {
  // Sort departments by order
  const sortedDepts = [...departments].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  const deptCount = sortedDepts.length;
  const totalSlots = deptCount + 1; // +1 for lobby
  const numRows = Math.ceil(totalSlots / OFFICES_PER_ROW);

  // Calculate grid dimensions
  const COLS = OFFICES_PER_ROW * (OFFICE_WIDTH + 1) + 1;
  const ROWS = 1 + numRows * OFFICE_HEIGHT + (numRows - 1) * HALLWAY_HEIGHT + 1;

  console.log(`[LayoutGen] Generating layout for ${deptCount} departments (${numRows} rows, ${COLS}x${ROWS} grid)`);

  const { tiles, tileColors } = initializeLayout(COLS, ROWS);
  const furniture = [];

  // Create hallways
  createHallways(tiles, tileColors, COLS, numRows);
  furniture.push(...addHallwayFurniture(COLS, numRows));

  // Create offices (departments + lobby)
  const offices = [...sortedDepts, { id: 'lobby', hue: 28 }];

  offices.forEach((dept, index) => {
    const gridRow = Math.floor(index / OFFICES_PER_ROW);
    const gridCol = index % OFFICES_PER_ROW;

    const startCol = 1 + gridCol * (OFFICE_WIDTH + 1);
    const startRow = 1 + gridRow * (OFFICE_HEIGHT + HALLWAY_HEIGHT);

    const isTopRow = gridRow % 2 === 0; // Even rows have door at bottom

    // Assign floor tile type (cycle through 7 floor types)
    const floorTile = TILE.FLOOR_1 + (index % 7);

    // Floor color from department hue
    const color = { h: dept.hue || 200, s: 25, b: -45, c: -20 };

    // Create office structure
    createOffice(tiles, tileColors, COLS, startCol, startRow, floorTile, color, isTopRow);

    // Add furniture
    if (dept.id === 'lobby') {
      furniture.push(...addLobbyFurniture(startCol, startRow));
    } else {
      furniture.push(...addDepartmentFurniture(startCol, startRow, dept.id, isTopRow, index));
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
 * Generate layout from config file and save to default-layout.json.
 * @returns {Object} - { cols, rows, departmentCount, furnitureCount, seatCount, fileSize }
 */
export function generateAndSave() {
  const BASE_PATH = process.env.OPENCLAW_WORKSPACE || path.join(
    process.env.OPENCLAW_HOME || path.join(process.env.HOME || '/root', '.openclaw'),
    'workspace'
  );

  // Read department config
  const configPath = path.join(BASE_PATH, 'departments', 'config.json');

  if (!fs.existsSync(configPath)) {
    console.warn(`[LayoutGen] Department config not found at ${configPath}, skipping layout generation`);
    return { cols: 0, rows: 0, departmentCount: 0, furnitureCount: 0, seatCount: 0, fileSize: 0 };
  }

  const configData = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configData);

  // Extract departments array
  const departments = Object.entries(config.departments || {})
    .map(([id, dept]) => ({
      id,
      hue: dept.hue ?? 200,
      order: dept.order ?? 99
    }));

  if (departments.length === 0) {
    console.warn('[LayoutGen] No departments found in config, skipping layout generation');
    return { cols: 0, rows: 0, departmentCount: 0, furnitureCount: 0, seatCount: 0, fileSize: 0 };
  }

  // Generate layout
  const layout = generateLayout(departments);

  // Save to both public/ (for next build) and dist/ (for current runtime)
  const jsonData = JSON.stringify(layout, null, 2);
  const cmdBase = path.join(BASE_PATH, 'command-center');
  const outputPaths = [
    path.join(cmdBase, 'public', 'assets', 'default-layout.json'),
    path.join(cmdBase, 'dist', 'assets', 'default-layout.json'),
  ];

  for (const outputPath of outputPaths) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, jsonData);
    console.log(`[LayoutGen] Layout saved to ${outputPath}`);
  }

  // Calculate stats
  const chairCount = layout.furniture.filter(f =>
    f.type === 'ASSET_49' || f.type === 'ASSET_33' || f.type === 'ASSET_34' ||
    f.type === 'ASSET_NEW_110' || f.type === 'ASSET_NEW_111'
  ).length;

  const fileSize = jsonData.length;

  console.log(`[LayoutGen] Grid: ${layout.cols}x${layout.rows}, Departments: ${departments.length}, Furniture: ${layout.furniture.length}, Seats: ${chairCount}`);

  return {
    cols: layout.cols,
    rows: layout.rows,
    departmentCount: departments.length,
    furnitureCount: layout.furniture.length,
    seatCount: chairCount,
    fileSize
  };
}
