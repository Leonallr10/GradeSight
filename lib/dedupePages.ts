import type { PageImage } from './types'

/** Difference-hash length (8×8 → 64-bit hex). */
const HASH_SIZE = 8

function stripDataUrl(imageBase64: string): { mime: string; data: string } {
  const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (match) return { mime: match[1], data: match[2] }
  return { mime: 'image/png', data: imageBase64.replace(/^data:[^;]+;base64,/, '') }
}

/** Hamming distance between two equal-length hex hashes. */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return 64
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      dist += x & 1
      x >>= 1
    }
  }
  return dist
}

/**
 * Compute a simple difference hash for a page image (browser Canvas).
 * Near-identical photos of the same sheet land within a small Hamming distance.
 */
export async function pageDHash(page: PageImage): Promise<string> {
  const { mime, data } = stripDataUrl(page.imageBase64)
  const blob = await fetch(`data:${mime};base64,${data}`).then((r) => r.blob())
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = HASH_SIZE + 1
  canvas.height = HASH_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unavailable for page dedupe')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const { data: pixels } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const gray: number[] = []
  for (let i = 0; i < pixels.length; i += 4) {
    gray.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2])
  }

  let bits = ''
  for (let y = 0; y < HASH_SIZE; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      const left = gray[y * (HASH_SIZE + 1) + x]
      const right = gray[y * (HASH_SIZE + 1) + x + 1]
      bits += left > right ? '1' : '0'
    }
  }

  let hex = ''
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  }
  return hex
}

export type DedupePagesResult = {
  pages: PageImage[]
  droppedIndexes: number[]
  warning?: string
}

/**
 * Drop near-duplicate page images (e.g. two photos of the same answer sheet page).
 * Keeps the first occurrence; remaps pageIndex to a dense 0..n-1 sequence.
 */
export async function dedupeNearDuplicatePages(
  pages: PageImage[],
  opts: { maxHamming?: number } = {},
): Promise<DedupePagesResult> {
  const maxHamming = opts.maxHamming ?? 10
  if (pages.length <= 1) {
    return { pages, droppedIndexes: [] }
  }

  const hashes: string[] = []
  for (const page of pages) {
    try {
      hashes.push(await pageDHash(page))
    } catch {
      hashes.push(`unique-${page.pageIndex}-${Math.random()}`)
    }
  }

  const kept: PageImage[] = []
  const keptHashes: string[] = []
  const droppedIndexes: number[] = []

  for (let i = 0; i < pages.length; i++) {
    const h = hashes[i]
    const dupOf = keptHashes.findIndex((kh) => hammingHex(kh, h) <= maxHamming)
    if (dupOf >= 0) {
      droppedIndexes.push(pages[i].pageIndex)
      continue
    }
    kept.push(pages[i])
    keptHashes.push(h)
  }

  const remapped = kept.map((p, i) => ({ ...p, pageIndex: i }))
  const warning =
    droppedIndexes.length > 0
      ? `Skipped ${droppedIndexes.length} near-duplicate page(s) (original indexes: ${droppedIndexes.join(', ')}). Confirm the upload isn’t the same sheet photographed twice.`
      : undefined

  return { pages: remapped, droppedIndexes, warning }
}
