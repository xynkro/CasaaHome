import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// No <StrictMode>. React-Three-Fiber disposes its renderer on StrictMode's
// simulated unmount, and disposal calls forceContextLoss() on the canvas
// element it then reuses — which can never get a context back. The result is
// a permanently blank 3D view in development only, i.e. exactly where you
// need to look at it. Verified: production builds render fine either way.
createRoot(document.getElementById('root')!).render(
  // Hash routing: GitHub Pages has no SPA rewrite, and deep links must
  // survive a cold PWA launch.
  <HashRouter>
    <App />
  </HashRouter>,
)
