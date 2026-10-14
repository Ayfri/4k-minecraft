/** Unminified dev server with HMR on http://localhost:3000 (`PORT` overrides), DEV hooks on. The WGSL goes through `scripts/wgsl-plugin.ts`. */
import page from './dev.html';

const server = Bun.serve({ development: { hmr: true }, port: Number(Bun.env.PORT ?? 3000), routes: { '/': page } });
console.log(`serving ${server.url}`);
