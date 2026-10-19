# DeLectured application architecture

DeLectured is a static, browser-only lecture capture and study application. The
browser coordinates capture, local persistence, provider requests, analysis, and
rendering. There is no DeLectured application server or hosted database.

## Runtime architecture and data flow

```mermaid
flowchart TD
    User["Learner"]

    subgraph Browser["User's browser — DeLectured static app"]
        subgraph UI["Scholar's Folio UI and app coordinator"]
            Routes["Home / Capture / Library / Guide / saved report routes"]
            App["js/app.js<br/>wires Session, Queue, analysis, report, and UI"]
            Settings["Keys and language settings"]
            Report["Folio report<br/>Notes · Transcript · Connections · Recall"]
            Library["Library<br/>search · rename · delete · backup"]
            Export["Markdown · Anki CSV · print-to-PDF"]
        end

        subgraph Capture["Ingestion and session lifecycle"]
            Mic["Microphone permission<br/>getUserMedia"]
            Worklet["AudioWorklet<br/>16 kHz mono PCM"]
            Boundaries["PCMChunker<br/>~5 min target; silence-aware cut<br/>bounded hard cut with 2 s overlap"]
            Encode["Serial encoding<br/>Web Worker + lamejs MP3<br/>WAV fallback on encoder failure"]
            Upload["Audio file upload<br/>MP3 / M4A / WAV / MP4"]
            UploadCheck["Validate ≤20 MiB and ≤10 min<br/>browser duration probe and decode"]
            SplitUpload["Downmix and encode<br/>complete 5 min chunks at 16 kHz"]
            Session["Session controller<br/>draft · start/stop · upload · recover · discard<br/>cancellation and interruption state"]
        end

        subgraph Queueing["Persistent transcription queue"]
            Queue["Queue<br/>persist before processing; progress and recovery controls"]
            RAM["Temporary RAM holding area<br/>audio retained if IndexedDB write fails"]
            IDBChunks["IndexedDB chunks<br/>pending / processing / failed / transcribed"]
            Lock["Web Lock per lecture<br/>serializes work across tabs"]
            Online["Online and retry gate<br/>wait offline; bounded network/rate-limit retries<br/>provider Retry-After honored"]
        end

        subgraph LocalData["Browser-local state"]
            IDBLec["IndexedDB: DeLecturedDB<br/>lectures, transcript, analysis, checkpoints"]
            IDBChunkStore["IndexedDB chunks store<br/>temporary audio and transcription state"]
            LocalKeys["localStorage<br/>provider keys, models, endpoints, language"]
            SW["Service worker<br/>same-origin app-shell/offline assets only"]
        end

        subgraph Analysis["Transcript and study-material pipeline"]
            Assemble["assembleTranscript<br/>order chunks; validate timestamps;<br/>dedupe only evidenced overlap; retain gaps/warnings"]
            SaveTranscript["Persist assembled transcript and segments<br/>before analysis"]
            Window["Split into bounded UTF-8 source windows<br/>≤5,000 bytes each"]
            Map["Map: extract each window<br/>notes, topics, concepts, flashcards,<br/>exam cues, links, literal evidence"]
            Validate["Validate JSON/schema, byte limits,<br/>literal quote evidence and graph links<br/>one repair attempt for invalid output"]
            MapCheckpoint["Save validated partial sections<br/>and fingerprinted checkpoint"]
            Reduce["Reduce: pairwise merge summaries<br/>until one overview remains"]
            Finalize["Build full analysis<br/>timestamps only when unambiguous;<br/>concept graph, warnings, five-minute coverage"]
            Ready["Persist ready lecture and analysis"]
        end

        subgraph QnA["Transcript-grounded Q&A"]
            Retrieve["Split transcript into passages<br/>lexical word-overlap ranking"]
            TopPassages["Select up to 4 passages<br/>≤1,800 bytes each"]
            ValidateAnswer["Validate JSON and literal quoted references"]
        end
    end

    subgraph Providers["External provider APIs — called directly from browser"]
        Resolve["Provider selection and capability check<br/>separate transcription and notes models"]
        TranscribeAPI["Transcription endpoint"]
        CompleteAPI["Notes / Q&A completion endpoint"]
        Catalog["Adapters: Groq · OpenAI · Gemini · Mistral<br/>OpenRouter and Anthropic for completion<br/>custom OpenAI-compatible endpoint when supported"]
    end

    User --> Routes
    Routes --> App
    Settings --> LocalKeys
    App --> Mic
    App --> Upload
    Mic --> Worklet --> Boundaries --> Encode --> Session
    Upload --> UploadCheck --> SplitUpload --> Session
    Session --> Queue
    Queue --> RAM
    RAM -->|"write chunk; clear RAM only after commit"| IDBChunkStore
    IDBChunkStore --> Queue
    Queue --> Lock --> Online
    Online -->|"configured key + chunk audio"| Resolve
    Resolve --> Catalog --> TranscribeAPI
    TranscribeAPI -->|"transcript text + optional segments"| Queue
    Queue -->|"atomic completion: save text/segments,<br/>update lecture transcript, remove audio blob"| IDBChunkStore
    Queue -->|"transcript persisted per completed chunk"| IDBLec
    Queue -->|"all chunks complete"| App
    App -->|"load saved lecture and chunks"| IDBLec
    App -->|"load all lecture chunks"| IDBChunkStore
    IDBLec --> Assemble
    IDBChunkStore --> Assemble
    Assemble --> SaveTranscript --> IDBLec
    SaveTranscript --> Window --> Map --> Validate --> MapCheckpoint --> IDBLec
    MapCheckpoint --> Reduce
    Map -->|"per-window extraction prompts"| Resolve
    Reduce -->|"pairwise merge prompts"| Resolve
    CompleteAPI -->|"JSON response"| Validate
    Resolve --> Catalog --> CompleteAPI
    Reduce --> Finalize --> Ready --> IDBLec
    Ready --> Report
    IDBLec -->|"open saved report; no provider request"| Report
    Report --> Export
    Library <--> IDBLec
    Library --> Export
    Report -->|"ask about saved lecture"| Retrieve --> TopPassages --> Resolve
    CompleteAPI -->|"answer and references"| ValidateAnswer --> Report
    LocalKeys -. "key loaded only for selected destination" .-> Resolve
    SW -. "caches static shell; does not cache provider requests" .-> Routes

    classDef local fill:#f5f0e8,stroke:#8d8170,color:#0a0a08;
    classDef external fill:#e8eef7,stroke:#1b4d8e,color:#0a0a08;
    classDef ui fill:#fff8ed,stroke:#c8402a,color:#0a0a08;
    class IDBLec,IDBChunkStore,LocalKeys,RAM local;
    class Resolve,TranscribeAPI,CompleteAPI,Catalog external;
    class Routes,App,Report,Library,Export ui;
```

## Static build and release

```mermaid
flowchart LR
    Source["Static HTML, CSS, ES modules<br/>and locally vendored idb / lamejs"]
    Manifest["sw.js asset allowlist"]
    Build["npm run build<br/>scripts/build-static.mjs"]
    Dist["dist/<br/>allowlisted public assets + licenses<br/>content-derived service-worker cache version"]
    Host["Any static HTTPS host<br/>for example GitHub Pages or Cloudflare Pages"]
    Browser["Learner's browser"]
    API["Selected provider API"]

    Source --> Build
    Manifest -->|"defines release asset set"| Build
    Build --> Dist --> Host --> Browser
    Browser <-->|"direct, browser-origin API requests"| API
```

The release build copies only the public asset allowlist into `dist`; it does
not include source-only v2 references, tests, documentation, or local
configuration. Deployment is static hosting only. Provider inference remains a
separate external service and may incur provider usage charges.

## Important data and failure boundaries

| Data or operation | Location / destination | Behavior |
| --- | --- | --- |
| Provider keys and model preferences | Browser `localStorage` | Sent only to the selected provider endpoint; not included in lecture records or JSON backups. This is browser storage, not a secret vault. |
| Pending or failed audio | IndexedDB chunk records; RAM while a write is failing | Successful transcription atomically saves text and removes the audio blob. RAM-only audio does not survive reload or tab closure. |
| Lectures and study materials | IndexedDB `DeLecturedDB` | Local-first storage; the service worker does not sync it to a server. Browser clearing/eviction or changing origin can lose access; export backups regularly. |
| Transcription | Selected transcription provider | Audio chunks are sent directly from the browser. Offline chunks wait locally and resume while the app is open after reconnection. |
| Notes and Q&A | Selected completion provider | Transcript windows or retrieved Q&A passages are sent directly from the browser. Analysis checkpoints allow validated work to resume without retranscription. |
| Static application shell | Service-worker Cache Storage | Same-origin public shell assets only; provider requests and lecture data are not cached there. First-ever offline launch is not supported. |
| Import/export | Local file downloads and browser-selected files | JSON backups contain lecture records, not pending audio or credentials. Markdown/CSV exports and PDF printing are generated in the browser. |

Transcription and notes provider selections are saved per lecture. Network and
rate-limit retries are bounded; authentication, quota, unsupported requests,
and invalid responses require explicit user action. Capture gaps and uncertain
overlap are surfaced instead of fabricating transcript continuity. Evidence
quotes are checked for literal presence, but that does not establish that an
AI-generated interpretation is correct.
