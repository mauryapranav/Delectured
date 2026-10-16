import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/store.js';
import {runStorageChecks} from './storage-checks.js';

test('successful transcription persists text and releases audio', async () => {
  await store.saveLecture({id: 'regression', title: 'Test', transcript: ''});
  await store.saveChunk('regression', 0, new Blob(['audio']));
  await store.completeChunk('regression_0', {text: 'Durable transcript', segments: []});
  const [chunk] = await store.getAllChunks('regression');
  assert.equal(chunk.text, 'Durable transcript');
  assert.equal(chunk.blob, undefined);
  assert.equal((await store.getLecture('regression')).transcript, 'Durable transcript');
});

test('migration, reopen, recovery, rollback, backups, and deletion', async () => {
  await runStorageChecks();
});
