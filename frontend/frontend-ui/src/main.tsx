import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AdminApp from './AdminApp.tsx'
import { experienceForPathname } from './appRoute'

const experience = experienceForPathname(window.location.pathname)
document.title = experience === 'admin'
  ? '智能体攻防实验室 · 管理员后台'
  : '智能体攻防实验室 · 公开体验'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {experience === 'admin' ? <AdminApp /> : <App />}
  </StrictMode>,
)
