import { extractDocument as extractWithHf } from './hf-qwen'
import { extractDocumentLocal, getLocalExtractUrl } from './local-extract'
import { filterExtractedBlocks } from './filterExamBlocks'
import type { DocumentRole, ExtractedBlock, PageImage } from './types'

export type ExtractVia = 'local' | 'hf'

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
  if (useLegacyLocalExtract()) {
    const blocks = await extractDocumentLocal(pages, role)
    return filterExtractedBlocks(blocks, role)
  }
  return extractWithHf(pages, role)
}

export function extractMode(): ExtractVia {
  return useLegacyLocalExtract() ? 'local' : 'hf'
}
