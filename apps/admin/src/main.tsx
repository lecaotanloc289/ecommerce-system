import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { authStore } from './auth/session';
import './index.css';

// Silent refresh on boot: the HttpOnly refresh cookie → in-memory access token. Guards show the
// splash until it settles. Single-flight, so `/auth/callback` and StrictMode share this call.
void authStore.getState().restoreSession();

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
