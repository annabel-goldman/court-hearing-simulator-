import { useState, useRef, DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Set up PDF.js worker
GlobalWorkerOptions.workerSrc = workerSrc

interface UploadedFile {
  name: string
  text: string
}

async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: arrayBuffer }).promise
  
  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    fullText += pageText + '\n\n'
  }
  
  return fullText.trim()
}

export default function Home() {
  const navigate = useNavigate()
  const [fileA, setFileA] = useState<UploadedFile | null>(null)
  const [fileB, setFileB] = useState<UploadedFile | null>(null)
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)
  const [dragOverA, setDragOverA] = useState(false)
  const [dragOverB, setDragOverB] = useState(false)
  const [error, setError] = useState('')
  
  const inputRefA = useRef<HTMLInputElement>(null)
  const inputRefB = useRef<HTMLInputElement>(null)

  const handleFileUpload = async (
    file: File,
    setFile: (f: UploadedFile | null) => void,
    setLoadingState: (l: boolean) => void
  ) => {
    if (!file.type.includes('pdf') && !file.name.endsWith('.pdf')) {
      setError('Please upload a PDF file')
      return
    }

    setLoadingState(true)
    setError('')

    try {
      const text = await extractTextFromPdf(file)
      setFile({ name: file.name, text })
    } catch (err) {
      setError(`Failed to read PDF: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoadingState(false)
    }
  }

  const handleDragOver = (e: DragEvent, setDragOver: (v: boolean) => void) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }

  const handleDragLeave = (e: DragEvent, setDragOver: (v: boolean) => void) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }

  const handleDrop = (
    e: DragEvent,
    setFile: (f: UploadedFile | null) => void,
    setLoadingState: (l: boolean) => void,
    setDragOver: (v: boolean) => void
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      handleFileUpload(files[0], setFile, setLoadingState)
    }
  }

  const enterCourtroom = () => {
    if (!fileA?.text || !fileB?.text) {
      setError('Please upload both briefs before entering the courtroom')
      return
    }

    // Store session config with demo mode and attorney role
    const sessionConfig = {
      proceedingType: 'demo',
      userRole: 'attorney',
      materials: [
        { name: fileA.name, text: fileA.text, role: 'appellant' },
        { name: fileB.name, text: fileB.text, role: 'appellee' }
      ]
    }
    sessionStorage.setItem('courtSession', JSON.stringify(sessionConfig))
    navigate('/courtroom')
  }

  const clearAll = () => {
    setFileA(null)
    setFileB(null)
    setError('')
    if (inputRefA.current) inputRefA.current.value = ''
    if (inputRefB.current) inputRefB.current.value = ''
  }

  const removeFile = (which: 'a' | 'b') => {
    if (which === 'a') {
      setFileA(null)
      if (inputRefA.current) inputRefA.current.value = ''
    } else {
      setFileB(null)
      if (inputRefB.current) inputRefB.current.value = ''
    }
  }

  return (
    <div className="home">
      <nav className="nav">
        <div className="nav-brand">Court Simulator</div>
        <div className="nav-spacer" />
      </nav>

      <main className="home-main">
        <div className="hero">
          <h1>Court Simulator</h1>
          <p>Upload your two briefs to enter the courtroom</p>
        </div>

        <div className="upload-section">
          <div className="upload-card">
            <div className="upload-header">
              <span className="upload-badge upload-badge-a">A</span>
              <label>Appellant Brief</label>
            </div>
            <div className="upload-body">
              {fileA ? (
                <div className="file-preview">
                  <div className="file-icon">PDF</div>
                  <div className="file-info">
                    <span className="file-name">{fileA.name}</span>
                    <span className="file-meta">{fileA.text.length.toLocaleString()} characters extracted</span>
                  </div>
                  <button className="file-remove" onClick={() => removeFile('a')}>×</button>
                </div>
              ) : (
                <div
                  className={`upload-zone ${loadingA ? 'loading' : ''} ${dragOverA ? 'drag-over' : ''}`}
                  onDragOver={(e) => handleDragOver(e, setDragOverA)}
                  onDragEnter={(e) => handleDragOver(e, setDragOverA)}
                  onDragLeave={(e) => handleDragLeave(e, setDragOverA)}
                  onDrop={(e) => handleDrop(e, setFileA, setLoadingA, setDragOverA)}
                  onClick={() => inputRefA.current?.click()}
                >
                  <input
                    ref={inputRefA}
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleFileUpload(file, setFileA, setLoadingA)
                    }}
                    disabled={loadingA}
                  />
                  {loadingA ? (
                    <>
                      <span className="spinner" />
                      <span>Extracting text...</span>
                    </>
                  ) : (
                    <>
                      <span className="upload-icon">↑</span>
                      <span>Click to upload PDF</span>
                      <span className="upload-hint">or drag and drop</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="upload-card">
            <div className="upload-header">
              <span className="upload-badge upload-badge-b">B</span>
              <label>Appellee Brief</label>
            </div>
            <div className="upload-body">
              {fileB ? (
                <div className="file-preview">
                  <div className="file-icon">PDF</div>
                  <div className="file-info">
                    <span className="file-name">{fileB.name}</span>
                    <span className="file-meta">{fileB.text.length.toLocaleString()} characters extracted</span>
                  </div>
                  <button className="file-remove" onClick={() => removeFile('b')}>×</button>
                </div>
              ) : (
                <div
                  className={`upload-zone ${loadingB ? 'loading' : ''} ${dragOverB ? 'drag-over' : ''}`}
                  onDragOver={(e) => handleDragOver(e, setDragOverB)}
                  onDragEnter={(e) => handleDragOver(e, setDragOverB)}
                  onDragLeave={(e) => handleDragLeave(e, setDragOverB)}
                  onDrop={(e) => handleDrop(e, setFileB, setLoadingB, setDragOverB)}
                  onClick={() => inputRefB.current?.click()}
                >
                  <input
                    ref={inputRefB}
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleFileUpload(file, setFileB, setLoadingB)
                    }}
                    disabled={loadingB}
                  />
                  {loadingB ? (
                    <>
                      <span className="spinner" />
                      <span>Extracting text...</span>
                    </>
                  ) : (
                    <>
                      <span className="upload-icon">↑</span>
                      <span>Click to upload PDF</span>
                      <span className="upload-hint">or drag and drop</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="action-row">
          <button
            className="btn-primary-large start-btn"
            onClick={enterCourtroom}
            disabled={!fileA || !fileB}
          >
            Enter Courtroom
          </button>
          {(fileA || fileB) && (
            <button className="btn-ghost" onClick={clearAll}>
              Clear All
            </button>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}
      </main>
    </div>
  )
}
