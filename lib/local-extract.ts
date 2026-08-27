import type { DocumentRole, ExtractedBlock, PageImage } from './types'

/**
 * Call legacy local FastAPI extract server (ml/serve_extract.py).
 * Opt-in only: set USE_LEGACY_LOCAL_EXTRACT=1 and LOCAL_EXTRACT_URL in .env.local.
 * Env: LOCAL_EXTRACT_URL=http://127.0.0.1:8001
 */
export function getLocalExtractUrl(): string | null {
  const raw = process.env.LOCAL_EXTRACT_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/$/, '')
}

export async function extractDocumentLocal(
  pages: PageImage[],
  role: DocumentRole,
): Promise<ExtractedBlock[]> {
  const base = getLocalExtractUrl()
  if (!base) {
    throw new Error('LOCAL_EXTRACT_URL is not set')
  }

  const res = await fetch(`${base}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, pages }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      typeof data?.detail === 'string'
        ? data.detail
        : data?.error || `Local extract failed (${res.status})`,
    )
  }

  const blocks = data.blocks
  if (!Array.isArray(blocks)) {
    throw new Error('Local extract returned no blocks array')
  }
  return blocks as ExtractedBlock[]
}
