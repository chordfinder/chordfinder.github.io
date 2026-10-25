/**
 * ChordFinder - Chord Template Matching Engine
 * Compares 12-dimensional chroma vectors against Major & Minor triad profiles,
 * rejects incomplete chords (single notes / dyads) and white noise,
 * and groups frame predictions into smoothed musical segments.
 */

import { PITCH_CLASSES } from './note-pitch.js';

export const CHORD_QUALITIES = {
  major: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
  minor: [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
  dominant7: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
  major7: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1],
  minor7: [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
  diminished: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
  augmented: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
};

/**
 * Normalized 24 basic templates (12 Major, 12 Minor) for chord detection.
 */
export function buildBasicChordTemplates() {
  const templates = [];

  for (let rootIndex = 0; rootIndex < 12; rootIndex++) {
    const rootName = PITCH_CLASSES[rootIndex];

    // Major Triad: Root (0), Major 3rd (+4), Perfect 5th (+7)
    const majorVector = new Float32Array(12);
    majorVector[rootIndex] = 1.0;
    majorVector[(rootIndex + 4) % 12] = 1.0;
    majorVector[(rootIndex + 7) % 12] = 1.0;
    normalizeVector(majorVector);

    templates.push({
      name: `${rootName} Major`,
      shortName: rootName,
      root: rootName,
      rootIndex,
      thirdIndex: (rootIndex + 4) % 12,
      fifthIndex: (rootIndex + 7) % 12,
      quality: 'major',
      vector: majorVector
    });

    // Minor Triad: Root (0), Minor 3rd (+3), Perfect 5th (+7)
    const minorVector = new Float32Array(12);
    minorVector[rootIndex] = 1.0;
    minorVector[(rootIndex + 3) % 12] = 1.0;
    minorVector[(rootIndex + 7) % 12] = 1.0;
    normalizeVector(minorVector);

    templates.push({
      name: `${rootName} Minor`,
      shortName: `${rootName}m`,
      root: rootName,
      rootIndex,
      thirdIndex: (rootIndex + 3) % 12,
      fifthIndex: (rootIndex + 7) % 12,
      quality: 'minor',
      vector: minorVector
    });
  }

  return templates;
}

/**
 * In-place L2 vector normalization.
 * @param {Float32Array} vec
 */
function normalizeVector(vec) {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 1e-8) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }
}

// Precomputed 24 basic chord templates
export const BASIC_TEMPLATES = buildBasicChordTemplates();

/**
 * Computes cosine similarity between two normalized 12-element vectors.
 * @param {Float32Array|Array<number>} v1
 * @param {Float32Array|Array<number>} v2
 * @returns {number} Value between 0.0 and 1.0
 */
export function cosineSimilarity(v1, v2) {
  let dot = 0;
  for (let i = 0; i < 12; i++) {
    dot += v1[i] * v2[i];
  }
  return Math.max(0, Math.min(1.0, dot));
}

export const DEFAULT_MATCHER_OPTIONS = {
  confidenceThreshold: 0.55,    // Minimum similarity score for a confident chord
  silenceRmsThreshold: 0.005,
  minSegmentDuration: 0.35,      // Minimum duration in seconds to avoid flicker while supporting fast tempo chord changes
  smoothingRadius: 2,            // Frames on either side for local majority vote
  minTriadCompleteness: 0.08,    // Minimum energy ratio (min note / max note) to prevent single notes or dyads from matching as full triads
  maxNonChordRatio: 0.65         // Maximum allowed ratio of non-chord energy to chord energy
};

/**
 * Matches a 12-dimensional chroma vector against the 24 basic chord templates.
 * Enforces triad completeness and non-chord energy constraints to eliminate false confidence
 * on single notes, dyads, or white noise.
 *
 * @param {Float32Array|Array<number>} chromaVector - 12-bin unit-normalized vector
 * @param {object} [customOptions]
 * @returns {{ chord: string, shortName: string, root: string|null, quality: string, score: number, isConfident: boolean, reason?: string }}
 */
export function matchChord(chromaVector, customOptions = {}) {
  const options = { ...DEFAULT_MATCHER_OPTIONS, ...customOptions };

  if (!chromaVector) {
    return {
      chord: 'N.C.',
      shortName: 'N.C.',
      root: null,
      quality: 'none',
      score: 0.0,
      isConfident: false,
      reason: 'No chroma input'
    };
  }

  // Check vector energy
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += chromaVector[i];
  }
  if (sum < 1e-4) {
    return {
      chord: 'N.C.',
      shortName: 'N.C.',
      root: null,
      quality: 'none',
      score: 0.0,
      isConfident: false,
      reason: 'Zero energy / silence'
    };
  }

  let bestTemplate = null;
  let bestScore = -1;

  for (let i = 0; i < BASIC_TEMPLATES.length; i++) {
    const tmpl = BASIC_TEMPLATES[i];
    const score = cosineSimilarity(chromaVector, tmpl.vector);
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = tmpl;
    }
  }

  if (bestScore < options.confidenceThreshold || !bestTemplate) {
    return {
      chord: 'N.C.',
      shortName: 'N.C.',
      root: null,
      quality: 'uncertain',
      score: Math.max(0, bestScore),
      isConfident: false,
      reason: 'Low template match score'
    };
  }

  // Check Triad Completeness: Root, 3rd, and 5th must all be present
  const eRoot = chromaVector[bestTemplate.rootIndex];
  const eThird = chromaVector[bestTemplate.thirdIndex];
  const eFifth = chromaVector[bestTemplate.fifthIndex];

  const minTriadEnergy = Math.min(eRoot, eThird, eFifth);
  const maxTriadEnergy = Math.max(eRoot, eThird, eFifth);
  const triadCompleteness = minTriadEnergy / Math.max(1e-6, maxTriadEnergy);

  if (triadCompleteness < options.minTriadCompleteness) {
    return {
      chord: 'N.C.',
      shortName: 'N.C.',
      root: bestTemplate.root,
      quality: 'incomplete',
      score: bestScore,
      isConfident: false,
      reason: 'Incomplete triad (missing chord notes / single note or dyad)'
    };
  }

  // Check Non-Chord Energy Ratio: Prevent white noise or ambiguous polychords
  let chordEnergySum = eRoot + eThird + eFifth;
  let nonChordEnergySum = 0;
  for (let i = 0; i < 12; i++) {
    if (i !== bestTemplate.rootIndex && i !== bestTemplate.thirdIndex && i !== bestTemplate.fifthIndex) {
      nonChordEnergySum += chromaVector[i];
    }
  }
  const nonChordRatio = nonChordEnergySum / Math.max(1e-6, chordEnergySum + nonChordEnergySum);
  if (nonChordRatio > options.maxNonChordRatio) {
    return {
      chord: 'N.C.',
      shortName: 'N.C.',
      root: bestTemplate.root,
      quality: 'ambiguous',
      score: bestScore,
      isConfident: false,
      reason: 'Ambiguous mixture or high background noise'
    };
  }

  return {
    chord: bestTemplate.name,
    shortName: bestTemplate.shortName,
    root: bestTemplate.root,
    quality: bestTemplate.quality,
    score: bestScore,
    isConfident: true
  };
}

/**
 * Smooths an array of frame predictions using a temporal majority vote window.
 * Reduces rapid, single-frame flickers.
 *
 * @param {Array<{ time: number, chord: string, score: number, ... }>} framePredictions
 * @param {number} radius - Number of neighboring frames on each side
 * @returns {Array<{ time: number, chord: string, score: number, ... }>}
 */
export function smoothFramePredictions(framePredictions, radius = 2) {
  const n = framePredictions.length;
  if (n <= 2 || radius <= 0) return framePredictions.slice();

  const smoothed = [];

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - radius);
    const end = Math.min(n - 1, i + radius);

    // Weighted votes by score
    const votes = new Map();
    for (let j = start; j <= end; j++) {
      const pred = framePredictions[j];
      const key = pred.chord;
      const weight = (pred.score || 0.1) * (1.0 - Math.abs(i - j) * 0.15);
      votes.set(key, (votes.get(key) || 0) + weight);
    }

    let dominantChord = framePredictions[i].chord;
    let maxWeight = -1;
    for (const [chordName, weight] of votes.entries()) {
      if (weight > maxWeight) {
        maxWeight = weight;
        dominantChord = chordName;
      }
    }

    const original = framePredictions[i];
    if (dominantChord === original.chord) {
      smoothed.push(original);
    } else {
      const tmpl = BASIC_TEMPLATES.find(t => t.name === dominantChord);
      smoothed.push({
        ...original,
        chord: dominantChord,
        shortName: tmpl ? tmpl.shortName : 'N.C.',
        root: tmpl ? tmpl.root : null,
        quality: tmpl ? tmpl.quality : 'none'
      });
    }
  }

  return smoothed;
}

/**
 * Groups consecutive frame predictions into coherent time segments,
 * merging sub-minimum-duration flickers.
 *
 * @param {Array<{ time: number, chord: string, score: number, shortName?: string, root?: string, quality?: string }>} frames
 * @param {number} hopDuration - Duration of one hop in seconds
 * @param {object} [options]
 * @returns {Array<{ chord: string, shortName: string, root: string|null, quality: string, startTime: number, endTime: number, duration: number, similarityScore: number }>}
 */
export function segmentChords(frames, hopDuration = 0.093, options = {}) {
  const opts = { ...DEFAULT_MATCHER_OPTIONS, ...options };
  if (!frames || frames.length === 0) return [];

  // Step 1: Smooth frames to eliminate instantaneous transients
  const smoothedFrames = smoothFramePredictions(frames, opts.smoothingRadius);

  // Step 2: Form raw contiguous segments
  const rawSegments = [];
  let currentSegment = null;

  for (let i = 0; i < smoothedFrames.length; i++) {
    const f = smoothedFrames[i];
    if (!currentSegment || currentSegment.chord !== f.chord) {
      if (currentSegment) {
        currentSegment.endTime = f.time;
        currentSegment.duration = Math.max(0.01, currentSegment.endTime - currentSegment.startTime);
        currentSegment.similarityScore = currentSegment.scoreSum / currentSegment.frameCount;
        rawSegments.push(currentSegment);
      }
      currentSegment = {
        chord: f.chord,
        shortName: f.shortName || f.chord,
        root: f.root || null,
        quality: f.quality || 'none',
        startTime: f.time,
        endTime: f.time + hopDuration,
        duration: hopDuration,
        scoreSum: f.score || 0,
        frameCount: 1
      };
    } else {
      currentSegment.scoreSum += (f.score || 0);
      currentSegment.frameCount++;
      currentSegment.endTime = f.time + hopDuration;
    }
  }

  if (currentSegment) {
    currentSegment.duration = Math.max(0.01, currentSegment.endTime - currentSegment.startTime);
    currentSegment.similarityScore = currentSegment.scoreSum / currentSegment.frameCount;
    rawSegments.push(currentSegment);
  }

  // Step 3: Merge short segments that fall below minSegmentDuration
  const minDur = opts.minSegmentDuration;
  if (rawSegments.length <= 1) return rawSegments;

  const mergedSegments = [];
  let cursor = 0;

  while (cursor < rawSegments.length) {
    const seg = rawSegments[cursor];

    // If segment is too short and not the only one left
    if (seg.duration < minDur && rawSegments.length > 1) {
      const prev = mergedSegments[mergedSegments.length - 1];
      const next = rawSegments[cursor + 1];

      // If flanked by same chord on both sides, bridge them
      if (prev && next && prev.chord === next.chord) {
        prev.endTime = next.endTime;
        prev.duration = prev.endTime - prev.startTime;
        prev.scoreSum += seg.scoreSum + next.scoreSum;
        prev.frameCount += seg.frameCount + next.frameCount;
        prev.similarityScore = prev.scoreSum / prev.frameCount;
        cursor += 2;
        continue;
      }

      // Otherwise merge with previous if present
      if (prev) {
        prev.endTime = seg.endTime;
        prev.duration = prev.endTime - prev.startTime;
        prev.scoreSum += seg.scoreSum;
        prev.frameCount += seg.frameCount;
        prev.similarityScore = prev.scoreSum / prev.frameCount;
        cursor++;
        continue;
      }
    }

    mergedSegments.push(seg);
    cursor++;
  }

  // Clean output objects
  return mergedSegments.map(s => ({
    chord: s.chord,
    shortName: s.shortName,
    root: s.root,
    quality: s.quality,
    startTime: parseFloat(s.startTime.toFixed(2)),
    endTime: parseFloat(s.endTime.toFixed(2)),
    duration: parseFloat(s.duration.toFixed(2)),
    similarityScore: parseFloat(s.similarityScore.toFixed(3))
  }));
}
