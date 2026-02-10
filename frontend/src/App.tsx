import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Avatar from './pages/Avatar'
import JudgeAdmin from './pages/JudgeAdmin'
import AuthGate from './components/AuthGate'

function App() {
  return (
    <AuthGate>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          {/* Home page for brief uploads, then redirects to courtroom */}
          <Route path="/" element={<Home />} />
          <Route path="/courtroom" element={<Avatar />} />
          <Route path="/admin/judge" element={<JudgeAdmin />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  )
}

export default App
