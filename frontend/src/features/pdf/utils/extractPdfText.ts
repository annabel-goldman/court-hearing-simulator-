import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let workerConfigured = false

function ensurePdfWorkerConfigured(): void {
  if (workerConfigured) return
  GlobalWorkerOptions.workerSrc = workerSrc
  workerConfigured = true
}

export async function extractPdfText(file: File): Promise<string> {
  ensurePdfWorkerConfigured()

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: arrayBuffer }).promise

  let fullText = ''
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
    const page = await pdf.getPage(pageIndex)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    fullText += `${pageText}\n\n`
  }

  return fullText.trim()
}
