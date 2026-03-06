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
  // Wood tones
  WOOD_DARK: '#6B4E0A',
  WOOD_BASE: '#8B6914',
  WOOD_LIGHT: '#A07828',
  WOOD_SURFACE: '#B8922E',

  // Metal/Gray
  METAL_DARK: '#5A5A6A',
  METAL_BASE: '#7A7A8A',
  METAL_LIGHT: '#9A9A9A',

  // White/Cream
  WHITE: '#E8E8E0',
  WHITE_BRIGHT: '#F8F8F8',
  CREAM: '#D8D8D8',
  GRAY_LIGHT: '#CCCCCC',
  GRAY: '#AAAAAA',
  GRAY_DARK: '#999999',

  // Electronics
  TECH_DARK: '#2A2A3A',
  TECH_BASE: '#3A3A4A',
  SCREEN_DARK: '#1A3A5A',
  SCREEN_LIGHT: '#3A7ABB',
  SCREEN_BRIGHT: '#5A9ADD',

  // Green/Plants
  GREEN_DARK: '#2D6B27',
  GREEN_BASE: '#3D8B37',
  GREEN_LIGHT: '#4DAA47',

  // Browns
  BROWN_DARK: '#5A3A1A',
  BROWN_BASE: '#8B4422',
  BROWN_LIGHT: '#AA6A3A',

  // Chair/Furniture
  FRAME_DARK: '#3A4A5C',
  FRAME_BASE: '#6B5B3A',
  CUSHION: '#4A7A8C',

  // Accent colors
  RED: '#CC3333',
  BLUE: '#3366CC',
  GREEN: '#33AA33',
  YELLOW: '#CC9933',
  ORANGE: '#DD7733',
  PURPLE: '#9966CC',

  // Display/Vending
  DISPLAY_BG: '#3A5A7A',
  WATER_BLUE: '#8ABACE',

  // Black
  BLACK: '#333333',
  BLACK_PURE: '#000000',

  // Landscape painting colors
  SKY_BLUE: '#5A7AAA',
  GRASS_GREEN: '#5A8A5A',
  GOLD_FRAME: '#B8922E',
}

// ── Sprite Generators ────────────────────────────────────────────────

function generateCounterWhiteSmall(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Background area (top half - items can go behind counter)
  fillRect(canvas, 0, 0, 32, 16, '')

  // Counter surface (white with gray edges)
  fillRect(canvas, 0, 16, 32, 12, COLORS.WHITE)
  drawBorder(canvas, 0, 16, 32, 12, COLORS.GRAY)

  // Add some detail lines for depth
  for (let x = 2; x < 30; x += 4) {
    setPixel(canvas, x, 18, COLORS.CREAM)
  }

  // Shadow/legs at bottom
  fillRect(canvas, 0, 28, 32, 4, COLORS.GRAY_DARK)

  return canvas
}

function generateWoodenBookshelfSmall(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Frame
  fillRect(canvas, 0, 0, 32, 32, COLORS.WOOD_BASE)
  drawBorder(canvas, 0, 0, 32, 32, COLORS.WOOD_DARK)

  // Empty shelves
  fillRect(canvas, 2, 8, 28, 2, COLORS.WOOD_DARK)
  fillRect(canvas, 2, 18, 28, 2, COLORS.WOOD_DARK)

  // Interior (empty)
  fillRect(canvas, 4, 4, 24, 4, COLORS.WOOD_LIGHT)
  fillRect(canvas, 4, 10, 24, 8, COLORS.WOOD_LIGHT)
  fillRect(canvas, 4, 20, 24, 8, COLORS.WOOD_LIGHT)

  return canvas
}

function generateFullWoodenBookshelfSmall(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Frame
  fillRect(canvas, 0, 0, 32, 32, COLORS.WOOD_BASE)
  drawBorder(canvas, 0, 0, 32, 32, COLORS.WOOD_DARK)

  // Shelves
  fillRect(canvas, 2, 8, 28, 2, COLORS.WOOD_DARK)
  fillRect(canvas, 2, 18, 28, 2, COLORS.WOOD_DARK)

  // Books on top shelf (colorful spines)
  const topShelfColors = [COLORS.RED, COLORS.BLUE, COLORS.GREEN, COLORS.YELLOW, COLORS.RED, COLORS.PURPLE]
  for (let i = 0; i < 6; i++) {
    fillRect(canvas, 4 + i * 4, 4, 3, 4, topShelfColors[i])
  }

  // Books on middle shelf
  const midShelfColors = [COLORS.BLUE, COLORS.GREEN, COLORS.YELLOW, COLORS.PURPLE, COLORS.RED, COLORS.BLUE]
  for (let i = 0; i < 6; i++) {
    fillRect(canvas, 4 + i * 4, 10, 3, 8, midShelfColors[i])
  }

  // Books on bottom shelf
  const botShelfColors = [COLORS.GREEN, COLORS.YELLOW, COLORS.RED, COLORS.BLUE, COLORS.PURPLE, COLORS.GREEN]
  for (let i = 0; i < 6; i++) {
    fillRect(canvas, 4 + i * 4, 20, 3, 8, botShelfColors[i])
  }

  return canvas
}

function generateTableWoodLarge(): SpriteData {
  const canvas = createCanvas(32, 64)

  // Background area (top portion - items behind table)
  fillRect(canvas, 0, 0, 32, 32, '')

  // Table surface (wood with darker edges)
  fillRect(canvas, 0, 32, 32, 24, COLORS.WOOD_SURFACE)
  drawBorder(canvas, 0, 32, 32, 24, COLORS.WOOD_DARK)

  // Wood grain detail
  for (let y = 34; y < 54; y += 4) {
    for (let x = 4; x < 28; x += 6) {
      setPixel(canvas, x, y, COLORS.WOOD_BASE)
      setPixel(canvas, x + 1, y, COLORS.WOOD_BASE)
    }
  }

  // Legs/shadow
  fillRect(canvas, 2, 56, 6, 8, COLORS.WOOD_DARK)
  fillRect(canvas, 24, 56, 6, 8, COLORS.WOOD_DARK)

  return canvas
}

function generateChairCushionedRight(): SpriteData {
  const canvas = createCanvas(16, 16)

  // Chair frame
  fillRect(canvas, 2, 2, 12, 12, COLORS.FRAME_BASE)

  // Cushion (right-facing)
  fillRect(canvas, 4, 4, 8, 8, COLORS.CUSHION)

  // Right-side armrest emphasis
  fillRect(canvas, 11, 5, 2, 6, COLORS.FRAME_DARK)

  // Shadow/depth
  drawBorder(canvas, 2, 2, 12, 12, COLORS.FRAME_DARK)

  return canvas
}

function generateChairCushionedLeft(): SpriteData {
  const canvas = createCanvas(16, 16)

  // Chair frame
  fillRect(canvas, 2, 2, 12, 12, COLORS.FRAME_BASE)

  // Cushion (left-facing)
  fillRect(canvas, 4, 4, 8, 8, COLORS.CUSHION)

  // Left-side armrest emphasis
  fillRect(canvas, 3, 5, 2, 6, COLORS.FRAME_DARK)

  // Shadow/depth
  drawBorder(canvas, 2, 2, 12, 12, COLORS.FRAME_DARK)

  return canvas
}

function generateVendingMachine(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Metal body
  fillRect(canvas, 0, 0, 32, 32, COLORS.METAL_BASE)
  drawBorder(canvas, 0, 0, 32, 32, COLORS.METAL_DARK)

  // Display window
  fillRect(canvas, 4, 4, 24, 16, COLORS.DISPLAY_BG)
  drawBorder(canvas, 4, 4, 24, 16, COLORS.BLACK)

  // Product rows (colorful items visible)
  const productColors = [COLORS.RED, COLORS.YELLOW, COLORS.GREEN, COLORS.BLUE, COLORS.ORANGE, COLORS.PURPLE]
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 6; col++) {
      const x = 6 + col * 4
      const y = 6 + row * 6
      fillRect(canvas, x, y, 2, 4, productColors[(row * 6 + col) % productColors.length])
    }
  }

  // Control panel
  fillRect(canvas, 6, 22, 20, 6, COLORS.TECH_DARK)

  // Buttons
  for (let i = 0; i < 5; i++) {
    fillRect(canvas, 8 + i * 4, 24, 2, 2, COLORS.GRAY_LIGHT)
  }

  return canvas
}

function generateFridge(): SpriteData {
  const canvas = createCanvas(16, 32)

  // White body
  fillRect(canvas, 0, 0, 16, 32, COLORS.WHITE)
  drawBorder(canvas, 0, 0, 16, 32, COLORS.GRAY_DARK)

  // Top freezer section
  fillRect(canvas, 1, 1, 14, 10, COLORS.CREAM)
  drawBorder(canvas, 2, 2, 12, 8, COLORS.GRAY)

  // Bottom fridge section
  fillRect(canvas, 1, 12, 14, 19, COLORS.CREAM)
  drawBorder(canvas, 2, 13, 12, 17, COLORS.GRAY)

  // Handles
  fillRect(canvas, 12, 5, 2, 3, COLORS.GRAY_DARK)
  fillRect(canvas, 12, 20, 2, 4, COLORS.GRAY_DARK)

  return canvas
}

function generateWaterCooler(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Base (gray)
  fillRect(canvas, 0, 20, 16, 12, COLORS.METAL_BASE)
  drawBorder(canvas, 0, 20, 16, 12, COLORS.METAL_DARK)

  // Water jug (light blue)
  fillRect(canvas, 2, 4, 12, 16, COLORS.WATER_BLUE)
  drawBorder(canvas, 2, 4, 12, 16, COLORS.DISPLAY_BG)

  // Water level (darker blue inside)
  fillRect(canvas, 4, 10, 8, 8, COLORS.DISPLAY_BG)

  // Cap on top
  fillRect(canvas, 4, 2, 8, 2, COLORS.GRAY_DARK)

  // Dispenser tap
  fillRect(canvas, 6, 22, 4, 2, COLORS.GRAY_DARK)

  return canvas
}

function generateBin(): SpriteData {
  const canvas = createCanvas(16, 16)

  // Cylindrical trash bin (dark gray)
  fillRect(canvas, 2, 2, 12, 12, COLORS.METAL_DARK)

  // Top rim
  fillRect(canvas, 1, 1, 14, 2, COLORS.GRAY)

  // Side highlights for cylindrical shape
  for (let y = 4; y < 12; y++) {
    setPixel(canvas, 3, y, COLORS.GRAY)
    setPixel(canvas, 12, y, COLORS.BLACK)
  }

  // Bottom shadow
  fillRect(canvas, 3, 13, 10, 1, COLORS.BLACK)

  return canvas
}

function generateStool(): SpriteData {
  const canvas = createCanvas(16, 16)

  // Wooden stool top
  fillRect(canvas, 2, 4, 12, 4, COLORS.WOOD_BASE)
  drawBorder(canvas, 2, 4, 12, 4, COLORS.WOOD_DARK)

  // Legs (four corners)
  fillRect(canvas, 3, 8, 2, 6, COLORS.WOOD_DARK)
  fillRect(canvas, 11, 8, 2, 6, COLORS.WOOD_DARK)

  // Crossbar for stability
  for (let x = 5; x < 11; x++) {
    setPixel(canvas, x, 11, COLORS.WOOD_DARK)
  }

  return canvas
}

function generateCoffeeMug(): SpriteData {
  const canvas = createCanvas(16, 16)

  // Mug body (white/cream)
  fillRect(canvas, 4, 6, 8, 6, COLORS.WHITE)
  drawBorder(canvas, 4, 6, 8, 6, COLORS.GRAY)

  // Coffee inside (brown)
  fillRect(canvas, 5, 7, 6, 3, COLORS.WOOD_BASE)

  // Handle
  setPixel(canvas, 12, 7, COLORS.GRAY)
  setPixel(canvas, 12, 8, COLORS.GRAY)
  setPixel(canvas, 12, 9, COLORS.GRAY)
  setPixel(canvas, 13, 8, COLORS.GRAY)

  // Steam (subtle)
  setPixel(canvas, 7, 4, COLORS.GRAY_LIGHT)
  setPixel(canvas, 9, 3, COLORS.GRAY_LIGHT)

  return canvas
}

function generateTelephone(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Base unit
  fillRect(canvas, 2, 20, 12, 10, COLORS.TECH_BASE)
  drawBorder(canvas, 2, 20, 12, 10, COLORS.TECH_DARK)

  // Number pad
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      setPixel(canvas, 4 + col * 3, 22 + row * 2, COLORS.GRAY_LIGHT)
    }
  }

  // Handset (on cradle)
  fillRect(canvas, 4, 16, 8, 3, COLORS.TECH_DARK)

  // Cord
  setPixel(canvas, 8, 19, COLORS.BLACK)

  return canvas
}

function generateBookSingleRed(): SpriteData {
  const canvas = createCanvas(16, 16)

  // Book (red cover, slightly tilted for visual interest)
  fillRect(canvas, 4, 6, 8, 6, COLORS.RED)
  drawBorder(canvas, 4, 6, 8, 6, COLORS.BROWN_DARK)

  // Pages (white edge)
  fillRect(canvas, 5, 11, 6, 1, COLORS.WHITE)

  // Title line on cover
  fillRect(canvas, 6, 8, 4, 1, COLORS.YELLOW)

  return canvas
}

function generateClockWallWhite(): SpriteData {
  const canvas = createCanvas(16, 16)

  // Clock face (circular white)
  fillRect(canvas, 4, 4, 8, 8, COLORS.WHITE)
  drawBorder(canvas, 4, 4, 8, 8, COLORS.BLACK)

  // Make it more circular
  setPixel(canvas, 4, 4, '')
  setPixel(canvas, 11, 4, '')
  setPixel(canvas, 4, 11, '')
  setPixel(canvas, 11, 11, '')

  // Hour marks (12, 3, 6, 9)
  setPixel(canvas, 8, 5, COLORS.BLACK)  // 12
  setPixel(canvas, 10, 8, COLORS.BLACK) // 3
  setPixel(canvas, 8, 10, COLORS.BLACK) // 6
  setPixel(canvas, 6, 8, COLORS.BLACK)  // 9

  // Clock hands (pointing to ~10:10)
  setPixel(canvas, 8, 8, COLORS.BLACK) // center
  setPixel(canvas, 7, 7, COLORS.BLACK) // hour hand
  setPixel(canvas, 9, 7, COLORS.BLACK) // minute hand
  setPixel(canvas, 9, 6, COLORS.BLACK)

  return canvas
}

function generateClockWallColor(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Decorative backing (tall)
  fillRect(canvas, 4, 4, 8, 24, COLORS.WOOD_BASE)
  drawBorder(canvas, 4, 4, 8, 24, COLORS.WOOD_DARK)

  // Clock face (colorful)
  fillRect(canvas, 5, 8, 6, 6, COLORS.YELLOW)
  drawBorder(canvas, 5, 8, 6, 6, COLORS.ORANGE)

  // Center
  setPixel(canvas, 8, 11, COLORS.BLACK)

  // Clock hands
  setPixel(canvas, 7, 10, COLORS.BLACK)
  setPixel(canvas, 9, 10, COLORS.BLACK)
  setPixel(canvas, 9, 9, COLORS.BLACK)

  // Decorative elements below
  fillRect(canvas, 6, 18, 4, 2, COLORS.RED)
  fillRect(canvas, 6, 22, 4, 2, COLORS.BLUE)

  return canvas
}

function generateFullComputerCoffeeOff(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Desk surface portion (top half is background)
  fillRect(canvas, 0, 0, 32, 16, '')

  // Monitor
  fillRect(canvas, 8, 4, 16, 12, COLORS.TECH_DARK)
  fillRect(canvas, 10, 6, 12, 8, COLORS.SCREEN_DARK) // Screen off
  drawBorder(canvas, 8, 4, 16, 12, COLORS.BLACK)

  // Monitor stand
  fillRect(canvas, 14, 16, 4, 2, COLORS.TECH_DARK)
  fillRect(canvas, 12, 18, 8, 2, COLORS.TECH_BASE)

  // Keyboard
  fillRect(canvas, 8, 20, 16, 4, COLORS.GRAY)
  drawBorder(canvas, 8, 20, 16, 4, COLORS.GRAY_DARK)

  // Keys
  for (let y = 21; y < 23; y++) {
    for (let x = 9; x < 23; x += 2) {
      setPixel(canvas, x, y, COLORS.WHITE)
    }
  }

  // Coffee mug (right side)
  fillRect(canvas, 24, 18, 6, 6, COLORS.WHITE)
  fillRect(canvas, 25, 19, 4, 3, COLORS.WOOD_BASE) // coffee
  drawBorder(canvas, 24, 18, 6, 6, COLORS.GRAY)

  return canvas
}

function generateLaptopLeft(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Background portion
  fillRect(canvas, 0, 0, 16, 16, '')

  // Laptop screen (angled left)
  fillRect(canvas, 2, 4, 12, 10, COLORS.TECH_DARK)
  fillRect(canvas, 4, 6, 8, 6, COLORS.SCREEN_DARK)
  drawBorder(canvas, 2, 4, 12, 10, COLORS.BLACK)

  // Laptop base/keyboard
  fillRect(canvas, 1, 16, 14, 6, COLORS.GRAY)
  drawBorder(canvas, 1, 16, 14, 6, COLORS.GRAY_DARK)

  // Keys
  for (let y = 17; y < 21; y += 2) {
    for (let x = 3; x < 13; x += 2) {
      setPixel(canvas, x, y, COLORS.WHITE)
    }
  }

  return canvas
}

function generatePaperSide(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Background portion
  fillRect(canvas, 0, 0, 16, 16, '')

  // Stack of papers
  fillRect(canvas, 3, 16, 10, 12, COLORS.WHITE)
  drawBorder(canvas, 3, 16, 10, 12, COLORS.GRAY)

  // Text lines
  for (let y = 18; y < 26; y += 2) {
    fillRect(canvas, 5, y, 6, 1, COLORS.GRAY)
  }

  // Shadow for depth
  fillRect(canvas, 4, 27, 10, 1, COLORS.GRAY_DARK)

  return canvas
}

function generatePaintingLandscape(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Gold frame
  drawBorder(canvas, 0, 0, 32, 32, COLORS.GOLD_FRAME)
  drawBorder(canvas, 1, 1, 30, 30, COLORS.GOLD_FRAME)

  // Sky (top half)
  fillRect(canvas, 3, 3, 26, 13, COLORS.SKY_BLUE)

  // Grass/ground (bottom half)
  fillRect(canvas, 3, 16, 26, 13, COLORS.GRASS_GREEN)

  // Simple landscape elements
  // Sun
  fillRect(canvas, 22, 6, 4, 4, COLORS.YELLOW)

  // Tree
  fillRect(canvas, 10, 18, 2, 6, COLORS.WOOD_DARK) // trunk
  fillRect(canvas, 8, 14, 6, 4, COLORS.GREEN_BASE) // foliage

  return canvas
}

function generatePaintingLandscape2(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Gold frame
  drawBorder(canvas, 0, 0, 32, 32, COLORS.GOLD_FRAME)
  drawBorder(canvas, 1, 1, 30, 30, COLORS.GOLD_FRAME)

  // Sky (top 2/3)
  fillRect(canvas, 3, 3, 26, 18, COLORS.SKY_BLUE)

  // Mountains (mid-ground)
  for (let x = 3; x < 29; x++) {
    const height = Math.abs(Math.sin(x * 0.5)) * 8
    fillRect(canvas, x, 14 + Math.floor(8 - height), 1, Math.ceil(height), COLORS.GRAY)
  }

  // Ground/field (bottom)
  fillRect(canvas, 3, 21, 26, 8, COLORS.GREEN_LIGHT)

  // Flowers (colorful dots)
  setPixel(canvas, 8, 24, COLORS.RED)
  setPixel(canvas, 12, 23, COLORS.YELLOW)
  setPixel(canvas, 18, 25, COLORS.PURPLE)
  setPixel(canvas, 22, 24, COLORS.ORANGE)

  return canvas
}

function generateLaptopBack(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Background portion
  fillRect(canvas, 0, 0, 16, 16, '')

  // Laptop back (closed or rear view)
  fillRect(canvas, 2, 8, 12, 8, COLORS.TECH_DARK)
  drawBorder(canvas, 2, 8, 12, 8, COLORS.BLACK)

  // Logo/brand mark
  fillRect(canvas, 6, 11, 4, 2, COLORS.GRAY_LIGHT)

  // Laptop base
  fillRect(canvas, 1, 16, 14, 6, COLORS.GRAY)
  drawBorder(canvas, 1, 16, 14, 6, COLORS.GRAY_DARK)

  // Vents/ports on back
  for (let x = 4; x < 12; x += 2) {
    setPixel(canvas, x, 18, COLORS.BLACK)
  }

  return canvas
}

function generateServer(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Background portion
  fillRect(canvas, 0, 0, 16, 16, '')

  // Server rack (dark metal)
  fillRect(canvas, 0, 16, 16, 16, COLORS.TECH_BASE)
  drawBorder(canvas, 0, 16, 16, 16, COLORS.TECH_DARK)

  // Three server units stacked
  for (let i = 0; i < 3; i++) {
    const y = 17 + i * 5
    fillRect(canvas, 1, y, 14, 4, COLORS.BLACK)

    // Status lights
    setPixel(canvas, 2, y + 1, COLORS.GREEN)
    setPixel(canvas, 4, y + 1, COLORS.GREEN)
    setPixel(canvas, 6, y + 1, COLORS.YELLOW)

    // Drive bay indicators
    for (let x = 9; x < 14; x += 2) {
      setPixel(canvas, x, y + 2, COLORS.GRAY)
    }
  }

  return canvas
}

function generateCrates3(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Three wooden crates stacked
  // Bottom left crate
  fillRect(canvas, 2, 18, 12, 12, COLORS.WOOD_BASE)
  drawBorder(canvas, 2, 18, 12, 12, COLORS.WOOD_DARK)

  // Wood slat details
  fillRect(canvas, 4, 20, 8, 1, COLORS.WOOD_DARK)
  fillRect(canvas, 4, 24, 8, 1, COLORS.WOOD_DARK)
  fillRect(canvas, 4, 28, 8, 1, COLORS.WOOD_DARK)

  // Top right crate
  fillRect(canvas, 16, 4, 12, 12, COLORS.WOOD_LIGHT)
  drawBorder(canvas, 16, 4, 12, 12, COLORS.WOOD_DARK)
  fillRect(canvas, 18, 6, 8, 1, COLORS.WOOD_DARK)
  fillRect(canvas, 18, 10, 8, 1, COLORS.WOOD_DARK)
  fillRect(canvas, 18, 14, 8, 1, COLORS.WOOD_DARK)

  // Middle crate (offset)
  fillRect(canvas, 10, 12, 10, 10, COLORS.WOOD_BASE)
  drawBorder(canvas, 10, 12, 10, 10, COLORS.WOOD_DARK)
  fillRect(canvas, 12, 14, 6, 1, COLORS.WOOD_DARK)
  fillRect(canvas, 12, 18, 6, 1, COLORS.WOOD_DARK)

  return canvas
}

function generateWhitePlant2(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Background portion
  fillRect(canvas, 0, 0, 16, 16, '')

  // White pot
  fillRect(canvas, 4, 22, 8, 8, COLORS.WHITE)
  drawBorder(canvas, 4, 22, 8, 8, COLORS.GRAY)

  // Soil
  fillRect(canvas, 5, 23, 6, 2, COLORS.BROWN_DARK)

  // Plant leaves (sparse, upward)
  fillRect(canvas, 7, 16, 2, 6, COLORS.GREEN_BASE)
  fillRect(canvas, 5, 18, 2, 4, COLORS.GREEN_LIGHT)
  fillRect(canvas, 9, 18, 2, 4, COLORS.GREEN_LIGHT)
  setPixel(canvas, 6, 16, COLORS.GREEN_BASE)
  setPixel(canvas, 9, 16, COLORS.GREEN_BASE)

  return canvas
}

function generateWhitePlant3(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Background portion
  fillRect(canvas, 0, 0, 16, 16, '')

  // White pot
  fillRect(canvas, 4, 22, 8, 8, COLORS.CREAM)
  drawBorder(canvas, 4, 22, 8, 8, COLORS.GRAY)

  // Soil
  fillRect(canvas, 5, 23, 6, 2, COLORS.BROWN_DARK)

  // Bushier plant (more leaves)
  fillRect(canvas, 7, 14, 2, 8, COLORS.GREEN_BASE) // center stem

  // Multiple leaf clusters
  fillRect(canvas, 5, 16, 2, 3, COLORS.GREEN_DARK)
  fillRect(canvas, 9, 16, 2, 3, COLORS.GREEN_DARK)
  fillRect(canvas, 6, 14, 4, 2, COLORS.GREEN_LIGHT)
  fillRect(canvas, 4, 19, 3, 2, COLORS.GREEN_BASE)
  fillRect(canvas, 9, 19, 3, 2, COLORS.GREEN_BASE)

  return canvas
}

function generatePlant2(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Background portion
  fillRect(canvas, 0, 0, 16, 16, '')

  // Terra cotta pot (brown/orange)
  fillRect(canvas, 4, 22, 8, 8, COLORS.BROWN_BASE)
  drawBorder(canvas, 4, 22, 8, 8, COLORS.BROWN_DARK)

  // Soil
  fillRect(canvas, 5, 23, 6, 2, COLORS.BROWN_DARK)

  // Flowering plant
  fillRect(canvas, 7, 18, 2, 4, COLORS.GREEN_BASE) // stem

  // Flowers (colorful tops)
  setPixel(canvas, 6, 16, COLORS.RED)
  setPixel(canvas, 7, 15, COLORS.RED)
  setPixel(canvas, 8, 16, COLORS.RED)

  setPixel(canvas, 9, 17, COLORS.YELLOW)
  setPixel(canvas, 5, 19, COLORS.PURPLE)

  // Leaves
  fillRect(canvas, 5, 20, 2, 2, COLORS.GREEN_DARK)
  fillRect(canvas, 9, 20, 2, 2, COLORS.GREEN_DARK)

  return canvas
}

function generatePlant3(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Background portion
  fillRect(canvas, 0, 0, 16, 16, '')

  // Terra cotta pot
  fillRect(canvas, 4, 22, 8, 8, COLORS.BROWN_LIGHT)
  drawBorder(canvas, 4, 22, 8, 8, COLORS.BROWN_DARK)

  // Soil
  fillRect(canvas, 5, 23, 6, 2, COLORS.BROWN_DARK)

  // Tall leafy plant (fern-like)
  fillRect(canvas, 7, 12, 2, 10, COLORS.GREEN_BASE) // main stem

  // Fronds spreading out
  for (let y = 14; y < 22; y += 2) {
    setPixel(canvas, 5, y, COLORS.GREEN_LIGHT)
    setPixel(canvas, 6, y, COLORS.GREEN_DARK)
    setPixel(canvas, 9, y, COLORS.GREEN_DARK)
    setPixel(canvas, 10, y, COLORS.GREEN_LIGHT)
  }

  return canvas
}

function generateTableWood(): SpriteData {
  const canvas = createCanvas(48, 32)

  // Background area (top portion)
  fillRect(canvas, 0, 0, 48, 8, '')

  // Table surface (wide wooden table)
  fillRect(canvas, 0, 8, 48, 18, COLORS.WOOD_SURFACE)
  drawBorder(canvas, 0, 8, 48, 18, COLORS.WOOD_DARK)

  // Wood grain patterns
  for (let y = 10; y < 24; y += 3) {
    for (let x = 4; x < 44; x += 8) {
      fillRect(canvas, x, y, 4, 1, COLORS.WOOD_BASE)
    }
  }

  // Legs
  fillRect(canvas, 4, 26, 4, 6, COLORS.WOOD_DARK)
  fillRect(canvas, 20, 26, 4, 6, COLORS.WOOD_DARK)
  fillRect(canvas, 40, 26, 4, 6, COLORS.WOOD_DARK)

  return canvas
}

function generateChairCushionedLargeRight(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Chair back (tall)
  fillRect(canvas, 2, 4, 12, 12, COLORS.FRAME_BASE)
  drawBorder(canvas, 2, 4, 12, 12, COLORS.FRAME_DARK)

  // Cushioned back
  fillRect(canvas, 4, 6, 8, 8, COLORS.CUSHION)

  // Seat
  fillRect(canvas, 2, 16, 12, 8, COLORS.FRAME_BASE)
  drawBorder(canvas, 2, 16, 12, 8, COLORS.FRAME_DARK)
  fillRect(canvas, 4, 18, 8, 4, COLORS.CUSHION)

  // Right armrest emphasis
  fillRect(canvas, 11, 10, 2, 8, COLORS.FRAME_DARK)

  // Legs
  fillRect(canvas, 3, 24, 2, 6, COLORS.FRAME_DARK)
  fillRect(canvas, 11, 24, 2, 6, COLORS.FRAME_DARK)

  return canvas
}

function generateChairCushionedLargeLeft(): SpriteData {
  const canvas = createCanvas(16, 32)

  // Chair back (tall)
  fillRect(canvas, 2, 4, 12, 12, COLORS.FRAME_BASE)
  drawBorder(canvas, 2, 4, 12, 12, COLORS.FRAME_DARK)

  // Cushioned back
  fillRect(canvas, 4, 6, 8, 8, COLORS.CUSHION)

  // Seat
  fillRect(canvas, 2, 16, 12, 8, COLORS.FRAME_BASE)
  drawBorder(canvas, 2, 16, 12, 8, COLORS.FRAME_DARK)
  fillRect(canvas, 4, 18, 8, 4, COLORS.CUSHION)

  // Left armrest emphasis
  fillRect(canvas, 3, 10, 2, 8, COLORS.FRAME_DARK)

  // Legs
  fillRect(canvas, 3, 24, 2, 6, COLORS.FRAME_DARK)
  fillRect(canvas, 11, 24, 2, 6, COLORS.FRAME_DARK)

  return canvas
}

function generateCoffeeTableLarge(): SpriteData {
  const canvas = createCanvas(32, 32)

  // Background area
  fillRect(canvas, 0, 0, 32, 12, '')

  // Table surface (lower, coffee table height)
  fillRect(canvas, 0, 12, 32, 14, COLORS.WOOD_BASE)
  drawBorder(canvas, 0, 12, 32, 14, COLORS.WOOD_DARK)

  // Glass/glossy top (lighter center)
  fillRect(canvas, 4, 14, 24, 10, COLORS.WOOD_LIGHT)

  // Reflection highlights
  for (let x = 6; x < 26; x += 4) {
    setPixel(canvas, x, 16, COLORS.WOOD_SURFACE)
    setPixel(canvas, x + 1, 16, COLORS.WOOD_SURFACE)
  }

  // Legs
  fillRect(canvas, 4, 26, 4, 6, COLORS.WOOD_DARK)
  fillRect(canvas, 24, 26, 4, 6, COLORS.WOOD_DARK)

  return canvas
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

    if (success) {
      console.log(`✓ Initialized furniture catalog with ${ASSET_METADATA.length} procedurally-generated assets`)
    }

    return success
  } catch (error) {
    console.error('Failed to initialize furniture catalog:', error)
    return false
  }
}
