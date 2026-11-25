import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  ChatRoot,
  installChatHost,
  setServiceFetch,
  store,
  SHELL_MODE_EVENT,
} from '@ddrl/chat';
import { createWebServiceFetch } from '../dev/serviceFetch';
import { createIndexedDbStorage } from './idbStorage';

import './preview.css';

const localHost =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname === '[::1]' ||
  window.location.hostname === '::1';

installChatHost({
  storage: createIndexedDbStorage(),
  layout: 'desktop',
  openSettings() {
    const url = new URL(window.location.href);
    url.searchParams.set('appMode', 'setting');
    window.history.pushState({}, '', url);
    window.dispatchEvent(new Event(SHELL_MODE_EVENT));
  },
});

setServiceFetch(
  createWebServiceFetch(() => {
    const state = store.getState();
    return { ollamaUrl: state.ollama.ollamaUrl, servers: state.mcp.servers };
  }),
);

const Preview = () => (
  <div className="preview-page">
    {localHost ? null : (
      <p className="preview-note">
        公开站点访问不到你电脑上的 Ollama 或 MCP。本地预览请运行 pnpm --filter web dev，然后打开
        /app.html。
      </p>
    )}
    <div className="preview-frame">
      <ChatRoot ownsRuntime />
    </div>
  </div>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
