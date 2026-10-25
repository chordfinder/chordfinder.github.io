import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASIC_TEMPLATES,
  cosineSimilarity,
  matchChord,
  smoothFramePredictions,
  segmentChords
} from '../src/js/chord-engine/chord-matcher.js';
import { PITCH_CLASSES } from '../src/js/chord-engine/note-pitch.js';

test('1. Chord Matcher: 24 Basic Templates Existence & Normalization', () => {
  assert.equal(BASIC_TEMPLATES.length, 24);

  const majorCount = BASIC_TEMPLATES.filter(t => t.quality === 'major').length;
  const minorCount = BASIC_TEMPLATES.filter(t => t.quality === 'minor').length;

  assert.equal(majorCount, 12);
  assert.equal(minorCount, 12);

  // Each template must have unit L2 norm
  for (const tmpl of BASIC_TEMPLATES) {
    let sumSq = 0;
    for (let i = 0; i < 12; i++) {
      sumSq += tmpl.vector[i] * tmpl.vector[i];
    }
    assert.ok(Math.abs(Math.sqrt(sumSq) - 1.0) < 1e-5, `${tmpl.name} vector should have norm 1.0`);
  }
});

test('2. Chord Matcher: Cosine Similarity function', () => {
  const v1 = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const v2 = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const v3 = new Float32Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  assert.equal(cosineSimilarity(v1, v2), 1.0);
  assert.equal(cosineSimilarity(v1, v3), 0.0);
});

test('3. Chord Matcher: All 12 Major Chords Match Correctly', () => {
  for (let r = 0; r < 12; r++) {
    const rootName = PITCH_CLASSES[r];
    const expectedName = `${rootName} Major`;

    // Construct ideal normalized triad vector
    const chroma = new Float32Array(12);
    chroma[r] = 1.0 / Math.sqrt(3);
    chroma[(r + 4) % 12] = 1.0 / Math.sqrt(3);
    chroma[(r + 7) % 12] = 1.0 / Math.sqrt(3);

    const match = matchChord(chroma);
    assert.equal(match.chord, expectedName, `Expected ${expectedName}, got ${match.chord}`);
    assert.equal(match.root, rootName);
    assert.equal(match.quality, 'major');
    assert.ok(match.score > 0.95);
    assert.equal(match.isConfident, true);
  }
});

test('4. Chord Matcher: All 12 Minor Chords Match Correctly', () => {
  for (let r = 0; r < 12; r++) {
    const rootName = PITCH_CLASSES[r];
    const expectedName = `${rootName} Minor`;

    // Construct ideal normalized triad vector
    const chroma = new Float32Array(12);
    chroma[r] = 1.0 / Math.sqrt(3);
    chroma[(r + 3) % 12] = 1.0 / Math.sqrt(3);
    chroma[(r + 7) % 12] = 1.0 / Math.sqrt(3);

    const match = matchChord(chroma);
    assert.equal(match.chord, expectedName, `Expected ${expectedName}, got ${match.chord}`);
    assert.equal(match.root, rootName);
    assert.equal(match.quality, 'minor');
    assert.ok(match.score > 0.95);
    assert.equal(match.isConfident, true);
  }
});

test('5. Chord Matcher: Silence & Low-Energy Rejection', () => {
  const zeroVector = new Float32Array(12);
  const matchZero = matchChord(zeroVector);
  assert.equal(matchZero.chord, 'N.C.');
  assert.equal(matchZero.score, 0);
  assert.equal(matchZero.isConfident, false);

  const nullMatch = matchChord(null);
  assert.equal(nullMatch.chord, 'N.C.');
  assert.equal(nullMatch.isConfident, false);
});

test('6. Chord Matcher: Ambiguous / Flat Noise Input', () => {
  // Uniform energy distribution (white noise chroma)
  const flatChroma = new Float32Array(12);
  flatChroma.fill(1.0 / Math.sqrt(12));

  // Should have low similarity to any single triad (~0.5) and fail the confidence threshold
  const matchFlat = matchChord(flatChroma, { confidenceThreshold: 0.55 });
  assert.equal(matchFlat.chord, 'N.C.');
  assert.equal(matchFlat.isConfident, false);
});

test('7. Chord Matcher: Temporal Smoothing (Flicker Reduction)', () => {
  // 5 frames: C Major, C Major, D Minor (single-frame glitch), C Major, C Major
  const frames = [
    { time: 0.0, chord: 'C Major', score: 0.9 },
    { time: 0.1, chord: 'C Major', score: 0.9 },
    { time: 0.2, chord: 'D Minor', score: 0.6 }, // 1-frame outlier
    { time: 0.3, chord: 'C Major', score: 0.9 },
    { time: 0.4, chord: 'C Major', score: 0.9 }
  ];

  const smoothed = smoothFramePredictions(frames, 2);
  // The middle frame at 0.2s should be smoothed to C Major
  assert.equal(smoothed[2].chord, 'C Major');
});

test('8. Chord Matcher: Segment Grouping and Timestamps', () => {
  // Frames simulating C Major for 1.0s, then G Major for 1.0s
  const frames = [];
  const hopDuration = 0.1;

  for (let i = 0; i < 10; i++) {
    frames.push({
      time: i * hopDuration,
      chord: 'C Major',
      shortName: 'C',
      root: 'C',
      quality: 'major',
      score: 0.92
    });
  }
  for (let i = 10; i < 20; i++) {
    frames.push({
      time: i * hopDuration,
      chord: 'G Major',
      shortName: 'G',
      root: 'G',
      quality: 'major',
      score: 0.88
    });
  }

  const segments = segmentChords(frames, hopDuration, { minSegmentDuration: 0.3 });
  assert.equal(segments.length, 2);

  assert.equal(segments[0].chord, 'C Major');
  assert.equal(segments[0].startTime, 0.0);
  assert.equal(segments[0].endTime, 1.0);
  assert.ok(Math.abs(segments[0].similarityScore - 0.92) < 0.01);

  assert.equal(segments[1].chord, 'G Major');
  assert.equal(segments[1].startTime, 1.0);
  assert.equal(segments[1].endTime, 2.0);
  assert.ok(Math.abs(segments[1].similarityScore - 0.88) < 0.01);
});
