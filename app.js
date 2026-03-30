// ==========================================
// DeLectured - App Logic & Intelligence
// ==========================================

const MAX_SIZE = 25 * 1024 * 1024; // 25MB limit for Groq
const CHUNK_DURATION = 10 * 60; // 10 minutes per chunk
const TARGET_SAMPLE_RATE = 16000;
const CONCURRENCY_LIMIT = 3; // Number of parallel transcription requests

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
    const chunkSamples = CHUNK_DURATION * TARGET_SAMPLE_RATE;
    const totalSamples = audioBuffer.length;
    
    // Always split or process to optimize
    for (let i = 0; i < totalSamples; i += chunkSamples) {
      const end = Math.min(i + chunkSamples, totalSamples);
      const chunkBuffer = audioCtx.createBuffer(1, end - i, TARGET_SAMPLE_RATE);
      const chanData = chunkBuffer.getChannelData(0);
      
      // Mix down to mono and copy
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const data = audioBuffer.getChannelData(channel).subarray(i, end);
        for (let s = 0; s < data.length; s++) {
          chanData[s] += data[s] / audioBuffer.numberOfChannels;
        }
      }
      chunks.push(chunkBuffer);
    }
    
    logTerminal(`[PROCESS] Optimized into ${chunks.length} compressed segments.`);
    const blobs = await Promise.all(chunks.map(buffer => audioBufferToMp3Blob(buffer)));
    return blobs;
  } catch (e) {
    console.error(e);
    throw new Error("Failed to process audio. Format unsupported or file corrupted.");
  } finally {
    audioCtx.close();
  }
}

// Convert AudioBuffer to MP3 using lamejs (much smaller than WAV)
function audioBufferToMp3Blob(buffer) {
  const channels = 1;
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 64);
  const samples = buffer.getChannelData(0);
  
  // Convert to 16-bit PCM
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
  /remember this/gi,
  /this is important/gi,
  /you (should|must|need to) know this/gi,
  /don't forget/gi,
  /pay attention/gi,
  /note (this|that) down/gi,
  /यह exam में आएगा/gi,
  /यह important है/gi,
  /याद रखो/gi,
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
    if(val) {
      apiKey = val;
      localStorage.setItem('groq_api_key', apiKey);
      updateApiStatus();
      els.apiPanel.classList.remove('active');
    }
  });
  if (apiKey) els.apiInput.value = apiKey;
  els.langChips.forEach(chip => {
    chip.addEventListener('click', () => {
      els.langChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedLanguage = chip.dataset.lang;
    });
  });
  els.uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); els.uploadZone.classList.add('dragover'); });
  els.uploadZone.addEventListener('dragleave', () => { els.uploadZone.classList.remove('dragover'); });
  els.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  els.uploadZone.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (e) => { if (e.target.files.length) handleFile(e.target.files[0]); });
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && chatInput.value.trim()) {
        handleChat(chatInput.value.trim());
        chatInput.value = '';
      }
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
  if (apiKey) {
    els.apiStatus.textContent = 'API KEY: SET ✓';
    els.apiStatus.style.color = 'var(--success)';
  } else {
    els.apiStatus.textContent = 'API KEY: NOT SET';
    els.apiStatus.style.color = 'var(--accent)';
  }
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
  if (!apiKey) {
    els.apiPanel.classList.add('active');
    els.apiInput.focus();
    alert("Please set your Groq API key first.");
    return;
  }
  if (file.size > 1024 * 1024 * 1024) { alert("File too large (>1GB)."); return; }
  
  els.uploadZone.style.display = 'none';
  els.terminal.style.display = 'block';
  els.terminalContent.innerHTML = '';
  document.getElementById('results').style.display = 'none';
  
  updateProgress(5, "Initializing...");
  logTerminal("Initializing DeLectured v1.2 (Parallel Engine)");
  logTerminal(`Input: ${file.name} (${(file.size/1024/1024).toFixed(1)} MB)`);
  
  try {
    updateProgress(10, "Processing Audio...");
    const audioBlobs = await processAudioFile(file, logTerminal);
    
    // Parallel Transcription with Concurrency Control
    logTerminal(`[WHISPER] Starting parallel transcription of ${audioBlobs.length} segments...`);
    const results = new Array(audioBlobs.length);
    let completed = 0;
    
    async function transcribePart(idx) {
      const partNum = idx + 1;
      logTerminal(`[WHISPER] Uploading Part ${partNum}/${audioBlobs.length}...`);
      const text = await transcribeAudio(audioBlobs[idx]);
      results[idx] = text;
      completed++;
      const progress = 15 + ((completed / audioBlobs.length) * 60);
      updateProgress(progress, `Transcribing ${completed}/${audioBlobs.length}...`);
      logTerminal(`[WHISPER] Part ${partNum} complete.`);
    }

    // Process in batches
    for (let i = 0; i < audioBlobs.length; i += CONCURRENCY_LIMIT) {
      const batch = [];
      for (let j = 0; j < CONCURRENCY_LIMIT && (i + j) < audioBlobs.length; j++) {
        batch.push(transcribePart(i + j));
      }
      await Promise.all(batch);
    }
    
    updateProgress(75, "Consolidating...");
    const fullTranscript = results.join(" ");
    const transcript = cleanTranscript(fullTranscript);
    currentTranscript = transcript;
    
    if (transcript.split(' ').length < 50) throw new Error("Transcript too short.");
    document.getElementById('raw-text').textContent = transcript;
    const signals = findExamSignals(transcript);
    
    updateProgress(80, "Stage 1 Analysis...");
    logTerminal("[STAGE 1] Analyzing lecture structure...");
    const analysis = await analyzeTranscriptStage1(transcript);
    
    updateProgress(90, "Stage 2 Structuring...");
    logTerminal("[STAGE 2] Generating dynamic structured notes...");
    const notesJson = await generateNotesStage2(transcript, analysis, signals);
    currentNotes = notesJson;
    
    updateProgress(100, "Complete");
    logTerminal("[STAGE 2] Rendering visual results...");
    
    els.terminal.style.display = 'none';
    els.results.style.display = 'block';
    els.results.scrollIntoView({ behavior: 'smooth' });
    
    renderScore(notesJson.score);
    renderPullquote(notesJson.notes.summary);
    renderDNA(notesJson.lecture_dna);
    if(signals.length > 0 || (notesJson.exam_signals && notesJson.exam_signals.length > 0)) {
        renderExamSignals(notesJson.exam_signals || signals.map(s => ({quote: s, topic: "General"})));
    } else {
        document.getElementById('exam-signals-container').style.display = 'none';
    }
    renderNotesGrid(notesJson.notes);
    renderFlashcards(notesJson.flashcards);
    if(notesJson.concept_map) renderConceptMap(notesJson.concept_map);

    document.querySelectorAll('.results > *').forEach((el, i) => {
        el.style.opacity = '0';
        el.style.animation = `fadeUp 0.5s ${i * 0.1}s forwards`;
    });
    
  } catch (error) {
    logTerminal(`[ERROR] ${error.message}`);
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn'; retryBtn.style.marginTop = '1rem'; retryBtn.textContent = 'RETRY';
    retryBtn.onclick = () => { els.terminal.style.display = 'none'; els.uploadZone.style.display = 'flex'; };
    els.terminalContent.appendChild(retryBtn);
  }
}

async function transcribeAudio(blob) {
  const formData = new FormData();
  formData.append('file', blob, 'audio.mp3');
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'json');
  if(selectedLanguage !== 'auto') formData.append('language', selectedLanguage);

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error?.message || 'Transcription failed.');
  }
  const data = await res.json();
  return data.text;
}

async function analyzeTranscriptStage1(transcript) {
    const analysisText = transcript.length > 6000 ? transcript.substring(0, 6000) : transcript;
    const prompt = `Analyze this lecture transcript. Return ONLY valid JSON:
{
  "domain": "Computer Science",
  "subject": "Topic Name",
  "structure": { "intro_pct": 15, "core_pct": 55, "examples_pct": 20, "conclusion_pct": 10 },
  "emphasis_markers": ["phrase 1"],
  "language": { "detected": "English", "hindi_pct": 0, "english_pct": 100 }
}
Transcript: ${analysisText}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" }
        })
    });
    if (!res.ok) throw new Error("Stage 1 analysis failed.");
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
}

async function generateNotesStage2(transcript, analysis, signals) {
    const wordCount = transcript.split(' ').length;
    // Scale expectations based on lecture length
    const conceptScale = Math.min(15, Math.max(5, Math.floor(wordCount / 1000)));
    const summaryLength = wordCount > 5000 ? "8-10 sentences" : "3-4 sentences";

    const prompt = `You are an expert Subject Matter Expert in ${analysis.domain}. 
    Structure this ${wordCount} word lecture into exhaustive, high-density study notes.
    
    LECTURE CONTEXT: ${analysis.subject} | Language: ${analysis.language.detected}
    
    OUTPUT REQUIREMENTS:
    - Summary: ${summaryLength} explaining the core thesis and WHY it matters.
    - Concepts: Extract at least ${conceptScale} unique concepts with detailed technical explanations.
    - Concept Map: Valid Mermaid.js graph code (graph TD or mindmap) connecting all major topics.
    - Exam Signals: Be aggressive in finding segments relevant to exams.
    
    Return ONLY valid JSON:
    {
      "notes": {
        "summary": "Detailed insight-driven summary...",
        "structure_summary": { "intro": "...", "core": "...", "examples": "...", "conclusion": "..." },
        "topics": [],
        "concepts": [{ "term": "...", "explanation": "...", "confidence": 1-3 }],
        "important": [],
        "questions": []
      },
      "concept_map": "mermaid code...",
      "score": { "clarity": 0-100, "clarity_label": "...", "density": 0-100, "density_label": "...", "pace": 0-100, "pace_label": "...", "concept_count": ${conceptScale}, "revision_mins": 0 },
      "flashcards": [{ "q": "...", "a": "..." }],
      "exam_signals": [{ "quote": "...", "topic": "..." }],
      "lecture_dna": [20 integers]
    }
    
    Transcript: ${transcript}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            response_format: { type: "json_object" }
        })
    });
    if (!res.ok) throw new Error("Stage 2 structuring failed.");
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
}

async function handleChat(msg) {
    if (!currentNotes || !currentTranscript) return;
    const chatHistoryEl = document.getElementById('chat-history');
    const userEl = document.createElement('div');
    userEl.className = 'chat-msg chat-user'; userEl.textContent = msg;
    chatHistoryEl.appendChild(userEl);
    const aiEl = document.createElement('div');
    aiEl.className = 'chat-msg chat-ai'; aiEl.textContent = '...';
    chatHistoryEl.appendChild(aiEl);
    
    const messages = [
        { role: 'system', content: `You are a study assistant. Answer ONLY from this lecture content: ${JSON.stringify(currentNotes.notes)}` },
        ...currentChatHistory,
        { role: 'user', content: msg }
    ];
    
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: messages, temperature: 0.3, stream: true })
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullResponse = ""; aiEl.textContent = "";
        let partialChunk = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = partialChunk + decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            partialChunk = lines.pop();
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
                    try {
                        const data = JSON.parse(trimmed.substring(6));
                        const token = data.choices[0]?.delta?.content;
                        if (token) { fullResponse += token; aiEl.textContent += token; }
                    } catch (e) {}
                }
            }
        }
        currentChatHistory.push({ role: 'user', content: msg }, { role: 'assistant', content: fullResponse });
        if(currentChatHistory.length > 10) currentChatHistory = currentChatHistory.slice(-10);
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
    if (analysis.language.hindi_pct > 10) container.innerHTML += `<span class="badge badge-hinglish">◆ HINGLISH DETECTED</span>`;
}

function renderScore(score) {
    const ids = ['score-clarity', 'lbl-clarity', 'score-density', 'lbl-density', 'score-pace', 'lbl-pace', 'score-concepts', 'lbl-concepts', 'score-revision', 'lbl-revision'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'score-clarity') el.textContent = score.clarity;
        if (id === 'lbl-clarity') el.textContent = score.clarity_label;
        if (id === 'score-density') el.textContent = score.density;
        if (id === 'lbl-density') el.textContent = score.density_label;
        if (id === 'score-pace') el.textContent = score.pace;
        if (id === 'lbl-pace') el.textContent = score.pace_label;
        if (id === 'score-concepts') el.textContent = score.concept_count;
        if (id === 'lbl-concepts') el.textContent = "FOUND";
        if (id === 'score-revision') el.textContent = score.revision_mins;
        if (id === 'lbl-revision') el.textContent = "MINUTES";
    });
    const bars = document.querySelectorAll('.score-bar');
    if (bars.length >= 5) {
        bars[0].style.width = score.clarity + '%';
        bars[1].style.width = score.density + '%';
        bars[2].style.width = score.pace + '%';
        bars[3].style.width = Math.min(100, score.concept_count * 10) + '%';
        bars[4].style.width = Math.min(100, (score.revision_mins/60)*100) + '%';
    }
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
    if(!signals || signals.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    const list = document.getElementById('exam-signals-list');
    if (!list) return;
    list.innerHTML = '';
    signals.forEach(sig => {
        const div = document.createElement('div');
        div.className = 'exam-signal-item';
        div.innerHTML = `"${sig.quote}" <span style="color:var(--text-tertiary); margin-left:10px;">// ${sig.topic}</span>`;
        list.appendChild(div);
    });
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
