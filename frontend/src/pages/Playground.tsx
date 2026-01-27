import { useState } from 'react'
import { Link } from 'react-router-dom'

const DEFAULT_SYSTEM_PROMPT = `You are a legal analyst comparing two court briefs. Analyze the semantic differences between them.

BRIEF A:
{{BRIEF_A}}

BRIEF B:
{{BRIEF_B}}

Provide your analysis in the following JSON format (respond ONLY with valid JSON, no markdown):
{
    "summary": "A 2-3 sentence overview of the key differences between the briefs",
    "differences": [
        {
            "category": "Category of difference (e.g., 'Legal Argument', 'Facts Presented', 'Relief Sought', 'Precedent Cited', 'Burden of Proof')",
            "brief_a_position": "What Brief A argues or states on this point",
            "brief_b_position": "What Brief B argues or states on this point",
            "significance": "High/Medium/Low - how significant is this difference",
            "explanation": "Why this difference matters legally"
        }
    ],
    "common_ground": ["List of points where both briefs agree or align"]
}

Focus on substantive semantic differences in legal arguments, facts, interpretations, and conclusions. Identify at least 3 differences if they exist.`

interface SemanticDifference {
  category: string
  brief_a_position: string
  brief_b_position: string
  significance: 'High' | 'Medium' | 'Low'
  explanation: string
}

interface ComparisonResult {
  summary: string
  differences: SemanticDifference[]
  common_ground: string[]
}

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash-exp',
]

const OPENAI_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
]

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || ''

type Provider = 'openai' | 'gemini'

export default function Playground() {
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [briefA, setBriefA] = useState('')
  const [briefB, setBriefB] = useState('')
  const [provider, setProvider] = useState<Provider>(OPENAI_API_KEY ? 'openai' : 'gemini')
  const [geminiModel, setGeminiModel] = useState('gemini-2.0-flash')
  const [openaiModel, setOpenaiModel] = useState('gpt-4o-mini')
  const [result, setResult] = useState<ComparisonResult | null>(null)
  const [rawResponse, setRawResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'editor' | 'preview' | 'response'>('editor')

  const buildFullPrompt = () => {
    return systemPrompt
      .replace('{{BRIEF_A}}', briefA || '[Brief A content]')
      .replace('{{BRIEF_B}}', briefB || '[Brief B content]')
  }

  const runPrompt = async () => {
    const apiKey = provider === 'openai' ? OPENAI_API_KEY : GEMINI_API_KEY
    if (!apiKey) {
      setError(`${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key not configured`)
      return
    }
    if (!briefA.trim() || !briefB.trim()) {
      setError('Please enter text in both briefs')
      return
    }

    setLoading(true)
    setError('')
    setResult(null)
    setRawResponse('')

    const fullPrompt = systemPrompt
      .replace('{{BRIEF_A}}', briefA)
      .replace('{{BRIEF_B}}', briefB)

    try {
      let responseText = ''

      if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: openaiModel,
            messages: [{ role: 'user', content: fullPrompt }],
            temperature: 0.7,
            max_tokens: 8192,
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error?.message || 'API request failed')
        }

        responseText = data.choices?.[0]?.message?.content || ''
      } else {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
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

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error?.message || 'API request failed')
        }

        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      }

      setRawResponse(responseText)

      try {
        let cleanedText = responseText.trim()
        if (cleanedText.startsWith('```')) {
          const lines = cleanedText.split('\n')
          cleanedText = lines.slice(1, -1).join('\n')
        }
        const parsed = JSON.parse(cleanedText)
        setResult(parsed)
      } catch {
        // Not valid JSON, that's fine
      }
      setActiveTab('response')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const resetPrompt = () => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)

  const currentModels = provider === 'openai' ? OPENAI_MODELS : GEMINI_MODELS
  const currentModel = provider === 'openai' ? openaiModel : geminiModel
  const setCurrentModel = provider === 'openai' ? setOpenaiModel : setGeminiModel

  return (
    <div className="playground">
      <nav className="nav">
        <Link to="/" className="nav-link">← Back to Home</Link>
        <div className="nav-brand">Prompt Playground</div>
        <div className="nav-spacer" />
      </nav>

      <div className="playground-header">
        <div className="provider-toggle">
          <span className="provider-label">Provider:</span>
          <div className="toggle-group">
            <button
              className={`toggle-btn ${provider === 'openai' ? 'active' : ''}`}
              onClick={() => setProvider('openai')}
              disabled={!OPENAI_API_KEY}
            >
              OpenAI
            </button>
            <button
              className={`toggle-btn ${provider === 'gemini' ? 'active' : ''}`}
              onClick={() => setProvider('gemini')}
              disabled={!GEMINI_API_KEY}
            >
              Gemini
            </button>
          </div>
        </div>

        <div className="model-selector">
          <label>Model</label>
          <select value={currentModel} onChange={(e) => setCurrentModel(e.target.value)}>
            {currentModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="api-status">
          {(provider === 'openai' ? OPENAI_API_KEY : GEMINI_API_KEY) ? (
            <span className="status-ok">API Connected</span>
          ) : (
            <span className="status-error">No API Key</span>
          )}
        </div>
      </div>

      <div className="playground-tabs">
        <button
          className={`tab ${activeTab === 'editor' ? 'active' : ''}`}
          onClick={() => setActiveTab('editor')}
        >
          Editor
        </button>
        <button
          className={`tab ${activeTab === 'preview' ? 'active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          Preview
        </button>
        <button
          className={`tab ${activeTab === 'response' ? 'active' : ''}`}
          onClick={() => setActiveTab('response')}
          disabled={!rawResponse}
        >
          Response
        </button>
      </div>

      <main className="playground-main">
        {activeTab === 'editor' && (
          <div className="editor-layout">
            <div className="prompt-editor">
              <div className="editor-header">
                <label>System Prompt</label>
                <button className="btn-text" onClick={resetPrompt}>Reset</button>
              </div>
              <textarea
                className="code-textarea"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Enter system prompt..."
                disabled={loading}
              />
              <p className="hint">
                Use <code>{'{{BRIEF_A}}'}</code> and <code>{'{{BRIEF_B}}'}</code> as placeholders
              </p>
            </div>

            <div className="briefs-editor">
              <div className="brief-editor">
                <label>Brief A</label>
                <textarea
                  value={briefA}
                  onChange={(e) => setBriefA(e.target.value)}
                  placeholder="Paste first brief..."
                  disabled={loading}
                />
              </div>
              <div className="brief-editor">
                <label>Brief B</label>
                <textarea
                  value={briefB}
                  onChange={(e) => setBriefB(e.target.value)}
                  placeholder="Paste second brief..."
                  disabled={loading}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'preview' && (
          <div className="preview-panel">
            <h3>Full Prompt Preview</h3>
            <pre>{buildFullPrompt()}</pre>
          </div>
        )}

        {activeTab === 'response' && (
          <div className="response-panel">
            <div className="raw-response">
              <h3>Raw Response</h3>
              <pre>{rawResponse}</pre>
            </div>
            {result && (
              <div className="parsed-response">
                <h3>Parsed Result</h3>
                <pre>{JSON.stringify(result, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}
      </main>

      <div className="playground-footer">
        <button
          className="btn-primary-large"
          onClick={runPrompt}
          disabled={loading || !briefA.trim() || !briefB.trim()}
        >
          {loading ? (
            <>
              <span className="spinner" />
              Running...
            </>
          ) : (
            'Run Prompt'
          )}
        </button>
      </div>
    </div>
  )
}
