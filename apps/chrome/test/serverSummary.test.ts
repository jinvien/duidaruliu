import { summarizeSavedServer } from '../src/mcp/serverSummary';

let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function main() {
  assert(
    summarizeSavedServer({ enabled: false }, { status: 'connected', tools: [{}, {}] }).status ===
      'disabled',
    'a disabled server stays disabled even if a runtime says connected'
  );
  assert(
    summarizeSavedServer({ enabled: true }, undefined).status === 'idle' &&
      summarizeSavedServer({ enabled: true }, undefined).toolCount === 0,
    'a missing runtime is not connected'
  );
  const connected = summarizeSavedServer(
    { enabled: true },
    { status: 'connected', tools: [{}, {}, {}] }
  );
  assert(
    connected.status === 'connected' && connected.toolCount === 3,
    'connected row counts tools'
  );
  const empty = summarizeSavedServer({ enabled: true }, { status: 'connected', tools: [] });
  assert(
    empty.status === 'connected' && empty.toolCount === 0,
    'connected with no tools stays a count of zero'
  );
  const error = summarizeSavedServer(
    { enabled: true },
    { status: 'error', tools: [], detail: 'HTTP 500' }
  );
  assert(
    error.status === 'error' && error.detail === 'HTTP 500' && error.toolCount === 0,
    'errors keep a detail off the summary count'
  );
  assert(
    summarizeSavedServer({ enabled: true }, { status: 'connecting', tools: [] }).status ===
      'connecting',
    'connecting is visible'
  );
  assert(
    summarizeSavedServer({ enabled: true }, { status: 'auth', tools: [] }).status === 'auth',
    'auth is visible'
  );
  assert(
    summarizeSavedServer({ enabled: true }, { status: 'stdio', tools: [] }).status === 'stdio',
    'stdio is visible'
  );

  if (failed) throw new Error(`${failed} assertion(s) failed`);
  console.log('server summary fixtures passed');
}

main();
