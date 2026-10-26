/**
 * ChordFinder - Main UI Coordinator
 * Handles file drag-and-drop, audio decoding, DSP pipeline execution,
 * interactive timeline rendering, and synchronized playback.
 */

import {
  validateAudioFile,
  decodeAudioFile,
  formatBytes,
  formatTime
} from '../audio/audio-manager.js';

import { extractChromagram } from '../chord-engine/chromagram.js';
import {
  matchChord,
  segmentChords,
  smoothFramePredictions,
  BASIC_TEMPLATES,
  getFrameDiagnosticsAtTime
} from '../chord-engine/chord-matcher.js';
import { PITCH_CLASSES } from '../chord-engine/note-pitch.js';

// DOM Elements: Upload & File Card
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const fileCard = document.getElementById('file-card');
const emptyUploadState = document.getElementById('empty-upload-state');

// File Info Elements
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const fileFormatEl = document.getElementById('file-format');
const audioDurationEl = document.getElementById('audio-duration');
const audioSampleRateEl = document.getElementById('audio-samplerate');
const audioChannelsEl = document.getElementById('audio-channels');
const removeFileBtn = document.getElementById('remove-file-btn');

// Audio Player & Controls
const audioPreviewCard = document.getElementById('audio-preview-card');
const audioPlayer = document.getElementById('audio-player');
const analyzeBtn = document.getElementById('analyze-btn');

// Notifications & Live Regions
const statusArea = document.getElementById('status-area');
const alertBanner = document.getElementById('alert-banner');
const alertMessage = document.getElementById('alert-message');
const alertDismiss = document.getElementById('alert-dismiss');
const phaseNotice = document.getElementById('phase-notice');
const phaseNoticeText = document.getElementById('phase-notice-text');

// Results Panel Elements
const chordAnalysisSection = document.getElementById('chord-analysis-section');
const analysisStatusBadge = document.getElementById('analysis-status-badge');
const resultsEmptyState = document.getElementById('results-empty-state');
const resultsProgressState = document.getElementById('results-progress-state');
const resultsActiveState = document.getElementById('results-active-state');
const resultsErrorState = document.getElementById('results-error-state');

// Progress State Elements
const progressFill = document.getElementById('progress-fill');
const progressPercentageText = document.getElementById('progress-percentage-text');
const progressFramesText = document.getElementById('progress-frames-text');
const progressStatusLabel = document.getElementById('progress-status-label');
const cancelAnalysisBtn = document.getElementById('cancel-analysis-btn');

// Results Active State Elements
const summarySegmentsCount = document.getElementById('summary-segments-count');
const uniqueChordsContainer = document.getElementById('unique-chords-container');
const timelineBar = document.getElementById('timeline-bar');
const chordSegmentsList = document.getElementById('chord-segments-list');
const timelineCurrentTime = document.getElementById('timeline-current-time');

// Error State Elements
const analysisErrorText = document.getElementById('analysis-error-text');
const retryAnalysisBtn = document.getElementById('retry-analysis-btn');

// Diagnostic Panel Elements
const diagnosticToggleBtn = document.getElementById('diagnostic-toggle-btn');
const diagnosticToggleStatus = document.getElementById('diagnostic-toggle-status');
const diagnosticPanel = document.getElementById('diagnostic-panel');
const diagFollowPlayback = document.getElementById('diag-follow-playback');
const diagExportJsonBtn = document.getElementById('diag-export-json-btn');
const diagFrameIndex = document.getElementById('diag-frame-index');
const diagTotalFrames = document.getElementById('diag-total-frames');
const diagTimestamp = document.getElementById('diag-timestamp');
const diagPrevFrameBtn = document.getElementById('diag-prev-frame-btn');
const diagNextFrameBtn = document.getElementById('diag-next-frame-btn');
const diagFrameSlider = document.getElementById('diag-frame-slider');
const diagJumpSmoothedBtn = document.getElementById('diag-jump-smoothed-btn');
const diagJumpRejectedBtn = document.getElementById('diag-jump-rejected-btn');
const diagJumpAmbiguousBtn = document.getElementById('diag-jump-ambiguous-btn');

const diagRmsValue = document.getElementById('diag-rms-value');
const diagSilenceBadge = document.getElementById('diag-silence-badge');
const diagFinalDecisionBadge = document.getElementById('diag-final-decision-badge');
const diagChordQuality = document.getElementById('diag-chord-quality');
const diagFinalSegmentBadge = document.getElementById('diag-final-segment-badge');
const diagSegmentRange = document.getElementById('diag-segment-range');
const diagSmoothingBadge = document.getElementById('diag-smoothing-badge');
const diagSmoothingDetails = document.getElementById('diag-smoothing-details');
const diagConsistencyBadge = document.getElementById('diag-consistency-badge');
const diagConsistencyExplanation = document.getElementById('diag-consistency-explanation');
const diagDecisionReason = document.getElementById('diag-decision-reason');

const diagCand1Score = document.getElementById('diag-cand-1-score');
const diagCand1Name = document.getElementById('diag-cand-1-name');
const diagCand1Details = document.getElementById('diag-cand-1-details');
const diagCand2Score = document.getElementById('diag-cand-2-score');
const diagCand2Name = document.getElementById('diag-cand-2-name');
const diagCand2Details = document.getElementById('diag-cand-2-details');
const diagCand3Score = document.getElementById('diag-cand-3-score');
const diagCand3Name = document.getElementById('diag-cand-3-name');
const diagCand3Details = document.getElementById('diag-cand-3-details');

const diagScoreDelta = document.getElementById('diag-score-delta');
const diagScoreDeltaLabel = document.getElementById('diag-score-delta-label');
const diagTriadCompleteness = document.getElementById('diag-triad-completeness');
const diagTriadNotesBreakdown = document.getElementById('diag-triad-notes-breakdown');
const diagNonchordRatio = document.getElementById('diag-nonchord-ratio');
const diagNonchordStatus = document.getElementById('diag-nonchord-status');
const diagChromaBinsContainer = document.getElementById('diag-chroma-bins-container');
const diagPeaksTbody = document.getElementById('diag-peaks-tbody');

// State
let currentFile = null;
let currentObjectUrl = null;
let currentDecodedData = null;
let isProcessing = false;
let analysisCancelled = false;
let currentSegments = [];
let activeSegmentIndex = -1;

// Diagnostic State
let isDiagnosticMode = false;
let currentFrameDiagnostics = [];
let selectedDiagFrameIndex = 0;
let followPlayback = true;

/**
 * Initializes UI event listeners.
 */
function init() {
  setupEventListeners();
  initDiagnosticMode();
  if (chordAnalysisSection) {
    chordAnalysisSection.classList.add('hidden');
  }
  updateUiState();
}

/**
 * Sets up all DOM event listeners.
 */
function setupEventListeners() {
  // Browse button trigger
  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  // Drop zone click triggers file input if no file is loaded
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => {
      if (!currentFile) {
        fileInput.click();
      }
    });

    // Keyboard support for drop zone
    dropZone.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !currentFile) {
        e.preventDefault();
        fileInput.click();
      }
    });
  }

  // File input change
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        handleFileSelection(file);
      }
    });
  }

  // Drag and Drop
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, handleDragOver, false);
    });

    ['dragleave', 'dragend'].forEach(eventName => {
      dropZone.addEventListener(eventName, handleDragLeave, false);
    });

    dropZone.addEventListener('drop', handleDrop, false);
  }

  // Prevent default drag/drop behaviors on window to prevent accidental navigation
  window.addEventListener('dragover', (e) => e.preventDefault(), false);
  window.addEventListener('drop', (e) => e.preventDefault(), false);

  // Remove file button
  if (removeFileBtn) {
    removeFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetFileSelection();
    });
  }

  // Alert dismiss button
  if (alertDismiss) {
    alertDismiss.addEventListener('click', () => {
      hideAlert();
    });
  }

  // Analyze Audio button
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', handleAnalyzeAudio);
  }

  // Cancel Analysis button
  if (cancelAnalysisBtn) {
    cancelAnalysisBtn.addEventListener('click', handleCancelAnalysis);
  }

  // Retry Analysis button
  if (retryAnalysisBtn) {
    retryAnalysisBtn.addEventListener('click', handleAnalyzeAudio);
  }

  // Audio Player Timeupdate for synchronized timeline highlight
  if (audioPlayer) {
    audioPlayer.addEventListener('timeupdate', handleAudioTimeUpdate);
  }

  // Diagnostic Mode Toggle Button
  if (diagnosticToggleBtn) {
    diagnosticToggleBtn.addEventListener('click', () => {
      toggleDiagnosticMode();
    });
  }

  // Diagnostic Frame Scrubber Slider
  if (diagFrameSlider) {
    diagFrameSlider.addEventListener('input', (e) => {
      const idx = parseInt(e.target.value, 10);
      renderDiagnosticFrame(idx);
    });
  }

  // Diagnostic Frame Step Buttons
  if (diagPrevFrameBtn) {
    diagPrevFrameBtn.addEventListener('click', () => {
      if (selectedDiagFrameIndex > 0) {
        renderDiagnosticFrame(selectedDiagFrameIndex - 1);
      }
    });
  }

  if (diagNextFrameBtn) {
    diagNextFrameBtn.addEventListener('click', () => {
      if (selectedDiagFrameIndex < currentFrameDiagnostics.length - 1) {
        renderDiagnosticFrame(selectedDiagFrameIndex + 1);
      }
    });
  }

  // Diagnostic Quick Jump Problem Buttons
  if (diagJumpSmoothedBtn) {
    diagJumpSmoothedBtn.addEventListener('click', () => {
      jumpToNextProblemFrame(f => f.wasSmoothed);
    });
  }

  if (diagJumpRejectedBtn) {
    diagJumpRejectedBtn.addEventListener('click', () => {
      jumpToNextProblemFrame(f => f.chord === 'N.C.' || f.diagnostics?.decision === 'rejected');
    });
  }

  if (diagJumpAmbiguousBtn) {
    diagJumpAmbiguousBtn.addEventListener('click', () => {
      jumpToNextProblemFrame(f => !f.isSilent && f.diagnostics?.scoreDelta < 0.10);
    });
  }

  // Diagnostic Follow Playback Checkbox
  if (diagFollowPlayback) {
    diagFollowPlayback.addEventListener('change', (e) => {
      followPlayback = Boolean(e.target.checked);
    });
  }

  // Diagnostic Export Frame JSON Button
  if (diagExportJsonBtn) {
    diagExportJsonBtn.addEventListener('click', handleExportFrameJson);
  }
}

/**
 * Handles dragenter / dragover event.
 * @param {DragEvent} e
 */
function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  if (!currentFile) {
    dropZone.classList.add('border-purple-500', 'bg-purple-950/20', 'scale-[1.01]');
    dropZone.classList.remove('border-slate-700/80', 'bg-slate-900/50');
  }
}

/**
 * Handles dragleave / dragend event.
 * @param {DragEvent} e
 */
function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  if (!currentFile) {
    dropZone.classList.remove('border-purple-500', 'bg-purple-950/20', 'scale-[1.01]');
    dropZone.classList.add('border-slate-700/80', 'bg-slate-900/50');
  }
}

/**
 * Handles drop event.
 * @param {DragEvent} e
 */
function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  handleDragLeave(e);

  const dt = e.dataTransfer;
  const file = dt?.files && dt.files[0];
  if (file) {
    handleFileSelection(file);
  }
}

/**
 * Processes and validates a newly selected audio file.
 * @param {File} file
 */
async function handleFileSelection(file) {
  hideAlert();
  hidePhaseNotice();
  resetResultsView();
  if (chordAnalysisSection) {
    chordAnalysisSection.classList.add('hidden');
  }

  const validation = validateAudioFile(file);
  if (!validation.valid) {
    showAlert(validation.error || 'Invalid audio file.');
    announceStatus(`Error: ${validation.error}`);
    return;
  }

  // Cleanup prior object URL
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }

  currentFile = file;
  currentObjectUrl = URL.createObjectURL(file);
  currentDecodedData = null;

  // Display initial basic info
  if (fileNameEl) fileNameEl.textContent = file.name;
  if (fileSizeEl) fileSizeEl.textContent = formatBytes(file.size);
  if (fileFormatEl) fileFormatEl.textContent = file.type || file.name.split('.').pop().toUpperCase();
  if (audioDurationEl) audioDurationEl.textContent = 'Decoding...';
  if (audioSampleRateEl) audioSampleRateEl.textContent = 'Analyzing...';
  if (audioChannelsEl) audioChannelsEl.textContent = 'Analyzing...';

  // Attach to audio preview player
  if (audioPlayer) {
    audioPlayer.src = currentObjectUrl;
    audioPlayer.load();
  }

  updateUiState();
  announceStatus(`Audio file "${file.name}" loaded successfully.`);

  // Decode audio data to extract exact Web Audio metadata
  try {
    const decoded = await decodeAudioFile(file);
    currentDecodedData = decoded;
    if (audioDurationEl) audioDurationEl.textContent = formatTime(decoded.duration);
    if (audioSampleRateEl) audioSampleRateEl.textContent = `${(decoded.sampleRate / 1000).toFixed(1)} kHz`;
    if (audioChannelsEl) {
      audioChannelsEl.textContent = decoded.channels === 1 ? 'Mono (1 ch)' : `Stereo (${decoded.channels} ch)`;
    }
    announceStatus(`Decoded audio metadata: duration ${formatTime(decoded.duration)}, sample rate ${decoded.sampleRate} Hz.`);
  } catch (err) {
    console.error('Audio decoding error:', err);
    showAlert(err.message || 'Failed to decode audio file. Browser may not support codec.');
    announceStatus(`Error: ${err.message}`);
    // Clear audio player if decoding failed
    if (audioDurationEl) audioDurationEl.textContent = 'Error';
    if (audioSampleRateEl) audioSampleRateEl.textContent = 'Error';
    if (audioChannelsEl) audioChannelsEl.textContent = 'Error';
  }
}

/**
 * Resets the currently selected file and restores initial UI state.
 */
function resetFileSelection() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  currentFile = null;
  currentDecodedData = null;
  isProcessing = false;
  analysisCancelled = false;
  currentSegments = [];
  activeSegmentIndex = -1;
  currentFrameDiagnostics = [];
  selectedDiagFrameIndex = 0;

  if (diagnosticPanel) {
    diagnosticPanel.classList.add('hidden');
  }

  if (fileInput) fileInput.value = '';
  if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
  }

  hideAlert();
  hidePhaseNotice();
  resetResultsView();
  if (chordAnalysisSection) {
    chordAnalysisSection.classList.add('hidden');
  }
  updateUiState();
  announceStatus('Audio file cleared.');
}

/**
 * Handles click on Analyze Audio button and runs the client-side DSP pipeline.
 */
async function handleAnalyzeAudio() {
  if (!currentFile || isProcessing) return;

  hideAlert();
  hidePhaseNotice();

  // Ensure audio is decoded
  if (!currentDecodedData) {
    try {
      announceStatus('Decoding audio file before analysis...');
      currentDecodedData = await decodeAudioFile(currentFile);
    } catch (err) {
      showErrorState(err.message || 'Audio decoding failed.');
      return;
    }
  }

  const { monoData, sampleRate, duration } = currentDecodedData;

  if (!monoData || monoData.length === 0) {
    showErrorState('The audio buffer is empty.');
    return;
  }

  // Check if entire audio is silent
  let isCompletelySilent = true;
  for (let i = 0; i < Math.min(monoData.length, 100000); i++) {
    if (Math.abs(monoData[i]) > 0.002) {
      isCompletelySilent = false;
      break;
    }
  }

  if (isCompletelySilent && duration > 0.5) {
    showPhaseNotice('Warning: This audio recording appears to be completely silent. No distinct musical chords were found.');
  }

  isProcessing = true;
  analysisCancelled = false;
  updateUiState();
  showProgressState();
  updateStatusBadge('Analyzing...', 'bg-purple-900/60 text-purple-300');
  announceStatus('Starting audio chromagram extraction and chord detection...');

  // Show Chord Analysis section and smoothly auto scroll screen to it
  if (chordAnalysisSection) {
    chordAnalysisSection.classList.remove('hidden');
    requestAnimationFrame(() => {
      chordAnalysisSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const frameSize = 8192;
  const hopSize = 4096;
  const hopDuration = hopSize / sampleRate;
  const numFull = Math.floor((monoData.length - frameSize) / hopSize) + 1;
  const hasTail = ((numFull - 1) * hopSize + frameSize) < monoData.length;
  const totalFrames = monoData.length < frameSize ? 1 : (numFull + (hasTail ? 1 : 0));

  try {
    const chromaFrames = await extractChromagram(monoData, sampleRate, {
      frameSize,
      hopSize,
      onProgress: (ratio) => {
        const pct = Math.round(ratio * 100);
        const currentFrame = Math.round(ratio * totalFrames);
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressPercentageText) progressPercentageText.textContent = `${pct}%`;
        if (progressFramesText) progressFramesText.textContent = `${currentFrame} / ${totalFrames} frames`;
        if (progressStatusLabel) {
          progressStatusLabel.textContent = `Computing 12-bin Chroma vectors... (${formatTime((currentFrame * hopSize) / sampleRate)} of ${formatTime(duration)})`;
        }
      },
      checkCancelled: () => analysisCancelled
    });

    if (analysisCancelled) {
      resetResultsView();
      if (chordAnalysisSection) {
        chordAnalysisSection.classList.add('hidden');
      }
      updateStatusBadge('Cancelled', 'bg-slate-800 text-slate-400');
      announceStatus('Audio analysis was cancelled.');
      return;
    }

    if (progressStatusLabel) {
      progressStatusLabel.textContent = 'Matching 24 Major & Minor chord templates...';
    }

    // Match chord for each frame with full diagnostic traces
    const rawFramePredictions = chromaFrames.map(f => {
      const match = matchChord(f.chroma);
      return {
        time: f.time,
        actualEndTime: f.actualEndTime,
        actualSampleCount: f.actualSampleCount,
        isPadded: f.isPadded,
        chord: match.chord,
        shortName: match.shortName,
        root: match.root,
        quality: match.quality,
        score: match.score,
        isSilent: f.isSilent,
        rms: f.rms,
        chroma: f.chroma,
        spectralPeaks: f.spectralPeaks || [],
        diagnostics: match.diagnostics
      };
    });

    // Segment frames and smooth transients
    const smoothedFrames = smoothFramePredictions(rawFramePredictions, 2);
    currentFrameDiagnostics = smoothedFrames;

    const segments = segmentChords(rawFramePredictions, hopDuration, {
      minSegmentDuration: 0.35,
      audioDuration: duration
    });

    currentSegments = segments;
    renderResults(segments);

    // Update diagnostic controls
    if (diagFrameSlider) {
      diagFrameSlider.max = Math.max(0, currentFrameDiagnostics.length - 1);
      diagFrameSlider.value = 0;
    }
    if (diagTotalFrames) {
      diagTotalFrames.textContent = currentFrameDiagnostics.length;
    }
    if (isDiagnosticMode && currentFrameDiagnostics.length > 0) {
      if (diagnosticPanel) diagnosticPanel.classList.remove('hidden');
      renderDiagnosticFrame(0);
    } else if (diagnosticPanel) {
      diagnosticPanel.classList.add('hidden');
    }

    updateStatusBadge('Complete', 'bg-emerald-900/60 text-emerald-300');
    announceStatus(`Analysis complete! Identified ${segments.length} chord segments across the recording.`);

  } catch (err) {
    if (analysisCancelled) {
      resetResultsView();
      if (chordAnalysisSection) {
        chordAnalysisSection.classList.add('hidden');
      }
      updateStatusBadge('Cancelled', 'bg-slate-800 text-slate-400');
      announceStatus('Analysis cancelled.');
      return;
    }
    console.error('Audio analysis error:', err);
    showErrorState(err.message || 'An error occurred during audio analysis.');
  } finally {
    isProcessing = false;
    updateUiState();
  }
}

/**
 * Cancels ongoing analysis.
 */
function handleCancelAnalysis() {
  analysisCancelled = true;
  isProcessing = false;
  resetResultsView();
  if (chordAnalysisSection) {
    chordAnalysisSection.classList.add('hidden');
  }
  updateStatusBadge('Ready', 'bg-slate-800 text-slate-300');
  updateUiState();
}

/**
 * Renders the detected chord segments, timeline, and summary chips into the UI.
 * @param {Array<object>} segments
 */
function renderResults(segments) {
  hideAllResultsStates();
  if (chordAnalysisSection) {
    chordAnalysisSection.classList.remove('hidden');
  }
  if (resultsActiveState) resultsActiveState.classList.remove('hidden');

  if (!segments || segments.length === 0) {
    if (summarySegmentsCount) summarySegmentsCount.textContent = '0 segments';
    if (uniqueChordsContainer) uniqueChordsContainer.innerHTML = '<span class="text-xs text-slate-400">No chords detected.</span>';
    if (timelineBar) timelineBar.innerHTML = '';
    if (chordSegmentsList) chordSegmentsList.innerHTML = '<div class="text-center py-4 text-xs text-slate-400">No musical chords detected above confidence threshold.</div>';
    return;
  }

  // Summary Metrics
  const totalDuration = currentDecodedData ? currentDecodedData.duration : (segments[segments.length - 1].endTime || 1);
  if (summarySegmentsCount) {
    summarySegmentsCount.textContent = `${segments.length} segment${segments.length === 1 ? '' : 's'}`;
  }

  // Extract unique chords (excluding N.C.)
  const uniqueChordMap = new Map();
  segments.forEach(s => {
    if (s.chord && s.chord !== 'N.C.') {
      uniqueChordMap.set(s.chord, (uniqueChordMap.get(s.chord) || 0) + s.duration);
    }
  });

  if (uniqueChordsContainer) {
    uniqueChordsContainer.innerHTML = '';
    if (uniqueChordMap.size === 0) {
      uniqueChordsContainer.innerHTML = '<span class="text-xs text-slate-400">All frames uncertain / low energy</span>';
    } else {
      for (const [chordName, dur] of uniqueChordMap.entries()) {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-purple-950/80 border border-purple-800/60 text-purple-200 text-xs font-semibold';
        chip.innerHTML = `
          <span>${chordName}</span>
          <span class="text-[10px] text-purple-400 font-mono">(${dur.toFixed(1)}s)</span>
        `;
        uniqueChordsContainer.appendChild(chip);
      }
    }
  }

  // Render Horizontal Timeline Bar
  if (timelineBar) {
    timelineBar.innerHTML = '';
    segments.forEach((seg, idx) => {
      const segWidthPct = Math.max(1, (seg.duration / totalDuration) * 100);
      const block = document.createElement('div');
      block.className = `h-full flex items-center justify-center text-[11px] font-bold truncate px-1 transition-all border-r border-slate-900 select-none ${
        seg.chord === 'N.C.'
          ? 'bg-slate-900/80 text-slate-400'
          : 'bg-purple-900/60 hover:bg-purple-800/80 text-purple-200 hover:text-white'
      }`;
      block.style.width = `${segWidthPct}%`;
      block.title = `${seg.chord} (${formatTime(seg.startTime)} - ${formatTime(seg.endTime)})`;
      block.id = `timeline-segment-${idx}`;
      block.textContent = seg.shortName || seg.chord;

      block.addEventListener('click', () => {
        seekAudioTo(seg.startTime);
        if (isDiagnosticMode) {
          jumpDiagnosticToTime(seg.startTime + seg.duration / 2, false);
        }
      });

      timelineBar.appendChild(block);
    });
  }

  // Render Detailed Chord Segments List
  if (chordSegmentsList) {
    chordSegmentsList.innerHTML = '';
    segments.forEach((seg, idx) => {
      const card = document.createElement('div');
      card.id = `segment-card-${idx}`;
      card.className = 'group flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-purple-600/70 hover:bg-purple-950/20 transition-all cursor-pointer';

      const isNoChord = seg.chord === 'N.C.';
      const scorePercentage = Math.round(seg.similarityScore * 100);

      card.innerHTML = `
        <div class="flex items-center gap-3 overflow-hidden">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs ${
            isNoChord
              ? 'bg-slate-900 text-slate-400 border border-slate-800'
              : 'bg-purple-950 border border-purple-800/80 text-purple-300'
          }">
            ${seg.shortName || seg.chord}
          </div>
          <div class="overflow-hidden">
            <h4 class="text-sm font-semibold text-white group-hover:text-purple-200 transition-colors">
              ${seg.chord}
            </h4>
            <div class="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
              <span class="font-mono text-purple-300">${formatTime(seg.startTime)} &rarr; ${formatTime(seg.endTime)}</span>
              <span>&bull;</span>
              <span>${seg.duration}s</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <div class="text-right">
            <span class="block text-[11px] text-slate-400">Match Score</span>
            <span class="font-mono text-xs font-semibold ${
              seg.similarityScore >= 0.75
                ? 'text-emerald-400'
                : seg.similarityScore >= 0.55
                ? 'text-purple-300'
                : 'text-slate-400'
            }">
              ${seg.similarityScore.toFixed(2)}
            </span>
          </div>
          <button
            type="button"
            class="p-2 rounded-lg bg-slate-900 group-hover:bg-purple-600 text-slate-400 group-hover:text-white transition-colors"
            title="Seek audio to this chord"
            aria-label="Seek audio to ${seg.chord} at ${formatTime(seg.startTime)}"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            </svg>
          </button>
        </div>
      `;

      card.addEventListener('click', () => {
        seekAudioTo(seg.startTime);
        if (isDiagnosticMode) {
          jumpDiagnosticToTime(seg.startTime + seg.duration / 2, false);
        }
      });

      chordSegmentsList.appendChild(card);
    });
  }
}

/**
 * Seeks the audio player to the given timestamp and starts playback.
 * @param {number} seconds
 */
function seekAudioTo(seconds) {
  if (!audioPlayer) return;
  audioPlayer.currentTime = Math.max(0, seconds);
  audioPlayer.play().catch(e => {
    // Autoplay policy or user gesture notice
    console.debug('Audio play notice:', e);
  });
}

/**
 * Synchronizes playback position with active segment card and timeline block.
 */
function handleAudioTimeUpdate() {
  if (!audioPlayer || currentSegments.length === 0) return;
  const currentTime = audioPlayer.currentTime;

  if (timelineCurrentTime) {
    timelineCurrentTime.textContent = formatTime(currentTime);
  }

  // Diagnostic live follow playback
  if (followPlayback && isDiagnosticMode && currentFrameDiagnostics.length > 0) {
    jumpDiagnosticToTime(currentTime, false);
  }

  // Find active segment
  const index = currentSegments.findIndex(
    s => currentTime >= s.startTime && currentTime < s.endTime
  );

  if (index !== activeSegmentIndex) {
    // Remove highlight from previous
    if (activeSegmentIndex !== -1) {
      const prevCard = document.getElementById(`segment-card-${activeSegmentIndex}`);
      if (prevCard) {
        prevCard.classList.remove('ring-2', 'ring-purple-400', 'bg-purple-950/40');
      }
      const prevBlock = document.getElementById(`timeline-segment-${activeSegmentIndex}`);
      if (prevBlock) {
        prevBlock.classList.remove('ring-2', 'ring-white', 'brightness-125');
      }
    }

    activeSegmentIndex = index;

    // Apply highlight to current
    if (activeSegmentIndex !== -1) {
      const curCard = document.getElementById(`segment-card-${activeSegmentIndex}`);
      if (curCard) {
        curCard.classList.add('ring-2', 'ring-purple-400', 'bg-purple-950/40');
        // Smoothly scroll active card into view if needed
        curCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      const curBlock = document.getElementById(`timeline-segment-${activeSegmentIndex}`);
      if (curBlock) {
        curBlock.classList.add('ring-2', 'ring-white', 'brightness-125');
      }
    }
  }
}

/**
 * Updates UI element visibilities and button states according to current state.
 */
function updateUiState() {
  const hasFile = Boolean(currentFile);

  if (emptyUploadState) {
    emptyUploadState.classList.toggle('hidden', hasFile);
  }
  if (fileCard) {
    fileCard.classList.toggle('hidden', !hasFile);
  }
  if (audioPreviewCard) {
    audioPreviewCard.classList.toggle('hidden', !hasFile);
  }

  if (analyzeBtn) {
    analyzeBtn.disabled = !hasFile || isProcessing;
    if (isProcessing) {
      analyzeBtn.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        Analyzing Audio...
      `;
    } else {
      analyzeBtn.innerHTML = `
        <svg class="w-5 h-5 mr-2 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
        </svg>
        Analyze Audio
      `;
    }
  }
}

/**
 * Hides all right-column result states.
 */
function hideAllResultsStates() {
  if (resultsEmptyState) resultsEmptyState.classList.add('hidden');
  if (resultsProgressState) resultsProgressState.classList.add('hidden');
  if (resultsActiveState) resultsActiveState.classList.add('hidden');
  if (resultsErrorState) resultsErrorState.classList.add('hidden');
}

/**
 * Restores right column to the empty awaiting state.
 */
function resetResultsView() {
  hideAllResultsStates();
  if (resultsEmptyState) resultsEmptyState.classList.remove('hidden');
  updateStatusBadge('Ready', 'bg-slate-800 text-slate-300');
}

/**
 * Shows the progress state.
 */
function showProgressState() {
  hideAllResultsStates();
  if (chordAnalysisSection) {
    chordAnalysisSection.classList.remove('hidden');
  }
  if (resultsProgressState) resultsProgressState.classList.remove('hidden');
}

/**
 * Shows the error retry state.
 * @param {string} errorMsg
 */
function showErrorState(errorMsg) {
  hideAllResultsStates();
  if (chordAnalysisSection) {
    chordAnalysisSection.classList.remove('hidden');
  }
  if (resultsErrorState) resultsErrorState.classList.remove('hidden');
  if (analysisErrorText) analysisErrorText.textContent = errorMsg;
  updateStatusBadge('Error', 'bg-red-900/60 text-red-300');
  announceStatus(`Analysis error: ${errorMsg}`);
}

/**
 * Updates status badge text and classes.
 * @param {string} text
 * @param {string} colorClass
 */
function updateStatusBadge(text, colorClass) {
  if (!analysisStatusBadge) return;
  analysisStatusBadge.textContent = text;
  analysisStatusBadge.className = `text-xs px-2.5 py-0.5 rounded-full font-mono transition-colors ${colorClass}`;
}

/**
 * Displays error alert banner.
 * @param {string} msg
 */
function showAlert(msg) {
  if (alertBanner && alertMessage) {
    alertMessage.textContent = msg;
    alertBanner.classList.remove('hidden');
  }
}

/**
 * Hides error alert banner.
 */
function hideAlert() {
  if (alertBanner) {
    alertBanner.classList.add('hidden');
  }
}

/**
 * Displays informational banner.
 * @param {string} msg
 */
function showPhaseNotice(msg) {
  if (phaseNotice && phaseNoticeText) {
    phaseNoticeText.textContent = msg;
    phaseNotice.classList.remove('hidden');
    phaseNotice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * Hides informational banner.
 */
function hidePhaseNotice() {
  if (phaseNotice) {
    phaseNotice.classList.add('hidden');
  }
}

/**
 * Announces status changes to screen readers.
 * @param {string} message
 */
function announceStatus(message) {
  if (statusArea) {
    statusArea.textContent = message;
  }
}

/**
 * Initializes Diagnostic Mode, gating developer controls behind an explicit URL parameter (?diagnostic=true).
 */
function initDiagnosticMode() {
  let isDevParam = false;
  try {
    const urlParam = new URLSearchParams(window.location.search).get('diagnostic');
    isDevParam = (urlParam === '1' || urlParam === 'true');
  } catch (e) {
    // Ignore URL parsing errors
  }

  if (diagnosticToggleBtn) {
    if (isDevParam) {
      diagnosticToggleBtn.classList.remove('hidden');
      toggleDiagnosticMode(true);
    } else {
      diagnosticToggleBtn.classList.add('hidden');
      isDiagnosticMode = false;
      if (diagnosticPanel) {
        diagnosticPanel.classList.add('hidden');
      }
    }
  }

  // Expose global console interface for browser diagnostics and automated testing
  window.ChordFinderDiagnostics = {
    isEnabled: () => isDiagnosticMode,
    toggle: (enable) => {
      if (diagnosticToggleBtn) diagnosticToggleBtn.classList.remove('hidden');
      toggleDiagnosticMode(enable);
    },
    getFrames: () => currentFrameDiagnostics,
    getSegments: () => currentSegments,
    getDiagnosticAtTime: (timeSec) => getFrameDiagnosticsAtTime(timeSec, currentFrameDiagnostics, currentSegments),
    inspectFrame: (index) => renderDiagnosticFrame(index, true),
    inspectAtTime: (timeSec) => jumpDiagnosticToTime(timeSec, true),
    exportCurrentFrame: () => handleExportFrameJson()
  };
}

/**
 * Toggles Diagnostic Mode ON or OFF without modifying standard prediction results.
 * @param {boolean} [forceState]
 */
function toggleDiagnosticMode(forceState) {
  isDiagnosticMode = typeof forceState === 'boolean' ? forceState : !isDiagnosticMode;
  try {
    localStorage.setItem('chordfinder_diagnostic_mode', isDiagnosticMode ? 'true' : 'false');
  } catch (e) {}

  if (diagnosticToggleBtn) {
    diagnosticToggleBtn.setAttribute('aria-pressed', isDiagnosticMode ? 'true' : 'false');
    if (isDiagnosticMode) {
      diagnosticToggleBtn.classList.add('border-purple-500', 'bg-purple-950/50', 'text-purple-200');
      diagnosticToggleBtn.classList.remove('border-slate-700/70', 'bg-slate-900', 'text-slate-300');
    } else {
      diagnosticToggleBtn.classList.remove('border-purple-500', 'bg-purple-950/50', 'text-purple-200');
      diagnosticToggleBtn.classList.add('border-slate-700/70', 'bg-slate-900', 'text-slate-300');
    }
  }

  if (diagnosticToggleStatus) {
    diagnosticToggleStatus.textContent = isDiagnosticMode ? 'ON' : 'OFF';
    diagnosticToggleStatus.className = `px-1.5 py-0.2 rounded text-[10px] font-mono ${
      isDiagnosticMode ? 'bg-purple-900 text-purple-200 font-bold' : 'bg-slate-800 text-slate-400'
    }`;
  }

  if (diagnosticPanel) {
    if (isDiagnosticMode && currentFrameDiagnostics.length > 0) {
      diagnosticPanel.classList.remove('hidden');
      renderDiagnosticFrame(selectedDiagFrameIndex);
    } else {
      diagnosticPanel.classList.add('hidden');
    }
  }

  announceStatus(`Diagnostic mode ${isDiagnosticMode ? 'enabled' : 'disabled'}.`);
}

/**
 * Finds and inspects the analysis frame closest to a given timestamp.
 * @param {number} targetTime
 * @param {boolean} [syncAudio=false]
 */
function jumpDiagnosticToTime(targetTime, syncAudio = false) {
  if (!currentFrameDiagnostics || currentFrameDiagnostics.length === 0) return;
  let closestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < currentFrameDiagnostics.length; i++) {
    const diff = Math.abs(currentFrameDiagnostics[i].time - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }
  renderDiagnosticFrame(closestIdx, syncAudio);
}

/**
 * Searches circularly through frames to locate the next problem frame matching a predicate.
 * @param {function(object):boolean} predicate
 */
function jumpToNextProblemFrame(predicate) {
  if (!currentFrameDiagnostics || currentFrameDiagnostics.length === 0) return;
  const n = currentFrameDiagnostics.length;
  const start = (selectedDiagFrameIndex + 1) % n;

  for (let step = 0; step < n; step++) {
    const idx = (start + step) % n;
    const f = currentFrameDiagnostics[idx];
    if (predicate(f)) {
      renderDiagnosticFrame(idx, true);
      return;
    }
  }
  announceStatus('No matching problem frames found in recording.');
}

/**
 * Renders full frame-level spectral decomposition and chord correlation diagnostics.
 * @param {number} frameIndex
 * @param {boolean} [syncAudio=false]
 */
function renderDiagnosticFrame(frameIndex, syncAudio = false) {
  if (!currentFrameDiagnostics || currentFrameDiagnostics.length === 0) return;
  const clampedIdx = Math.max(0, Math.min(currentFrameDiagnostics.length - 1, frameIndex));
  selectedDiagFrameIndex = clampedIdx;

  const frame = currentFrameDiagnostics[clampedIdx];
  if (!frame) return;

  if (syncAudio && audioPlayer) {
    seekAudioTo(frame.time);
  }

  // Header indices
  if (diagFrameIndex) diagFrameIndex.textContent = `#${clampedIdx}`;
  if (diagTotalFrames) diagTotalFrames.textContent = currentFrameDiagnostics.length;
  if (diagTimestamp) diagTimestamp.textContent = `${frame.time.toFixed(2)}s (${formatTime(frame.time)})`;
  if (diagFrameSlider && parseInt(diagFrameSlider.value, 10) !== clampedIdx) {
    diagFrameSlider.value = clampedIdx;
  }

  // RMS Energy
  if (diagRmsValue) diagRmsValue.textContent = (frame.rms || 0).toFixed(4);
  if (diagSilenceBadge) {
    if (frame.isSilent) {
      diagSilenceBadge.textContent = 'Silence / Low Energy';
      diagSilenceBadge.className = 'inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-800/40';
    } else {
      diagSilenceBadge.textContent = 'Active Sound';
      diagSilenceBadge.className = 'inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800/40';
    }
  }

  // Final Decision Badge
  if (diagFinalDecisionBadge) {
    if (frame.chord === 'N.C.') {
      diagFinalDecisionBadge.textContent = 'Rejected: N.C.';
      diagFinalDecisionBadge.className = 'px-2 py-0.5 rounded text-xs font-bold font-mono bg-red-950 text-red-300 border border-red-800/50 truncate max-w-full';
    } else {
      diagFinalDecisionBadge.textContent = `Accepted: ${frame.chord}`;
      diagFinalDecisionBadge.className = 'px-2 py-0.5 rounded text-xs font-bold font-mono bg-emerald-950 text-emerald-300 border border-emerald-800/50 truncate max-w-full';
    }
  }

  if (diagChordQuality) {
    diagChordQuality.textContent = frame.chord === 'N.C.'
      ? `Quality: uncertain • Root: none`
      : `Quality: ${frame.quality || 'none'} • Root: ${frame.root || 'none'}`;
  }

  // Frame & Segment Consistency Diagnostics via getFrameDiagnosticsAtTime
  const diagInfo = getFrameDiagnosticsAtTime(frame.time, currentFrameDiagnostics, currentSegments);

  // Final Segment Badge & Range
  if (diagFinalSegmentBadge) {
    if (diagInfo.finalSegmentChord === 'N.C.') {
      diagFinalSegmentBadge.textContent = 'Segment: N.C.';
      diagFinalSegmentBadge.className = 'px-2 py-0.5 rounded text-xs font-bold font-mono bg-slate-900 text-slate-400 border border-slate-800 truncate max-w-full';
    } else {
      diagFinalSegmentBadge.textContent = `Segment: ${diagInfo.finalSegmentChord}`;
      diagFinalSegmentBadge.className = 'px-2 py-0.5 rounded text-xs font-bold font-mono bg-purple-950 text-purple-300 border border-purple-800/50 truncate max-w-full';
    }
  }

  if (diagSegmentRange) {
    if (diagInfo.segmentStartTime !== null) {
      diagSegmentRange.textContent = `${diagInfo.segmentStartTime.toFixed(2)}s → ${diagInfo.segmentEndTime.toFixed(2)}s (${diagInfo.segmentDuration.toFixed(2)}s)`;
    } else {
      diagSegmentRange.textContent = 'Outside detected segments';
    }
  }

  // Temporal Smoothing Trace
  if (diagSmoothingBadge) {
    if (diagInfo.wasSmoothed) {
      diagSmoothingBadge.innerHTML = `<span class="text-amber-400 font-bold">Modified by smoothing</span>: Raw <span class="font-mono text-purple-300">${diagInfo.rawChord}</span> &rarr; Smoothed <span class="font-mono text-emerald-300">${diagInfo.smoothedChord}</span>`;
    } else {
      diagSmoothingBadge.innerHTML = `<span class="text-slate-300 font-medium">Unchanged by smoothing</span>: Raw <span class="font-mono text-purple-300">${diagInfo.rawChord}</span>`;
    }
  }

  if (diagSmoothingDetails) {
    if (diagInfo.wasSmoothed) {
      diagSmoothingDetails.textContent = `Temporal majority vote over ±2 neighboring frames (~460ms) overrode the instantaneous frame prediction.`;
    } else {
      diagSmoothingDetails.textContent = `Instantaneous raw frame prediction agreed with the temporal majority vote.`;
    }
  }

  // Engine Evaluation Verdict & Consistency
  if (diagConsistencyBadge) {
    const isConsistent = diagInfo.differExplanation.includes('consistent');
    diagConsistencyBadge.textContent = isConsistent ? 'Consistent' : 'Frame vs Segment Diff';
    diagConsistencyBadge.className = isConsistent
      ? 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800/40'
      : 'px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-800/40';
  }

  if (diagConsistencyExplanation) {
    diagConsistencyExplanation.textContent = diagInfo.differExplanation;
  }

  if (diagDecisionReason) {
    diagDecisionReason.textContent = diagInfo.rawReason;
  }

  // Top 3 Candidates
  const candidates = frame.diagnostics?.candidates || [];
  const cand1 = candidates[0];
  const cand2 = candidates[1];
  const cand3 = candidates[2];

  if (diagCand1Name) diagCand1Name.textContent = cand1?.chord || '--';
  if (diagCand1Score) diagCand1Score.textContent = cand1 ? cand1.score.toFixed(3) : '0.000';
  if (diagCand1Details) diagCand1Details.textContent = cand1 ? `Root: ${cand1.root} • Quality: ${cand1.quality}` : 'Root: -- • Quality: --';

  if (diagCand2Name) diagCand2Name.textContent = cand2?.chord || '--';
  if (diagCand2Score) diagCand2Score.textContent = cand2 ? cand2.score.toFixed(3) : '0.000';
  if (diagCand2Details) diagCand2Details.textContent = cand2 ? `Root: ${cand2.root} • Quality: ${cand2.quality}` : 'Root: -- • Quality: --';

  if (diagCand3Name) diagCand3Name.textContent = cand3?.chord || '--';
  if (diagCand3Score) diagCand3Score.textContent = cand3 ? cand3.score.toFixed(3) : '0.000';
  if (diagCand3Details) diagCand3Details.textContent = cand3 ? `Root: ${cand3.root} • Quality: ${cand3.quality}` : 'Root: -- • Quality: --';

  // Score Delta
  const scoreDelta = frame.diagnostics?.scoreDelta ?? (cand1 && cand2 ? Math.max(0, cand1.score - cand2.score) : 0);
  if (diagScoreDelta) {
    diagScoreDelta.textContent = `+${scoreDelta.toFixed(3)}`;
    diagScoreDelta.className = `font-mono font-bold text-sm ${
      scoreDelta >= 0.15 ? 'text-emerald-400' : scoreDelta < 0.08 ? 'text-amber-400' : 'text-purple-300'
    }`;
  }
  if (diagScoreDeltaLabel) {
    diagScoreDeltaLabel.textContent = scoreDelta >= 0.15
      ? 'High separation margin (clear template winner)'
      : scoreDelta < 0.08
      ? 'Low separation margin (ambiguous / competing templates)'
      : 'Moderate separation margin';
  }

  // Triad Completeness
  const tc = frame.diagnostics?.triadCompleteness ?? 0;
  if (diagTriadCompleteness) {
    diagTriadCompleteness.textContent = tc.toFixed(3);
    diagTriadCompleteness.className = `font-mono font-bold text-sm ${tc >= 0.08 ? 'text-emerald-400' : 'text-red-400'}`;
  }
  if (diagTriadNotesBreakdown) {
    const tn = frame.diagnostics?.triadNotes;
    if (tn) {
      diagTriadNotesBreakdown.textContent = `R(${tn.root}): ${tn.rootEnergy.toFixed(2)} | 3(${tn.third}): ${tn.thirdEnergy.toFixed(2)} | 5(${tn.fifth}): ${tn.fifthEnergy.toFixed(2)}`;
    } else {
      diagTriadNotesBreakdown.textContent = 'R: 0.00 | 3rd: 0.00 | 5th: 0.00';
    }
  }

  // Non-Chord Energy Ratio
  const ncr = frame.diagnostics?.nonChordRatio ?? 0;
  if (diagNonchordRatio) {
    diagNonchordRatio.textContent = ncr.toFixed(3);
    diagNonchordRatio.className = `font-mono font-bold text-sm ${ncr <= 0.65 ? 'text-emerald-400' : 'text-red-400'}`;
  }
  if (diagNonchordStatus) {
    diagNonchordStatus.textContent = ncr <= 0.65 ? 'Clean harmonic spectrum (<= 0.65)' : 'High noise or polychord energy (> 0.65)';
  }

  // 12 Chroma Bins
  if (diagChromaBinsContainer && frame.chroma) {
    const tmpl = cand1 ? BASIC_TEMPLATES.find(t => t.name === cand1.chord) : null;
    diagChromaBinsContainer.innerHTML = '';

    for (let i = 0; i < 12; i++) {
      const pc = PITCH_CLASSES[i];
      const val = frame.chroma[i] || 0;
      const heightPct = Math.min(100, Math.max(4, Math.round(val * 100)));

      let roleTag = '';
      let barBg = 'bg-slate-700';
      let textColor = 'text-slate-400';

      if (tmpl) {
        if (i === tmpl.rootIndex) {
          roleTag = 'Root';
          barBg = 'bg-purple-500';
          textColor = 'text-purple-300 font-bold';
        } else if (i === tmpl.thirdIndex) {
          roleTag = '3rd';
          barBg = 'bg-indigo-500';
          textColor = 'text-indigo-300 font-bold';
        } else if (i === tmpl.fifthIndex) {
          roleTag = '5th';
          barBg = 'bg-sky-500';
          textColor = 'text-sky-300 font-bold';
        }
      }

      const col = document.createElement('div');
      col.className = 'flex flex-col items-center justify-end text-center space-y-1';
      col.innerHTML = `
        <span class="text-[9px] font-mono text-slate-400">${val.toFixed(2)}</span>
        <div class="w-full h-16 bg-slate-950 rounded flex items-end justify-center p-0.5 border border-slate-800">
          <div class="w-full rounded-sm ${barBg} transition-all duration-75" style="height: ${heightPct}%"></div>
        </div>
        <span class="text-[11px] font-mono font-semibold ${textColor}">${pc}</span>
        <span class="text-[9px] font-mono uppercase text-slate-400 h-3">${roleTag}</span>
      `;
      diagChromaBinsContainer.appendChild(col);
    }
  }

  // Strongest Spectral Peaks Table
  if (diagPeaksTbody) {
    const peaks = frame.spectralPeaks || [];
    if (peaks.length === 0) {
      diagPeaksTbody.innerHTML = '<tr><td colspan="5" class="py-3 px-3 text-center text-slate-400 text-xs">No prominent spectral peaks found in this frame.</td></tr>';
    } else {
      diagPeaksTbody.innerHTML = peaks.map((p, idx) => `
        <tr class="hover:bg-slate-900/60 transition-colors">
          <td class="py-1.5 px-3 text-slate-400 font-mono">#${idx + 1}</td>
          <td class="py-1.5 px-3 font-mono text-purple-300 font-bold">${p.frequency.toFixed(1)} Hz</td>
          <td class="py-1.5 px-3 font-semibold text-white">${p.note}</td>
          <td class="py-1.5 px-3 text-slate-300">${p.pitchClass}</td>
          <td class="py-1.5 px-3 text-right font-mono text-emerald-400">${p.magnitude.toFixed(4)}</td>
        </tr>
      `).join('');
    }
  }
}

/**
 * Exports current frame diagnostic metadata to formatted JSON.
 */
function handleExportFrameJson() {
  if (!currentFrameDiagnostics || currentFrameDiagnostics.length === 0) {
    showAlert('No analysis data available to export.');
    return;
  }
  const frame = currentFrameDiagnostics[selectedDiagFrameIndex];
  if (!frame) return;

  const diagInfo = getFrameDiagnosticsAtTime(frame.time, currentFrameDiagnostics, currentSegments);

  const exportData = {
    app: 'ChordFinder',
    version: 'Phase 2.6 Diagnostic Consistency',
    frameIndex: selectedDiagFrameIndex,
    timestampSeconds: parseFloat(frame.time.toFixed(4)),
    formattedTime: formatTime(frame.time),
    rmsEnergy: parseFloat(frame.rms.toFixed(5)),
    isSilent: frame.isSilent,
    rawPrediction: {
      chord: diagInfo.rawChord,
      shortName: diagInfo.rawShortName,
      decision: diagInfo.rawDecision,
      reason: diagInfo.rawReason,
      score: diagInfo.rawScore
    },
    smoothedPrediction: {
      chord: diagInfo.smoothedChord,
      shortName: diagInfo.smoothedShortName,
      wasSmoothed: diagInfo.wasSmoothed
    },
    finalSegment: {
      chord: diagInfo.finalSegmentChord,
      shortName: diagInfo.finalSegmentShortName,
      startTime: diagInfo.segmentStartTime,
      endTime: diagInfo.segmentEndTime,
      duration: diagInfo.segmentDuration,
      similarityScore: diagInfo.segmentScore
    },
    consistencyAnalysis: diagInfo.differExplanation,
    detectedChord: frame.chord,
    shortName: frame.shortName,
    root: frame.root,
    quality: frame.quality,
    score: parseFloat(frame.score.toFixed(4)),
    wasSmoothed: Boolean(frame.wasSmoothed),
    rawChord: frame.rawChord || frame.chord,
    diagnostics: frame.diagnostics,
    chromaBins: Array.from(frame.chroma || []).map((val, idx) => ({
      pitchClass: PITCH_CLASSES[idx],
      value: parseFloat(val.toFixed(4))
    })),
    spectralPeaks: frame.spectralPeaks || []
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chordfinder-frame-${selectedDiagFrameIndex}-${frame.time.toFixed(2)}s.json`;
  a.click();
  URL.revokeObjectURL(url);
  announceStatus(`Exported diagnostics for frame #${selectedDiagFrameIndex}.`);
}

// Auto-run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
