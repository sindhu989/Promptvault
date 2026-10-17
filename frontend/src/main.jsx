import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AdminApp from './AdminApp.jsx'
import VerifyEmail from './VerifyEmail.jsx'

const Application = window.location.pathname.startsWith('/admin')
  ? AdminApp
  : window.location.pathname === '/verify-email'
    ? VerifyEmail
    : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Application />
  </StrictMode>,
)
