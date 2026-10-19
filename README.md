# DeLectured

Browser-only lecture transcription and study materials. Layers 1–8 are implemented, including the responsive Scholar’s Folio interface. See [frontend verification](docs/layer-8-folio.md) and [functional verification](docs/layers-6-7-release.md) for evidence and remaining limits.

See the [architecture diagram](ARCHITECTURE.md) for the end-to-end capture, transcription, analysis, storage, and release pipeline.

Audio is sent directly to your selected transcription provider; transcript passages go to your notes/Q&A provider. API keys stay in this browser's settings and are sent to the configured provider. Provider usage may cost money; there is no application subscription or backend.

## Storage and recovery

IndexedDB stores lectures and pending audio. Successfully transcribed audio is removed atomically with saving its text. If storage is full, unsaved audio stays in RAM: export it or free space and retry before reloading. RAM audio and unfinished recording buffers do not survive reload. Browser storage can be cleared or evicted; export JSON backups regularly.

Recording uses silence-aware boundaries near five minutes with bounded hard cuts and explicitly tracked overlap. Interruptions can lose unfinished audio and are reported as gaps. Uploads are limited to 20 MiB and ten minutes; formats depend on browser decoding support.

## Study workflow

The Folio reading page includes Notes, Transcript, Connections and Recall, a topic timeline, recent lectures and an “On this page” index. Light and dark themes use an ink-spread transition; reduced-motion preferences are respected. Recording has its own view with a live audio meter.

The first home page explains the workflow, API-key setup and storage/recovery. Use **Start a lecture** to open Capture, or **Set up your API key** to open provider settings. Saved-report links continue to open the report directly.

Open saved reports through Library without provider requests. Search title/transcript/summary, rename, delete, export/import JSON, download Markdown or Anki CSV, and print to PDF. Conflicting imports are rejected unless replacement is explicitly selected. CSV formula-like values receive a leading apostrophe for spreadsheet safety; disable HTML interpretation when importing into Anki.

Analysis saves detailed sections and resumable checkpoints. Literal quotes are verified; AI interpretation can still be wrong. Q&A retrieves up to four bounded passages using word overlap and may miss relevant material. No invented quality scores or exam predictions.

## Development and release

Tested tooling: Node 24.13.0, idb 8.0.4, fake-indexeddb 6.2.5, lamejs 1.2.1.

```sh
npm ci
npm test
npm run build
python -m http.server 8000 --directory dist
```

Open localhost:8000. Microphone access needs HTTPS or localhost. Deploy only `dist`, never the repository root. See DEPLOYMENT_FREE.md. The build includes local runtime dependencies and licenses; optional fonts are not required for offline use. Close all app tabs after finishing work to activate an updated offline shell.

52 Node tests pass. The initial Folio gate passed 46 Chromium checks; the subsequent home-page refinement passed 31 targeted Chromium checks, including its expanded eight-group Folio harness. Desktop/mobile-width screenshots and multipage PDF output have been visually inspected. Live authenticated inference, physical microphone behavior and actual mobile browsers remain untested. Existing v2 files are historical references and are excluded from releases.
