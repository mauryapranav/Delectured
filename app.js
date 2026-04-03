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
        logTerminal(`[1/5] PREPARING AUDIO: Compressing segment ${i+1}/${chunks.length}...`, true);
        updateProgress(10 + (i/chunks.length)*10, `Encoding...`);
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

let lastCorner = -1;
function init() {
  updateApiStatus();
  
  els.themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    
    // Apply universal transition class to ensure everything changes simultaneously
    document.body.classList.add('theme-transition');
    
    // Swap the theme
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    
    // Remove the transition class after it completes (300ms) to prevent lag on regular hover states
    setTimeout(() => {
        document.body.classList.remove('theme-transition');
    }, 300);
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
  logTerminal("DeLectured v1.6.7 - Stability Engine Engaged");
  
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
                    logTerminal(`[RETRY] Part ${idx+1} failed. Attempt ${attempt+1}/3...`, true);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            results[idx] = text;
            completed++;
            logTerminal(`[2/5] TRANSCRIBING LECTURE: Received part ${completed}/${audioBlobs.length}...`, true);
            updateProgress(20 + (completed/audioBlobs.length)*50, `Transcribing...`);
          } catch (e) {
            throw new Error(`Part ${idx+1} failed after 3 attempts: ${e.message}`);
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
    
    // Critical: Show results and scroll first so user sees it even if rendering has tiny issues
    els.terminal.style.display = 'none';
    els.results.style.display = 'block';
    updateProgress(100, "Done");
    els.results.scrollIntoView({ behavior: 'smooth' });
    
    // Defensive rendering loop
    try { renderStage1Badges(analysis); } catch(e) { console.warn("Badge error", e); }
    try { renderScore(notesJson.score); } catch(e) { console.warn("Score error", e); }
    try { renderPullquote(notesJson.notes?.summary || ""); } catch(e) { console.warn("Summary error", e); }
    try { renderDNA(notesJson.lecture_dna || Array(20).fill(5)); } catch(e) { console.warn("DNA error", e); }
    try { renderNotesGrid(notesJson.notes); } catch(e) { console.warn("Grid error", e); }
    try { renderFlashcards(notesJson.flashcards); } catch(e) { console.warn("Flash error", e); }
    try { 
        if(notesJson.concept_graph) renderConceptMap(notesJson.concept_graph);
        else if(notesJson.concept_map) {
            // Simple fallback if old format returned
            renderConceptMap({nodes:[{id:'n1', label:'Concept Map Rendered'}], links:[]});
        }
    } catch(e) { console.warn("Map error", e); }
    
  } catch (error) {
    logTerminal(`[FATAL ERROR] ${error.message}`);
    const retryBtn = document.createElement('button');
    retryBtn.className = 'terminal-retry-btn'; retryBtn.textContent = 'RETRY PIPELINE';
    retryBtn.onclick = () => location.reload();
    els.terminalContent.appendChild(retryBtn);
  }
}

async function transcribeAudio(blob) {
  const formData = new FormData();
  formData.append('file', blob, 'lecture_segment.mp3');
  formData.append('model', 'whisper-large-v3-turbo');
  if(selectedLanguage !== 'auto') formData.append('language', selectedLanguage);
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  });
  if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Status ${res.status}`);
  }
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
    3. CONCEPT GRAPH: A JSON object with "nodes" (id, label) and "links" (source, target, label).
    Return ONLY valid JSON:
    {
      "notes": {
        "summary": "Full detailed analysis (500+ words)...",
        "topics": ["Topic 1", "..."],
        "concepts": [{ "term": "...", "explanation": "Deep definition...", "confidence": 1-3 }],
        "important": ["Insight 1", "..."],
        "structure_summary": { "intro": "...", "core": "...", "examples": "...", "conclusion": "..." }
      },
      "concept_graph": {
        "nodes": [{"id": "n1", "label": "Concept A"}, ...],
        "links": [{"source": "n1", "target": "n2", "label": "defines"}]
      },
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
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                model: "llama-3.1-8b-instant", 
                messages: [
                    { role: 'system', content: `You are a professional academic assistant. Format your response with clear structure. Use **bold** for key terms. Break long answers into paragraphs. Context: ${JSON.stringify(currentNotes.notes)}` }, 
                    { role: 'user', content: msg }
                ], 
                stream: true 
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
                    } catch (e) {}
                }
            }
        }
    } catch(e) { contentEl.textContent = `Error: ${e.message}`; }
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
        for(let i=1; i<parts.length; i++) {
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

let graphAnimationId = null;
function renderConceptMap(graphData) {
    const container = document.getElementById('concept-map-container');
    const canvas = document.getElementById('concept-canvas');
    if (!container || !canvas || !graphData || !graphData.nodes) return;
    
    container.style.display = 'block';
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    // Resize function
    function resize() {
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = 400 * dpr;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `400px`;
        ctx.scale(dpr, dpr);
    }
    resize();
    window.addEventListener('resize', resize);

    const width = canvas.width / dpr;
    const height = 400;

    const nodes = graphData.nodes.map((n, i) => ({
        ...n,
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 1,
        vy: (Math.random() - 0.5) * 1,
        radius: 35 + (n.label.length * 1.5)
    }));

    const links = (graphData.links || []).map(l => ({
        source: nodes.find(n => n.id === l.source),
        target: nodes.find(n => n.id === l.target),
        label: l.label
    })).filter(l => l.source && l.target);

    if (graphAnimationId) cancelAnimationFrame(graphAnimationId);

    function animate() {
        ctx.clearRect(0, 0, width, height);
        
        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const accent2Color = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim();
        const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
        const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border-strong').trim();
        const paperColor = getComputedStyle(document.documentElement).getPropertyValue('--paper-2').trim();

        // Update positions & Physics (simple drift + collision)
        nodes.forEach(n => {
            n.x += n.vx;
            n.y += n.vy;
            
            // Boundary bounce
            if (n.x < n.radius) { n.x = n.radius; n.vx *= -0.8; }
            if (n.x > width - n.radius) { n.x = width - n.radius; n.vx *= -0.8; }
            if (n.y < n.radius) { n.y = n.radius; n.vy *= -0.8; }
            if (n.y > height - n.radius) { n.y = height - n.radius; n.vy *= -0.8; }
            
            // Subtle pulse
            n.pulse = Math.sin(Date.now() / 800) * 3;
        });

        // Draw Links
        ctx.beginPath();
        ctx.strokeStyle = borderColor;
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1;
        links.forEach(l => {
            ctx.moveTo(l.source.x, l.source.y);
            ctx.lineTo(l.target.x, l.target.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw Nodes
        nodes.forEach(n => {
            // Shadow
            ctx.shadowColor = 'rgba(0,0,0,0.05)';
            ctx.shadowBlur = 10;
            
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius + n.pulse, 0, Math.PI * 2);
            ctx.fillStyle = paperColor;
            ctx.fill();
            
            ctx.shadowBlur = 0;
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Inner circle
            ctx.beginPath();
            ctx.arc(n.x, n.y, (n.radius + n.pulse) * 0.85, 0, Math.PI * 2);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 0.5;
            ctx.stroke();

            ctx.fillStyle = textColor;
            ctx.font = `italic 600 11px "Playfair Display"`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Wrap text if too long
            const words = n.label.split(' ');
            if (words.length > 2) {
                ctx.fillText(words.slice(0, 2).join(' '), n.x, n.y - 6);
                ctx.fillText(words.slice(2).join(' '), n.x, n.y + 6);
            } else {
                ctx.fillText(n.label, n.x, n.y);
            }
        });

        graphAnimationId = requestAnimationFrame(animate);
    }
    animate();
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
