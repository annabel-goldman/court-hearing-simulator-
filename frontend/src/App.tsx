import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import CourtroomPage from './pages/CourtroomPage'
import ThreeDPage from './pages/ThreeDPage'
import SessionAuditPage from './pages/SessionAuditPage'
import OrchestratedAgents from './pages/OrchestratedAgents'
import AuthGate from './components/AuthGate'
import { AgentSimulation } from './multi-agent'

function App() {
  return (
    <AuthGate>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          {/* Home page for brief uploads, then redirects to courtroom */}
          <Route path="/" element={<Home />} />
          <Route path="/3d" element={<ThreeDPage />} />
          <Route path="/courtroom" element={<CourtroomPage />} />
          <Route path="/session-audit" element={<SessionAuditPage />} />
          <Route path="/orchestrated-agents" element={<OrchestratedAgents />} />
          {/* Multi-Agent Simulation - separate project */}
          <Route path="/multi-agent" element={<AgentSimulation />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  )
}

export default App
