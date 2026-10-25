import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runAllStressTests } from './run-stress-tests.js';

test('Synthetic Stress Suite: All 10 Categories Pass at 100% Rate', async () => {
  const results = await runAllStressTests();

  for (const [key, cat] of Object.entries(results)) {
    const failedCases = cat.details.filter(d => !d.pass);
    assert.equal(
      cat.passed,
      cat.total,
      `Category ${cat.name} failed (${failedCases.length}/${cat.total}): ${failedCases.map(f => `${f.case} [got: ${f.detected}]`).join('; ')}`
    );
  }
});

test('Synthetic Stress Suite: Category 1 - Major & Minor Unbalanced Dynamics', async () => {
  const results = await runAllStressTests();
  assert.equal(results.category1.passed, results.category1.total);
});

test('Synthetic Stress Suite: Category 2 - Realistic Harmonics & Overtones', async () => {
  const results = await runAllStressTests();
  assert.equal(results.category2.passed, results.category2.total);
});

test('Synthetic Stress Suite: Category 3 - Loud Bass with Quiet Chord Tones', async () => {
  const results = await runAllStressTests();
  assert.equal(results.category3.passed, results.category3.total);
});

test('Synthetic Stress Suite: Category 4 - Octaves and Inversions', async () => {
  const results = await runAllStressTests();
  assert.equal(results.category4.passed, results.category4.total);
});

test('Synthetic Stress Suite: Category 5 - Chords Mixed with Independent Bass', async () => {
  const results = await runAllStressTests();
  assert.equal(results.category5.passed, results.category5.total);
});

test('Synthetic Stress Suite: Category 6 - Chords Mixed with Broadband Noise', async () => {
  const results = await runAllStressTests();
  assert.equal(results.category6.passed, results.category6.total);
});

test('Synthetic Stress Suite: Category 7 - Percussive Transient Rejection', async () => {
  const results = await runAllStressTests();
  assert.equal(results.category7.passed, results.category7.total);
});

test('Synthetic Stress Suite: Category 8 - Overlapping Window Transitions', async () => {
  const results = await runAllStressTests();
  assert.equal(results.category8.passed, results.category8.total);
});

test('Synthetic Stress Suite: Category 9 - Low-Register Semitone Discrimination', async () => {
  const results = await runAllStressTests();
  assert.equal(results.category9.passed, results.category9.total);
});

test('Synthetic Stress Suite: Category 10 - Silence and Incomplete Note Rejection', async () => {
  const results = await runAllStressTests();
  assert.equal(results.category10.passed, results.category10.total);
});
