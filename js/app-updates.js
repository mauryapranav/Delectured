// Never force activation or reload: another tab may still hold unsaved audio.
export function watchAppUpdates(registration, serviceWorker, announce) {
    const inspect = () => {
        if (serviceWorker.controller && registration.waiting) announce();
    };
    const installing = () => {
        registration.installing?.addEventListener('statechange', inspect);
        inspect();
    };
    registration.addEventListener('updatefound', installing);
    installing();
}

export function showAppUpdate() {
    if (document.getElementById('app-update')) return;
    const banner = document.createElement('section');
    banner.id = 'app-update'; banner.className = 'processing-problem';
    banner.setAttribute('role', 'status');
    const title = document.createElement('h2'); title.textContent = 'An app update is ready';
    const message = document.createElement('p');
    message.textContent = 'Finish your current work and export any audio held only in this tab. Then close all DeLectured tabs and reopen the site to load the update. Saved transcripts and lectures will remain in this browser. Do not clear site data.';
    banner.append(title, message); document.querySelector('main').prepend(banner);
}
