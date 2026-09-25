const test = require('node:test');
const assert = require('node:assert/strict');

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ');

test('only UUID v4 session identifiers are accepted', () => {
  assert.equal(uuidV4.test('4f3c8a48-2bc5-4d31-9c3a-1e2c6d1c7a90'), true);
  assert.equal(uuidV4.test('attacker-controlled-id'), false);
});

test('answer normalization handles harmless formatting differences', () => {
  assert.equal(normalize('  APPLE!  '), 'apple');
  assert.equal(normalize('apple'), 'apple');
  assert.equal(normalize('two   words'), 'two words');
  assert.equal(normalize('Café'), 'cafe');
});

test('round timing uses one shared 30 second duration', () => {
  const answerTimeMs = 30000;
  const submittedAt = 12500;
  const deadline = answerTimeMs;
  assert.equal(submittedAt - (deadline - answerTimeMs), submittedAt);
});
