import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Handle GitHub Pages SPA redirect
// When 404.html redirects to index, it stores the intended path in sessionStorage
const spaRedirect = sessionStorage.getItem('spa-redirect');
if (spaRedirect) {
  sessionStorage.removeItem('spa-redirect');
  // Extract the path relative to base URL
  const basePath = import.meta.env.BASE_URL || '/';
  const relativePath = spaRedirect.replace(basePath.replace(/\/$/, ''), '');
  if (relativePath && relativePath !== '/') {
    // Use replaceState to update the URL without a page reload
    window.history.replaceState(null, '', basePath + relativePath.replace(/^\//, ''));
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
