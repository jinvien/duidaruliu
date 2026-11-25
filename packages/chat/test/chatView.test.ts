import {
  answerModelName,
  groupChatBlocks,
  lastAnswerModel,
  readableToolName,
} from '../src/utils/chatView';

import type { Message } from '../src/store/chatSlice';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function message(partial: Partial<Message> & Pick<Message, 'role' | 'content'>): Message {
  return { createdAt: 1, ...partial };
}

function main() {
  const blocks = groupChatBlocks(
    [
      message({ role: 'user', content: '有哪些工具' }),
      message({
        role: 'assistant',
        content: '我先列出来',
        model: 'qwen3.5',
        thinking: '先看列表',
      }),
      message({
        role: 'tool',
        content: '{"raw":true}',
        toolName: 'mcp__exa_search__web_search_exa',
        toolDisplayName: 'Web Search',
      }),
      message({ role: 'assistant', content: '搜索结果是这样', model: 'unknown' }),
      message({ role: 'user', content: '再问一次' }),
      message({ role: 'assistant', content: '第二次回答', model: 'qwen3.5' }),
    ],
    'qwen3.5'
  );
  assert(blocks.length === 4, 'two user questions stay separate from one assistant turn');
  const turn = blocks[1];
  assert(turn?.kind === 'assistant', 'tool follow-up stays in the assistant turn');
  if (turn?.kind === 'assistant') {
    assert(turn.model === 'qwen3.5', 'unknown follow-up model does not replace the header');
    assert(turn.segments.length === 3, 'text, tool, and follow-up text are one sequence');
    assert(turn.copyText === '我先列出来\n\n搜索结果是这样', 'copy keeps answers only');
    assert(!turn.copyText.includes('先看列表'), 'copy omits thinking');
    assert(!turn.copyText.includes('raw'), 'copy omits tool output');
    assert(
      turn.segments[1]?.type === 'tool' && turn.segments[1].name === 'Web Search',
      'display name wins'
    );
  }
  const second = blocks[3];
  assert(
    second?.kind === 'assistant' && second.copyText === '第二次回答',
    'the next question is its own turn'
  );

  assert(
    readableToolName(undefined, 'mcp__exa_search__web_search_exa') === 'Web Search Exa',
    'raw mcp name falls back to the tool segment'
  );
  assert(readableToolName('unknown', 'unknown') === '', 'unknown is never a visible tool name');
  assert(
    readableToolName('web_search_exa', 'mcp__exa_search__web_search_exa') === 'Web Search Exa',
    'snake-case titles are readable'
  );

  const history = groupChatBlocks([
    message({ role: 'user', content: '旧问题' }),
    message({ role: 'assistant', content: '旧回答', model: 'qwen3.5' }),
    message({ role: 'tool', content: '结果', toolName: 'mcp__deepwiki__ask_wiki_question' }),
  ]);
  const replay = history[1];
  assert(
    replay?.kind === 'assistant' &&
      replay.segments[1]?.type === 'tool' &&
      replay.segments[1].name === 'Ask Wiki Question',
    'history without a display name still reads as one turn'
  );

  const placeholder = groupChatBlocks([
    message({ role: 'user', content: '问' }),
    message({
      role: 'assistant',
      content: '',
      model: 'qwen3.5',
      toolCalls: [{ id: '1', name: 'web_search_exa', arguments: {} }],
    }),
    message({
      role: 'tool',
      content: '结果',
      toolName: 'web_search_exa',
      toolDisplayName: 'Web Search',
    }),
    message({ role: 'assistant', content: '完成', model: 'unknown' }),
  ]);
  const held = placeholder[1];
  assert(
    held?.kind === 'assistant' &&
      held.segments.length === 2 &&
      held.segments[0]?.type === 'tool' &&
      held.copyText === '完成',
    'an empty tool-call placeholder stays inside the same answer'
  );

  const historyMessages = [
    message({ role: 'user', content: '旧问题' }),
    message({ role: 'assistant', content: '旧回答', model: 'qwen2.5' }),
    message({ role: 'assistant', content: '跟进', model: 'unknown' }),
  ];
  assert(lastAnswerModel(historyMessages, 'unknown') === 'qwen2.5', 'tag skips a trailing unknown');
  assert(
    lastAnswerModel(
      [message({ role: 'assistant', content: '只有未知', model: 'unknown' })],
      'unknown'
    ) === '',
    'an unknown-only history has no tag'
  );
  assert(
    lastAnswerModel(
      [message({ role: 'assistant', content: '实名', model: 'llama3.1' })],
      'llama3.1'
    ) === 'llama3.1',
    'a stored real model stays on the tag'
  );
  assert(answerModelName('unknown') === '', 'unknown is not restored onto the selector');
  assert(answerModelName('  unknown  ') === '', 'padded unknown is not a model');
  assert(answerModelName(' qwen2.5 ') === 'qwen2.5', 'a real lastModel is restored as stored');
  assert(answerModelName('') === '', 'an empty lastModel does not change the selector');

  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('chat view fixtures passed');
}

main();
