import { rm, mkdir, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const run = (...args) => execFileSync('pnpm', args, { stdio: 'inherit' });

await rm('site-dist', { recursive: true, force: true });

for (const app of ['participant', 'control-room', 'projector', 'admin']) {
  run('--filter', `@gericare/${app}`, 'build');
}

await mkdir('site-dist', { recursive: true });
await cp('apps/participant/dist', 'site-dist', { recursive: true });
await cp('apps/control-room/dist', 'site-dist/control', { recursive: true });
await cp('apps/projector/dist', 'site-dist/projector', { recursive: true });
await cp('apps/admin/dist', 'site-dist/admin', { recursive: true });

console.log('Unified Netlify site assembled in site-dist/');
