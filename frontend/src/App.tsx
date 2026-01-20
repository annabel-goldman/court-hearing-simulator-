import { useState } from 'react'
import './index.css'

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

function App() {
  const [briefA, setBriefA] = useState('')
  const [briefB, setBriefB] = useState('')
  const [result, setResult] = useState<ComparisonResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const compareBriefs = async () => {
    if (!briefA.trim() || !briefB.trim()) {
      setError('Please enter text in both briefs')
      return
    }

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const response = await fetch('/api/compare-briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief_a: briefA, brief_b: briefB }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Comparison failed')
      }

      const data = await response.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const getSignificanceColor = (significance: string) => {
    switch (significance) {
      case 'High': return 'var(--sig-high)'
      case 'Medium': return 'var(--sig-medium)'
      case 'Low': return 'var(--sig-low)'
      default: return 'var(--text-muted)'
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Court Simulator</h1>
        <p className="subtitle">Brief Comparison Analysis</p>
      </header>

      <main className="main">
        <section className="briefs-section">
          <div className="brief-input">
            <label htmlFor="brief-a">Brief A</label>
            <textarea
              id="brief-a"
              value={briefA}
              onChange={(e) => setBriefA(e.target.value)}
              placeholder="Paste the first brief here..."
              disabled={loading}
            />
          </div>

          <div className="brief-input">
            <label htmlFor="brief-b">Brief B</label>
            <textarea
              id="brief-b"
              value={briefB}
              onChange={(e) => setBriefB(e.target.value)}
              placeholder="Paste the second brief here..."
              disabled={loading}
            />
          </div>
        </section>

        <button 
          className="compare-btn" 
          onClick={compareBriefs}
          disabled={loading || !briefA.trim() || !briefB.trim()}
        >
          {loading ? (
            <>
              <span className="spinner" />
              Analyzing...
            </>
          ) : (
            'Compare Briefs'
          )}
        </button>

        {error && <div className="error">{error}</div>}

        {result && (
          <section className="results">
            <div className="summary-card">
              <h2>Summary</h2>
              <p>{result.summary}</p>
            </div>

            {result.differences.length > 0 && (
              <div className="differences-section">
                <h2>Semantic Differences</h2>
                <div className="differences-grid">
                  {result.differences.map((diff, index) => (
                    <div key={index} className="diff-card">
                      <div className="diff-header">
                        <span className="diff-category">{diff.category}</span>
                        <span 
                          className="diff-significance"
                          style={{ backgroundColor: getSignificanceColor(diff.significance) }}
                        >
                          {diff.significance}
                        </span>
                      </div>
                      
                      <div className="diff-positions">
                        <div className="position position-a">
                          <span className="position-label">Brief A</span>
                          <p>{diff.brief_a_position}</p>
                        </div>
                        <div className="position position-b">
                          <span className="position-label">Brief B</span>
                          <p>{diff.brief_b_position}</p>
                        </div>
                      </div>

                      <div className="diff-explanation">
                        <span className="explanation-label">Legal Significance</span>
                        <p>{diff.explanation}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.common_ground.length > 0 && (
              <div className="common-ground-section">
                <h2>Common Ground</h2>
                <ul>
                  {result.common_ground.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

export default App
