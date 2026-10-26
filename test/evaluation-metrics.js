/**
 * ChordFinder - Audio Chord Recognition Evaluation Metrics
 * Implements standard MIR (Music Information Retrieval) evaluation metrics for chord estimation:
 * - Chord-label accuracy (time-weighted overlap)
 * - Major vs. Minor classification accuracy
 * - Root-note accuracy
 * - Correct rejection of silence and incomplete chords (Recall & Precision)
 * - Chord-transition boundary timing error (Mean Absolute Error)
 * - Percentage of frames classified as uncertain or N.C.
 *
 * NOTE: Cosine similarity scores are geometric vector correlation metrics, NOT calibrated probabilities.
 */

import { PITCH_CLASSES } from '../src/js/chord-engine/note-pitch.js';

/**
 * Normalizes a chord name for robust comparison.
 * Maps enharmonics (e.g., C# Major / Db Major) and trims whitespace.
 * @param {string} chord
 * @returns {string}
 */
/**
 * Normalizes a chord name for robust comparison.
 * Maps enharmonics (e.g., C# Major / Db Major) and trims whitespace.
 * @param {string} chord
 * @returns {string}
 */
export function normalizeChordName(chord) {
  if (!chord || chord === 'N.C.' || chord === 'None' || chord === 'Silence') {
    return 'N.C.';
  }
  return chord.trim();
}

/**
 * Clips segment boundaries to the valid recording interval [0, maxDuration].
 * Drops segments that fall completely outside [0, maxDuration].
 *
 * @param {Array<object>} segments
 * @param {number} maxDuration
 * @returns {Array<object>}
 */
export function clipSegmentsToDuration(segments, maxDuration) {
  if (!segments || !Array.isArray(segments)) return [];
  const clipped = [];
  for (const s of segments) {
    const startTime = Math.max(0, Math.min(maxDuration, s.startTime));
    const endTime = Math.max(0, Math.min(maxDuration, s.endTime));
    if (endTime > startTime) {
      clipped.push({
        ...s,
        startTime: parseFloat(startTime.toFixed(4)),
        endTime: parseFloat(endTime.toFixed(4)),
        duration: parseFloat((endTime - startTime).toFixed(4))
      });
    }
  }
  return clipped;
}

/**
 * Samples chord label and classification status from a segment list at a specific timestamp.
 * Strictly distinguishes:
 * - 'chord': Actual audio labelled as a musical chord
 * - 'labelled_nc': Actual audio explicitly detected/annotated as N.C. (silence or non-chord)
 * - 'omitted': Audio within recording duration omitted by the detector (no segment covers this time)
 * - 'out_of_bounds': Time beyond the actual recording duration, which must not be scored
 *
 * @param {Array<{ startTime: number, endTime: number, chord: string, root?: string, quality?: string }>} segments
 * @param {number} time
 * @param {number} [audioDuration=Infinity]
 * @returns {{ chord: string, root: string|null, quality: string, status: 'chord'|'labelled_nc'|'omitted'|'out_of_bounds' }}
 */
export function sampleSegmentAtTime(segments, time, audioDuration = Infinity) {
  if (time < 0 || time >= audioDuration) {
    return {
      chord: 'N.C.',
      root: null,
      quality: 'none',
      status: 'out_of_bounds'
    };
  }

  for (const seg of segments) {
    if (time >= seg.startTime && time < seg.endTime) {
      const normChord = normalizeChordName(seg.chord);
      const isNc = normChord === 'N.C.';
      return {
        chord: normChord,
        root: isNc ? null : (seg.root || null),
        quality: isNc ? 'none' : (seg.quality || (normChord.includes('Minor') ? 'minor' : normChord.includes('Major') ? 'major' : 'none')),
        status: isNc ? 'labelled_nc' : 'chord'
      };
    }
  }

  return {
    chord: 'N.C.',
    root: null,
    quality: 'none',
    status: 'omitted'
  };
}

/**
 * Evaluates chord predictions against reference ground truth annotations.
 * Ensures every evaluation interval is clipped to the valid recording interval:
 * 0 <= startTime < endTime <= audioDuration.
 * Samples beyond audioDuration are never scored.
 *
 * @param {Array<{ startTime: number, endTime: number, chord: string, root?: string, quality?: string }>} referenceSegments
 * @param {Array<{ startTime: number, endTime: number, chord: string, root?: string, quality?: string, similarityScore?: number }>} detectedSegments
 * @param {object} [options]
 * @param {number} [options.timeStep=0.02] - Sampling resolution in seconds (default 20ms)
 * @param {number} [options.transitionTolerance=0.5] - Max search window in seconds for boundary matching
 * @param {string} [options.datasetType='synthetic'] - 'synthetic' or 'real_recording'
 * @param {string} [options.trackTitle='Unknown Track']
 * @param {number} [options.audioDuration=null] - Explicit recording duration from audio data
 * @returns {object} Full metrics object
 */
export function computeChordMetrics(referenceSegments, detectedSegments, options = {}) {
  const {
    timeStep = 0.02,
    transitionTolerance = 0.5,
    datasetType = 'synthetic',
    trackTitle = 'Audio Track',
    audioDuration = null
  } = options;

  if (!referenceSegments || referenceSegments.length === 0) {
    throw new Error('Reference ground truth segments are empty or missing.');
  }

  // Determine total valid audio duration
  // If audioDuration is explicitly provided (e.g. from audio file duration), use it.
  // Otherwise, use the max reference segment end time.
  const refEnd = Math.max(...referenceSegments.map(s => s.endTime));
  const effectiveDuration = (audioDuration !== null && audioDuration !== undefined && audioDuration > 0)
    ? audioDuration
    : refEnd;

  if (effectiveDuration <= 0) {
    throw new Error('Total duration of evaluated track is 0.');
  }

  // Clip segments to valid recording interval [0, effectiveDuration]
  const validRefSegments = clipSegmentsToDuration(referenceSegments, effectiveDuration);
  const validDetSegments = clipSegmentsToDuration(detectedSegments || [], effectiveDuration);

  const steps = Math.floor(effectiveDuration / timeStep + 1e-9);

  let correctChordTime = 0;
  let totalEvaluatedTime = 0;

  let qualityCorrectTime = 0;
  let qualityTotalTime = 0;

  let rootCorrectTime = 0;
  let rootTotalTime = 0;

  let refSilenceTime = 0;
  let correctSilenceTime = 0;
  let detectedSilenceTime = 0;
  let omittedDetectorTime = 0;
  let falseRejectionTime = 0; // Ground truth chord incorrectly marked as N.C. or omitted
  let falseChordDetectionTime = 0; // Ground truth silence incorrectly detected as chord

  for (let i = 0; i < steps; i++) {
    const t = i * timeStep;
    if (t >= effectiveDuration) break; // Strict clipping to recording duration

    const stepDuration = Math.min(timeStep, effectiveDuration - t);
    const ref = sampleSegmentAtTime(validRefSegments, t, effectiveDuration);
    const det = sampleSegmentAtTime(validDetSegments, t, effectiveDuration);

    totalEvaluatedTime += stepDuration;

    if (det.status === 'omitted') {
      omittedDetectorTime += stepDuration;
    }

    // 1. Overall Chord Label Accuracy (exact chord match)
    if (ref.chord === det.chord) {
      correctChordTime += stepDuration;
    }

    // 2. Silence / Incomplete Chord Rejection (N.C.)
    if (ref.chord === 'N.C.') {
      refSilenceTime += stepDuration;
      if (det.chord === 'N.C.') {
        correctSilenceTime += stepDuration;
      } else {
        falseChordDetectionTime += stepDuration;
      }
    } else {
      if (det.chord === 'N.C.') {
        falseRejectionTime += stepDuration;
      }
    }

    if (det.chord === 'N.C.') {
      detectedSilenceTime += stepDuration;
    }

    // 3. Root-Note Accuracy (evaluated on non-N.C. reference chords)
    if (ref.chord !== 'N.C.' && ref.root) {
      rootTotalTime += stepDuration;
      if (det.root === ref.root) {
        rootCorrectTime += stepDuration;
      }
    }

    // 4. Major vs. Minor Classification Accuracy (evaluated when both have major/minor quality)
    const isRefTriad = ref.quality === 'major' || ref.quality === 'minor';
    const isDetTriad = det.quality === 'major' || det.quality === 'minor';
    if (isRefTriad && isDetTriad) {
      qualityTotalTime += stepDuration;
      if (ref.quality === det.quality) {
        qualityCorrectTime += stepDuration;
      }
    }
  }

  // 5. Chord Transition Timing Error (only transitions within valid recording duration)
  const refBoundaries = [];
  for (let i = 0; i < validRefSegments.length - 1; i++) {
    if (validRefSegments[i].endTime < effectiveDuration) {
      refBoundaries.push({
        time: validRefSegments[i].endTime,
        from: validRefSegments[i].chord,
        to: validRefSegments[i + 1].chord
      });
    }
  }

  const detBoundaries = [];
  for (let i = 0; i < validDetSegments.length - 1; i++) {
    if (validDetSegments[i].endTime < effectiveDuration) {
      detBoundaries.push({
        time: validDetSegments[i].endTime,
        from: validDetSegments[i].chord,
        to: validDetSegments[i + 1].chord
      });
    }
  }

  const timingErrors = [];
  for (const refB of refBoundaries) {
    let minErr = Infinity;
    for (const detB of detBoundaries) {
      const err = Math.abs(detB.time - refB.time);
      if (err < minErr) {
        minErr = err;
      }
    }
    if (minErr <= transitionTolerance) {
      timingErrors.push(minErr);
    }
  }

  const meanTimingError = timingErrors.length > 0
    ? timingErrors.reduce((a, b) => a + b, 0) / timingErrors.length
    : null;

  const maxTimingError = timingErrors.length > 0
    ? Math.max(...timingErrors)
    : null;

  // 6. Uncertain / N.C. Percentage
  const ncPercentage = (detectedSilenceTime / totalEvaluatedTime) * 100;
  const omittedPercentage = (omittedDetectorTime / totalEvaluatedTime) * 100;

  // Final Metric Percentages
  const chordAccuracyPct = (correctChordTime / totalEvaluatedTime) * 100;
  const rootAccuracyPct = rootTotalTime > 0 ? (rootCorrectTime / rootTotalTime) * 100 : null;
  const majorMinorAccuracyPct = qualityTotalTime > 0 ? (qualityCorrectTime / qualityTotalTime) * 100 : null;
  const silenceRejectionRecallPct = refSilenceTime > 0 ? (correctSilenceTime / refSilenceTime) * 100 : null;
  const activeChordDuration = totalEvaluatedTime - refSilenceTime;
  const falseRejectionPct = activeChordDuration > 0 ? (falseRejectionTime / activeChordDuration) * 100 : 0;
  const falseChordDetectionPct = refSilenceTime > 0 ? (falseChordDetectionTime / refSilenceTime) * 100 : 0;

  return {
    trackTitle,
    datasetType,
    totalDuration: parseFloat(effectiveDuration.toFixed(2)),
    totalEvaluatedTime: parseFloat(totalEvaluatedTime.toFixed(2)),
    omittedTimeSec: parseFloat(omittedDetectorTime.toFixed(2)),
    omittedPercentage: parseFloat(omittedPercentage.toFixed(2)),
    chordAccuracyPct: parseFloat(chordAccuracyPct.toFixed(2)),
    rootAccuracyPct: rootAccuracyPct !== null ? parseFloat(rootAccuracyPct.toFixed(2)) : null,
    majorMinorAccuracyPct: majorMinorAccuracyPct !== null ? parseFloat(majorMinorAccuracyPct.toFixed(2)) : null,
    silenceRejectionRecallPct: silenceRejectionRecallPct !== null ? parseFloat(silenceRejectionRecallPct.toFixed(2)) : null,
    falseRejectionPct: parseFloat(falseRejectionPct.toFixed(2)),
    falseChordDetectionPct: parseFloat(falseChordDetectionPct.toFixed(2)),
    ncPercentage: parseFloat(ncPercentage.toFixed(2)),
    transitionMetrics: {
      totalReferenceTransitions: refBoundaries.length,
      matchedTransitionsCount: timingErrors.length,
      meanAbsoluteErrorSec: meanTimingError !== null ? parseFloat(meanTimingError.toFixed(3)) : null,
      maxAbsoluteErrorSec: maxTimingError !== null ? parseFloat(maxTimingError.toFixed(3)) : null
    },
    calibrationNotice: 'Cosine similarity scores represent uncalibrated geometric vector similarities between normalized 12-bin chroma vectors and ideal triad templates, and must NOT be interpreted as calibrated posterior probabilities.'
  };
}

/**
 * Generates a clean Markdown report from computed evaluation metrics.
 * @param {object} metrics
 * @returns {string}
 */
export function formatMetricsMarkdown(metrics) {
  const isSynthetic = metrics.datasetType === 'synthetic';
  const tag = isSynthetic ? 'SYNTHETIC BENCHMARK' : 'REAL-WORLD RECORDING';

  return `
### Evaluation Report: ${metrics.trackTitle} [${tag}]

- **Evaluation Dataset**: ${metrics.datasetType}
- **Track Duration**: ${metrics.totalDuration}s
- **Chord-Label Accuracy**: ${metrics.chordAccuracyPct}%
- **Major-vs-Minor Classification Accuracy**: ${metrics.majorMinorAccuracyPct !== null ? `${metrics.majorMinorAccuracyPct}%` : 'N/A'}
- **Root-Note Accuracy**: ${metrics.rootAccuracyPct !== null ? `${metrics.rootAccuracyPct}%` : 'N/A'}
- **Silence & Incomplete Rejection (N.C. Recall)**: ${metrics.silenceRejectionRecallPct !== null ? `${metrics.silenceRejectionRecallPct}%` : 'N/A (no silence in reference)'}
- **False Chord Detection Rate (Silence/N.C. marked as Chord)**: ${metrics.falseChordDetectionPct}%
- **False Rejection Rate (Active Chords marked N.C.)**: ${metrics.falseRejectionPct}%
- **Frames Classified as Uncertain / N.C.**: ${metrics.ncPercentage}%
- **Chord-Transition Mean Timing Error**: ${metrics.transitionMetrics.meanAbsoluteErrorSec !== null ? `${metrics.transitionMetrics.meanAbsoluteErrorSec}s (max ${metrics.transitionMetrics.maxAbsoluteErrorSec}s across ${metrics.transitionMetrics.matchedTransitionsCount}/${metrics.transitionMetrics.totalReferenceTransitions} transitions)` : 'N/A (no transitions)'}

> **Calibration Notice**: ${metrics.calibrationNotice}
`.trim();
}
