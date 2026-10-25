# DeLectured architecture

DeLectured is a static browser application. It has no application backend or hosted lecture database. Audio and transcript passages are sent directly to the providers selected by the user; saved lectures and recovery state stay in the browser.

The maintained architecture explanation and diagrams are in the README:

- [Audio preparation and transcription](README.md#1-audio-becomes-a-saved-transcript)
- [Notes extraction, validation, checkpoints and overview merging](README.md#2-notes-are-extracted-with-context-checked-and-combined)
- [Q&A and course revision](README.md#3-study-and-ask-questions)
- [Request allowances and recovery](README.md#recovery-and-responsible-api-use)
- [Storage boundaries and offline use](README.md#storage-privacy-and-offline-use)

Start with [js/app.js](js/app.js) for orchestration, [js/pipeline.js](js/pipeline.js) for notes generation, [js/store.js](js/store.js) for persistence and [js/providers](js/providers) for API adapters. [scripts/build-static.mjs](scripts/build-static.mjs) creates the deployable shared shell from an explicit asset allowlist.

The README is the single source for documented limits and the pipeline overview, so this page does not duplicate values that can become outdated.
