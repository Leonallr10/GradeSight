'use client'

import type { PageImage } from './types'

const MAX_PAGES = 20
/** Lower scale + JPEG keeps each API page under Vercel ~4.5MB body limit. */
const RENDER_SCALE = 1.2
const JPEG_QUALITY = 0.82

/**
 * Use the legacy build — modern pdfjs requires Map.getOrInsertComputed
 * (Chrome ~140+). Legacy includes polyfills for wider browser support.
 */
async function getPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // Legacy worker (CDN) — modern build needs Map.getOrInsertComputed (Chrome ~140+)
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`
  return pdfjs
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function rasterizePdf(file: File): Promise<PageImage[]> {
  const pdfjs = await getPdfjs()
  const buffer = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buffer }).promise
  const pageCount = Math.min(doc.numPages, MAX_PAGES)
  const pages: PageImage[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: RENDER_SCALE })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get canvas context')

    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    pages.push({
      pageIndex: i - 1,
      imageBase64: dataUrl,
      mimeType: 'image/jpeg',
    })
  }

  return pages
}

/** Convert a PDF or image File into per-page PNG data URLs. */
export async function rasterizeFile(file: File): Promise<PageImage[]> {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()

  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    return rasterizePdf(file)
  }

  if (
    type.startsWith('image/') ||
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.webp')
  ) {
    const dataUrl = await fileToDataUrl(file)
    return [
      {
        pageIndex: 0,
        imageBase64: dataUrl,
        mimeType: type || 'image/png',
      },
    ]
  }

  throw new Error(`Unsupported file type: ${file.type || file.name}`)
}
