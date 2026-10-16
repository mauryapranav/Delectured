// A route prepares its data before committing any visible or history changes.
export async function initRouter({prepare, busy, blocked, changed, openSettings, error}) {
    let position = Number.isInteger(history.state?.folioPosition) ? history.state.folioPosition : 0;
    let browserPosition = position, version = 0, reverting = false;
    const positions = new Map();
    const directory = new URL('./', location.href);
    const supported = url => url.origin === directory.origin &&
        ['index.html', 'library.html', 'guide.html', ''].some(file => url.pathname === directory.pathname + file);
    history.replaceState({...history.state, folioPosition: position}, '', location.href);
    history.scrollRestoration = 'manual';
    addEventListener('scroll', () => positions.set(position, [scrollX, scrollY]), {passive:true});

    async function navigate(url, {pop = false, initial = false, targetPosition = position} = {}) {
        if (reverting) return;
        const ticket = ++version;
        const undo = () => {
            if (pop && browserPosition !== position) {reverting = true; history.go(position - browserPosition);}
        };
        if (!initial && busy()) {blocked(); undo(); return;}
        try {
            const commit = await prepare(url);
            if (ticket !== version) return;
            if (!initial && busy()) {blocked(); undo(); return;}
            if (pop) position = targetPosition;
            else if (!initial && url.href !== location.href) {
                positions.set(position, [scrollX, scrollY]);
                position = browserPosition + 1;
                history.pushState({folioPosition: position}, '', url);
                browserPosition = position;
            }
            commit();
            changed();
            const target = url.hash && document.getElementById(decodeURIComponent(url.hash.slice(1)));
            const heading = document.querySelector('main > .active-view h1');
            const focus = target || heading;
            if (!initial && focus) {focus.tabIndex = -1; focus.focus({preventScroll:true});}
            if (pop && positions.has(position)) scrollTo({left:positions.get(position)[0], top:positions.get(position)[1], behavior:'instant'});
            else if (target) target.scrollIntoView({behavior:'instant', block:'start'});
            else if (!initial) scrollTo({top:0, left:0, behavior:'instant'});
            if (url.searchParams.has('settings')) openSettings();
        } catch (reason) {if (ticket === version) {undo(); error(reason);}}
    }
    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
            !link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
        const url = new URL(link.href);
        if (!supported(url)) return;
        // Local report controls and empty action anchors own their click handlers.
        if (link.getAttribute('href') === '#') return;
        event.preventDefault();
        if (url.searchParams.has('settings')) {openSettings(); return;}
        void navigate(url);
    });
    document.querySelector('.workspace-search')?.addEventListener('submit', event => {
        event.preventDefault();
        const url = new URL('library.html', directory);
        url.searchParams.set('q', new FormData(event.currentTarget).get('q') || '');
        void navigate(url);
    });
    addEventListener('popstate', event => {
        browserPosition = event.state?.folioPosition ?? 0;
        if (reverting) {reverting = false; return;}
        void navigate(new URL(location.href), {pop:true, targetPosition:browserPosition});
    });
    await navigate(new URL(location.href), {initial:true});
    document.documentElement.dataset.routerReady = 'true';
}
