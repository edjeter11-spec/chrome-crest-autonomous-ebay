import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerSW } from './lib/push'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Register service worker (for push notifications)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { registerSW() })
}
