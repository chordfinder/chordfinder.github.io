import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchChord, smoothFramePredictions, segmentChords, getFrameDiagnosticsAtTime } from '../src/js/chord-engine/chord-matcher.js';
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
  assert.ok(mismatches[0].diagnostic);
  assert.equal(mismatches[0].diagnostic.frameIndex, 1);
});

test('Diagnostics Regression: getFrameDiagnosticsAtTime resolves Case 1 boundary without frame mixing (3.00s-3.05s)', () => {
  // Construct sequence representing G Major transition to A Minor
  const frames = [
    {
      time: 2.879,
      chord: 'G Major',
      rawChord: 'G Major',
      score: 0.9109,
      diagnostics: {
        candidates: [{ chord: 'G Major', score: 0.9109 }],
        decision: 'accepted',
        reason: 'Accepted: High template correlation'
      }
    },
    {
      time: 2.972,
      chord: 'A Minor',
      rawChord: 'A Minor',
      score: 1.0,
      diagnostics: {
        candidates: [{ chord: 'A Minor', score: 1.0 }],
        decision: 'accepted',
        reason: 'Accepted: High template correlation'
      }
    },
    {
      time: 3.065,
      chord: 'A Minor',
      rawChord: 'A Minor',
      score: 1.0,
      diagnostics: {
        candidates: [{ chord: 'A Minor', score: 1.0 }],
        decision: 'accepted',
        reason: 'Accepted: High template correlation'
      }
    }
  ];

  const segments = [
    { chord: 'G Major', startTime: 1.49, endTime: 2.97, duration: 1.48 },
    { chord: 'A Minor', startTime: 2.97, endTime: 4.37, duration: 1.40 }
  ];

  // At midTime 3.025s (range 3.00s - 3.05s)
  const diag = getFrameDiagnosticsAtTime(3.025, frames, segments);

  // Must select the closest frame (frame 1 at 2.972s or frame 2 at 3.065s), NOT frame 0 (2.879s G Major)
  assert.ok(diag.frameIndex === 1 || diag.frameIndex === 2, `Expected frame 1 or 2, got ${diag.frameIndex}`);
  assert.equal(diag.rawChord, 'A Minor');
  assert.equal(diag.smoothedChord, 'A Minor');
  assert.equal(diag.finalSegmentChord, 'A Minor');
  assert.equal(diag.wasSmoothed, false);
  assert.equal(diag.segmentStartTime, 2.97);
  assert.equal(diag.segmentEndTime, 4.37);
  assert.equal(diag.rawCandidates[0].chord, 'A Minor');
  assert.ok(diag.rawScore > 0.99);

  // Must NOT report G Major with score 0.9109
  assert.notEqual(diag.rawChord, 'G Major');
  assert.notEqual(diag.rawCandidates[0].chord, 'G Major');
});

test('Diagnostics Regression: getFrameDiagnosticsAtTime resolves Case 2 audio tail without falling back to Frame 0 (4.40s-4.55s)', () => {
  const frames = [
    {
      time: 0.0,
      chord: 'C Major',
      rawChord: 'C Major',
      score: 0.9999,
      diagnostics: {
        candidates: [{ chord: 'C Major', score: 0.9999 }],
        decision: 'accepted',
        reason: 'Accepted: Frame 0'
      }
    },
    {
      time: 4.272,
      chord: 'A Minor',
      rawChord: 'A Minor',
      score: 1.0,
      diagnostics: {
        candidates: [{ chord: 'A Minor', score: 1.0 }],
        decision: 'accepted',
        reason: 'Accepted: Frame 46'
      }
    }
  ];

  const segments = [
    { chord: 'C Major', startTime: 0.0, endTime: 1.5, duration: 1.5 },
    { chord: 'A Minor', startTime: 3.0, endTime: 4.37, duration: 1.37 }
  ];

  // At midTime 4.475s (range 4.40s - 4.55s)
  const diag = getFrameDiagnosticsAtTime(4.475, frames, segments);

  // Must identify the closest frame (frame 1 at 4.272s), NEVER fallback to frame 0 (C Major)
  assert.equal(diag.frameIndex, 1);
  assert.equal(diag.frameTime, 4.272);
  assert.equal(diag.rawChord, 'A Minor');
  assert.notEqual(diag.rawChord, 'C Major');
  assert.notEqual(diag.rawCandidates[0].chord, 'C Major');

  // Segment should be N.C. because 4.475s is past 4.37s
  assert.equal(diag.finalSegmentChord, 'N.C.');
  assert.equal(diag.segmentStartTime, null);

  // Explanation must explicitly note that timestamp falls outside detected segments
  assert.ok(diag.differExplanation.includes('outside detected segments'));
});

test('Diagnostics: getFrameDiagnosticsAtTime explains differences when smoothing or segment merging occurs', () => {
  // Case A: Smoothing modified raw prediction
  const smoothedFrames = [
    {
      time: 1.0,
      chord: 'C Major',
      rawChord: 'D Minor',
      smoothedChord: 'C Major',
      wasSmoothed: true,
      diagnostics: {
        candidates: [{ chord: 'D Minor', score: 0.65 }],
        decision: 'accepted',
        reason: 'Accepted raw Dm'
      }
    }
  ];
  const segmentsA = [
    { chord: 'C Major', startTime: 0.5, endTime: 1.5, duration: 1.0 }
  ];
  const diagA = getFrameDiagnosticsAtTime(1.0, smoothedFrames, segmentsA);
  assert.equal(diagA.wasSmoothed, true);
  assert.equal(diagA.rawChord, 'D Minor');
  assert.equal(diagA.smoothedChord, 'C Major');
  assert.equal(diagA.finalSegmentChord, 'C Major');
  assert.ok(diagA.differExplanation.includes('Temporal smoothing modified'));

  // Case B: Segment merging modified final segment
  const mergedFrames = [
    {
      time: 2.0,
      chord: 'E Minor',
      rawChord: 'E Minor',
      smoothedChord: 'E Minor',
      wasSmoothed: false,
      diagnostics: {
        candidates: [{ chord: 'E Minor', score: 0.85 }],
        decision: 'accepted',
        reason: 'Accepted Em'
      }
    }
  ];
  const segmentsB = [
    { chord: 'C Major', startTime: 1.5, endTime: 2.5, duration: 1.0 }
  ];
  const diagB = getFrameDiagnosticsAtTime(2.0, mergedFrames, segmentsB);
  assert.equal(diagB.wasSmoothed, false);
  assert.equal(diagB.rawChord, 'E Minor');
  assert.equal(diagB.finalSegmentChord, 'C Major');
  assert.ok(diagB.differExplanation.includes('differs from final segment'));
});

