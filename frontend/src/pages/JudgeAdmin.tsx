import { useState, useEffect, useRef, DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Set up PDF.js worker
GlobalWorkerOptions.workerSrc = workerSrc

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Storage key for custom prompts
const CUSTOM_PROMPTS_KEY = 'customJudgePrompts'

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

const DEFAULT_SEED_PROMPT = `You are a legal analyst preparing questions for a moot court judge. Given the following legal briefs, generate a comprehensive list of questions that a judge might ask during oral argument.

APPELLANT BRIEF:
{{APPELLANT_BRIEF}}

APPELLEE BRIEF:
{{APPELLEE_BRIEF}}

Generate questions that:
1. Probe weaknesses in each party's arguments
2. Test the advocate's understanding of key precedents
3. Explore hypothetical scenarios that test the limits of their position
4. Clarify ambiguous points in the briefs
5. Challenge factual assertions

Output as JSON array:
{
  "questions": [
    {
      "id": "q1",
      "text": "The question text",
      "target": "appellant" | "appellee" | "both",
      "category": "weakness" | "precedent" | "hypothetical" | "clarification" | "factual",
      "priority": 1-5,
      "followUp": "Optional follow-up if evaded"
    }
  ]
}`

const DEFAULT_SYNTHESIS_PROMPT = `You are a federal appellate judge presiding over oral argument. Based on the advocate's recent statements and the prepared questions, decide whether to interrupt with a question.

RECENT TRANSCRIPT:
{{TRANSCRIPT}}

AVAILABLE QUESTIONS:
{{SEED_QUESTIONS}}

CASE CONTEXT:
{{BRIEF_SUMMARY}}

ALREADY ASKED:
{{ASKED_QUESTIONS}}

Determine:
1. Should you interrupt now? (Consider: unclear point, logical gap, good pause moment, not too frequent)
2. If yes, select or synthesize the most relevant question

Respond as JSON:
{
  "shouldInterrupt": boolean,
  "question": "The question to ask" | null,
  "reasoning": "Brief explanation",
  "questionId": "id of seed question used, if any" | null
}`

const DEFAULT_SUMMARIZATION_PROMPT = `You are a senior law clerk summarizing two opposing legal briefs for an appellate judge.
Provide a concise summary (max 300 words) that captures:
1. The core legal dispute
2. The appellant's primary argument
3. The appellee's primary response
4. The key precedents involved

Format as a professional judicial summary that will help the judge quickly understand the case before oral argument.`

// Helper to load prompts from sessionStorage
function loadStoredPrompts(): { seedPrompt: string; synthesisPrompt: string; summarizationPrompt: string } | null {
  try {
    const stored = sessionStorage.getItem(CUSTOM_PROMPTS_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.warn('Failed to load stored prompts:', e)
  }
  return null
}

// Helper to save prompts to sessionStorage
function savePromptsToStorage(prompts: { seedPrompt: string; synthesisPrompt: string; summarizationPrompt: string }) {
  sessionStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(prompts))
}

export default function JudgeAdmin() {
  // Prompt editors
  const [seedPrompt, setSeedPrompt] = useState(DEFAULT_SEED_PROMPT)
  const [synthesisPrompt, setSynthesisPrompt] = useState(DEFAULT_SYNTHESIS_PROMPT)
  const [summarizationPrompt, setSummarizationPrompt] = useState(DEFAULT_SUMMARIZATION_PROMPT)
  
  // Test inputs (text)
  const [appellantBrief, setAppellantBrief] = useState('')
  const [appelleeBrief, setAppelleeBrief] = useState('')
  const [testTranscript, setTestTranscript] = useState(`Your Honor, the district court's interpretation of the statutory language fundamentally misreads congressional intent. When Congress enacted Section 230, it sought to protect platforms that act in good faith to moderate harmful content. Here, the petitioner—`)
  const [alreadyAsked, setAlreadyAsked] = useState('[]')
  
  // File uploads
  const [fileA, setFileA] = useState<UploadedFile | null>(null)
  const [fileB, setFileB] = useState<UploadedFile | null>(null)
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)
  const [dragOverA, setDragOverA] = useState(false)
  const [dragOverB, setDragOverB] = useState(false)
  const inputRefA = useRef<HTMLInputElement>(null)
  const inputRefB = useRef<HTMLInputElement>(null)
  
  // Generated outputs
  const [seedQuestions, setSeedQuestions] = useState<string>('')
  const [briefSummary, setBriefSummary] = useState<string>('')
  const [synthesisResult, setSynthesisResult] = useState<string>('')
  
  // UI state
  const [activeTab, setActiveTab] = useState<'seed' | 'synthesis' | 'summarization'>('summarization')
  const [loadingSeed, setLoadingSeed] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingSynthesis, setLoadingSynthesis] = useState(false)
  const [error, setError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // PDF upload handlers
  const handleFileUpload = async (
    file: File,
    setFile: (f: UploadedFile | null) => void,
    setLoadingState: (l: boolean) => void,
    setBriefText: (t: string) => void
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
      setBriefText(text)
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
    setDragOver: (v: boolean) => void,
    setBriefText: (t: string) => void
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      handleFileUpload(files[0], setFile, setLoadingState, setBriefText)
    }
  }

  const removeFile = (which: 'a' | 'b') => {
    if (which === 'a') {
      setFileA(null)
      setAppellantBrief('')
      if (inputRefA.current) inputRefA.current.value = ''
    } else {
      setFileB(null)
      setAppelleeBrief('')
      if (inputRefB.current) inputRefB.current.value = ''
    }
  }

  // Load stored prompts on mount
  useEffect(() => {
    const stored = loadStoredPrompts()
    if (stored) {
      setSeedPrompt(stored.seedPrompt)
      setSynthesisPrompt(stored.synthesisPrompt)
      setSummarizationPrompt(stored.summarizationPrompt)
    }
  }, [])

  // Track unsaved changes
  useEffect(() => {
    const stored = loadStoredPrompts()
    const currentDefaults = {
      seedPrompt: stored?.seedPrompt ?? DEFAULT_SEED_PROMPT,
      synthesisPrompt: stored?.synthesisPrompt ?? DEFAULT_SYNTHESIS_PROMPT,
      summarizationPrompt: stored?.summarizationPrompt ?? DEFAULT_SUMMARIZATION_PROMPT,
    }
    const hasChanges = 
      seedPrompt !== currentDefaults.seedPrompt ||
      synthesisPrompt !== currentDefaults.synthesisPrompt ||
      summarizationPrompt !== currentDefaults.summarizationPrompt
    setHasUnsavedChanges(hasChanges)
  }, [seedPrompt, synthesisPrompt, summarizationPrompt])

  // Save prompts to session
  const handleSetPrompts = () => {
    savePromptsToStorage({ seedPrompt, synthesisPrompt, summarizationPrompt })
    setSaveSuccess(true)
    setHasUnsavedChanges(false)
    setTimeout(() => setSaveSuccess(false), 3000)
  }

  // Reset to defaults
  const handleResetDefaults = () => {
    setSeedPrompt(DEFAULT_SEED_PROMPT)
    setSynthesisPrompt(DEFAULT_SYNTHESIS_PROMPT)
    setSummarizationPrompt(DEFAULT_SUMMARIZATION_PROMPT)
    sessionStorage.removeItem(CUSTOM_PROMPTS_KEY)
    setHasUnsavedChanges(false)
  }

  const testSeedGeneration = async () => {
    if (!appellantBrief.trim() || !appelleeBrief.trim()) {
      setError('Please provide both briefs for seed generation')
      return
    }

    setLoadingSeed(true)
    setError('')
    setSeedQuestions('')

    try {
      const res = await fetch(`${API_URL}/api/seed-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appellant_brief: appellantBrief,
          appellee_brief: appelleeBrief,
          system_prompt: seedPrompt
        }),
      })
      
      const data = await res.json()
      console.log('Seed questions response:', data)
      if (!res.ok) throw new Error(data.detail || 'API request failed')
      
      const questions = data.questions
      if (questions && Array.isArray(questions) && questions.length > 0) {
        setSeedQuestions(JSON.stringify(questions, null, 2))
      } else {
        setSeedQuestions('No questions generated. Try adjusting the prompt or briefs.')
      }
    } catch (err) {
      console.error('Seed generation error:', err)
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoadingSeed(false)
    }
  }

  const generateSummary = async () => {
    if (!appellantBrief.trim() || !appelleeBrief.trim()) {
      setError('Please provide both briefs to generate a summary')
      return
    }

    setLoadingSummary(true)
    setError('')
    setBriefSummary('')
    
    try {
      const res = await fetch(`${API_URL}/api/summarize-briefs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appellant_brief: appellantBrief,
          appellee_brief: appelleeBrief,
          system_prompt: summarizationPrompt
        }),
      })
      
      const data = await res.json()
      console.log('Summary response:', data)
      if (!res.ok) throw new Error(data.detail || 'Summary request failed')
      
      if (data.summary) {
        setBriefSummary(data.summary)
      } else {
        setBriefSummary('No summary generated. Try adjusting the prompt or briefs.')
      }
    } catch (err) {
      console.error('Summary generation error:', err)
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoadingSummary(false)
    }
  }

  const testSynthesis = async () => {
    if (!testTranscript.trim()) {
      setError('Please provide a test transcript')
      return
    }

    setLoadingSynthesis(true)
    setError('')
    setSynthesisResult('')

    // Parse already asked questions
    let parsedAsked: string[] = []
    try {
      parsedAsked = JSON.parse(alreadyAsked)
      if (!Array.isArray(parsedAsked)) parsedAsked = []
    } catch {
      parsedAsked = []
    }

    try {
      const res = await fetch(`${API_URL}/api/synthesize-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: testTranscript,
          seed_questions: seedQuestions ? JSON.parse(seedQuestions) : [],
          brief_summary: briefSummary || 'No case summary available.',
          asked_questions: parsedAsked,
          system_prompt: synthesisPrompt
        }),
      })
      
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'API request failed')
      setSynthesisResult(JSON.stringify(data, null, 2))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoadingSynthesis(false)
    }
  }

  return (
    <div className="judge-admin">
      <nav className="nav">
        <div className="nav-brand">Judge Admin</div>
        <div className="nav-links">
          <Link to="/" className="nav-link">Home</Link>
        </div>
      </nav>

      <div className="admin-explainer">
        <div className="explainer-section">
          <h2>How the Judge System Works</h2>
          <p>
            The AI Judge uses three interconnected prompts to simulate realistic judicial behavior during oral arguments:
          </p>
          <div className="prompt-flow">
            <div className="flow-step">
              <div className="flow-number">1</div>
              <div className="flow-content">
                <h4>Brief Summarization</h4>
                <p>Before arguments begin, this prompt analyzes both briefs to create a concise judicial summary. This gives the judge context about the key issues, arguments, and legal questions at stake.</p>
              </div>
            </div>
            <div className="flow-arrow">→</div>
            <div className="flow-step">
              <div className="flow-number">2</div>
              <div className="flow-content">
                <h4>Seed Question Generation</h4>
                <p>Based on the briefs, this prompt generates initial questions the judge might ask. These "seed" questions cover key legal issues and serve as a starting point for the judge's inquiries.</p>
              </div>
            </div>
            <div className="flow-arrow">→</div>
            <div className="flow-step">
              <div className="flow-number">3</div>
              <div className="flow-content">
                <h4>Real-time Synthesis</h4>
                <p>During arguments, this prompt decides when and how to interrupt. It analyzes the live transcript, considers which seed questions remain unanswered, and synthesizes new questions based on what's being said.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="explainer-section">
          <h2>Using the Prompt Playground</h2>
          <ol className="playground-steps">
            <li><strong>Tab 1: Upload & Summarize</strong> — Upload your test briefs and generate a judicial summary. This output feeds into the next step.</li>
            <li><strong>Tab 2: Seed Questions</strong> — View the summary, then generate seed questions. These questions prime the judge for oral arguments.</li>
            <li><strong>Tab 3: Test Synthesis</strong> — See all context together and test how the judge responds to sample transcripts in real-time.</li>
            <li><strong>Save when ready</strong> — Click "Set Prompts" to save your customizations. They'll be used for all courtroom sessions.</li>
          </ol>
          <p className="explainer-note">
            Work through the tabs in order — each step builds on the previous. Your prompts are stored in your browser session.
          </p>
        </div>
      </div>
      
      <div className="admin-header">
        <div className="admin-header-actions">
          <button 
            className={`btn-primary ${hasUnsavedChanges ? 'pulse' : ''}`}
            onClick={handleSetPrompts}
          >
            Set Prompts
          </button>
          <button 
            className="btn-ghost"
            onClick={handleResetDefaults}
          >
            Reset to Defaults
          </button>
          {saveSuccess && <span className="save-success">Prompts saved to session!</span>}
        </div>
      </div>

      <div className="admin-tabs">
        <button 
          className={`tab ${activeTab === 'summarization' ? 'active' : ''}`}
          onClick={() => setActiveTab('summarization')}
        >
          1. Brief Summarization
        </button>
        <button 
          className={`tab ${activeTab === 'seed' ? 'active' : ''}`}
          onClick={() => setActiveTab('seed')}
        >
          2. Seed Questions
        </button>
        <button 
          className={`tab ${activeTab === 'synthesis' ? 'active' : ''}`}
          onClick={() => setActiveTab('synthesis')}
        >
          3. Real-time Synthesis
        </button>
      </div>

      <main className="admin-main">
        {error && <div className="error-banner">{error}</div>}

        {/* Tab 1: Brief Summarization - Upload briefs and generate summary */}
        {activeTab === 'summarization' && (
          <div className="admin-layout">
            <div className="admin-column">
              <div className="admin-section">
                <h3>Upload Briefs</h3>
                <p className="hint">Upload PDF briefs. These will be used in all subsequent steps.</p>
                <div className="brief-inputs">
                  <div className="brief-input">
                    <label>Appellant Brief {fileA && <span className="input-ready">✓</span>}</label>
                    {fileA ? (
                      <div className="file-preview-compact">
                        <div className="file-icon-small">PDF</div>
                        <div className="file-info">
                          <span className="file-name">{fileA.name}</span>
                          <span className="file-meta">{fileA.text.length.toLocaleString()} chars</span>
                        </div>
                        <button className="file-remove" onClick={() => removeFile('a')}>×</button>
                      </div>
                    ) : (
                      <div
                        className={`upload-zone ${loadingA ? 'loading' : ''} ${dragOverA ? 'drag-over' : ''}`}
                        onDragOver={(e) => handleDragOver(e, setDragOverA)}
                        onDragEnter={(e) => handleDragOver(e, setDragOverA)}
                        onDragLeave={(e) => handleDragLeave(e, setDragOverA)}
                        onDrop={(e) => handleDrop(e, setFileA, setLoadingA, setDragOverA, setAppellantBrief)}
                        onClick={() => inputRefA.current?.click()}
                      >
                        <input
                          ref={inputRefA}
                          type="file"
                          accept=".pdf,application/pdf"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleFileUpload(file, setFileA, setLoadingA, setAppellantBrief)
                          }}
                          disabled={loadingA}
                        />
                        {loadingA ? (
                          <><span className="spinner" /> Extracting...</>
                        ) : (
                          <span>Drop PDF or click to upload</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="brief-input">
                    <label>Appellee Brief {fileB && <span className="input-ready">✓</span>}</label>
                    {fileB ? (
                      <div className="file-preview-compact">
                        <div className="file-icon-small">PDF</div>
                        <div className="file-info">
                          <span className="file-name">{fileB.name}</span>
                          <span className="file-meta">{fileB.text.length.toLocaleString()} chars</span>
                        </div>
                        <button className="file-remove" onClick={() => removeFile('b')}>×</button>
                      </div>
                    ) : (
                      <div
                        className={`upload-zone ${loadingB ? 'loading' : ''} ${dragOverB ? 'drag-over' : ''}`}
                        onDragOver={(e) => handleDragOver(e, setDragOverB)}
                        onDragEnter={(e) => handleDragOver(e, setDragOverB)}
                        onDragLeave={(e) => handleDragLeave(e, setDragOverB)}
                        onDrop={(e) => handleDrop(e, setFileB, setLoadingB, setDragOverB, setAppelleeBrief)}
                        onClick={() => inputRefB.current?.click()}
                      >
                        <input
                          ref={inputRefB}
                          type="file"
                          accept=".pdf,application/pdf"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleFileUpload(file, setFileB, setLoadingB, setAppelleeBrief)
                          }}
                          disabled={loadingB}
                        />
                        {loadingB ? (
                          <><span className="spinner" /> Extracting...</>
                        ) : (
                          <span>Drop PDF or click to upload</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="admin-section">
                <h3>Summarization Prompt</h3>
                <p className="hint">
                  Edit how the briefs are summarized for the judge's context.
                </p>
                <textarea
                  className="code-textarea"
                  value={summarizationPrompt}
                  onChange={(e) => setSummarizationPrompt(e.target.value)}
                  rows={10}
                />
                <button 
                  className="btn-primary-large"
                  onClick={generateSummary}
                  disabled={loadingSummary || !appellantBrief || !appelleeBrief}
                >
                  {loadingSummary ? <><span className="spinner" /> Summarizing...</> : 'Generate Summary'}
                </button>
              </div>
            </div>

            <div className="admin-column">
              <div className="admin-section output-section full-height">
                <h3>Generated Summary {briefSummary && <span className="result-badge">Ready</span>}</h3>
                <div className={`summary-preview large ${briefSummary ? 'has-content' : ''}`}>
                  {briefSummary || 'Upload briefs and click "Generate Summary" to see the output...'}
                </div>
                {briefSummary && (
                  <div className="next-step-hint">
                    Summary ready! Move to <strong>Tab 2</strong> to generate seed questions.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Seed Questions - Uses summary from Tab 1 */}
        {activeTab === 'seed' && (
          <div className="admin-layout">
            <div className="admin-column">
              {/* Show summary from previous step */}
              <div className="admin-section prereq-section">
                <h3>From Step 1: Brief Summary {briefSummary ? <span className="result-badge">Ready</span> : <span className="result-badge missing">Missing</span>}</h3>
                {briefSummary ? (
                  <div className="summary-preview small has-content">
                    {briefSummary}
                  </div>
                ) : (
                  <div className="prereq-missing">
                    <p>No summary generated yet.</p>
                    <button className="btn-secondary" onClick={() => setActiveTab('summarization')}>
                      Go to Tab 1 to generate summary
                    </button>
                  </div>
                )}
              </div>

              <div className="admin-section">
                <h3>Seed Generation Prompt</h3>
                <p className="hint">
                  Edit how seed questions are generated from the briefs.
                </p>
                <textarea
                  className="code-textarea"
                  value={seedPrompt}
                  onChange={(e) => setSeedPrompt(e.target.value)}
                  rows={12}
                />
                <button 
                  className="btn-primary-large"
                  onClick={testSeedGeneration}
                  disabled={loadingSeed || !appellantBrief || !appelleeBrief}
                >
                  {loadingSeed ? <><span className="spinner" /> Generating...</> : 'Generate Seed Questions'}
                </button>
              </div>
            </div>

            <div className="admin-column">
              <div className="admin-section output-section full-height">
                <h3>Generated Questions {seedQuestions && <span className="result-badge">Ready</span>}</h3>
                <pre className={seedQuestions ? 'has-content' : ''}>{seedQuestions || 'Click "Generate Seed Questions" to see output...'}</pre>
                {seedQuestions && (
                  <div className="next-step-hint">
                    Questions ready! Move to <strong>Tab 3</strong> to test real-time synthesis.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Real-time Synthesis - Shows all inputs and lets you test */}
        {activeTab === 'synthesis' && (
          <div className="admin-layout synthesis-layout">
            {/* Left column: All the inputs */}
            <div className="admin-column inputs-column">
              <h3 className="column-title">Synthesis Inputs</h3>
              <p className="column-hint">These values will fill the template variables. Edit as needed.</p>
              
              {/* Case Context - from Tab 1 */}
              <div className="input-block">
                <div className="input-label">
                  <span>Case Context</span>
                  <code className="var-tag">{'{{BRIEF_SUMMARY}}'}</code>
                  {briefSummary ? (
                    <span className="input-status ready">From Tab 1</span>
                  ) : (
                    <button className="btn-link" onClick={() => setActiveTab('summarization')}>Generate in Tab 1</button>
                  )}
                </div>
                <textarea
                  className="input-textarea readonly"
                  value={briefSummary || 'No summary generated yet. Go to Tab 1 to generate.'}
                  readOnly
                  rows={4}
                />
              </div>

              {/* Seed Questions - from Tab 2 */}
              <div className="input-block">
                <div className="input-label">
                  <span>Seed Questions</span>
                  <code className="var-tag">{'{{SEED_QUESTIONS}}'}</code>
                  {seedQuestions ? (
                    <span className="input-status ready">From Tab 2</span>
                  ) : (
                    <button className="btn-link" onClick={() => setActiveTab('seed')}>Generate in Tab 2</button>
                  )}
                </div>
                <textarea
                  className="input-textarea readonly"
                  value={seedQuestions || 'No questions generated yet. Go to Tab 2 to generate.'}
                  readOnly
                  rows={4}
                />
              </div>

              {/* Test Transcript - editable */}
              <div className="input-block">
                <div className="input-label">
                  <span>Live Transcript</span>
                  <code className="var-tag">{'{{TRANSCRIPT}}'}</code>
                  <span className="input-status editable">Editable</span>
                </div>
                <textarea
                  className="input-textarea"
                  placeholder="Simulate what the advocate is saying..."
                  value={testTranscript}
                  onChange={(e) => setTestTranscript(e.target.value)}
                  rows={5}
                />
              </div>

              {/* Already Asked - editable */}
              <div className="input-block">
                <div className="input-label">
                  <span>Already Asked</span>
                  <code className="var-tag">{'{{ASKED_QUESTIONS}}'}</code>
                  <span className="input-status editable">Editable</span>
                </div>
                <textarea
                  className="input-textarea"
                  placeholder='["What about the precedent in Smith v. Jones?"]'
                  value={alreadyAsked}
                  onChange={(e) => setAlreadyAsked(e.target.value)}
                  rows={2}
                />
                <p className="input-hint">JSON array of questions already asked this session</p>
              </div>
            </div>

            {/* Middle column: Prompt template */}
            <div className="admin-column prompt-column">
              <h3 className="column-title">Synthesis Prompt Template</h3>
              <p className="column-hint">Edit the prompt structure. Variables above will be substituted.</p>
              
              <textarea
                className="code-textarea full-height"
                value={synthesisPrompt}
                onChange={(e) => setSynthesisPrompt(e.target.value)}
              />
              
              <button 
                className="btn-primary-large"
                onClick={testSynthesis}
                disabled={loadingSynthesis || !testTranscript}
              >
                {loadingSynthesis ? <><span className="spinner" /> Analyzing...</> : 'Test Synthesis'}
              </button>
            </div>

            {/* Right column: Result */}
            <div className="admin-column result-column">
              <h3 className="column-title">Result {synthesisResult && <span className="result-badge">Ready</span>}</h3>
              <p className="column-hint">The judge's decision on whether to interrupt.</p>
              
              <div className="admin-section output-section full-height">
                <pre className={synthesisResult ? 'has-content' : ''}>{synthesisResult || 'Click "Test Synthesis" to see how the judge would respond to this transcript...'}</pre>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
