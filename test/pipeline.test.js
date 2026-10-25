import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractChromagram } from '../src/js/chord-engine/chromagram.js';
import { matchChord, segmentChords } from '../src/js/chord-engine/chord-matcher.js';

test('End-to-End Pipeline: Synthetic C Major followed by A Minor', async () => {
  const sampleRate = 44100;
  const durationSec = 3.0;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const audio = new Float32Array(totalSamples);

  // Frequencies
  const c4 = 261.63;
  const e4 = 329.63;
  const g4 = 392.00;
  const a3 = 220.00;

  const splitSample = Math.floor(totalSamples / 2); // 1.5 seconds

  // Section 1: C Major (C4 + E4 + G4)
  for (let i = 0; i < splitSample; i++) {
    audio[i] =
      0.25 * Math.sin((2 * Math.PI * c4 * i) / sampleRate) +
      0.25 * Math.sin((2 * Math.PI * e4 * i) / sampleRate) +
      0.25 * Math.sin((2 * Math.PI * g4 * i) / sampleRate);
  }

  // Section 2: A Minor (A3 + C4 + E4)
  for (let i = splitSample; i < totalSamples; i++) {
    audio[i] =
      0.25 * Math.sin((2 * Math.PI * a3 * i) / sampleRate) +
      0.25 * Math.sin((2 * Math.PI * c4 * i) / sampleRate) +
      0.25 * Math.sin((2 * Math.PI * e4 * i) / sampleRate);
  }

  // Extract chromagram
  const frameSize = 8192;
  const hopSize = 4096;
  const hopDuration = hopSize / sampleRate;

  const chromaFrames = await extractChromagram(audio, sampleRate, {
    frameSize,
    hopSize
  });

  assert.ok(chromaFrames.length >= 10);

  // Match chords for each frame
  const framePredictions = chromaFrames.map(f => {
    const match = matchChord(f.chroma);
    return {
      time: f.time,
      chord: match.chord,
      shortName: match.shortName,
      root: match.root,
      quality: match.quality,
      score: match.score,
      isSilent: f.isSilent
    };
  });

  // Verify first frame is C Major and last frame is A Minor
  assert.equal(framePredictions[0].chord, 'C Major');
  assert.equal(framePredictions[framePredictions.length - 1].chord, 'A Minor');

  // Segment chords
  const segments = segmentChords(framePredictions, hopDuration, { minSegmentDuration: 0.4 });

  assert.ok(segments.length >= 2, `Expected at least 2 segments, got ${segments.length}`);
  assert.equal(segments[0].chord, 'C Major');
  assert.equal(segments[segments.length - 1].chord, 'A Minor');

  // Verify approximate timestamps: C Major starts at 0, A Minor ends at ~3.0
  assert.equal(segments[0].startTime, 0.0);
  assert.ok(segments[segments.length - 1].endTime >= 2.8);
});
