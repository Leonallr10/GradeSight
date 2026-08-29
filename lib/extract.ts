import { enrichChemistryBlocks, useChemVlmEnhance } from './chem-vlm'
import { extractDocument as extractWithHf } from './hf-qwen'
import { extractDocumentLocal, getLocalExtractUrl } from './local-extract'
import { filterExtractedBlocks } from './filterExamBlocks'
import type { DocumentRole, ExtractedBlock, PageImage } from './types'

export type ExtractVia = 'local' | 'hf'

export { useChemVlmEnhance }

/** Legacy offline dev only — requires USE_LEGACY_LOCAL_EXTRACT=1 and LOCAL_EXTRACT_URL. */
export function useLegacyLocalExtract(): boolean {
  return process.env.USE_LEGACY_LOCAL_EXTRACT === '1' && !!getLocalExtractUrl()
}

/**
 * Extract pages: HF Scout by default (prod + normal dev).
 * Legacy local Qwen only when USE_LEGACY_LOCAL_EXTRACT=1 and LOCAL_EXTRACT_URL are set.
 */
export async function extractDocument(
  pages: PageImage[],
  role: DocumentRole,
): Promise<ExtractedBlock[]> {
  let blocks: ExtractedBlock[]
  if (useLegacyLocalExtract()) {
    blocks = await extractDocumentLocal(pages, role)
    blocks = filterExtractedBlocks(blocks, role)
  } else {
    blocks = await extractWithHf(pages, role)
  }
  return enrichChemistryBlocks(blocks, pages)
}

export function extractMode(): ExtractVia {
  return useLegacyLocalExtract() ? 'local' : 'hf'
}
