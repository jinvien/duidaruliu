import { defineConfig } from 'wxt';
import { piMcpBrowserPlugins } from '@ddrl/chat/vite/pi-mcp';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  extensionApi: 'chrome',
  modules: ['@wxt-dev/module-react'],
  runner: {
    disabled: true,
  },
  vite: () => ({
    plugins: piMcpBrowserPlugins(),
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
      'scripting',
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
