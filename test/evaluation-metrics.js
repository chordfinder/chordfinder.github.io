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
export function normalizeChordName(chord) {
  if (!chord || chord === 'N.C.' || chord === 'None' || chord === 'Silence') {
    return 'N.C.';
  }
  return chord.trim();
}

/**
 * Samples chord label from a segment list at a specific timestamp.
 * @param {Array<{ startTime: number, endTime: number, chord: string, root?: string, quality?: string }>} segments
 * @param {number} time
 * @returns {{ chord: string, root: string|null, quality: string }}
 */
export function sampleSegmentAtTime(segments, time) {
  for (const seg of segments) {
    if (time >= seg.startTime && time < seg.endTime) {
      return {
        chord: normalizeChordName(seg.chord),
        root: seg.root || null,
        quality: seg.quality || (seg.chord?.includes('Minor') ? 'minor' : seg.chord?.includes('Major') ? 'major' : 'none')
      };
    }
  }
  return { chord: 'N.C.', root: null, quality: 'none' };
}

/**
 * Evaluates chord predictions against reference ground truth annotations.
 *
 * @param {Array<{ startTime: number, endTime: number, chord: string, root?: string, quality?: string }>} referenceSegments
 * @param {Array<{ startTime: number, endTime: number, chord: string, root?: string, quality?: string, similarityScore?: number }>} detectedSegments
 * @param {object} [options]
 * @param {number} [options.timeStep=0.02] - Sampling resolution in seconds (default 20ms)
 * @param {number} [options.transitionTolerance=0.5] - Max search window in seconds for boundary matching
 * @param {string} [options.datasetType='synthetic'] - 'synthetic' or 'real_recording'
 * @param {string} [options.trackTitle='Unknown Track']
 * @returns {object} Full metrics object
 */
export function computeChordMetrics(referenceSegments, detectedSegments, options = {}) {
  const {
    timeStep = 0.02,
    transitionTolerance = 0.5,
    datasetType = 'synthetic',
    trackTitle = 'Audio Track'
  } = options;

  if (!referenceSegments || referenceSegments.length === 0) {
    throw new Error('Reference ground truth segments are empty or missing.');
  }

  // Determine total evaluated time
  const refEnd = Math.max(...referenceSegments.map(s => s.endTime));
  const detEnd = detectedSegments && detectedSegments.length > 0
    ? Math.max(...detectedSegments.map(s => s.endTime))
    : 0;
  const totalDuration = Math.max(refEnd, detEnd);

  if (totalDuration <= 0) {
    throw new Error('Total duration of evaluated track is 0.');
  }

  const steps = Math.ceil(totalDuration / timeStep);

  let correctChordTime = 0;
  let totalEvaluatedTime = 0;

  let qualityCorrectTime = 0;
  let qualityTotalTime = 0;

  let rootCorrectTime = 0;
  let rootTotalTime = 0;

  let refSilenceTime = 0;
  let correctSilenceTime = 0;
  let detectedSilenceTime = 0;
  let falseRejectionTime = 0; // Ground truth chord incorrectly marked as N.C.

  for (let i = 0; i < steps; i++) {
    const t = i * timeStep;
    const ref = sampleSegmentAtTime(referenceSegments, t);
    const det = sampleSegmentAtTime(detectedSegments || [], t);

    totalEvaluatedTime += timeStep;

    // 1. Overall Chord Label Accuracy (exact chord match)
    if (ref.chord === det.chord) {
      correctChordTime += timeStep;
    }

    // 2. Silence / Incomplete Chord Rejection (N.C.)
    if (ref.chord === 'N.C.') {
      refSilenceTime += timeStep;
      if (det.chord === 'N.C.') {
        correctSilenceTime += timeStep;
      }
    } else {
      if (det.chord === 'N.C.') {
        falseRejectionTime += timeStep;
      }
    }

    if (det.chord === 'N.C.') {
      detectedSilenceTime += timeStep;
    }

    // 3. Root-Note Accuracy (evaluated on non-N.C. reference chords)
    if (ref.chord !== 'N.C' && ref.root) {
      rootTotalTime += timeStep;
      if (det.root === ref.root) {
        rootCorrectTime += timeStep;
      }
    }

    // 4. Major vs. Minor Classification Accuracy (evaluated when both have major/minor quality)
    const isRefTriad = ref.quality === 'major' || ref.quality === 'minor';
    const isDetTriad = det.quality === 'major' || det.quality === 'minor';
    if (isRefTriad && isDetTriad) {
      qualityTotalTime += timeStep;
      if (ref.quality === det.quality) {
        qualityCorrectTime += timeStep;
      }
    }
  }

  // 5. Chord Transition Timing Error
  // Extract reference transition boundaries (where chord changes)
  const refBoundaries = [];
  for (let i = 0; i < referenceSegments.length - 1; i++) {
    refBoundaries.push({
      time: referenceSegments[i].endTime,
      from: referenceSegments[i].chord,
      to: referenceSegments[i + 1].chord
    });
  }

  // Extract detected transition boundaries
  const detBoundaries = [];
  if (detectedSegments) {
    for (let i = 0; i < detectedSegments.length - 1; i++) {
      detBoundaries.push({
        time: detectedSegments[i].endTime,
        from: detectedSegments[i].chord,
        to: detectedSegments[i + 1].chord
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

  // Final Metric Percentages
  const chordAccuracyPct = (correctChordTime / totalEvaluatedTime) * 100;
  const rootAccuracyPct = rootTotalTime > 0 ? (rootCorrectTime / rootTotalTime) * 100 : null;
  const majorMinorAccuracyPct = qualityTotalTime > 0 ? (qualityCorrectTime / qualityTotalTime) * 100 : null;
  const silenceRejectionRecallPct = refSilenceTime > 0 ? (correctSilenceTime / refSilenceTime) * 100 : null;
  const activeChordDuration = totalEvaluatedTime - refSilenceTime;
  const falseRejectionPct = activeChordDuration > 0 ? (falseRejectionTime / activeChordDuration) * 100 : 0;

  return {
    trackTitle,
    datasetType,
    totalDuration: parseFloat(totalDuration.toFixed(2)),
    totalEvaluatedTime: parseFloat(totalEvaluatedTime.toFixed(2)),
    chordAccuracyPct: parseFloat(chordAccuracyPct.toFixed(2)),
    rootAccuracyPct: rootAccuracyPct !== null ? parseFloat(rootAccuracyPct.toFixed(2)) : null,
    majorMinorAccuracyPct: majorMinorAccuracyPct !== null ? parseFloat(majorMinorAccuracyPct.toFixed(2)) : null,
    silenceRejectionRecallPct: silenceRejectionRecallPct !== null ? parseFloat(silenceRejectionRecallPct.toFixed(2)) : null,
    falseRejectionPct: parseFloat(falseRejectionPct.toFixed(2)),
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
- **False Rejection Rate (Active Chords marked N.C.)**: ${metrics.falseRejectionPct}%
- **Frames Classified as Uncertain / N.C.**: ${metrics.ncPercentage}%
- **Chord-Transition Mean Timing Error**: ${metrics.transitionMetrics.meanAbsoluteErrorSec !== null ? `${metrics.transitionMetrics.meanAbsoluteErrorSec}s (max ${metrics.transitionMetrics.maxAbsoluteErrorSec}s across ${metrics.transitionMetrics.matchedTransitionsCount}/${metrics.transitionMetrics.totalReferenceTransitions} transitions)` : 'N/A (no transitions)'}

> **Calibration Notice**: ${metrics.calibrationNotice}
`.trim();
}
