import { explainChatTools, shouldExposeTools } from '../src/mcp/toolGate';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function main() {
  const gemma = explainChatTools({
    toolsEnabled: false,
    enabledServerCount: 2,
    connectedToolCount: 5,
    capability: 'absent',
  });
  assert(
    gemma.kind === 'modelUnsupported',
    'a model without tools is explained even if servers are connected'
  );
  assert(shouldExposeTools(false, false) === false, 'switch off does not expose tools');
  assert(shouldExposeTools(true, false) === false, 'unsupported model does not expose tools');

  const switchedOff = explainChatTools({
    toolsEnabled: false,
    enabledServerCount: 1,
    connectedToolCount: 3,
    capability: 'tools',
  });
  assert(
    switchedOff.kind === 'switchOff',
    'a capable model still stays off until the master switch'
  );

  const pending = explainChatTools({
    toolsEnabled: true,
    enabledServerCount: 1,
    connectedToolCount: 3,
    capability: 'pending',
  });
  assert(pending.kind === 'modelPending', 'unknown detection does not pretend tools are sent');

  const unknown = explainChatTools({
    toolsEnabled: true,
    enabledServerCount: 1,
    connectedToolCount: 3,
    capability: 'unknown',
  });
  assert(unknown.kind === 'modelUnknown', 'failed capability detection does not send tools');

  const idle = explainChatTools({
    toolsEnabled: true,
    enabledServerCount: 1,
    connectedToolCount: 0,
    capability: 'tools',
  });
  assert(idle.kind === 'noTools', 'a capable model with no live tools is not described as ready');

  const ready = explainChatTools({
    toolsEnabled: true,
    enabledServerCount: 1,
    connectedToolCount: 40,
    capability: 'tools',
  });
  assert(ready.kind === 'active' && ready.count === 32, 'ready tools are capped at 32');
  assert(
    shouldExposeTools(true, true) === true,
    'switch on and tools capability expose the registry'
  );

  const quiet = explainChatTools({
    toolsEnabled: false,
    enabledServerCount: 0,
    connectedToolCount: 0,
    capability: 'absent',
  });
  assert(quiet.kind === 'hidden', 'plain chat without MCP stays quiet');

  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('tool gate fixtures passed');
}

main();
