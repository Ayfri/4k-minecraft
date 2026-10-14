/** Unminified dev server with HMR and DEV hooks on the first free port from 3000 (`PORT` overrides), the WGSL goes through `wgsl-plugin.ts`. */
import page from './dev.html';

const serve = (port: number): ReturnType<typeof Bun.serve> => {
	try {
		return Bun.serve({ development: { hmr: true }, port, routes: { '/': page } });
	} catch (e) {
		if ((e as { code?: string }).code != 'EADDRINUSE') throw e;
		return serve(port + 1);
	}
};
console.log(`serving ${serve(Number(Bun.env.PORT ?? 3000)).url}`);
