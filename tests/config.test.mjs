import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getConfig, saveConfig} from '../js/config.js';

test('partial updates retain keys, defaults are isolated, failed settings writes reject', () => {
  let saved;
  globalThis.localStorage = {getItem: () => saved, setItem: (_, value) => {saved = value;}};
  getConfig().keys.groq = 'must-not-mutate-default';
  assert.equal(getConfig().keys.groq, '');
  saveConfig({keys: {groq: 'first', gemini: 'second'}});
  saveConfig({keys: {openai: 'third'}});
  assert.deepEqual(getConfig().keys, {groq: 'first', gemini: 'second', openai: 'third'});
  saved = '{"keys":{"groq":"older"}}';
  assert.equal(getConfig().keys.gemini, '');
  const originalError = console.error;
  console.error = () => {};
  try {
    localStorage.setItem = () => {throw new DOMException('Full', 'QuotaExceededError');};
    assert.throws(() => saveConfig({language: 'hi'}), {name: 'QuotaExceededError'});
  } finally { console.error = originalError; }
});
