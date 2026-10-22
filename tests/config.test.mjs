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

test('keys default to session-only, explicit remembering and forgetting preserve usable settings', () => {
  const local = new Map(), session = new Map();
  globalThis.localStorage = {getItem: k => local.get(k), setItem: (k, v) => local.set(k, v)};
  globalThis.sessionStorage = {getItem: k => session.get(k), setItem: (k, v) => session.set(k, v)};
  assert.equal(getConfig().rememberKeys, false);
  saveConfig({keys: {groq: 'session-secret'}});
  assert.equal(getConfig().keys.groq, 'session-secret');
  assert(!local.get('delectured_config').includes('session-secret'));
  assert(session.get('delectured_session_keys').includes('session-secret'));
  saveConfig({language: 'hi'});
  assert.equal(getConfig().keys.groq, 'session-secret');
  saveConfig({rememberKeys: true});
  assert(local.get('delectured_config').includes('session-secret'));
  assert.equal(session.get('delectured_session_keys'), '{}');
  saveConfig({rememberKeys: false});
  assert(!local.get('delectured_config').includes('session-secret'));
  assert.equal(getConfig().keys.groq, 'session-secret');
  // A different tab session cannot recover session-only credentials.
  globalThis.localStorage = {getItem: k => local.get(k), setItem: (k, v) => local.set(k, v)};
  globalThis.sessionStorage = {getItem: () => null, setItem: () => {}};
  assert.equal(getConfig().keys.groq, '');
});

test('legacy remembered keys survive; blocked session storage falls back to memory and URL changes clear custom keys', () => {
  const local = new Map([['delectured_config', JSON.stringify({keys: {groq: 'legacy'}})]]);
  globalThis.localStorage = {getItem: k => local.get(k), setItem: (k, v) => local.set(k, v)};
  globalThis.sessionStorage = {getItem: () => null, setItem: () => {throw new Error('blocked');}};
  assert.equal(getConfig().rememberKeys, true);
  assert.equal(getConfig().keys.groq, 'legacy');
  saveConfig({rememberKeys: false, compatibleBaseUrl: 'https://example.com/v1', keys: {compatible: 'custom-secret'}});
  assert.equal(getConfig().keys.compatible, 'custom-secret');
  saveConfig({compatibleBaseUrl: 'https://another.example/v1'});
  assert.equal(getConfig().keys.compatible, '');
  assert.equal(getConfig().keys.groq, 'legacy');
});
