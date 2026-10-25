import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchChord, smoothFramePredictions } from '../src/js/chord-engine/chord-matcher.js';
import { extractFrameChroma } from '../src/js/chord-engine/chromagram.js';
import { diagnoseMismatches } from './run-evaluation.js';

test('Diagnostics: matchChord exposes top 3 candidates and confidence metrics', () => {
  // Construct ideal C Major chroma: C (bin 0), E (bin 4), G (bin 7)
  const chroma = new Float32Array(12);
  chroma[0] = 1.0 / Math.sqrt(3);
  chroma[4] = 1.0 / Math.sqrt(3);
  chroma[7] = 1.0 / Math.sqrt(3);

  const result = matchChord(chroma);
  assert.equal(result.chord, 'C Major');
  assert.equal(result.isConfident, true);
  assert.ok(result.diagnostics, 'Diagnostics object must be present');

  const diag = result.diagnostics;
  assert.equal(diag.decision, 'accepted');
  assert.ok(diag.reason.includes('Accepted:'));

  // Top 3 candidates
  assert.equal(diag.candidates.length, 3);
  assert.equal(diag.candidates[0].chord, 'C Major');
  assert.ok(diag.candidates[0].score > 0.95);
  assert.ok(diag.scoreDelta > 0.1, `Expected distinct winner delta, got ${diag.scoreDelta}`);

  // Triad completeness: all 3 notes have equal energy
  assert.ok(Math.abs(diag.triadCompleteness - 1.0) < 0.05);
  assert.equal(diag.triadNotes.root, 'C');
  assert.equal(diag.triadNotes.third, 'E');
  assert.equal(diag.triadNotes.fifth, 'G');

  // Non-chord ratio: 0 for pure triad
  assert.equal(diag.nonChordRatio, 0);
});

test('Diagnostics: matchChord provides rejection reasons for incomplete chords and noise', () => {
  // 1. Single note (A4) - incomplete triad
  const singleNote = new Float32Array(12);
  singleNote[9] = 1.0; // A only
  const singleResult = matchChord(singleNote);
  assert.equal(singleResult.chord, 'N.C.');
  assert.equal(singleResult.diagnostics.decision, 'rejected');
  assert.ok(singleResult.diagnostics.reason.includes('Incomplete triad'));

  // 2. White noise / flat spectrum - low score or ambiguous
  const flatChroma = new Float32Array(12);
  flatChroma.fill(1.0 / Math.sqrt(12));
  const flatResult = matchChord(flatChroma, { confidenceThreshold: 0.55 });
  assert.equal(flatResult.chord, 'N.C.');
  assert.equal(flatResult.diagnostics.decision, 'rejected');
  assert.ok(flatResult.diagnostics.reason.includes('Low template match score') || flatResult.diagnostics.reason.includes('High non-chord energy'));

  // 3. Ambiguous chord with high non-chord energy
  const mixedChroma = new Float32Array(12);
  mixedChroma[0] = 0.5; // C
  mixedChroma[4] = 0.5; // E
  mixedChroma[7] = 0.5; // G
  mixedChroma[1] = 0.4; // C#
  mixedChroma[6] = 0.4; // F#
  mixedChroma[11] = 0.4; // B
  // Normalize
  let norm = 0;
  for (let i = 0; i < 12; i++) norm += mixedChroma[i] * mixedChroma[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 12; i++) mixedChroma[i] /= norm;

  const mixedResult = matchChord(mixedChroma);
  assert.ok(mixedResult.diagnostics.nonChordRatio > 0.3);
});

test('Diagnostics: extractFrameChroma detects and returns spectral peaks with note labels', () => {
  const sampleRate = 44100;
  const frameSize = 8192;
  const signal = new Float32Array(frameSize);

  // 440 Hz (A4) and 880 Hz (A5)
  for (let i = 0; i < frameSize; i++) {
    signal[i] =
      0.6 * Math.sin((2 * Math.PI * 440.0 * i) / sampleRate) +
      0.3 * Math.sin((2 * Math.PI * 880.0 * i) / sampleRate);
  }

  const result = extractFrameChroma(signal, sampleRate);
  assert.equal(result.isSilent, false);
  assert.ok(Array.isArray(result.spectralPeaks));
  assert.ok(result.spectralPeaks.length >= 2);

  // Strongest peak should be close to 440 Hz A4
  const topPeak = result.spectralPeaks[0];
  assert.ok(Math.abs(topPeak.frequency - 440.0) < 2.0, `Expected ~440 Hz, got ${topPeak.frequency}`);
  assert.equal(topPeak.note, 'A4');
  assert.equal(topPeak.pitchClass, 'A');
  assert.ok(topPeak.magnitude > 0);
});

test('Diagnostics: smoothFramePredictions flags smoothed vs unchanged frames', () => {
  const frames = [
    { time: 0.0, chord: 'C Major', shortName: 'C', score: 0.9 },
    { time: 0.1, chord: 'C Major', shortName: 'C', score: 0.9 },
    { time: 0.2, chord: 'D Minor', shortName: 'Dm', score: 0.6 }, // Outlier glitch
    { time: 0.3, chord: 'C Major', shortName: 'C', score: 0.9 },
    { time: 0.4, chord: 'C Major', shortName: 'C', score: 0.9 }
  ];

  const smoothed = smoothFramePredictions(frames, 2);

  assert.equal(smoothed[0].wasSmoothed, false);
  assert.equal(smoothed[0].chord, 'C Major');

  // The middle frame at 0.2s was changed from Dm to C Major
  assert.equal(smoothed[2].wasSmoothed, true);
  assert.equal(smoothed[2].rawChord, 'D Minor');
  assert.equal(smoothed[2].smoothedChord, 'C Major');
  assert.equal(smoothed[2].chord, 'C Major');
});

test('Diagnostics: diagnoseMismatches locates differences between reference and detected', () => {
  const ref = [
    { startTime: 0.0, endTime: 1.0, chord: 'C Major' },
    { startTime: 1.0, endTime: 2.0, chord: 'G Major' }
  ];

  const det = [
    { startTime: 0.0, endTime: 0.9, chord: 'C Major' },
    { startTime: 0.9, endTime: 2.0, chord: 'G Major' }
  ];

  const frames = [
    { time: 0.0, chord: 'C Major', diagnostics: { reason: 'Test C' } },
    { time: 0.95, chord: 'G Major', diagnostics: { reason: 'Test G' } }
  ];

  const mismatches = diagnoseMismatches(ref, det, frames);
  assert.ok(mismatches.length > 0);
  assert.ok(mismatches[0].startTime >= 0.85 && mismatches[0].endTime <= 1.05);
});
