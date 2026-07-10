import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { config } from './config';
import { thumbPath } from './thumbnails';

/**
 * Rendering itself needs a real Typst binary, so it is verified by hand (see
 * ROADMAP.md). What is worth pinning down here is that a template id — which
 * becomes a filename — can never point outside the cache directory. The route
 * already rejects ids that aren't in the registry; this is the second gate.
 */
describe('thumbPath', () => {
	it('keeps every id inside the thumbnail directory', () => {
		const evil = [
			'../../etc/passwd',
			'..',
			'/etc/passwd',
			'foo/../../bar',
			'a/b/c',
			'typographic/../../../root/.ssh/id_rsa'
		];

		for (const id of evil) {
			const resolved = path.resolve(thumbPath(id));
			// The precise check is "its parent is the cache directory". A relative
			// path starting with `..` is not proof of escape here: `basename('..')`
			// is `..`, giving the harmless filename `...png` inside the directory.
			expect(path.dirname(resolved)).toBe(config.thumbsDir);
			expect(resolved.startsWith(config.thumbsDir + path.sep)).toBe(true);
		}
	});

	it('names a known template predictably', () => {
		expect(thumbPath('typographic')).toBe(path.join(config.thumbsDir, 'typographic.png'));
	});
});
