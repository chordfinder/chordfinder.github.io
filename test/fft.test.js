import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createHannWindow,
  radix2FFT,
  FFTAnalyzer,
  nextPowerOfTwo
} from '../src/js/chord-engine/fft.js';

test('1. FFT: Hann Window generation', () => {
  const size = 1024;
  const win = createHannWindow(size);
  assert.equal(win.length, size);

  // Hann window starts and ends near 0, and peaks at 1.0 in the center
  assert.ok(Math.abs(win[0]) < 1e-4);
  assert.ok(Math.abs(win[size - 1]) < 1e-4);
  assert.ok(Math.abs(win[size / 2] - 1.0) < 1e-3);

  // Symmetry check
  for (let i = 0; i < size / 2; i++) {
    assert.ok(Math.abs(win[i] - win[size - 1 - i]) < 1e-5);
  }
});

test('2. FFT: Radix-2 FFT on Pure Sinusoid Signal', () => {
  const N = 1024;
  const sampleRate = 44100;
  const targetFreq = 440; // Hz
  const expectedBin = Math.round((targetFreq * N) / sampleRate); // Bin ~ 10

  const real = new Float32Array(N);
  const imag = new Float32Array(N);

  for (let n = 0; n < N; n++) {
    real[n] = Math.sin((2 * Math.PI * targetFreq * n) / sampleRate);
    imag[n] = 0;
  }

  radix2FFT(real, imag);

  // Calculate magnitudes
  let maxMag = 0;
  let peakBin = -1;
  for (let k = 0; k < N / 2; k++) {
    const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
    if (mag > maxMag) {
      maxMag = mag;
      peakBin = k;
    }
  }

  // Peak must be within 1 bin of the expected theoretical bin
  assert.ok(Math.abs(peakBin - expectedBin) <= 1, `Peak bin was ${peakBin}, expected ${expectedBin}`);
});

test('3. FFTAnalyzer: Reusable Analyzer with Windowing', () => {
  const frameSize = 2048;
  const sampleRate = 44100;
  const analyzer = new FFTAnalyzer(frameSize);

  // Test with 1000 Hz tone
  const freq = 1000;
  const signal = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    signal[i] = Math.cos((2 * Math.PI * freq * i) / sampleRate);
  }

  const magnitudes = analyzer.analyze(signal);
  assert.equal(magnitudes.length, frameSize / 2);

  let peakBin = 0;
  let peakVal = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    if (magnitudes[i] > peakVal) {
      peakVal = magnitudes[i];
      peakBin = i;
    }
  }

  const detectedFreq = (peakBin * sampleRate) / frameSize;
  assert.ok(Math.abs(detectedFreq - freq) < (sampleRate / frameSize) * 1.5,
    `Detected freq ${detectedFreq} Hz should be close to ${freq} Hz`);
});

test('4. FFT: Power of two validation', () => {
  assert.equal(nextPowerOfTwo(1000), 1024);
  assert.equal(nextPowerOfTwo(2048), 2048);
  assert.equal(nextPowerOfTwo(8000), 8192);

  assert.throws(() => {
    new FFTAnalyzer(500); // Not power of 2
  });
});
