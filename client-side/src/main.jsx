/**
 * Purpose:
 * - Client entrypoint mounting the root React app.
 *
 * Responsibilities:
 * - Load global stylesheet once.
 * - Render `<App />` inside StrictMode for development safeguards.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
