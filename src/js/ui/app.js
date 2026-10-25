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
import { matchChord, segmentChords } from '../chord-engine/chord-matcher.js';

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

// State
let currentFile = null;
let currentObjectUrl = null;
let currentDecodedData = null;
let isProcessing = false;
let analysisCancelled = false;
let currentSegments = [];
let activeSegmentIndex = -1;

/**
 * Initializes UI event listeners.
 */
function init() {
  setupEventListeners();
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

  if (fileInput) fileInput.value = '';
  if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
  }

  hideAlert();
  hidePhaseNotice();
  resetResultsView();
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

  const frameSize = 8192;
  const hopSize = 4096;
  const hopDuration = hopSize / sampleRate;
  const totalFrames = Math.max(1, Math.floor((monoData.length - frameSize) / hopSize) + 1);

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
      updateStatusBadge('Cancelled', 'bg-slate-800 text-slate-400');
      announceStatus('Audio analysis was cancelled.');
      return;
    }

    if (progressStatusLabel) {
      progressStatusLabel.textContent = 'Matching 24 Major & Minor chord templates...';
    }

    // Match chord for each frame
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

    // Segment frames and smooth transients
    const segments = segmentChords(framePredictions, hopDuration, {
      minSegmentDuration: 0.45
    });

    currentSegments = segments;
    renderResults(segments);
    updateStatusBadge('Complete', 'bg-emerald-900/60 text-emerald-300');
    announceStatus(`Analysis complete! Identified ${segments.length} chord segments across the recording.`);

  } catch (err) {
    if (analysisCancelled) {
      resetResultsView();
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
  updateStatusBadge('Ready', 'bg-slate-800 text-slate-300');
  updateUiState();
}

/**
 * Renders the detected chord segments, timeline, and summary chips into the UI.
 * @param {Array<object>} segments
 */
function renderResults(segments) {
  hideAllResultsStates();
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
  if (resultsProgressState) resultsProgressState.classList.remove('hidden');
}

/**
 * Shows the error retry state.
 * @param {string} errorMsg
 */
function showErrorState(errorMsg) {
  hideAllResultsStates();
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

// Auto-run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
