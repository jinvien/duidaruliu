export function piMcpBrowserPlugins(): Array<{
  name: string;
  enforce: 'pre';
  resolveId?: (id: string, importer?: string) => string | null;
  load?: (id: string) => string | null;
  transform?: (code: string, id: string) => string | null;
}>;
