import jsPDF from 'jspdf'
import type { GradeResult, GradingSummary, MappedPair } from './types'
import { contentKindLabel } from './blockContent'

interface GeneratePdfOptions {
  pairs: MappedPair[]
  grades: GradeResult[]
  summary: GradingSummary | null
  documentTitle?: string
}

export function generateEvaluationReportPdf({
  pairs,
  grades,
  summary,
  documentTitle = 'GradeSight Assessment Report',
}: GeneratePdfOptions): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  const pageWidth = 210
  const pageHeight = 297
  const marginLeft = 16
  const marginRight = 16
  const contentWidth = pageWidth - marginLeft - marginRight
  const bottomMargin = 20
  const topMargin = 20

  let currentY = topMargin
  const gradeMap = new Map(grades.map((g) => [g.pairId, g]))
  const questionPairs = pairs.filter((p) => p.status !== 'unmatched_answer')
  const unmatchedPairs = pairs.filter((p) => p.status === 'unmatched_answer')

  const primaryColor: [number, number, number] = [30, 41, 59] // #1e293b
  const accentColor: [number, number, number] = [232, 87, 42] // #e8572a
  const successColor: [number, number, number] = [22, 163, 74] // #16a34a
  const grayText: [number, number, number] = [100, 116, 139] // #64748b
  const cardBorder: [number, number, number] = [226, 232, 240] // #e2e8f0
  const cardBg: [number, number, number] = [248, 250, 252] // #f8fafc

  function checkPageBreak(requiredHeight: number): boolean {
    if (currentY + requiredHeight > pageHeight - bottomMargin) {
      doc.addPage()
      currentY = topMargin
      return true
    }
    return false
  }

  // --- HEADER ---
  // Top brand bar
  doc.setFillColor(...accentColor)
  doc.rect(marginLeft, currentY, 4, 18, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...primaryColor)
  doc.text('GradeSight', marginLeft + 7, currentY + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...grayText)
  doc.text('AI-Powered Exam Evaluation & Feedback Report', marginLeft + 7, currentY + 11)

  // Report Date & Status on right
  const now = new Date()
  const dateStr = now.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  doc.setFontSize(8)
  doc.text(`Generated: ${dateStr}`, pageWidth - marginRight, currentY + 6, { align: 'right' })
  doc.text(`Total Questions: ${questionPairs.length}`, pageWidth - marginRight, currentY + 11, {
    align: 'right',
  })

  currentY += 22

  // Divider
  doc.setDrawColor(...cardBorder)
  doc.setLineWidth(0.5)
  doc.line(marginLeft, currentY, pageWidth - marginRight, currentY)
  currentY += 6

  // --- SUMMARY SECTION (IF PRESENT) ---
  if (summary) {
    checkPageBreak(38)
    const summaryCardH = 28
    const cardY = currentY

    // Background container
    doc.setFillColor(...cardBg)
    doc.setDrawColor(...cardBorder)
    doc.roundedRect(marginLeft, cardY, contentWidth, summaryCardH, 3, 3, 'FD')

    // Left block: Total Score
    const scorePct =
      summary.maxScore > 0 ? Math.round((summary.totalScore / summary.maxScore) * 100) : 0
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...accentColor)
    doc.text(`${summary.totalScore} / ${summary.maxScore}`, marginLeft + 6, cardY + 10)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...grayText)
    doc.text(`Overall Score (${scorePct}%)`, marginLeft + 6, cardY + 15)

    // Center stats: Answered / Unanswered / Unmatched
    const col2X = marginLeft + 58
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...primaryColor)
    doc.text(`${summary.answered}`, col2X, cardY + 10)
    doc.text(`${summary.unanswered}`, col2X + 28, cardY + 10)
    doc.text(`${summary.unmatched}`, col2X + 58, cardY + 10)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...grayText)
    doc.text('Answered', col2X, cardY + 15)
    doc.text('Unanswered', col2X + 28, cardY + 15)
    doc.text('Unmatched', col2X + 58, cardY + 15)

    // Overall feedback preview
    if (summary.overallFeedback) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8)
      doc.setTextColor(70, 80, 95)
      const fbLines = doc.splitTextToSize(summary.overallFeedback, contentWidth - 12)
      doc.text(fbLines.slice(0, 2), marginLeft + 6, cardY + 22)
    }

    currentY += summaryCardH + 8
  }

  // --- SECTION TITLE ---
  checkPageBreak(12)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...primaryColor)
  doc.text('Evaluated Questions & AI Feedback', marginLeft, currentY)
  currentY += 5

  // --- QUESTIONS ITERATION ---
  questionPairs.forEach((pair, idx) => {
    const grade = gradeMap.get(pair.id)
    const unanswered = pair.status === 'unanswered'
    const label = pair.question?.labelNumber?.trim() || String(idx + 1)
    const kindLabel = contentKindLabel(pair.question?.contentKind)

    // Prepare text content
    const qText = pair.question?.text || 'No question text'
    const qMath = pair.question?.mathLatex
    const qDiagram = pair.question?.diagramDescription

    const aText = pair.answer?.text || ''
    const aMath = pair.answer?.mathLatex
    const aDiagram = pair.answer?.diagramDescription
    const aKindLabel = contentKindLabel(pair.answer?.contentKind)

    const feedbackText =
      grade?.feedback ||
      (unanswered
        ? 'This question appears to be unanswered in the uploaded sheet.'
        : 'Answer located and matched to this question.')

    // Calculate approximate height for page break decision
    const wrapWidth = contentWidth - 14
    const qLines = doc.splitTextToSize(qText, wrapWidth)
    const fbLines = doc.splitTextToSize(feedbackText, wrapWidth - 8)
    const aLines = aText && !unanswered ? doc.splitTextToSize(aText, wrapWidth - 8) : []

    let estimatedH = 14 + qLines.length * 4 + fbLines.length * 3.8 + 14
    if (qMath) estimatedH += 8
    if (qDiagram) estimatedH += 8
    if (aLines.length > 0) estimatedH += aLines.length * 3.8 + 10
    if (aMath) estimatedH += 6
    if (aDiagram) estimatedH += 6

    checkPageBreak(Math.min(estimatedH, 65))

    const itemStartY = currentY

    // Card Header Bar
    doc.setFillColor(241, 245, 249)
    doc.setDrawColor(...cardBorder)
    doc.roundedRect(marginLeft, currentY, contentWidth, 8, 2, 2, 'FD')

    // Question number circle
    doc.setFillColor(...primaryColor)
    doc.circle(marginLeft + 4.5, currentY + 4, 3, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(255, 255, 255)
    doc.text(label, marginLeft + 4.5, currentY + 5.2, { align: 'center' })

    // Question kind badge
    if (kindLabel) {
      doc.setFillColor(226, 232, 240)
      doc.roundedRect(marginLeft + 10, currentY + 1.8, 20, 4.4, 1, 1, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...primaryColor)
      doc.text(kindLabel.toUpperCase(), marginLeft + 20, currentY + 4.8, { align: 'center' })
    }

    // Score badge on right
    const scoreStr = grade ? `${grade.score} / ${grade.maxScore}` : '— / —'
    const isFullMarks = grade && grade.score >= grade.maxScore && grade.maxScore > 0
    const isPartial = grade && grade.score > 0 && grade.score < grade.maxScore

    if (unanswered) {
      doc.setFillColor(255, 237, 230)
      doc.setTextColor(...accentColor)
    } else if (isFullMarks) {
      doc.setFillColor(236, 253, 245)
      doc.setTextColor(...successColor)
    } else if (isPartial) {
      doc.setFillColor(254, 243, 199)
      doc.setTextColor(180, 83, 9)
    } else {
      doc.setFillColor(241, 245, 249)
      doc.setTextColor(...grayText)
    }

    doc.roundedRect(pageWidth - marginRight - 18, currentY + 1.8, 16, 4.4, 1.2, 1.2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text(scoreStr, pageWidth - marginRight - 10, currentY + 4.8, { align: 'center' })

    currentY += 12

    // Question text
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...primaryColor)
    doc.text(qLines, marginLeft + 3, currentY)
    currentY += qLines.length * 3.8

    // Question Math / Diagram if present
    if (qMath) {
      checkPageBreak(8)
      doc.setFont('courier', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(40, 60, 90)
      doc.setFillColor(240, 244, 250)
      doc.rect(marginLeft + 3, currentY, contentWidth - 6, 5.5, 'F')
      doc.text(`Math: ${qMath}`, marginLeft + 5, currentY + 3.8)
      currentY += 7.5
    }

    if (qDiagram) {
      checkPageBreak(8)
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7.5)
      doc.setTextColor(...grayText)
      const dLines = doc.splitTextToSize(`Diagram requirement: ${qDiagram}`, wrapWidth)
      doc.text(dLines, marginLeft + 3, currentY)
      currentY += dLines.length * 3.5 + 2
    }

    // Mapped Answer Box
    if (pair.answer && !unanswered) {
      checkPageBreak(16)
      const aBoxStartY = currentY
      const aBoxWidth = contentWidth - 4
      const aBoxPadX = marginLeft + 2

      // Subheading
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(71, 85, 105)
      let headerText = 'Mapped Answer'
      if (aKindLabel) headerText += ` (${aKindLabel})`
      doc.text(headerText, aBoxPadX + 3, currentY + 4)
      currentY += 6

      // Answer text
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(51, 65, 85)
      doc.text(aLines, aBoxPadX + 3, currentY)
      currentY += aLines.length * 3.5 + 1

      if (aMath) {
        doc.setFont('courier', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(30, 41, 59)
        doc.text(`Formula: ${aMath}`, aBoxPadX + 3, currentY)
        currentY += 4.5
      }

      if (aDiagram) {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(7.5)
        doc.setTextColor(71, 85, 105)
        const dAnsLines = doc.splitTextToSize(`Diagram: ${aDiagram}`, aBoxWidth - 6)
        doc.text(dAnsLines, aBoxPadX + 3, currentY)
        currentY += dAnsLines.length * 3.5 + 1
      }

      const aBoxHeight = currentY - aBoxStartY + 2
      // Draw background behind text using stroke & light fill
      doc.setDrawColor(226, 232, 240)
      doc.setFillColor(248, 250, 252)
      doc.roundedRect(aBoxPadX, aBoxStartY, aBoxWidth, aBoxHeight, 1.5, 1.5, 'FD')

      // Re-render text over background for crisp vector ordering
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(71, 85, 105)
      doc.text(headerText, aBoxPadX + 3, aBoxStartY + 4.5)

      let innerY = aBoxStartY + 8.5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(51, 65, 85)
      doc.text(aLines, aBoxPadX + 3, innerY)
      innerY += aLines.length * 3.5 + 1

      if (aMath) {
        doc.setFont('courier', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(30, 41, 59)
        doc.text(`Formula: ${aMath}`, aBoxPadX + 3, innerY)
        innerY += 4.5
      }

      if (aDiagram) {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(7.5)
        doc.setTextColor(71, 85, 105)
        const dAnsLines = doc.splitTextToSize(`Diagram: ${aDiagram}`, aBoxWidth - 6)
        doc.text(dAnsLines, aBoxPadX + 3, innerY)
      }

      currentY += 4
    }

    // AI Feedback Box (Callout with orange accent)
    checkPageBreak(16)
    const fbStartY = currentY
    const fbPadX = marginLeft + 2
    const fbBoxWidth = contentWidth - 4
    const fbBoxH = 6 + fbLines.length * 3.6 + 3

    doc.setFillColor(255, 250, 248)
    doc.setDrawColor(...cardBorder)
    doc.roundedRect(fbPadX, fbStartY, fbBoxWidth, fbBoxH, 1.5, 1.5, 'FD')

    // Left accent bar
    doc.setFillColor(...accentColor)
    doc.roundedRect(fbPadX, fbStartY, 2.5, fbBoxH, 1, 1, 'F')

    // Feedback Header
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...accentColor)
    doc.text(unanswered ? 'No Answer Mapped' : 'AI Evaluation & Feedback', fbPadX + 5, fbStartY + 4.5)

    // Feedback Text
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(51, 65, 85)
    doc.text(fbLines, fbPadX + 5, fbStartY + 8.5)

    currentY += fbBoxH + 4

    // Bottom subtle divider between questions
    doc.setDrawColor(241, 245, 249)
    doc.line(marginLeft, currentY, pageWidth - marginRight, currentY)
    currentY += 4
  })

  // --- UNMATCHED ANSWERS (IF ANY) ---
  if (unmatchedPairs.length > 0) {
    checkPageBreak(25)
    currentY += 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...accentColor)
    doc.text('Unmatched Answers Detected in Answer Sheet', marginLeft, currentY)
    currentY += 6

    unmatchedPairs.forEach((pair) => {
      const uText = pair.answer?.text || 'Unmatched answer content'
      const uLines = doc.splitTextToSize(uText, contentWidth - 10)
      const uH = 6 + uLines.length * 3.5 + 4
      checkPageBreak(uH)

      doc.setFillColor(255, 247, 237)
      doc.setDrawColor(254, 215, 170)
      doc.roundedRect(marginLeft, currentY, contentWidth, uH, 1.5, 1.5, 'FD')

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(194, 65, 12)
      doc.text('Unassigned handwritten segment:', marginLeft + 4, currentY + 4.5)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(67, 56, 202)
      doc.text(uLines, marginLeft + 4, currentY + 8.5)

      currentY += uH + 4
    })
  }

  // --- FOOTERS & PAGE NUMBERS ACROSS ALL PAGES ---
  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)

    // Running Header (pages 2+)
    if (i > 1) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...grayText)
      doc.text(documentTitle, marginLeft, 10)
      doc.text('GradeSight AI Assessment', pageWidth - marginRight, 10, { align: 'right' })
      doc.setDrawColor(...cardBorder)
      doc.setLineWidth(0.3)
      doc.line(marginLeft, 12, pageWidth - marginRight, 12)
    }

    // Running Footer
    doc.setDrawColor(...cardBorder)
    doc.setLineWidth(0.3)
    doc.line(marginLeft, pageHeight - 12, pageWidth - marginRight, pageHeight - 12)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...grayText)
    doc.text('Confidential — Automated Grading & Evaluation Report', marginLeft, pageHeight - 7)
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - marginRight, pageHeight - 7, {
      align: 'right',
    })
  }

  // Save the generated PDF
  const filename = `gradesight-evaluation-report-${Date.now()}.pdf`
  doc.save(filename)
}
