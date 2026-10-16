import {mkdir, copyFile, cp, readFile} from 'node:fs/promises';
const pkg = JSON.parse(await readFile('node_modules/lamejs/package.json', 'utf8'));
if (pkg.version !== '1.2.1') throw new Error('Unexpected encoder version.');
await mkdir('js/vendor/lamejs', {recursive: true});
for (const name of ['lame.min.js', 'lame.all.js', 'LICENSE', 'package.json', 'README.md', 'makeall.sh', 'minify.sh', 'pom.xml']) await copyFile(`node_modules/lamejs/${name}`, `js/vendor/lamejs/${name}`);
await cp('node_modules/lamejs/src', 'js/vendor/lamejs/src', {recursive: true});
