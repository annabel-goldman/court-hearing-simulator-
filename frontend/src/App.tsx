import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import CourtroomPage from './pages/CourtroomPage'
import ThreeDPage from './pages/ThreeDPage'
import SessionAuditPage from './pages/SessionAuditPage'
import JudgeAdmin from './pages/JudgeAdmin'
import OrchestratedAgents from './pages/OrchestratedAgents'
import AuthGate from './components/AuthGate'
import { AgentSimulation } from './multi-agent'

function App() {
  return (
    <AuthGate>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/3d" element={<ThreeDPage />} />
          <Route path="/courtroom" element={<CourtroomPage />} />
          <Route path="/session-audit" element={<SessionAuditPage />} />
          <Route path="/admin/judge" element={<JudgeAdmin />} />
          <Route path="/orchestrated-agents" element={<OrchestratedAgents />} />
          <Route path="/multi-agent" element={<AgentSimulation />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  )
}

export default App
