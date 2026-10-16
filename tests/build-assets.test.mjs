import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {posix} from 'node:path';

test('published asset list includes every relative JavaScript module dependency', async () => {
    const root = new URL('../', import.meta.url);
    const worker = await readFile(new URL('sw.js', root), 'utf8');
    const block = worker.match(/const URLS_TO_CACHE = \[([\s\S]*?)\];/)[1];
    const assets = new Set([...block.matchAll(/'\.\/([^']+)'/g)].map(match => match[1]));
    for (const file of assets) {
        if (!file.endsWith('.js')) continue;
        const source = await readFile(new URL(file, root), 'utf8');
        // Static import/export-from and literal dynamic imports.
        const imports = /\b(?:from\s*|import\s*\(\s*|import\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
        for (const [, specifier] of source.matchAll(imports)) {
            const dependency = posix.normalize(posix.join(posix.dirname(file), specifier));
            assert(assets.has(dependency), `${file} imports unpublished module ${dependency}`);
        }
    }
});
