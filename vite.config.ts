import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const run = (cmd: string, args: string[]) =>
  new Promise<string[]>((resolve) => {
    execFile(cmd, args, { timeout: 8000, maxBuffer: 4 << 20 }, (_err, stdout) =>
      resolve(String(stdout ?? '').split('\n').filter(Boolean)));
  });

/**
 * Le navigateur ne connaît que le nom d'un dossier, jamais son chemin.
 * En local, on le retrouve (Spotlight, puis recherche dans les dossiers usuels) pour proposer
 * une commande de conversion HEIC prête à copier. Lecture seule : rien n'est modifié.
 */
async function locateFolder(name: string, file: string): Promise<string | null> {
  if (!name || name.includes('/') || file.includes('/')) return null;
  const home = homedir();
  const ok = (p: string) => {
    try { return statSync(p).isDirectory() && (!file || existsSync(join(p, file))); } catch { return false; }
  };
  const q = name.replace(/["\\]/g, '\\$&');
  const viaSpotlight = await run('mdfind', ['-onlyin', home, `kMDItemFSName == "${q}"`]);
  const hit = viaSpotlight.find(ok);
  if (hit) return hit;
  const roots = ['Pictures', 'Desktop', 'Documents', 'Downloads', 'Library/Mobile Documents/com~apple~CloudDocs']
    .map((d) => join(home, d)).filter(existsSync);
  const viaFind = await run('find', [...roots, '-maxdepth', '6', '-type', 'd', '-name', name]);
  return viaFind.find(ok) ?? null;
}

function localApi(): Plugin {
  return {
    name: 'mosaique-local-api',
    configureServer(server) {
      server.middlewares.use('/api/locate', async (req, res) => {
        const u = new URL(req.url ?? '', 'http://localhost');
        const path = await locateFolder(u.searchParams.get('name') ?? '', u.searchParams.get('file') ?? '');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ path }));
      });
    },
  };
}

export default defineConfig({
  plugins: [localApi()],
  server: { host: 'localhost' },
});
