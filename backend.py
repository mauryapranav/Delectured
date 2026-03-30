"""
DeLectured - Python / Colab Reference Implementation
Built for IIMA Ventures Evaluation
Author: Pranav Kumar Maurya

Setup Instructions for Google Colab / Local:
1. pip install -q groq gradio openai-whisper
2. Set GROQ_API_KEY in Colab secrets (or environment variables)
3. Run this script.
"""

import os
import re
import json
import gradio as gr
from groq import Groq

# Attempt to load whisper if available locally or in Colab
try:
    import whisper
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False
    print("Warning: openai-whisper not found. Falling back to Groq Cloud Whisper API if possible, or install via `pip install openai-whisper`")

# Initialize Groq client
# Reads from os.environ["GROQ_API_KEY"] or Colab userdata
try:
    from google.colab import userdata
    GROQ_API_KEY = userdata.get('GROQ_API_KEY')
    os.environ['GROQ_API_KEY'] = GROQ_API_KEY
except ImportError:
    # Not in colab, expect env var
    pass

client = Groq()

EXAM_PATTERNS = [
    r"this (will|is going to) be (in|on) (the|your) (exam|test|quiz|finals)",
    r"remember this",
    r"this is important",
    r"you (should|must|need to) know this",
    r"don't forget",
    r"pay attention",
    r"note (this|that) down",
    r"यह exam में आएगा",
    r"यह important है",
    r"याद रखो"
]

def load_whisper_model():
    """Load the local Whisper model (large-v3) if available."""
    if WHISPER_AVAILABLE:
        print("Loading Whisper model (large-v3)...")
        # For colab, 'base' or 'small' might be faster, but spec says large-v3
        return whisper.load_model("large-v3")
    return None

model = load_whisper_model()

def clean_transcript(text):
    """Client-side cleaning of filler words."""
    fillers = r'\b(um|uh|you know|basically|alright so|okay so)\b'
    cleaned = re.sub(fillers, '', text, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned

def find_exam_signals(text):
    """Extract exam signals using Regex before passing to AI."""
    found = []
    for pattern in EXAM_PATTERNS:
        matches = re.finditer(pattern, text, flags=re.IGNORECASE)
        for match in matches:
            start = max(0, match.start() - 50)
            end = min(len(text), match.end() + 50)
            found.append(text[start:end].strip())
    return found

def analyze_stage_1(transcript):
    """
    Stage 1: Fast Analysis (~300 tokens)
    Detects domain, structure, emphasis markers, and language mix.
    """
    prompt = f"""Analyze this lecture transcript. Return ONLY valid JSON, no markdown formatting:
{{
  "domain": "Computer Science",
  "subject": "Internet of Things",
  "structure": {{
    "intro_pct": 15,
    "core_pct": 55,
    "examples_pct": 20,
    "conclusion_pct": 10
  }},
  "emphasis_markers": [
    "repeated phrase: 'edge computing' (7 times)",
    "explicit: 'this is very important'"
  ],
  "key_moments": [
    "Definition of IoT ecosystem",
    "MQTT vs HTTP comparison"
  ],
  "transcript_quality": {{
    "clarity": "medium",
    "technical_density": "high",
    "estimated_wer": 8
  }},
  "language": {{
    "detected": "Hinglish",
    "hindi_pct": 30,
    "english_pct": 70
  }}
}}

Transcript:
{transcript[:6000]} # Limit to prevent timeouts on long lectures
"""
    
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        response_format={"type": "json_object"}
    )
    return json.loads(response.choices[0].message.content)

def generate_stage_2(transcript, analysis, signals):
    """
    Stage 2: Domain-Aware Structuring (~1500 tokens)
    Creates the final detailed structured output.
    """
    prompt = f"""You are an expert note-taker specializing in {analysis.get('domain', 'general')} lectures.

LECTURE CONTEXT:
- Subject: {analysis.get('subject', 'unknown')}
- Structure: {analysis['structure']['intro_pct']}% intro, {analysis['structure']['core_pct']}% core, {analysis['structure']['examples_pct']}% examples
- Professor emphasized: {', '.join(analysis.get('emphasis_markers', []))}
- Language: {analysis['language']['detected']}

Using this context, structure the transcript into intelligent notes. Return ONLY valid JSON.
{{
  "notes": {{
    "summary": "3-4 sentence insight...",
    "structure_summary": {{"intro": "...", "core": "...", "examples": "...", "conclusion": "..."}},
    "topics": ["topic 1", "topic 2"],
    "concepts": [
      {{"term": "Term", "explanation": "explanation", "confidence": 3, "professor_emphasis": "high"}}
    ],
    "important": ["point 1"],
    "questions": ["question 1"]
  }},
  "score": {{
    "clarity": 75, "clarity_label": "Good",
    "density": 68, "density_label": "High",
    "pace": 82, "pace_label": "Moderate",
    "concept_count": 8, "revision_mins": 25
  }},
  "flashcards": [
    {{"q": "Question?", "a": "Answer"}}
  ],
  "exam_signals": [
    {{"quote": "exact words", "topic": "topic"}}
  ],
  "lecture_dna": [3,7,5,9,4,8,6,7,3,5,8,9,6,4,7,5,8,6,4,3]
}}

Transcript:
{transcript}
"""

    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        response_format={"type": "json_object"}
    )
    return json.loads(response.choices[0].message.content)

def process_audio(audio_path, language_mode):
    """Full Pipeline orchestrator"""
    if not audio_path:
        return "Please upload an audio file.", None, None
    
    # 1. Transcribe
    if WHISPER_AVAILABLE and model is not None:
        print("Transcribing locally...")
        result = model.transcribe(audio_path)
        raw_text = result["text"]
    else:
        print("Transcribing via Groq API...")
        with open(audio_path, "rb") as file:
            transcription = client.audio.transcriptions.create(
              file=(audio_path, file.read()),
              model="whisper-large-v3",
              response_format="json",
            )
            raw_text = transcription.text

    # 2. Clean
    transcript = clean_transcript(raw_text)
    if len(transcript.split()) < 50:
        return "Transcript too short. Audio may be empty.", transcript, None

    # Exam signals pre-processing
    signals = find_exam_signals(transcript)

    # 3. Stage 1
    print("Running Stage 1 Analysis...")
    analysis = analyze_stage_1(transcript)

    # 4. Stage 2
    print("Running Stage 2 Structuring...")
    notes_json = generate_stage_2(transcript, analysis, signals)

    # Formatting output for Gradio UI
    output_md = f"# DeLectured Notes\n\n"
    output_md += f"**Domain:** {analysis.get('domain')} | **Subject:** {analysis.get('subject')} | **Language:** {analysis['language']['detected']}\n\n"
    
    output_md += f"## Summary\n> {notes_json['notes']['summary']}\n\n"
    
    if notes_json.get('exam_signals') or signals:
        output_md += f"## ⚠️ Exam Signals\n"
        sig_list = notes_json.get('exam_signals', [{"quote": s, "topic": "General"} for s in signals])
        for s in sig_list:
            output_md += f"- \"{s['quote']}\" ({s.get('topic', '')})\n"
        output_md += "\n"

    output_md += "## Concepts\n"
    for c in notes_json['notes']['concepts']:
        dots = "●" * c['confidence'] + "○" * (3 - c['confidence'])
        output_md += f"- **{c['term']}** [{dots}]: {c['explanation']}\n"
        
    output_md += "\n## Flashcards\n"
    for f in notes_json['flashcards']:
        output_md += f"- **Q:** {f['q']}\n  **A:** {f['a']}\n"

    return output_md, transcript, notes_json

def chat_with_notes(user_msg, chat_history, transcript_state, notes_state):
    """Grounded Q&A over the lecture notes."""
    if not notes_state or not transcript_state:
        chat_history.append((user_msg, "Please process a lecture first."))
        return "", chat_history
        
    system_prompt = f"""You are a study assistant for this specific lecture. 
    Answer ONLY from the lecture content provided. If it wasn't covered, explicitly say so.
    
    Notes Context:
    {json.dumps(notes_state['notes'])}
    """
    
    # Convert Gradio history to Groq format
    messages = [{"role": "system", "content": system_prompt}]
    for h in chat_history:
        messages.append({"role": "user", "content": h[0]})
        messages.append({"role": "assistant", "content": h[1]})
    
    messages.append({"role": "user", "content": user_msg})
    
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=messages,
        temperature=0.3
    )
    
    reply = response.choices[0].message.content
    chat_history.append((user_msg, reply))
    
    return "", chat_history

# ==========================================
# Gradio Interface
# ==========================================

with gr.Blocks(title="DeLectured", theme=gr.themes.Default(primary_hue="red", neutral_hue="stone")) as app:
    gr.Markdown("# DeLectured\n*Every Lecture.*<br>*Every Word.*<br>*Structured.*")
    
    transcript_state = gr.State()
    notes_state = gr.State()

    with gr.Row():
        with gr.Column(scale=1):
            audio_in = gr.Audio(type="filepath", label="Upload Lecture Audio")
            lang_in = gr.Dropdown(choices=["Auto", "English", "Hindi/Hinglish"], value="Auto", label="Language")
            process_btn = gr.Button("Process Lecture", variant="primary")
            
            gr.Markdown("---")
            gr.Markdown("### Q&A (Annotations)")
            chatbot = gr.Chatbot(label="Ask about the lecture")
            chat_msg = gr.Textbox(label="Message", placeholder="What did the professor say about...")
            chat_btn = gr.Button("Send")
            
        with gr.Column(scale=2):
            notes_out = gr.Markdown(label="Structured Notes")
            with gr.Accordion("Raw Transcript", open=False):
                transcript_out = gr.Textbox(label="Cleaned Transcript", lines=10)

    process_btn.click(
        process_audio, 
        inputs=[audio_in, lang_in], 
        outputs=[notes_out, transcript_out, notes_state]
    ).then(
        lambda t: t, inputs=[transcript_out], outputs=[transcript_state] # Update state
    )
    
    chat_btn.click(
        chat_with_notes,
        inputs=[chat_msg, chatbot, transcript_state, notes_state],
        outputs=[chat_msg, chatbot]
    )
    chat_msg.submit(
        chat_with_notes,
        inputs=[chat_msg, chatbot, transcript_state, notes_state],
        outputs=[chat_msg, chatbot]
    )

if __name__ == "__main__":
    app.launch()
