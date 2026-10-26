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
      reason: 'No chroma input',
      diagnostics: {
        candidates: [],
        scoreDelta: 0,
        triadCompleteness: 0,
        triadNotes: null,
        nonChordRatio: 0,
        decision: 'rejected',
        reason: 'No chroma input'
      }
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
      reason: 'Zero energy / silence',
      diagnostics: {
        candidates: [],
        scoreDelta: 0,
        triadCompleteness: 0,
        triadNotes: null,
        nonChordRatio: 0,
        decision: 'rejected',
        reason: 'Zero energy / silence'
      }
    };
  }

  // Compute cosine similarity against all 24 templates
  const ranked = [];
  for (let i = 0; i < BASIC_TEMPLATES.length; i++) {
    const tmpl = BASIC_TEMPLATES[i];
    const score = cosineSimilarity(chromaVector, tmpl.vector);
    ranked.push({ tmpl, score });
  }
  ranked.sort((a, b) => b.score - a.score);

  const bestTemplate = ranked[0]?.tmpl || null;
  const bestScore = ranked[0]?.score || 0;
  const secondScore = ranked[1]?.score || 0;
  const scoreDelta = parseFloat(Math.max(0, bestScore - secondScore).toFixed(4));

  const topCandidates = ranked.slice(0, 3).map(r => ({
    chord: r.tmpl.name,
    shortName: r.tmpl.shortName,
    root: r.tmpl.root,
    quality: r.tmpl.quality,
    score: parseFloat(r.score.toFixed(4))
  }));

  if (bestScore < options.confidenceThreshold || !bestTemplate) {
    const reason = `Low template match score (${bestScore.toFixed(3)} < ${options.confidenceThreshold} threshold)`;
    return {
      chord: 'N.C.',
      shortName: 'N.C.',
      root: null,
      quality: 'uncertain',
      score: Math.max(0, bestScore),
      isConfident: false,
      reason,
      diagnostics: {
        candidates: topCandidates,
        scoreDelta,
        triadCompleteness: 0,
        triadNotes: null,
        nonChordRatio: 1.0,
        decision: 'rejected',
        reason
      }
    };
  }

  // Check Triad Completeness: Root, 3rd, and 5th must all be present
  const eRoot = chromaVector[bestTemplate.rootIndex];
  const eThird = chromaVector[bestTemplate.thirdIndex];
  const eFifth = chromaVector[bestTemplate.fifthIndex];

  const minTriadEnergy = Math.min(eRoot, eThird, eFifth);
  const maxTriadEnergy = Math.max(eRoot, eThird, eFifth);
  const triadCompleteness = maxTriadEnergy > 1e-6 ? (minTriadEnergy / maxTriadEnergy) : 0;

  const triadNotes = {
    root: PITCH_CLASSES[bestTemplate.rootIndex],
    third: PITCH_CLASSES[bestTemplate.thirdIndex],
    fifth: PITCH_CLASSES[bestTemplate.fifthIndex],
    rootEnergy: parseFloat(eRoot.toFixed(4)),
    thirdEnergy: parseFloat(eThird.toFixed(4)),
    fifthEnergy: parseFloat(eFifth.toFixed(4))
  };

  if (triadCompleteness < options.minTriadCompleteness) {
    const reason = `Incomplete triad (${triadCompleteness.toFixed(3)} < ${options.minTriadCompleteness} threshold; missing chord notes / single note or dyad)`;
    return {
      chord: 'N.C.',
      shortName: 'N.C.',
      root: bestTemplate.root,
      quality: 'incomplete',
      score: bestScore,
      isConfident: false,
      reason,
      diagnostics: {
        candidates: topCandidates,
        scoreDelta,
        triadCompleteness: parseFloat(triadCompleteness.toFixed(4)),
        triadNotes,
        nonChordRatio: 0,
        decision: 'rejected',
        reason
      }
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
  const totalEnergy = chordEnergySum + nonChordEnergySum;
  const nonChordRatio = totalEnergy > 1e-6 ? (nonChordEnergySum / totalEnergy) : 0;

  if (nonChordRatio > options.maxNonChordRatio) {
    const reason = `High non-chord energy ratio (${nonChordRatio.toFixed(3)} > ${options.maxNonChordRatio} threshold; ambiguous mixture or high background noise)`;
    return {
      chord: 'N.C.',
      shortName: 'N.C.',
      root: bestTemplate.root,
      quality: 'ambiguous',
      score: bestScore,
      isConfident: false,
      reason,
      diagnostics: {
        candidates: topCandidates,
        scoreDelta,
        triadCompleteness: parseFloat(triadCompleteness.toFixed(4)),
        triadNotes,
        nonChordRatio: parseFloat(nonChordRatio.toFixed(4)),
        decision: 'rejected',
        reason
      }
    };
  }

  const acceptReason = `Accepted: High template correlation (${bestScore.toFixed(3)}), complete triad (${triadCompleteness.toFixed(3)}), low non-chord energy (${nonChordRatio.toFixed(3)})`;
  return {
    chord: bestTemplate.name,
    shortName: bestTemplate.shortName,
    root: bestTemplate.root,
    quality: bestTemplate.quality,
    score: bestScore,
    isConfident: true,
    reason: acceptReason,
    diagnostics: {
      candidates: topCandidates,
      scoreDelta,
      triadCompleteness: parseFloat(triadCompleteness.toFixed(4)),
      triadNotes,
      nonChordRatio: parseFloat(nonChordRatio.toFixed(4)),
      decision: 'accepted',
      reason: acceptReason
    }
  };
}

/**
 * Smooths an array of frame predictions using a temporal majority vote window.
 * Reduces rapid, single-frame flickers while recording whether smoothing changed each frame.
 *
 * @param {Array<{ time: number, chord: string, score: number, ... }>} framePredictions
 * @param {number} radius - Number of neighboring frames on each side
 * @returns {Array<{ time: number, chord: string, score: number, ... }>}
 */
export function smoothFramePredictions(framePredictions, radius = 2) {
  const n = framePredictions.length;
  if (n <= 2 || radius <= 0) {
    return framePredictions.map(p => ({
      ...p,
      wasSmoothed: false,
      rawChord: p.rawChord || p.chord,
      rawShortName: p.rawShortName || p.shortName,
      smoothedChord: p.chord
    }));
  }

  const smoothed = [];

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - radius);
    const end = Math.min(n - 1, i + radius);

    // Weighted votes by score, giving silence and N.C. appropriate confidence
    const votes = new Map();
    for (let j = start; j <= end; j++) {
      const pred = framePredictions[j];
      const key = pred.chord;
      const conf = pred.isSilent ? 0.90 : (pred.chord === 'N.C.' ? 0.80 : (pred.score || 0.5));
      const weight = conf * (1.0 - Math.abs(i - j) * 0.15);
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
    const wasSmoothed = dominantChord !== original.chord;
    const rawChord = original.rawChord || original.chord;
    const rawShortName = original.rawShortName || original.shortName;

    if (!wasSmoothed) {
      smoothed.push({
        ...original,
        wasSmoothed: false,
        rawChord,
        rawShortName,
        smoothedChord: dominantChord
      });
    } else {
      const tmpl = BASIC_TEMPLATES.find(t => t.name === dominantChord);
      smoothed.push({
        ...original,
        wasSmoothed: true,
        rawChord,
        rawShortName,
        smoothedChord: dominantChord,
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
    const frameDefaultEnd = f.actualEndTime ?? (f.time + hopDuration);

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
        endTime: frameDefaultEnd,
        duration: Math.max(0.01, frameDefaultEnd - f.time),
        scoreSum: f.score || 0,
        frameCount: 1
      };
    } else {
      currentSegment.scoreSum += (f.score || 0);
      currentSegment.frameCount++;
      currentSegment.endTime = frameDefaultEnd;
    }
  }

  if (currentSegment) {
    // If audioDuration is explicitly provided in options and supported by the final analysis
    if (opts.audioDuration !== undefined && opts.audioDuration !== null && opts.audioDuration > 0) {
      const audioDur = opts.audioDuration;
      // Make endpoint equal to audioDuration only when supported by the final analysis
      if (currentSegment.endTime < audioDur && (audioDur - currentSegment.endTime) <= hopDuration * 1.5) {
        currentSegment.endTime = audioDur;
      }
    }
    currentSegment.duration = Math.max(0.01, currentSegment.endTime - currentSegment.startTime);
    currentSegment.similarityScore = currentSegment.scoreSum / currentSegment.frameCount;
    rawSegments.push(currentSegment);
  }

  // Step 3: Merge short segments that fall below minSegmentDuration
  const minDur = opts.minSegmentDuration;
  if (rawSegments.length <= 1) {
    return rawSegments.map(s => ({
      chord: s.chord,
      shortName: s.shortName,
      root: s.root,
      quality: s.quality,
      startTime: parseFloat(s.startTime.toFixed(2)),
      endTime: parseFloat(s.endTime.toFixed(2)),
      duration: parseFloat((s.endTime - s.startTime).toFixed(2)),
      similarityScore: parseFloat(s.similarityScore.toFixed(3))
    }));
  }

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

      // Do NOT merge trailing silence into a preceding non-N.C. chord
      // (preserves Requirement 4: If recording ends in silence, do not extend final chord over silence)
      const isTrailingSilence = !next && seg.chord === 'N.C.' && prev && prev.chord !== 'N.C.';

      // Otherwise merge with previous if present and not violating trailing silence constraint
      if (prev && !isTrailingSilence) {
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
    duration: parseFloat((s.endTime - s.startTime).toFixed(2)),
    similarityScore: parseFloat(s.similarityScore.toFixed(3))
  }));
}

/**
 * Retrieves comprehensive, consistent diagnostic information for a specific timestamp.
 * Identifies the exact corresponding frame and reports:
 * - Raw chord prediction and candidate scores
 * - Raw rejection decision and reason
 * - Smoothed prediction and whether smoothing changed the prediction
 * - Final segment label, start/end times, and duration
 * - Explicit explanation if the frame and its final segment differ
 *
 * @param {number} time - Selected timestamp in seconds
 * @param {Array<object>} framePredictions - Array of frame analysis objects
 * @param {Array<object>} [segments=[]] - Array of detected chord segments
 * @param {object} [options={}] - Additional options (e.g. hopDuration)
 * @returns {object} Consistent diagnostic metadata for the timestamp
 */
export function getFrameDiagnosticsAtTime(time, framePredictions, segments = [], options = {}) {
  if (!framePredictions || framePredictions.length === 0) {
    return {
      frameIndex: -1,
      frameTime: time,
      timeOffset: 0,
      rawChord: 'N.C.',
      rawShortName: 'N.C.',
      rawCandidates: [],
      rawScore: 0,
      rawDecision: 'rejected',
      rawReason: 'No analysis frames available',
      scoreDelta: 0,
      triadCompleteness: 0,
      triadNotes: null,
      nonChordRatio: 0,
      smoothedChord: 'N.C.',
      smoothedShortName: 'N.C.',
      wasSmoothed: false,
      finalSegmentChord: 'N.C.',
      finalSegmentShortName: 'N.C.',
      segmentStartTime: null,
      segmentEndTime: null,
      segmentDuration: null,
      segmentScore: null,
      differExplanation: 'No analysis frames available.',
      frame: null
    };
  }

  // Find closest frame to the requested timestamp
  let closestIndex = 0;
  let minDiff = Infinity;
  for (let i = 0; i < framePredictions.length; i++) {
    const diff = Math.abs(framePredictions[i].time - time);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }
  const frame = framePredictions[closestIndex];

  // Find the final segment covering the requested timestamp
  let segment = segments.find(s => time >= s.startTime && time < s.endTime);
  if (!segment && segments.length > 0) {
    const lastSeg = segments[segments.length - 1];
    if (time >= lastSeg.startTime && time <= lastSeg.endTime + 0.05) {
      segment = lastSeg;
    }
  }

  const rawChord = frame.rawChord || frame.chord || 'N.C.';
  const rawShortName = frame.rawShortName || frame.shortName || 'N.C.';
  const smoothedChord = frame.smoothedChord || frame.chord || 'N.C.';
  const smoothedShortName = frame.shortName || 'N.C.';
  const wasSmoothed = Boolean(frame.wasSmoothed);
  const finalSegmentChord = segment ? segment.chord : 'N.C.';
  const finalSegmentShortName = segment ? (segment.shortName || segment.chord) : 'N.C.';
  const rawDecision = frame.diagnostics?.decision || (frame.isSilent ? 'rejected' : (rawChord === 'N.C.' ? 'rejected' : 'accepted'));
  const rawReason = frame.diagnostics?.reason || (frame.isSilent ? 'RMS energy below silence threshold (0.005)' : (rawChord === 'N.C.' ? 'Low template match score' : 'Accepted'));
  const rawCandidates = frame.diagnostics?.candidates || [];
  const rawScore = rawCandidates[0]?.score ?? (frame.score || 0);

  let differExplanation = '';
  if (!segment) {
    const lastEnd = segments.length > 0 ? segments[segments.length - 1].endTime : 0;
    differExplanation = `Timestamp (${time.toFixed(2)}s) falls outside detected segments (last segment ended at ${lastEnd.toFixed(2)}s). Closest frame #${closestIndex} (${frame.time.toFixed(2)}s) predicted ${smoothedChord}.`;
  } else if (wasSmoothed && smoothedChord === finalSegmentChord && rawChord !== finalSegmentChord) {
    differExplanation = `Temporal smoothing modified frame #${closestIndex} from raw ${rawChord} to ${smoothedChord}, which formed segment [${segment.startTime}s - ${segment.endTime}s].`;
  } else if (smoothedChord !== finalSegmentChord) {
    differExplanation = `Frame #${closestIndex} (smoothed: ${smoothedChord}) differs from final segment ${finalSegmentChord} [${segment.startTime}s - ${segment.endTime}s] due to minimum duration segment merging.`;
  } else if (rawChord !== smoothedChord) {
    differExplanation = `Temporal smoothing modified raw prediction ${rawChord} to ${smoothedChord}.`;
  } else {
    differExplanation = `Frame #${closestIndex} (${frame.time.toFixed(2)}s) raw prediction (${rawChord}), smoothed prediction (${smoothedChord}), and final segment (${finalSegmentChord} [${segment.startTime}s - ${segment.endTime}s]) are consistent.`;
  }

  return {
    frameIndex: closestIndex,
    frameTime: parseFloat(frame.time.toFixed(4)),
    timeOffset: parseFloat((time - frame.time).toFixed(4)),
    rawChord,
    rawShortName,
    rawCandidates,
    rawScore: parseFloat(rawScore.toFixed(4)),
    rawDecision,
    rawReason,
    scoreDelta: frame.diagnostics?.scoreDelta ?? 0,
    triadCompleteness: frame.diagnostics?.triadCompleteness ?? 0,
    triadNotes: frame.diagnostics?.triadNotes ?? null,
    nonChordRatio: frame.diagnostics?.nonChordRatio ?? 0,
    smoothedChord,
    smoothedShortName,
    wasSmoothed,
    finalSegmentChord,
    finalSegmentShortName,
    segmentStartTime: segment ? segment.startTime : null,
    segmentEndTime: segment ? segment.endTime : null,
    segmentDuration: segment ? segment.duration : null,
    segmentScore: segment ? segment.similarityScore : null,
    differExplanation,
    frame
  };
}

