import { useState, useEffect, FormEvent } from 'react'

// SHA-256 hash of the password
const PASSWORD_HASH = '96fdcfb45ad799ac0faf0a94e129d8eb4eb0c9d3dd8bfa126d8351f041cd563d'

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

interface AuthGateProps {
  children: React.ReactNode
}

export default function AuthGate({ children }: AuthGateProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check if already authenticated in this session
    const auth = sessionStorage.getItem('court_sim_auth')
    if (auth === 'true') {
      setIsAuthenticated(true)
    }
    setLoading(false)
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    const hash = await hashPassword(password)
    
    if (hash === PASSWORD_HASH) {
      sessionStorage.setItem('court_sim_auth', 'true')
      setIsAuthenticated(true)
    } else {
      setError('Incorrect password')
      setPassword('')
    }
  }

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="spinner" />
      </div>
    )
  }

  if (isAuthenticated) {
    return <>{children}</>
  }

  return (
    <div className="auth-gate">
      <div className="auth-card">
        <h1>Court Simulator</h1>
        <p>Enter password to continue</p>
        
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
          />
          <button type="submit" disabled={!password}>
            Enter
          </button>
        </form>
        
        {error && <div className="auth-error">{error}</div>}
      </div>
    </div>
  )
}
