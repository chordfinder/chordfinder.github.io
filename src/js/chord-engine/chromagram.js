/**
 * ChordFinder - Chromagram Feature Extraction
 * Extracts 12-dimensional pitch class energy vectors (Chroma) from audio signals
 * using FFT with parabolic spectral peak interpolation to eliminate main-lobe leakage.
 */

import { FFTAnalyzer } from './fft.js';
import { frequencyToMidi, PITCH_CLASSES } from './note-pitch.js';

export const CHROMA_BINS = 12;

export const DEFAULT_CHROMA_OPTIONS = {
  frameSize: 8192,
  hopSize: 4096,
  minFrequency: 50.0,    // G#1/A1 boundary (~50 Hz) to safely capture A1 (55 Hz) without boundary truncation
  maxFrequency: 2100.0,  // C7 (~2093 Hz)
  silenceThreshold: 0.005,
  peakThresholdRatio: 0.04, // Local peak must be >= 4% of spectral max peak
  splitFrequency: 260.0,    // Split frequency between bass register and mid/treble accompaniment
  globalFloorRatio: 0.005,  // Absolute noise floor relative to overall spectrum max (prevent noise pick in quiet band)
  octaveCenterMidi: 60,     // C4 (Middle C)
  octaveSpread: 24          // Semitone standard deviation for octave weighting
};

/**
 * Computes root-mean-square (RMS) energy of an audio frame.
 * @param {Float32Array|Array<number>} frame
 * @returns {number}
 */
export function computeRmsEnergy(frame) {
  let sum = 0;
  const len = frame.length;
  for (let i = 0; i < len; i++) {
    const val = frame[i];
    sum += val * val;
  }
  return Math.sqrt(sum / Math.max(1, len));
}

/**
 * Extracts a normalized 12-bin chroma vector from a single time-domain frame
 * using parabolic peak interpolation to prevent spectral leakage between adjacent semitones.
 *
 * @param {Float32Array|Array<number>} timeDomainFrame - Audio samples of length options.frameSize
 * @param {number} sampleRate - e.g. 22050, 44100, 48000
 * @param {FFTAnalyzer} [analyzer] - Optional reusable FFTAnalyzer instance
 * @param {object} [customOptions] - Parameter overrides
 * @returns {{ chroma: Float32Array, rms: number, isSilent: boolean, spectralPeaks: Array<{ frequency: number, note: string, pitchClass: string, midi: number, magnitude: number }> }}
 */
export function extractFrameChroma(timeDomainFrame, sampleRate, analyzer = null, customOptions = {}) {
  const options = { ...DEFAULT_CHROMA_OPTIONS, ...customOptions };
  const frameSize = options.frameSize;
  const fft = analyzer || new FFTAnalyzer(frameSize);

  const rms = computeRmsEnergy(timeDomainFrame);
  const chroma = new Float32Array(CHROMA_BINS);

  if (rms < options.silenceThreshold) {
    return { chroma, rms, isSilent: true, spectralPeaks: [] };
  }

  const magnitudes = fft.analyze(timeDomainFrame);
  const halfSize = magnitudes.length;
  const freqResolution = sampleRate / frameSize;

  const minBin = Math.max(2, Math.floor(options.minFrequency / freqResolution));
  const maxBin = Math.min(halfSize - 3, Math.ceil(options.maxFrequency / freqResolution));
  const splitBin = Math.min(maxBin, Math.max(minBin, Math.round(options.splitFrequency / freqResolution)));

  // Adaptive Multi-Band Peak Thresholding:
  // Compute separate peak maximums for low (bass) and mid/treble bands so loud bass
  // fundamentals do not suppress quieter chord accompaniment tones.
  let maxMagLow = 0;
  for (let k = minBin; k < splitBin; k++) {
    if (magnitudes[k] > maxMagLow) maxMagLow = magnitudes[k];
  }

  let maxMagMid = 0;
  for (let k = splitBin; k <= maxBin; k++) {
    if (magnitudes[k] > maxMagMid) maxMagMid = magnitudes[k];
  }

  const globalMax = Math.max(maxMagLow, maxMagMid);
  if (globalMax < 1e-5) {
    return { chroma, rms, isSilent: true, spectralPeaks: [] };
  }

  const globalFloor = Math.max(1e-4, globalMax * (options.globalFloorRatio || 0.005));
  const lowThreshold = Math.max(globalFloor, maxMagLow * options.peakThresholdRatio);
  const midThreshold = Math.max(globalFloor, maxMagMid * options.peakThresholdRatio);

  let peaksFound = 0;
  const detectedPeaks = [];

  // Parabolic peak picking across spectrum to eliminate main-lobe leakage
  for (let k = minBin; k <= maxBin; k++) {
    const mag = magnitudes[k];
    const peakThreshold = k < splitBin ? lowThreshold : midThreshold;

    if (mag > peakThreshold && mag > magnitudes[k - 1] && mag > magnitudes[k + 1]) {
      const alpha = magnitudes[k - 1];
      const beta = mag;
      const gamma = magnitudes[k + 1];

      // Parabolic peak interpolation
      const denom = alpha - 2 * beta + gamma;
      const delta = Math.abs(denom) > 1e-7 ? 0.5 * (alpha - gamma) / denom : 0;
      const interpBin = k + delta;
      const peakFreq = interpBin * freqResolution;

      if (peakFreq >= options.minFrequency && peakFreq <= options.maxFrequency) {
        const midiPitch = frequencyToMidi(peakFreq);
        const roundedMidi = Math.round(midiPitch);
        const pitchClass = ((roundedMidi % 12) + 12) % 12;

        // Octave weighting centered around middle register
        const octaveWeight = Math.exp(-0.5 * Math.pow((midiPitch - options.octaveCenterMidi) / options.octaveSpread, 2));
        
        // Log-compressed peak magnitude
        const weight = Math.log1p(beta) * octaveWeight;
        chroma[pitchClass] += weight;
        peaksFound++;

        detectedPeaks.push({
          frequency: parseFloat(peakFreq.toFixed(1)),
          note: `${PITCH_CLASSES[pitchClass]}${Math.floor(roundedMidi / 12) - 1}`,
          pitchClass: PITCH_CLASSES[pitchClass],
          midi: parseFloat(midiPitch.toFixed(2)),
          magnitude: parseFloat(beta.toFixed(4))
        });
      }
    }
  }

  // Fallback: If no distinct peaks were identified, use direct bin accumulation
  if (peaksFound === 0) {
    for (let k = minBin; k <= maxBin; k++) {
      const freq = k * freqResolution;
      const mag = magnitudes[k];
      if (mag <= 1e-5) continue;

      const midiPitch = frequencyToMidi(freq);
      const roundedMidi = Math.round(midiPitch);
      const pitchOffset = Math.abs(midiPitch - roundedMidi);
      const semitoneWeight = Math.exp(-0.5 * Math.pow(pitchOffset / 0.35, 2));
      const octaveWeight = Math.exp(-0.5 * Math.pow((midiPitch - options.octaveCenterMidi) / options.octaveSpread, 2));

      const pitchClass = ((roundedMidi % 12) + 12) % 12;
      chroma[pitchClass] += Math.log1p(mag) * semitoneWeight * octaveWeight;
    }
  }

  // Normalize chroma vector with L2 norm
  let normSum = 0;
  for (let i = 0; i < CHROMA_BINS; i++) {
    normSum += chroma[i] * chroma[i];
  }
  const l2Norm = Math.sqrt(normSum);

  if (l2Norm > 1e-7) {
    for (let i = 0; i < CHROMA_BINS; i++) {
      chroma[i] /= l2Norm;
    }
  }

  detectedPeaks.sort((a, b) => b.magnitude - a.magnitude);
  const spectralPeaks = detectedPeaks.slice(0, 8);

  return { chroma, rms, isSilent: false, spectralPeaks };
}

/**
 * Extracts a sequence of chroma frames from a mono Float32Array audio buffer.
 * Supports asynchronous batched processing with progress updates.
 *
 * @param {Float32Array} monoAudioData
 * @param {number} sampleRate
 * @param {object} [options]
 * @param {function(number):void} [options.onProgress] - Optional progress callback (0.0 to 1.0)
 * @param {function():boolean} [options.checkCancelled] - Optional cancellation check
 * @returns {Promise<Array<{ time: number, chroma: Float32Array, rms: number, isSilent: boolean, spectralPeaks: Array<{ frequency: number, note: string, pitchClass: string, midi: number, magnitude: number }> }>>}
 */
export async function extractChromagram(monoAudioData, sampleRate, options = {}) {
  const config = { ...DEFAULT_CHROMA_OPTIONS, ...options };
  const { frameSize, hopSize } = config;
  const totalSamples = monoAudioData.length;

  if (totalSamples < frameSize) {
    // Audio is shorter than a single analysis frame
    const singleSlice = new Float32Array(frameSize);
    singleSlice.set(monoAudioData);
    const result = extractFrameChroma(singleSlice, sampleRate, null, config);
    return [{
      time: 0,
      chroma: result.chroma,
      rms: result.rms,
      isSilent: result.isSilent,
      spectralPeaks: result.spectralPeaks || []
    }];
  }

  const numFrames = Math.floor((totalSamples - frameSize) / hopSize) + 1;
  const frames = [];
  const analyzer = new FFTAnalyzer(frameSize);
  const frameBuffer = new Float32Array(frameSize);

  const BATCH_SIZE = 40; // Process 40 frames before yielding to main thread

  for (let f = 0; f < numFrames; f++) {
    if (config.checkCancelled && config.checkCancelled()) {
      throw new Error('Analysis cancelled by user.');
    }

    const startSample = f * hopSize;
    frameBuffer.set(monoAudioData.subarray(startSample, startSample + frameSize));
    const time = startSample / sampleRate;

    const frameResult = extractFrameChroma(frameBuffer, sampleRate, analyzer, config);
    frames.push({
      time,
      chroma: frameResult.chroma,
      rms: frameResult.rms,
      isSilent: frameResult.isSilent,
      spectralPeaks: frameResult.spectralPeaks || []
    });

    if (f % BATCH_SIZE === 0 || f === numFrames - 1) {
      if (typeof config.onProgress === 'function') {
        config.onProgress((f + 1) / numFrames);
      }
      // Yield to browser event loop
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return frames;
}
