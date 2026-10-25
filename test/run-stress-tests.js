/**
 * ChordFinder - Synthetic Stress Test Suite (Phase 2.3 Task 1)
 *
 * Implements reproducible synthetic stress tests covering 10 distinct categories
 * with known ground-truth pitches, chord labels, and transition times.
 *
 * Strict Requirement: Synthetic benchmark results must never be presented as real-recording accuracy.
 */

import { extractFrameChroma, extractChromagram } from '../src/js/chord-engine/chromagram.js';
import { matchChord, segmentChords } from '../src/js/chord-engine/chord-matcher.js';
import { midiToFrequency, PITCH_CLASSES } from '../src/js/chord-engine/note-pitch.js';

const SR = 44100;
const FRAME_SIZE = 8192;
const HOP_SIZE = 4096;

/**
 * Synthesizes a frame with specified frequency components.
 * @param {Array<{ freq: number, amp: number, phase?: number }>} components
 * @param {number} length
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
export function synthesizeFrame(components, length = FRAME_SIZE, sampleRate = SR) {
  const frame = new Float32Array(length);
  for (const comp of components) {
    const f = comp.freq;
    const a = comp.amp;
    const ph = comp.phase || 0;
    const omega = (2 * Math.PI * f) / sampleRate;
    for (let i = 0; i < length; i++) {
      frame[i] += a * Math.sin(omega * i + ph);
    }
  }
  return frame;
}

/**
 * Adds white uniform noise to a frame for a specified target SNR in dB.
 * @param {Float32Array} frame
 * @param {number} snrDb
 * @returns {Float32Array}
 */
export function addNoise(frame, snrDb) {
  const noisy = new Float32Array(frame.length);
  let signalPower = 0;
  for (let i = 0; i < frame.length; i++) {
    signalPower += frame[i] * frame[i];
  }
  signalPower /= Math.max(1, frame.length);

  const noisePower = signalPower / Math.pow(10, snrDb / 10);
  const noiseAmp = Math.sqrt(noisePower * 3);

  let seed = 123456789;
  function lcg() {
    seed = (1103515245 * seed + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  }

  for (let i = 0; i < frame.length; i++) {
    noisy[i] = frame[i] + lcg() * noiseAmp;
  }
  return noisy;
}

/**
 * Runs all 10 stress test categories and collects detailed quantitative results.
 */
export async function runAllStressTests() {
  const results = {
    category1: { name: '1. Major/Minor Chords with Unbalanced Amplitudes', passed: 0, total: 0, details: [] },
    category2: { name: '2. Chords with Strong 2nd, 3rd, and 5th Harmonics', passed: 0, total: 0, details: [] },
    category3: { name: '3. Low Bass Notes with Quieter Chord Tones', passed: 0, total: 0, details: [] },
    category4: { name: '4. Octaves and Inversions', passed: 0, total: 0, details: [] },
    category5: { name: '5. Chords Mixed with Independent Bass Notes', passed: 0, total: 0, details: [] },
    category6: { name: '6. Chords Mixed with Moderate Broadband Noise', passed: 0, total: 0, details: [] },
    category7: { name: '7. Short Percussive Transients within Chords', passed: 0, total: 0, details: [] },
    category8: { name: '8. Overlapping Windows at Chord Transitions', passed: 0, total: 0, details: [] },
    category9: { name: '9. Low-Register Semitone Discrimination', passed: 0, total: 0, details: [] },
    category10: { name: '10. Silence and Incomplete-Note Rejection', passed: 0, total: 0, details: [] }
  };

  // =========================================================================
  // Category 1: Major and Minor Chords with Different Fundamental Amplitudes
  // =========================================================================
  {
    const cat = results.category1;
    const testCases = [
      { chord: 'C Major', midi: [60, 64, 67], profile: 'Loud Root (0.6, 0.1, 0.25)', amps: [0.60, 0.10, 0.25] },
      { chord: 'C Major', midi: [60, 64, 67], profile: 'Quiet Root (0.09, 0.50, 0.40)', amps: [0.09, 0.50, 0.40] },
      { chord: 'C Major', midi: [60, 64, 67], profile: 'Quiet 3rd (0.45, 0.08, 0.45)', amps: [0.45, 0.08, 0.45] },
      { chord: 'C Major', midi: [60, 64, 67], profile: 'Quiet 5th (0.45, 0.45, 0.08)', amps: [0.45, 0.45, 0.08] },
      { chord: 'A Minor', midi: [57, 60, 64], profile: 'Loud Root (0.65, 0.12, 0.22)', amps: [0.65, 0.12, 0.22] },
      { chord: 'A Minor', midi: [57, 60, 64], profile: 'Quiet Minor 3rd (0.50, 0.08, 0.40)', amps: [0.50, 0.08, 0.40] },
      { chord: 'D Minor', midi: [62, 65, 69], profile: 'Quiet 5th (0.45, 0.45, 0.09)', amps: [0.45, 0.45, 0.09] },
      { chord: 'G Major', midi: [55, 59, 62], profile: 'Loud 3rd (0.15, 0.65, 0.20)', amps: [0.15, 0.65, 0.20] },
      { chord: 'E Minor', midi: [52, 55, 59], profile: 'Disparate (0.55, 0.10, 0.35)', amps: [0.55, 0.10, 0.35] },
      { chord: 'F Major', midi: [53, 57, 60], profile: 'Disparate (0.12, 0.60, 0.25)', amps: [0.12, 0.60, 0.25] },
      // Extreme amplitude disparity: 3rd is very quiet (0.04) vs root 0.60
      { chord: 'C Major', midi: [60, 64, 67], profile: 'Extreme Quiet 3rd (0.60, 0.04, 0.35)', amps: [0.60, 0.04, 0.35] },
      { chord: 'A Minor', midi: [57, 60, 64], profile: 'Extreme Quiet 3rd (0.60, 0.04, 0.35)', amps: [0.60, 0.04, 0.35] }
    ];

    for (const tc of testCases) {
      cat.total++;
      const comps = tc.midi.map((m, idx) => ({ freq: midiToFrequency(m), amp: tc.amps[idx] }));
      const frame = synthesizeFrame(comps);
      const chroma = extractFrameChroma(frame, SR);
      const match = matchChord(chroma.chroma);
      const pass = match.chord === tc.chord && match.isConfident;
      if (pass) cat.passed++;
      cat.details.push({
        case: `${tc.chord} [${tc.profile}]`,
        expected: tc.chord,
        detected: match.chord,
        score: match.score,
        pass
      });
    }
  }

  // =========================================================================
  // Category 2: Chords with Strong 2nd, 3rd, and 5th Harmonics
  // =========================================================================
  {
    const cat = results.category2;
    const testCases = [
      { name: 'C Major Moderate Harmonics', rootMidi: 60, quality: 'major', hAmps: [0.28, 0.16, 0.12, 0.08, 0.06], expected: 'C Major' },
      { name: 'C Minor Moderate Harmonics', rootMidi: 60, quality: 'minor', hAmps: [0.28, 0.16, 0.12, 0.08, 0.06], expected: 'C Minor' },
      { name: 'G Major Rich Harmonics', rootMidi: 55, quality: 'major', hAmps: [0.28, 0.16, 0.12, 0.08, 0.06], expected: 'G Major' },
      { name: 'G Minor Rich Harmonics', rootMidi: 55, quality: 'minor', hAmps: [0.28, 0.16, 0.12, 0.08, 0.06], expected: 'G Minor' },
      { name: 'A Minor Rich Harmonics', rootMidi: 57, quality: 'minor', hAmps: [0.28, 0.16, 0.12, 0.08, 0.06], expected: 'A Minor' },
      { name: 'E Minor Rich Harmonics', rootMidi: 52, quality: 'minor', hAmps: [0.28, 0.16, 0.12, 0.08, 0.06], expected: 'E Minor' },
      { name: 'D Major Rich Harmonics', rootMidi: 62, quality: 'major', hAmps: [0.28, 0.16, 0.12, 0.08, 0.06], expected: 'D Major' },
      { name: 'D Minor Rich Harmonics', rootMidi: 62, quality: 'minor', hAmps: [0.28, 0.16, 0.12, 0.08, 0.06], expected: 'D Minor' },
      { name: 'F Major Rich Harmonics', rootMidi: 53, quality: 'major', hAmps: [0.28, 0.16, 0.12, 0.08, 0.06], expected: 'F Major' },
      { name: 'B Minor Rich Harmonics', rootMidi: 59, quality: 'minor', hAmps: [0.28, 0.16, 0.12, 0.08, 0.06], expected: 'B Minor' },
      // Aggressive 5th harmonic (0.16 on root): generates overtone E natural in C Minor!
      { name: 'C Minor Heavy 5th Harmonic (E overtone vs Eb note)', rootMidi: 60, quality: 'minor', hAmps: [0.25, 0.16, 0.14, 0.10, 0.14], expected: 'C Minor' },
      { name: 'A Minor Heavy 5th Harmonic (C# overtone vs C note)', rootMidi: 57, quality: 'minor', hAmps: [0.25, 0.16, 0.14, 0.10, 0.14], expected: 'A Minor' }
    ];

    for (const tc of testCases) {
      cat.total++;
      const midis = tc.quality === 'major'
        ? [tc.rootMidi, tc.rootMidi + 4, tc.rootMidi + 7]
        : [tc.rootMidi, tc.rootMidi + 3, tc.rootMidi + 7];

      const comps = [];
      for (const m of midis) {
        const f0 = midiToFrequency(m);
        comps.push({ freq: f0, amp: tc.hAmps[0] });
        comps.push({ freq: 2 * f0, amp: tc.hAmps[1] }); // 2nd (octave)
        comps.push({ freq: 3 * f0, amp: tc.hAmps[2] }); // 3rd (octave + 5th)
        comps.push({ freq: 4 * f0, amp: tc.hAmps[3] }); // 4th (2 octaves)
        comps.push({ freq: 5 * f0, amp: tc.hAmps[4] }); // 5th (2 octaves + major 3rd)
      }

      const frame = synthesizeFrame(comps);
      const chroma = extractFrameChroma(frame, SR);
      const match = matchChord(chroma.chroma);
      const pass = match.chord === tc.expected && match.isConfident;
      if (pass) cat.passed++;
      cat.details.push({
        case: tc.name,
        expected: tc.expected,
        detected: match.chord,
        score: match.score,
        pass
      });
    }
  }

  // =========================================================================
  // Category 3: Low-Frequency Bass Notes Combined with Quieter Chord Tones
  // =========================================================================
  {
    const cat = results.category3;
    const testCases = [
      { name: 'C Major with loud C2 (65Hz) bass (ratio 5:1)', bassMidi: 36, triadMidi: [60, 64, 67], bassAmp: 0.60, triadAmp: 0.12, expected: 'C Major' },
      { name: 'C Major with loud C2 (65Hz) bass (ratio 8:1)', bassMidi: 36, triadMidi: [60, 64, 67], bassAmp: 0.65, triadAmp: 0.08, expected: 'C Major' },
      { name: 'C Major with very loud C2 bass (ratio 12:1)', bassMidi: 36, triadMidi: [60, 64, 67], bassAmp: 0.72, triadAmp: 0.06, expected: 'C Major' },
      // Severe acoustic masking: Bass 0.85, chord tones 0.03 (ratio 28:1)
      { name: 'C Major with dominant C2 bass (ratio 28:1)', bassMidi: 36, triadMidi: [60, 64, 67], bassAmp: 0.85, triadAmp: 0.03, expected: 'C Major' },
      { name: 'A Minor with loud A1 (55Hz) bass (ratio 6:1)', bassMidi: 33, triadMidi: [57, 60, 64], bassAmp: 0.60, triadAmp: 0.10, expected: 'A Minor' },
      { name: 'A Minor with loud A1 (55Hz) bass (ratio 10:1)', bassMidi: 33, triadMidi: [57, 60, 64], bassAmp: 0.70, triadAmp: 0.07, expected: 'A Minor' },
      // Severe acoustic masking in A Minor: Bass A1 0.85, chord tones 0.03
      { name: 'A Minor with dominant A1 bass (ratio 28:1)', bassMidi: 33, triadMidi: [57, 60, 64], bassAmp: 0.85, triadAmp: 0.03, expected: 'A Minor' },
      { name: 'G Major with loud G2 (98Hz) bass (ratio 7:1)', bassMidi: 43, triadMidi: [55, 59, 62], bassAmp: 0.63, triadAmp: 0.09, expected: 'G Major' },
      { name: 'E Minor with loud E2 (82Hz) bass (ratio 6:1)', bassMidi: 40, triadMidi: [52, 55, 59], bassAmp: 0.60, triadAmp: 0.10, expected: 'E Minor' },
      { name: 'D Major with loud D2 (73Hz) bass (ratio 8:1)', bassMidi: 38, triadMidi: [62, 66, 69], bassAmp: 0.64, triadAmp: 0.08, expected: 'D Major' }
    ];

    for (const tc of testCases) {
      cat.total++;
      const comps = [
        { freq: midiToFrequency(tc.bassMidi), amp: tc.bassAmp },
        ...tc.triadMidi.map(m => ({ freq: midiToFrequency(m), amp: tc.triadAmp }))
      ];
      const frame = synthesizeFrame(comps);
      const chroma = extractFrameChroma(frame, SR);
      const match = matchChord(chroma.chroma);
      const pass = match.chord === tc.expected && match.isConfident;
      if (pass) cat.passed++;
      cat.details.push({
        case: tc.name,
        expected: tc.expected,
        detected: match.chord,
        score: match.score,
        reason: match.reason || 'none',
        pass
      });
    }
  }

  // =========================================================================
  // Category 4: Chords Played in Different Octaves and Inversions
  // =========================================================================
  {
    const cat = results.category4;
    const testCases = [
      { name: 'C Major Root Position (C4-E4-G4)', midis: [60, 64, 67], expected: 'C Major' },
      { name: 'C Major 1st Inversion (E3-G3-C4)', midis: [52, 55, 60], expected: 'C Major' },
      { name: 'C Major 2nd Inversion (G3-C4-E4)', midis: [55, 60, 64], expected: 'C Major' },
      { name: 'C Major Open Voicing (C2-G3-E4)', midis: [36, 55, 64], expected: 'C Major' },
      { name: 'A Minor Root Position (A3-C4-E4)', midis: [57, 60, 64], expected: 'A Minor' },
      { name: 'A Minor 1st Inversion (C4-E4-A4)', midis: [60, 64, 69], expected: 'A Minor' },
      { name: 'A Minor 2nd Inversion (E3-A3-C4)', midis: [52, 57, 60], expected: 'A Minor' },
      { name: 'G Major 1st Inversion (B2-D3-G3)', midis: [47, 50, 55], expected: 'G Major' },
      { name: 'D Major 2nd Inversion (A3-D4-F#4)', midis: [57, 62, 66], expected: 'D Major' },
      { name: 'F Major Open Voicing (F2-C4-A4)', midis: [41, 60, 69], expected: 'F Major' }
    ];

    for (const tc of testCases) {
      cat.total++;
      const comps = tc.midis.map(m => ({ freq: midiToFrequency(m), amp: 0.28 }));
      const frame = synthesizeFrame(comps);
      const chroma = extractFrameChroma(frame, SR);
      const match = matchChord(chroma.chroma);
      const pass = match.chord === tc.expected && match.isConfident;
      if (pass) cat.passed++;
      cat.details.push({
        case: tc.name,
        expected: tc.expected,
        detected: match.chord,
        score: match.score,
        pass
      });
    }
  }

  // =========================================================================
  // Category 5: A Chord Mixed with an Independent Bass Note
  // =========================================================================
  {
    const cat = results.category5;
    const testCases = [
      { name: 'C Major / E bass (C/E 1st inversion slash chord)', bassMidi: 40, triadMidi: [60, 64, 67], expected: 'C Major' },
      { name: 'C Major / G bass (C/G 2nd inversion slash chord)', bassMidi: 43, triadMidi: [60, 64, 67], expected: 'C Major' },
      { name: 'G Major / B bass (G/B slash chord)', bassMidi: 47, triadMidi: [55, 59, 62], expected: 'G Major' },
      { name: 'F Major / A bass (F/A slash chord)', bassMidi: 45, triadMidi: [53, 57, 60], expected: 'F Major' },
      { name: 'D Major / F# bass (D/F# slash chord)', bassMidi: 42, triadMidi: [62, 66, 69], expected: 'D Major' },
      { name: 'A Minor / C bass (Am/C slash chord)', bassMidi: 48, triadMidi: [57, 60, 64], expected: 'A Minor' },
      { name: 'C Major with passing D2 bass (non-chord note, quiet)', bassMidi: 38, triadMidi: [60, 64, 67], bassAmp: 0.15, triadAmp: 0.30, expected: 'C Major' },
      { name: 'A Minor with passing G2 bass (quiet)', bassMidi: 43, triadMidi: [57, 60, 64], bassAmp: 0.15, triadAmp: 0.30, expected: 'A Minor' }
    ];

    for (const tc of testCases) {
      cat.total++;
      const bassAmp = tc.bassAmp || 0.35;
      const triadAmp = tc.triadAmp || 0.25;
      const comps = [
        { freq: midiToFrequency(tc.bassMidi), amp: bassAmp },
        ...tc.triadMidi.map(m => ({ freq: midiToFrequency(m), amp: triadAmp }))
      ];
      const frame = synthesizeFrame(comps);
      const chroma = extractFrameChroma(frame, SR);
      const match = matchChord(chroma.chroma);
      const pass = match.chord === tc.expected && match.isConfident;
      if (pass) cat.passed++;
      cat.details.push({
        case: tc.name,
        expected: tc.expected,
        detected: match.chord,
        score: match.score,
        pass
      });
    }
  }

  // =========================================================================
  // Category 6: A Chord Mixed with Moderate Broadband Noise
  // =========================================================================
  {
    const cat = results.category6;
    const testCases = [
      { chord: 'C Major', midis: [60, 64, 67], snrDb: 25, shouldDetect: true },
      { chord: 'C Major', midis: [60, 64, 67], snrDb: 18, shouldDetect: true },
      { chord: 'C Major', midis: [60, 64, 67], snrDb: 12, shouldDetect: true },
      { chord: 'C Major', midis: [60, 64, 67], snrDb: 8, shouldDetect: true },
      { chord: 'A Minor', midis: [57, 60, 64], snrDb: 20, shouldDetect: true },
      { chord: 'A Minor', midis: [57, 60, 64], snrDb: 14, shouldDetect: true },
      { chord: 'A Minor', midis: [57, 60, 64], snrDb: 9, shouldDetect: true },
      { chord: 'G Major', midis: [55, 59, 62], snrDb: 15, shouldDetect: true },
      { chord: 'D Minor', midis: [62, 65, 69], snrDb: 12, shouldDetect: true },
      { chord: 'C Major', midis: [60, 64, 67], snrDb: 0, shouldDetect: false, requireNcOrCorrect: true }
    ];

    for (const tc of testCases) {
      cat.total++;
      const comps = tc.midis.map(m => ({ freq: midiToFrequency(m), amp: 0.28 }));
      const cleanFrame = synthesizeFrame(comps);
      const noisyFrame = addNoise(cleanFrame, tc.snrDb);
      const chroma = extractFrameChroma(noisyFrame, SR);
      const match = matchChord(chroma.chroma);

      let pass = false;
      if (tc.shouldDetect) {
        pass = match.chord === tc.chord && match.isConfident;
      } else if (tc.requireNcOrCorrect) {
        pass = match.chord === tc.chord || match.chord === 'N.C.';
      }

      if (pass) cat.passed++;
      cat.details.push({
        case: `${tc.chord} @ SNR ${tc.snrDb} dB`,
        expected: tc.shouldDetect ? tc.chord : 'C Major or N.C.',
        detected: match.chord,
        score: match.score,
        pass
      });
    }
  }

  // =========================================================================
  // Category 7: Short Percussive Transients within Sustained Chords
  // =========================================================================
  {
    const cat = results.category7;
    // Test 1: 2.0s sustained C Major with multiple sharp transients (30ms clicks at 0.5s, 1.0s, 1.5s)
    {
      cat.total++;
      const totalDur = 2.0;
      const totalSamples = Math.floor(totalDur * SR);
      const audio = new Float32Array(totalSamples);

      for (let i = 0; i < totalSamples; i++) {
        audio[i] = 0.25 * Math.sin(2 * Math.PI * 261.63 * i / SR) +
                   0.25 * Math.sin(2 * Math.PI * 329.63 * i / SR) +
                   0.25 * Math.sin(2 * Math.PI * 392.00 * i / SR);
      }

      for (const tSec of [0.5, 1.0, 1.5]) {
        const cStart = Math.floor(tSec * SR);
        const cEnd = cStart + Math.floor(0.03 * SR);
        for (let i = cStart; i < cEnd; i++) {
          audio[i] += (Math.random() * 2 - 1) * 0.9;
        }
      }

      const frames = await extractChromagram(audio, SR, { frameSize: FRAME_SIZE, hopSize: HOP_SIZE });
      const preds = frames.map(f => {
        const m = matchChord(f.chroma);
        return { time: f.time, chord: m.chord, shortName: m.shortName, root: m.root, quality: m.quality, score: m.score, isSilent: f.isSilent };
      });
      const segments = segmentChords(preds, HOP_SIZE / SR, { minSegmentDuration: 0.4 });

      const pass = segments.length === 1 && segments[0].chord === 'C Major';
      if (pass) cat.passed++;
      cat.details.push({
        case: 'C Major with 3x 30ms drum clicks',
        expected: '1 segment: C Major',
        detected: `${segments.length} segments: ${segments.map(s => s.chord).join(', ')}`,
        pass
      });
    }

    // Test 2: 2.0s sustained A Minor with low-frequency kick drum thud (60 Hz burst)
    {
      cat.total++;
      const totalDur = 2.0;
      const totalSamples = Math.floor(totalDur * SR);
      const audio = new Float32Array(totalSamples);

      for (let i = 0; i < totalSamples; i++) {
        audio[i] = 0.25 * Math.sin(2 * Math.PI * 220.00 * i / SR) +
                   0.25 * Math.sin(2 * Math.PI * 261.63 * i / SR) +
                   0.25 * Math.sin(2 * Math.PI * 329.63 * i / SR);
      }

      const kStart = Math.floor(0.7 * SR);
      const kLen = Math.floor(0.08 * SR);
      for (let i = 0; i < kLen; i++) {
        const env = Math.exp(-i / (0.02 * SR));
        audio[kStart + i] += 0.8 * env * Math.sin(2 * Math.PI * 60 * i / SR);
      }

      const frames = await extractChromagram(audio, SR, { frameSize: FRAME_SIZE, hopSize: HOP_SIZE });
      const preds = frames.map(f => {
        const m = matchChord(f.chroma);
        return { time: f.time, chord: m.chord, shortName: m.shortName, root: m.root, quality: m.quality, score: m.score, isSilent: f.isSilent };
      });
      const segments = segmentChords(preds, HOP_SIZE / SR, { minSegmentDuration: 0.4 });

      const pass = segments.length === 1 && segments[0].chord === 'A Minor';
      if (pass) cat.passed++;
      cat.details.push({
        case: 'A Minor with 80ms kick drum thud',
        expected: '1 segment: A Minor',
        detected: `${segments.length} segments: ${segments.map(s => s.chord).join(', ')}`,
        pass
      });
    }
  }

  // =========================================================================
  // Category 8: Adjacent Chords with Overlapping Analysis Windows
  // =========================================================================
  {
    const cat = results.category8;
    cat.total++;
    const chordDur = 0.5;
    const totalSamples = Math.floor(4 * chordDur * SR);
    const audio = new Float32Array(totalSamples);

    const chords = [
      { name: 'C Major', midis: [60, 64, 67] },
      { name: 'G Major', midis: [55, 59, 62] },
      { name: 'A Minor', midis: [57, 60, 64] },
      { name: 'F Major', midis: [53, 57, 60] }
    ];

    for (let c = 0; c < 4; c++) {
      const start = Math.floor(c * chordDur * SR);
      const end = Math.floor((c + 1) * chordDur * SR);
      const freqs = chords[c].midis.map(m => midiToFrequency(m));
      for (let i = start; i < end; i++) {
        audio[i] = 0.25 * Math.sin(2 * Math.PI * freqs[0] * i / SR) +
                   0.25 * Math.sin(2 * Math.PI * freqs[1] * i / SR) +
                   0.25 * Math.sin(2 * Math.PI * freqs[2] * i / SR);
      }
    }

    const frames = await extractChromagram(audio, SR, { frameSize: FRAME_SIZE, hopSize: HOP_SIZE });
    const preds = frames.map(f => {
      const m = matchChord(f.chroma);
      return { time: f.time, chord: m.chord, shortName: m.shortName, root: m.root, quality: m.quality, score: m.score, isSilent: f.isSilent };
    });
    const segments = segmentChords(preds, HOP_SIZE / SR, { minSegmentDuration: 0.3 });
    const detectedNames = segments.map(s => s.chord);

    const expectedSequence = ['C Major', 'G Major', 'A Minor', 'F Major'];
    const pass = detectedNames.length === 4 &&
      detectedNames.every((name, idx) => name === expectedSequence[idx]);

    if (pass) cat.passed++;
    cat.details.push({
      case: 'Fast 0.5s Progression (C -> G -> Am -> F)',
      expected: expectedSequence.join(' -> '),
      detected: detectedNames.join(' -> '),
      pass
    });
  }

  // =========================================================================
  // Category 9: Low-Register Semitone Discrimination
  // =========================================================================
  {
    const cat = results.category9;
    const lowNotes = [
      { name: 'A1 (55.0 Hz)', midi: 33, expectedClass: 'A' },
      { name: 'Bb1 (58.3 Hz)', midi: 34, expectedClass: 'A#' },
      { name: 'B1 (61.7 Hz)', midi: 35, expectedClass: 'B' },
      { name: 'C2 (65.4 Hz)', midi: 36, expectedClass: 'C' },
      { name: 'D2 (73.4 Hz)', midi: 38, expectedClass: 'D' },
      { name: 'E2 (82.4 Hz)', midi: 40, expectedClass: 'E' }
    ];

    for (const ln of lowNotes) {
      cat.total++;
      const frame = synthesizeFrame([{ freq: midiToFrequency(ln.midi), amp: 0.5 }]);
      const chroma = extractFrameChroma(frame, SR);
      let maxBin = -1;
      let maxVal = -1;
      for (let i = 0; i < 12; i++) {
        if (chroma.chroma[i] > maxVal) {
          maxVal = chroma.chroma[i];
          maxBin = i;
        }
      }
      const detectedClass = maxBin >= 0 ? PITCH_CLASSES[maxBin] : 'none';
      const pass = detectedClass === ln.expectedClass;
      if (pass) cat.passed++;
      cat.details.push({
        case: `Low Single Note: ${ln.name}`,
        expected: ln.expectedClass,
        detected: detectedClass,
        pass
      });
    }

    const lowChords = [
      { name: 'E2 Minor Triad', midis: [40, 43, 47], expected: 'E Minor' },
      { name: 'D2 Major Triad', midis: [38, 42, 45], expected: 'D Major' },
      { name: 'C2 Major Triad', midis: [36, 40, 43], expected: 'C Major' }
    ];

    for (const lc of lowChords) {
      cat.total++;
      const comps = lc.midis.map(m => ({ freq: midiToFrequency(m), amp: 0.3 }));
      const frame = synthesizeFrame(comps);
      const chroma = extractFrameChroma(frame, SR);
      const match = matchChord(chroma.chroma);
      const pass = match.chord === lc.expected && match.isConfident;
      if (pass) cat.passed++;
      cat.details.push({
        case: lc.name,
        expected: lc.expected,
        detected: match.chord,
        score: match.score,
        reason: match.reason || 'none',
        pass
      });
    }
  }

  // =========================================================================
  // Category 10: Silence and Incomplete-Note Rejection
  // =========================================================================
  {
    const cat = results.category10;
    const testCases = [
      { name: 'Pure Silence (zeros)', frame: new Float32Array(FRAME_SIZE) },
      { name: 'Low ambient noise (RMS 0.002)', frame: (() => {
        const f = new Float32Array(FRAME_SIZE);
        for (let i = 0; i < FRAME_SIZE; i++) f[i] = (Math.random() * 2 - 1) * 0.002;
        return f;
      })() },
      { name: 'Single Note C2 (65Hz)', frame: synthesizeFrame([{ freq: 65.41, amp: 0.5 }]) },
      { name: 'Single Note A4 (440Hz)', frame: synthesizeFrame([{ freq: 440.0, amp: 0.5 }]) },
      { name: 'Single Note with Harmonics (Solo Violin A4)', frame: synthesizeFrame([
        { freq: 440, amp: 0.4 }, { freq: 880, amp: 0.2 }, { freq: 1320, amp: 0.1 }
      ]) },
      { name: 'Dyad: C4 + E4 (Major 3rd, no 5th)', frame: synthesizeFrame([
        { freq: 261.63, amp: 0.35 }, { freq: 329.63, amp: 0.35 }
      ]) },
      { name: 'Dyad: C4 + G4 (Power chord 5th, no 3rd)', frame: synthesizeFrame([
        { freq: 261.63, amp: 0.35 }, { freq: 392.00, amp: 0.35 }
      ]) },
      { name: 'Dyad: A3 + C4 (Minor 3rd, no 5th)', frame: synthesizeFrame([
        { freq: 220.00, amp: 0.35 }, { freq: 261.63, amp: 0.35 }
      ]) },
      { name: 'Dyad: D4 + F#4 (Major 3rd, no 5th)', frame: synthesizeFrame([
        { freq: 293.66, amp: 0.35 }, { freq: 369.99, amp: 0.35 }
      ]) },
      { name: 'Sparse Flat Noise (Uniform white noise amp 0.10)', frame: (() => {
        const f = new Float32Array(FRAME_SIZE);
        for (let i = 0; i < FRAME_SIZE; i++) f[i] = (Math.random() * 2 - 1) * 0.10;
        return f;
      })() }
    ];

    for (const tc of testCases) {
      cat.total++;
      const chroma = extractFrameChroma(tc.frame, SR);
      const match = matchChord(chroma.chroma);
      const pass = (match.chord === 'N.C.' || !match.isConfident);
      if (pass) cat.passed++;
      cat.details.push({
        case: tc.name,
        expected: 'N.C. (isConfident: false)',
        detected: `${match.chord} (isConfident: ${match.isConfident})`,
        reason: match.reason || 'rejected',
        pass
      });
    }
  }

  return results;
}

/**
 * Pretty-prints stress test results.
 */
export async function printStressReport() {
  const results = await runAllStressTests();

  console.log('=================================================================================');
  console.log('               CHORDFINDER SYNTHETIC STRESS TEST SUITE REPORT                    ');
  console.log('=================================================================================');
  console.log('Note: Synthetic stress tests evaluate DSP edge-case robustness on known signals.');
  console.log('Synthetic benchmark results MUST NOT be presented as real-recording accuracy.\n');

  let grandTotal = 0;
  let grandPassed = 0;

  for (const [key, cat] of Object.entries(results)) {
    const pct = ((cat.passed / cat.total) * 100).toFixed(1);
    grandTotal += cat.total;
    grandPassed += cat.passed;
    console.log(`[${pct}%] ${cat.name} (${cat.passed}/${cat.total} passed)`);
    for (const d of cat.details) {
      const mark = d.pass ? '  ✔ PASS' : '  ✖ FAIL';
      const extra = d.reason ? ` [reason: ${d.reason}]` : '';
      console.log(`    ${mark}: ${d.case} -> Exp: ${d.expected} | Got: ${d.detected}${extra}`);
    }
    console.log('');
  }

  const grandPct = ((grandPassed / grandTotal) * 100).toFixed(1);
  console.log('=================================================================================');
  console.log(`SUMMARY: ${grandPassed} / ${grandTotal} tests passed (${grandPct}%)`);
  console.log('=================================================================================\n');

  return results;
}

if (process.argv[1] && process.argv[1].endsWith('run-stress-tests.js')) {
  printStressReport().catch(err => {
    console.error('Error running stress tests:', err);
    process.exit(1);
  });
}
