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
- **Concurrency:** Limited to 2 parallel segments to prevent API rate limits.
- **Concept Map:** Constellation-style canvas visualization (twinkling stars on dark sky, nebula glow, constellation lines).
- **DNA Heatmap:** Color-coded bars (vermillion/blue/grey) with segment labels (Intro/Early/Mid/Late/End).
- **Notes Layout:** Vertical stack (Topics above Concepts), not side-by-side.

---

## 🛠️ Solved Problems & History (Context for Future)
1.  **UI Unresponsiveness:** Solved in v1.6.4 using `audioBufferToMp3BlobAsync`. The encoding process now yields to the UI thread to prevent freezing during 1GB file processing.
2.  **Whisper 400 Errors:** Solved by removing `initial_prompt` and ensuring strictly sanitized MIME types (`audio/mpeg`).
3.  **Rendering Crashes:** Solved in v1.6.7 using a "Defensive Rendering Loop." Every UI component is wrapped in a try-catch to ensure one failed key doesn't crash the entire results page.
4.  **Content Visibility:** Fixed the summary text being hidden by switching to `.innerHTML` and preserving technical line breaks produced by the 70B model.
5.  **Information Density:** Corrected the AI prompt to demand **minimum 500-word insights** and **20+ concepts**, preventing the model from giving short, generic summaries for long lectures.
6.  **Guide Page Accuracy:** Updated `guide.html` from v1.0 to v1.6.7 with correct file sizes (1GB), formats (9 types), model names, 5-step pipeline, and 6 feature deep-dives.
7.  **Concept Map Redesign:** Replaced circle-based bouncing nodes with a constellation-style canvas: 4-point twinkling stars, background star field (80 stars), nebula gradients, labeled constellation lines.
8.  **DNA Heatmap Overflow:** Fixed with wrapper elements, `max-width: 20px` bars, color coding by density level, and segment labels below the axis.

---

## 🚀 Key Features to Preserve
- **1GB Support:** Local resampling and async chunking.
- **Refreshable Flashcards:** Dedicated API call to generate new study sets on-demand.
- **Expert Single-Pass:** Everything renders at once after full completion for a professional "Big Reveal" feel.
- **Bundled Report:** Export includes Summary, Scores, Concepts, and the full Transcript.
- **Constellation Map:** Interactive animated star-field concept visualization.
- **Stacked Notes:** Topics & Key Takeaways above Technical Concepts (vertical, not side-by-side).
- **Guide Page Animations:** Floating ink blot particles, pulsing pipeline connectors, hover-lift effects (CSS-only, `guide-` prefixed classes).

**NOTE:** When adding new features, always bridge them into the existing `render` functions in `app.js` and use the CSS classes defined in `styles.css`.
