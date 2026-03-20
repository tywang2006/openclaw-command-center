import type { SpriteData } from '../types.js'

const zoomCaches = new Map<number, WeakMap<SpriteData, HTMLCanvasElement>>()

// ── Outline sprite generation ─────────────────────────────────

const outlineCache = new WeakMap<SpriteData, SpriteData>()

/** Generate a 1px white outline SpriteData (2px larger in each dimension) */
export function getOutlineSprite(sprite: SpriteData): SpriteData {
  const cached = outlineCache.get(sprite)
  if (cached) return cached

  const rows = sprite.length
  const cols = sprite[0].length
  // Expanded grid: +2 in each dimension for 1px border
  const outline: string[][] = []
  for (let r = 0; r < rows + 2; r++) {
    outline.push(new Array<string>(cols + 2).fill(''))
  }

  // For each opaque pixel, mark its 4 cardinal neighbors as white
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] === '') continue
      const er = r + 1
      const ec = c + 1
      if (outline[er - 1][ec] === '') outline[er - 1][ec] = '#FFFFFF'
      if (outline[er + 1][ec] === '') outline[er + 1][ec] = '#FFFFFF'
      if (outline[er][ec - 1] === '') outline[er][ec - 1] = '#FFFFFF'
      if (outline[er][ec + 1] === '') outline[er][ec + 1] = '#FFFFFF'
    }
  }

  // Clear pixels that overlap with original opaque pixels
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (sprite[r][c] !== '') {
        outline[r + 1][c + 1] = ''
      }
    }
  }

  outlineCache.set(sprite, outline)
  return outline
}

// ── Performance optimization: ImageData + scaled rendering ─────

/** Convert hex color to RGB array for ImageData */
function hexToRgb(hex: string): [number, number, number] {
  // Handle #RGB and #RRGGBB formats
  const h = hex.replace('#', '')
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16)
    const g = parseInt(h[1] + h[1], 16)
    const b = parseInt(h[2] + h[2], 16)
    return [r, g, b]
  }
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return [r, g, b]
}

export function getCachedSprite(sprite: SpriteData, zoom: number): HTMLCanvasElement {
  let cache = zoomCaches.get(zoom)
  if (!cache) {
    cache = new WeakMap()
    zoomCaches.set(zoom, cache)
  }

  const cached = cache.get(sprite)
  if (cached) return cached

  const rows = sprite.length
  const cols = sprite[0].length
  const canvas = document.createElement('canvas')
  canvas.width = cols * zoom
  canvas.height = rows * zoom
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  // Optimization: for zoom=1, use ImageData for batch pixel writing (much faster than 1024 fillRect calls)
  if (zoom === 1) {
    const imageData = ctx.createImageData(cols, rows)
    const data = imageData.data

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const color = sprite[r][c]
        if (color === '') continue
        const [red, green, blue] = hexToRgb(color)
        const idx = (r * cols + c) * 4
        data[idx] = red
        data[idx + 1] = green
        data[idx + 2] = blue
        data[idx + 3] = 255 // fully opaque
      }
    }

    ctx.putImageData(imageData, 0, 0)
  } else {
    // Optimization: for zoom>1, get the zoom=1 cached version and scale it up with drawImage
    // This is 10x faster than doing zoom^2 fillRect calls
    let zoom1Cache = zoomCaches.get(1)
    if (!zoom1Cache) {
      zoom1Cache = new WeakMap()
      zoomCaches.set(1, zoom1Cache)
    }

    let zoom1Canvas = zoom1Cache.get(sprite)
    if (!zoom1Canvas) {
      // Recursively call getCachedSprite with zoom=1 to populate the cache
      zoom1Canvas = getCachedSprite(sprite, 1)
    }

    // Scale up with drawImage (uses hardware acceleration, very fast)
    ctx.drawImage(zoom1Canvas, 0, 0, cols, rows, 0, 0, cols * zoom, rows * zoom)
  }

  cache.set(sprite, canvas)
  return canvas
}
