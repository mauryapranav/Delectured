// ==========================================
// DeLectured — Auth Layer v2.0
// Loaded before app.js. Exposes window.DeLecturedAuth.
// ==========================================
//
// ⚠️ CONFIGURATION — Update these 3 values after deploying:
//    1. SUPABASE_URL      — from your Supabase project dashboard
//    2. SUPABASE_ANON_KEY — from Supabase → Settings → API → anon/public key
//    3. BACKEND_URL       — your Render deployment URL (no trailing slash)
//
(function () {
  'use strict';

  const SUPABASE_URL = '__SUPABASE_URL__';       // e.g. https://abcxyz.supabase.co
  const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__'; // safe to expose — anon key only
  const BACKEND_URL = '__BACKEND_URL__';         // e.g. https://delectured-api.onrender.com

  // ---- Supabase client init ----
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---- Token helpers ----
  async function getAuthToken() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    return session.access_token;
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    location.reload();
  }

  // ---- Usage badge ----
  async function loadUsageCount() {
    try {
      const token = await getAuthToken();
      const res = await fetch(`${BACKEND_URL}/api/usage`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();

      const el = document.getElementById('usage-display');
      if (el) {
        el.textContent = `${data.used}/${data.limit} lectures this month`;
        el.style.color = data.used >= data.limit ? 'var(--accent)' : 'var(--text-tertiary)';
        el.title = `Resets on ${data.resets_on}`;
      }
    } catch (e) {
      console.warn('[DeLectured] Usage count load failed:', e);
    }
  }

  // ---- Sidebar tabs ----
  let sidebarActiveTab = 'sessions'; // 'sessions' | 'recordings'

  function setSidebarTab(tab) {
    sidebarActiveTab = tab;
    const sessionsTab = document.getElementById('tab-sessions');
    const recordingsTab = document.getElementById('tab-recordings');
    const sessionsContent = document.getElementById('sessions-content');
    const recordingsContent = document.getElementById('recordings-content');
    
    if (sessionsTab) sessionsTab.classList.toggle('active', tab === 'sessions');
    if (recordingsTab) recordingsTab.classList.toggle('active', tab === 'recordings');
    if (sessionsContent) sessionsContent.style.display = tab === 'sessions' ? 'block' : 'none';
    if (recordingsContent) recordingsContent.style.display = tab === 'recordings' ? 'block' : 'none';
    
    if (tab === 'sessions') loadSessionsList();
    if (tab === 'recordings') loadRecordingsList();
  }

  // ---- Session list ----
  async function loadSessionsList() {
    const list = document.getElementById('sessions-list');
    if (!list) return;
    _renderSessionsSkeleton(5);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${BACKEND_URL}/api/sessions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const sessions = await res.json();
      _renderSessionsList(sessions);
    } catch (e) {
      console.warn('[DeLectured] Sessions list load failed:', e);
      if (list) list.innerHTML = '<div class="session-empty">Failed to load sessions.</div>';
    }
  }

  function _renderSessionsList(sessions) {
    const list = document.getElementById('sessions-list');
    if (!list) return;

    if (!sessions || sessions.length === 0) {
      list.innerHTML = '<div class="session-empty">No past lectures yet.<br>Process your first lecture to save it here.</div>';
      return;
    }

    list.innerHTML = sessions.map(s => {
      const d = new Date(s.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
      const dur = s.audio_duration_minutes
        ? ` · ${Math.round(s.audio_duration_minutes)}min`
        : '';
      return `
        <div class="session-list-item" onclick="window.DeLecturedAuth.loadSession('${s.id}')">
          <div class="session-item-title">${_escapeHtml(s.title)}</div>
          <div class="session-item-meta">${d}${dur}</div>
        </div>`;
    }).join('');
  }

  function _renderSessionsSkeleton(count = 5) {
    const list = document.getElementById('sessions-list');
    if (!list) return;
    list.innerHTML = Array.from({ length: count }, () => `
      <div class="session-skeleton-item">
        <div class="skeleton session-skeleton-title"></div>
        <div class="skeleton session-skeleton-meta"></div>
      </div>
    `).join('');
  }

  // ---- Recordings list ----
  async function loadRecordingsList() {
    const list = document.getElementById('recordings-list');
    if (!list) return;
    _renderRecordingsSkeleton(5);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${BACKEND_URL}/api/recordings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const recordings = await res.json();
      _renderRecordingsList(recordings);
    } catch (e) {
      console.warn('[DeLectured] Recordings list load failed:', e);
      if (list) list.innerHTML = '<div class="session-empty">Failed to load recordings.</div>';
    }
  }

  function _renderRecordingsList(recordings) {
    const list = document.getElementById('recordings-list');
    if (!list) return;

    if (!recordings || recordings.length === 0) {
      list.innerHTML = '<div class="session-empty">No saved recordings yet.<br>Record a lecture and save it to cloud.</div>';
      return;
    }

    list.innerHTML = recordings.map(r => {
      const d = new Date(r.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
      const size = (r.file_size / 1024 / 1024).toFixed(1);
      const dur = r.duration_seconds ? ` · ${Math.round(r.duration_seconds / 60)}min` : '';
      return `
        <div class="session-list-item" onclick="window.DeLecturedAuth.playRecording('${r.id}', '${r.download_url}')">
          <div class="session-item-title">${_escapeHtml(r.filename)}</div>
          <div class="session-item-meta">${d}${dur} · ${size} MB</div>
        </div>`;
    }).join('');
  }

  function _renderRecordingsSkeleton(count = 5) {
    const list = document.getElementById('recordings-list');
    if (!list) return;
    list.innerHTML = Array.from({ length: count }, () => `
      <div class="session-skeleton-item">
        <div class="skeleton session-skeleton-title"></div>
        <div class="skeleton session-skeleton-meta"></div>
      </div>
    `).join('');
  }

  async function playRecording(recordingId, downloadUrl) {
    // Open in new tab or use audio element
    window.open(downloadUrl, '_blank');
  }

  // ---- Load a past session into the results view ----
  async function loadSession(sessionId) {
    const list = document.getElementById('sessions-list');
    if (list) list.innerHTML = '<div class="session-empty">Loading...</div>';

    try {
      const token = await getAuthToken();
      const res = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        if (list) loadSessionsList(); // refresh on error
        return;
      }
      const session = await res.json();

      // Close sidebar
      closeSidebar();

      // Inject into app.js global state
      window.currentNotes = session.output_json;
      window.currentSessionId = session.id;
      window.currentTranscript = '';

      // Show results section, hide upload
      const uploadZone = document.getElementById('upload-zone');
      const terminal = document.getElementById('terminal');
      const results = document.getElementById('results');
      const progress = document.getElementById('progress-container');

      if (uploadZone) uploadZone.style.display = 'none';
      if (terminal) terminal.style.display = 'none';
      if (progress) progress.style.display = 'none';
      if (results) results.style.display = 'block';

      results.scrollIntoView({ behavior: 'smooth' });

      // Render all output panels using app.js exposed function
      if (typeof window.renderFullResults === 'function') {
        window.renderFullResults(session.output_json);
      }

      // Show session title
      if (typeof window.showSessionTitle === 'function') {
        window.showSessionTitle(session.title, session.id);
      }
    } catch (e) {
      console.warn('[DeLectured] Session load failed:', e);
      if (list) loadSessionsList();
    }
  }

  // ---- Sidebar controls ----
  function openSidebar() {
    const panel = document.getElementById('sessions-panel');
    const backdrop = document.getElementById('sessions-backdrop');
    if (panel) panel.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    loadSessionsList();
  }

  function closeSidebar() {
    const panel = document.getElementById('sessions-panel');
    const backdrop = document.getElementById('sessions-backdrop');
    if (panel) panel.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  // ---- Auth state change — show/hide auth wall ----
  supabase.auth.onAuthStateChange((event, session) => {
    const authWall = document.getElementById('auth-wall');
    const appContent = document.getElementById('app-content');

    if (session) {
      if (authWall) authWall.style.display = 'none';
      if (appContent) appContent.style.display = 'block';

      // Show user's name in nav
      const userEl = document.getElementById('user-display');
      if (userEl && session.user) {
        const name = session.user.user_metadata?.full_name
          || session.user.email?.split('@')[0]
          || 'User';
        userEl.textContent = name;
      }

      loadUsageCount();
      loadSessionsList();
    } else {
      if (authWall) authWall.style.display = 'flex';
      if (appContent) appContent.style.display = 'none';
    }
  });

  // ---- Utility ----
  function _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Public API ----
  window.DeLecturedAuth = {
    getAuthToken,
    signInWithGoogle,
    signOut,
    loadUsageCount,
    loadSessionsList,
    loadSession,
    openSidebar,
    closeSidebar,
    BACKEND_URL
  };
})();
