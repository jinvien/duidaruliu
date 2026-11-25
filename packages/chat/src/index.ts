export { default as ChatRoot } from './shell/ChatRoot';
export { default as store } from './store';
export { appModeFromLocation, SHELL_MODE_EVENT } from './shell/types';
export { mcpPageOwnsRuntime } from './mcp/page';
export {
  MCP_RUNTIME_PUSH,
  MCP_RUNTIME_QUERY,
} from './mcp/bridge';
export { getMcpRuntime, subscribeMcpRuntime } from './mcp/session';
export {
  createMemoryStorage,
  getChatHost,
  getServiceFetch,
  installChatHost,
  setServiceFetch,
  storageGet,
  storageSet,
} from './host';

export type {
  ChatHost,
  HostCommand,
  KeyValueStorage,
  StorageArea,
  StorageChange,
  StorageItems,
} from './host';
