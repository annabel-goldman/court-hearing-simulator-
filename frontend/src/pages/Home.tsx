import { useState, useRef, DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Set up PDF.js worker
GlobalWorkerOptions.workerSrc = workerSrc

interface UploadedFile {
  name: string
  text: string
}

const SYSTEM_PROMPT = `You are a legal analyst. Analyze the following two court briefs and generate thoughtful questions that would help understand the key issues, arguments, and potential weaknesses in each position.

BRIEF A:
{{BRIEF_A}}

BRIEF B:
{{BRIEF_B}}

Please provide:
1. Key questions that a judge might ask about Brief A's arguments
2. Key questions that a judge might ask about Brief B's arguments  
3. Questions that highlight the main points of contention between the two briefs
4. Questions that could expose weaknesses or gaps in either argument

Format your response in a clear, readable way.`

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || ''

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

type Provider = 'openai' | 'gemini'

export default function Home() {
  const [fileA, setFileA] = useState<UploadedFile | null>(null)
  const [fileB, setFileB] = useState<UploadedFile | null>(null)
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)
  const [dragOverA, setDragOverA] = useState(false)
  const [dragOverB, setDragOverB] = useState(false)
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState<Provider>(OPENAI_API_KEY ? 'openai' : 'gemini')
  
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

  const analyzeBriefs = async () => {
    if (!fileA?.text || !fileB?.text) {
      setError('Please upload both PDFs')
      return
    }

    const apiKey = provider === 'openai' ? OPENAI_API_KEY : GEMINI_API_KEY
    if (!apiKey) {
      setError(`${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key not configured`)
      return
    }

    setLoading(true)
    setError('')
    setResponse('')

    const fullPrompt = SYSTEM_PROMPT
      .replace('{{BRIEF_A}}', fileA.text)
      .replace('{{BRIEF_B}}', fileB.text)

    try {
      let responseText = ''

      if (provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: fullPrompt }],
            temperature: 0.7,
            max_tokens: 8192,
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error?.message || 'API request failed')
        }

        responseText = data.choices?.[0]?.message?.content || ''
      } else {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: fullPrompt }] }],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 8192,
              },
            }),
          }
        )

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error?.message || 'API request failed')
        }

        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      }

      setResponse(responseText)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const clearAll = () => {
    setFileA(null)
    setFileB(null)
    setResponse('')
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
        <div className="nav-links">
          <Link to="/avatar" className="nav-link">Avatar</Link>
          <Link to="/playground" className="nav-link">Playground</Link>
        </div>
      </nav>

      <main className="home-main">
        <div className="hero">
          <h1>Brief Analysis</h1>
          <p>Upload two legal briefs to generate questions and insights</p>
        </div>

        <div className="provider-toggle">
          <span className="provider-label">AI Provider:</span>
          <div className="toggle-group">
            <button
              className={`toggle-btn ${provider === 'openai' ? 'active' : ''}`}
              onClick={() => setProvider('openai')}
              disabled={!OPENAI_API_KEY}
              title={!OPENAI_API_KEY ? 'OpenAI API key not configured' : ''}
            >
              OpenAI
            </button>
            <button
              className={`toggle-btn ${provider === 'gemini' ? 'active' : ''}`}
              onClick={() => setProvider('gemini')}
              disabled={!GEMINI_API_KEY}
              title={!GEMINI_API_KEY ? 'Gemini API key not configured' : ''}
            >
              Gemini
            </button>
          </div>
        </div>

        <div className="upload-section">
          <div className="upload-card">
            <div className="upload-header">
              <span className="upload-badge upload-badge-a">A</span>
              <label>First Brief</label>
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
                    disabled={loadingA || loading}
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
              <label>Second Brief</label>
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
                    disabled={loadingB || loading}
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
            className="btn-primary-large"
            onClick={analyzeBriefs}
            disabled={loading || !fileA || !fileB}
          >
            {loading ? (
              <>
                <span className="spinner" />
                Analyzing...
              </>
            ) : (
              'Generate Questions'
            )}
          </button>
          {(fileA || fileB || response) && (
            <button className="btn-ghost" onClick={clearAll} disabled={loading}>
              Clear All
            </button>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}

        {response && (
          <div className="response-output">
            <h2>Analysis</h2>
            <div className="response-text">{response}</div>
          </div>
        )}
      </main>
    </div>
  )
}
