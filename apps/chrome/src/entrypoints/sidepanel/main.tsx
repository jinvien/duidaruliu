import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { ChatRoot, installChatHost, mcpPageOwnsRuntime } from '@ddrl/chat';

import {
  bindChromeOriginRules,
  clearMcpOriginRules,
  createChromeHost,
  startChromeMcpBridge,
} from '@/platform/chromeHost';

const ownsRuntime = mcpPageOwnsRuntime(new URLSearchParams(window.location.search).get('appMode'));

installChatHost(createChromeHost(ownsRuntime));

const ChromeShell = () => {
  useEffect(() => {
    const unbindOrigin = bindChromeOriginRules(ownsRuntime);
    const stopBridge = ownsRuntime ? startChromeMcpBridge() : undefined;
    return () => {
      unbindOrigin();
      stopBridge?.();
    };
  }, []);

  return (
    <ChatRoot
      ownsRuntime={ownsRuntime}
      onRuntimeStop={ownsRuntime ? clearMcpOriginRules : undefined}
    />
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChromeShell />
  </React.StrictMode>,
);
