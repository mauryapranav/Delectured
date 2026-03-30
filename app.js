// ==========================================
// DeLectured v1.6.4 - Async Performance
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
        logTerminal(`[1/5] PREPARING AUDIO: Encoding segment ${i+1}/${chunks.length}...`, true);
        updateProgress(10 + (i/chunks.length)*10, `MP3 Encoding...`);
        // Use the new async-friendly encoder
        blobs.push(await audioBufferToMp3BlobAsync(chunks[i]));
    }
    logTerminal(`[1/5] PREPARING AUDIO: Complete`, true);
    return blobs;
  } catch (e) { throw new Error("Audio decoding failed."); } finally { audioCtx.close(); }
}

// Fixed: Added async yielding to prevent UI freezing
async function audioBufferToMp3BlobAsync(buffer) {
  const channels = 1;
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 64);
  const samples = buffer.getChannelData(0);
  const samplesInt16 = new Int16Array(samples.length);
  
  // Convert samples in small chunks to keep UI alive
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
    // Yield every 500 blocks
    if (i % (sampleBlockSize * 500) === 0) await new Promise(r => setTimeout(r, 0));
  }
  
  const finish = mp3encoder.flush();
  if (finish.length > 0) mp3Data.push(finish);
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

let apiKey = localStorage.getItem('groq_api_key') || '';
let currentTranscript = '';
let currentNotes = null;
let currentChatHistory = [];

const els = {
  themeToggle: document.getElementById('theme-toggle'),
  apiToggle: document.getElementById('api-key-toggle'),
  apiPanel: document.getElementById('api-panel'),
  apiInput: document.getElementById('api-input'),
  apiSave: document.getElementById('api-save'),
  apiStatus: document.getElementById('api-status'),
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

function init() {
  updateApiStatus();
  els.themeToggle.addEventListener('click', () => {
    const isDark = document.body.parentElement.getAttribute('data-theme') === 'dark';
    document.body.parentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  });
  els.apiToggle.addEventListener('click', (e) => {
    e.preventDefault();
    els.apiPanel.classList.toggle('active');
    if(els.apiPanel.classList.contains('active') && !apiKey) els.apiInput.focus();
  });
  els.apiSave.addEventListener('click', () => {
    const val = els.apiInput.value.trim();
    if(val) { apiKey = val; localStorage.setItem('groq_api_key', apiKey); updateApiStatus(); els.apiPanel.classList.remove('active'); }
  });
  if (apiKey) els.apiInput.value = apiKey;
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

function updateApiStatus() {
  if (apiKey) { els.apiStatus.textContent = 'API KEY: SET ✓'; els.apiStatus.style.color = 'var(--success)'; }
  else { els.apiStatus.textContent = 'API KEY: NOT SET'; els.apiStatus.style.color = 'var(--accent)'; }
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
  if (!apiKey) { alert("Please set your Groq API key first."); return; }
  els.uploadZone.style.display = 'none';
  els.terminal.style.display = 'block';
  els.terminalContent.innerHTML = '';
  document.getElementById('results').style.display = 'none';
  
  updateProgress(5, "Initializing...");
  logTerminal("DeLectured v1.6.4 Engaged (Async Mode)");
  
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
            results[idx] = await transcribeAudio(audioBlobs[idx]);
            completed++;
            logTerminal(`[2/5] TRANSCRIBING LECTURE: Part ${completed}/${audioBlobs.length} received`, true);
            updateProgress(20 + (completed/audioBlobs.length)*50, `Transcribing...`);
          } catch (e) {
            results[idx] = await transcribeAudio(audioBlobs[idx]);
            completed++;
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
    
    updateProgress(85, "Intelligence Engine...");
    logTerminal("[4/5] GENERATING STUDY GUIDE (70B)");
    const notesJson = await generateNotesStage2(fullTranscript, analysis);
    currentNotes = notesJson;
    
    updateProgress(95, "Finalizing Visuals...");
    logTerminal("[5/5] RENDERING RESULTS");
    
    els.terminal.style.display = 'none';
    els.results.style.display = 'block';
    
    renderStage1Badges(analysis);
    renderScore(notesJson.score);
    renderPullquote(notesJson.notes?.summary || "");
    renderDNA(notesJson.lecture_dna || Array(20).fill(5));
    renderNotesGrid(notesJson.notes);
    renderFlashcards(notesJson.flashcards);
    if(notesJson.concept_map) renderConceptMap(notesJson.concept_map);

    updateProgress(100, "Done");
    els.results.scrollIntoView({ behavior: 'smooth' });
    
  } catch (error) {
    logTerminal(`[FATAL ERROR] ${error.message}`);
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn'; retryBtn.textContent = 'RETRY';
    retryBtn.onclick = () => location.reload();
    els.terminalContent.appendChild(retryBtn);
  }
}

async function transcribeAudio(blob) {
  const formData = new FormData();
  formData.append('file', blob, 'audio.mp3');
  formData.append('model', 'whisper-large-v3-turbo');
  if(selectedLanguage !== 'auto') formData.append('language', selectedLanguage);
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  });
  if (!res.ok) throw new Error("Whisper failed.");
  const data = await res.json();
  return data.text;
}

async function analyzeTranscriptStage1(text) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "user", content: `Analyze domain and subject. JSON: { "domain": "...", "subject": "..." }. Transcript: ${text.substring(0, 5000)}` }],
            response_format: { type: "json_object" }
        })
    });
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
}

async function generateNotesStage2(transcript, analysis) {
    const wordCount = transcript.split(' ').length;
    const prompt = `You are a Subject Matter Expert in ${analysis.domain}. 
    TASK: Transform this ${wordCount}-word transcript into an EXHAUSTIVE, high-density study guide.
    1. SUMMARY: Minimum 500 words technical explaining the core thesis.
    2. CONCEPTS: Extract 20 concepts with deep definitions.
    3. CONCEPT MAP: Mermaid.js graph TD code.
    Return ONLY valid JSON:
    {
      "notes": {
        "summary": "Full detailed analysis (500+ words)...",
        "topics": ["Topic 1", "..."],
        "concepts": [{ "term": "...", "explanation": "Deep academic definition...", "confidence": 1-3 }],
        "important": ["Insight 1", "..."],
        "structure_summary": { "intro": "...", "core": "...", "examples": "...", "conclusion": "..." }
      },
      "concept_map": "graph TD\\n  A((Concept)) -- defines --> B((Concept))\\n...",
      "score": { "clarity": 85, "density": 95, "pace": 70, "concept_count": 20, "revision_mins": 60 },
      "flashcards": [{ "q": "...", "a": "..." }],
      "lecture_dna": [20 integers]
    }
    Transcript: ${transcript}`;
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.1, response_format: { type: "json_object" } })
    });
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
}

async function handleChat(msg) {
    if (!currentNotes) return;
    const chatHistoryEl = document.getElementById('chat-history');
    const userEl = document.createElement('div');
    userEl.className = 'chat-msg chat-user'; userEl.textContent = msg;
    chatHistoryEl.appendChild(userEl);
    const aiEl = document.createElement('div');
    aiEl.className = 'chat-msg chat-ai'; aiEl.textContent = '...';
    chatHistoryEl.appendChild(aiEl);
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: 'system', content: `Context: ${JSON.stringify(currentNotes.notes)}` }, { role: 'user', content: msg }], stream: true })
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        aiEl.textContent = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split("\n");
            for (const line of lines) {
                if (line.startsWith("data: ") && line !== "data: [DONE]") {
                    try {
                        const token = JSON.parse(line.substring(6)).choices[0]?.delta?.content;
                        if (token) aiEl.textContent += token;
                    } catch (e) {}
                }
            }
        }
    } catch(e) { aiEl.textContent = `Error: ${e.message}`; }
}

function logTerminal(msg, update = false) {
  if (update && els.terminalContent.lastChild) { els.terminalContent.lastChild.textContent = `> ${msg}`; }
  else { const line = document.createElement('div'); line.className = 'terminal-line'; line.textContent = `> ${msg}`; els.terminalContent.appendChild(line); }
  els.terminal.scrollTop = els.terminal.scrollHeight;
}

function renderStage1Badges(analysis) {
    const container = document.getElementById('badges-container');
    if (!container) return;
    container.innerHTML = `<span class="badge">◆ ${analysis.domain.toUpperCase()}</span><span class="badge">◆ ${analysis.subject.toUpperCase()}</span>`;
}

function renderScore(score) {
    if (!score) return;
    document.getElementById('score-clarity').textContent = score.clarity || "--";
    document.getElementById('score-density').textContent = score.density || "--";
    document.getElementById('score-pace').textContent = score.pace || "--";
    document.getElementById('score-concepts').textContent = score.concept_count || "--";
    document.getElementById('score-revision').textContent = score.revision_mins || "--";
}

function renderPullquote(text) { document.getElementById('summary-quote').textContent = text; }

function renderDNA(dnaArray) {
    const container = document.getElementById('dna-bars');
    if (!container || !dnaArray) return;
    container.innerHTML = '';
    dnaArray.forEach(val => {
        const bar = document.createElement('div');
        bar.className = 'dna-bar';
        bar.style.height = (val / 10) * 100 + '%'; 
        bar.style.opacity = (val / 10);
        container.appendChild(bar);
    });
}

function renderNotesGrid(notes) {
    const topicsCol = document.getElementById('col-topics');
    const conceptsCol = document.getElementById('col-concepts');
    if (topicsCol && notes?.topics) {
        topicsCol.innerHTML = '<div class="notes-col-header">TOPICS & KEY TAKEAWAYS</div>';
        notes.topics.forEach(t => { 
            const d = document.createElement('div'); d.className='notes-item'; 
            d.innerHTML=`<strong>→ ${t}</strong>`; topicsCol.appendChild(d); 
        });
        if(notes.important) notes.important.forEach(i => {
            const d = document.createElement('div'); d.className='notes-item';
            d.textContent = i; topicsCol.appendChild(d);
        });
    }
    if (conceptsCol && notes?.concepts) {
        conceptsCol.innerHTML = '<div class="notes-col-header">TECHNICAL CONCEPTS</div>';
        notes.concepts.forEach(c => {
            const d = document.createElement('div'); d.className='notes-item';
            d.innerHTML = `<div class="concept-header"><strong>${c.term || ''}</strong></div><div style="font-size:13px; color:var(--text-secondary)">${c.explanation || ''}</div>`;
            conceptsCol.appendChild(d);
        });
    }
}

function renderConceptMap(mermaidCode) {
    const container = document.getElementById('concept-map-container');
    const target = document.getElementById('concept-map');
    if (!container || !target || !mermaidCode) return;
    container.style.display = 'block';
    target.innerHTML = mermaidCode;
    target.removeAttribute('data-processed');
    setTimeout(() => { if (typeof mermaid !== 'undefined') mermaid.contentLoaded(); }, 200);
}

function renderFlashcards(cards) {
    const container = document.getElementById('flashcards-grid');
    if (!container || !cards) return;
    container.innerHTML = '';
    cards.forEach(card => {
        const div = document.createElement('div');
        div.className = 'flashcard';
        div.innerHTML = `<div class="flashcard-inner"><div class="flashcard-front"><div class="fc-q-prefix">Q:</div><div class="fc-text">${card?.q || ''}</div></div><div class="flashcard-back"><div class="fc-a-prefix">A:</div><div class="fc-text">${card?.a || ''}</div></div></div>`;
        div.addEventListener('click', () => div.classList.toggle('flipped'));
        container.appendChild(div);
    });
}

function downloadFullReport() {
    if(!currentNotes || !currentTranscript) return;
    let text = `DELECTURED FULL REPORT\n========================\n\n`;
    text += `SUMMARY:\n${currentNotes.notes?.summary || ''}\n\n`;
    text += `TECHNICAL CONCEPTS:\n`;
    currentNotes.notes?.concepts?.forEach(c => { text += `- ${c.term}: ${c.explanation}\n`; });
    text += `\nFULL TRANSCRIPTION:\n${currentTranscript}`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'DeLectured_Report.txt'; a.click();
}

document.addEventListener('DOMContentLoaded', init);
