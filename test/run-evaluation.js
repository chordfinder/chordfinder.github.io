/**
 * ChordFinder - Reproducible Evaluation Procedure & Benchmark Runner
 *
 * Runs offline evaluation against audio files with ground-truth chord annotations.
 * Maintains strict separation between Synthetic Benchmarks and Real-World Recordings.
 *
 * Supported Ground Truth Annotation format (.json):
 * {
 *   "fileName": "guitar_c_g_am.wav",
 *   "category": "clean_acoustic_guitar", // or "clean_piano", "multi_instrument", "silence_transitions", "inversions_voicings"
 *   "duration": 12.0,
 *   "sampleRate": 44100,
 *   "segments": [
 *     { "startTime": 0.0, "endTime": 3.0, "chord": "C Major", "root": "C", "quality": "major" },
 *     ...
 *   ]
 * }
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseWavBuffer } from './wav-utils.js';
import { extractChromagram } from '../src/js/chord-engine/chromagram.js';
import { matchChord, segmentChords } from '../src/js/chord-engine/chord-matcher.js';
import { computeChordMetrics, formatMetricsMarkdown } from './evaluation-metrics.js';

export const EVALUATION_CATEGORIES = {
  1: { id: 'clean_acoustic_guitar', name: 'Clean acoustic guitar' },
  2: { id: 'clean_piano', name: 'Clean piano' },
  3: { id: 'multi_instrument', name: 'Recording containing multiple instruments' },
  4: { id: 'silence_transitions', name: 'Recordings containing silence and chord transitions' },
  5: { id: 'inversions_voicings', name: 'Recordings with inversions or unusual chord voicings' }
};

/**
 * Runs evaluation on a single audio file and its matching ground-truth JSON annotation.
 */
export async function evaluateAudioFile(audioFilePath, annotationPath) {
  const annotationRaw = fs.readFileSync(annotationPath, 'utf-8');
  const annotation = JSON.parse(annotationRaw);

  const audioBuffer = fs.readFileSync(audioFilePath);
  const { samples, sampleRate, duration } = parseWavBuffer(audioBuffer);

  const frameSize = 8192;
  const hopSize = 4096;
  const hopDuration = hopSize / sampleRate;

  const chromaFrames = await extractChromagram(samples, sampleRate, {
    frameSize,
    hopSize
  });

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

  const detectedSegments = segmentChords(framePredictions, hopDuration, {
    minSegmentDuration: 0.45
  });

  const isReal = annotation.category && Object.values(EVALUATION_CATEGORIES).some(c => c.id === annotation.category);
  const datasetType = isReal ? 'real_recording' : 'synthetic';

  const metrics = computeChordMetrics(annotation.segments, detectedSegments, {
    datasetType,
    trackTitle: annotation.fileName || path.basename(audioFilePath)
  });

  return { metrics, detectedSegments, referenceSegments: annotation.segments };
}

/**
 * Main evaluation suite runner.
 */
export async function runEvaluationSuite() {
  console.log('===============================================================');
  console.log('       CHORDFINDER AUDIO EVALUATION RUNNER (PHASE 2.2)');
  console.log('===============================================================\n');

  // Check 1: Synthetic Benchmarks in test/fixtures/
  const fixturesDir = path.resolve('test/fixtures');
  const syntheticFiles = fs.existsSync(fixturesDir)
    ? fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json') && !f.includes('invalid'))
    : [];

  console.log('--- PART 1: SYNTHETIC BENCHMARK EVALUATIONS ---');
  if (syntheticFiles.length === 0) {
    console.log('No synthetic benchmarks found in test/fixtures/');
  } else {
    for (const jsonFile of syntheticFiles) {
      const annotPath = path.join(fixturesDir, jsonFile);
      const annot = JSON.parse(fs.readFileSync(annotPath, 'utf-8'));
      const wavPath = path.join(fixturesDir, annot.fileName);
      if (fs.existsSync(wavPath)) {
        const { metrics } = await evaluateAudioFile(wavPath, annotPath);
        console.log(formatMetricsMarkdown(metrics));
        console.log('\n---------------------------------------------------------------\n');
      }
    }
  }

  // Check 2: Real-World Recordings in test/recordings/
  console.log('--- PART 2: REAL-WORLD RECORDING EVALUATIONS ---');
  const recordingsDir = path.resolve('test/recordings');

  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  const realJsonFiles = fs.readdirSync(recordingsDir).filter(f => f.endsWith('.json'));

  if (realJsonFiles.length === 0) {
    console.log('STATUS: No local real musical recordings found in test/recordings/.');
    console.log('REAL-WORLD ACCURACY REMAINS UNMEASURED.\n');
    console.log('Evaluation Procedure for Real Recordings:');
    console.log('1. Place uncompressed PCM .wav recordings into `test/recordings/`.');
    console.log('2. Provide a matching `<filename>.json` with ground truth reference segments:');
    console.log('   {');
    console.log('     "fileName": "my_guitar_track.wav",');
    console.log('     "category": "clean_acoustic_guitar", // options: clean_acoustic_guitar, clean_piano, multi_instrument, silence_transitions, inversions_voicings');
    console.log('     "segments": [');
    console.log('       { "startTime": 0.0, "endTime": 2.5, "chord": "C Major", "root": "C", "quality": "major" }');
    console.log('     ]');
    console.log('   }');
    console.log('3. Run `node test/run-evaluation.js` to execute automated scoring.\n');
    console.log('Categories required for full evaluation:');
    for (const [num, cat] of Object.entries(EVALUATION_CATEGORIES)) {
      console.log(`   ${num}. ${cat.name} (${cat.id})`);
    }
    console.log('\nReal-world measurements are postponed until actual files are supplied.');
  } else {
    for (const jsonFile of realJsonFiles) {
      const annotPath = path.join(recordingsDir, jsonFile);
      const annot = JSON.parse(fs.readFileSync(annotPath, 'utf-8'));
      const wavPath = path.join(recordingsDir, annot.fileName);
      if (fs.existsSync(wavPath)) {
        const { metrics } = await evaluateAudioFile(wavPath, annotPath);
        console.log(formatMetricsMarkdown(metrics));
        console.log('\n---------------------------------------------------------------\n');
      } else {
        console.warn(`Warning: Annotation file ${jsonFile} specified ${annot.fileName}, but audio file was not found.`);
      }
    }
  }

  console.log('\n===============================================================');
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('run-evaluation.js')) {
  runEvaluationSuite().catch(err => {
    console.error('Evaluation runner failed:', err);
    process.exit(1);
  });
}
