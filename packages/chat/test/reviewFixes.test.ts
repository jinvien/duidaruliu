import { composerCanSend } from '../src/pages/chat/composer';
import { mcpPageOwnsRuntime, readMcpLocalChange, rewriteOriginForSave } from '../src/mcp/page';
import { blockReasonForToolDecision } from '../src/mcp/tools';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function main() {
  assert(mcpPageOwnsRuntime(null) === true, 'the side panel with no query owns MCP');
  assert(mcpPageOwnsRuntime('') === true, 'an empty app mode owns MCP');
  assert(mcpPageOwnsRuntime('chat') === true, 'chat owns MCP');
  assert(mcpPageOwnsRuntime('setting') === false, 'the settings tab does not open a second client');
  assert(
    mcpPageOwnsRuntime('https://example.com') === true,
    'an in-panel link does not count as the settings tab'
  );

  assert(readMcpLocalChange('sync', { mcpServers: { newValue: [] } }) === null, 'sync is ignored');
  assert(
    readMcpLocalChange('local', { ollamaSettings: { newValue: {} } }) === null,
    'other local keys are ignored'
  );
  const stored = readMcpLocalChange('local', {
    mcpServers: {
      newValue: [
        {
          name: 'docs',
          url: 'http://127.0.0.1:8080/mcp',
          headers: [],
          enabled: true,
          timeout: 30,
          rewriteOrigin: true,
        },
      ],
    },
    mcpToolsEnabled: { newValue: true },
  });
  assert(stored?.toolsEnabled === true, 'the master switch reaches the open panel');
  assert(stored?.servers?.[0]?.name === 'docs', 'saved servers reach the open panel');
  assert(
    readMcpLocalChange('local', { mcpToolsEnabled: { newValue: false } })?.toolsEnabled === false,
    'turning the switch off reaches the open panel'
  );

  assert(
    rewriteOriginForSave('http://127.0.0.1:8080/mcp', false, false) === true,
    'an untouched loopback server rewrites origin on save'
  );
  assert(
    rewriteOriginForSave('https://example.com/mcp', false, false) === false,
    'an untouched remote server stays off'
  );
  assert(
    rewriteOriginForSave('http://127.0.0.1:8080/mcp', false, true) === false,
    'an explicit off switch is kept'
  );

  assert(composerCanSend('end', false, true, true) === true, 'an idle composer can send');
  assert(composerCanSend('waiting', false, true, true) === false, 'waiting blocks a second send');
  assert(
    composerCanSend('end', true, true, true) === false,
    'the first 500ms still blocks send while the status is end'
  );
  assert(composerCanSend('end', false, false, true) === false, 'empty text cannot send');

  const aborted = blockReasonForToolDecision('aborted', false);
  assert(
    Boolean(aborted) && aborted !== blockReasonForToolDecision('reject', false),
    'abort blocks instead of allowing'
  );
  assert(blockReasonForToolDecision('once', true) === aborted, 'an aborted signal blocks an allow');
  assert(blockReasonForToolDecision('once', false) === undefined, 'allow once still runs');
  assert(blockReasonForToolDecision('session', false) === undefined, 'session allow still runs');

  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('review fix fixtures passed');
}

main();
