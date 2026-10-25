import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeChordMetrics, sampleSegmentAtTime } from './evaluation-metrics.js';

test('Evaluation Metrics: Perfect Match Benchmark', () => {
  const ref = [
    { startTime: 0.0, endTime: 2.0, chord: 'C Major', root: 'C', quality: 'major' },
    { startTime: 2.0, endTime: 4.0, chord: 'G Major', root: 'G', quality: 'major' },
    { startTime: 4.0, endTime: 6.0, chord: 'A Minor', root: 'A', quality: 'minor' }
  ];

  const det = [
    { startTime: 0.0, endTime: 2.0, chord: 'C Major', root: 'C', quality: 'major', similarityScore: 0.95 },
    { startTime: 2.0, endTime: 4.0, chord: 'G Major', root: 'G', quality: 'major', similarityScore: 0.92 },
    { startTime: 4.0, endTime: 6.0, chord: 'A Minor', root: 'A', quality: 'minor', similarityScore: 0.90 }
  ];

  const metrics = computeChordMetrics(ref, det, { datasetType: 'synthetic' });

  assert.equal(metrics.chordAccuracyPct, 100);
  assert.equal(metrics.rootAccuracyPct, 100);
  assert.equal(metrics.majorMinorAccuracyPct, 100);
  assert.equal(metrics.transitionMetrics.meanAbsoluteErrorSec, 0.0);
  assert.equal(metrics.ncPercentage, 0.0);
  assert.equal(metrics.falseRejectionPct, 0.0);
  assert.ok(metrics.calibrationNotice.includes('NOT be interpreted as calibrated posterior probabilities'));
});

test('Evaluation Metrics: Partial Mismatch, Silence Rejection, and Boundary Offset', () => {
  const ref = [
    { startTime: 0.0, endTime: 2.0, chord: 'C Major', root: 'C', quality: 'major' },
    { startTime: 2.0, endTime: 3.0, chord: 'N.C.', root: null, quality: 'none' },
    { startTime: 3.0, endTime: 5.0, chord: 'G Major', root: 'G', quality: 'major' }
  ];

  // Detected has 0.1s boundary error on transition, C Minor instead of C Major for first second
  const det = [
    { startTime: 0.0, endTime: 1.0, chord: 'C Minor', root: 'C', quality: 'minor', similarityScore: 0.8 },
    { startTime: 1.0, endTime: 2.1, chord: 'C Major', root: 'C', quality: 'major', similarityScore: 0.9 },
    { startTime: 2.1, endTime: 3.0, chord: 'N.C.', root: null, quality: 'none', similarityScore: 0.0 },
    { startTime: 3.0, endTime: 5.0, chord: 'G Major', root: 'G', quality: 'major', similarityScore: 0.88 }
  ];

  const metrics = computeChordMetrics(ref, det, { datasetType: 'synthetic' });

  // Root note is 'C' for 0-2.0 and 'G' for 3-5.0: 100% root accuracy
  assert.equal(metrics.rootAccuracyPct, 100);

  // Quality mismatch in first second (minor vs major): should lower quality accuracy
  assert.ok(metrics.majorMinorAccuracyPct < 100 && metrics.majorMinorAccuracyPct > 70);

  // Silence rejection recall: 0.9s of 1.0s silence detected as N.C. (~90%)
  assert.ok(metrics.silenceRejectionRecallPct > 85);

  // Boundary error at t=2.0s vs t=2.1s is ~0.1s
  assert.ok(Math.abs(metrics.transitionMetrics.meanAbsoluteErrorSec - 0.05) < 0.06);
});
