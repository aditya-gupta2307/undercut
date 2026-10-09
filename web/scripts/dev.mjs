// Development server with rebuild-on-save and automatic browser reload.
//   npm run dev   ->   http://localhost:5173

import * as esbuild from 'esbuild';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, copyPublic, ensureDir, entryOutputs, esbuildOptions, writeIndexHtml } from './shared.mjs';

const devDir = path.join(ROOT, '.dev');
await rm(devDir, { recursive: true, force: true });
await ensureDir(devDir);
await copyPublic(devDir);

const liveReload = `<script type="module">new EventSource('/esbuild').addEventListener('change', () => location.reload());</script>`;

const ctx = await esbuild.context({
  ...esbuildOptions('development', path.join(devDir, 'assets')),
  plugins: [
    {
      name: 'write-index',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length || !result.metafile) return;
          await writeIndexHtml(devDir, entryOutputs(result.metafile, devDir), liveReload);
        });
      },
    },
  ],
});

await ctx.watch();
const port = Number(process.env.PORT ?? 5173);
const { hosts } = await ctx.serve({ servedir: devDir, port });
console.log(`\n  Undercut dev server: http://${hosts[0] === '0.0.0.0' ? 'localhost' : hosts[0]}:${port}\n`);
