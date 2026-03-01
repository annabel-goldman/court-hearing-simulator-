import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import CourtroomPage from './pages/CourtroomPage'
import JudgeAdmin from './pages/JudgeAdmin'
import SessionAuditPage from './pages/SessionAuditPage'
import AuthGate from './components/AuthGate'
import { AgentSimulation } from './multi-agent'

function App() {
  return (
    <AuthGate>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          {/* Home page for brief uploads, then redirects to courtroom */}
          <Route path="/" element={<Home />} />
          <Route path="/courtroom" element={<CourtroomPage />} />
          <Route path="/session-audit" element={<SessionAuditPage />} />
          <Route path="/admin/judge" element={<JudgeAdmin />} />
          {/* Multi-Agent Simulation - separate project */}
          <Route path="/multi-agent" element={<AgentSimulation />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  )
}

export default App
