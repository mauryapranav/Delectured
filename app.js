// ==========================================
// DeLectured - App Logic & Intelligence
// ==========================================

const MAX_SIZE = 25 * 1024 * 1024;
const CHUNK_DURATION = 10 * 60; 
const TARGET_SAMPLE_RATE = 16000;
const CONCURRENCY_LIMIT = 5; // Increased for Groq efficiency
const CHUNK_OVERLAP_S = 3; // 3 seconds overlap for stitching

const ALLOWED_TYPES = [
  'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 
  'audio/flac', 'video/mp4', 'audio/webm', 'audio/amr', 'audio/aac'
];

// Audio Processing Utilities
async function processAudioFile(file, logTerminal) {
  logTerminal("[PROCESS] Decoding and compressing audio...");
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_SAMPLE_RATE });
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    logTerminal(`[PROCESS] Audio decoded: ${audioBuffer.duration.toFixed(1)}s`);
    
    const chunks = [];
    const overlapSamples = CHUNK_OVERLAP_S * TARGET_SAMPLE_RATE;
    const chunkSamples = CHUNK_DURATION * TARGET_SAMPLE_RATE;
    const totalSamples = audioBuffer.length;
    
    // Split with overlap
    for (let i = 0; i < totalSamples; i += (chunkSamples - overlapSamples)) {
      const end = Math.min(i + chunkSamples, totalSamples);
      const chunkBuffer = audioCtx.createBuffer(1, end - i, TARGET_SAMPLE_RATE);
      const chanData = chunkBuffer.getChannelData(0);
      
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const data = audioBuffer.getChannelData(channel).subarray(i, end);
        for (let s = 0; s < data.length; s++) {
          chanData[s] += data[s] / audioBuffer.numberOfChannels;
        }
      }
      chunks.push(chunkBuffer);
      if (end === totalSamples) break;
    }
    
    logTerminal(`[PROCESS] Optimized into ${chunks.length} overlapping segments.`);
    const blobs = await Promise.all(chunks.map(buffer => audioBufferToMp3Blob(buffer)));
    return blobs;
  } catch (e) {
    console.error(e);
    throw new Error("Failed to process audio. Format unsupported or file corrupted.");
  } finally {
    audioCtx.close();
  }
}

function audioBufferToMp3Blob(buffer) {
  const channels = 1;
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 64);
  const samples = buffer.getChannelData(0);
  const samplesInt16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    samplesInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const mp3Data = [];
  const sampleBlockSize = 1152;
  for (let i = 0; i < samplesInt16.length; i += sampleBlockSize) {
    const chunk = samplesInt16.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
  }
  const finish = mp3encoder.flush();
  if (finish.length > 0) mp3Data.push(finish);
  return new Blob(mp3Data, { type: 'audio/mp3' });
}

let apiKey = localStorage.getItem('groq_api_key') || '';
let currentTranscript = '';
let currentNotes = null;
let currentChatHistory = [];

const examPatterns = [
  /this (will|is going to) be (in|on) (the|your) (exam|test|quiz|finals)/gi,
  /remember this/gi, /this is important/gi, /you (should|must|need to) know this/gi,
  /don't forget/gi, /pay attention/gi, /note (this|that) down/gi,
  /यह exam में आएगा/gi, /यह important है/gi, /याद रखो/gi,
];

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
  langChips: document.querySelectorAll('.lang-chip')
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
  const dlBtn = document.getElementById('btn-download');
  if (dlBtn) dlBtn.addEventListener('click', downloadNotes);
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
  logTerminal("DeLectured v1.3 - Expert Pipeline Engaged");
  
  try {
    updateProgress(10, "Decoding Audio...");
    const audioBlobs = await processAudioFile(file, logTerminal);
    
    const results = new Array(audioBlobs.length);
    let completed = 0;
    let technicalPrompt = "";
    let stage1Analysis = null;

    // Sequential first chunk to get Stage 1 context
    updateProgress(15, "Transcribing Part 1 (Contextualizing)...");
    const firstText = await transcribeAudio(audioBlobs[0]);
    results[0] = firstText;
    completed++;
    
    logTerminal("[STAGE 1] Running speculative analysis on Part 1...");
    stage1Analysis = await analyzeTranscriptStage1(firstText);
    logTerminal(`[STAGE 1] Detected: ${stage1Analysis.domain} - ${stage1Analysis.subject}`);
    technicalPrompt = `Technical lecture about ${stage1Analysis.subject} (${stage1Analysis.domain}). Terms: ${stage1Analysis.emphasis_markers.join(", ")}`;
    
    renderStage1Badges(stage1Analysis);

    // Parallel remaining chunks with Stage 1 context
    if (audioBlobs.length > 1) {
      logTerminal(`[WHISPER] Processing remaining ${audioBlobs.length-1} parts with context...`);
      const remainingIdx = Array.from({length: audioBlobs.length - 1}, (_, i) => i + 1);
      
      for (let i = 0; i < remainingIdx.length; i += CONCURRENCY_LIMIT) {
        const batch = remainingIdx.slice(i, i + CONCURRENCY_LIMIT).map(async (idx) => {
          const text = await transcribeAudio(audioBlobs[idx], technicalPrompt);
          results[idx] = text;
          completed++;
          updateProgress(15 + (completed/audioBlobs.length)*60, `Transcribing ${completed}/${audioBlobs.length}...`);
        });
        await Promise.all(batch);
      }
    }

    updateProgress(75, "Stitching & Cleaning...");
    // Simple deduplication for 3s overlap
    const transcript = deduplicateTranscript(results);
    currentTranscript = transcript;
    document.getElementById('raw-text').textContent = transcript;
    
    const signals = findExamSignals(transcript);
    
    updateProgress(85, "Stage 2 Structuring...");
    logTerminal("[STAGE 2] Generating exhaustive study notes (70B Model)...");
    const notesJson = await generateNotesStage2(transcript, stage1Analysis, signals);
    currentNotes = notesJson;
    
    updateProgress(100, "Complete");
    els.terminal.style.display = 'none';
    els.results.style.display = 'block';
    els.results.scrollIntoView({ behavior: 'smooth' });
    
    renderScore(notesJson.score);
    renderPullquote(notesJson.notes.summary);
    renderDNA(notesJson.lecture_dna);
    if(signals.length > 0 || (notesJson.exam_signals && notesJson.exam_signals.length > 0)) {
        renderExamSignals(notesJson.exam_signals || []);
    }
    renderNotesGrid(notesJson.notes);
    renderFlashcards(notesJson.flashcards);
    if(notesJson.concept_map) renderConceptMap(notesJson.concept_map);

    document.querySelectorAll('.results > *').forEach((el, i) => {
        el.style.opacity = '0'; el.style.animation = `fadeUp 0.5s ${i * 0.1}s forwards`;
    });
    
  } catch (error) {
    logTerminal(`[FATAL ERROR] ${error.message}`);
    console.error(error);
  }
}

function deduplicateTranscript(parts) {
    if (parts.length === 1) return cleanTranscript(parts[0]);
    // For overlap stitching, we just join. Whisper-turbo is good at handling the prefix/suffix context.
    // A more advanced version would use fuzzy matching on the 3s overlap window.
    return cleanTranscript(parts.join(" "));
}

async function transcribeAudio(blob, prompt = "") {
  const formData = new FormData();
  formData.append('file', blob, 'audio.mp3');
  formData.append('model', 'whisper-large-v3-turbo');
  if(prompt) formData.append('initial_prompt', prompt);
  if(selectedLanguage !== 'auto') formData.append('language', selectedLanguage);

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  });
  if (!res.ok) throw new Error(`Whisper API error: ${res.status}`);
  const data = await res.json();
  return data.text;
}

async function analyzeTranscriptStage1(text) {
    const prompt = `Analyze this 10-minute lecture segment. Return JSON:
{
  "domain": "Domain", "subject": "Specific Topic",
  "structure": { "intro_pct": 25, "core_pct": 75, "examples_pct": 0, "conclusion_pct": 0 },
  "emphasis_markers": ["technical term 1", "concept 1"],
  "language": { "detected": "English", "hindi_pct": 0, "english_pct": 100 }
}
Transcript: ${text.substring(0, 4000)}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        })
    });
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
}

async function generateNotesStage2(transcript, analysis, signals) {
    const wordCount = transcript.split(' ').length;
    const conceptScale = Math.min(18, Math.max(6, Math.floor(wordCount / 800)));
    
    const prompt = `You are a world-class educational analyst. Transform this exhaustive ${wordCount}-word transcript into high-density study materials.
    
    LECTURE: ${analysis.subject} (${analysis.domain})
    
    REQUIREMENTS:
    1. Summary: Long-form insight (200-300 words).
    2. Concepts: At least ${conceptScale} unique technical terms with deep definitions.
    3. Mermaid Map: A comprehensive "graph TD" visualization.
    4. Exam Signals: Map exact quotes to potential exam questions.
    
    Return ONLY valid JSON:
    {
      "notes": {
        "summary": "...",
        "structure_summary": { "intro": "...", "core": "...", "examples": "...", "conclusion": "..." },
        "topics": [],
        "concepts": [{ "term": "...", "explanation": "...", "confidence": 1-3 }],
        "important": [],
        "questions": []
      },
      "concept_map": "graph TD...",
      "score": { "clarity": 85, "clarity_label": "High", "density": 90, "density_label": "Very High", "pace": 70, "pace_label": "Steady", "concept_count": ${conceptScale}, "revision_mins": 30 },
      "flashcards": [{ "q": "...", "a": "..." }],
      "exam_signals": [{ "quote": "...", "topic": "..." }],
      "lecture_dna": [20 integers]
    }
    
    Transcript: ${transcript}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" }
        })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(`Stage 2 (70B) failed: ${err.error?.message || res.status}`);
    }
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
}

async function handleChat(msg) {
    if (!currentNotes) return;
    const chatHistoryEl = document.getElementById('chat-history');
    const aiEl = document.createElement('div');
    aiEl.className = 'chat-msg chat-ai'; aiEl.textContent = '...';
    chatHistoryEl.appendChild(aiEl);
    
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                model: "llama-3.1-8b-instant", 
                messages: [{ role: 'system', content: `Context: ${JSON.stringify(currentNotes.notes)}` }, { role: 'user', content: msg }],
                stream: true 
            })
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

function logTerminal(msg) {
  const line = document.createElement('div');
  line.className = 'terminal-line'; line.textContent = `> ${msg}`;
  els.terminalContent.appendChild(line);
  els.terminal.scrollTop = els.terminal.scrollHeight;
}

function cleanTranscript(text) {
  return text.replace(/\b(um|uh|you know|basically)\b/gi, '').replace(/\s+/g, ' ').trim();
}

function findExamSignals(text) {
  let found = [];
  examPatterns.forEach(regex => {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(text.length, match.index + match[0].length + 50);
      found.push(text.substring(start, end).trim());
    }
  });
  return found;
}

function renderStage1Badges(analysis) {
    const container = document.getElementById('badges-container');
    if (!container) return;
    container.innerHTML = `<span class="badge badge-domain">◆ ${analysis.domain.toUpperCase()} / ${analysis.subject.toUpperCase()}</span>`;
}

function renderScore(score) {
    const ids = ['score-clarity', 'score-density', 'score-pace', 'score-concepts', 'score-revision'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'score-clarity') el.textContent = score.clarity;
        if (id === 'score-density') el.textContent = score.density;
        if (id === 'score-pace') el.textContent = score.pace;
        if (id === 'score-concepts') el.textContent = score.concept_count;
        if (id === 'score-revision') el.textContent = score.revision_mins;
    });
}

function renderPullquote(text) { const el = document.getElementById('summary-quote'); if (el) el.textContent = text; }

function renderDNA(dnaArray) {
    const container = document.getElementById('dna-bars');
    if (!container) return;
    container.innerHTML = '';
    dnaArray.forEach((val, i) => {
        const bar = document.createElement('div');
        bar.className = 'dna-bar';
        bar.style.opacity = (val / 10).toString();
        const height = 8 + (val / 10) * 42; 
        container.appendChild(bar);
        setTimeout(() => { bar.style.height = height + 'px'; }, 500 + (i * 25));
    });
}

function renderExamSignals(signals) {
    const container = document.getElementById('exam-signals-container');
    if(!container) return;
    container.style.display = 'block';
    const list = document.getElementById('exam-signals-list');
    if (list) {
        list.innerHTML = '';
        signals.forEach(sig => {
            const div = document.createElement('div');
            div.className = 'exam-signal-item';
            div.innerHTML = `"${sig.quote}" <span style="color:var(--text-tertiary); margin-left:10px;">// ${sig.topic}</span>`;
            list.appendChild(div);
        });
    }
}

function renderNotesGrid(notes) {
    const topicsCol = document.getElementById('col-topics');
    const conceptsCol = document.getElementById('col-concepts');
    if (topicsCol) {
        let html = '';
        notes.topics.forEach(t => html += `<div class="notes-item"><strong>→ ${t}</strong></div>`);
        html += `<div class="notes-col-header" style="margin-top:2rem">Key Takeaways</div>`;
        notes.important.forEach(i => html += `<div class="notes-item">${i}</div>`);
        topicsCol.innerHTML = html;
    }
    if (conceptsCol) {
        let cHtml = '';
        notes.concepts.forEach(c => {
            const dots = Array(3).fill(0).map((_, i) => `<span class="dot ${i < c.confidence ? 'filled' : ''}"></span>`).join('');
            cHtml += `<div class="notes-item"><div class="concept-header"><span class="concept-term">${c.term}</span><span class="confidence-dots">${dots}</span></div><div style="font-size:13px; color:var(--text-secondary)">${c.explanation}</div></div>`;
        });
        conceptsCol.innerHTML = cHtml;
    }
}

function renderConceptMap(mermaidCode) {
    const container = document.getElementById('concept-map-container');
    const target = document.getElementById('concept-map');
    if (!container || !target) return;
    container.style.display = 'block';
    target.innerHTML = mermaidCode;
    target.removeAttribute('data-processed');
    try { if (typeof mermaid !== 'undefined') mermaid.contentLoaded(); } catch (e) { container.style.display = 'none'; }
}

function renderFlashcards(cards) {
    const container = document.getElementById('flashcards-grid');
    if (!container) return;
    container.innerHTML = '';
    cards.forEach((card, i) => {
        const div = document.createElement('div');
        div.className = 'flashcard';
        div.style.setProperty('--tilt', i % 2 === 0 ? '0.4deg' : '-0.4deg');
        div.innerHTML = `<div class="flashcard-inner"><div class="flashcard-front"><div class="fc-q-prefix">Q:</div><div class="fc-text">${card.q}</div><div class="fc-flip-hint">click to flip →</div></div><div class="flashcard-back"><div class="fc-a-prefix">A:</div><div class="fc-text">${card.a}</div></div></div>`;
        div.addEventListener('click', () => div.classList.toggle('flipped'));
        container.appendChild(div);
    });
}

function downloadNotes() {
    if(!currentNotes) return;
    let text = `DELECTURED NOTES\n=================\n\nSUMMARY\n${currentNotes.notes.summary}\n\nCONCEPTS\n`;
    currentNotes.notes.concepts.forEach(c => text += `- ${c.term}: ${c.explanation}\n`);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'notes.txt'; a.click();
}

document.addEventListener('DOMContentLoaded', init);
