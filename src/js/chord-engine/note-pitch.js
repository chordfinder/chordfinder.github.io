/**
 * ChordFinder - Note & Pitch Constants and Utilities
 * Foundation for pitch class mapping, frequency calculations, and note conversions.
 */

export const PITCH_CLASSES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
];

export const ENHARMONIC_EQUIVALENTS = {
  'Db': 'C#',
  'Eb': 'D#',
  'Gb': 'F#',
  'Ab': 'G#',
  'Bb': 'A#'
};

export const STANDARD_TUNING_A4 = 440.0;

/**
 * Converts a MIDI note number (0-127) to frequency in Hertz.
 * @param {number} midiNote - e.g. 69 for A4
 * @returns {number} Frequency in Hz
 */
export function midiToFrequency(midiNote) {
  return STANDARD_TUNING_A4 * Math.pow(2, (midiNote - 69) / 12);
}

/**
 * Converts a frequency in Hertz to the closest MIDI note number.
 * @param {number} frequency - in Hz
 * @returns {number} Fractional MIDI note number
 */
export function frequencyToMidi(frequency) {
  if (frequency <= 0) return 0;
  return 69 + 12 * Math.log2(frequency / STANDARD_TUNING_A4);
}

/**
 * Gets the pitch class name (e.g. 'C', 'G#') from a MIDI note number.
 * @param {number} midiNote
 * @returns {string}
 */
export function midiToPitchClass(midiNote) {
  const noteIndex = ((Math.round(midiNote) % 12) + 12) % 12;
  return PITCH_CLASSES[noteIndex];
}

/**
 * Gets the pitch class index (0 for C, 1 for C#, ..., 11 for B) from a pitch class name.
 * @param {string} pitchName
 * @returns {number} Index 0-11, or -1 if invalid
 */
export function getPitchClassIndex(pitchName) {
  if (!pitchName) return -1;
  const canonical = ENHARMONIC_EQUIVALENTS[pitchName] || pitchName;
  return PITCH_CLASSES.indexOf(canonical);
}

/**
 * Converts a frequency in Hertz to pitch class information including note index and cent offset.
 * @param {number} frequency - in Hz
 * @returns {{ pitchClass: string, index: number, midiNote: number, centOffset: number } | null}
 */
export function frequencyToPitchClass(frequency) {
  if (!frequency || frequency <= 0 || !isFinite(frequency)) {
    return null;
  }
  const fractionalMidi = frequencyToMidi(frequency);
  const roundedMidi = Math.round(fractionalMidi);
  const centOffset = Math.round((fractionalMidi - roundedMidi) * 100);
  const index = ((roundedMidi % 12) + 12) % 12;
  const pitchClass = PITCH_CLASSES[index];

  return {
    pitchClass,
    index,
    midiNote: roundedMidi,
    centOffset
  };
}

