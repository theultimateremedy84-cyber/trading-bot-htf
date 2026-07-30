import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';

import App from './App';

import './index.css';

// If VITE_API_URL is set at build time (e.g. when the dashboard is deployed
// separately from the API server), prepend it to every API request.
// In single-service Railway deployments where Express serves the dashboard,
// leave VITE_API_URL unset — relative /api/* paths work fine.
const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
if (apiUrl) {
  setBaseUrl(apiUrl);
}

createRoot(document.getElementById('root')!).render(<App />);
