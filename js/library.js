import {buildNoteNetwork, mountNetwork} from './note-network.js';
import {refreshRecent} from './shell.js';
import {withNotesLock} from './request-budget.js';
/**
 * js/library.js
 * Logic for the library page (listing, deleting, export, import).
 */
import * as store from './store.js';
import { escapeHTML } from './safe-render.js';
import {downloadText} from './exports.js';
import {searchLectures, renameLecture, exportLibraryData, importLibraryData } from './lectures.js';
import {renderCourses} from './course-ui.js';
import {requestLectureTitle} from './rename-dialog.js';

let initialized = false;
export function initLibrary() {
    if (initialized) return; initialized = true;
    document.getElementById('library-search').addEventListener('input', loadLibrary);

    // Export/Import
    document.getElementById('export-library-btn').addEventListener('click', exportLibrary);
    document.getElementById('import-library-btn').addEventListener('click', () => {
        document.getElementById('import-input').click();
    });
    document.getElementById('import-input').addEventListener('change', importLibrary);
}
export function showLibrary(url) {
    initLibrary();
    document.getElementById('library-search').value = url.searchParams.get('q') || '';
    return loadLibrary();
}

let loadVersion = 0;
async function loadLibrary() {
    const version = ++loadVersion;
    const listEl = document.getElementById('library-list');
    listEl.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';

    try {
        const courses = document.getElementById('library-courses');
        if (courses) await renderCourses(courses);
        const lectures = await searchLectures(document.getElementById('library-search').value);
        if (version !== loadVersion) return;
        const graphHost = document.getElementById('library-network');
        if (graphHost) {
            const network = buildNoteNetwork(lectures);
            mountNetwork(graphHost, network, {onSelect:node=>{const link=document.createElement('a');link.href=`index.html?lecture=${encodeURIComponent(node.id)}`;link.click();}});
            const list = document.getElementById('library-network-list');list.replaceChildren();
            for(const edge of network.edges) {const p=document.createElement('p');const names=new Map(network.nodes.map(n=>[n.id,n.label]));p.textContent=`${names.get(edge.from)} / ${names.get(edge.to)}: ${edge.relation}`;list.append(p);}
            if(!network.edges.length) list.textContent='No shared concept names or courses found yet. Notes remain separate until they have a connection.';
            if(lectures.length>60){const p=document.createElement('p');p.textContent='Map shows the first 60 matching lectures. Search to narrow the map.';graphHost.append(p);}
        }
        if (lectures.length === 0) {
            listEl.innerHTML = '<tr><td colspan="3">No lectures found.</td></tr>';
            return;
        }

        // Sort descending by date
        lectures.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        listEl.innerHTML = lectures.map(l => {
            const dateStr = new Date(l.createdAt).toLocaleDateString();
            return `
            <tr class="ledger-row">
                <td>${dateStr}</td>
                <td class="ledger-title">${escapeHTML(l.title || 'Untitled')}</td>
                <td>
                    <a href="index.html?lecture=${encodeURIComponent(l.id)}" class="view-link" data-action="view" data-id="${escapeHTML(l.id)}">View</a>
                    <a href="#" class="action-link" data-action="rename" data-id="${escapeHTML(l.id)}">Rename</a>
                    <a href="#" class="action-link" data-action="delete" data-id="${escapeHTML(l.id)}">Delete</a>
                </td>
            </tr>
            `;
        }).join('');

        // Attach events
        listEl.querySelectorAll('.action-link').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const id = e.target.dataset.id;
                try {
                    if (e.target.dataset.action === 'delete' && confirm('Delete this lecture forever?')) await store.deleteLecture(id);
                    if (e.target.dataset.action === 'rename') {
                        const title = await requestLectureTitle(lectures.find(l => l.id === id).title);
                        if (title !== null) await renameLecture(id, title);
                    }
                    await loadLibrary(); refreshRecent();
                } catch (error) {alert(error.message);}

            });
        });
    } catch(e) {
        console.error(e);
        listEl.innerHTML = '<tr><td colspan="3">Failed to load library.</td></tr>';
    }
}

async function exportLibrary() {
    let backup;
    try { backup = await exportLibraryData(); }
    catch (error) { alert(`Backup could not be exported: ${error.message}`); return; }
    downloadText(JSON.stringify(backup), `delectured_backup_${Date.now()}.json`, 'application/json');
}

async function importLibrary(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            await withNotesLock(()=>importLibraryData(JSON.parse(ev.target.result), {overwrite: document.getElementById('import-conflicts').value === 'overwrite'}));
            await loadLibrary(); refreshRecent();
            alert('Import successful!');
        } catch (err) {
            alert(`Backup could not be imported: ${err.message}`);
            console.error(err);
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}
