import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

import { normalizeStoredMcpServers, type McpServerRecord } from '@/mcp/types';

type McpState = {
  servers: McpServerRecord[];
  loaded: boolean;
  toolsEnabled: boolean;
};

const initialState: McpState = {
  servers: [],
  loaded: false,
  toolsEnabled: false,
};

export const initializeMcp = createAsyncThunk('mcp/initialize', async () => {
  const stored = await chrome.storage.local.get(['mcpServers', 'mcpToolsEnabled']);
  return {
    servers: normalizeStoredMcpServers(stored.mcpServers),
    toolsEnabled: stored.mcpToolsEnabled === true,
  };
});

const mcpSlice = createSlice({
  name: 'mcp',
  initialState,
  reducers: {
    setMcpServers(state, action: PayloadAction<McpServerRecord[]>) {
      state.servers = action.payload;
      state.loaded = true;
    },
    setMcpToolsEnabled(state, action: PayloadAction<boolean>) {
      state.toolsEnabled = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(initializeMcp.fulfilled, (state, action) => {
      state.servers = action.payload.servers;
      state.toolsEnabled = action.payload.toolsEnabled;
      state.loaded = true;
    });
  },
});

export const { setMcpServers, setMcpToolsEnabled } = mcpSlice.actions;
export default mcpSlice;
