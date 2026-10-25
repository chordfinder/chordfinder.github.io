import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractFrameChroma, extractChromagram } from '../src/js/chord-engine/chromagram.js';
import { matchChord, segmentChords } from '../src/js/chord-engine/chord-matcher.js';
import { midiToFrequency, PITCH_CLASSES } from '../src/js/chord-engine/note-pitch.js';

test('Accuracy: All 24 Triads across Octaves 3, 4, 5 and Sample Rates 22050, 44100, 48000 Hz', () => {
  const sampleRates = [22050, 44100, 48000];
  const octaves = [3, 4, 5];
  const frameSize = 8192;

  let totalChords = 0;
  let passedChords = 0;
  const failureLog = [];

  for (const sr of sampleRates) {
    for (const oct of octaves) {
      for (let r = 0; r < 12; r++) {
        const rootName = PITCH_CLASSES[r];
        const baseMidi = 12 * (oct + 1) + r;

        // --- Major Triad ---
        {
          totalChords++;
          const fRoot = midiToFrequency(baseMidi);
          const f3rd = midiToFrequency(baseMidi + 4);
          const f5th = midiToFrequency(baseMidi + 7);

          const frame = new Float32Array(frameSize);
          for (let i = 0; i < frameSize; i++) {
            frame[i] = 0.3 * Math.sin(2 * Math.PI * fRoot * i / sr) +
                       0.3 * Math.sin(2 * Math.PI * f3rd * i / sr) +
                       0.3 * Math.sin(2 * Math.PI * f5th * i / sr);
          }

          const chroma = extractFrameChroma(frame, sr);
          const match = matchChord(chroma.chroma);
          const expected = `${rootName} Major`;

          if (match.chord === expected && match.isConfident) {
            passedChords++;
          } else {
            failureLog.push(`Major Fail: expected ${expected}, got ${match.chord} (SR=${sr}, Oct=${oct})`);
          }
        }

        // --- Minor Triad ---
        {
          totalChords++;
          const fRoot = midiToFrequency(baseMidi);
          const f3rd = midiToFrequency(baseMidi + 3);
          const f5th = midiToFrequency(baseMidi + 7);

          const frame = new Float32Array(frameSize);
          for (let i = 0; i < frameSize; i++) {
            frame[i] = 0.3 * Math.sin(2 * Math.PI * fRoot * i / sr) +
                       0.3 * Math.sin(2 * Math.PI * f3rd * i / sr) +
                       0.3 * Math.sin(2 * Math.PI * f5th * i / sr);
          }

          const chroma = extractFrameChroma(frame, sr);
          const match = matchChord(chroma.chroma);
          const expected = `${rootName} Minor`;

          if (match.chord === expected && match.isConfident) {
            passedChords++;
          } else {
            failureLog.push(`Minor Fail: expected ${expected}, got ${match.chord} (SR=${sr}, Oct=${oct})`);
          }
        }
      }
    }
  }

  assert.equal(
    passedChords,
    totalChords,
    `Chord coverage failures (${failureLog.length}): ${failureLog.slice(0, 5).join('; ')}`
  );
  assert.equal(totalChords, 216); // 24 chords * 3 octaves * 3 sample rates
});

test('Accuracy: Different Relative Amplitudes (Unbalanced Dynamics)', () => {
  const sr = 44100;
  const frameSize = 8192;

  // Case 1: Loud root (0.5), quiet third (0.12), medium fifth (0.28)
  {
    const frame = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      frame[i] = 0.5 * Math.sin(2 * Math.PI * 261.63 * i / sr) +
                 0.12 * Math.sin(2 * Math.PI * 329.63 * i / sr) +
                 0.28 * Math.sin(2 * Math.PI * 392.00 * i / sr);
    }
    const chroma = extractFrameChroma(frame, sr);
    const match = matchChord(chroma.chroma);
    assert.equal(match.chord, 'C Major');
    assert.equal(match.isConfident, true);
  }

  // Case 2: Inverted balance: loud third (0.45), quiet root (0.15), loud fifth (0.40)
  {
    const frame = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      frame[i] = 0.15 * Math.sin(2 * Math.PI * 261.63 * i / sr) +
                 0.45 * Math.sin(2 * Math.PI * 329.63 * i / sr) +
                 0.40 * Math.sin(2 * Math.PI * 392.00 * i / sr);
    }
    const chroma = extractFrameChroma(frame, sr);
    const match = matchChord(chroma.chroma);
    assert.equal(match.chord, 'C Major');
    assert.equal(match.isConfident, true);
  }
});

test('Accuracy: Realistic Harmonic Overtones', () => {
  const sr = 44100;
  const frameSize = 8192;
  const frame = new Float32Array(frameSize);

  // C Major triad notes with harmonics f0, 2f0, 3f0, 4f0
  const fundamentals = [261.63, 329.63, 392.00];

  for (let i = 0; i < frameSize; i++) {
    let s = 0;
    for (const f0 of fundamentals) {
      s += 0.30 * Math.sin(2 * Math.PI * f0 * i / sr);       // 1st (fundamental)
      s += 0.15 * Math.sin(2 * Math.PI * 2 * f0 * i / sr);  // 2nd (octave)
      s += 0.08 * Math.sin(2 * Math.PI * 3 * f0 * i / sr);  // 3rd (octave + 5th)
      s += 0.04 * Math.sin(2 * Math.PI * 4 * f0 * i / sr);  // 4th (2 octaves)
    }
    frame[i] = s;
  }

  const chroma = extractFrameChroma(frame, sr);
  const match = matchChord(chroma.chroma);

  assert.equal(match.chord, 'C Major');
  assert.equal(match.isConfident, true);
  assert.ok(match.score > 0.85);
});

test('Rejection: Incomplete Chords (Single Notes and Dyads)', () => {
  const sr = 44100;
  const frameSize = 8192;

  // Single Note: C4 only (no 3rd or 5th)
  {
    const frame = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      frame[i] = 0.5 * Math.sin(2 * Math.PI * 261.63 * i / sr);
    }
    const chroma = extractFrameChroma(frame, sr);
    const match = matchChord(chroma.chroma);
    assert.equal(match.chord, 'N.C.', 'Single note must not match as a confident full triad');
    assert.equal(match.isConfident, false);
  }

  // Dyad: C4 + E4 only (no G4 fifth)
  {
    const frame = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      frame[i] = 0.4 * Math.sin(2 * Math.PI * 261.63 * i / sr) +
                 0.4 * Math.sin(2 * Math.PI * 329.63 * i / sr);
    }
    const chroma = extractFrameChroma(frame, sr);
    const match = matchChord(chroma.chroma);
    assert.equal(match.chord, 'N.C.', 'Dyad missing fifth must not be classified as confident full triad');
    assert.equal(match.isConfident, false);
  }
});

test('Rejection: White Noise and Ambiguous Flat Spectra', () => {
  const sr = 44100;
  const frameSize = 8192;
  const frame = new Float32Array(frameSize);

  // Generate pseudo-random white noise
  for (let i = 0; i < frameSize; i++) {
    frame[i] = (Math.random() * 2 - 1) * 0.15;
  }

  const chroma = extractFrameChroma(frame, sr);
  const match = matchChord(chroma.chroma);

  assert.equal(match.chord, 'N.C.', 'White noise must be rejected as N.C.');
  assert.equal(match.isConfident, false);
});

test('Rejection: Silence and Near-Silence Ambient Levels', () => {
  const sr = 44100;
  const frameSize = 8192;

  // Exact silence
  const zeroFrame = new Float32Array(frameSize);
  const zeroResult = extractFrameChroma(zeroFrame, sr);
  assert.equal(zeroResult.isSilent, true);
  const zeroMatch = matchChord(zeroResult.chroma);
  assert.equal(zeroMatch.chord, 'N.C.');
  assert.equal(zeroMatch.isConfident, false);

  // Near-silence ambient floor (RMS < 0.005)
  const lowNoiseFrame = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    lowNoiseFrame[i] = (Math.random() * 2 - 1) * 0.002;
  }
  const lowResult = extractFrameChroma(lowNoiseFrame, sr);
  assert.equal(lowResult.isSilent, true);
  const lowMatch = matchChord(lowResult.chroma);
  assert.equal(lowMatch.chord, 'N.C.');
});

test('Segmentation: Chord Changes Separated by Silence', async () => {
  const sr = 44100;
  const hopSize = 4096;
  const frameSize = 8192;
  const hopDuration = hopSize / sr;

  // 1.5s C Major (0 to 1.5s), 1.0s Silence (1.5s to 2.5s), 1.5s G Major (2.5s to 4.0s)
  const totalSamples = Math.floor(4.0 * sr);
  const audio = new Float32Array(totalSamples);

  const s1End = Math.floor(1.5 * sr);
  const s2Start = Math.floor(2.5 * sr);

  // C Major
  for (let i = 0; i < s1End; i++) {
    audio[i] = 0.25 * Math.sin(2 * Math.PI * 261.63 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 329.63 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 392.00 * i / sr);
  }

  // G Major (G3=196.00, B3=246.94, D4=293.66)
  for (let i = s2Start; i < totalSamples; i++) {
    audio[i] = 0.25 * Math.sin(2 * Math.PI * 196.00 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 246.94 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 293.66 * i / sr);
  }

  const chromaFrames = await extractChromagram(audio, sr, { frameSize, hopSize });
  const framePredictions = chromaFrames.map(f => {
    const match = matchChord(f.chroma);
    return {
      time: f.time,
      chord: f.isSilent ? 'N.C.' : match.chord,
      shortName: f.isSilent ? 'N.C.' : match.shortName,
      root: f.isSilent ? null : match.root,
      quality: f.isSilent ? 'none' : match.quality,
      score: f.isSilent ? 0 : match.score,
      isSilent: f.isSilent
    };
  });

  const segments = segmentChords(framePredictions, hopDuration, { minSegmentDuration: 0.4 });

  // Must contain C Major, then Silence/N.C., then G Major
  assert.ok(segments.length >= 3, `Expected at least 3 segments (C, Silence, G), got ${segments.length}`);
  assert.equal(segments[0].chord, 'C Major');
  assert.equal(segments[1].chord, 'N.C.');
  assert.equal(segments[segments.length - 1].chord, 'G Major');
});

test('Segmentation: Short Transient Rejection (0.05s Drum Click)', async () => {
  const sr = 44100;
  const hopSize = 4096;
  const frameSize = 8192;
  const hopDuration = hopSize / sr;

  // 2 seconds of continuous C Major, interrupted at 1.0s by a 0.05s wideband click
  const totalSamples = Math.floor(2.0 * sr);
  const audio = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    audio[i] = 0.25 * Math.sin(2 * Math.PI * 261.63 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 329.63 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 392.00 * i / sr);
  }

  // Insert click at 1.0s for 0.05s
  const clickStart = Math.floor(1.0 * sr);
  const clickEnd = clickStart + Math.floor(0.05 * sr);
  for (let i = clickStart; i < clickEnd; i++) {
    audio[i] += (Math.random() * 2 - 1) * 0.8;
  }

  const chromaFrames = await extractChromagram(audio, sr, { frameSize, hopSize });
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

  const segments = segmentChords(framePredictions, hopDuration, { minSegmentDuration: 0.4 });

  // Click must be smoothed out, maintaining a unified C Major segment
  assert.equal(segments.length, 1, `Transient click should be smoothed out, but got ${segments.length} segments`);
  assert.equal(segments[0].chord, 'C Major');
});

test('Segmentation: Continuous Progression & Timestamp Tolerance', async () => {
  const sr = 44100;
  const hopSize = 4096;
  const frameSize = 8192;
  const hopDuration = hopSize / sr; // ~0.09288s

  // Progression:
  // 0.0s to 2.0s: C Major (C4=261.63, E4=329.63, G4=392.00)
  // 2.0s to 3.5s: F Major (F3=174.61, A3=220.00, C4=261.63)
  // 3.5s to 5.0s: G Major (G3=196.00, B3=246.94, D4=293.66)
  // 5.0s to 6.0s: A Minor (A3=220.00, C4=261.63, E4=329.63)
  const totalDuration = 6.0;
  const totalSamples = Math.floor(totalDuration * sr);
  const audio = new Float32Array(totalSamples);

  const t1 = Math.floor(2.0 * sr);
  const t2 = Math.floor(3.5 * sr);
  const t3 = Math.floor(5.0 * sr);

  // 1. C Major (0 - 2.0s)
  for (let i = 0; i < t1; i++) {
    audio[i] = 0.25 * Math.sin(2 * Math.PI * 261.63 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 329.63 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 392.00 * i / sr);
  }

  // 2. F Major (2.0s - 3.5s)
  for (let i = t1; i < t2; i++) {
    audio[i] = 0.25 * Math.sin(2 * Math.PI * 174.61 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 220.00 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 261.63 * i / sr);
  }

  // 3. G Major (3.5s - 5.0s)
  for (let i = t2; i < t3; i++) {
    audio[i] = 0.25 * Math.sin(2 * Math.PI * 196.00 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 246.94 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 293.66 * i / sr);
  }

  // 4. A Minor (5.0s - 6.0s)
  for (let i = t3; i < totalSamples; i++) {
    audio[i] = 0.25 * Math.sin(2 * Math.PI * 220.00 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 261.63 * i / sr) +
               0.25 * Math.sin(2 * Math.PI * 329.63 * i / sr);
  }

  const chromaFrames = await extractChromagram(audio, sr, { frameSize, hopSize });
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

  const segments = segmentChords(framePredictions, hopDuration, { minSegmentDuration: 0.4 });

  // Check detected chord sequence
  const detectedChords = segments.map(s => s.chord);
  assert.deepEqual(
    detectedChords,
    ['C Major', 'F Major', 'G Major', 'A Minor'],
    `Progression sequence mismatch: ${JSON.stringify(detectedChords)}`
  );

  // Documented tolerance: analysis window is 8192 samples (0.186s) with 4096 hop (0.093s).
  // Transitions between chords are expected to fall within +/- 1.5 hops (+/- 0.14s).
  const tolerance = 0.15; // seconds

  const cMajorSeg = segments[0];
  const fMajorSeg = segments[1];
  const gMajorSeg = segments[2];
  const aMinorSeg = segments[3];

  // C -> F transition at 2.0s
  assert.ok(
    Math.abs(cMajorSeg.endTime - 2.0) <= tolerance,
    `C Major endTime ${cMajorSeg.endTime} should be within ${tolerance}s of 2.0s (error: ${Math.abs(cMajorSeg.endTime - 2.0).toFixed(3)}s)`
  );
  assert.ok(
    Math.abs(fMajorSeg.startTime - 2.0) <= tolerance,
    `F Major startTime ${fMajorSeg.startTime} should be within ${tolerance}s of 2.0s`
  );

  // F -> G transition at 3.5s
  assert.ok(
    Math.abs(fMajorSeg.endTime - 3.5) <= tolerance,
    `F Major endTime ${fMajorSeg.endTime} should be within ${tolerance}s of 3.5s (error: ${Math.abs(fMajorSeg.endTime - 3.5).toFixed(3)}s)`
  );

  // G -> Am transition at 5.0s
  assert.ok(
    Math.abs(gMajorSeg.endTime - 5.0) <= tolerance,
    `G Major endTime ${gMajorSeg.endTime} should be within ${tolerance}s of 5.0s (error: ${Math.abs(gMajorSeg.endTime - 5.0).toFixed(3)}s)`
  );
});
