/**
 * ChordFinder Phase 2.7 - Boundary Coverage & Evaluation Integrity Regression Suite
 * Tests audio-tail frame coverage, padded frames, trailing silence preservation,
 * and evaluation interval clipping to audioDuration.
 *
 * All test cases use synthetic audio signals with known ground truth and are labelled
 * as synthetic tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRmsEnergy,
  extractFrameChroma,
  extractChromagram
} from '../src/js/chord-engine/chromagram.js';

import {
  matchChord,
  segmentChords,
  smoothFramePredictions,
  getFrameDiagnosticsAtTime
} from '../src/js/chord-engine/chord-matcher.js';

import {
  computeChordMetrics,
  sampleSegmentAtTime,
  clipSegmentsToDuration
} from './evaluation-metrics.js';

import { diagnoseMismatches } from './run-evaluation.js';

// Pitch frequencies (Hz)
const FREQ = {
  C4: 261.63,
  E4: 329.63,
  G4: 392.00,
  A3: 220.00,
  B3: 246.94,
  D4: 293.66
};

/**
 * Synthesizes a mono audio signal of specified duration containing chord frequencies.
 */
function synthesizeChordSignal(pitches, durationSec, sampleRate = 44100, amplitude = 0.3) {
  const numSamples = Math.round(durationSec * sampleRate);
  const buffer = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    let s = 0;
    for (const f of pitches) {
      s += Math.sin((2 * Math.PI * f * i) / sampleRate);
    }
    buffer[i] = (s / pitches.length) * amplitude;
  }
  return buffer;
}

/**
 * Synthesizes silence of specified duration.
 */
function synthesizeSilenceSignal(durationSec, sampleRate = 44100) {
  const numSamples = Math.round(durationSec * sampleRate);
  return new Float32Array(numSamples);
}

/**
 * Concatenates multiple Float32Array buffers into one.
 */
function concatBuffers(...buffers) {
  const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
  const out = new Float32Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

test('Synthetic Test 1: Sustained chord ending exactly at the end of a file', async () => {
  const sampleRate = 44100;
  // 1.83 seconds = 80,703 samples. (80703 - 8192) / 4096 = 17.70 -> 18 full frames + tail frame
  const duration = 1.83;
  const audio = synthesizeChordSignal([FREQ.C4, FREQ.E4, FREQ.G4], duration, sampleRate);

  const hopSize = 4096;
  const hopDuration = hopSize / sampleRate;

  const chromaFrames = await extractChromagram(audio, sampleRate, { frameSize: 8192, hopSize });
  assert.ok(chromaFrames.length > 0);

  // The last frame must be a padded frame that ends at the recording duration
  const lastFrame = chromaFrames[chromaFrames.length - 1];
  assert.equal(lastFrame.isPadded, true);
  assert.ok(Math.abs(lastFrame.actualEndTime - duration) < 0.001);

  const preds = chromaFrames.map(f => {
    const match = matchChord(f.chroma);
    return {
      time: f.time,
      actualEndTime: f.actualEndTime,
      actualSampleCount: f.actualSampleCount,
      isPadded: f.isPadded,
      chord: f.isSilent ? 'N.C.' : match.chord,
      shortName: f.isSilent ? 'N.C.' : match.shortName,
      root: f.isSilent ? null : match.root,
      quality: f.isSilent ? 'none' : match.quality,
      score: f.isSilent ? 0 : match.score,
      isSilent: f.isSilent
    };
  });

  const segments = segmentChords(preds, hopDuration, { audioDuration: duration, minSegmentDuration: 0.3 });
  assert.ok(segments.length >= 1);

  const finalSeg = segments[segments.length - 1];
  assert.equal(finalSeg.chord, 'C Major');
  assert.equal(finalSeg.endTime, parseFloat(duration.toFixed(2)));

  // Ground truth evaluation
  const ref = [{ startTime: 0.0, endTime: duration, chord: 'C Major', root: 'C', quality: 'major' }];
  const metrics = computeChordMetrics(ref, segments, { audioDuration: duration });
  assert.equal(metrics.chordAccuracyPct, 100);
  assert.equal(metrics.falseRejectionPct, 0);
});

test('Synthetic Test 2: Sustained chord followed by trailing silence', async () => {
  const sampleRate = 44100;
  // 1.5s C Major + 0.5s Silence = 2.0s total
  const chordAudio = synthesizeChordSignal([FREQ.C4, FREQ.E4, FREQ.G4], 1.5, sampleRate);
  const silenceAudio = synthesizeSilenceSignal(0.5, sampleRate);
  const audio = concatBuffers(chordAudio, silenceAudio);
  const totalDuration = 2.0;

  const hopSize = 4096;
  const hopDuration = hopSize / sampleRate;

  const chromaFrames = await extractChromagram(audio, sampleRate, { frameSize: 8192, hopSize });
  const preds = chromaFrames.map(f => {
    const match = matchChord(f.chroma);
    return {
      time: f.time,
      actualEndTime: f.actualEndTime,
      actualSampleCount: f.actualSampleCount,
      isPadded: f.isPadded,
      chord: f.isSilent ? 'N.C.' : match.chord,
      shortName: f.isSilent ? 'N.C.' : match.shortName,
      root: f.isSilent ? null : match.root,
      quality: f.isSilent ? 'none' : match.quality,
      score: f.isSilent ? 0 : match.score,
      isSilent: f.isSilent
    };
  });

  const segments = segmentChords(preds, hopDuration, { audioDuration: totalDuration, minSegmentDuration: 0.3 });

  // Verification Requirement 4 & 5:
  // Must NOT blindly extend C Major to 2.0s!
  const cMajorSeg = segments.find(s => s.chord === 'C Major');
  assert.ok(cMajorSeg, 'C Major segment must be detected');
  assert.ok(cMajorSeg.endTime <= 1.60, `C Major should end near 1.5s, got ${cMajorSeg.endTime}`);

  // The last segment must be N.C. covering the trailing silence to 2.0s
  const lastSeg = segments[segments.length - 1];
  assert.equal(lastSeg.chord, 'N.C.', 'Final segment must be N.C. for trailing silence');
  assert.equal(lastSeg.endTime, totalDuration);

  // Evaluation metrics
  const ref = [
    { startTime: 0.0, endTime: 1.5, chord: 'C Major', root: 'C', quality: 'major' },
    { startTime: 1.5, endTime: 2.0, chord: 'N.C.', root: null, quality: 'none' }
  ];
  const metrics = computeChordMetrics(ref, segments, { audioDuration: totalDuration });
  assert.ok(metrics.chordAccuracyPct >= 95, `Expected >= 95% accuracy, got ${metrics.chordAccuracyPct}%`);
  assert.ok(metrics.falseChordDetectionPct < 20, `Boundary transition overlap should be < 20%, got ${metrics.falseChordDetectionPct}%`);
  assert.ok(metrics.silenceRejectionRecallPct >= 80, `Silence rejection recall should be >= 80%, got ${metrics.silenceRejectionRecallPct}%`);
});

test('Synthetic Test 3: A recording shorter than one complete analysis window', async () => {
  const sampleRate = 44100;
  // 0.10s = 4410 samples (< frameSize 8192)
  const duration = 0.10;
  const audio = synthesizeChordSignal([FREQ.C4, FREQ.E4, FREQ.G4], duration, sampleRate, 0.4);

  const chromaFrames = await extractChromagram(audio, sampleRate, { frameSize: 8192, hopSize: 4096 });
  assert.equal(chromaFrames.length, 1);

  const singleFrame = chromaFrames[0];
  assert.equal(singleFrame.time, 0);
  assert.equal(singleFrame.isPadded, true);
  assert.equal(singleFrame.actualSampleCount, audio.length);
  assert.ok(Math.abs(singleFrame.actualEndTime - duration) < 0.001);

  // Energy must not be zero or diluted below silence threshold
  assert.equal(singleFrame.isSilent, false);
  assert.ok(singleFrame.rms > 0.1, `RMS must reflect actual signal, got ${singleFrame.rms}`);

  const match = matchChord(singleFrame.chroma);
  assert.equal(match.chord, 'C Major');

  const preds = [{
    time: singleFrame.time,
    actualEndTime: singleFrame.actualEndTime,
    actualSampleCount: singleFrame.actualSampleCount,
    isPadded: singleFrame.isPadded,
    chord: match.chord,
    shortName: match.shortName,
    root: match.root,
    quality: match.quality,
    score: match.score,
    isSilent: false
  }];

  const segments = segmentChords(preds, 0.093, { audioDuration: duration });
  assert.equal(segments.length, 1);
  assert.equal(segments[0].chord, 'C Major');
  assert.equal(segments[0].startTime, 0);
  assert.equal(segments[0].endTime, duration);

  const ref = [{ startTime: 0.0, endTime: duration, chord: 'C Major', root: 'C', quality: 'major' }];
  const metrics = computeChordMetrics(ref, segments, { audioDuration: duration });
  assert.equal(metrics.chordAccuracyPct, 100);
});

test('Synthetic Test 4: An audio file whose duration is not an exact multiple of the frame hop', async () => {
  const sampleRate = 44100;
  // 1.137 seconds = 50,141 samples
  // 50,141 - 8192 = 41,949 samples. 41,949 / 4096 = 10.241 -> 11 full frames + 1 tail frame
  const duration = 1.137;
  const audio = synthesizeChordSignal([FREQ.A3, FREQ.C4, FREQ.E4], duration, sampleRate);

  const hopSize = 4096;
  const hopDuration = hopSize / sampleRate;

  const chromaFrames = await extractChromagram(audio, sampleRate, { frameSize: 8192, hopSize });
  const lastFrame = chromaFrames[chromaFrames.length - 1];
  assert.equal(lastFrame.isPadded, true);
  assert.ok(lastFrame.actualSampleCount >= 4096);
  assert.ok(Math.abs(lastFrame.actualEndTime - duration) < 0.001);

  const preds = chromaFrames.map(f => {
    const match = matchChord(f.chroma);
    return {
      time: f.time,
      actualEndTime: f.actualEndTime,
      chord: match.chord,
      shortName: match.shortName,
      root: match.root,
      quality: match.quality,
      score: match.score,
      isSilent: f.isSilent
    };
  });

  const segments = segmentChords(preds, hopDuration, { audioDuration: duration });
  const finalSeg = segments[segments.length - 1];
  assert.equal(finalSeg.chord, 'A Minor');
  assert.equal(finalSeg.endTime, parseFloat(duration.toFixed(2)));
});

test('Synthetic Test 5: A chord transition close to the end of a file', async () => {
  const sampleRate = 44100;
  // 1.70s C Major + 0.35s G Major = 2.05s total
  const cMajor = synthesizeChordSignal([FREQ.C4, FREQ.E4, FREQ.G4], 1.70, sampleRate);
  const gMajor = synthesizeChordSignal([FREQ.G4, FREQ.B3, FREQ.D4], 0.35, sampleRate);
  const audio = concatBuffers(cMajor, gMajor);
  const totalDuration = 2.05;

  const hopSize = 4096;
  const hopDuration = hopSize / sampleRate;

  const chromaFrames = await extractChromagram(audio, sampleRate, { frameSize: 8192, hopSize });
  const preds = chromaFrames.map(f => {
    const match = matchChord(f.chroma);
    return {
      time: f.time,
      actualEndTime: f.actualEndTime,
      chord: f.isSilent ? 'N.C.' : match.chord,
      shortName: f.isSilent ? 'N.C.' : match.shortName,
      root: f.isSilent ? null : match.root,
      quality: f.isSilent ? 'none' : match.quality,
      score: f.isSilent ? 0 : match.score,
      isSilent: f.isSilent
    };
  });

  const segments = segmentChords(preds, hopDuration, { audioDuration: totalDuration, minSegmentDuration: 0.3 });
  assert.ok(segments.length >= 2, `Expected at least 2 segments, got ${segments.length}`);

  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];
  assert.equal(firstSeg.chord, 'C Major');
  assert.equal(lastSeg.chord, 'G Major');
  assert.equal(lastSeg.endTime, totalDuration);
});

test('Synthetic Test 6: A recording with silence at the beginning and end', async () => {
  const sampleRate = 44100;
  // 0.30s silence + 1.80s C Major + 0.30s silence = 2.40s
  const leadSil = synthesizeSilenceSignal(0.30, sampleRate);
  const cMajor = synthesizeChordSignal([FREQ.C4, FREQ.E4, FREQ.G4], 1.80, sampleRate);
  const trailSil = synthesizeSilenceSignal(0.30, sampleRate);
  const audio = concatBuffers(leadSil, cMajor, trailSil);
  const totalDuration = 2.40;

  const hopSize = 4096;
  const hopDuration = hopSize / sampleRate;

  const chromaFrames = await extractChromagram(audio, sampleRate, { frameSize: 8192, hopSize });
  const preds = chromaFrames.map(f => {
    const match = matchChord(f.chroma);
    return {
      time: f.time,
      actualEndTime: f.actualEndTime,
      chord: f.isSilent ? 'N.C.' : match.chord,
      shortName: f.isSilent ? 'N.C.' : match.shortName,
      root: f.isSilent ? null : match.root,
      quality: f.isSilent ? 'none' : match.quality,
      score: f.isSilent ? 0 : match.score,
      isSilent: f.isSilent
    };
  });

  const segments = segmentChords(preds, hopDuration, { audioDuration: totalDuration, minSegmentDuration: 0.25 });

  // Leading silence must not be labelled C Major
  assert.ok(segments[0].startTime === 0);
  assert.equal(segments[0].chord, 'N.C.');

  // Trailing silence must not be labelled C Major
  const lastSeg = segments[segments.length - 1];
  assert.equal(lastSeg.chord, 'N.C.');
  assert.equal(lastSeg.endTime, totalDuration);

  // Active chord is in the middle
  const middleSeg = segments.find(s => s.chord === 'C Major');
  assert.ok(middleSeg, 'C Major segment must be detected');
  assert.ok(middleSeg.startTime >= 0.15 && middleSeg.startTime <= 0.35, `C Major start time should be near transition (0.15s - 0.35s), got ${middleSeg.startTime}`);
  assert.ok(middleSeg.endTime >= 2.00 && middleSeg.endTime <= 2.25, `C Major end time should be near transition (2.00s - 2.25s), got ${middleSeg.endTime}`);
});

test('Synthetic Test 7: Correct segment timestamps after padded-frame processing', async () => {
  const sampleRate = 44100;
  // File with non-trivial length: 3.25s
  const duration = 3.25;
  const cPart = synthesizeChordSignal([FREQ.C4, FREQ.E4, FREQ.G4], 1.5, sampleRate);
  const amPart = synthesizeChordSignal([FREQ.A3, FREQ.C4, FREQ.E4], 1.75, sampleRate);
  const audio = concatBuffers(cPart, amPart);

  const hopSize = 4096;
  const hopDuration = hopSize / sampleRate;

  const chromaFrames = await extractChromagram(audio, sampleRate, { frameSize: 8192, hopSize });
  const preds = chromaFrames.map(f => {
    const match = matchChord(f.chroma);
    return {
      time: f.time,
      actualEndTime: f.actualEndTime,
      chord: f.isSilent ? 'N.C.' : match.chord,
      shortName: f.isSilent ? 'N.C.' : match.shortName,
      root: f.isSilent ? null : match.root,
      quality: f.isSilent ? 'none' : match.quality,
      score: f.isSilent ? 0 : match.score,
      isSilent: f.isSilent
    };
  });

  const segments = segmentChords(preds, hopDuration, { audioDuration: duration, minSegmentDuration: 0.35 });

  // Verification: Monotonicity and boundary continuity
  assert.equal(segments[0].startTime, 0.0);
  for (let i = 0; i < segments.length - 1; i++) {
    assert.ok(segments[i].startTime < segments[i].endTime);
    assert.equal(segments[i].endTime, segments[i + 1].startTime, `Segment ${i} end must match segment ${i + 1} start`);
  }
  assert.equal(segments[segments.length - 1].endTime, duration);
});

test('Synthetic Test 8: Annotation or sampling interval extending past WAV duration', () => {
  const audioDuration = 2.0;

  // Reference annotation accidentally extends to 3.5s (1.5s beyond the WAV file)
  const refSegments = [
    { startTime: 0.0, endTime: 1.0, chord: 'C Major', root: 'C', quality: 'major' },
    { startTime: 1.0, endTime: 3.5, chord: 'G Major', root: 'G', quality: 'major' }
  ];

  // Detected segments within actual recording
  const detSegments = [
    { startTime: 0.0, endTime: 1.0, chord: 'C Major', root: 'C', quality: 'major' },
    { startTime: 1.0, endTime: 2.0, chord: 'G Major', root: 'G', quality: 'major' }
  ];

  // Evaluate with audioDuration = 2.0
  const metrics = computeChordMetrics(refSegments, detSegments, { audioDuration });

  // Verification Task 4 requirements:
  // Evaluated duration must be 2.0, NOT 3.5
  assert.equal(metrics.totalDuration, 2.0);
  assert.equal(metrics.totalEvaluatedTime, 2.0);

  // Time beyond audio duration must not count as incorrect predictions or false rejections
  assert.equal(metrics.chordAccuracyPct, 100);
  assert.equal(metrics.falseRejectionPct, 0);

  // Mismatch diagnosis must also not evaluate past 2.0s
  const mismatches = diagnoseMismatches(refSegments, detSegments, [], { audioDuration });
  assert.equal(mismatches.length, 0, 'No mismatches should occur within valid recording duration');
});

test('Synthetic Test 9: Classification distinction (chord vs labelled N.C. vs omitted vs out_of_bounds)', () => {
  const audioDuration = 3.0;

  const segments = [
    { startTime: 0.0, endTime: 1.0, chord: 'C Major', root: 'C', quality: 'major' },
    { startTime: 1.0, endTime: 2.0, chord: 'N.C.', root: null, quality: 'none' }
    // Note: 2.0s to 3.0s has NO segment (omitted by detector)
  ];

  // 1. Actual audio labelled as chord
  const sChord = sampleSegmentAtTime(segments, 0.5, audioDuration);
  assert.equal(sChord.status, 'chord');
  assert.equal(sChord.chord, 'C Major');

  // 2. Actual audio labelled as N.C.
  const sLabelledNc = sampleSegmentAtTime(segments, 1.5, audioDuration);
  assert.equal(sLabelledNc.status, 'labelled_nc');
  assert.equal(sLabelledNc.chord, 'N.C.');

  // 3. Audio within recording omitted by detector
  const sOmitted = sampleSegmentAtTime(segments, 2.5, audioDuration);
  assert.equal(sOmitted.status, 'omitted');
  assert.equal(sOmitted.chord, 'N.C.');

  // 4. Time beyond the actual recording (must not be scored)
  const sOutOfBounds = sampleSegmentAtTime(segments, 3.5, audioDuration);
  assert.equal(sOutOfBounds.status, 'out_of_bounds');

  // Negative time is also out of bounds
  const sNegative = sampleSegmentAtTime(segments, -0.1, audioDuration);
  assert.equal(sNegative.status, 'out_of_bounds');

  // computeChordMetrics reports omitted time
  const ref = [
    { startTime: 0.0, endTime: 1.0, chord: 'C Major', root: 'C', quality: 'major' },
    { startTime: 1.0, endTime: 2.0, chord: 'N.C.', root: null, quality: 'none' },
    { startTime: 2.0, endTime: 3.0, chord: 'G Major', root: 'G', quality: 'major' }
  ];

  const metrics = computeChordMetrics(ref, segments, { audioDuration });
  assert.equal(metrics.omittedTimeSec, 1.0);
  assert.ok(Math.abs(metrics.omittedPercentage - 33.33) < 0.1);
});
