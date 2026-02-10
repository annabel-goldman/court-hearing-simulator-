import { useState } from 'react'
import { Link } from 'react-router-dom'

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

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || ''
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''

type Provider = 'openai' | 'gemini'

export default function JudgeAdmin() {
  // Prompt editors
  const [seedPrompt, setSeedPrompt] = useState(DEFAULT_SEED_PROMPT)
  const [synthesisPrompt, setSynthesisPrompt] = useState(DEFAULT_SYNTHESIS_PROMPT)
  
  // Test inputs
  const [appellantBrief, setAppellantBrief] = useState('')
  const [appelleeBrief, setAppelleeBrief] = useState('')
  const [testTranscript, setTestTranscript] = useState('')
  
  // Generated outputs
  const [seedQuestions, setSeedQuestions] = useState<string>('')
  const [synthesisResult, setSynthesisResult] = useState<string>('')
  
  // UI state
  const [activeTab, setActiveTab] = useState<'seed' | 'synthesis'>('seed')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState<Provider>(OPENAI_API_KEY ? 'openai' : 'gemini')

  const testSeedGeneration = async () => {
    if (!appellantBrief.trim() || !appelleeBrief.trim()) {
      setError('Please provide both briefs for seed generation')
      return
    }

    const apiKey = provider === 'openai' ? OPENAI_API_KEY : GEMINI_API_KEY
    if (!apiKey) {
      setError(`${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key not configured`)
      return
    }

    setLoading(true)
    setError('')
    setSeedQuestions('')

    const fullPrompt = seedPrompt
      .replace('{{APPELLANT_BRIEF}}', appellantBrief)
      .replace('{{APPELLEE_BRIEF}}', appelleeBrief)

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
            max_tokens: 4096,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'API request failed')
        responseText = data.choices?.[0]?.message?.content || ''
      } else {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: fullPrompt }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
            }),
          }
        )
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'API request failed')
        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      }

      setSeedQuestions(responseText)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const testSynthesis = async () => {
    if (!testTranscript.trim()) {
      setError('Please provide a test transcript')
      return
    }

    const apiKey = provider === 'openai' ? OPENAI_API_KEY : GEMINI_API_KEY
    if (!apiKey) {
      setError(`${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key not configured`)
      return
    }

    setLoading(true)
    setError('')
    setSynthesisResult('')

    const fullPrompt = synthesisPrompt
      .replace('{{TRANSCRIPT}}', testTranscript)
      .replace('{{SEED_QUESTIONS}}', seedQuestions || 'No seed questions generated yet.')
      .replace('{{BRIEF_SUMMARY}}', `Appellant: ${appellantBrief.slice(0, 500)}...\nAppellee: ${appelleeBrief.slice(0, 500)}...`)
      .replace('{{ASKED_QUESTIONS}}', 'None yet.')

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
            max_tokens: 1024,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'API request failed')
        responseText = data.choices?.[0]?.message?.content || ''
      } else {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: fullPrompt }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
            }),
          }
        )
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'API request failed')
        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      }

      setSynthesisResult(responseText)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
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

      <div className="admin-header">
        <div className="provider-toggle">
          <span className="provider-label">AI Provider:</span>
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
      </div>

      <div className="admin-tabs">
        <button 
          className={`tab ${activeTab === 'seed' ? 'active' : ''}`}
          onClick={() => setActiveTab('seed')}
        >
          Seed Generation
        </button>
        <button 
          className={`tab ${activeTab === 'synthesis' ? 'active' : ''}`}
          onClick={() => setActiveTab('synthesis')}
        >
          Real-time Synthesis
        </button>
      </div>

      <main className="admin-main">
        {error && <div className="error-banner">{error}</div>}

        {activeTab === 'seed' && (
          <div className="admin-layout">
            <div className="admin-column">
              <div className="admin-section">
                <h3>Seed Generation Prompt</h3>
                <p className="hint">
                  Variables: <code>{'{{APPELLANT_BRIEF}}'}</code>, <code>{'{{APPELLEE_BRIEF}}'}</code>
                </p>
                <textarea
                  className="code-textarea"
                  value={seedPrompt}
                  onChange={(e) => setSeedPrompt(e.target.value)}
                  rows={15}
                />
              </div>

              <div className="admin-section">
                <h3>Test Briefs</h3>
                <div className="brief-inputs">
                  <div className="brief-input">
                    <label>Appellant Brief</label>
                    <textarea
                      placeholder="Paste appellant brief text..."
                      value={appellantBrief}
                      onChange={(e) => setAppellantBrief(e.target.value)}
                      rows={6}
                    />
                  </div>
                  <div className="brief-input">
                    <label>Appellee Brief</label>
                    <textarea
                      placeholder="Paste appellee brief text..."
                      value={appelleeBrief}
                      onChange={(e) => setAppelleeBrief(e.target.value)}
                      rows={6}
                    />
                  </div>
                </div>
                <button 
                  className="btn-primary-large"
                  onClick={testSeedGeneration}
                  disabled={loading}
                >
                  {loading ? <><span className="spinner" /> Generating...</> : 'Generate Seed Questions'}
                </button>
              </div>
            </div>

            <div className="admin-column">
              <div className="admin-section output-section">
                <h3>Generated Questions</h3>
                <pre>{seedQuestions || 'Run seed generation to see output...'}</pre>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'synthesis' && (
          <div className="admin-layout">
            <div className="admin-column">
              <div className="admin-section">
                <h3>Synthesis Prompt</h3>
                <p className="hint">
                  Variables: <code>{'{{TRANSCRIPT}}'}</code>, <code>{'{{SEED_QUESTIONS}}'}</code>, <code>{'{{BRIEF_SUMMARY}}'}</code>, <code>{'{{ASKED_QUESTIONS}}'}</code>
                </p>
                <textarea
                  className="code-textarea"
                  value={synthesisPrompt}
                  onChange={(e) => setSynthesisPrompt(e.target.value)}
                  rows={12}
                />
              </div>

              <div className="admin-section">
                <h3>Test Transcript</h3>
                <textarea
                  placeholder="Simulate what the user is saying..."
                  value={testTranscript}
                  onChange={(e) => setTestTranscript(e.target.value)}
                  rows={6}
                />
                <button 
                  className="btn-primary-large"
                  onClick={testSynthesis}
                  disabled={loading}
                >
                  {loading ? <><span className="spinner" /> Analyzing...</> : 'Test Interruption'}
                </button>
              </div>
            </div>

            <div className="admin-column">
              <div className="admin-section output-section">
                <h3>Synthesis Result</h3>
                <pre>{synthesisResult || 'Run synthesis test to see output...'}</pre>
              </div>

              {seedQuestions && (
                <div className="admin-section">
                  <h3>Current Seed Questions</h3>
                  <pre className="seed-preview">{seedQuestions.slice(0, 1000)}...</pre>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
