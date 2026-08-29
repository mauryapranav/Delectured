// ==========================================
// DeLectured v1.6.7 - Rendering Stability
// ==========================================

const MAX_SIZE = 25 * 1024 * 1024;
const CHUNK_DURATION = 10 * 60;
const TARGET_SAMPLE_RATE = 16000;
const CONCURRENCY_LIMIT = 2;
const CHUNK_OVERLAP_S = 3;

const ALLOWED_TYPES = [
  'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/ogg',
  'audio/flac', 'video/mp4', 'audio/webm', 'audio/amr', 'audio/aac'
];

async function processAudioFile(file) {
  logTerminal("[1/5] PREPARING AUDIO");
  updateProgress(5, "Decoding...");
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_SAMPLE_RATE });
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    logTerminal(`[1/5] PREPARING AUDIO: Decoded ${audioBuffer.duration.toFixed(0)}s`, true);
    audioDurationMinutes = audioBuffer.duration / 60; // v2.0: capture for session save
    const chunks = [];
    const overlapSamples = CHUNK_OVERLAP_S * TARGET_SAMPLE_RATE;
    const chunkSamples = CHUNK_DURATION * TARGET_SAMPLE_RATE;
    const totalSamples = audioBuffer.length;
    for (let i = 0; i < totalSamples; i += (chunkSamples - overlapSamples)) {
      const end = Math.min(i + chunkSamples, totalSamples);
      const chunkBuffer = audioCtx.createBuffer(1, end - i, TARGET_SAMPLE_RATE);
      const chanData = chunkBuffer.getChannelData(0);
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const data = audioBuffer.getChannelData(channel).subarray(i, end);
        for (let s = 0; s < data.length; s++) { chanData[s] += data[s] / audioBuffer.numberOfChannels; }
      }
      chunks.push(chunkBuffer);
      if (end === totalSamples) break;
    }
    const blobs = [];
    for (let i = 0; i < chunks.length; i++) {
      logTerminal(`[1/5] PREPARING AUDIO: Compressing segment ${i + 1}/${chunks.length}...`, true);
      updateProgress(10 + (i / chunks.length) * 10, `Encoding...`);
      blobs.push(await audioBufferToMp3BlobAsync(chunks[i]));
    }
    logTerminal(`[1/5] PREPARING AUDIO: Complete`, true);
    return blobs;
  } catch (e) { throw new Error("Audio decoding failed."); } finally { audioCtx.close(); }
}

async function audioBufferToMp3BlobAsync(buffer) {
  const channels = 1;
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 64);
  const samples = buffer.getChannelData(0);
  const samplesInt16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    samplesInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    if (i % 100000 === 0) await new Promise(r => setTimeout(r, 0));
  }
  const mp3Data = [];
  const sampleBlockSize = 1152;
  for (let i = 0; i < samplesInt16.length; i += sampleBlockSize) {
    const chunk = samplesInt16.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
    if (i % (sampleBlockSize * 500) === 0) await new Promise(r => setTimeout(r, 0));
  }
  const finish = mp3encoder.flush();
  if (finish.length > 0) mp3Data.push(finish);
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

// v2.0: API key removed — all calls proxied through backend
let currentSessionId = null;  // set after auto-save, used for title edits
let audioDurationMinutes = 0; // captured from processAudioFile, sent with session save
let currentTranscript = '';
let currentNotes = null;
let currentChatHistory = [];

// Recording state
let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let recordingStartTime = 0;
let recordingTimerInterval = null;
let audioContext = null;
let analyser = null;
let animationFrameId = null;
let isRecording = false;
let isPaused = false;
const RECORD_CHUNK_DURATION = 30 * 1000; // 30 seconds per chunk
let recordChunkTimer = null;

const els = {
  themeToggle: document.getElementById('theme-toggle'),
  uploadZone: document.getElementById('upload-zone'),
  fileInput: document.getElementById('file-input'),
  terminal: document.getElementById('terminal'),
  terminalContent: document.getElementById('terminal-content'),
  results: document.getElementById('results'),
  langChips: document.querySelectorAll('.lang-chip'),
  processAnother: document.getElementById('btn-process-another'),
  downloadBtn: document.getElementById('btn-download')
};

let selectedLanguage = 'en';

let lastCorner = -1;
function init() {
  // v2.0: No API key logic — auth is handled by auth.js + Supabase

  // Mode toggle
  const modeUpload = document.getElementById('mode-upload');
  const modeRecord = document.getElementById('mode-record');
  const uploadMode = document.getElementById('upload-mode');
  const recordMode = document.getElementById('record-mode');
  
  if (modeUpload && modeRecord) {
    modeUpload.addEventListener('click', () => switchMode('upload'));
    modeRecord.addEventListener('click', () => switchMode('record'));
  }

  els.themeToggle.addEventListener('click', () => {
    if (window.InkTransition) window.InkTransition.toggle();
  });
  els.langChips.forEach(chip => {
    chip.addEventListener('click', () => {
      els.langChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active'); selectedLanguage = chip.dataset.lang;
    });
  });
  els.uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); els.uploadZone.classList.add('dragover'); });
  els.uploadZone.addEventListener('dragleave', () => { els.uploadZone.classList.remove('dragover'); });
  els.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault(); els.uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  els.uploadZone.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (e) => { if (e.target.files.length) handleFile(e.target.files[0]); });

  // Recording controls
  const recordBtn = document.getElementById('record-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');
  const discardBtn = document.getElementById('discard-btn');
  
  if (recordBtn) recordBtn.addEventListener('click', startRecording);
  if (pauseBtn) pauseBtn.addEventListener('click', togglePauseRecording);
  if (stopBtn) stopBtn.addEventListener('click', stopRecording);
  if (discardBtn) discardBtn.addEventListener('click', discardRecording);

  if (els.processAnother) {
    els.processAnother.addEventListener('click', () => {
      if (confirm("Reset and process another lecture? All current data will be cleared.")) {
        location.reload();
      }
    });
  }

  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && chatInput.value.trim()) { handleChat(chatInput.value.trim()); chatInput.value = ''; }
    });
  }
  const tHeader = document.getElementById('transcript-header');
  if (tHeader) {
    tHeader.addEventListener('click', () => {
      const content = document.getElementById('transcript-content');
      content.classList.toggle('open');
      tHeader.querySelector('span:last-child').textContent = content.classList.contains('open') ? 'hide ↑' : 'show ↓';
    });
  }
  const printBtn = document.getElementById('btn-print');
  if (printBtn) printBtn.addEventListener('click', () => window.print());
  if (els.downloadBtn) els.downloadBtn.addEventListener('click', downloadFullReport);
}

// ==========================================
// Recording Functions
// ==========================================

function switchMode(mode) {
  const modeUpload = document.getElementById('mode-upload');
  const modeRecord = document.getElementById('mode-record');
  const uploadMode = document.getElementById('upload-mode');
  const recordMode = document.getElementById('record-mode');
  
  if (mode === 'upload') {
    modeUpload.classList.add('active');
    modeRecord.classList.remove('active');
    uploadMode.style.display = 'block';
    recordMode.style.display = 'none';
  } else {
    modeRecord.classList.add('active');
    modeUpload.classList.remove('active');
    uploadMode.style.display = 'none';
    recordMode.style.display = 'block';
  }
}

async function startRecording() {
  if (isRecording) return;
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 44100
      } 
    });
    
    recordingStream = stream;
    recordedChunks = [];
    isRecording = true;
    isPaused = false;
    recordingStartTime = Date.now();
    
    // Setup audio visualization
    setupAudioVisualizer(stream);
    
    // Create MediaRecorder - use webm/opus for best quality/size ratio
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
      ? 'audio/webm;codecs=opus' 
      : MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : 'audio/mp4';
    
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      await finalizeRecording();
    };
    
    // Start recording with 30-second chunks
    mediaRecorder.start(RECORD_CHUNK_DURATION);
    
    // Update UI
    updateRecordingUI('recording');
    startRecordingTimer();
    
    // Auto-chunk processing timer
    recordChunkTimer = setInterval(() => {
      if (isRecording && !isPaused && mediaRecorder && mediaRecorder.state === 'recording') {
        // Request a data chunk (will trigger ondataavailable)
        mediaRecorder.requestData();
      }
    }, RECORD_CHUNK_DURATION);
    
    logTerminal("Recording started — capturing audio...");
    
  } catch (err) {
    logTerminal(`Recording failed: ${err.message}`);
    alert(`Could not start recording: ${err.message}`);
  }
}

function setupAudioVisualizer(stream) {
  const canvas = document.getElementById('record-canvas');
  if (!canvas) return;
  
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);
  
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  
  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  function draw() {
    if (!isRecording) return;
    
    animationFrameId = requestAnimationFrame(draw);
    
    analyser.getByteFrequencyData(dataArray);
    
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    
    // Clear
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper-3').trim();
    ctx.fillRect(0, 0, width, height);
    
    // Draw frequency bars
    const barWidth = width / bufferLength * 2;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * height * 0.8;
      const hue = 200 - (dataArray[i] / 255) * 200; // Blue to red
      ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }
    
    // Center line
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  
  draw();
}

function togglePauseRecording() {
  if (!mediaRecorder || !isRecording) return;
  
  if (isPaused) {
    mediaRecorder.resume();
    isPaused = false;
    updateRecordingUI('recording');
    startRecordingTimer();
    logTerminal("Recording resumed");
  } else {
    mediaRecorder.pause();
    isPaused = true;
    updateRecordingUI('paused');
    stopRecordingTimer();
    logTerminal("Recording paused");
  }
}

function stopRecordingTimer() {
  if (recordingTimerInterval) {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }
}

function startRecordingTimer() {
  stopRecordingTimer();
  recordingTimerInterval = setInterval(updateRecordingTimer, 1000);
  updateRecordingTimer();
}

function updateRecordingTimer() {
  const timerEl = document.getElementById('record-timer');
  if (!timerEl) return;
  
  const elapsed = Date.now() - recordingStartTime;
  const hrs = Math.floor(elapsed / 3600000);
  const mins = Math.floor((elapsed % 3600000) / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  
  timerEl.textContent = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateRecordingUI(state) {
  const recordBtn = document.getElementById('record-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');
  const discardBtn = document.getElementById('discard-btn');
  const statusEl = document.getElementById('record-status');
  
  if (state === 'recording') {
    recordBtn.style.display = 'none';
    pauseBtn.style.display = 'inline-flex';
    stopBtn.style.display = 'inline-flex';
    discardBtn.style.display = 'inline-flex';
    recordBtn.classList.remove('recording', 'paused');
    if (statusEl) statusEl.textContent = 'Recording...';
  } else if (state === 'paused') {
    recordBtn.style.display = 'inline-flex';
    recordBtn.classList.add('paused');
    recordBtn.querySelector('.record-text').textContent = 'Resume';
    recordBtn.querySelector('.record-icon').textContent = '▶';
    pauseBtn.style.display = 'none';
    stopBtn.style.display = 'inline-flex';
    discardBtn.style.display = 'inline-flex';
    if (statusEl) statusEl.textContent = 'Paused';
  } else if (state === 'ready') {
    recordBtn.style.display = 'inline-flex';
    recordBtn.classList.remove('recording', 'paused');
    recordBtn.querySelector('.record-text').textContent = 'Start Recording';
    recordBtn.querySelector('.record-icon').textContent = '●';
    pauseBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    discardBtn.style.display = 'none';
    if (statusEl) statusEl.textContent = 'Ready to record';
  }
}

async function stopRecording() {
  if (!mediaRecorder || !isRecording) return;
  
  isRecording = false;
  stopRecordingTimer();
  
  if (recordChunkTimer) {
    clearInterval(recordChunkTimer);
    recordChunkTimer = null;
  }
  
  // Stop visualizer
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  
  // Stop media recorder (triggers ondataavailable then onstop)
  if (mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  
  // Stop all tracks
  if (recordingStream) {
    recordingStream.getTracks().forEach(track => track.stop());
    recordingStream = null;
  }
  
  updateRecordingUI('ready');
  logTerminal("Recording stopped — processing...");
}

function discardRecording() {
  if (!isRecording && recordedChunks.length === 0) return;
  
  if (isRecording) {
    stopRecording();
  }
  
  recordedChunks = [];
  recordingStartTime = 0;
  updateRecordingUI('ready');
  
  const timerEl = document.getElementById('record-timer');
  if (timerEl) timerEl.textContent = '00:00:00';
  
  logTerminal("Recording discarded");
}

async function finalizeRecording() {
  if (recordedChunks.length === 0) {
    logTerminal("No audio recorded");
    return;
  }
  
  logTerminal("Finalizing recording...");
  
  // Combine all chunks into a single blob
  const mimeType = mediaRecorder.mimeType || 'audio/webm';
  const fullBlob = new Blob(recordedChunks, { type: mimeType });
  
  logTerminal(`Recording complete: ${(fullBlob.size / 1024 / 1024).toFixed(2)} MB`);
  
  // Store blob for potential saving
  window.lastRecordingBlob = fullBlob;
  window.lastRecordingMimeType = mimeType;
  window.lastRecordingDuration = (Date.now() - recordingStartTime) / 1000;
  
  // Show save recording option
  showSaveRecordingOption(fullBlob.size, mimeType);
  
  // Convert to MP3 using the existing pipeline
  try {
    updateProgress(5, "Converting audio...");
    logTerminal("[1/5] PREPARING AUDIO: Converting recorded audio to MP3...");
    
    // Use the existing processAudioFile but we need to create a File from blob
    const file = new File([fullBlob], `lecture_recording_${Date.now()}.webm`, { type: mimeType });
    
    // Process through existing pipeline
    await handleFile(file);
    
  } catch (err) {
    logTerminal(`Processing failed: ${err.message}`);
    throw err;
  }
}

function showSaveRecordingOption(fileSize, mimeType) {
  const recordPanel = document.getElementById('record-panel');
  if (!recordPanel) return;
  
  // Remove any existing save option
  const existing = document.getElementById('save-recording-option');
  if (existing) existing.remove();
  
  const saveOption = document.createElement('div');
  saveOption.id = 'save-recording-option';
  saveOption.style.cssText = `
    margin-top: 1.5rem; padding: 1rem; background: var(--paper-3); 
    border: 1px solid var(--border); border-radius: 4px; text-align: center;
  `;
  saveOption.innerHTML = `
    <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); margin-bottom: 0.75rem;">
      Recording saved locally. Also save to cloud for access across devices?
    </div>
    <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
      <button class="btn" id="save-recording-btn" style="background: var(--accent-2); border-color: var(--accent-2); color: white;">
        Save to Cloud
      </button>
      <button class="btn" id="skip-save-btn">Skip</button>
    </div>
  `;
  
  recordPanel.appendChild(saveOption);
  
  document.getElementById('save-recording-btn').addEventListener('click', saveRecordingToCloud);
  document.getElementById('skip-save-btn').addEventListener('click', () => {
    saveOption.remove();
  });
}

async function saveRecordingToCloud() {
  const blob = window.lastRecordingBlob;
  const mimeType = window.lastRecordingMimeType;
  const duration = window.lastRecordingDuration;
  
  if (!blob) return;
  
  const btn = document.getElementById('save-recording-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading...';
  
  try {
    const token = await window.DeLecturedAuth.getAuthToken();
    const formData = new FormData();
    formData.append('file', blob, `lecture_${Date.now()}.webm`);
    if (duration) formData.append('duration_seconds', duration.toString());
    if (currentSessionId) formData.append('session_id', currentSessionId);
    
    const res = await fetch(`${window.DeLecturedAuth.BACKEND_URL}/api/recordings/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    
    const data = await res.json();
    logTerminal(`Recording saved to cloud: ${data.filename}`);
    
    const saveOption = document.getElementById('save-recording-option');
    if (saveOption) {
      saveOption.innerHTML = `
        <div style="color: var(--success); font-family: var(--font-mono); font-size: 12px;">
          ✓ Recording saved to cloud successfully
        </div>
      `;
    }
    
  } catch (err) {
    logTerminal(`Save failed: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Retry';
  }
}

function updateApiStatus() {
  // v2.0: No-op. Usage display is handled by auth.js loadUsageCount().
}

function updateProgress(percent, label) {
  const container = document.getElementById('progress-container');
  const fill = document.getElementById('progress-bar-fill');
  const lbl = document.getElementById('progress-label');
  if (container) container.style.display = 'block';
  if (fill) fill.style.width = `${percent}%`;
  if (label && lbl) lbl.textContent = label.toUpperCase();
}

async function handleFile(file) {
  // v2.0: Auth is enforced by backend — no client-side API key check needed
  els.uploadZone.style.display = 'none';
  els.terminal.style.display = 'block';
  els.terminalContent.innerHTML = '';
  document.getElementById('results').style.display = 'none';

  updateProgress(5, "Initializing...");
  logTerminal("DeLectured v2.0.0 - Stability Engine Engaged");

  try {
    const audioBlobs = await processAudioFile(file);
    logTerminal("[2/5] TRANSCRIBING LECTURE");
    const results = new Array(audioBlobs.length);
    let completed = 0;
    for (let i = 0; i < audioBlobs.length; i += CONCURRENCY_LIMIT) {
      const batch = [];
      for (let j = 0; j < CONCURRENCY_LIMIT && (i + j) < audioBlobs.length; j++) {
        const idx = i + j;
        batch.push((async () => {
          try {
            let text = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                text = await transcribeAudio(audioBlobs[idx]);
                break;
              } catch (e) {
                if (attempt === 3) throw e;
                logTerminal(`[RETRY] Part ${idx + 1} failed. Attempt ${attempt + 1}/3...`, true);
                await new Promise(r => setTimeout(r, 2000));
              }
            }
            results[idx] = text;
            completed++;
            logTerminal(`[2/5] TRANSCRIBING LECTURE: Received part ${completed}/${audioBlobs.length}...`, true);
            updateProgress(20 + (completed / audioBlobs.length) * 50, `Transcribing...`);
          } catch (e) {
            throw new Error(`Part ${idx + 1} failed after 3 attempts: ${e.message}`);
          }
        })());
      }
      await Promise.all(batch);
    }
    logTerminal(`[2/5] TRANSCRIBING LECTURE: Complete`, true);
    const fullTranscript = results.join(" ");
    currentTranscript = fullTranscript;
    document.getElementById('raw-text').textContent = fullTranscript;

    updateProgress(75, "Analyzing Structure...");
    logTerminal("[3/5] ANALYZING LECTURE DOMAIN");
    const analysis = await analyzeTranscriptStage1(fullTranscript);

    updateProgress(85, "Expert Intelligence...");
    logTerminal("[4/5] GENERATING HIGH-DENSITY STUDY GUIDE (70B)");
    const notesJson = await generateNotesStage2(fullTranscript, analysis);
    currentNotes = notesJson;

    updateProgress(95, "Finalizing Visuals...");
    logTerminal("[5/5] RENDERING RESULTS");

    // Show results section and scroll — do this BEFORE rendering so user sees the reveal
    els.terminal.style.display = 'none';
    els.results.style.display = 'block';
    updateProgress(100, "Done");
    els.results.scrollIntoView({ behavior: 'smooth' });

    // Render all panels (defensive loop — one failure doesn't crash others)
    try { renderStage1Badges(analysis); } catch (e) { console.warn("Badge error", e); }
    try { renderScore(notesJson.score); } catch (e) { console.warn("Score error", e); }
    try { renderPullquote(notesJson.notes?.summary || ""); } catch (e) { console.warn("Summary error", e); }
    try { renderDNA(notesJson.lecture_dna || Array(20).fill(5)); } catch (e) { console.warn("DNA error", e); }
    try { renderNotesGrid(notesJson.notes); } catch (e) { console.warn("Grid error", e); }
    try { renderFlashcards(notesJson.flashcards); } catch (e) { console.warn("Flash error", e); }
    try {
      if (notesJson.concept_graph) renderConceptMap(notesJson.concept_graph);
      else if (notesJson.concept_map) {
        // Simple fallback if old format returned
        renderConceptMap({ nodes: [{ id: 'n1', label: 'Concept Map Rendered' }], links: [] });
      }
    } catch (e) { console.warn("Map error", e); }

    // v2.0: Auto-save session to Supabase after successful render
    try { await autoSaveSession(notesJson, audioDurationMinutes); } catch (e) { console.warn("Session save error", e); }

  } catch (error) {
    // v2.0: Handle monthly limit gracefully — show friendly message, not a crash
    if (error.message === 'MONTHLY_LIMIT_REACHED') {
      logTerminal('[LIMIT REACHED] You have used all 4 of your free lectures this month.');
      logTerminal('[LIMIT REACHED] Your limit resets on the 1st of next month.');
      if (window.DeLecturedAuth) window.DeLecturedAuth.loadUsageCount();
      return;
    }
    logTerminal(`[FATAL ERROR] ${error.message}`);
    const retryBtn = document.createElement('button');
    retryBtn.className = 'terminal-retry-btn'; retryBtn.textContent = 'RETRY PIPELINE';
    retryBtn.onclick = () => location.reload();
    els.terminalContent.appendChild(retryBtn);
  }
}

async function transcribeAudio(blob) {
  // v2.0: Route through backend proxy — Groq key stays server-side
  const token = await window.DeLecturedAuth.getAuthToken();
  const formData = new FormData();
  formData.append('file', blob, 'lecture_segment.mp3');
  if (selectedLanguage && selectedLanguage !== 'auto') formData.append('language', selectedLanguage);
  const res = await fetch(`${window.DeLecturedAuth.BACKEND_URL}/api/transcribe`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || err.detail || `Status ${res.status}`);
  }
  const data = await res.json();
  return data.text;
}

async function analyzeTranscriptStage1(text) {
  // v2.0: Route through backend proxy
  const token = await window.DeLecturedAuth.getAuthToken();
  const res = await fetch(`${window.DeLecturedAuth.BACKEND_URL}/api/analyze/stage1`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript: text.substring(0, 5000) })
  });
  if (!res.ok) throw new Error(`Stage 1 failed: ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function generateNotesStage2(transcript, analysis) {
  // v2.0: Route through backend proxy. Backend builds the prompt + holds the Groq key.
  // Backend also enforces the monthly usage limit — returns 429 if exceeded.
  const token = await window.DeLecturedAuth.getAuthToken();
  const res = await fetch(`${window.DeLecturedAuth.BACKEND_URL}/api/analyze/stage2`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, stage1_context: analysis })
  });
  if (res.status === 429) {
    // Monthly usage limit hit
    throw new Error('MONTHLY_LIMIT_REACHED');
  }
  if (!res.ok) throw new Error(`Stage 2 failed: ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function handleChat(msg) {
  if (!currentNotes) return;
  const chatHistoryEl = document.getElementById('chat-history');

  const userEl = document.createElement('div');
  userEl.className = 'chat-msg chat-user';
  userEl.setAttribute('data-label', 'QUESTION');
  userEl.textContent = msg;
  chatHistoryEl.appendChild(userEl);

  const aiEl = document.createElement('div');
  aiEl.className = 'chat-msg chat-ai';
  aiEl.setAttribute('data-label', 'DELECTURED INSIGHT');
  aiEl.innerHTML = '<div class="chat-ai-content"><p>...</p></div>';
  chatHistoryEl.appendChild(aiEl);

  const contentEl = aiEl.querySelector('.chat-ai-content');
  let fullText = "";

  try {
    // v2.0: Route chat through backend proxy (streaming SSE forwarded unchanged)
    const token = await window.DeLecturedAuth.getAuthToken();
    const res = await fetch(`${window.DeLecturedAuth.BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        context: currentNotes.notes,
        history: []
      })
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const token = JSON.parse(line.substring(6)).choices[0]?.delta?.content;
            if (token) {
              fullText += token;
              contentEl.innerHTML = formatAIChat(fullText);
            }
          } catch (e) { }
        }
      }
    }
  } catch (e) { contentEl.textContent = `Error: ${e.message}`; }
  chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
}

function formatAIChat(text) {
  let formatted = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^\* (.*)/gm, '<li>$1</li>');

  if (formatted.includes('<li>')) {
    const parts = formatted.split(/<li>/);
    let result = parts[0];
    if (!result.includes('<ul>')) result += '<ul>';
    for (let i = 1; i < parts.length; i++) {
      result += '<li>' + parts[i];
    }
    result += '</ul>';
    formatted = result;
  }
  return `<p>${formatted}</p>`;
}

function logTerminal(msg, update = false) {
  if (update && els.terminalContent.lastChild) { els.terminalContent.lastChild.textContent = `> ${msg}`; }
  else { const line = document.createElement('div'); line.className = 'terminal-line'; line.textContent = `> ${msg}`; els.terminalContent.appendChild(line); }
  els.terminal.scrollTop = els.terminal.scrollHeight;
}

function renderStage1Badges(analysis) {
  const container = document.getElementById('badges-container');
  if (!container) return;
  const dom = (analysis?.domain || "GENERAL").toUpperCase();
  const sub = (analysis?.subject || "LECTURE").toUpperCase();
  container.innerHTML = `<span class="badge">◆ ${dom}</span><span class="badge">◆ ${sub}</span>`;
}

function renderScore(score) {
  if (!score) return;
  document.getElementById('score-clarity').textContent = score.clarity || "--";
  document.getElementById('score-density').textContent = score.density || "--";
  document.getElementById('score-pace').textContent = score.pace || "--";
  document.getElementById('score-concepts').textContent = score.concept_count || "--";
  document.getElementById('score-revision').textContent = score.revision_mins || "--";
}

function renderPullquote(text) {
  const el = document.getElementById('summary-quote');
  if (el) el.innerHTML = (text || "").replace(/\n/g, '<br>');
}

function renderDNA(dnaArray) {
  const container = document.getElementById('dna-bars');
  if (!container || !dnaArray) return;
  container.innerHTML = '';
  const maxVal = Math.max(...dnaArray, 1);
  const segmentLabels = ['Intro', '', '', '', 'Early', '', '', '', '', 'Mid', '', '', '', '', 'Late', '', '', '', '', 'End'];
  dnaArray.forEach((val, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'dna-bar-wrapper';
    const bar = document.createElement('div');
    bar.className = 'dna-bar';
    const pct = (val / maxVal) * 100;
    bar.style.height = pct + '%';
    // Color gradient: low = accent-2 (blue), high = accent (vermillion)
    const ratio = val / maxVal;
    bar.style.backgroundColor = ratio > 0.6 ? 'var(--accent)' : ratio > 0.3 ? 'var(--accent-2)' : 'var(--text-tertiary)';
    bar.style.opacity = 0.4 + ratio * 0.6;
    bar.title = `Segment ${i + 1}: density ${Math.round(pct)}%`;
    wrapper.appendChild(bar);
    // Label for key segments
    if (segmentLabels[i]) {
      const lbl = document.createElement('div');
      lbl.className = 'dna-bar-label';
      lbl.textContent = segmentLabels[i];
      wrapper.appendChild(lbl);
    }
    container.appendChild(wrapper);
  });
}

function renderNotesGrid(notes) {
  const topicsCol = document.getElementById('col-topics');
  const conceptsCol = document.getElementById('col-concepts');
  if (topicsCol && notes?.topics) {
    topicsCol.innerHTML = '<div class="notes-col-header">TOPICS & KEY TAKEAWAYS</div>';
    notes.topics.forEach(t => {
      const d = document.createElement('div'); d.className = 'notes-item';
      d.innerHTML = `<strong>→ ${t}</strong>`; topicsCol.appendChild(d);
    });
    if (notes.important) notes.important.forEach(i => {
      const d = document.createElement('div'); d.className = 'notes-item';
      d.textContent = i; topicsCol.appendChild(d);
    });
  }
  if (conceptsCol && notes?.concepts) {
    conceptsCol.innerHTML = '<div class="notes-col-header">TECHNICAL CONCEPTS</div>';
    notes.concepts.forEach(c => {
      const d = document.createElement('div'); d.className = 'notes-item';
      d.innerHTML = `<div class="concept-header"><strong>${c.term || ''}</strong></div><div style="font-size:13px; color:var(--text-secondary)">${c.explanation || ''}</div>`;
      conceptsCol.appendChild(d);
    });
  }
}

let graphAnimationId = null;
function renderConceptMap(graphData) {
  const container = document.getElementById('concept-map-container');
  const canvas = document.getElementById('concept-canvas');
  if (!container || !canvas || !graphData || !graphData.nodes) return;

  // On very small screens, render static SVG fallback instead of animated canvas
  const isMobile = window.innerWidth < 480;
  if (isMobile && graphData.nodes.length > 0) {
    renderConceptMapStatic(graphData);
    return;
  }

  container.style.display = 'block';
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    // Maintain aspect ratio via CSS, but set internal height for drawing
    const cssHeight = parseFloat(getComputedStyle(canvas).height) || 450;
    canvas.height = cssHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const width = () => canvas.width / dpr;
  const height = 450;

  // Generate background stars
  const bgStars = Array.from({ length: 80 }, () => ({
    x: Math.random(),
    y: Math.random(),
    size: Math.random() * 1.5 + 0.3,
    twinkleSpeed: Math.random() * 2000 + 1500,
    twinkleOffset: Math.random() * Math.PI * 2
  }));

  // Place concept stars with good spacing
  const padding = 60;
  const nodes = graphData.nodes.map((n, i) => {
    const cols = Math.ceil(Math.sqrt(graphData.nodes.length));
    const rows = Math.ceil(graphData.nodes.length / cols);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellW = (width() - padding * 2) / cols;
    const cellH = (height - padding * 2) / rows;
    return {
      ...n,
      x: padding + cellW * col + cellW / 2 + (Math.random() - 0.5) * cellW * 0.4,
      y: padding + cellH * row + cellH / 2 + (Math.random() - 0.5) * cellH * 0.3,
      baseSize: 4 + Math.min(n.label.length * 0.3, 4),
      twinkleSpeed: Math.random() * 1500 + 1000,
      twinkleOffset: Math.random() * Math.PI * 2,
      glowHue: i % 3 === 0 ? 'accent' : i % 3 === 1 ? 'accent2' : 'text'
    };
  });

  const links = (graphData.links || []).map(l => ({
    source: nodes.find(n => n.id === l.source),
    target: nodes.find(n => n.id === l.target),
    label: l.label
  })).filter(l => l.source && l.target);

  if (graphAnimationId) cancelAnimationFrame(graphAnimationId);

  function drawStar4(ctx, cx, cy, outerR, innerR) {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 - Math.PI / 2;
      const nextAngle = angle + Math.PI / 4;
      ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
      ctx.lineTo(cx + Math.cos(nextAngle) * innerR, cy + Math.sin(nextAngle) * innerR);
    }
    ctx.closePath();
  }

  function animate() {
    const w = width();
    const now = Date.now();
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const accent2Color = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim();
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    const bgColor = isDark ? '#0A0A08' : '#1a1a2e';

    // Dark sky background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, height);

    // Subtle nebula glow
    const nebulaGrad = ctx.createRadialGradient(w * 0.3, height * 0.4, 0, w * 0.3, height * 0.4, w * 0.5);
    nebulaGrad.addColorStop(0, isDark ? 'rgba(200, 64, 42, 0.04)' : 'rgba(200, 64, 42, 0.06)');
    nebulaGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = nebulaGrad;
    ctx.fillRect(0, 0, w, height);

    const nebulaGrad2 = ctx.createRadialGradient(w * 0.7, height * 0.6, 0, w * 0.7, height * 0.6, w * 0.4);
    nebulaGrad2.addColorStop(0, isDark ? 'rgba(27, 77, 142, 0.04)' : 'rgba(27, 77, 142, 0.06)');
    nebulaGrad2.addColorStop(1, 'transparent');
    ctx.fillStyle = nebulaGrad2;
    ctx.fillRect(0, 0, w, height);

    // Background stars
    bgStars.forEach(s => {
      const twinkle = 0.3 + 0.7 * ((Math.sin(now / s.twinkleSpeed + s.twinkleOffset) + 1) / 2);
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * height, s.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245, 240, 232, ${twinkle * 0.5})`;
      ctx.fill();
    });

    // Constellation lines
    links.forEach(l => {
      ctx.beginPath();
      ctx.moveTo(l.source.x, l.source.y);
      ctx.lineTo(l.target.x, l.target.y);
      ctx.strokeStyle = `rgba(245, 240, 232, 0.12)`;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Label on link
      if (l.label) {
        const mx = (l.source.x + l.target.x) / 2;
        const my = (l.source.y + l.target.y) / 2;
        ctx.font = `9px "IBM Plex Mono"`;
        ctx.fillStyle = `rgba(245, 240, 232, 0.25)`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(l.label, mx, my - 6);
      }
    });

    // Concept stars
    nodes.forEach(n => {
      const twinkle = 0.6 + 0.4 * ((Math.sin(now / n.twinkleSpeed + n.twinkleOffset) + 1) / 2);
      const starSize = n.baseSize * (0.9 + twinkle * 0.2);
      const glowColor = n.glowHue === 'accent' ? accentColor : n.glowHue === 'accent2' ? accent2Color : '#F5F0E8';

      // Outer glow
      const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, starSize * 5);
      glow.addColorStop(0, glowColor.replace(')', `, ${twinkle * 0.15})`).replace('rgb', 'rgba'));
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(n.x, n.y, starSize * 5, 0, Math.PI * 2);
      ctx.fill();

      // Star shape
      drawStar4(ctx, n.x, n.y, starSize * 1.8, starSize * 0.5);
      ctx.fillStyle = `rgba(245, 240, 232, ${twinkle * 0.9})`;
      ctx.fill();

      // Bright core
      ctx.beginPath();
      ctx.arc(n.x, n.y, starSize * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      // Label
      ctx.font = `italic 600 11px "Playfair Display"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = `rgba(245, 240, 232, ${0.6 + twinkle * 0.3})`;
      const words = n.label.split(' ');
      if (words.length > 3) {
        ctx.fillText(words.slice(0, 2).join(' '), n.x, n.y + starSize * 2.5);
        ctx.fillText(words.slice(2).join(' '), n.x, n.y + starSize * 2.5 + 14);
      } else {
        ctx.fillText(n.label, n.x, n.y + starSize * 2.5);
      }
    });

    // Corner label
    ctx.font = `9px "IBM Plex Mono"`;
    ctx.fillStyle = 'rgba(245, 240, 232, 0.25)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('CONSTELLATION MAP', w - 12, height - 12);

    graphAnimationId = requestAnimationFrame(animate);
  }
  animate();
}

/**
 * Static SVG fallback for concept map on mobile/small screens.
 * Renders a clean, accessible list-based concept map.
 */
function renderConceptMapStatic(graphData) {
  const container = document.getElementById('concept-map-container');
  if (!container || !graphData || !graphData.nodes) return;

  container.style.display = 'block';
  container.innerHTML = `
    <div class="label" style="margin-bottom: 1.5rem;">CONCEPT MAP</div>
    <div class="concept-map-static" style="display: grid; gap: 1rem;">
      ${graphData.nodes.map((node, i) => `
        <div class="concept-node-static" style="
          padding: 1rem;
          background: var(--paper-2);
          border: 1px solid var(--border);
          border-left: 3px solid ${i % 3 === 0 ? 'var(--accent)' : i % 3 === 1 ? 'var(--accent-2)' : 'var(--text-tertiary)'};
        ">
          <div style="font-family: var(--font-serif); font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem;">
            ${node.label}
          </div>
          ${graphData.links?.filter(l => l.source === node.id || l.target === node.id).map(l => `
            <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); margin-top: 0.25rem;">
              ${l.label ? `→ ${l.label} ` : ''}${l.source === node.id ? l.target : l.source}
            </div>
          `).join('') || '<div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary);">No connections</div>'}
        </div>
      `).join('')}
    </div>
    <div style="margin-top: 1rem; font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary);">
      Static view — rotate device for interactive map
    </div>
  `;
}

function renderFlashcards(cards) {
  const container = document.getElementById('flashcards-grid');
  if (!container || !cards) return;
  container.innerHTML = '';
  cards.forEach(card => {
    const div = document.createElement('div');
    div.className = 'flashcard';
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.setAttribute('aria-pressed', 'false');
    div.setAttribute('aria-label', 'Flashcard: press Enter or Space to flip');
    div.innerHTML = `<div class="flashcard-inner"><div class="flashcard-front"><div class="fc-q-prefix">Q:</div><div class="fc-text">${card?.q || ''}</div></div><div class="flashcard-back"><div class="fc-a-prefix">A:</div><div class="fc-text">${card?.a || ''}</div></div></div>`;
    
    const flip = () => {
      const flipped = div.classList.toggle('flipped');
      div.setAttribute('aria-pressed', flipped);
    };
    
    div.addEventListener('click', flip);
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        flip();
      }
    });
    
    container.appendChild(div);
  });
}

function downloadFullReport() {
  if (!currentNotes || !currentTranscript) return;
  
  const notes = currentNotes.notes;
  const score = currentNotes.score;
  const dna = currentNotes.lecture_dna;
  const examSignals = currentNotes.exam_signals || [];
  const flashcards = currentNotes.flashcards || [];
  const concepts = notes?.concepts || [];
  const topics = notes?.topics || [];
  const important = notes?.important || [];
  const summary = notes?.summary || '';
  const structureSummary = notes?.structure_summary || {};
  const title = document.getElementById('session-title-display')?.textContent || 'DeLectured Session';
  const dateStr = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  });
  
  let text = `DELECTURED FULL REPORT
========================

Session: ${title}
Generated: ${dateStr}
Audio Duration: ${audioDurationMinutes.toFixed(1)} minutes

INTELLIGENCE SCORES
-------------------
Clarity:          ${score?.clarity || '--'}/100 (${getScoreLabel('clarity', score?.clarity)})
Content Density:  ${score?.density || '--'}/100 (${getScoreLabel('density', score?.density)})
Pace:             ${score?.pace || '--'}/100 (${getScoreLabel('pace', score?.pace)})
Concepts Found:   ${score?.concept_count || '--'}
Est. Revision:    ${score?.revision_mins || '--'} minutes

EXAM SIGNALS DETECTED
---------------------
${examSignals.length > 0 
  ? examSignals.map(s => `"${s.quote}" (${s.topic || 'General'})`).join('\n')
  : 'No explicit exam signals detected.'}

EXHAUSTIVE TECHNICAL SUMMARY
----------------------------
${summary}

LECTURE STRUCTURE
-----------------
Introduction:     ${structureSummary.intro || 'N/A'}
Core Content:     ${structureSummary.core || 'N/A'}
Examples:         ${structureSummary.examples || 'N/A'}
Conclusion:       ${structureSummary.conclusion || 'N/A'}

TOPICS & KEY TAKEAWAYS
----------------------
${topics.length > 0 ? topics.map(t => `→ ${t}`).join('\n') : 'None'}
${important.length > 0 ? '\nKey Points:\n' + important.map(i => `• ${i}`).join('\n') : ''}

TECHNICAL CONCEPTS (${concepts.length})
${'-'.repeat(40)}
${concepts.map((c, i) => {
  const confidence = '●'.repeat(c.confidence || 0) + '○'.repeat(3 - (c.confidence || 0));
  return `${i + 1}. ${c.term} [${confidence}]
   ${c.explanation}
   Emphasis: ${c.professor_emphasis || 'medium'}`;
}).join('\n\n')}

ACTIVE RECALL FLASHCARDS (${flashcards.length})
${'-'.repeat(40)}
${flashcards.map((f, i) => `Q${i + 1}: ${f.q}\nA${i + 1}: ${f.a}`).join('\n\n')}

LECTURE DNA — CONCEPT DENSITY HEATMAP
${'-'.repeat(40)}
${dna ? renderDNAText(dna) : 'N/A'}

FULL TRANSCRIPTION
${'-'.repeat(40)}
${currentTranscript}

---
Generated by DeLectured v2.0 | Every Lecture. Every Word. Structured.
`;
  
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `DeLectured_${title.replace(/[^a-z0-9]/gi, '_')}_Report.txt`; a.click();
}

function getScoreLabel(type, value) {
  if (value === undefined) return 'N/A';
  if (type === 'clarity') {
    if (value >= 80) return 'Excellent';
    if (value >= 60) return 'Good';
    if (value >= 40) return 'Fair';
    return 'Poor';
  }
  if (type === 'density') {
    if (value >= 80) return 'Very High';
    if (value >= 60) return 'High';
    if (value >= 40) return 'Medium';
    return 'Low';
  }
  if (type === 'pace') {
    if (value >= 80) return 'Fast';
    if (value >= 60) return 'Moderate';
    if (value >= 40) return 'Slow';
    return 'Very Slow';
  }
  return '';
}

function renderDNAText(dna) {
  const maxVal = Math.max(...dna, 1);
  const labels = ['Intro', '', '', '', 'Early', '', '', '', '', 'Mid', '', '', '', '', 'Late', '', '', '', '', 'End'];
  return dna.map((val, i) => {
    const pct = Math.round((val / maxVal) * 100);
    const bar = '█'.repeat(Math.max(1, Math.round(pct / 5))) + '░'.repeat(20 - Math.max(1, Math.round(pct / 5)));
    const label = labels[i] ? ` ${labels[i]}` : '';
    return `  ${(i+1).toString().padStart(2)} ${bar} ${pct}%${label}`;
  }).join('\n');
}

document.addEventListener('DOMContentLoaded', init);

// ==========================================
// v2.0 — New Functions for Auth + Sessions + Export
// ==========================================

/**
 * Re-renders all output panels from a notesJson object.
 * Called by auth.js when loading a past session.
 * Exposed on window so auth.js can call it cross-file.
 */
window.renderFullResults = function renderFullResults(notesJson) {
  try { renderScore(notesJson.score); } catch (e) { console.warn('Score render error', e); }
  try { renderPullquote(notesJson.notes?.summary || ''); } catch (e) { console.warn('Pullquote render error', e); }
  try { renderDNA(notesJson.lecture_dna || Array(20).fill(5)); } catch (e) { console.warn('DNA render error', e); }
  try { renderNotesGrid(notesJson.notes); } catch (e) { console.warn('Grid render error', e); }
  try { renderFlashcards(notesJson.flashcards); } catch (e) { console.warn('Flashcard render error', e); }
  try {
    if (notesJson.concept_graph) renderConceptMap(notesJson.concept_graph);
  } catch (e) { console.warn('Map render error', e); }
  // Clear badges since we don't have stage1 analysis in saved sessions
  const badges = document.getElementById('badges-container');
  if (badges) badges.innerHTML = '<span class="badge">◆ SAVED SESSION</span>';
};

/**
 * Auto-saves the processed session to Supabase.
 * Called after successful Stage 2 render.
 */
async function autoSaveSession(outputJson, durationMins) {
  const token = await window.DeLecturedAuth.getAuthToken();
  const res = await fetch(`${window.DeLecturedAuth.BACKEND_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      output_json: outputJson,
      audio_duration_minutes: durationMins > 0 ? parseFloat(durationMins.toFixed(2)) : null
    })
  });
  if (!res.ok) throw new Error(`Session save failed: ${res.status}`);
  const data = await res.json();
  currentSessionId = data.session_id;
  showSessionTitle(data.title, data.session_id);
  // Refresh usage count display after successful session save
  if (window.DeLecturedAuth) window.DeLecturedAuth.loadUsageCount();
}

/**
 * Displays the session title bar in the results section.
 * Exposed on window for auth.js to call when loading past sessions.
 */
window.showSessionTitle = function showSessionTitle(title, sessionId) {
  currentSessionId = sessionId;
  const container = document.getElementById('session-title-container');
  const display = document.getElementById('session-title-display');
  if (container) container.style.display = 'block';
  if (display) display.textContent = title;
};

/**
 * Switches session title from display span to editable input.
 * Called by onclick on the title span.
 */
window.enableTitleEdit = function enableTitleEdit() {
  const display = document.getElementById('session-title-display');
  const input = document.getElementById('session-title-input');
  if (!display || !input) return;
  input.value = display.textContent;
  display.style.display = 'none';
  input.style.display = 'inline-block';
  input.focus();
  input.select();
};

/**
 * Saves the edited title to Supabase and switches back to display mode.
 * Called by onblur on the title input.
 */
window.saveTitleEdit = async function saveTitleEdit() {
  const display = document.getElementById('session-title-display');
  const input = document.getElementById('session-title-input');
  if (!display || !input) return;

  const newTitle = input.value.trim();
  input.style.display = 'none';
  display.style.display = 'inline-block';

  if (!newTitle || newTitle === display.textContent || !currentSessionId) return;

  display.textContent = newTitle; // optimistic update
  try {
    const token = await window.DeLecturedAuth.getAuthToken();
    await fetch(`${window.DeLecturedAuth.BACKEND_URL}/api/sessions/${currentSessionId}/title`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle })
    });
  } catch (e) {
    console.warn('Title save failed:', e);
  }
};

/**
 * Client-side PDF export using html2pdf.js (loaded via CDN).
 * Creates a clean, data-driven PDF layout (not screen capture).
 */
window.exportToPDF = function exportToPDF() {
  if (!currentNotes) return;
  
  const notes = currentNotes.notes;
  const score = currentNotes.score;
  const dna = currentNotes.lecture_dna;
  const examSignals = currentNotes.exam_signals || [];
  const flashcards = currentNotes.flashcards || [];
  const concepts = notes?.concepts || [];
  const topics = notes?.topics || [];
  const important = notes?.important || [];
  const summary = notes?.summary || '';
  const structureSummary = notes?.structure_summary || {};
  const title = document.getElementById('session-title-display')?.textContent || 'DeLectured Session';
  const dateStr = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  });
  
  // Create a hidden print-optimized container
  const printContainer = document.createElement('div');
  printContainer.id = 'pdf-print-container';
  printContainer.style.cssText = `
    position: absolute; left: -9999px; top: 0; width: 800px;
    background: white; color: black; font-family: "IBM Plex Sans", sans-serif;
    padding: 40px; line-height: 1.6;
  `;
  
  printContainer.innerHTML = generatePDFHTML({
    title, dateStr, audioDurationMinutes,
    score, examSignals, summary, structureSummary,
    topics, important, concepts, flashcards, dna
  });
  
  document.body.appendChild(printContainer);
  
  const filename = `DeLectured_${title.replace(/[^a-z0-9]/gi, '_')}_Report.pdf`;
  
  const opt = {
    margin: [15, 15, 15, 15],
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { 
      scale: 2, 
      useCORS: true, 
      logging: false,
      width: 800,
      windowWidth: 800
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: 'avoid-all', avoid: ['.notes-item', '.flashcard', '.concept-node'] }
  };
  
  html2pdf().set(opt).from(printContainer).save().then(() => {
    document.body.removeChild(printContainer);
  });
};

/**
 * Opens a clean print window with formatted content.
 */
window.printReport = function printReport() {
  if (!currentNotes) return;
  
  const notes = currentNotes.notes;
  const score = currentNotes.score;
  const dna = currentNotes.lecture_dna;
  const examSignals = currentNotes.exam_signals || [];
  const flashcards = currentNotes.flashcards || [];
  const concepts = notes?.concepts || [];
  const topics = notes?.topics || [];
  const important = notes?.important || [];
  const summary = notes?.summary || '';
  const structureSummary = notes?.structure_summary || {};
  const title = document.getElementById('session-title-display')?.textContent || 'DeLectured Session';
  const dateStr = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  });
  
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  printWindow.document.write(generatePDFHTML({
    title, dateStr, audioDurationMinutes,
    score, examSignals, summary, structureSummary,
    topics, important, concepts, flashcards, dna
  }, true));
  printWindow.document.close();
  printWindow.focus();
  
  // Wait for fonts to load then print
  setTimeout(() => {
    printWindow.print();
  }, 500);
};

function generatePDFHTML(data, forPrint = false) {
  const { title, dateStr, audioDurationMinutes, score, examSignals, summary, 
          structureSummary, topics, important, concepts, flashcards, dna } = data;
  
  const bgColor = forPrint ? 'white' : '#F5F0E8';
  const textColor = forPrint ? 'black' : '#0A0A08';
  const accentColor = forPrint ? '#C8402A' : 'var(--accent)';
  const accent2Color = forPrint ? '#1B4D8E' : 'var(--accent-2)';
  const borderColor = forPrint ? '#ddd' : 'var(--border)';
  const paper2Color = forPrint ? '#f5f5f5' : 'var(--paper-2)';
  const paper3Color = forPrint ? '#eee' : 'var(--paper-3)';
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title} - DeLectured Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      background: ${bgColor}; color: ${textColor}; 
      font-family: 'IBM Plex Sans', sans-serif; font-size: 12pt; line-height: 1.7;
    }
    .page { 
      max-width: 800px; margin: 0 auto; padding: 20px;
      background: white; 
    }
    @media print {
      body { background: white; }
      .page { box-shadow: none; margin: 0; padding: 0; }
      .no-print { display: none !important; }
      @page { margin: 20mm; }
    }
    .font-serif { font-family: 'Playfair Display', serif; }
    .font-mono { font-family: 'IBM Plex Mono', monospace; }
    .header { 
      border-bottom: 2px solid ${accentColor}; padding-bottom: 1rem; margin-bottom: 2rem; 
    }
    .title { 
      font-family: 'Playfair Display', serif; font-size: 2.5rem; font-weight: 600; 
      font-style: italic; color: ${textColor}; margin-bottom: 0.5rem; 
    }
    .meta { font-family: 'IBM Plex Mono', monospace; font-size: 0.85rem; color: #666; }
    .section { margin-bottom: 2.5rem; page-break-inside: avoid; }
    .section-title { 
      font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; 
      text-transform: uppercase; letter-spacing: 0.2em; color: ${accentColor}; 
      border-bottom: 1px solid ${borderColor}; padding-bottom: 0.5rem; margin-bottom: 1rem;
    }
    .score-grid { 
      display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; 
      border-top: 1px solid ${borderColor}; border-bottom: 1px solid ${borderColor};
      padding: 1rem 0; margin-bottom: 1rem;
    }
    .score-box { text-align: center; }
    .score-value { 
      font-family: 'Playfair Display', serif; font-size: 2rem; font-style: italic; 
      color: ${accentColor}; line-height: 1; 
    }
    .score-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; text-transform: uppercase; color: #666; }
    .summary-text { font-size: 1.1rem; line-height: 1.8; color: ${textColor}; }
    .structure-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
    .structure-item { background: ${paper2Color}; padding: 1rem; border-radius: 4px; border: 1px solid ${borderColor}; }
    .structure-label { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; text-transform: uppercase; color: ${accent2Color}; margin-bottom: 0.5rem; }
    .notes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
    .notes-col { page-break-inside: avoid; }
    .notes-col-header { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; color: ${accentColor}; border-bottom: 1px solid ${borderColor}; padding-bottom: 0.5rem; margin-bottom: 1rem; }
    .notes-item { margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid ${borderColor}; }
    .notes-item strong { color: ${textColor}; }
    .concept-item { background: ${paper2Color}; border: 1px solid ${borderColor}; border-left: 4px solid ${accentColor}; padding: 1rem; margin-bottom: 1rem; page-break-inside: avoid; }
    .concept-term { font-weight: 600; font-size: 1.1rem; margin-bottom: 0.5rem; }
    .concept-explanation { font-size: 0.95rem; color: #444; line-height: 1.7; }
    .concept-meta { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: #888; margin-top: 0.5rem; }
    .flashcard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .flashcard { background: ${paper2Color}; border: 1px solid ${borderColor}; border-top: 3px solid ${accentColor}; padding: 1.25rem; page-break-inside: avoid; }
    .flashcard-q { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: ${accentColor}; font-weight: 600; margin-bottom: 0.5rem; }
    .flashcard-a { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: ${accent2Color}; font-weight: 600; margin-bottom: 0.5rem; }
    .flashcard-text { font-size: 0.95rem; line-height: 1.6; }
    .dna-container { font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; line-height: 1.5; }
    .dna-bar { display: inline-block; height: 12px; background: ${accentColor}; margin-right: 2px; vertical-align: middle; border-radius: 1px; }
    .exam-signal { background: #fff3cd; border: 1px solid #ffc107; border-left: 4px solid #ffc107; padding: 1rem; margin-bottom: 0.75rem; page-break-inside: avoid; }
    .exam-signal-quote { font-style: italic; margin-bottom: 0.5rem; }
    .exam-signal-topic { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: #856404; }
    .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid ${borderColor}; font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; color: #999; text-align: center; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="title font-serif">${title}</div>
      <div class="meta">Generated ${dateStr} · Duration: ${audioDurationMinutes.toFixed(1)} min · DeLectured v2.0</div>
    </div>
    
    <div class="section">
      <div class="section-title">Intelligence Scores</div>
      <div class="score-grid">
        <div class="score-box">
          <div class="score-value">${score?.clarity || '--'}</div>
          <div class="score-label">Clarity</div>
        </div>
        <div class="score-box">
          <div class="score-value">${score?.density || '--'}</div>
          <div class="score-label">Density</div>
        </div>
        <div class="score-box">
          <div class="score-value">${score?.pace || '--'}</div>
          <div class="score-label">Pace</div>
        </div>
        <div class="score-box">
          <div class="score-value">${score?.concept_count || '--'}</div>
          <div class="score-label">Concepts</div>
        </div>
        <div class="score-box">
          <div class="score-value">${score?.revision_mins || '--'}</div>
          <div class="score-label">Revision (min)</div>
        </div>
      </div>
    </div>
    
    ${examSignals.length > 0 ? `
    <div class="section">
      <div class="section-title">Exam Signals Detected</div>
      ${examSignals.map(s => `
        <div class="exam-signal">
          <div class="exam-signal-quote">"${s.quote}"</div>
          <div class="exam-signal-topic">Topic: ${s.topic || 'General'}</div>
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    <div class="section">
      <div class="section-title">Exhaustive Technical Summary</div>
      <div class="summary-text">${summary.replace(/\n/g, '<br>')}</div>
    </div>
    
    <div class="section">
      <div class="section-title">Lecture Structure</div>
      <div class="structure-grid">
        <div class="structure-item">
          <div class="structure-label">Introduction</div>
          <div>${structureSummary.intro || 'N/A'}</div>
        </div>
        <div class="structure-item">
          <div class="structure-label">Core Content</div>
          <div>${structureSummary.core || 'N/A'}</div>
        </div>
        <div class="structure-item">
          <div class="structure-label">Examples</div>
          <div>${structureSummary.examples || 'N/A'}</div>
        </div>
        <div class="structure-item">
          <div class="structure-label">Conclusion</div>
          <div>${structureSummary.conclusion || 'N/A'}</div>
        </div>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">Topics & Key Takeaways</div>
      <div class="notes-grid">
        <div class="notes-col">
          <div class="notes-col-header">Topics</div>
          ${topics.map(t => `<div class="notes-item"><strong>→</strong> ${t}</div>`).join('') || '<div class="notes-item">None</div>'}
        </div>
        <div class="notes-col">
          <div class="notes-col-header">Key Points</div>
          ${important.map(i => `<div class="notes-item">${i}</div>`).join('') || '<div class="notes-item">None</div>'}
        </div>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">Technical Concepts (${concepts.length})</div>
      ${concepts.map((c, i) => `
        <div class="concept-item">
          <div class="concept-term">${c.term}</div>
          <div class="concept-explanation">${c.explanation}</div>
          <div class="concept-meta">
            Confidence: ${'●'.repeat(c.confidence || 0)}${'○'.repeat(3 - (c.confidence || 0))} · 
            Professor Emphasis: ${c.professor_emphasis || 'medium'}
          </div>
        </div>
      `).join('')}
    </div>
    
    <div class="section">
      <div class="section-title">Active Recall Flashcards (${flashcards.length})</div>
      <div class="flashcard-grid">
        ${flashcards.map(f => `
          <div class="flashcard">
            <div class="flashcard-q">Q: ${f.q}</div>
            <div class="flashcard-text">${f.a}</div>
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">Lecture DNA — Concept Density Heatmap</div>
      <div class="dna-container">
        ${dna ? renderDNAHTML(dna) : 'N/A'}
      </div>
    </div>
    
    <div class="footer">
      Generated by DeLectured v2.0 | Every Lecture. Every Word. Structured.
    </div>
  </div>
</body>
</html>
  `;
}

function renderDNAHTML(dna) {
  const maxVal = Math.max(...dna, 1);
  const labels = ['Intro', '', '', '', 'Early', '', '', '', '', 'Mid', '', '', '', '', 'Late', '', '', '', '', 'End'];
  return dna.map((val, i) => {
    const pct = Math.round((val / maxVal) * 100);
    const barWidth = Math.max(2, Math.round(pct / 5 * 4));
    const label = labels[i] ? `<span style="margin-left:8px;color:#888;">${labels[i]}</span>` : '';
    return `<div style="margin: 2px 0;">
      <span style="display:inline-block;width:30px;text-align:right;color:#999;">${(i+1).toString().padStart(2)}</span>
      <span class="dna-bar" style="width:${barWidth}px;background:${pct > 60 ? '#C8402A' : pct > 30 ? '#1B4D8E' : '#888'};"></span>
      <span style="margin-left:8px;color:#666;">${pct}%</span>${label}
    </div>`;
  }).join('');
}
