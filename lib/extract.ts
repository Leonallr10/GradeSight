import { extractDocument as extractWithHf } from './hf-qwen'
import { extractDocumentLocal, getLocalExtractUrl } from './local-extract'
import { filterExtractedBlocks } from './filterExamBlocks'
import type { DocumentRole, ExtractedBlock, PageImage } from './types'

/**
 * Extract pages: local Qwen server when LOCAL_EXTRACT_URL is set, else HF Scout.
 * No cascading multi-provider fallback.
 */
export async function extractDocument(
  pages: PageImage[],
  role: DocumentRole,
): Promise<ExtractedBlock[]> {
  if (getLocalExtractUrl()) {
    const blocks = await extractDocumentLocal(pages, role)
    // Local server returns raw blocks — apply same post-filters as HF path
    return filterExtractedBlocks(blocks, role)
  }
  return extractWithHf(pages, role)
}

export function extractMode(): 'local' | 'hf' {
  return getLocalExtractUrl() ? 'local' : 'hf'
}
