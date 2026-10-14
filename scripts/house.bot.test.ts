import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { HOUSE_NEAR, runBot } from './bot.ts';
import { Page } from './webview.ts';

/** Never run together with `e2e.test.ts`: two WebViews open at once fail with a closed WebSocket. */
test('the bot builds the whole house on the real terrain through the player controls', async () => {
	await using page = await Page.open(`${import.meta.dir}/../dist/dev.html`);
	const result = await runBot(page, 'house', HOUSE_NEAR, { shot: `${tmpdir()}/claude-temp/4k/bot` });
	expect(result.error).toBeUndefined();
	expect(result.check.missing).toEqual([]);
	expect(result.check.matching).toBe(result.check.expected);
	expect(result.teleports).toEqual([]);
	expect(result.failures).toEqual([]);
	expect(result.problems).toEqual([]);
}, 600_000);
