// 这个文件必须是 JavaScript。Vite 和 WXT 会用 Node 直接加载它，
// 不能指向 .ts：Node 20 以及未打开类型剥离的 Node 22 会报 ERR_UNKNOWN_FILE_EXTENSION。
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// pi-mcp 的 exports 没有 require 条件，也不能 resolve package.json。
// 插件文件在 src/vite，依赖装在这个包的 node_modules。
const piMcpRoot = join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/@earendil-works/pi-mcp');
if (!existsSync(join(piMcpRoot, 'dist/client.js'))) {
  throw new Error(`pi-mcp browser entry not found at ${piMcpRoot}`);
}

const bufferByteLengthShim = `(() => {
  const encode = (value) => {
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (value instanceof Uint8Array) return value;
    return new TextEncoder().encode(String(value ?? ''));
  };
  class Utf8Buffer extends Uint8Array {
    toString() { return new TextDecoder().decode(this); }
    subarray(begin, end) { return new Utf8Buffer(Uint8Array.prototype.subarray.call(this, begin, end)); }
  }
  const from = (value) => new Utf8Buffer(encode(value));
  const byteLength = (value) => encode(value).length;
  const current = globalThis.Buffer;
  if (!current || typeof current.byteLength !== 'function' || typeof current.from !== 'function') {
    globalThis.Buffer = Object.assign(current ?? {}, { byteLength, from });
  }
})();
`;

const sha256Module = `function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
function sha256(bytes) {
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const zeros = withOne % 64 <= 56 ? 56 - (withOne % 64) : 120 - (withOne % 64);
  const data = new Uint8Array(bytes.length + 1 + zeros + 8);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(data.length - 4, bitLen >>> 0);
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < data.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[t] + w[t]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d + temp1) >>> 0; d=c; c=b; b=a; a=(temp1 + temp2) >>> 0;
    }
    h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0;
    h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  [h0,h1,h2,h3,h4,h5,h6,h7].forEach((value, index) => ov.setUint32(index * 4, value));
  return out;
}
export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new Error('unsupported hash');
  const parts = [];
  return {
    update(value) {
      parts.push(typeof value === 'string' ? new TextEncoder().encode(value) : value);
      return this;
    },
    digest(encoding) {
      let length = 0;
      for (const part of parts) length += part.length;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      const hash = sha256(bytes);
      if (encoding === 'hex') return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return hash;
    },
  };
}
`;

/** 浏览器里没有 Node 的 crypto / Buffer。OAuth 入口直接拒绝。Chrome 和 Web 共用。 */
export function piMcpBrowserPlugins() {
  return [
    {
      name: 'pi-mcp-browser-entry',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === '@earendil-works/pi-mcp') return '\0pi-mcp-browser';
        if (id === '@earendil-works/pi-mcp/oauth' || id.startsWith('@earendil-works/pi-mcp/oauth/')) {
          return '\0pi-mcp-oauth-blocked';
        }
        if ((id === 'node:crypto' || id === 'crypto') && importer?.includes('pi-mcp')) {
          return '\0pi-mcp-sha256';
        }
        return null;
      },
      load(id) {
        if (id === '\0pi-mcp-oauth-blocked') {
          throw new Error('@earendil-works/pi-mcp/oauth is not available in this extension');
        }
        if (id === '\0pi-mcp-sha256') return sha256Module;
        if (id !== '\0pi-mcp-browser') return null;
        const file = (name) => JSON.stringify(piMcpRoot + '/dist/' + name);
        return [
          `export { McpClient } from ${file('client.js')};`,
          `export { validateMcpServerConfig } from ${file('config.js')};`,
          `export { StreamableHttpTransport } from ${file('transports/streamable-http.js')};`,
          `export { createMcpToolName } from ${file('naming.js')};`,
          `export { normalizeMcpInputSchema } from ${file('input-schema.js')};`,
          `export { toLlmContent } from ${file('protocol/content.js')};`,
          `export { limitMcpContent, MCP_OUTPUT_MAX_BYTES } from ${file('output-limit.js')};`,
        ].join('\n');
      },
    },
    {
      name: 'buffer-bytelength-shim',
      enforce: 'pre',
      transform(code, id) {
        if (!id.includes('pi-mcp') || (!code.includes('Buffer.byteLength') && !code.includes('Buffer.from'))) {
          return null;
        }
        return bufferByteLengthShim + '\n' + code;
      },
    },
  ];
}
