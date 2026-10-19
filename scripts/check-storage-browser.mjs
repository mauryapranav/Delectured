// Usage: node scripts/check-storage-browser.mjs <path-to-playwright-index.mjs>
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium} = await import(pathToFileURL(process.argv[2]));
const root = resolve('.');
const server = createServer(async (request, response) => {
    try {
        const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
        if (!path.startsWith(root + sep)) throw new Error('Invalid path');
        response.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : 'text/html');
        response.end(await readFile(path));
    } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({headless: true, executablePath: process.argv[3]});
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/browser/store.html`);
    await page.waitForFunction(() => document.body.dataset.result, {timeout: 15000});
    console.log(await page.locator('#results').innerText());
    if (await page.locator('body').getAttribute('data-result') !== 'pass') process.exitCode = 1;
    // A fresh isolated browser context: never touches the user's browser Library.
    const importedId = '\"><img src=x onerror="window.__injected=true">';
    await page.evaluate(async id => {
        const store = await import('/js/store.js');
        await store.saveLecture({id, title: 'Imported lecture', transcript: 'Safe text'});
    }, importedId);
    await page.goto(`http://127.0.0.1:${server.address().port}/library.html`);
    await page.waitForSelector('[data-action="view"]');
    const renderedId = await page.locator('[data-action="view"]').getAttribute('data-id');
    const injected = await page.evaluate(() => Boolean(window.__injected) || Boolean(document.querySelector('#library-list img')));
    if (injected || renderedId !== importedId) throw new Error('Imported IDs must render as inert attribute text');
    console.log('PASS: Imported IDs render safely in the real Library');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
