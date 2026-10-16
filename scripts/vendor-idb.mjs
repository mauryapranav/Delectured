import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('js/vendor/idb', {recursive: true});
await copyFile('node_modules/idb/build/index.js', 'js/vendor/idb/index.js');
await copyFile('node_modules/idb/LICENSE', 'js/vendor/idb/LICENSE');
