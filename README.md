# DeLectured

**Every Lecture. Every Word. Structured.**

DeLectured is a high-intelligence lecture structuring engine designed to turn raw academic audio into perfectly organized, domain-aware study materials. Unlike generic transcription tools, DeLectured understands the nuances of a classroom environment, including professor emphasis, subject-specific terminology, and the structural flow of a lecture.

## 🚀 The Two-Stage Intelligence Pipeline

DeLectured operates on a sophisticated processing chain:

1.  **Advanced Audio Pre-processing:** Decodes any browser-supported format (MP3, AAC, M4A, WAV, WebM, AMR) and optimizes it to 16kHz Mono.
2.  **Smart Chunking:** Automatically splits lectures longer than 10 minutes into optimized segments to bypass API limits, enabling support for 1-2 hour lectures (up to 1GB).
3.  **Whisper Transcription:** Uses `whisper-large-v3` via Groq for high-accuracy transcription of each segment.
4.  **Stage 1: Fast Analysis:** A high-speed LLaMA 3.1 pass maps the lecture's domain, detects structural breakdown, and identifies explicit emphasis markers.
5.  **Stage 2: Domain-Aware Structuring:** A second LLaMA 3.1 pass acts as a "Subject Matter Expert" to generate:
    *   **Concept Maps:** Visual Mermaid.js diagrams connecting key topics.
    *   **Insightful Summaries:** Explaining *why* topics matter.
    *   **Lecture DNA:** A visual timeline of concept density.
    *   **Exam Signals:** Automatic detection of test-relevant phrases.
    *   **Active Recall Flashcards:** Interactive Q&A pairs.

## ✨ Key Features

*   **Large Lecture Support:** Handles files up to 1GB and 2+ hours long via client-side optimization.
*   **Wider Format Support:** Support for WhatsApp voice notes (Opus/AMR), M4A, AAC, and more.
*   **Visual Intelligence:** Automatically generates concept maps to visualize the relationship between topics.
*   **Multilingual Support:** Optimized for English and Hindi/Hinglish lectures.
*   **Interactive Annotations:** A built-in chat interface to ask specific questions about the lecture content.
*   **Intelligence Scores:** Metrics for Lecture Clarity, Content Density, and Professor's Pace.
*   **Dark Mode & Responsive Design:** A beautiful, modern interface that works on desktop and mobile.
*   **Privacy First:** API calls are made directly from your browser. No audio data is ever stored on a server.
*   **Export Options:** Download notes as `.txt` or print a perfectly formatted PDF.

## 🛠️ Tech Stack

*   **Frontend:** Vanilla JS, CSS3 (with custom grain textures and variables), HTML5.
*   **Intelligence:** Groq Cloud API (Whisper-large-v3, LLaMA-3.1-8b).
*   **Alternative Implementation:** `backend.py` provides a Gradio-based Python reference implementation.

## 🚦 Getting Started

1.  **API Key:** Obtain a free API key from the [Groq Console](https://console.groq.com/).
2.  **Launch:**
    *   **Web App:** Open `index.html` using a local server (like VS Code's Live Server) to avoid CORS issues.
    *   **Python Version:** Run `pip install gradio groq` then `python backend.py`.
3.  **Configure:** Click the "API Key" button in the app and paste your key.
4.  **Process:** Drop an audio file (up to 25MB) and watch the pipeline in action.

## 📄 License

Built for high-performance academic assistance. No audio data is stored. Ever.
