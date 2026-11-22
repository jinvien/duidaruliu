const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

/** 用原始主机名，避免 URL 把 2130706433 或 0x7f.0.0.1 折成 127.0.0.1。 */
function rawHostname(raw: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(raw.trim());
  if (!match) return null;
  const authority = match[1] ?? '';
  if (!authority || authority.includes('@')) return null;
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    if (end < 0) return null;
    return authority.slice(1, end);
  }
  const colon = authority.lastIndexOf(':');
  if (colon > -1) return authority.slice(0, colon);
  return authority;
}

/** 只接受真正的回环主机名。不解析 DNS，也不接受十进制 IP 或其他别名。 */
export function parseLoopbackTarget(raw: string): URL | null {
  const written = rawHostname(raw);
  if (!written || !LOOPBACK.has(written)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const normalized =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname;
  if (!LOOPBACK.has(normalized)) return null;
  return url;
}
