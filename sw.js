/**
 * sw.js
 * Service worker for offline shell caching.
 */
const CACHE_NAME = 'delectured-v3-release-v1';
const URLS_TO_CACHE = [
    './',
    './index.html',
    './library.html',
    './styles.css',
    './folio-polish.css',
    './ink-transition.js',
    './js/app.js',
    './js/router.js',
    './js/report.js',
    './js/shell.js',
    './js/icons.js',
    './js/select-control.js',
    './js/demo-lecture.js',
    './js/capture-meter.js',
    './js/exports.js',
    './js/chat.js',
    './guide.html',
    './manifest.webmanifest',
    './js/library.js',
    './js/config.js',
    './js/pipeline.js',
    './js/transcript.js',
    './js/analysis-schema.js',
    './js/queue.js',
    './js/queue-controls.js',
    './js/notes-recovery.js',
    './js/recorder.js',
    './js/pcm-chunker.js',
    './js/encoder.js',
    './js/session.js',
    './js/upload.js',
    './js/vendor/lamejs/lame.min.js',
    './js/safe-render.js',
    './js/store.js',
    './js/schema.js',
    './js/lectures.js',
    './js/vendor/idb/index.js',
    './js/audio-worklet.js',
    './js/encoder.worker.js',
    './js/providers/index.js',
    './js/providers/groq.js',
    './js/providers/catalog.js',
    './js/providers/http.js',
    './js/providers/openai-compatible.js',
    './js/providers/openai.js',
    './js/providers/openrouter.js',
    './js/providers/mistral.js',
    './js/providers/gemini.js',
    './js/providers/anthropic.js',
    './js/providers/compatible.js',
    './js/provider-settings.js',
];

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) if (name.startsWith('delectured-v3-') && name !== CACHE_NAME) await caches.delete(name);
        await self.clients.claim();
    })());
});

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(URLS_TO_CACHE))
    );
});

const assets = new Set(URLS_TO_CACHE.map(path => new URL(path, self.location.href).href));
self.addEventListener('fetch', event => {
    const request = event.request, url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('Authorization')) return;
    // A report ID is local navigation state, never an additional cached document.
    if (request.mode === 'navigate') url.search = '';
    if (!assets.has(url.href)) return;
    event.respondWith(caches.open(CACHE_NAME).then(async cache => (await cache.match(url.href)) ?? fetch(request)));
});
