import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const chromeRoot = join(webRoot, '../chrome');

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

const help = spawnSync(process.execPath, ['--help'], { encoding: 'utf8' });
const helpText = `${help.stdout}\n${help.stderr}`;
const nodeArgs = ['--input-type=module'];
if (helpText.includes('--no-experimental-strip-types')) {
  nodeArgs.unshift('--no-experimental-strip-types');
}

const loader = `
  import { createRequire } from 'node:module';
  import { pathToFileURL } from 'node:url';
  const require = createRequire(pathToFileURL(process.cwd() + '/package.json'));
  const resolved = require.resolve('@ddrl/chat/vite/pi-mcp');
  if (resolved.endsWith('.ts') || resolved.endsWith('.tsx') || resolved.endsWith('.mts')) {
    throw new Error('plugin entry is still TypeScript: ' + resolved);
  }
  const loaded = await import(pathToFileURL(resolved).href);
  const plugins = loaded.piMcpBrowserPlugins();
  if (!Array.isArray(plugins) || plugins.length !== 2) {
    throw new Error('expected the shared browser plugins');
  }
  if (plugins.some((plugin) => plugin.enforce !== 'pre')) {
    throw new Error('plugin enforce changed');
  }
  console.log('loaded ' + resolved);
`;

for (const cwd of [webRoot, chromeRoot]) {
  const result = spawnSync(process.execPath, [...nodeArgs, '-e', loader], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`FAIL load from ${cwd}`);
    console.error(result.stdout);
    console.error(result.stderr);
  } else {
    process.stdout.write(result.stdout);
  }
}

assert(!nodeArgs.includes('--experimental-strip-types'), 'the check must not enable the TypeScript loader');

if (failed) {
  console.error(`${failed} config load assertions failed`);
  process.exit(1);
}
console.log(
  `config load fixtures passed without a TypeScript loader (${process.version}, args: ${nodeArgs.join(' ')})`,
);
