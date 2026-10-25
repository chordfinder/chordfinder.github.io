import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PITCH_CLASSES,
  STANDARD_TUNING_A4,
  midiToFrequency,
  frequencyToMidi,
  midiToPitchClass,
  getPitchClassIndex,
  frequencyToPitchClass
} from '../src/js/chord-engine/note-pitch.js';

test('1. Note Pitch: Standard Pitch Constants', () => {
  assert.equal(STANDARD_TUNING_A4, 440.0);
  assert.equal(PITCH_CLASSES.length, 12);
  assert.deepEqual(PITCH_CLASSES, ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
});

test('2. Note Pitch: MIDI to Frequency & Frequency to MIDI conversions', () => {
  // A4 = MIDI 69 = 440.0 Hz
  assert.equal(Math.round(midiToFrequency(69)), 440);
  assert.equal(Math.round(frequencyToMidi(440)), 69);

  // A3 = MIDI 57 = 220.0 Hz
  assert.equal(Math.round(midiToFrequency(57)), 220);
  assert.equal(Math.round(frequencyToMidi(220)), 57);

  // Middle C (C4) = MIDI 60 ~= 261.63 Hz
  const c4Freq = midiToFrequency(60);
  assert.ok(Math.abs(c4Freq - 261.63) < 0.1);
  assert.equal(Math.round(frequencyToMidi(c4Freq)), 60);

  // E4 = MIDI 64 ~= 329.63 Hz
  const e4Freq = midiToFrequency(64);
  assert.ok(Math.abs(e4Freq - 329.63) < 0.1);
  assert.equal(Math.round(frequencyToMidi(e4Freq)), 64);

  // G4 = MIDI 67 ~= 392.00 Hz
  const g4Freq = midiToFrequency(67);
  assert.ok(Math.abs(g4Freq - 392.00) < 0.1);
  assert.equal(Math.round(frequencyToMidi(g4Freq)), 67);
});

test('3. Note Pitch: Pitch Class Mapping & Enharmonics', () => {
  assert.equal(midiToPitchClass(60), 'C');
  assert.equal(midiToPitchClass(64), 'E');
  assert.equal(midiToPitchClass(67), 'G');
  assert.equal(midiToPitchClass(69), 'A');

  // getPitchClassIndex
  assert.equal(getPitchClassIndex('C'), 0);
  assert.equal(getPitchClassIndex('E'), 4);
  assert.equal(getPitchClassIndex('G'), 7);
  assert.equal(getPitchClassIndex('A'), 9);
  // Enharmonics
  assert.equal(getPitchClassIndex('Db'), 1);
  assert.equal(getPitchClassIndex('Eb'), 3);
  assert.equal(getPitchClassIndex('Bb'), 10);
});

test('4. Note Pitch: frequencyToPitchClass conversion', () => {
  const resultA4 = frequencyToPitchClass(440.0);
  assert.ok(resultA4);
  assert.equal(resultA4.pitchClass, 'A');
  assert.equal(resultA4.index, 9);
  assert.equal(resultA4.midiNote, 69);
  assert.equal(resultA4.centOffset, 0);

  const resultC4 = frequencyToPitchClass(261.63);
  assert.ok(resultC4);
  assert.equal(resultC4.pitchClass, 'C');
  assert.equal(resultC4.index, 0);
  assert.equal(resultC4.midiNote, 60);

  // Invalid inputs
  assert.equal(frequencyToPitchClass(0), null);
  assert.equal(frequencyToPitchClass(-100), null);
  assert.equal(frequencyToPitchClass(NaN), null);
});
