import {
  createMcpToolName,
  limitMcpContent,
  normalizeMcpInputSchema,
  toLlmContent,
} from '@earendil-works/pi-mcp';

import { OLLAMA_TOOL_IMAGE_NOTE } from '@/utils/ollamaMessage';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { CallableMcpTool } from './session';

export const MCP_MODEL_TOOL_CAP = 32;

const TOOL_REJECTED_REASON = '用户拒绝了这次工具调用，工具没有执行。';
const TOOL_ABORTED_REASON = '对话已取消，这次工具调用没有执行。';

export function modelToolText(blocks: readonly { type: string; text?: string }[]): string {
  return blocks
    .map((block) => (block.type === 'image' ? OLLAMA_TOOL_IMAGE_NOTE : (block.text ?? '')))
    .filter((text) => text.length > 0)
    .join('\n');
}

export function buildAgentTools(tools: CallableMcpTool[]): AgentTool[] {
  const taken = new Set<string>();
  return tools.slice(0, MCP_MODEL_TOOL_CAP).map((tool) => {
    const name = createMcpToolName(tool.serverName, tool.name, (candidate) => taken.has(candidate));
    taken.add(name);
    const displayName = tool.title || tool.name;
    const agentTool: AgentTool = {
      name,
      label: displayName,
      description: tool.description || displayName,
      parameters: normalizeMcpInputSchema(tool.inputSchema ?? {}),
      execute: async (_toolCallId, params, signal) => {
        const args =
          params && typeof params === 'object' && !Array.isArray(params)
            ? (params as Record<string, unknown>)
            : {};
        const result = await tool.call(args, signal);
        const limited = await limitMcpContent(
          toLlmContent({
            content: Array.isArray(result.content) ? result.content : [],
            structuredContent: result.structuredContent,
          } as Parameters<typeof toLlmContent>[0])
        );
        const text = modelToolText(limited.content);
        return {
          content: [{ type: 'text', text }],
          details: {
            serverName: tool.serverName,
            displayName,
            isError: result.isError === true,
          },
          isError: result.isError === true,
        };
      },
    };
    return agentTool;
  });
}

export function toolRejectedReason() {
  return TOOL_REJECTED_REASON;
}

export function toolAbortedReason() {
  return TOOL_ABORTED_REASON;
}

/** 取消必须拦住调用。返回 undefined 会被 pi-agent-core 当成允许。 */
export function blockReasonForToolDecision(
  decision: 'once' | 'session' | 'reject' | 'aborted' | undefined,
  signalAborted: boolean
): string | undefined {
  if (signalAborted || decision === 'aborted') return toolAbortedReason();
  if (decision === 'reject') return toolRejectedReason();
  return undefined;
}
