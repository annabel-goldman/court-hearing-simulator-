import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Playground from './pages/Playground'
import Avatar from './pages/Avatar'
import AuthGate from './components/AuthGate'
import './index.css'

function App() {
  return (
    <AuthGate>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/avatar" element={<Avatar />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  )
}

export default App
