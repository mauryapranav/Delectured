import {readFile, mkdir, copyFile, stat, writeFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
const root = resolve('.'), output = resolve('dist');
if (output !== resolve(root, 'dist')) throw new Error('Unexpected output path.');
const sw = await readFile('sw.js', 'utf8');
const block = sw.match(/const URLS_TO_CACHE = \[([\s\S]*?)\];/)[1];
const files = [...new Set([...block.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]).concat(['sw.js', 'js/vendor/idb/LICENSE', 'js/vendor/lamejs/LICENSE']))];
await mkdir(output, {recursive: true});
const allowed = new Set([...files, '.nojekyll']);
async function checkOutput(directory, prefix = '') {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const relative = prefix + entry.name;
        if (entry.isSymbolicLink()) throw new Error(`Refusing output symlink: ${relative}`);
        if (entry.isDirectory()) await checkOutput(resolve(directory, entry.name), relative + '/');
        else if (!allowed.has(relative)) throw new Error(`Unexpected output file ${relative}; use a fresh dist directory.`);
    }
}
await checkOutput(output);
// Each public entry URL serves the same persistent shell. Keep route content
// authored in its existing HTML file, and compose it once at build time.
const index = await readFile('index.html', 'utf8');
const routeSections = await Promise.all(['library.html', 'guide.html'].map(async file => {
    const html = await readFile(file, 'utf8');
    const content = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)[1];
    const id = file === 'library.html' ? 'library-section' : 'guide-section';
    return content.replace('<section ', `<section id="${id}" `).replace(/class="([^"]+)"/, 'class="$1 hidden-view"');
}));
const shell = index.replace('</main>', routeSections.join('') + '</main>');
const hash = createHash('sha256');
for (const file of files) {
    const source = resolve(root, file), target = resolve(output, file);
    if (!source.startsWith(root + '/') && !source.startsWith(root + '\\')) throw new Error('Unsafe asset path.');
    if ((await stat(source)).size > 25 * 1024 * 1024) throw new Error(`Asset too large: ${file}`);
    const content = ['index.html', 'library.html', 'guide.html'].includes(file) ? shell : await readFile(source);
    hash.update(file).update(content);
    await mkdir(dirname(target), {recursive: true}); await writeFile(target, content);
}
await writeFile(resolve(output, 'sw.js'), sw.replace('delectured-v3-release-v1', `delectured-v3-${hash.digest('hex').slice(0, 16)}`));
await writeFile(resolve(output, '.nojekyll'), '');
console.log(`Prepared ${files.length} public assets in dist. No publication performed. Use a fresh output directory for release.`);
