import { isValidBbox } from './bboxCheck'
import { inferContentKind } from './blockContent'
import { hasChemistryTopic } from './contentTopics'
import type { ContentKind, ExtractedBlock, PageImage } from './types'

/** contentKind values eligible for ChemVLM refinement. */
export const CHEM_VLM_CONTENT_KINDS = new Set<ContentKind>(['diagram', 'formula', 'mixed'])

export type ChemEnhancementPatch = {
  id: string
  mathLatex?: string | null
  diagramDescription?: string | null
  contentKind?: ContentKind
}

/**
 * Opt-in ChemVLM specialist pass — requires USE_CHEM_VLM=1 and CHEM_VLM_URL.
 * Env: CHEM_VLM_URL=http://127.0.0.1:8002
 */
export function getChemVlmUrl(): string | null {
  if (process.env.USE_CHEM_VLM !== '1') return null
  const raw = process.env.CHEM_VLM_URL?.trim() || 'http://127.0.0.1:8002'
  return raw.replace(/\/$/, '')
}

export function useChemVlmEnhance(): boolean {
  return process.env.USE_CHEM_VLM === '1' && !!getChemVlmUrl()
}

/** True when block is diagram/formula/mixed and chemistry topics are detected. */
export function needsChemVlmEnhancement(block: ExtractedBlock): boolean {
  if (block.isStrikethrough) return false
  const kind = block.contentKind ?? inferContentKind(block)
  if (!CHEM_VLM_CONTENT_KINDS.has(kind)) return false
  return hasChemistryTopic(block)
}

function applyChemPatch(block: ExtractedBlock, patch: ChemEnhancementPatch): ExtractedBlock {
  const next = { ...block }
  if (patch.mathLatex?.trim()) {
    next.mathLatex = patch.mathLatex.trim()
  }
  if (patch.diagramDescription?.trim()) {
    next.diagramDescription = patch.diagramDescription.trim()
  }
  if (patch.contentKind && CHEM_VLM_CONTENT_KINDS.has(patch.contentKind)) {
    next.contentKind = patch.contentKind
  } else if (!next.contentKind) {
    next.contentKind = inferContentKind(next)
  }
  return next
}

/**
 * Send chemistry-eligible blocks to local ChemVLM service (bbox crop server-side).
 * Returns original blocks unchanged when disabled, on error, or when none qualify.
 */
export async function enrichChemistryBlocks(
  blocks: ExtractedBlock[],
  pages: PageImage[],
): Promise<ExtractedBlock[]> {
  if (!useChemVlmEnhance()) return blocks

  const candidateIds = new Set(
    blocks.filter(needsChemVlmEnhancement).map((b) => b.id),
  )
  if (candidateIds.size === 0) return blocks

  const base = getChemVlmUrl()
  if (!base) return blocks

  const payloadBlocks = blocks
    .filter((b) => candidateIds.has(b.id))
    .map((b) => ({
      id: b.id,
      pageIndex: b.pageIndex,
      bbox: isValidBbox(b.bbox) ? b.bbox : null,
      contentKind: b.contentKind ?? inferContentKind(b),
      mathLatex: b.mathLatex ?? null,
      diagramDescription: b.diagramDescription ?? null,
      text: b.text.slice(0, 400),
    }))

  try {
    const res = await fetch(`${base}/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks: payloadBlocks, pages }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail =
        typeof data?.detail === 'string'
          ? data.detail
          : data?.error || `ChemVLM enrich failed (${res.status})`
      console.warn('[chem-vlm] enrich skipped:', detail)
      return blocks
    }

    const patches = data.blocks as ChemEnhancementPatch[] | undefined
    if (!Array.isArray(patches) || patches.length === 0) return blocks

    const patchMap = new Map(patches.filter((p) => p?.id).map((p) => [p.id, p]))
    const enriched = blocks.map((b) => {
      const patch = patchMap.get(b.id)
      return patch ? applyChemPatch(b, patch) : b
    })

    console.info(`[chem-vlm] refined ${patchMap.size} block(s)`)
    return enriched
  } catch (err) {
    console.warn('[chem-vlm] enrich failed:', err instanceof Error ? err.message : err)
    return blocks
  }
}
