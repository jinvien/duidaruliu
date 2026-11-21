import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'wxt';

const piMcpRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  'node_modules/@earendil-works/pi-mcp'
);

const bufferByteLengthShim = `if (typeof globalThis.Buffer === 'undefined' || typeof globalThis.Buffer.byteLength !== 'function') {
  const byteLength = (value) => {
    if (typeof value === 'string') return new TextEncoder().encode(value).length;
    if (value instanceof Uint8Array) return value.byteLength;
    return new TextEncoder().encode(String(value)).length;
  };
  globalThis.Buffer = Object.assign(globalThis.Buffer ?? {}, { byteLength });
}
`;

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  extensionApi: 'chrome',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [
      {
        name: 'pi-mcp-browser-entry',
        enforce: 'pre',
        resolveId(id) {
          if (id === '@earendil-works/pi-mcp') return '\0pi-mcp-browser';
          if (
            id === '@earendil-works/pi-mcp/oauth' ||
            id.startsWith('@earendil-works/pi-mcp/oauth/')
          ) {
            return '\0pi-mcp-oauth-blocked';
          }
          return null;
        },
        load(id) {
          if (id === '\0pi-mcp-oauth-blocked') {
            throw new Error('@earendil-works/pi-mcp/oauth is not available in this extension');
          }
          if (id !== '\0pi-mcp-browser') return null;
          return [
            `export { McpClient } from ${JSON.stringify(join(piMcpRoot, 'dist/client.js'))};`,
            `export { validateMcpServerConfig } from ${JSON.stringify(join(piMcpRoot, 'dist/config.js'))};`,
            `export { StreamableHttpTransport } from ${JSON.stringify(join(piMcpRoot, 'dist/transports/streamable-http.js'))};`,
          ].join('\n');
        },
      },
      {
        name: 'buffer-bytelength-shim',
        enforce: 'pre',
        transform(code, id) {
          if (!id.includes('@earendil-works/pi-mcp') || !code.includes('Buffer.byteLength')) {
            return null;
          }
          return `${bufferByteLengthShim}\n${code}`;
        },
      },
    ],
  }),
  manifest: {
    name: '__MSG_name__',
    description: '__MSG_description__',
    version: '0.0.4',
    default_locale: 'zh_CN',
    permissions: [
      'sidePanel',
      'storage',
      'unlimitedStorage',
      'contextMenus',
      'declarativeNetRequest',
      'activeTab',
    ],
    host_permissions: ['http://*/*', 'https://*/*'],
    commands: {
      _execute_action: {
        suggested_key: {
          default: 'Ctrl+B',
          mac: 'Command+B',
        },
      },
    },
    action: {
      default_title: '__MSG_openDDRL__',
    },
  },
});
