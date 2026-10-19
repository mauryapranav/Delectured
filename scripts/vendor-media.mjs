import {mkdir, copyFile, readFile} from 'node:fs/promises';
const pkg = JSON.parse(await readFile('node_modules/mediabunny/package.json', 'utf8'));
if (pkg.version !== '1.61.6') throw new Error('Unexpected media decoder version.');
await mkdir('js/vendor/mediabunny', {recursive: true});
await copyFile('node_modules/mediabunny/dist/bundles/mediabunny.min.mjs', 'js/vendor/mediabunny/mediabunny.js');
await copyFile('node_modules/mediabunny/LICENSE', 'js/vendor/mediabunny/LICENSE');
