# DeLectured Project Mandates & Session Context

**Status:** v1.6.7 Stable
**Core Philosophy:** Professional, academic "Paper & Ink" aesthetic. High-intelligence, high-density study materials.

---

## 🎨 Aesthetic & UI Mandates (STRICT)
- **DO NOT CHANGE THE UI OR LOOKS.** The current aesthetic is finalized and approved.
- **Theme:** "Paper & Ink" (Warm paper backgrounds, stark ink text).
- **Fonts:** 
  - Headings: `Playfair Display` (Serif, italicized).
  - Body: `IBM Plex Sans`.
  - Terminal/Labels/Code: `IBM Plex Mono`.
- **Palette:** 
  - Paper: `#F5F0E8`
  - Ink: `#0A0A08`
  - Accent: `#C8402A` (Vermillion)
  - Secondary Accent: `#1B4D8E` (Deep Blue)
- **Layout:** Responsive grid with `result-card` containers. 2.5rem padding. Subtle SVG noise texture overlay.

---

## ⚙️ Technical Architecture
- **Transcription Engine:** Parallel `whisper-large-v3-turbo` via Groq.
- **Intelligence Engine:** LLaMA 3.3 70B (Versatile) for exhaustive structuring.
- **Compression:** Client-side MP3 encoding using `lamejs` @ 64kbps.
- **Concurrency:** Limited to 3 parallel segments to prevent API rate limits.
- **Visuals:** Mermaid.js for flowcharts, CSS Grid for "Lecture DNA" heatmaps.

---

## 🛠️ Solved Problems & History (Context for Future)
1.  **UI Unresponsiveness:** Solved in v1.6.4 using `audioBufferToMp3BlobAsync`. The encoding process now yields to the UI thread to prevent freezing during 1GB file processing.
2.  **Whisper 400 Errors:** Solved by removing `initial_prompt` and ensuring strictly sanitized MIME types (`audio/mpeg`).
3.  **Rendering Crashes:** Solved in v1.6.7 using a "Defensive Rendering Loop." Every UI component is wrapped in a try-catch to ensure one failed key doesn't crash the entire results page.
4.  **Content Visibility:** Fixed the summary text being hidden by switching to `.innerHTML` and preserving technical line breaks produced by the 70B model.
5.  **Information Density:** Corrected the AI prompt to demand **minimum 500-word insights** and **20+ concepts**, preventing the model from giving short, generic summaries for long lectures.

---

## 🚀 Key Features to Preserve
- **1GB Support:** Local resampling and async chunking.
- **Refreshable Flashcards:** Dedicated API call to generate new study sets on-demand.
- **Expert Single-Pass:** Everything renders at once after full completion for a professional "Big Reveal" feel.
- **Bundled Report:** Export includes Summary, Scores, Concepts, and the full Transcript.

**NOTE:** When adding new features, always bridge them into the existing `render` functions in `app.js` and use the CSS classes defined in `styles.css`.
