import {getAllLectures} from './store.js';
import {icon, initIcons} from './icons.js';
import {refreshSelects} from './select-control.js';
let noticeTimer;
export function notice(message) {
    const el = document.getElementById('app-notice');
    if (!el) return;
    el.textContent = message; el.hidden = false; clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {el.hidden = true;}, 6000);
}
export async function refreshRecent(currentId = new URL(location.href).searchParams.get('lecture')) {
    const nav = document.getElementById('recent-lectures'); if (!nav) return;
    try {
        const lectures = (await getAllLectures()).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
        nav.replaceChildren();
        if (!lectures.length) {const p = document.createElement('p'); p.className = 'quiet'; p.textContent = 'Your next lecture starts here.'; nav.append(p);}
        for (const l of lectures) {
            const link = document.createElement('a'); link.className = 'recent-link'; link.href = `index.html?lecture=${encodeURIComponent(l.id)}`;
            const title = document.createElement('span'); title.className = 'recent-title'; title.textContent = l.title;
            link.append(icon('document'), title); if (l.id === currentId) link.setAttribute('aria-current', 'page');
            const meta = document.createElement('small'); meta.textContent = new Date(l.createdAt).toLocaleDateString(undefined, {day:'numeric',month:'short'});
            title.append(meta); nav.append(link);
        }
    } catch {nav.textContent = 'Recent lectures are unavailable.';}
}
export function initShell({busy = () => false} = {}) {
    initIcons();
    refreshSelects();
    const media = matchMedia('(max-width: 900px)'), toggle = document.getElementById('sidebar-toggle'), sidebar = document.getElementById('app-sidebar');
    const scrim = document.getElementById('sidebar-scrim');
    function sync() {
        const open = media.matches ? document.body.classList.contains('sidebar-open') : !document.body.classList.contains('sidebar-collapsed');
        toggle?.setAttribute('aria-expanded', String(open)); if (sidebar) sidebar.inert = !open;
        if (scrim) scrim.hidden = !media.matches || !open;
        const modal = media.matches && open;
        document.querySelectorAll('main, .masthead, .mobile-nav').forEach(node => {node.inert = modal;});
        if (modal) {sidebar.setAttribute('role', 'dialog'); sidebar.setAttribute('aria-modal', 'true');}
        else {sidebar?.removeAttribute('role'); sidebar?.removeAttribute('aria-modal');}
    }
    toggle?.addEventListener('click', () => {
        document.body.classList.toggle(media.matches ? 'sidebar-open' : 'sidebar-collapsed'); sync();
        if (media.matches && document.body.classList.contains('sidebar-open')) document.getElementById('sidebar-close').focus();
    });
    const close = () => {document.body.classList.remove('sidebar-open'); if (!media.matches) document.body.classList.add('sidebar-collapsed'); sync(); toggle?.focus();};
    document.getElementById('sidebar-close')?.addEventListener('click', close); scrim?.addEventListener('click', close);
    document.addEventListener('keydown', e => {if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) close();});
    sidebar?.addEventListener('keydown', e => {
        if (e.key !== 'Tab' || !media.matches || !document.body.classList.contains('sidebar-open')) return;
        const items = [...sidebar.querySelectorAll('a[href], button')], first = items[0], last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {e.preventDefault(); last.focus();}
        else if (!e.shiftKey && document.activeElement === last) {e.preventDefault(); first.focus();}
    });
    media.addEventListener('change', sync); sync();
    document.getElementById('theme-toggle')?.addEventListener('click', e => window.InkTransition?.toggle(e.currentTarget));
    document.addEventListener('click', e => {
        const link = e.target.closest('a[href]');
        if (!link || link.target === '_blank' || link.download || !busy()) return;
        const url = new URL(link.href);
        if (url.origin === location.origin && (url.pathname !== location.pathname || url.search !== location.search || !url.hash)) {
            e.preventDefault(); notice('Finish or discard the current recording or report before opening another page.');
        }
    }, true);
    globalThis.addEventListener('beforeunload', e => {if (busy()) {e.preventDefault(); e.returnValue = '';}});
    refreshRecent();
    const updateRoute = () => {
        document.body.classList.remove('sidebar-open'); sync();
        syncRoute(); refreshRecent();
    };
    syncRoute();
    return {updateRoute};
}
function syncRoute() {
    const route=new URL(location.href);
    const activeRoute=route.pathname.endsWith('library.html')?'library':route.pathname.endsWith('guide.html')?'guide':route.searchParams.has('capture')?'capture':!route.searchParams.has('lecture')&&!route.searchParams.has('demo')?'home':null;
    document.querySelectorAll('[data-route]').forEach(a=>{
        a.removeAttribute('aria-current');
        if(a.dataset.route===activeRoute)a.setAttribute('aria-current','page');
    });
    document.querySelectorAll('.workspace-nav a').forEach(a=>{
        a.removeAttribute('aria-current');
        const destination=new URL(a.href);
        if(destination.pathname.endsWith('library.html')&&route.pathname.endsWith('library.html')||destination.searchParams.has('capture')&&route.searchParams.has('capture'))a.setAttribute('aria-current','page');
    });
    document.querySelectorAll('.mobile-nav a').forEach(a => {
        a.removeAttribute('aria-current');
        const target = new URL(a.href), current = new URL(location.href);
        if (target.pathname === current.pathname && (target.searchParams.has('capture') ? current.searchParams.has('capture') : !target.search && !current.search)) a.setAttribute('aria-current','page');
    });
}
