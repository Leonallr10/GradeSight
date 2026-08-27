import { z } from 'zod'

const bboxSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  })
  .optional()

/** Shared extracted-block shape for API request bodies. */
export const extractedBlockSchema = z.object({
  id: z.string(),
  pageIndex: z.number(),
  text: z.string(),
  labelNumber: z.string().optional(),
  labelWritten: z.string().optional(),
  bbox: bboxSchema,
  bboxSource: z.enum(['qwen', 'gemini', 'none']),
  contentKind: z
    .enum(['text', 'formula', 'derivative', 'diagram', 'mixed'])
    .optional(),
  mathLatex: z.string().optional(),
  diagramDescription: z.string().optional(),
  isStrikethrough: z.boolean().optional(),
  extraPages: z
    .array(
      z.object({
        pageIndex: z.number(),
        bbox: z.object({
          x: z.number(),
          y: z.number(),
          w: z.number(),
          h: z.number(),
        }),
      }),
    )
    .optional(),
})

export const extractedBlockSchemaNullable = extractedBlockSchema.nullable()
