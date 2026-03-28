// ==========================================
// DeLectured - App Logic & Intelligence
// ==========================================

const MAX_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_TYPES = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/flac', 'video/mp4'];
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

// UI Elements
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

// ==========================================
// Init & Event Listeners
// ==========================================

function init() {
  updateApiStatus();
  
  els.themeToggle.addEventListener('click', () => {
    const isDark = document.body.parentElement.getAttribute('data-theme') === 'dark';
    document.body.parentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  });

  els.apiToggle.addEventListener('click', (e) => {
    e.preventDefault();
    els.apiPanel.classList.toggle('active');
    if(els.apiPanel.classList.contains('active') && !apiKey) {
      els.apiInput.focus();
    }
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

  // Drag and drop
  els.uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.uploadZone.classList.add('dragover');
  });
  els.uploadZone.addEventListener('dragleave', () => {
    els.uploadZone.classList.remove('dragover');
  });
  els.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
  els.uploadZone.addEventListener('click', () => {
    els.fileInput.click();
  });
  els.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handleFile(e.target.files[0]);
    }
  });

  // Chat
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && chatInput.value.trim()) {
        handleChat(chatInput.value.trim());
        chatInput.value = '';
      }
    });
  }

  // Transcript toggle
  const tHeader = document.getElementById('transcript-header');
  if (tHeader) {
    tHeader.addEventListener('click', () => {
      const content = document.getElementById('transcript-content');
      content.classList.toggle('open');
      tHeader.querySelector('span:last-child').textContent = content.classList.contains('open') ? 'hide ↑' : 'show ↓';
    });
  }

  // Print
  const printBtn = document.getElementById('btn-print');
  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }

  // Download
  const dlBtn = document.getElementById('btn-download');
  if (dlBtn) {
    dlBtn.addEventListener('click', downloadNotes);
  }
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

// ==========================================
// Core Pipeline
// ==========================================

async function handleFile(file) {
  if (!apiKey) {
    els.apiPanel.classList.add('active');
    els.apiInput.focus();
    alert("Please set your Groq API key first.");
    return;
  }

  if (file.size > MAX_SIZE) {
    alert("File too large. Maximum size is 25MB.");
    return;
  }

  if (!ALLOWED_TYPES.includes(file.type) && !file.name.endsWith('.m4a')) {
    alert("Unsupported file type. Please upload an audio file.");
    return;
  }

  // Start processing UI
  els.uploadZone.style.display = 'none';
  els.terminal.style.display = 'block';
  els.terminalContent.innerHTML = '';
  document.getElementById('results').style.display = 'none';
  
  logTerminal("Initializing audio pipeline");
  logTerminal(`File: ${file.name} · Size: ${(file.size/1024/1024).toFixed(1)} MB`);
  
  try {
    // 1. Transcribe
    logTerminal("[WHISPER] Uploading to whisper-large-v3...");
    const rawTranscript = await transcribeAudio(file);
    
    // 2. Client clean & check
    logTerminal("[PROCESS] Cleaning and analyzing raw transcript...");
    const transcript = cleanTranscript(rawTranscript);
    currentTranscript = transcript;
    
    if (transcript.split(' ').length < 50) {
      throw new Error("Transcript too short. Recording may be unclear or silent.");
    }
    
    document.getElementById('raw-text').textContent = transcript;
    
    // Check for exam signals pre-AI
    const signals = findExamSignals(transcript);
    
    // 3. Stage 1 - Fast Analysis
    logTerminal("[STAGE 1] Analyzing lecture structure and domain...");
    const analysis = await analyzeTranscriptStage1(transcript);
    logTerminal(`[STAGE 1] Domain: ${analysis.domain} · Subject: ${analysis.subject}`);
    logTerminal(`[STAGE 1] Structure: Intro ${analysis.structure.intro_pct}% · Core ${analysis.structure.core_pct}%`);
    
    renderStage1Badges(analysis);
    
    // 4. Stage 2 - Domain-aware structuring (Streaming)
    logTerminal("[STAGE 2] Generating domain-aware structured notes...");
    
    // Simulate streaming UI (since we might fetch it whole or stream depending on exact impl)
    // We will do a regular fetch but parse it as JSON
    const notesJson = await generateNotesStage2(transcript, analysis, signals);
    currentNotes = notesJson;
    
    logTerminal("[STAGE 2] Rendering results...");
    
    // Render
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

    // Apply fade up animation to rendered elements
    document.querySelectorAll('.results > *').forEach((el, i) => {
        el.style.opacity = '0';
        el.style.animation = `fadeUp 0.5s ${i * 0.1}s forwards`;
    });
    
  } catch (error) {
    logTerminal(`[ERROR] ${error.message}`);
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn';
    retryBtn.style.marginTop = '1rem';
    retryBtn.textContent = 'RETRY';
    retryBtn.onclick = () => {
      els.terminal.style.display = 'none';
      els.uploadZone.style.display = 'flex';
    };
    els.terminalContent.appendChild(retryBtn);
  }
}

// ==========================================
// API Calls
// ==========================================

async function transcribeAudio(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'json');
  if(selectedLanguage !== 'auto') {
      formData.append('language', selectedLanguage);
  }

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
    // Truncate for fast analysis if too long
    const analysisText = transcript.length > 6000 ? transcript.substring(0, 6000) : transcript;
    
    const prompt = `Analyze this lecture transcript. Return ONLY valid JSON, no markdown formatting, no explanations:
{
  "domain": "Computer Science",
  "subject": "Internet of Things",
  "structure": {
    "intro_pct": 15,
    "core_pct": 55,
    "examples_pct": 20,
    "conclusion_pct": 10
  },
  "emphasis_markers": [
    "repeated phrase: 'edge computing' (7 times)",
    "explicit: 'this is very important'"
  ],
  "key_moments": [
    "Definition of IoT ecosystem",
    "MQTT vs HTTP comparison"
  ],
  "transcript_quality": {
    "clarity": "medium",
    "technical_density": "high"
  },
  "language": {
    "detected": "English",
    "hindi_pct": 0,
    "english_pct": 100
  }
}

Transcript:
${analysisText}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
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
    const prompt = `You are an expert note-taker specializing in ${analysis.domain} lectures.

LECTURE CONTEXT:
- Subject: ${analysis.subject}
- Structure: ${analysis.structure.intro_pct}% intro, ${analysis.structure.core_pct}% core, ${analysis.structure.examples_pct}% examples
- Professor emphasized: ${analysis.emphasis_markers.join(', ')}
- Language: ${analysis.language.detected}

Using this context, structure the transcript into intelligent notes. Return ONLY valid JSON.
{
  "notes": {
    "summary": "3-4 sentence summary written as insight, not compression. Explain WHY things matter.",
    "structure_summary": {
      "intro": "how the lecture opened",
      "core": "main content",
      "examples": "examples used",
      "conclusion": "how it closed"
    },
    "topics": ["topic 1", "topic 2"],
    "concepts": [
      {
        "term": "Concept Name",
        "explanation": "clear explanation",
        "confidence": 3,
        "professor_emphasis": "high"
      }
    ],
    "important": ["point 1"],
    "questions": ["question raised 1"]
  },
  "score": {
    "clarity": 75,
    "clarity_label": "Good",
    "density": 68,
    "density_label": "High",
    "pace": 82,
    "pace_label": "Moderate",
    "concept_count": 5,
    "revision_mins": 25
  },
  "flashcards": [
    {"q": "Question testing understanding?", "a": "Answer"}
  ],
  "exam_signals": [
    {"quote": "exact words", "topic": "related topic"}
  ],
  "lecture_dna": [3,7,5,9,4,8,6,7,3,5,8,9,6,4,7,5,8,6,4,3]
}

Rules:
- confidence: 3=deeply explained, 2=briefly, 1=mentioned
- lecture_dna: exactly 20 integers (1-10) showing concept density across timeline
- Fix transcription errors silently

Transcript:
${transcript}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
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
    
    // Add user msg
    const userEl = document.createElement('div');
    userEl.className = 'chat-msg chat-user';
    userEl.textContent = msg;
    chatHistoryEl.appendChild(userEl);
    
    // Add loading AI msg
    const aiEl = document.createElement('div');
    aiEl.className = 'chat-msg chat-ai';
    aiEl.textContent = '...';
    chatHistoryEl.appendChild(aiEl);
    
    // System prompt
    const systemPrompt = `You are a study assistant for this specific lecture. 
    You have access to the transcript and structured notes.
    Answer ONLY from the lecture content. If it wasn't covered, explicitly say so and point to what WAS covered that's related.
    Be concise.
    
    Notes Context:
    ${JSON.stringify(currentNotes.notes)}
    `;
    
    const messages = [
        { role: 'system', content: systemPrompt },
        ...currentChatHistory,
        { role: 'user', content: msg }
    ];
    
    try {
        console.log("[CHAT] Sending request to Groq...");
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: messages,
                temperature: 0.3,
                stream: true
            })
        });
        
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            console.error("[CHAT] API Error:", errorData);
            throw new Error(errorData.error?.message || `API Error: ${res.status}`);
        }
        
        console.log("[CHAT] Response received, starting stream...");
        
        // Handle streaming response
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullResponse = "";
        aiEl.textContent = "";
        
        let partialChunk = "";
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = partialChunk + decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            
            // Keep the last partial line
            partialChunk = lines.pop();
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === "data: [DONE]") continue;
                
                if (trimmed.startsWith("data: ")) {
                    try {
                        const data = JSON.parse(trimmed.substring(6));
                        const token = data.choices[0]?.delta?.content;
                        if (token) {
                            fullResponse += token;
                            aiEl.textContent += token;
                        }
                    } catch (e) {
                        console.warn("[CHAT] Failed to parse stream line:", trimmed);
                    }
                }
            }
        }
        
        currentChatHistory.push({ role: 'user', content: msg });
        currentChatHistory.push({ role: 'assistant', content: fullResponse });
        if(currentChatHistory.length > 10) currentChatHistory = currentChatHistory.slice(-10);
        
    } catch(e) {
        console.error("[CHAT] Error:", e);
        aiEl.textContent = `Error: ${e.message}. Please check your API key and connection.`;
    }
}

// ==========================================
// Utility & Render Functions
// ==========================================

function logTerminal(msg) {
  const line = document.createElement('div');
  line.className = 'terminal-line';
  line.textContent = `> ${msg}`;
  els.terminalContent.appendChild(line);
  els.terminal.scrollTop = els.terminal.scrollHeight;
}

function cleanTranscript(text) {
  let cleaned = text.replace(/\b(um|uh|you know|basically|alright so|okay so)\b/gi, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
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
    container.innerHTML = `
        <span class="badge badge-domain">◆ ${analysis.domain.toUpperCase()} / ${analysis.subject.toUpperCase()}</span>
    `;
    if (analysis.language.hindi_pct > 10) {
        container.innerHTML += `
            <span class="badge badge-hinglish">◆ HINGLISH DETECTED — ${analysis.language.hindi_pct}% HINDI</span>
        `;
    }
    document.getElementById('score-annotation').textContent = `// stage-1 analysis · ${currentTranscript.split(' ').length} words · domain: ${analysis.domain.toLowerCase()}`;
}

function renderScore(score) {
    document.getElementById('score-clarity').textContent = score.clarity;
    document.getElementById('lbl-clarity').textContent = score.clarity_label;
    
    document.getElementById('score-density').textContent = score.density;
    document.getElementById('lbl-density').textContent = score.density_label;
    
    document.getElementById('score-pace').textContent = score.pace;
    document.getElementById('lbl-pace').textContent = score.pace_label;
    
    document.getElementById('score-concepts').textContent = score.concept_count;
    document.getElementById('lbl-concepts').textContent = "FOUND";
    
    document.getElementById('score-revision').textContent = score.revision_mins;
    document.getElementById('lbl-revision').textContent = "MINUTES";

    // Animate bars using IntersectionObserver
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if(entry.isIntersecting) {
                const bars = document.querySelectorAll('.score-bar');
                bars[0].style.width = score.clarity + '%';
                bars[1].style.width = score.density + '%';
                bars[2].style.width = score.pace + '%';
                bars[3].style.width = Math.min(100, score.concept_count * 10) + '%';
                bars[4].style.width = Math.min(100, (score.revision_mins/60)*100) + '%';
                observer.disconnect();
            }
        });
    });
    observer.observe(document.querySelector('.score-strip'));
}

function renderPullquote(text) {
    document.getElementById('summary-quote').textContent = text;
}

function renderDNA(dnaArray) {
    const container = document.getElementById('dna-bars');
    container.innerHTML = '';
    dnaArray.forEach((val, i) => {
        const bar = document.createElement('div');
        bar.className = 'dna-bar';
        bar.style.opacity = (val / 10).toString();
        // Base height + relative height
        const height = 8 + (val / 10) * 42; 
        container.appendChild(bar);
        
        setTimeout(() => {
            bar.style.height = height + 'px';
        }, 500 + (i * 25));
    });
}

function renderExamSignals(signals) {
    const container = document.getElementById('exam-signals-container');
    if(!signals || signals.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';
    
    const list = document.getElementById('exam-signals-list');
    list.innerHTML = '';
    
    document.getElementById('exam-signal-count').textContent = `[${signals.length} signal${signals.length > 1 ? 's' : ''}]`;
    
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
    
    topicsCol.innerHTML = '';
    conceptsCol.innerHTML = '';
    
    // Topics & Important
    let html = '';
    notes.topics.forEach(t => {
        html += `<div class="notes-item"><strong>→ ${t}</strong></div>`;
    });
    
    html += `<div class="notes-col-header" style="margin-top:2rem">Key Takeaways</div>`;
    notes.important.forEach(i => {
        html += `<div class="notes-item">${i}</div>`;
    });
    
    html += `<div class="notes-col-header" style="margin-top:2rem">Structure</div>`;
    html += `<div class="notes-item mono-data"><strong>INTRO:</strong> ${notes.structure_summary.intro}</div>`;
    html += `<div class="notes-item mono-data"><strong>CORE:</strong> ${notes.structure_summary.core}</div>`;
    
    topicsCol.innerHTML = html;
    
    // Concepts
    let cHtml = '';
    notes.concepts.forEach(c => {
        const dots = Array(3).fill(0).map((_, i) => 
            `<span class="dot ${i < c.confidence ? 'filled' : ''}"></span>`
        ).join('');
        
        cHtml += `
            <div class="notes-item">
                <div class="concept-header">
                    <span class="concept-term">${c.term}</span>
                    <span class="confidence-dots">${dots}</span>
                </div>
                <div style="font-size:13px; color:var(--text-secondary)">${c.explanation}</div>
            </div>
        `;
    });
    conceptsCol.innerHTML = cHtml;
}

function renderFlashcards(cards) {
    const container = document.getElementById('flashcards-grid');
    container.innerHTML = '';
    
    if (!cards || !Array.isArray(cards) || cards.length === 0) {
        container.innerHTML = '<div style="font-family: var(--font-mono); color: var(--text-tertiary);">No flashcards generated for this lecture.</div>';
        return;
    }
    
    cards.forEach((card, i) => {
        const div = document.createElement('div');
        div.className = 'flashcard';
        // Alternate slight rotation using CSS variable
        const rot = i % 2 === 0 ? '0.4deg' : '-0.4deg';
        div.style.setProperty('--tilt', rot);
        
        div.innerHTML = `
            <div class="flashcard-inner">
                <div class="flashcard-front">
                    <div class="fc-q-prefix">Q:</div>
                    <div class="fc-text">${card.q}</div>
                    <div class="fc-flip-hint">click to flip →</div>
                </div>
                <div class="flashcard-back">
                    <div class="fc-a-prefix">A:</div>
                    <div class="fc-text">${card.a}</div>
                </div>
            </div>
        `;
        
        div.addEventListener('click', () => {
            div.classList.toggle('flipped');
        });
        
        container.appendChild(div);
    });
}

function downloadNotes() {
    if(!currentNotes) return;
    
    let text = `DELECTURED NOTES\n=================\n\n`;
    text += `SUMMARY\n${currentNotes.notes.summary}\n\n`;
    
    text += `CONCEPTS\n`;
    currentNotes.notes.concepts.forEach(c => {
        text += `- ${c.term} (${c.confidence}/3): ${c.explanation}\n`;
    });
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'delectured-notes.txt';
    a.click();
    URL.revokeObjectURL(url);
}

// Start
document.addEventListener('DOMContentLoaded', init);
