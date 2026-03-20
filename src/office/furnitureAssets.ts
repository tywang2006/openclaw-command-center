import type { SpriteData } from './types.js'
import { buildDynamicCatalog, type LoadedAssetData } from './layout/furnitureCatalog.js'

// ── Procedural Sprite Generation Utilities ──────────────────────────

/**
 * Creates a blank sprite canvas filled with transparent pixels
 */
function createCanvas(width: number, height: number): SpriteData {
  return Array(height).fill(null).map(() => Array(width).fill(''))
}

/**
 * Fills a rectangular region with a color
 */
function fillRect(
  canvas: SpriteData,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const row = y + dy
      const col = x + dx
      if (row >= 0 && row < canvas.length && col >= 0 && col < canvas[0].length) {
        canvas[row][col] = color
      }
    }
  }
}

/**
 * Draws a border around a rectangular region
 */
function drawBorder(
  canvas: SpriteData,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  // Top and bottom
  for (let dx = 0; dx < w; dx++) {
    if (y >= 0 && y < canvas.length && x + dx >= 0 && x + dx < canvas[0].length) {
      canvas[y][x + dx] = color
    }
    if (y + h - 1 >= 0 && y + h - 1 < canvas.length && x + dx >= 0 && x + dx < canvas[0].length) {
      canvas[y + h - 1][x + dx] = color
    }
  }
  // Left and right
  for (let dy = 0; dy < h; dy++) {
    if (y + dy >= 0 && y + dy < canvas.length && x >= 0 && x < canvas[0].length) {
      canvas[y + dy][x] = color
    }
    if (y + dy >= 0 && y + dy < canvas.length && x + w - 1 >= 0 && x + w - 1 < canvas[0].length) {
      canvas[y + dy][x + w - 1] = color
    }
  }
}

/**
 * Sets a single pixel
 */
function setPixel(canvas: SpriteData, x: number, y: number, color: string): void {
  if (y >= 0 && y < canvas.length && x >= 0 && x < canvas[0].length) {
    canvas[y][x] = color
  }
}

// ── Color Palettes ───────────────────────────────────────────────────

const COLORS = {
  // Wood tones (warm oak, 4-step gradient)
  WOOD_DARKEST: '#4A3308',
  WOOD_DARK: '#6B4E0A',
  WOOD_BASE: '#8B6914',
  WOOD_LIGHT: '#A07828',
  WOOD_SURFACE: '#B8922E',
  WOOD_HIGHLIGHT: '#D4AC42',

  // Metal/Gray (steel, 4-step gradient)
  METAL_DARKEST: '#3A3A4A',
  METAL_DARK: '#5A5A6A',
  METAL_BASE: '#7A7A8A',
  METAL_LIGHT: '#9A9AAA',
  METAL_HIGHLIGHT: '#B0B0C0',

  // White/Cream (furniture surfaces)
  WHITE: '#E8E8E0',
  WHITE_BRIGHT: '#F8F8F0',
  CREAM: '#D8D0C4',
  GRAY_LIGHTEST: '#E0DDD8',
  GRAY_LIGHT: '#C0BDB8',
  GRAY: '#A0A0A0',
  GRAY_DARK: '#808088',
  GRAY_DARKEST: '#606068',

  // Electronics (modern devices)
  TECH_DARKEST: '#1A1A28',
  TECH_DARK: '#2A2A3A',
  TECH_BASE: '#3A3A4A',
  TECH_LIGHT: '#4A4A5A',
  SCREEN_OFF: '#1A2A3A',
  SCREEN_DARK: '#1A4466',
  SCREEN_BASE: '#2A6699',
  SCREEN_LIGHT: '#3A88BB',
  SCREEN_BRIGHT: '#5AAADE',
  SCREEN_GLOW: '#7BBCEE',
  LED_GREEN: '#44DD66',
  LED_RED: '#DD4444',

  // Green/Plants (lush foliage, 5-step)
  GREEN_DARKEST: '#1A4A16',
  GREEN_DARK: '#2D6B27',
  GREEN_BASE: '#3D8B37',
  GREEN_LIGHT: '#4DAA47',
  GREEN_BRIGHT: '#66CC5A',
  LEAF_DARK: '#2A5A22',
  LEAF_BASE: '#3A7A32',
  LEAF_LIGHT: '#5A9A4A',

  // Browns (earth/pot/soil)
  BROWN_DARKEST: '#3A2410',
  BROWN_DARK: '#5A3A1A',
  BROWN_BASE: '#7A5030',
  BROWN_LIGHT: '#9A6A3A',
  SOIL: '#4A3020',

  // Chair/Furniture
  FRAME_DARKEST: '#2A3444',
  FRAME_DARK: '#3A4A5C',
  FRAME_BASE: '#5A6A7C',
  CUSHION_DARK: '#3A6070',
  CUSHION: '#4A7A8C',
  CUSHION_LIGHT: '#5A9AAC',
  FABRIC_DARK: '#3A5060',
  FABRIC_BASE: '#4A6878',
  FABRIC_LIGHT: '#6A8898',

  // Accent colors (vivid)
  RED: '#CC3333',
  RED_DARK: '#992222',
  BLUE: '#3366CC',
  BLUE_DARK: '#2244AA',
  GREEN_ACCENT: '#33AA33',
  YELLOW: '#DDAA33',
  YELLOW_DARK: '#AA8822',
  ORANGE: '#DD7733',
  ORANGE_DARK: '#BB5522',
  PURPLE: '#9966CC',
  PURPLE_DARK: '#774488',
  PINK: '#CC6699',
  TEAL: '#44AAAA',

  // Display/Vending
  DISPLAY_BG: '#2A4A6A',
  DISPLAY_LIGHT: '#4A6A8A',
  WATER_BLUE: '#7ABADD',
  WATER_LIGHT: '#9AD0EE',

  // Black
  BLACK: '#222230',
  BLACK_SOFT: '#333344',
  BLACK_PURE: '#111118',

  // Painting colors
  SKY_BLUE: '#6A8ABB',
  SKY_LIGHT: '#8AAADE',
  GRASS_GREEN: '#5A8A5A',
  GOLD_FRAME: '#B8922E',
  GOLD_LIGHT: '#D4AC42',

  // Shadows/Highlights
  SHADOW: 'rgba(0,0,0,0.2)',
  SHADOW_DARK: '#1A1A28',
}

// ── Sprite Generators ────────────────────────────────────────────────

function generateCounterWhiteSmall(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Desktop surface top edge (3D effect)
  fillRect(canvas, 0, 15, 32, 2, COLORS.WHITE_BRIGHT)
  fillRect(canvas, 1, 15, 30, 1, COLORS.GRAY_LIGHTEST)

  // Desktop front face
  fillRect(canvas, 0, 17, 32, 9, COLORS.WHITE)
  // Left shadow edge
  fillRect(canvas, 0, 17, 1, 9, COLORS.GRAY_LIGHT)
  // Right highlight
  fillRect(canvas, 31, 17, 1, 9, COLORS.GRAY_LIGHTEST)

  // Drawer lines
  fillRect(canvas, 2, 20, 28, 1, COLORS.GRAY_LIGHT)
  // Drawer handle
  fillRect(canvas, 14, 22, 4, 1, COLORS.GRAY)

  // Bottom shadow/edge
  fillRect(canvas, 0, 26, 32, 1, COLORS.GRAY_DARK)

  // Legs (subtle)
  fillRect(canvas, 2, 27, 3, 5, COLORS.GRAY_DARK)
  fillRect(canvas, 27, 27, 3, 5, COLORS.GRAY_DARK)
  // Leg highlights
  setPixel(canvas, 3, 27, COLORS.GRAY)
  setPixel(canvas, 28, 27, COLORS.GRAY)

  return canvas
}

function generateWoodenBookshelfSmall(): SpriteData {
  const canvas = createCanvas(32, 32);

  // Decorative molding on top
  fillRect(canvas, 0, 0, 32, 2, COLORS.WOOD_DARKEST);
  fillRect(canvas, 1, 2, 30, 1, COLORS.WOOD_DARK);

  // Main frame with wood tone
  fillRect(canvas, 2, 3, 28, 29, COLORS.WOOD_BASE);

  // Left and right sides (darker)
  fillRect(canvas, 2, 3, 2, 29, COLORS.WOOD_DARK);
  fillRect(canvas, 28, 3, 2, 29, COLORS.WOOD_DARK);

  // Right side highlight
  fillRect(canvas, 29, 3, 1, 29, COLORS.WOOD_DARKEST);

  // Interior back panel (darker)
  fillRect(canvas, 4, 5, 24, 26, COLORS.WOOD_DARKEST);

  // Shelves with brackets
  fillRect(canvas, 4, 11, 24, 2, COLORS.WOOD_LIGHT);
  fillRect(canvas, 4, 19, 24, 2, COLORS.WOOD_LIGHT);

  // Shelf shadows underneath
  fillRect(canvas, 4, 13, 24, 1, COLORS.WOOD_DARKEST);
  fillRect(canvas, 4, 21, 24, 1, COLORS.WOOD_DARKEST);

  // Shelf highlights on top
  fillRect(canvas, 4, 11, 24, 1, COLORS.WOOD_HIGHLIGHT);
  fillRect(canvas, 4, 19, 24, 1, COLORS.WOOD_HIGHLIGHT);

  // Visible shelf brackets
  fillRect(canvas, 5, 10, 1, 3, COLORS.METAL_DARK);
  fillRect(canvas, 26, 10, 1, 3, COLORS.METAL_DARK);
  fillRect(canvas, 5, 18, 1, 3, COLORS.METAL_DARK);
  fillRect(canvas, 26, 18, 1, 3, COLORS.METAL_DARK);

  // Wood grain pattern on frame
  setPixel(canvas, 3, 6, COLORS.WOOD_DARKEST);
  setPixel(canvas, 3, 8, COLORS.WOOD_DARKEST);
  setPixel(canvas, 3, 15, COLORS.WOOD_DARKEST);
  setPixel(canvas, 3, 17, COLORS.WOOD_DARKEST);
  setPixel(canvas, 3, 25, COLORS.WOOD_DARKEST);

  // Small plant on top shelf
  fillRect(canvas, 7, 14, 3, 4, COLORS.BROWN_BASE);
  setPixel(canvas, 8, 13, COLORS.LEAF_DARK);
  setPixel(canvas, 7, 14, COLORS.LEAF_BASE);
  setPixel(canvas, 9, 14, COLORS.LEAF_BASE);
  setPixel(canvas, 8, 15, COLORS.LEAF_LIGHT);

  // Photo frame on top shelf
  fillRect(canvas, 12, 14, 4, 5, COLORS.METAL_BASE);
  fillRect(canvas, 13, 15, 2, 3, COLORS.SKY_BLUE);
  setPixel(canvas, 13, 15, COLORS.CREAM);

  // Decorative box on middle shelf
  fillRect(canvas, 19, 22, 5, 4, COLORS.RED_DARK);
  fillRect(canvas, 20, 23, 3, 2, COLORS.RED);
  setPixel(canvas, 21, 22, COLORS.GOLD_FRAME);

  // Books on bottom shelf
  fillRect(canvas, 7, 22, 2, 9, COLORS.BLUE_DARK);
  fillRect(canvas, 9, 22, 2, 9, COLORS.GREEN_DARK);
  fillRect(canvas, 11, 24, 2, 7, COLORS.RED_DARK);
  fillRect(canvas, 13, 23, 2, 8, COLORS.PURPLE_DARK);

  // Book spines detail
  setPixel(canvas, 7, 25, COLORS.GOLD_FRAME);
  setPixel(canvas, 9, 26, COLORS.GOLD_FRAME);

  return canvas;
}

function generateFullWoodenBookshelfSmall(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Frame body
  fillRect(canvas, 0, 0, 32, 32, COLORS.WOOD_BASE)
  // Frame edge/shadow
  fillRect(canvas, 0, 0, 1, 32, COLORS.WOOD_DARK)
  fillRect(canvas, 31, 0, 1, 32, COLORS.WOOD_DARKEST)
  fillRect(canvas, 0, 0, 32, 1, COLORS.WOOD_LIGHT)
  fillRect(canvas, 0, 31, 32, 1, COLORS.WOOD_DARKEST)

  // Shelf boards (with thickness/shadow)
  for (const sy of [8, 18]) {
    fillRect(canvas, 1, sy, 30, 2, COLORS.WOOD_DARK)
    fillRect(canvas, 2, sy, 28, 1, COLORS.WOOD_SURFACE)
  }

  // Interior back (darker)
  fillRect(canvas, 2, 2, 28, 6, COLORS.WOOD_DARKEST)
  fillRect(canvas, 2, 10, 28, 8, COLORS.WOOD_DARKEST)
  fillRect(canvas, 2, 20, 28, 10, COLORS.WOOD_DARKEST)

  // Books on top shelf (varied heights and widths)
  const topBooks = [
    { x: 3, w: 2, h: 5, c: COLORS.RED, cd: COLORS.RED_DARK },
    { x: 6, w: 3, h: 6, c: COLORS.BLUE, cd: COLORS.BLUE_DARK },
    { x: 10, w: 2, h: 4, c: COLORS.YELLOW, cd: COLORS.YELLOW_DARK },
    { x: 13, w: 3, h: 6, c: COLORS.PURPLE, cd: COLORS.PURPLE_DARK },
    { x: 17, w: 2, h: 5, c: COLORS.TEAL, cd: COLORS.BLUE_DARK },
    { x: 20, w: 4, h: 6, c: COLORS.ORANGE, cd: COLORS.ORANGE_DARK },
    { x: 25, w: 2, h: 4, c: COLORS.RED, cd: COLORS.RED_DARK },
    { x: 28, w: 2, h: 5, c: COLORS.GREEN_ACCENT, cd: COLORS.GREEN_DARK },
  ]
  for (const b of topBooks) {
    fillRect(canvas, b.x, 8 - b.h, b.w, b.h, b.c)
    fillRect(canvas, b.x + b.w - 1, 8 - b.h, 1, b.h, b.cd)
  }

  // Books on middle shelf
  const midBooks = [
    { x: 2, w: 3, h: 7, c: COLORS.BLUE, cd: COLORS.BLUE_DARK },
    { x: 6, w: 2, h: 8, c: COLORS.RED, cd: COLORS.RED_DARK },
    { x: 9, w: 3, h: 6, c: COLORS.YELLOW, cd: COLORS.YELLOW_DARK },
    { x: 13, w: 2, h: 8, c: COLORS.GREEN_ACCENT, cd: COLORS.GREEN_DARK },
    { x: 16, w: 4, h: 7, c: COLORS.PURPLE, cd: COLORS.PURPLE_DARK },
    { x: 21, w: 2, h: 6, c: COLORS.ORANGE, cd: COLORS.ORANGE_DARK },
    { x: 24, w: 3, h: 8, c: COLORS.PINK, cd: COLORS.PURPLE_DARK },
    { x: 28, w: 2, h: 5, c: COLORS.TEAL, cd: COLORS.BLUE_DARK },
  ]
  for (const b of midBooks) {
    fillRect(canvas, b.x, 18 - b.h, b.w, b.h, b.c)
    fillRect(canvas, b.x + b.w - 1, 18 - b.h, 1, b.h, b.cd)
  }

  // Books on bottom shelf
  const botBooks = [
    { x: 2, w: 4, h: 9, c: COLORS.ORANGE, cd: COLORS.ORANGE_DARK },
    { x: 7, w: 2, h: 7, c: COLORS.BLUE, cd: COLORS.BLUE_DARK },
    { x: 10, w: 3, h: 10, c: COLORS.RED, cd: COLORS.RED_DARK },
    { x: 14, w: 2, h: 8, c: COLORS.TEAL, cd: COLORS.BLUE_DARK },
    { x: 17, w: 3, h: 9, c: COLORS.YELLOW, cd: COLORS.YELLOW_DARK },
    { x: 21, w: 2, h: 7, c: COLORS.PURPLE, cd: COLORS.PURPLE_DARK },
    { x: 24, w: 3, h: 10, c: COLORS.GREEN_ACCENT, cd: COLORS.GREEN_DARK },
    { x: 28, w: 2, h: 8, c: COLORS.PINK, cd: COLORS.PURPLE_DARK },
  ]
  for (const b of botBooks) {
    fillRect(canvas, b.x, 30 - b.h, b.w, b.h, b.c)
    fillRect(canvas, b.x + b.w - 1, 30 - b.h, 1, b.h, b.cd)
  }

  return canvas
}

function generateTableWoodLarge(): SpriteData {
  const canvas = createCanvas(32, 64);

  // Rich wood surface with visible plank lines
  fillRect(canvas, 2, 36, 28, 8, COLORS.WOOD_BASE);

  // Plank lines (3 planks)
  fillRect(canvas, 2, 39, 28, 1, COLORS.WOOD_DARK);
  fillRect(canvas, 2, 42, 28, 1, COLORS.WOOD_DARK);

  // Wood grain pattern
  setPixel(canvas, 5, 37, COLORS.WOOD_DARKEST);
  setPixel(canvas, 8, 38, COLORS.WOOD_DARKEST);
  setPixel(canvas, 12, 37, COLORS.WOOD_DARKEST);
  setPixel(canvas, 18, 38, COLORS.WOOD_DARKEST);
  setPixel(canvas, 23, 37, COLORS.WOOD_DARKEST);
  setPixel(canvas, 26, 38, COLORS.WOOD_DARKEST);

  setPixel(canvas, 6, 40, COLORS.WOOD_DARKEST);
  setPixel(canvas, 11, 41, COLORS.WOOD_DARKEST);
  setPixel(canvas, 16, 40, COLORS.WOOD_DARKEST);
  setPixel(canvas, 22, 41, COLORS.WOOD_DARKEST);
  setPixel(canvas, 27, 40, COLORS.WOOD_DARKEST);

  // Beveled edge on top surface
  fillRect(canvas, 1, 35, 30, 1, COLORS.WOOD_LIGHT);
  fillRect(canvas, 0, 36, 1, 8, COLORS.WOOD_LIGHT);
  fillRect(canvas, 31, 36, 1, 8, COLORS.WOOD_DARK);
  fillRect(canvas, 2, 44, 28, 1, COLORS.WOOD_DARKEST);

  // Top surface highlights
  fillRect(canvas, 3, 36, 26, 1, COLORS.WOOD_HIGHLIGHT);

  // Apron/skirt below table top
  fillRect(canvas, 3, 44, 26, 3, COLORS.WOOD_DARK);
  fillRect(canvas, 3, 44, 26, 1, COLORS.WOOD_BASE);
  fillRect(canvas, 3, 46, 26, 1, COLORS.WOOD_DARKEST);

  // Turned legs with decorative detail
  // Left leg
  fillRect(canvas, 6, 47, 4, 17, COLORS.WOOD_DARK);
  // Decorative turning at top
  fillRect(canvas, 5, 47, 6, 2, COLORS.WOOD_BASE);
  fillRect(canvas, 5, 49, 6, 1, COLORS.WOOD_DARKEST);
  // Middle turning
  fillRect(canvas, 5, 54, 6, 2, COLORS.WOOD_BASE);
  fillRect(canvas, 7, 55, 2, 1, COLORS.WOOD_DARKEST);
  // Foot
  fillRect(canvas, 5, 62, 6, 2, COLORS.WOOD_BASE);

  // Right leg
  fillRect(canvas, 22, 47, 4, 17, COLORS.WOOD_DARK);
  // Decorative turning at top
  fillRect(canvas, 21, 47, 6, 2, COLORS.WOOD_BASE);
  fillRect(canvas, 21, 49, 6, 1, COLORS.WOOD_DARKEST);
  // Middle turning
  fillRect(canvas, 21, 54, 6, 2, COLORS.WOOD_BASE);
  fillRect(canvas, 23, 55, 2, 1, COLORS.WOOD_DARKEST);
  // Foot
  fillRect(canvas, 21, 62, 6, 2, COLORS.WOOD_BASE);

  // 3D leg shading
  fillRect(canvas, 6, 50, 1, 12, COLORS.WOOD_LIGHT);
  fillRect(canvas, 9, 50, 1, 12, COLORS.WOOD_DARKEST);
  fillRect(canvas, 22, 50, 1, 12, COLORS.WOOD_LIGHT);
  fillRect(canvas, 25, 50, 1, 12, COLORS.WOOD_DARKEST);

  // Cross-bracing between legs
  fillRect(canvas, 10, 56, 12, 2, COLORS.WOOD_DARK);
  fillRect(canvas, 10, 56, 12, 1, COLORS.WOOD_BASE);
  fillRect(canvas, 10, 57, 12, 1, COLORS.WOOD_DARKEST);

  // Shadow underneath table
  fillRect(canvas, 8, 63, 16, 1, COLORS.SHADOW_DARK);

  return canvas;
}

function generateChairCushionedRight(): SpriteData {
  const canvas = createCanvas(16, 16)

  // Chair back (backrest visible from front)
  fillRect(canvas, 3, 2, 10, 4, COLORS.FRAME_BASE)
  fillRect(canvas, 4, 3, 8, 2, COLORS.CUSHION)
  fillRect(canvas, 4, 3, 8, 1, COLORS.CUSHION_LIGHT)
  fillRect(canvas, 3, 2, 10, 1, COLORS.FRAME_DARK)

  // Seat cushion
  fillRect(canvas, 3, 6, 10, 5, COLORS.FRAME_BASE)
  fillRect(canvas, 4, 7, 8, 3, COLORS.CUSHION)
  fillRect(canvas, 4, 7, 8, 1, COLORS.CUSHION_LIGHT)

  // Right armrest
  fillRect(canvas, 12, 4, 2, 7, COLORS.FRAME_DARK)
  setPixel(canvas, 12, 4, COLORS.FRAME_BASE)

  // Legs
  fillRect(canvas, 4, 11, 2, 4, COLORS.FRAME_DARKEST)
  fillRect(canvas, 10, 11, 2, 4, COLORS.FRAME_DARKEST)

  // Wheel dots
  setPixel(canvas, 4, 14, COLORS.GRAY_DARK)
  setPixel(canvas, 11, 14, COLORS.GRAY_DARK)

  return canvas
}

function generateChairCushionedLeft(): SpriteData {
  const canvas = createCanvas(16, 16)

  // Chair back
  fillRect(canvas, 3, 2, 10, 4, COLORS.FRAME_BASE)
  fillRect(canvas, 4, 3, 8, 2, COLORS.CUSHION)
  fillRect(canvas, 4, 3, 8, 1, COLORS.CUSHION_LIGHT)
  fillRect(canvas, 3, 2, 10, 1, COLORS.FRAME_DARK)

  // Seat cushion
  fillRect(canvas, 3, 6, 10, 5, COLORS.FRAME_BASE)
  fillRect(canvas, 4, 7, 8, 3, COLORS.CUSHION)
  fillRect(canvas, 4, 7, 8, 1, COLORS.CUSHION_LIGHT)

  // Left armrest
  fillRect(canvas, 2, 4, 2, 7, COLORS.FRAME_DARK)
  setPixel(canvas, 3, 4, COLORS.FRAME_BASE)

  // Legs
  fillRect(canvas, 4, 11, 2, 4, COLORS.FRAME_DARKEST)
  fillRect(canvas, 10, 11, 2, 4, COLORS.FRAME_DARKEST)

  // Wheel dots
  setPixel(canvas, 4, 14, COLORS.GRAY_DARK)
  setPixel(canvas, 11, 14, COLORS.GRAY_DARK)

  return canvas
}

function generateVendingMachine(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Metal body with shading
  fillRect(canvas, 0, 0, 32, 32, COLORS.METAL_BASE)
  fillRect(canvas, 0, 0, 1, 32, COLORS.METAL_LIGHT) // left highlight
  fillRect(canvas, 31, 0, 1, 32, COLORS.METAL_DARKEST) // right shadow
  fillRect(canvas, 0, 0, 32, 1, COLORS.METAL_HIGHLIGHT) // top highlight
  fillRect(canvas, 0, 31, 32, 1, COLORS.METAL_DARKEST) // bottom shadow

  // Display window with depth
  fillRect(canvas, 3, 3, 26, 16, COLORS.BLACK_SOFT)
  fillRect(canvas, 4, 4, 24, 14, COLORS.DISPLAY_BG)
  // Glass reflection
  fillRect(canvas, 5, 4, 2, 14, COLORS.DISPLAY_LIGHT)

  // Product rows (snacks/drinks)
  const productColors = [COLORS.RED, COLORS.YELLOW, COLORS.GREEN_ACCENT, COLORS.BLUE, COLORS.ORANGE, COLORS.PURPLE]
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 7 + col * 4
      const y = 5 + row * 4
      fillRect(canvas, x, y, 3, 3, productColors[(row * 5 + col) % productColors.length])
      // Shelf divider
      setPixel(canvas, x - 1, y + 3, COLORS.METAL_DARK)
    }
    // Shelf line
    fillRect(canvas, 5, 4 + (row + 1) * 4, 22, 1, COLORS.METAL_DARK)
  }

  // Control panel
  fillRect(canvas, 4, 20, 24, 10, COLORS.TECH_DARK)
  fillRect(canvas, 4, 20, 24, 1, COLORS.TECH_LIGHT)

  // Coin slot
  fillRect(canvas, 22, 22, 4, 2, COLORS.BLACK)
  setPixel(canvas, 23, 22, COLORS.METAL_DARK)

  // Buttons (with LED)
  for (let i = 0; i < 4; i++) {
    fillRect(canvas, 6 + i * 4, 23, 3, 2, COLORS.GRAY_LIGHT)
    setPixel(canvas, 7 + i * 4, 22, COLORS.LED_GREEN)
  }

  // Dispensing slot
  fillRect(canvas, 6, 27, 14, 3, COLORS.BLACK)
  fillRect(canvas, 7, 27, 12, 1, COLORS.METAL_DARKEST)

  return canvas
}

function generateFridge(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Main body with 3D shading
  fillRect(canvas, 0, 0, 16, 32, COLORS.WHITE);

  // Left highlight edge
  fillRect(canvas, 0, 1, 1, 30, COLORS.WHITE_BRIGHT);

  // Right shadow edge
  fillRect(canvas, 15, 1, 1, 30, COLORS.GRAY_LIGHT);

  // Top rounded corner suggestion via shading
  fillRect(canvas, 0, 0, 16, 1, COLORS.GRAY_LIGHT);
  setPixel(canvas, 0, 0, COLORS.GRAY_LIGHT);
  setPixel(canvas, 1, 0, COLORS.WHITE);
  setPixel(canvas, 14, 0, COLORS.WHITE);
  setPixel(canvas, 15, 0, COLORS.GRAY);

  // Bottom feet
  fillRect(canvas, 0, 31, 16, 1, COLORS.GRAY_DARKEST);
  setPixel(canvas, 1, 30, COLORS.GRAY_DARK);
  setPixel(canvas, 4, 30, COLORS.GRAY_DARK);
  setPixel(canvas, 11, 30, COLORS.GRAY_DARK);
  setPixel(canvas, 14, 30, COLORS.GRAY_DARK);

  // Freezer door top section (0-14)
  drawBorder(canvas, 1, 2, 14, 12, COLORS.GRAY_LIGHT);

  // Freezer magnetic seal
  fillRect(canvas, 2, 3, 12, 1, COLORS.GRAY);
  fillRect(canvas, 2, 13, 12, 1, COLORS.GRAY);

  // Freezer handle - metallic
  fillRect(canvas, 13, 6, 2, 4, COLORS.METAL_BASE);
  fillRect(canvas, 13, 6, 1, 4, COLORS.METAL_LIGHT);
  setPixel(canvas, 14, 9, COLORS.METAL_DARKEST);

  // Fridge door bottom section (15-29)
  drawBorder(canvas, 1, 16, 14, 13, COLORS.GRAY_LIGHT);

  // Fridge magnetic seal
  fillRect(canvas, 2, 17, 12, 1, COLORS.GRAY);
  fillRect(canvas, 2, 28, 12, 1, COLORS.GRAY);

  // Fridge handle - metallic
  fillRect(canvas, 13, 20, 2, 6, COLORS.METAL_BASE);
  fillRect(canvas, 13, 20, 1, 6, COLORS.METAL_LIGHT);
  setPixel(canvas, 14, 25, COLORS.METAL_DARKEST);

  // Temperature display LED (top right)
  fillRect(canvas, 11, 4, 2, 3, COLORS.BLACK_SOFT);
  setPixel(canvas, 11, 5, COLORS.LED_GREEN);
  setPixel(canvas, 12, 5, COLORS.LED_GREEN);

  // Brand logo area (top left)
  fillRect(canvas, 3, 5, 4, 2, COLORS.GRAY_LIGHT);

  // Interior glow hint along door edges
  setPixel(canvas, 2, 7, COLORS.SCREEN_GLOW);
  setPixel(canvas, 2, 22, COLORS.SCREEN_GLOW);

  return canvas;
}

function generateWaterCooler(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Base unit with ventilation
  fillRect(canvas, 2, 20, 12, 12, COLORS.GRAY);
  fillRect(canvas, 2, 20, 1, 12, COLORS.GRAY_LIGHT);
  fillRect(canvas, 13, 20, 1, 12, COLORS.GRAY_DARKEST);
  fillRect(canvas, 2, 20, 12, 1, COLORS.GRAY_LIGHT);
  fillRect(canvas, 2, 31, 12, 1, COLORS.GRAY_DARKEST);

  // Ventilation slots on base
  for (let y = 22; y < 30; y += 2) {
    fillRect(canvas, 4, y, 8, 1, COLORS.BLACK_SOFT);
  }

  // Drip tray
  fillRect(canvas, 3, 18, 10, 2, COLORS.METAL_BASE);
  fillRect(canvas, 3, 18, 10, 1, COLORS.METAL_LIGHT);
  setPixel(canvas, 12, 19, COLORS.METAL_DARKEST);

  // Tap indicators - hot (red) and cold (blue)
  fillRect(canvas, 4, 16, 2, 2, COLORS.RED);
  setPixel(canvas, 4, 16, COLORS.RED_DARK);
  fillRect(canvas, 10, 16, 2, 2, COLORS.BLUE);
  setPixel(canvas, 10, 16, COLORS.BLUE_DARK);

  // Tap spouts
  fillRect(canvas, 5, 17, 1, 2, COLORS.METAL_DARK);
  fillRect(canvas, 11, 17, 1, 2, COLORS.METAL_DARK);

  // Water jug support collar
  fillRect(canvas, 3, 14, 10, 2, COLORS.METAL_BASE);
  fillRect(canvas, 3, 14, 10, 1, COLORS.METAL_LIGHT);

  // Transparent water jug with 3D cylinder shading
  fillRect(canvas, 4, 2, 8, 12, COLORS.WATER_LIGHT);

  // Left highlight (cylinder edge)
  fillRect(canvas, 4, 2, 1, 12, COLORS.WHITE_BRIGHT);
  fillRect(canvas, 5, 2, 1, 12, COLORS.WATER_LIGHT);

  // Right shadow (cylinder edge)
  fillRect(canvas, 11, 2, 1, 12, COLORS.WATER_BLUE);

  // Water level with gradient
  fillRect(canvas, 5, 8, 6, 6, COLORS.WATER_BLUE);
  fillRect(canvas, 5, 8, 1, 6, COLORS.WATER_LIGHT);

  // Bubbles in water
  setPixel(canvas, 7, 4, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 9, 6, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 6, 10, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 10, 11, COLORS.WHITE_BRIGHT);

  // Jug cap
  fillRect(canvas, 5, 0, 6, 2, COLORS.BLUE);
  fillRect(canvas, 5, 0, 6, 1, COLORS.BLUE_DARK);
  fillRect(canvas, 7, 1, 2, 1, COLORS.BLUE_DARK);

  return canvas;
}

function generateBin(): SpriteData {
  const canvas = createCanvas(16, 16);

  // Tapered cylindrical body - wider at top
  fillRect(canvas, 2, 3, 12, 11, COLORS.METAL_BASE);
  fillRect(canvas, 3, 2, 10, 1, COLORS.METAL_BASE);
  fillRect(canvas, 4, 1, 8, 1, COLORS.METAL_BASE);
  fillRect(canvas, 3, 14, 10, 1, COLORS.METAL_BASE);

  // Cylindrical shading - left highlight
  fillRect(canvas, 2, 3, 1, 11, COLORS.METAL_LIGHT);
  fillRect(canvas, 3, 2, 1, 1, COLORS.METAL_LIGHT);
  fillRect(canvas, 4, 1, 1, 1, COLORS.METAL_LIGHT);
  fillRect(canvas, 3, 3, 1, 11, COLORS.METAL_HIGHLIGHT);

  // Cylindrical shading - right shadow
  fillRect(canvas, 13, 3, 1, 11, COLORS.METAL_DARKEST);
  fillRect(canvas, 12, 2, 1, 1, COLORS.METAL_DARKEST);
  fillRect(canvas, 11, 1, 1, 1, COLORS.METAL_DARKEST);
  fillRect(canvas, 12, 3, 1, 11, COLORS.METAL_DARK);

  // Metallic rim at top
  fillRect(canvas, 4, 0, 8, 1, COLORS.METAL_HIGHLIGHT);
  fillRect(canvas, 3, 1, 10, 1, COLORS.METAL_LIGHT);

  // Lid with handle
  fillRect(canvas, 5, 2, 6, 1, COLORS.METAL_DARK);
  setPixel(canvas, 7, 1, COLORS.METAL_DARKEST);
  setPixel(canvas, 8, 1, COLORS.METAL_DARKEST);

  // Visible trash - crumpled paper
  fillRect(canvas, 6, 5, 3, 3, COLORS.WHITE);
  setPixel(canvas, 6, 5, COLORS.GRAY_LIGHT);
  setPixel(canvas, 8, 7, COLORS.GRAY_LIGHT);
  setPixel(canvas, 9, 6, COLORS.YELLOW);
  setPixel(canvas, 10, 7, COLORS.YELLOW);

  // Foot ring at bottom
  fillRect(canvas, 3, 15, 10, 1, COLORS.METAL_DARKEST);
  setPixel(canvas, 2, 14, COLORS.METAL_DARKEST);
  setPixel(canvas, 13, 14, COLORS.METAL_DARKEST);

  return canvas;
}

function generateStool(): SpriteData {
  const canvas = createCanvas(16, 16);

  // Round seat with elliptical perspective
  fillRect(canvas, 2, 0, 12, 5, COLORS.WOOD_BASE);
  fillRect(canvas, 3, 0, 10, 1, COLORS.WOOD_LIGHT);
  fillRect(canvas, 1, 1, 14, 1, COLORS.WOOD_BASE);
  fillRect(canvas, 0, 2, 16, 2, COLORS.WOOD_BASE);

  // Wood grain rings on seat
  setPixel(canvas, 7, 2, COLORS.WOOD_DARK);
  setPixel(canvas, 8, 2, COLORS.WOOD_DARK);
  setPixel(canvas, 6, 3, COLORS.WOOD_DARK);
  setPixel(canvas, 9, 3, COLORS.WOOD_DARK);
  setPixel(canvas, 7, 3, COLORS.WOOD_DARKEST);
  setPixel(canvas, 8, 3, COLORS.WOOD_DARKEST);

  // Seat top highlight (3D)
  fillRect(canvas, 3, 0, 10, 1, COLORS.WOOD_SURFACE);

  // Seat bottom edge shadow
  fillRect(canvas, 1, 4, 14, 1, COLORS.WOOD_DARKEST);

  // Turned legs with lathe detail - left leg
  fillRect(canvas, 3, 5, 2, 10, COLORS.WOOD_BASE);
  fillRect(canvas, 3, 5, 1, 10, COLORS.WOOD_LIGHT);
  setPixel(canvas, 4, 7, COLORS.WOOD_DARK);
  setPixel(canvas, 4, 9, COLORS.WOOD_DARK);
  setPixel(canvas, 4, 11, COLORS.WOOD_DARK);

  // Turned legs - right leg
  fillRect(canvas, 11, 5, 2, 10, COLORS.WOOD_BASE);
  fillRect(canvas, 11, 5, 1, 10, COLORS.WOOD_SURFACE);
  setPixel(canvas, 11, 7, COLORS.WOOD_DARK);
  setPixel(canvas, 11, 9, COLORS.WOOD_DARK);
  setPixel(canvas, 11, 11, COLORS.WOOD_DARK);
  fillRect(canvas, 12, 5, 1, 10, COLORS.WOOD_DARKEST);

  // Cross-brace between legs
  fillRect(canvas, 5, 9, 6, 2, COLORS.WOOD_BASE);
  fillRect(canvas, 5, 9, 6, 1, COLORS.WOOD_LIGHT);
  fillRect(canvas, 5, 10, 6, 1, COLORS.WOOD_DARK);

  // Foot pads
  fillRect(canvas, 3, 15, 2, 1, COLORS.WOOD_DARKEST);
  fillRect(canvas, 11, 15, 2, 1, COLORS.WOOD_DARKEST);

  return canvas;
}

function generateCoffeeMug(): SpriteData {
  const canvas = createCanvas(16, 16);

  // Saucer
  fillRect(canvas, 2, 13, 12, 3, COLORS.WHITE);
  fillRect(canvas, 1, 14, 14, 1, COLORS.WHITE);
  fillRect(canvas, 2, 13, 12, 1, COLORS.WHITE_BRIGHT);
  fillRect(canvas, 2, 15, 12, 1, COLORS.GRAY_LIGHT);

  // Mug body - ceramic with glaze
  fillRect(canvas, 4, 6, 8, 7, COLORS.WHITE);
  fillRect(canvas, 5, 5, 6, 1, COLORS.WHITE);

  // Ceramic glaze highlight stripe
  fillRect(canvas, 4, 6, 1, 7, COLORS.WHITE_BRIGHT);
  fillRect(canvas, 5, 5, 1, 1, COLORS.WHITE_BRIGHT);

  // Ceramic shadow
  fillRect(canvas, 11, 6, 1, 7, COLORS.GRAY_LIGHT);
  fillRect(canvas, 10, 5, 1, 1, COLORS.GRAY_LIGHT);

  // Coffee surface with reflection
  fillRect(canvas, 5, 6, 6, 2, COLORS.BROWN_DARKEST);
  setPixel(canvas, 5, 6, COLORS.BROWN_DARK);
  setPixel(canvas, 6, 6, COLORS.BROWN_DARK);

  // Handle - thicker C-shape
  fillRect(canvas, 12, 7, 2, 5, COLORS.WHITE);
  fillRect(canvas, 13, 8, 1, 3, '');
  fillRect(canvas, 12, 7, 1, 5, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 13, 11, COLORS.GRAY_LIGHT);
  setPixel(canvas, 14, 11, COLORS.GRAY_LIGHT);

  // Steam wisps
  setPixel(canvas, 7, 3, COLORS.GRAY_LIGHTEST);
  setPixel(canvas, 6, 2, COLORS.GRAY_LIGHTEST);
  setPixel(canvas, 8, 1, COLORS.GRAY_LIGHTEST);
  setPixel(canvas, 9, 3, COLORS.GRAY_LIGHTEST);
  setPixel(canvas, 10, 2, COLORS.GRAY_LIGHTEST);

  // Subtle shadow under saucer
  fillRect(canvas, 3, 15, 10, 1, COLORS.GRAY);

  return canvas;
}

function generateTelephone(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Base unit with angle/tilt
  fillRect(canvas, 1, 14, 14, 18, COLORS.TECH_BASE);
  fillRect(canvas, 1, 14, 1, 18, COLORS.TECH_LIGHT);
  fillRect(canvas, 14, 14, 1, 18, COLORS.TECH_DARKEST);
  fillRect(canvas, 1, 14, 14, 1, COLORS.TECH_LIGHT);
  fillRect(canvas, 1, 31, 14, 1, COLORS.TECH_DARKEST);

  // LCD display with green glow
  fillRect(canvas, 3, 16, 10, 4, COLORS.BLACK_SOFT);
  fillRect(canvas, 4, 17, 8, 2, COLORS.SCREEN_DARK);
  setPixel(canvas, 5, 18, COLORS.LED_GREEN);
  setPixel(canvas, 7, 18, COLORS.LED_GREEN);
  setPixel(canvas, 9, 18, COLORS.LED_GREEN);

  // Number pad 4x3 grid
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const x = 4 + col * 3;
      const y = 22 + row * 2;
      fillRect(canvas, x, y, 2, 1, COLORS.GRAY);
      setPixel(canvas, x, y, COLORS.GRAY_LIGHT);
    }
  }

  // Speaker holes
  for (let i = 0; i < 5; i++) {
    setPixel(canvas, 3 + i * 2, 21, COLORS.BLACK_SOFT);
  }

  // Ring/mute LED
  setPixel(canvas, 2, 17, COLORS.LED_RED);

  // Curved handset on cradle
  fillRect(canvas, 3, 4, 10, 9, COLORS.TECH_DARK);
  fillRect(canvas, 4, 3, 8, 1, COLORS.TECH_DARK);
  fillRect(canvas, 4, 13, 8, 1, COLORS.TECH_DARK);

  // Handset shading
  fillRect(canvas, 3, 4, 1, 9, COLORS.TECH_LIGHT);
  fillRect(canvas, 12, 4, 1, 9, COLORS.TECH_DARKEST);
  fillRect(canvas, 4, 3, 8, 1, COLORS.TECH_LIGHT);

  // Handset speaker/mic areas
  fillRect(canvas, 5, 5, 2, 3, COLORS.BLACK_SOFT);
  fillRect(canvas, 9, 9, 2, 3, COLORS.BLACK_SOFT);

  // Coiled cord suggestion
  setPixel(canvas, 2, 10, COLORS.TECH_DARKEST);
  setPixel(canvas, 1, 11, COLORS.TECH_DARKEST);
  setPixel(canvas, 2, 12, COLORS.TECH_DARKEST);
  setPixel(canvas, 1, 13, COLORS.TECH_DARKEST);

  return canvas;
}

function generateBookSingleRed(): SpriteData {
  const canvas = createCanvas(16, 16);

  // Book cover with 3D thickness
  fillRect(canvas, 2, 2, 11, 12, COLORS.RED);

  // Cover texture and shading
  fillRect(canvas, 2, 2, 11, 1, COLORS.RED_DARK);
  fillRect(canvas, 2, 2, 1, 12, COLORS.RED_DARK);
  fillRect(canvas, 12, 3, 1, 11, COLORS.RED);

  // Spine with embossed title
  fillRect(canvas, 2, 2, 2, 12, COLORS.RED_DARK);
  setPixel(canvas, 3, 5, COLORS.GOLD_LIGHT);
  setPixel(canvas, 3, 6, COLORS.GOLD_LIGHT);
  setPixel(canvas, 3, 8, COLORS.GOLD_LIGHT);
  setPixel(canvas, 3, 9, COLORS.GOLD_LIGHT);

  // Page edges - layered white
  fillRect(canvas, 13, 3, 1, 11, COLORS.WHITE);
  fillRect(canvas, 13, 4, 1, 1, COLORS.CREAM);
  fillRect(canvas, 13, 6, 1, 1, COLORS.CREAM);
  fillRect(canvas, 13, 8, 1, 1, COLORS.CREAM);
  fillRect(canvas, 13, 10, 1, 1, COLORS.CREAM);
  fillRect(canvas, 13, 12, 1, 1, COLORS.CREAM);

  // Slightly open book angle - bottom pages showing
  fillRect(canvas, 3, 14, 11, 1, COLORS.WHITE);
  fillRect(canvas, 4, 15, 10, 1, COLORS.CREAM);

  // Bookmark ribbon peeking out
  setPixel(canvas, 8, 1, COLORS.BLUE);
  setPixel(canvas, 8, 2, COLORS.BLUE);

  // Gold/silver lettering on cover
  fillRect(canvas, 6, 6, 5, 1, COLORS.GOLD_FRAME);
  fillRect(canvas, 6, 8, 4, 1, COLORS.GOLD_FRAME);

  // Cover texture pattern
  setPixel(canvas, 5, 4, COLORS.RED_DARK);
  setPixel(canvas, 7, 11, COLORS.RED_DARK);
  setPixel(canvas, 10, 5, COLORS.RED_DARK);

  return canvas;
}

function generateClockWallWhite(): SpriteData {
  const canvas = createCanvas(16, 16);

  // Wall mounting shadow
  fillRect(canvas, 2, 1, 12, 1, COLORS.GRAY_LIGHT);

  // Chrome/silver rim - 2px
  fillRect(canvas, 2, 2, 12, 12, COLORS.METAL_HIGHLIGHT);
  fillRect(canvas, 3, 1, 10, 1, COLORS.METAL_LIGHT);
  fillRect(canvas, 1, 3, 1, 10, COLORS.METAL_LIGHT);
  fillRect(canvas, 14, 3, 1, 10, COLORS.METAL_BASE);
  fillRect(canvas, 3, 14, 10, 1, COLORS.METAL_BASE);

  // Inner rim
  fillRect(canvas, 3, 3, 10, 10, COLORS.METAL_BASE);

  // Clock face
  fillRect(canvas, 4, 4, 8, 8, COLORS.WHITE_BRIGHT);

  // Glass reflection
  setPixel(canvas, 5, 5, COLORS.SCREEN_GLOW);
  setPixel(canvas, 6, 5, COLORS.SCREEN_GLOW);
  setPixel(canvas, 5, 6, COLORS.SCREEN_GLOW);

  // All 12 hour markers
  setPixel(canvas, 8, 5, COLORS.BLACK_SOFT); // 12
  setPixel(canvas, 11, 8, COLORS.BLACK_SOFT); // 3
  setPixel(canvas, 8, 11, COLORS.BLACK_SOFT); // 6
  setPixel(canvas, 5, 8, COLORS.BLACK_SOFT); // 9
  setPixel(canvas, 10, 6, COLORS.BLACK_SOFT); // 2
  setPixel(canvas, 10, 10, COLORS.BLACK_SOFT); // 4
  setPixel(canvas, 6, 10, COLORS.BLACK_SOFT); // 8
  setPixel(canvas, 6, 6, COLORS.BLACK_SOFT); // 10

  // Center dot
  setPixel(canvas, 8, 8, COLORS.BLACK_SOFT);

  // Hour hand (pointing to 10)
  setPixel(canvas, 8, 8, COLORS.BLACK_PURE);
  setPixel(canvas, 7, 8, COLORS.BLACK_PURE);
  setPixel(canvas, 7, 7, COLORS.BLACK_PURE);

  // Minute hand (pointing to 2)
  setPixel(canvas, 8, 8, COLORS.BLACK_PURE);
  setPixel(canvas, 9, 7, COLORS.BLACK_PURE);
  setPixel(canvas, 10, 6, COLORS.BLACK_PURE);

  // Red second hand (pointing to 6)
  setPixel(canvas, 8, 8, COLORS.RED);
  setPixel(canvas, 8, 9, COLORS.RED);
  setPixel(canvas, 8, 10, COLORS.RED);

  // Brand dot at 6 o'clock position
  setPixel(canvas, 8, 10, COLORS.BLUE);

  return canvas;
}

function generateClockWallColor(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Crown molding top
  fillRect(canvas, 3, 0, 10, 2, COLORS.WOOD_SURFACE);
  fillRect(canvas, 2, 2, 12, 1, COLORS.WOOD_BASE);
  fillRect(canvas, 3, 0, 1, 2, COLORS.WOOD_HIGHLIGHT);
  fillRect(canvas, 12, 0, 1, 2, COLORS.WOOD_DARK);

  // Ornate wood casing
  fillRect(canvas, 2, 3, 12, 16, COLORS.WOOD_BASE);
  fillRect(canvas, 2, 3, 1, 16, COLORS.WOOD_LIGHT);
  fillRect(canvas, 13, 3, 1, 16, COLORS.WOOD_DARKEST);

  // Decorative wood carving pattern
  setPixel(canvas, 4, 4, COLORS.WOOD_DARK);
  setPixel(canvas, 11, 4, COLORS.WOOD_DARK);
  setPixel(canvas, 4, 17, COLORS.WOOD_DARK);
  setPixel(canvas, 11, 17, COLORS.WOOD_DARK);
  fillRect(canvas, 6, 4, 4, 1, COLORS.WOOD_DARKEST);

  // Clock face area
  fillRect(canvas, 4, 6, 8, 8, COLORS.CREAM);
  fillRect(canvas, 3, 7, 1, 6, COLORS.WOOD_DARK);
  fillRect(canvas, 12, 7, 1, 6, COLORS.WOOD_DARK);

  // Roman numeral hints
  setPixel(canvas, 8, 7, COLORS.BLACK_SOFT); // XII
  setPixel(canvas, 11, 10, COLORS.BLACK_SOFT); // III
  setPixel(canvas, 8, 13, COLORS.BLACK_SOFT); // VI
  setPixel(canvas, 5, 10, COLORS.BLACK_SOFT); // IX

  // Clock hands
  setPixel(canvas, 8, 10, COLORS.BLACK_PURE);
  setPixel(canvas, 8, 9, COLORS.BLACK_PURE);
  setPixel(canvas, 9, 10, COLORS.BLACK_PURE);

  // Glass door frame
  drawBorder(canvas, 3, 6, 10, 9, COLORS.WOOD_DARKEST);

  // Swinging pendulum below
  fillRect(canvas, 7, 20, 2, 1, COLORS.METAL_DARK);
  fillRect(canvas, 7, 21, 2, 6, COLORS.METAL_BASE);
  fillRect(canvas, 7, 21, 1, 6, COLORS.METAL_LIGHT);

  // Pendulum bob (disc)
  fillRect(canvas, 6, 27, 4, 3, COLORS.GOLD_FRAME);
  fillRect(canvas, 6, 27, 4, 1, COLORS.GOLD_LIGHT);
  fillRect(canvas, 6, 29, 4, 1, COLORS.WOOD_DARK);

  // Base
  fillRect(canvas, 2, 19, 12, 1, COLORS.WOOD_DARK);
  fillRect(canvas, 3, 31, 10, 1, COLORS.WOOD_DARKEST);

  return canvas;
}

function generateFullComputerCoffeeOff(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Monitor bezel (dark frame)
  fillRect(canvas, 7, 3, 18, 14, COLORS.TECH_DARK)
  drawBorder(canvas, 7, 3, 18, 14, COLORS.BLACK)
  // Monitor inner bezel highlight
  fillRect(canvas, 8, 4, 16, 1, COLORS.TECH_LIGHT)
  setPixel(canvas, 8, 5, COLORS.TECH_LIGHT)

  // Screen (glowing blue-ish)
  fillRect(canvas, 9, 5, 14, 10, COLORS.SCREEN_DARK)
  // Screen scanline effect / desktop
  fillRect(canvas, 10, 6, 12, 3, COLORS.SCREEN_BASE)
  fillRect(canvas, 10, 10, 12, 2, COLORS.SCREEN_DARK)
  // Window on screen
  fillRect(canvas, 11, 7, 6, 4, COLORS.SCREEN_LIGHT)
  fillRect(canvas, 11, 7, 6, 1, COLORS.SCREEN_BRIGHT)
  // Taskbar
  fillRect(canvas, 9, 13, 14, 1, COLORS.TECH_BASE)
  // Screen highlight (top-left)
  setPixel(canvas, 9, 5, COLORS.SCREEN_GLOW)

  // Monitor stand (thin neck + base)
  fillRect(canvas, 14, 17, 4, 2, COLORS.METAL_DARK)
  fillRect(canvas, 12, 19, 8, 1, COLORS.METAL_BASE)
  fillRect(canvas, 13, 19, 6, 1, COLORS.METAL_LIGHT)

  // Keyboard (detailed)
  fillRect(canvas, 7, 21, 16, 4, COLORS.GRAY_DARK)
  fillRect(canvas, 8, 21, 14, 3, COLORS.GRAY_LIGHT)
  drawBorder(canvas, 7, 21, 16, 4, COLORS.GRAY_DARKEST)
  // Key rows
  for (let x = 9; x < 21; x += 2) {
    setPixel(canvas, x, 22, COLORS.WHITE)
  }
  for (let x = 8; x < 22; x += 2) {
    setPixel(canvas, x, 23, COLORS.GRAY_LIGHTEST)
  }
  // Spacebar
  fillRect(canvas, 12, 24, 6, 0, COLORS.GRAY_LIGHTEST)

  // Mouse (right side)
  fillRect(canvas, 24, 22, 3, 4, COLORS.GRAY_LIGHT)
  setPixel(canvas, 25, 22, COLORS.WHITE)
  drawBorder(canvas, 24, 22, 3, 4, COLORS.GRAY_DARK)

  // Coffee mug (far right)
  fillRect(canvas, 27, 20, 4, 5, COLORS.WHITE)
  fillRect(canvas, 28, 21, 2, 3, COLORS.BROWN_BASE) // coffee
  drawBorder(canvas, 27, 20, 4, 5, COLORS.GRAY)
  // Handle
  setPixel(canvas, 31, 22, COLORS.GRAY)
  setPixel(canvas, 31, 23, COLORS.GRAY)
  // Steam
  setPixel(canvas, 28, 19, COLORS.GRAY_LIGHT)
  setPixel(canvas, 29, 18, COLORS.GRAY_LIGHT)

  return canvas
}

function generateLaptopLeft(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Screen section (top half)
  // Screen bezel
  fillRect(canvas, 2, 1, 12, 14, COLORS.BLACK_SOFT);
  fillRect(canvas, 2, 1, 1, 14, COLORS.BLACK_PURE);
  fillRect(canvas, 13, 1, 1, 14, COLORS.GRAY_DARKEST);

  // Active screen area with content
  fillRect(canvas, 3, 2, 10, 12, COLORS.SCREEN_BASE);

  // Screen content - code lines
  fillRect(canvas, 4, 3, 6, 1, COLORS.SCREEN_BRIGHT);
  fillRect(canvas, 4, 5, 8, 1, COLORS.SCREEN_LIGHT);
  fillRect(canvas, 4, 7, 5, 1, COLORS.SCREEN_BRIGHT);
  fillRect(canvas, 4, 9, 7, 1, COLORS.SCREEN_LIGHT);
  fillRect(canvas, 4, 11, 4, 1, COLORS.SCREEN_BRIGHT);

  // Webcam dot
  setPixel(canvas, 8, 2, COLORS.BLACK_PURE);

  // Screen edge lighting
  fillRect(canvas, 3, 2, 1, 12, COLORS.SCREEN_GLOW);

  // Hinge detail
  fillRect(canvas, 2, 15, 12, 1, COLORS.METAL_DARKEST);

  // Base/keyboard section
  fillRect(canvas, 0, 16, 16, 16, COLORS.METAL_BASE);
  fillRect(canvas, 0, 16, 1, 16, COLORS.METAL_LIGHT);
  fillRect(canvas, 15, 16, 1, 16, COLORS.METAL_DARKEST);
  fillRect(canvas, 0, 31, 16, 1, COLORS.METAL_DARKEST);

  // Keyboard rows
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      setPixel(canvas, 2 + col * 2, 18 + row * 3, COLORS.BLACK_SOFT);
      setPixel(canvas, 3 + col * 2, 18 + row * 3, COLORS.BLACK_SOFT);
    }
  }

  // Trackpad
  drawBorder(canvas, 5, 27, 6, 4, COLORS.METAL_DARK);

  // Power LED
  setPixel(canvas, 1, 17, COLORS.LED_GREEN);

  return canvas;
}

function generatePaperSide(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Multiple stacked sheets with offset edges
  // Bottom sheet
  fillRect(canvas, 2, 20, 12, 11, COLORS.WHITE);
  fillRect(canvas, 2, 20, 12, 1, COLORS.GRAY_LIGHTEST);
  fillRect(canvas, 2, 20, 1, 11, COLORS.GRAY_LIGHT);

  // Middle sheet
  fillRect(canvas, 3, 19, 11, 11, COLORS.WHITE);
  fillRect(canvas, 3, 19, 11, 1, COLORS.GRAY_LIGHTEST);

  // Top sheet
  fillRect(canvas, 4, 18, 10, 13, COLORS.WHITE);
  fillRect(canvas, 4, 18, 10, 1, COLORS.GRAY_LIGHTEST);
  fillRect(canvas, 4, 18, 1, 13, COLORS.GRAY_LIGHTEST);
  fillRect(canvas, 13, 18, 1, 13, COLORS.GRAY);
  fillRect(canvas, 4, 30, 10, 1, COLORS.GRAY);

  // Shadow between sheets
  setPixel(canvas, 2, 30, COLORS.GRAY_DARK);
  setPixel(canvas, 3, 29, COLORS.GRAY_DARK);

  // Header area
  fillRect(canvas, 5, 19, 8, 2, COLORS.GRAY_LIGHTEST);

  // Visible text lines with varying lengths
  fillRect(canvas, 5, 22, 7, 1, COLORS.BLACK_SOFT);
  fillRect(canvas, 5, 24, 8, 1, COLORS.BLACK_SOFT);
  fillRect(canvas, 5, 26, 6, 1, COLORS.BLACK_SOFT);
  fillRect(canvas, 5, 28, 7, 1, COLORS.BLACK_SOFT);

  // Paper clip
  fillRect(canvas, 11, 17, 2, 1, COLORS.METAL_LIGHT);
  fillRect(canvas, 11, 17, 1, 3, COLORS.METAL_LIGHT);
  fillRect(canvas, 12, 18, 1, 2, COLORS.METAL_BASE);
  setPixel(canvas, 12, 17, COLORS.METAL_HIGHLIGHT);

  // Slight curl on top corner
  setPixel(canvas, 13, 18, COLORS.GRAY_LIGHT);
  setPixel(canvas, 13, 19, '');

  return canvas;
}

function generatePaintingLandscape(): SpriteData {
  const canvas = createCanvas(32, 32);

  // Ornate gold frame with corner rosettes
  fillRect(canvas, 0, 0, 32, 32, COLORS.GOLD_FRAME);
  fillRect(canvas, 3, 3, 26, 26, COLORS.GOLD_LIGHT);
  fillRect(canvas, 5, 5, 22, 22, COLORS.CREAM);
  fillRect(canvas, 7, 7, 18, 18, COLORS.SKY_LIGHT);

  // Frame 3D shading - darker bottom-right
  fillRect(canvas, 1, 30, 30, 1, COLORS.WOOD_DARK);
  fillRect(canvas, 30, 1, 1, 30, COLORS.WOOD_DARK);
  fillRect(canvas, 1, 1, 30, 1, COLORS.GOLD_LIGHT);
  fillRect(canvas, 1, 1, 1, 30, COLORS.GOLD_LIGHT);

  // Corner rosettes
  fillRect(canvas, 1, 1, 2, 2, COLORS.WOOD_DARKEST);
  fillRect(canvas, 29, 1, 2, 2, COLORS.WOOD_DARKEST);
  fillRect(canvas, 1, 29, 2, 2, COLORS.WOOD_DARKEST);
  fillRect(canvas, 29, 29, 2, 2, COLORS.WOOD_DARKEST);

  // Landscape scene - warm sunset sky with gradient
  fillRect(canvas, 7, 7, 18, 7, COLORS.ORANGE);
  fillRect(canvas, 7, 10, 18, 4, COLORS.YELLOW);
  fillRect(canvas, 7, 14, 18, 3, COLORS.SKY_LIGHT);

  // Fluffy clouds
  setPixel(canvas, 9, 8, COLORS.WHITE);
  setPixel(canvas, 10, 8, COLORS.WHITE);
  setPixel(canvas, 9, 9, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 10, 9, COLORS.WHITE_BRIGHT);

  setPixel(canvas, 20, 9, COLORS.WHITE);
  setPixel(canvas, 21, 9, COLORS.WHITE);
  setPixel(canvas, 22, 9, COLORS.WHITE);
  setPixel(canvas, 21, 10, COLORS.WHITE_BRIGHT);

  // Distant mountains with purple shadows
  setPixel(canvas, 12, 15, COLORS.GRAY_DARK);
  setPixel(canvas, 13, 14, COLORS.GRAY);
  setPixel(canvas, 14, 13, COLORS.GRAY_LIGHT);
  setPixel(canvas, 15, 14, COLORS.GRAY);
  setPixel(canvas, 16, 15, COLORS.GRAY_DARK);

  setPixel(canvas, 18, 15, COLORS.PURPLE_DARK);
  setPixel(canvas, 19, 14, COLORS.PURPLE);
  setPixel(canvas, 20, 15, COLORS.PURPLE_DARK);

  // Rolling hills - grass meadow
  fillRect(canvas, 7, 16, 18, 2, COLORS.GRASS_GREEN);
  fillRect(canvas, 7, 18, 18, 7, COLORS.GREEN_BASE);

  // Hill contours
  setPixel(canvas, 9, 17, COLORS.GREEN_LIGHT);
  setPixel(canvas, 10, 17, COLORS.GREEN_LIGHT);
  setPixel(canvas, 11, 17, COLORS.GREEN_LIGHT);

  setPixel(canvas, 17, 17, COLORS.GREEN_DARK);
  setPixel(canvas, 18, 18, COLORS.GREEN_DARK);
  setPixel(canvas, 19, 17, COLORS.GREEN_DARK);

  // Winding path
  setPixel(canvas, 15, 24, COLORS.BROWN_LIGHT);
  setPixel(canvas, 16, 23, COLORS.BROWN_LIGHT);
  setPixel(canvas, 16, 22, COLORS.BROWN_BASE);
  setPixel(canvas, 17, 21, COLORS.BROWN_BASE);
  setPixel(canvas, 17, 20, COLORS.BROWN_DARK);
  setPixel(canvas, 18, 19, COLORS.BROWN_DARK);

  // Detailed tree with visible trunk texture
  fillRect(canvas, 11, 19, 2, 5, COLORS.BROWN_DARK);
  setPixel(canvas, 11, 20, COLORS.BROWN_DARKEST);
  setPixel(canvas, 12, 22, COLORS.BROWN_DARKEST);

  // Tree foliage with depth
  fillRect(canvas, 9, 17, 5, 3, COLORS.GREEN_DARK);
  fillRect(canvas, 10, 18, 3, 2, COLORS.GREEN_BASE);
  setPixel(canvas, 11, 17, COLORS.GREEN_LIGHT);
  setPixel(canvas, 12, 17, COLORS.GREEN_LIGHT);
  setPixel(canvas, 10, 19, COLORS.GREEN_BRIGHT);
  setPixel(canvas, 11, 19, COLORS.GREEN_BRIGHT);

  // Wildflowers in foreground
  setPixel(canvas, 9, 22, COLORS.YELLOW);
  setPixel(canvas, 13, 23, COLORS.RED);
  setPixel(canvas, 19, 21, COLORS.PINK);
  setPixel(canvas, 22, 23, COLORS.YELLOW);

  return canvas;
}

function generatePaintingLandscape2(): SpriteData {
  const canvas = createCanvas(32, 32);

  // Ornate gold frame matching painting1
  fillRect(canvas, 0, 0, 32, 32, COLORS.GOLD_FRAME);
  fillRect(canvas, 3, 3, 26, 26, COLORS.GOLD_LIGHT);
  fillRect(canvas, 5, 5, 22, 22, COLORS.CREAM);
  fillRect(canvas, 7, 7, 18, 18, COLORS.SKY_BLUE);

  // Frame 3D shading
  fillRect(canvas, 1, 30, 30, 1, COLORS.WOOD_DARK);
  fillRect(canvas, 30, 1, 1, 30, COLORS.WOOD_DARK);
  fillRect(canvas, 1, 1, 30, 1, COLORS.GOLD_LIGHT);
  fillRect(canvas, 1, 1, 1, 30, COLORS.GOLD_LIGHT);

  // Corner rosettes
  fillRect(canvas, 1, 1, 2, 2, COLORS.WOOD_DARKEST);
  fillRect(canvas, 29, 1, 2, 2, COLORS.WOOD_DARKEST);
  fillRect(canvas, 1, 29, 2, 2, COLORS.WOOD_DARKEST);
  fillRect(canvas, 29, 29, 2, 2, COLORS.WOOD_DARKEST);

  // Sky with wispy clouds
  fillRect(canvas, 7, 7, 18, 8, COLORS.SKY_LIGHT);
  setPixel(canvas, 10, 8, COLORS.WHITE);
  setPixel(canvas, 11, 8, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 12, 8, COLORS.WHITE);
  setPixel(canvas, 11, 9, COLORS.WHITE);

  setPixel(canvas, 19, 9, COLORS.WHITE);
  setPixel(canvas, 20, 9, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 21, 9, COLORS.WHITE);

  // Snow-capped mountain peaks with purple shadows
  // Left peak
  setPixel(canvas, 10, 15, COLORS.GRAY_DARK);
  setPixel(canvas, 11, 14, COLORS.GRAY);
  setPixel(canvas, 12, 13, COLORS.GRAY_LIGHT);
  setPixel(canvas, 13, 12, COLORS.WHITE);
  setPixel(canvas, 14, 11, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 15, 12, COLORS.WHITE);
  setPixel(canvas, 16, 13, COLORS.GRAY_LIGHT);
  setPixel(canvas, 17, 14, COLORS.GRAY);
  setPixel(canvas, 18, 15, COLORS.GRAY_DARK);

  // Purple shadow side
  setPixel(canvas, 15, 13, COLORS.PURPLE);
  setPixel(canvas, 16, 14, COLORS.PURPLE_DARK);
  setPixel(canvas, 17, 15, COLORS.PURPLE_DARK);

  // Right peak
  setPixel(canvas, 19, 14, COLORS.GRAY);
  setPixel(canvas, 20, 13, COLORS.GRAY_LIGHT);
  setPixel(canvas, 21, 12, COLORS.WHITE);
  setPixel(canvas, 22, 13, COLORS.PURPLE);
  setPixel(canvas, 23, 14, COLORS.PURPLE_DARK);

  // Lake/river in valley reflecting sky
  fillRect(canvas, 7, 16, 18, 3, COLORS.WATER_BLUE);
  setPixel(canvas, 12, 16, COLORS.WATER_LIGHT);
  setPixel(canvas, 13, 16, COLORS.WATER_LIGHT);
  setPixel(canvas, 17, 17, COLORS.WATER_LIGHT);
  setPixel(canvas, 18, 17, COLORS.WATER_LIGHT);

  // Pine forest silhouette
  fillRect(canvas, 7, 19, 18, 6, COLORS.GREEN_DARKEST);

  // Individual pine trees
  setPixel(canvas, 9, 18, COLORS.GREEN_DARK);
  setPixel(canvas, 10, 19, COLORS.GREEN_DARK);
  setPixel(canvas, 10, 20, COLORS.GREEN_DARK);

  setPixel(canvas, 13, 18, COLORS.GREEN_DARK);
  setPixel(canvas, 14, 19, COLORS.GREEN_DARK);

  setPixel(canvas, 18, 18, COLORS.GREEN_DARK);
  setPixel(canvas, 19, 19, COLORS.GREEN_DARK);

  setPixel(canvas, 21, 19, COLORS.GREEN_DARK);
  setPixel(canvas, 22, 20, COLORS.GREEN_DARK);

  // Wildflowers in foreground
  setPixel(canvas, 8, 23, COLORS.PURPLE);
  setPixel(canvas, 10, 22, COLORS.YELLOW);
  setPixel(canvas, 12, 24, COLORS.PINK);
  setPixel(canvas, 15, 23, COLORS.RED);
  setPixel(canvas, 18, 22, COLORS.YELLOW);
  setPixel(canvas, 20, 24, COLORS.PURPLE);
  setPixel(canvas, 23, 23, COLORS.PINK);

  return canvas;
}

function generateLaptopBack(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Lid/screen back
  fillRect(canvas, 2, 1, 12, 14, COLORS.METAL_BASE);
  fillRect(canvas, 2, 1, 1, 14, COLORS.METAL_LIGHT);
  fillRect(canvas, 13, 1, 1, 14, COLORS.METAL_DARKEST);
  fillRect(canvas, 2, 1, 12, 1, COLORS.METAL_LIGHT);

  // Subtle curvature shading
  fillRect(canvas, 3, 2, 10, 1, COLORS.METAL_LIGHT);
  fillRect(canvas, 3, 13, 10, 1, COLORS.METAL_DARK);

  // Apple-style glowing logo
  fillRect(canvas, 6, 5, 4, 5, COLORS.SCREEN_GLOW);
  setPixel(canvas, 7, 4, COLORS.SCREEN_BRIGHT);
  setPixel(canvas, 8, 4, COLORS.SCREEN_BRIGHT);
  setPixel(canvas, 6, 6, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 9, 6, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 7, 9, COLORS.SCREEN_GLOW);
  setPixel(canvas, 8, 9, COLORS.SCREEN_GLOW);

  // Hinge mechanism
  fillRect(canvas, 2, 15, 12, 1, COLORS.METAL_DARKEST);
  setPixel(canvas, 3, 15, COLORS.METAL_DARK);
  setPixel(canvas, 12, 15, COLORS.METAL_DARK);

  // Base back panel
  fillRect(canvas, 0, 16, 16, 16, COLORS.METAL_BASE);
  fillRect(canvas, 0, 16, 1, 16, COLORS.METAL_LIGHT);
  fillRect(canvas, 15, 16, 1, 16, COLORS.METAL_DARKEST);
  fillRect(canvas, 0, 31, 16, 1, COLORS.METAL_DARKEST);

  // Port details on back edge
  setPixel(canvas, 3, 17, COLORS.BLACK_SOFT);
  setPixel(canvas, 4, 17, COLORS.BLACK_SOFT);
  setPixel(canvas, 6, 17, COLORS.BLACK_SOFT);
  setPixel(canvas, 7, 17, COLORS.BLACK_SOFT);
  setPixel(canvas, 9, 17, COLORS.BLACK_SOFT);
  setPixel(canvas, 10, 17, COLORS.BLACK_SOFT);
  setPixel(canvas, 12, 17, COLORS.BLACK_SOFT);

  // Rubber feet dots on base
  setPixel(canvas, 2, 29, COLORS.BLACK_SOFT);
  setPixel(canvas, 13, 29, COLORS.BLACK_SOFT);

  // Status LED
  setPixel(canvas, 14, 18, COLORS.LED_GREEN);

  // Ventilation slots
  for (let x = 4; x < 12; x += 2) {
    setPixel(canvas, x, 25, COLORS.BLACK_SOFT);
  }

  return canvas;
}

function generateServer(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Server rack frame
  fillRect(canvas, 0, 16, 16, 16, COLORS.TECH_BASE)
  fillRect(canvas, 0, 16, 1, 16, COLORS.TECH_LIGHT) // left edge
  fillRect(canvas, 15, 16, 1, 16, COLORS.TECH_DARKEST) // right shadow
  fillRect(canvas, 0, 16, 16, 1, COLORS.METAL_DARK) // top rail
  fillRect(canvas, 0, 31, 16, 1, COLORS.TECH_DARKEST) // bottom

  // Three server units stacked
  for (let i = 0; i < 3; i++) {
    const y = 17 + i * 5
    fillRect(canvas, 1, y, 14, 4, COLORS.BLACK_SOFT)
    // Front bezel
    fillRect(canvas, 2, y, 12, 1, COLORS.TECH_DARK)

    // Status LEDs (animated look)
    setPixel(canvas, 2, y + 1, COLORS.LED_GREEN)
    setPixel(canvas, 4, y + 1, COLORS.LED_GREEN)
    setPixel(canvas, 6, y + 1, i === 1 ? COLORS.YELLOW : COLORS.LED_GREEN)

    // Drive bays (detailed)
    for (let x = 8; x < 14; x++) {
      setPixel(canvas, x, y + 1, COLORS.GRAY_DARKEST)
      setPixel(canvas, x, y + 2, COLORS.GRAY_DARK)
    }

    // Drive activity light
    setPixel(canvas, 13, y + 1, i === 0 ? COLORS.LED_GREEN : COLORS.GRAY_DARK)

    // Ventilation holes
    for (let x = 2; x < 7; x += 2) {
      setPixel(canvas, x, y + 3, COLORS.TECH_DARKEST)
    }
  }

  return canvas
}

function generateCrates3(): SpriteData {
  const canvas = createCanvas(32, 32);

  // Three wooden shipping crates stacked with 3D depth

  // Bottom crate (largest) - back crate
  fillRect(canvas, 2, 18, 12, 11, COLORS.BROWN_BASE);

  // Wood plank construction with gaps
  fillRect(canvas, 2, 20, 12, 1, COLORS.WOOD_DARKEST);
  fillRect(canvas, 2, 23, 12, 1, COLORS.WOOD_DARKEST);
  fillRect(canvas, 2, 26, 12, 1, COLORS.WOOD_DARKEST);

  // Vertical slats
  fillRect(canvas, 6, 18, 1, 11, COLORS.WOOD_DARK);
  fillRect(canvas, 10, 18, 1, 11, COLORS.WOOD_DARK);

  // 3D shading on bottom crate
  fillRect(canvas, 2, 18, 1, 11, COLORS.BROWN_LIGHT);
  fillRect(canvas, 13, 18, 1, 11, COLORS.BROWN_DARKEST);
  fillRect(canvas, 3, 28, 10, 1, COLORS.BROWN_DARKEST);

  // Visible nail heads on bottom crate
  setPixel(canvas, 3, 19, COLORS.METAL_DARKEST);
  setPixel(canvas, 12, 19, COLORS.METAL_DARKEST);
  setPixel(canvas, 3, 24, COLORS.METAL_DARKEST);
  setPixel(canvas, 12, 24, COLORS.METAL_DARKEST);
  setPixel(canvas, 3, 27, COLORS.METAL_DARKEST);
  setPixel(canvas, 12, 27, COLORS.METAL_DARKEST);

  // Metal corner reinforcements
  fillRect(canvas, 2, 18, 2, 2, COLORS.METAL_DARK);
  fillRect(canvas, 12, 18, 2, 2, COLORS.METAL_DARK);
  fillRect(canvas, 2, 27, 2, 2, COLORS.METAL_DARK);
  fillRect(canvas, 12, 27, 2, 2, COLORS.METAL_DARK);

  // Stenciled shipping mark (red rectangle suggesting "FRAGILE")
  fillRect(canvas, 5, 21, 6, 4, COLORS.RED);
  fillRect(canvas, 6, 22, 4, 2, COLORS.RED_DARK);

  // Middle crate - front left
  fillRect(canvas, 16, 14, 10, 9, COLORS.WOOD_BASE);

  // Wood tone variation
  fillRect(canvas, 16, 16, 10, 3, COLORS.WOOD_LIGHT);

  // Plank gaps
  fillRect(canvas, 16, 16, 10, 1, COLORS.WOOD_DARKEST);
  fillRect(canvas, 16, 19, 10, 1, COLORS.WOOD_DARKEST);

  // Vertical slats
  fillRect(canvas, 19, 14, 1, 9, COLORS.WOOD_DARK);
  fillRect(canvas, 23, 14, 1, 9, COLORS.WOOD_DARK);

  // 3D shading on middle crate
  fillRect(canvas, 16, 14, 1, 9, COLORS.WOOD_HIGHLIGHT);
  fillRect(canvas, 25, 14, 1, 9, COLORS.BROWN_DARKEST);
  fillRect(canvas, 17, 22, 8, 1, COLORS.BROWN_DARKEST);

  // Nail heads
  setPixel(canvas, 17, 15, COLORS.METAL_DARKEST);
  setPixel(canvas, 24, 15, COLORS.METAL_DARKEST);
  setPixel(canvas, 17, 20, COLORS.METAL_DARKEST);
  setPixel(canvas, 24, 20, COLORS.METAL_DARKEST);

  // Rope/twine on middle crate
  fillRect(canvas, 18, 14, 1, 9, COLORS.YELLOW_DARK);
  setPixel(canvas, 17, 16, COLORS.YELLOW_DARK);
  setPixel(canvas, 19, 17, COLORS.YELLOW_DARK);
  setPixel(canvas, 17, 18, COLORS.YELLOW_DARK);

  // Metal corners
  fillRect(canvas, 16, 14, 2, 2, COLORS.METAL_DARK);
  fillRect(canvas, 24, 14, 2, 2, COLORS.METAL_DARK);

  // Top crate - smallest, front right
  fillRect(canvas, 20, 6, 9, 8, COLORS.BROWN_DARK);

  // Plank construction
  fillRect(canvas, 20, 8, 9, 1, COLORS.WOOD_DARKEST);
  fillRect(canvas, 20, 11, 9, 1, COLORS.WOOD_DARKEST);

  // Vertical slats
  fillRect(canvas, 23, 6, 1, 8, COLORS.WOOD_DARKEST);
  fillRect(canvas, 26, 6, 1, 8, COLORS.WOOD_DARKEST);

  // 3D shading on top crate
  fillRect(canvas, 20, 6, 1, 8, COLORS.WOOD_LIGHT);
  fillRect(canvas, 28, 6, 1, 8, COLORS.BLACK_SOFT);
  fillRect(canvas, 21, 13, 7, 1, COLORS.BLACK_SOFT);

  // Nail heads
  setPixel(canvas, 21, 7, COLORS.METAL_DARKEST);
  setPixel(canvas, 27, 7, COLORS.METAL_DARKEST);
  setPixel(canvas, 21, 12, COLORS.METAL_DARKEST);
  setPixel(canvas, 27, 12, COLORS.METAL_DARKEST);

  // Stenciled mark (blue rectangle suggesting shipping code)
  fillRect(canvas, 22, 9, 4, 2, COLORS.BLUE_DARK);
  setPixel(canvas, 23, 9, COLORS.BLUE);
  setPixel(canvas, 24, 9, COLORS.BLUE);

  // Metal corners
  fillRect(canvas, 20, 6, 2, 2, COLORS.METAL_DARK);
  fillRect(canvas, 27, 6, 2, 2, COLORS.METAL_DARK);

  // Shadows between crates showing proper stacking
  fillRect(canvas, 14, 18, 2, 4, COLORS.SHADOW_DARK);
  fillRect(canvas, 26, 14, 3, 3, COLORS.SHADOW_DARK);

  // Floor shadow
  fillRect(canvas, 4, 29, 10, 1, COLORS.SHADOW_DARK);
  fillRect(canvas, 18, 23, 8, 1, COLORS.SHADOW_DARK);

  return canvas;
}

function generateWhitePlant2(): SpriteData {
  const canvas = createCanvas(16, 32)

  // White pot (tapered shape)
  fillRect(canvas, 5, 23, 6, 7, COLORS.WHITE)
  fillRect(canvas, 4, 23, 8, 1, COLORS.GRAY_LIGHTEST) // rim
  fillRect(canvas, 4, 23, 1, 7, COLORS.GRAY_LIGHT) // left edge
  fillRect(canvas, 11, 23, 1, 7, COLORS.GRAY) // right shadow
  fillRect(canvas, 5, 29, 6, 1, COLORS.GRAY) // bottom

  // Soil
  fillRect(canvas, 5, 24, 6, 1, COLORS.SOIL)

  // Central stem
  fillRect(canvas, 7, 15, 2, 9, COLORS.GREEN_DARK)

  // Leaves (organic shape, scattered)
  fillRect(canvas, 5, 16, 3, 2, COLORS.GREEN_BASE)
  fillRect(canvas, 9, 17, 3, 2, COLORS.GREEN_BASE)
  fillRect(canvas, 4, 18, 2, 2, COLORS.GREEN_LIGHT)
  fillRect(canvas, 10, 15, 2, 2, COLORS.GREEN_LIGHT)
  setPixel(canvas, 6, 14, COLORS.GREEN_BRIGHT)
  setPixel(canvas, 9, 14, COLORS.GREEN_BRIGHT)
  setPixel(canvas, 3, 19, COLORS.LEAF_LIGHT)
  setPixel(canvas, 12, 16, COLORS.LEAF_LIGHT)
  fillRect(canvas, 6, 20, 2, 2, COLORS.LEAF_BASE)
  fillRect(canvas, 9, 19, 2, 3, COLORS.LEAF_DARK)

  return canvas
}

function generateWhitePlant3(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Elegant ceramic pot with glazed shine
  fillRect(canvas, 3, 21, 10, 11, COLORS.WHITE);

  // Pot rim detail
  fillRect(canvas, 2, 21, 12, 2, COLORS.WHITE_BRIGHT);

  // Pot 3D shading
  fillRect(canvas, 3, 22, 1, 9, COLORS.WHITE_BRIGHT);
  fillRect(canvas, 12, 22, 1, 9, COLORS.GRAY_LIGHTEST);
  fillRect(canvas, 4, 31, 8, 1, COLORS.GRAY_LIGHT);

  // Glazed shine highlight
  setPixel(canvas, 5, 24, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 6, 24, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 5, 25, COLORS.WHITE_BRIGHT);

  // Visible soil with pebbles
  fillRect(canvas, 4, 21, 8, 2, COLORS.SOIL);
  setPixel(canvas, 5, 22, COLORS.GRAY);
  setPixel(canvas, 8, 22, COLORS.GRAY_LIGHT);
  setPixel(canvas, 10, 22, COLORS.GRAY);

  // Bushy plant with multiple stem branches
  // Main stems
  fillRect(canvas, 7, 18, 2, 4, COLORS.GREEN_DARK);
  setPixel(canvas, 6, 19, COLORS.GREEN_DARK);
  setPixel(canvas, 9, 19, COLORS.GREEN_DARK);
  setPixel(canvas, 5, 20, COLORS.GREEN_DARK);
  setPixel(canvas, 10, 20, COLORS.GREEN_DARK);

  // Left branch cluster
  fillRect(canvas, 3, 16, 3, 3, COLORS.GREEN_BASE);
  setPixel(canvas, 3, 15, COLORS.GREEN_LIGHT);
  setPixel(canvas, 4, 15, COLORS.GREEN_LIGHT);
  setPixel(canvas, 4, 14, COLORS.GREEN_BRIGHT);

  // Distinct leaf shapes at different angles
  setPixel(canvas, 2, 17, COLORS.LEAF_BASE);
  setPixel(canvas, 3, 17, COLORS.LEAF_LIGHT);
  setPixel(canvas, 4, 18, COLORS.LEAF_BASE);
  setPixel(canvas, 5, 17, COLORS.LEAF_LIGHT);

  // Center branch cluster
  fillRect(canvas, 6, 12, 4, 4, COLORS.GREEN_BASE);
  setPixel(canvas, 7, 11, COLORS.GREEN_LIGHT);
  setPixel(canvas, 8, 11, COLORS.GREEN_LIGHT);
  setPixel(canvas, 7, 10, COLORS.GREEN_BRIGHT);
  setPixel(canvas, 8, 10, COLORS.GREEN_BRIGHT);

  // Center leaves with variation
  setPixel(canvas, 6, 13, COLORS.LEAF_LIGHT);
  setPixel(canvas, 9, 13, COLORS.LEAF_LIGHT);
  setPixel(canvas, 6, 14, COLORS.LEAF_BASE);
  setPixel(canvas, 9, 14, COLORS.LEAF_BASE);

  // Right branch cluster
  fillRect(canvas, 10, 15, 3, 4, COLORS.GREEN_BASE);
  setPixel(canvas, 11, 14, COLORS.GREEN_LIGHT);
  setPixel(canvas, 12, 14, COLORS.GREEN_LIGHT);
  setPixel(canvas, 11, 13, COLORS.GREEN_BRIGHT);

  // Right leaves
  setPixel(canvas, 10, 16, COLORS.LEAF_BASE);
  setPixel(canvas, 13, 16, COLORS.LEAF_LIGHT);
  setPixel(canvas, 11, 17, COLORS.LEAF_BASE);

  // New growth tips in lighter green
  setPixel(canvas, 4, 13, COLORS.GREEN_BRIGHT);
  setPixel(canvas, 7, 9, COLORS.GREEN_BRIGHT);
  setPixel(canvas, 11, 12, COLORS.GREEN_BRIGHT);

  return canvas;
}

function generatePlant2(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Terracotta pot with pottery texture (horizontal rings)
  fillRect(canvas, 3, 22, 10, 10, COLORS.BROWN_BASE);

  // Pottery rings
  fillRect(canvas, 3, 22, 10, 1, COLORS.BROWN_LIGHT);
  fillRect(canvas, 3, 25, 10, 1, COLORS.BROWN_DARKEST);
  fillRect(canvas, 3, 28, 10, 1, COLORS.BROWN_DARK);
  fillRect(canvas, 3, 31, 10, 1, COLORS.BROWN_DARKEST);

  // Pot rim
  fillRect(canvas, 2, 22, 12, 2, COLORS.BROWN_LIGHT);

  // 3D pot shading
  fillRect(canvas, 3, 23, 1, 8, COLORS.BROWN_LIGHT);
  fillRect(canvas, 12, 23, 1, 8, COLORS.BROWN_DARKEST);

  // Richer soil texture with visible roots at soil line
  fillRect(canvas, 4, 22, 8, 2, COLORS.SOIL);
  setPixel(canvas, 5, 23, COLORS.BROWN_DARKEST);
  setPixel(canvas, 7, 23, COLORS.GREEN_DARKEST);
  setPixel(canvas, 9, 23, COLORS.GREEN_DARKEST);
  setPixel(canvas, 11, 23, COLORS.BROWN_DARKEST);

  // Multiple flowering stems at different heights
  // Left stem
  fillRect(canvas, 5, 15, 1, 8, COLORS.GREEN_DARK);
  setPixel(canvas, 4, 17, COLORS.LEAF_BASE);
  setPixel(canvas, 4, 19, COLORS.LEAF_BASE);

  // Center stem (tallest)
  fillRect(canvas, 8, 10, 1, 13, COLORS.GREEN_DARK);
  setPixel(canvas, 7, 13, COLORS.LEAF_BASE);
  setPixel(canvas, 9, 15, COLORS.LEAF_BASE);
  setPixel(canvas, 7, 18, COLORS.LEAF_LIGHT);
  setPixel(canvas, 9, 20, COLORS.LEAF_LIGHT);

  // Right stem
  fillRect(canvas, 11, 17, 1, 6, COLORS.GREEN_DARK);
  setPixel(canvas, 10, 18, COLORS.LEAF_BASE);
  setPixel(canvas, 12, 20, COLORS.LEAF_BASE);

  // Distinct flower shapes (petals around center)
  // Left flower
  setPixel(canvas, 5, 14, COLORS.PINK);
  setPixel(canvas, 4, 15, COLORS.PINK);
  setPixel(canvas, 6, 15, COLORS.PINK);
  setPixel(canvas, 5, 16, COLORS.PINK);
  setPixel(canvas, 5, 15, COLORS.YELLOW);

  // Center flowers (two blooms)
  setPixel(canvas, 8, 9, COLORS.RED);
  setPixel(canvas, 7, 10, COLORS.RED);
  setPixel(canvas, 9, 10, COLORS.RED);
  setPixel(canvas, 8, 11, COLORS.RED);
  setPixel(canvas, 8, 10, COLORS.YELLOW);

  setPixel(canvas, 8, 6, COLORS.PURPLE);
  setPixel(canvas, 7, 7, COLORS.PURPLE);
  setPixel(canvas, 9, 7, COLORS.PURPLE);
  setPixel(canvas, 8, 8, COLORS.PURPLE);
  setPixel(canvas, 8, 7, COLORS.YELLOW);

  // Right flower
  setPixel(canvas, 11, 16, COLORS.YELLOW);
  setPixel(canvas, 10, 17, COLORS.YELLOW);
  setPixel(canvas, 12, 17, COLORS.YELLOW);
  setPixel(canvas, 11, 18, COLORS.YELLOW);
  setPixel(canvas, 11, 17, COLORS.ORANGE);

  // Varied leaf sizes along stems
  setPixel(canvas, 6, 16, COLORS.LEAF_LIGHT);
  setPixel(canvas, 9, 12, COLORS.LEAF_LIGHT);
  setPixel(canvas, 10, 19, COLORS.LEAF_LIGHT);

  return canvas;
}

function generatePlant3(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Terracotta pot with subtle pattern
  fillRect(canvas, 3, 22, 10, 10, COLORS.BROWN_BASE);

  // Decorative band pattern
  fillRect(canvas, 3, 25, 10, 2, COLORS.BROWN_LIGHT);
  setPixel(canvas, 5, 26, COLORS.BROWN_DARK);
  setPixel(canvas, 7, 26, COLORS.BROWN_DARK);
  setPixel(canvas, 9, 26, COLORS.BROWN_DARK);
  setPixel(canvas, 11, 26, COLORS.BROWN_DARK);

  // Pot rim
  fillRect(canvas, 2, 22, 12, 2, COLORS.BROWN_LIGHT);

  // 3D pot shading
  fillRect(canvas, 3, 23, 1, 8, COLORS.BROWN_LIGHT);
  fillRect(canvas, 12, 23, 1, 8, COLORS.BROWN_DARKEST);
  fillRect(canvas, 4, 31, 8, 1, COLORS.BROWN_DARKEST);

  // Moss on soil surface
  fillRect(canvas, 4, 22, 8, 2, COLORS.SOIL);
  setPixel(canvas, 5, 23, COLORS.LEAF_DARK);
  setPixel(canvas, 7, 23, COLORS.LEAF_DARK);
  setPixel(canvas, 9, 23, COLORS.LEAF_DARK);

  // Tall fern main stem
  fillRect(canvas, 8, 8, 1, 15, COLORS.GREEN_DARKEST);

  // Arching fronds that droop naturally - left side
  // Top left frond
  setPixel(canvas, 7, 10, COLORS.GREEN_DARK);
  setPixel(canvas, 6, 11, COLORS.GREEN_DARK);
  setPixel(canvas, 5, 12, COLORS.GREEN_DARK);
  setPixel(canvas, 4, 13, COLORS.GREEN_DARK);

  // Individual leaf pairs along left frond
  setPixel(canvas, 6, 10, COLORS.LEAF_BASE);
  setPixel(canvas, 5, 11, COLORS.LEAF_BASE);
  setPixel(canvas, 4, 12, COLORS.LEAF_LIGHT);
  setPixel(canvas, 3, 13, COLORS.LEAF_LIGHT);

  // Middle left frond
  setPixel(canvas, 7, 14, COLORS.GREEN_DARK);
  setPixel(canvas, 6, 15, COLORS.GREEN_DARK);
  setPixel(canvas, 5, 16, COLORS.GREEN_DARK);

  setPixel(canvas, 6, 14, COLORS.LEAF_BASE);
  setPixel(canvas, 5, 15, COLORS.LEAF_BASE);
  setPixel(canvas, 4, 16, COLORS.LEAF_LIGHT);

  // Lower left frond
  setPixel(canvas, 7, 18, COLORS.GREEN_DARK);
  setPixel(canvas, 6, 19, COLORS.GREEN_DARK);
  setPixel(canvas, 5, 20, COLORS.GREEN_DARK);

  setPixel(canvas, 6, 18, COLORS.LEAF_BASE);
  setPixel(canvas, 5, 19, COLORS.LEAF_BASE);
  setPixel(canvas, 4, 20, COLORS.LEAF_BASE);

  // Arching fronds - right side
  // Top right frond
  setPixel(canvas, 9, 11, COLORS.GREEN_DARK);
  setPixel(canvas, 10, 12, COLORS.GREEN_DARK);
  setPixel(canvas, 11, 13, COLORS.GREEN_DARK);
  setPixel(canvas, 12, 14, COLORS.GREEN_DARK);

  setPixel(canvas, 10, 11, COLORS.LEAF_BASE);
  setPixel(canvas, 11, 12, COLORS.LEAF_BASE);
  setPixel(canvas, 12, 13, COLORS.LEAF_LIGHT);
  setPixel(canvas, 13, 14, COLORS.LEAF_LIGHT);

  // Middle right frond
  setPixel(canvas, 9, 15, COLORS.GREEN_DARK);
  setPixel(canvas, 10, 16, COLORS.GREEN_DARK);
  setPixel(canvas, 11, 17, COLORS.GREEN_DARK);

  setPixel(canvas, 10, 15, COLORS.LEAF_BASE);
  setPixel(canvas, 11, 16, COLORS.LEAF_BASE);
  setPixel(canvas, 12, 17, COLORS.LEAF_LIGHT);

  // Lower right frond
  setPixel(canvas, 9, 19, COLORS.GREEN_DARK);
  setPixel(canvas, 10, 20, COLORS.GREEN_DARK);
  setPixel(canvas, 11, 21, COLORS.GREEN_DARK);

  setPixel(canvas, 10, 19, COLORS.LEAF_BASE);
  setPixel(canvas, 11, 20, COLORS.LEAF_BASE);
  setPixel(canvas, 12, 21, COLORS.LEAF_BASE);

  // Unfurling fiddlehead at top
  setPixel(canvas, 8, 7, COLORS.GREEN_LIGHT);
  setPixel(canvas, 9, 8, COLORS.GREEN_BRIGHT);
  setPixel(canvas, 9, 9, COLORS.GREEN_BRIGHT);
  setPixel(canvas, 8, 9, COLORS.GREEN_LIGHT);
  setPixel(canvas, 7, 9, COLORS.GREEN_LIGHT);

  return canvas;
}

function generateTableWood(): SpriteData {
  const canvas = createCanvas(48, 32);

  // Wider table with multiple wood planks (5 planks with slight color variation)
  fillRect(canvas, 4, 12, 40, 6, COLORS.WOOD_BASE);

  // Plank color variations
  fillRect(canvas, 4, 12, 8, 6, COLORS.WOOD_BASE);
  fillRect(canvas, 12, 12, 8, 6, COLORS.WOOD_LIGHT);
  fillRect(canvas, 20, 12, 8, 6, COLORS.WOOD_BASE);
  fillRect(canvas, 28, 12, 8, 6, COLORS.WOOD_SURFACE);
  fillRect(canvas, 36, 12, 8, 6, COLORS.WOOD_BASE);

  // Plank seam lines
  fillRect(canvas, 11, 12, 1, 6, COLORS.WOOD_DARK);
  fillRect(canvas, 19, 12, 1, 6, COLORS.WOOD_DARK);
  fillRect(canvas, 27, 12, 1, 6, COLORS.WOOD_DARK);
  fillRect(canvas, 35, 12, 1, 6, COLORS.WOOD_DARK);

  // Visible wood knots
  setPixel(canvas, 8, 14, COLORS.WOOD_DARKEST);
  setPixel(canvas, 9, 14, COLORS.WOOD_DARK);
  setPixel(canvas, 8, 15, COLORS.WOOD_DARK);

  setPixel(canvas, 22, 15, COLORS.WOOD_DARKEST);
  setPixel(canvas, 23, 15, COLORS.WOOD_DARK);

  setPixel(canvas, 38, 13, COLORS.WOOD_DARKEST);
  setPixel(canvas, 39, 13, COLORS.WOOD_DARK);
  setPixel(canvas, 38, 14, COLORS.WOOD_DARK);

  // Breadboard ends
  fillRect(canvas, 2, 11, 44, 1, COLORS.WOOD_DARK);
  fillRect(canvas, 2, 18, 44, 1, COLORS.WOOD_DARK);

  // Surface highlights from overhead light
  fillRect(canvas, 5, 12, 38, 1, COLORS.WOOD_HIGHLIGHT);
  setPixel(canvas, 14, 13, COLORS.WOOD_HIGHLIGHT);
  setPixel(canvas, 23, 13, COLORS.WOOD_HIGHLIGHT);
  setPixel(canvas, 32, 13, COLORS.WOOD_HIGHLIGHT);

  // Front apron with decorative router edge
  fillRect(canvas, 6, 18, 36, 3, COLORS.WOOD_DARK);
  fillRect(canvas, 6, 18, 36, 1, COLORS.WOOD_BASE);
  // Decorative edge detail
  setPixel(canvas, 8, 20, COLORS.WOOD_DARKEST);
  setPixel(canvas, 16, 20, COLORS.WOOD_DARKEST);
  setPixel(canvas, 24, 20, COLORS.WOOD_DARKEST);
  setPixel(canvas, 32, 20, COLORS.WOOD_DARKEST);
  setPixel(canvas, 40, 20, COLORS.WOOD_DARKEST);

  // Better leg placement with stretcher bar
  // Left leg
  fillRect(canvas, 8, 21, 4, 11, COLORS.WOOD_DARK);
  fillRect(canvas, 8, 21, 1, 11, COLORS.WOOD_LIGHT);
  fillRect(canvas, 11, 21, 1, 11, COLORS.WOOD_DARKEST);

  // Right leg
  fillRect(canvas, 36, 21, 4, 11, COLORS.WOOD_DARK);
  fillRect(canvas, 36, 21, 1, 11, COLORS.WOOD_LIGHT);
  fillRect(canvas, 39, 21, 1, 11, COLORS.WOOD_DARKEST);

  // Stretcher bar connecting legs
  fillRect(canvas, 12, 26, 24, 2, COLORS.WOOD_DARK);
  fillRect(canvas, 12, 26, 24, 1, COLORS.WOOD_BASE);

  // Shadow under table
  fillRect(canvas, 10, 31, 28, 1, COLORS.SHADOW_DARK);

  return canvas;
}

function generateChairCushionedLargeRight(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Ergonomic office chair - padded headrest
  fillRect(canvas, 3, 2, 8, 3, COLORS.CUSHION);
  fillRect(canvas, 3, 2, 8, 1, COLORS.CUSHION_LIGHT);
  fillRect(canvas, 3, 4, 8, 1, COLORS.CUSHION_DARK);

  // Headrest fabric texture
  setPixel(canvas, 5, 3, COLORS.FABRIC_BASE);
  setPixel(canvas, 7, 3, COLORS.FABRIC_BASE);
  setPixel(canvas, 9, 3, COLORS.FABRIC_BASE);

  // Backrest with lumbar support bump
  fillRect(canvas, 3, 5, 8, 10, COLORS.CUSHION);

  // Lumbar support detail
  fillRect(canvas, 4, 10, 7, 3, COLORS.CUSHION_LIGHT);
  setPixel(canvas, 4, 11, COLORS.CUSHION);

  // Backrest 3D shading
  fillRect(canvas, 3, 5, 1, 10, COLORS.CUSHION_LIGHT);
  fillRect(canvas, 10, 5, 1, 10, COLORS.CUSHION_DARK);

  // Cushion seam lines
  fillRect(canvas, 3, 8, 8, 1, COLORS.FABRIC_DARK);
  fillRect(canvas, 3, 13, 8, 1, COLORS.FABRIC_DARK);

  // Seat cushion with seam detail
  fillRect(canvas, 2, 15, 10, 5, COLORS.CUSHION);
  fillRect(canvas, 2, 15, 10, 1, COLORS.CUSHION_LIGHT);
  fillRect(canvas, 2, 19, 10, 1, COLORS.CUSHION_DARK);

  // Seat seam line
  fillRect(canvas, 2, 17, 10, 1, COLORS.FABRIC_DARK);

  // Right armrest emphasized with padding on top
  fillRect(canvas, 11, 14, 4, 6, COLORS.FRAME_BASE);
  fillRect(canvas, 11, 14, 4, 2, COLORS.CUSHION_DARK);
  fillRect(canvas, 12, 14, 2, 1, COLORS.CUSHION_LIGHT);

  // Armrest 3D depth
  fillRect(canvas, 14, 15, 1, 5, COLORS.FRAME_DARKEST);

  // Left armrest (less emphasized)
  fillRect(canvas, 1, 15, 2, 5, COLORS.FRAME_BASE);
  fillRect(canvas, 1, 15, 2, 1, COLORS.CUSHION_DARK);

  // Gas cylinder
  fillRect(canvas, 6, 20, 3, 4, COLORS.METAL_BASE);
  fillRect(canvas, 6, 20, 1, 4, COLORS.METAL_LIGHT);
  fillRect(canvas, 8, 20, 1, 4, COLORS.METAL_DARK);

  // 5-star base with caster wheels (3 visible)
  // Center hub
  fillRect(canvas, 6, 24, 3, 2, COLORS.METAL_DARK);

  // Leg 1 (front left)
  fillRect(canvas, 4, 25, 3, 1, COLORS.METAL_BASE);
  fillRect(canvas, 3, 26, 2, 2, COLORS.METAL_DARKEST);
  setPixel(canvas, 3, 27, COLORS.BLACK);
  setPixel(canvas, 4, 27, COLORS.GRAY_DARK);

  // Leg 2 (front)
  fillRect(canvas, 6, 26, 3, 1, COLORS.METAL_BASE);
  fillRect(canvas, 6, 27, 3, 2, COLORS.METAL_DARKEST);
  setPixel(canvas, 7, 28, COLORS.BLACK);
  setPixel(canvas, 7, 29, COLORS.GRAY_DARK);

  // Leg 3 (front right)
  fillRect(canvas, 9, 25, 3, 1, COLORS.METAL_BASE);
  fillRect(canvas, 10, 26, 2, 2, COLORS.METAL_DARKEST);
  setPixel(canvas, 11, 27, COLORS.BLACK);
  setPixel(canvas, 11, 28, COLORS.GRAY_DARK);

  // Fabric texture suggestion on backrest
  setPixel(canvas, 5, 7, COLORS.FABRIC_BASE);
  setPixel(canvas, 7, 7, COLORS.FABRIC_BASE);
  setPixel(canvas, 9, 7, COLORS.FABRIC_BASE);
  setPixel(canvas, 5, 12, COLORS.FABRIC_BASE);
  setPixel(canvas, 7, 12, COLORS.FABRIC_BASE);
  setPixel(canvas, 9, 12, COLORS.FABRIC_BASE);

  return canvas;
}

function generateChairCushionedLargeLeft(): SpriteData {
  const canvas = createCanvas(16, 32);

  // Ergonomic office chair - padded headrest (mirrored)
  fillRect(canvas, 5, 2, 8, 3, COLORS.CUSHION);
  fillRect(canvas, 5, 2, 8, 1, COLORS.CUSHION_LIGHT);
  fillRect(canvas, 5, 4, 8, 1, COLORS.CUSHION_DARK);

  // Headrest fabric texture
  setPixel(canvas, 6, 3, COLORS.FABRIC_BASE);
  setPixel(canvas, 8, 3, COLORS.FABRIC_BASE);
  setPixel(canvas, 10, 3, COLORS.FABRIC_BASE);

  // Backrest with lumbar support bump
  fillRect(canvas, 5, 5, 8, 10, COLORS.CUSHION);

  // Lumbar support detail
  fillRect(canvas, 5, 10, 7, 3, COLORS.CUSHION_LIGHT);
  setPixel(canvas, 11, 11, COLORS.CUSHION);

  // Backrest 3D shading (mirrored)
  fillRect(canvas, 5, 5, 1, 10, COLORS.CUSHION_DARK);
  fillRect(canvas, 12, 5, 1, 10, COLORS.CUSHION_LIGHT);

  // Cushion seam lines
  fillRect(canvas, 5, 8, 8, 1, COLORS.FABRIC_DARK);
  fillRect(canvas, 5, 13, 8, 1, COLORS.FABRIC_DARK);

  // Seat cushion with seam detail
  fillRect(canvas, 4, 15, 10, 5, COLORS.CUSHION);
  fillRect(canvas, 4, 15, 10, 1, COLORS.CUSHION_LIGHT);
  fillRect(canvas, 4, 19, 10, 1, COLORS.CUSHION_DARK);

  // Seat seam line
  fillRect(canvas, 4, 17, 10, 1, COLORS.FABRIC_DARK);

  // Left armrest emphasized with padding on top
  fillRect(canvas, 1, 14, 4, 6, COLORS.FRAME_BASE);
  fillRect(canvas, 1, 14, 4, 2, COLORS.CUSHION_DARK);
  fillRect(canvas, 2, 14, 2, 1, COLORS.CUSHION_LIGHT);

  // Armrest 3D depth
  fillRect(canvas, 1, 15, 1, 5, COLORS.FRAME_DARKEST);

  // Right armrest (less emphasized)
  fillRect(canvas, 13, 15, 2, 5, COLORS.FRAME_BASE);
  fillRect(canvas, 13, 15, 2, 1, COLORS.CUSHION_DARK);

  // Gas cylinder
  fillRect(canvas, 7, 20, 3, 4, COLORS.METAL_BASE);
  fillRect(canvas, 7, 20, 1, 4, COLORS.METAL_LIGHT);
  fillRect(canvas, 9, 20, 1, 4, COLORS.METAL_DARK);

  // 5-star base with caster wheels (3 visible) - mirrored
  // Center hub
  fillRect(canvas, 7, 24, 3, 2, COLORS.METAL_DARK);

  // Leg 1 (front right)
  fillRect(canvas, 9, 25, 3, 1, COLORS.METAL_BASE);
  fillRect(canvas, 11, 26, 2, 2, COLORS.METAL_DARKEST);
  setPixel(canvas, 12, 27, COLORS.BLACK);
  setPixel(canvas, 11, 27, COLORS.GRAY_DARK);

  // Leg 2 (front)
  fillRect(canvas, 7, 26, 3, 1, COLORS.METAL_BASE);
  fillRect(canvas, 7, 27, 3, 2, COLORS.METAL_DARKEST);
  setPixel(canvas, 8, 28, COLORS.BLACK);
  setPixel(canvas, 8, 29, COLORS.GRAY_DARK);

  // Leg 3 (front left)
  fillRect(canvas, 5, 25, 3, 1, COLORS.METAL_BASE);
  fillRect(canvas, 4, 26, 2, 2, COLORS.METAL_DARKEST);
  setPixel(canvas, 4, 27, COLORS.BLACK);
  setPixel(canvas, 4, 28, COLORS.GRAY_DARK);

  // Fabric texture suggestion on backrest
  setPixel(canvas, 6, 7, COLORS.FABRIC_BASE);
  setPixel(canvas, 8, 7, COLORS.FABRIC_BASE);
  setPixel(canvas, 10, 7, COLORS.FABRIC_BASE);
  setPixel(canvas, 6, 12, COLORS.FABRIC_BASE);
  setPixel(canvas, 8, 12, COLORS.FABRIC_BASE);
  setPixel(canvas, 10, 12, COLORS.FABRIC_BASE);

  return canvas;
}

function generateCoffeeTableLarge(): SpriteData {
  const canvas = createCanvas(32, 32);

  // Mid-century modern wooden frame with rounded edges
  fillRect(canvas, 2, 14, 28, 6, COLORS.WOOD_BASE);

  // Rounded edge effect
  fillRect(canvas, 1, 15, 1, 4, COLORS.WOOD_DARK);
  fillRect(canvas, 30, 15, 1, 4, COLORS.WOOD_DARK);

  // Glass top effect with reflection highlight
  fillRect(canvas, 3, 13, 26, 2, COLORS.DISPLAY_BG);
  fillRect(canvas, 4, 13, 24, 1, COLORS.SCREEN_GLOW);

  // Glass reflection
  setPixel(canvas, 8, 14, COLORS.WHITE);
  setPixel(canvas, 9, 14, COLORS.WHITE_BRIGHT);
  setPixel(canvas, 21, 14, COLORS.WHITE);

  // Items on top - book
  fillRect(canvas, 6, 13, 6, 1, COLORS.RED_DARK);
  fillRect(canvas, 6, 12, 6, 1, COLORS.RED);

  // Coaster
  fillRect(canvas, 20, 12, 3, 3, COLORS.BROWN_LIGHT);
  fillRect(canvas, 21, 13, 1, 1, COLORS.BROWN_DARKEST);

  // Wood frame detail
  fillRect(canvas, 3, 14, 26, 1, COLORS.WOOD_LIGHT);
  fillRect(canvas, 3, 19, 26, 1, COLORS.WOOD_DARKEST);

  // Wood grain
  setPixel(canvas, 6, 16, COLORS.WOOD_DARKEST);
  setPixel(canvas, 12, 17, COLORS.WOOD_DARKEST);
  setPixel(canvas, 19, 16, COLORS.WOOD_DARKEST);
  setPixel(canvas, 25, 17, COLORS.WOOD_DARKEST);

  // Tapered legs (4 legs, mid-century style)
  // Front left leg
  fillRect(canvas, 5, 20, 3, 10, COLORS.WOOD_DARK);
  setPixel(canvas, 6, 29, COLORS.WOOD_DARK);
  setPixel(canvas, 6, 30, COLORS.WOOD_DARK);
  fillRect(canvas, 5, 20, 1, 10, COLORS.WOOD_LIGHT);
  fillRect(canvas, 7, 20, 1, 10, COLORS.WOOD_DARKEST);

  // Front right leg
  fillRect(canvas, 24, 20, 3, 10, COLORS.WOOD_DARK);
  setPixel(canvas, 25, 29, COLORS.WOOD_DARK);
  setPixel(canvas, 25, 30, COLORS.WOOD_DARK);
  fillRect(canvas, 24, 20, 1, 10, COLORS.WOOD_LIGHT);
  fillRect(canvas, 26, 20, 1, 10, COLORS.WOOD_DARKEST);

  // Back left leg
  fillRect(canvas, 8, 20, 2, 9, COLORS.WOOD_DARK);
  fillRect(canvas, 8, 20, 1, 9, COLORS.WOOD_LIGHT);

  // Back right leg
  fillRect(canvas, 22, 20, 2, 9, COLORS.WOOD_DARK);
  fillRect(canvas, 23, 20, 1, 9, COLORS.WOOD_DARKEST);

  // Magazine shelf underneath with visible magazine spines
  fillRect(canvas, 5, 24, 22, 2, COLORS.WOOD_DARK);
  fillRect(canvas, 5, 24, 22, 1, COLORS.WOOD_BASE);

  // Magazine spines
  fillRect(canvas, 7, 23, 2, 2, COLORS.BLUE_DARK);
  fillRect(canvas, 10, 23, 2, 2, COLORS.RED_DARK);
  fillRect(canvas, 13, 23, 3, 2, COLORS.GREEN_DARK);
  fillRect(canvas, 17, 23, 2, 2, COLORS.YELLOW_DARK);
  fillRect(canvas, 20, 23, 2, 2, COLORS.PURPLE_DARK);

  // Magazine detail lines
  setPixel(canvas, 8, 23, COLORS.WHITE);
  setPixel(canvas, 11, 23, COLORS.WHITE);
  setPixel(canvas, 14, 23, COLORS.WHITE);

  // Shadow on floor
  fillRect(canvas, 7, 31, 18, 1, COLORS.SHADOW_DARK);

  return canvas;
}

// ── Catalog Data ─────────────────────────────────────────────────────

interface AssetMetadata {
  id: string
  name: string
  label: string
  category: string
  paddedWidth: number
  paddedHeight: number
  footprintW: number
  footprintH: number
  isDesk: boolean
  backgroundTiles: number
  canPlaceOnSurfaces: boolean
  canPlaceOnWalls: boolean | null
  groupId: string | null
  orientation: string | null
  state: string | null
  generator: () => SpriteData
}

const ASSET_METADATA: AssetMetadata[] = [
  {
    id: 'ASSET_7',
    name: 'COUNTER_WHITE_SM',
    label: 'Small White Counter',
    category: 'desks',
    paddedWidth: 32,
    paddedHeight: 32,
    footprintW: 2,
    footprintH: 2,
    isDesk: true,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateCounterWhiteSmall,
  },
  {
    id: 'ASSET_17',
    name: 'WOODEN_BOOKSHELF_SMALL',
    label: 'Small Wooden Bookshelf',
    category: 'storage',
    paddedWidth: 32,
    paddedHeight: 32,
    footprintW: 2,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: null,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateWoodenBookshelfSmall,
  },
  {
    id: 'ASSET_18',
    name: 'FULL_WOODEN_BOOKSHELF_SMALL',
    label: 'Full Small Wooden Bookshelf',
    category: 'storage',
    paddedWidth: 32,
    paddedHeight: 32,
    footprintW: 2,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: null,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateFullWoodenBookshelfSmall,
  },
  {
    id: 'ASSET_27_A',
    name: 'TABLE_WOOD_LG',
    label: 'Large Table',
    category: 'desks',
    paddedWidth: 32,
    paddedHeight: 64,
    footprintW: 2,
    footprintH: 4,
    isDesk: true,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: null,
    groupId: 'TABLE_LG',
    orientation: 'front',
    state: null,
    generator: generateTableWoodLarge,
  },
  {
    id: 'ASSET_33',
    name: 'CHAIR_CUSHIONED_RIGHT',
    label: 'Cushioned Chair - Right',
    category: 'chairs',
    paddedWidth: 16,
    paddedHeight: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: null,
    groupId: 'CUSHIONED_CHAIR',
    orientation: 'right',
    state: null,
    generator: generateChairCushionedRight,
  },
  {
    id: 'ASSET_34',
    name: 'CHAIR_CUSHIONED_LEFT',
    label: 'Cushioned Chair - Left',
    category: 'chairs',
    paddedWidth: 16,
    paddedHeight: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: null,
    groupId: 'CUSHIONED_CHAIR',
    orientation: 'left',
    state: null,
    generator: generateChairCushionedLeft,
  },
  {
    id: 'ASSET_40',
    name: 'VENDING_MACHINE',
    label: 'Snack Vending Machine',
    category: 'misc',
    paddedWidth: 32,
    paddedHeight: 32,
    footprintW: 2,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: null,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateVendingMachine,
  },
  {
    id: 'ASSET_41_0_1',
    name: 'FRIDGE',
    label: 'Fridge',
    category: 'storage',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: null,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateFridge,
  },
  {
    id: 'ASSET_42',
    name: 'WATER_COOLER',
    label: 'Water Cooler',
    category: 'misc',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: null,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateWaterCooler,
  },
  {
    id: 'ASSET_44',
    name: 'BIN',
    label: 'Trash Bin',
    category: 'misc',
    paddedWidth: 16,
    paddedHeight: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateBin,
  },
  {
    id: 'ASSET_49',
    name: 'STOOL',
    label: 'Small Wooden Stool',
    category: 'chairs',
    paddedWidth: 16,
    paddedHeight: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: null,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateStool,
  },
  {
    id: 'ASSET_51',
    name: 'COFFEE_MUG',
    label: 'Coffee Mug',
    category: 'misc',
    paddedWidth: 16,
    paddedHeight: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: true,
    canPlaceOnWalls: false,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateCoffeeMug,
  },
  {
    id: 'ASSET_61',
    name: 'TELEPHONE',
    label: 'Telephone',
    category: 'electronics',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: true,
    canPlaceOnWalls: true,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateTelephone,
  },
  {
    id: 'ASSET_72',
    name: 'BOOK_SINGLE_RED',
    label: 'Small Book',
    category: 'decor',
    paddedWidth: 16,
    paddedHeight: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: true,
    canPlaceOnWalls: null,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateBookSingleRed,
  },
  {
    id: 'ASSET_83',
    name: 'CLOCK_WALL_WHITE',
    label: 'White Wall Clock',
    category: 'decor',
    paddedWidth: 16,
    paddedHeight: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateClockWallWhite,
  },
  {
    id: 'ASSET_84',
    name: 'CLOCK_WALL_COLOR',
    label: 'Colorful Wall Clock',
    category: 'wall',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: true,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateClockWallColor,
  },
  {
    id: 'ASSET_90',
    name: 'FULL_COMPUTER_COFFEE_OFF',
    label: 'Full Computer with Coffee',
    category: 'electronics',
    paddedWidth: 32,
    paddedHeight: 32,
    footprintW: 2,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: true,
    canPlaceOnWalls: false,
    groupId: 'FULL_COMPUTER_COFFEE',
    orientation: 'front',
    state: null,
    generator: generateFullComputerCoffeeOff,
  },
  {
    id: 'ASSET_99',
    name: 'LAPTOP_LEFT',
    label: 'Laptop - Left',
    category: 'electronics',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: true,
    canPlaceOnWalls: false,
    groupId: 'LAPTOP',
    orientation: 'left',
    state: null,
    generator: generateLaptopLeft,
  },
  {
    id: 'ASSET_100',
    name: 'PAPER_SIDE',
    label: 'Paper - Side',
    category: 'decor',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: true,
    canPlaceOnWalls: false,
    groupId: 'PAPER',
    orientation: 'front',
    state: null,
    generator: generatePaperSide,
  },
  {
    id: 'ASSET_101',
    name: 'PAINTING_LANDSCAPE',
    label: 'Landscape Painting',
    category: 'wall',
    paddedWidth: 32,
    paddedHeight: 32,
    footprintW: 2,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: true,
    groupId: null,
    orientation: null,
    state: null,
    generator: generatePaintingLandscape,
  },
  {
    id: 'ASSET_102',
    name: 'PAINTING_LANDSCAPE_2',
    label: 'Landscape Painting 2',
    category: 'wall',
    paddedWidth: 32,
    paddedHeight: 32,
    footprintW: 2,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: true,
    groupId: null,
    orientation: null,
    state: null,
    generator: generatePaintingLandscape2,
  },
  {
    id: 'ASSET_109',
    name: 'LAPTOP_BACK',
    label: 'Laptop - Back',
    category: 'electronics',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: true,
    canPlaceOnWalls: false,
    groupId: 'LAPTOP',
    orientation: 'back',
    state: null,
    generator: generateLaptopBack,
  },
  {
    id: 'ASSET_123',
    name: 'SERVER',
    label: 'Server',
    category: 'electronics',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: true,
    canPlaceOnWalls: false,
    groupId: 'PC',
    orientation: null,
    state: null,
    generator: generateServer,
  },
  {
    id: 'ASSET_139',
    name: 'CRATES_3',
    label: 'Crates',
    category: 'storage',
    paddedWidth: 32,
    paddedHeight: 32,
    footprintW: 2,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateCrates3,
  },
  {
    id: 'ASSET_140',
    name: 'WHITE_PLANT_2',
    label: 'Plant',
    category: 'decor',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: 'WHITE_PLANT',
    orientation: null,
    state: null,
    generator: generateWhitePlant2,
  },
  {
    id: 'ASSET_141',
    name: 'WHITE_PLANT_3',
    label: 'Plant',
    category: 'decor',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: 'WHITE_PLANT',
    orientation: null,
    state: null,
    generator: generateWhitePlant3,
  },
  {
    id: 'ASSET_142',
    name: 'PLANT_2',
    label: 'Plant',
    category: 'decor',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: 'WHITE_PLANT',
    orientation: null,
    state: null,
    generator: generatePlant2,
  },
  {
    id: 'ASSET_143',
    name: 'PLANT_3',
    label: 'Plant',
    category: 'decor',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: 'WHITE_PLANT',
    orientation: null,
    state: null,
    generator: generatePlant3,
  },
  {
    id: 'ASSET_NEW_106',
    name: 'TABLE_WOOD',
    label: 'Wooden Table',
    category: 'desks',
    paddedWidth: 48,
    paddedHeight: 32,
    footprintW: 3,
    footprintH: 2,
    isDesk: true,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateTableWood,
  },
  {
    id: 'ASSET_NEW_110',
    name: 'CHAIR_CUSHIONED_LG_RIGHT',
    label: 'Large Cushioned Chair - Right',
    category: 'chairs',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: 'CUSHIONED_CHAIR_LG',
    orientation: 'right',
    state: null,
    generator: generateChairCushionedLargeRight,
  },
  {
    id: 'ASSET_NEW_111',
    name: 'CHAIR_CUSHIONED_LG_LEFT',
    label: 'Large Cushioned Chair - Left',
    category: 'chairs',
    paddedWidth: 16,
    paddedHeight: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    backgroundTiles: 0,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: 'CUSHIONED_CHAIR_LG',
    orientation: 'left',
    state: null,
    generator: generateChairCushionedLargeLeft,
  },
  {
    id: 'ASSET_NEW_112',
    name: 'COFFEE_TABLE_LG',
    label: 'Large Coffee Table',
    category: 'desks',
    paddedWidth: 32,
    paddedHeight: 32,
    footprintW: 2,
    footprintH: 2,
    isDesk: true,
    backgroundTiles: 1,
    canPlaceOnSurfaces: false,
    canPlaceOnWalls: false,
    groupId: null,
    orientation: null,
    state: null,
    generator: generateCoffeeTableLarge,
  },
]

// ── Public API ───────────────────────────────────────────────────────

/**
 * Initializes the furniture catalog with all 32 procedurally-generated assets.
 * Builds the catalog metadata and sprites, then registers with the dynamic catalog system.
 * @returns true if successful, false otherwise
 */
export function initFurnitureCatalog(): boolean {
  try {
    // Build catalog entries
    const catalog = ASSET_METADATA.map((meta) => ({
      id: meta.id,
      label: meta.label,
      category: meta.category,
      width: meta.paddedWidth,
      height: meta.paddedHeight,
      footprintW: meta.footprintW,
      footprintH: meta.footprintH,
      isDesk: meta.isDesk,
      ...(meta.groupId ? { groupId: meta.groupId } : {}),
      ...(meta.orientation ? { orientation: meta.orientation } : {}),
      ...(meta.state ? { state: meta.state } : {}),
      ...(meta.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
      ...(meta.backgroundTiles ? { backgroundTiles: meta.backgroundTiles } : {}),
      ...(meta.canPlaceOnWalls ? { canPlaceOnWalls: true } : {}),
    }))

    // Generate sprites
    const sprites: Record<string, SpriteData> = {}
    for (const meta of ASSET_METADATA) {
      sprites[meta.id] = meta.generator()
    }

    // Build dynamic catalog
    const assetData: LoadedAssetData = { catalog, sprites }
    const success = buildDynamicCatalog(assetData)

    return success
  } catch (error) {
    console.error('Failed to initialize furniture catalog:', error)
    return false
  }
}
