export type BBox = {
  x: number
  y: number
  w: number
  h: number
}

export type BBoxSource = 'qwen' | 'gemini' | 'none'

export type DocumentRole = 'question' | 'answer'

export type PageImage = {
  pageIndex: number
  imageBase64: string
  mimeType?: string
}

export type ExtractedBlock = {
  id: string
  pageIndex: number
  text: string
  labelNumber?: string
  bbox?: BBox
  bboxSource: BBoxSource
  /** Extra pages this block spans (same text region continued) */
  extraPages?: Array<{ pageIndex: number; bbox: BBox }>
}

export type MatchStatus = 'matched' | 'unanswered' | 'unmatched_answer'

export type MappedPair = {
  id: string
  status: MatchStatus
  question: ExtractedBlock | null
  answer: ExtractedBlock | null
  similarity?: number
}

export type GradeResult = {
  pairId: string
  score: number
  maxScore: number
  isCorrect: boolean
  feedback: string
}

export type GradingSummary = {
  totalScore: number
  maxScore: number
  answered: number
  unanswered: number
  unmatched: number
  overallFeedback: string
  grades: GradeResult[]
}

export type PipelineStage =
  | 'upload'
  | 'uploading'
  | 'extracting'
  | 'validating'
  | 'mapping'
  | 'grading'
  | 'done'
  | 'error'

export type PipelineResult = {
  questions: ExtractedBlock[]
  answers: ExtractedBlock[]
  pairs: MappedPair[]
  summary: GradingSummary
  questionPages: PageImage[]
  answerPages: PageImage[]
}
