import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHROMA_BINS,
  computeRmsEnergy,
  extractFrameChroma,
  extractChromagram
} from '../src/js/chord-engine/chromagram.js';

test('1. Chromagram: RMS energy computation', () => {
  const silent = new Float32Array(1024);
  assert.equal(computeRmsEnergy(silent), 0);

  // Sine wave amplitude 1.0 has RMS = 1 / sqrt(2) ~= 0.707
  const sine = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    sine[i] = Math.sin((2 * Math.PI * 440 * i) / 44100);
  }
  const rms = computeRmsEnergy(sine);
  assert.ok(Math.abs(rms - 0.707) < 0.05);
});

test('2. Chromagram: Silence rejection', () => {
  const silentFrame = new Float32Array(8192);
  const result = extractFrameChroma(silentFrame, 44100);

  assert.equal(result.isSilent, true);
  assert.equal(result.chroma.length, CHROMA_BINS);
  for (let i = 0; i < CHROMA_BINS; i++) {
    assert.equal(result.chroma[i], 0);
  }
});

test('3. Chromagram: Single Note Extraction (A4 = 440 Hz -> Pitch Class A / Bin 9)', () => {
  const frameSize = 8192;
  const sampleRate = 44100;
  const signal = new Float32Array(frameSize);

  for (let i = 0; i < frameSize; i++) {
    signal[i] = Math.sin((2 * Math.PI * 440.0 * i) / sampleRate);
  }

  const result = extractFrameChroma(signal, sampleRate);
  assert.equal(result.isSilent, false);

  // Find max bin in chroma vector
  let maxBin = 0;
  let maxVal = 0;
  for (let i = 0; i < CHROMA_BINS; i++) {
    if (result.chroma[i] > maxVal) {
      maxVal = result.chroma[i];
      maxBin = i;
    }
  }

  // Pitch class A is index 9 (C=0, C#=1, D=2, D#=3, E=4, F=5, F#=6, G=7, G#=8, A=9, A#=10, B=11)
  assert.equal(maxBin, 9, `Expected max chroma bin 9 (A), got bin ${maxBin}`);
  assert.ok(result.chroma[9] > 0.8, 'Bin 9 should hold majority of normalized energy');
});

test('4. Chromagram: Synthetic C Major Triad (C4, E4, G4)', () => {
  const frameSize = 8192;
  const sampleRate = 44100;
  const signal = new Float32Array(frameSize);

  const freqC4 = 261.63;
  const freqE4 = 329.63;
  const freqG4 = 392.00;

  for (let i = 0; i < frameSize; i++) {
    signal[i] =
      Math.sin((2 * Math.PI * freqC4 * i) / sampleRate) +
      Math.sin((2 * Math.PI * freqE4 * i) / sampleRate) +
      Math.sin((2 * Math.PI * freqG4 * i) / sampleRate);
  }

  const result = extractFrameChroma(signal, sampleRate);
  assert.equal(result.isSilent, false);

  // Check that C(0), E(4), and G(7) are the 3 highest bins
  const sortedBins = Array.from(result.chroma)
    .map((val, idx) => ({ idx, val }))
    .sort((a, b) => b.val - a.val);

  const top3Indices = sortedBins.slice(0, 3).map(b => b.idx).sort();
  assert.deepEqual(top3Indices, [0, 4, 7], `Top 3 bins should be [0, 4, 7], got ${JSON.stringify(top3Indices)}`);
});

test('5. Chromagram: Synthetic A Minor Triad (A3, C4, E4)', () => {
  const frameSize = 8192;
  const sampleRate = 44100;
  const signal = new Float32Array(frameSize);

  const freqA3 = 220.00;
  const freqC4 = 261.63;
  const freqE4 = 329.63;

  for (let i = 0; i < frameSize; i++) {
    signal[i] =
      Math.sin((2 * Math.PI * freqA3 * i) / sampleRate) +
      Math.sin((2 * Math.PI * freqC4 * i) / sampleRate) +
      Math.sin((2 * Math.PI * freqE4 * i) / sampleRate);
  }

  const result = extractFrameChroma(signal, sampleRate);
  assert.equal(result.isSilent, false);

  // Check that A(9), C(0), and E(4) are the 3 highest bins
  const sortedBins = Array.from(result.chroma)
    .map((val, idx) => ({ idx, val }))
    .sort((a, b) => b.val - a.val);

  const top3Indices = sortedBins.slice(0, 3).map(b => b.idx).sort();
  assert.deepEqual(top3Indices, [0, 4, 9], `Top 3 bins should be [0, 4, 9], got ${JSON.stringify(top3Indices)}`);
});

test('6. Chromagram: Asynchronous extractChromagram with progress', async () => {
  const sampleRate = 44100;
  const durationSec = 0.5; // ~22050 samples -> ~4 frames with hop 4096
  const totalSamples = Math.floor(sampleRate * durationSec);
  const audio = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    audio[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }

  let progressCalled = false;
  const frames = await extractChromagram(audio, sampleRate, {
    frameSize: 8192,
    hopSize: 4096,
    onProgress: (p) => {
      assert.ok(p >= 0 && p <= 1);
      progressCalled = true;
    }
  });

  assert.ok(frames.length > 0);
  assert.ok(progressCalled);
  assert.equal(frames[0].time, 0);
});
