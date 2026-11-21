import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

import { normalizeStoredMcpServers, type McpServerRecord } from '@/mcp/types';

type McpState = {
  servers: McpServerRecord[];
  loaded: boolean;
};

const initialState: McpState = {
  servers: [],
  loaded: false,
};

export const initializeMcp = createAsyncThunk('mcp/initialize', async () => {
  const stored = await chrome.storage.local.get('mcpServers');
  return normalizeStoredMcpServers(stored.mcpServers);
});

const mcpSlice = createSlice({
  name: 'mcp',
  initialState,
  reducers: {
    setMcpServers(state, action: PayloadAction<McpServerRecord[]>) {
      state.servers = action.payload;
      state.loaded = true;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(initializeMcp.fulfilled, (state, action) => {
      state.servers = action.payload;
      state.loaded = true;
    });
  },
});

export const { setMcpServers } = mcpSlice.actions;
export default mcpSlice;
