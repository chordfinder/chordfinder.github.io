/**
 * ChordFinder - Audio Manager
 * Handles Web Audio API context, audio decoding, and metadata extraction.
 */

let audioContext = null;

/**
 * Returns a singleton AudioContext, initializing it upon user gesture.
 * @returns {AudioContext}
 */
export function getAudioContext() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('Web Audio API is not supported by this browser.');
    }
    audioContext = new AudioCtx();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

/**
 * Formats byte size into human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Formats time in seconds to mm:ss format.
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Validates whether the given file is a supported audio type.
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAudioFile(file) {
  if (!file) {
    return { valid: false, error: 'No file selected.' };
  }

  const validTypes = [
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/ogg',
    'audio/flac',
    'audio/x-flac',
    'audio/aac',
    'audio/mp4',
    'audio/x-m4a',
    'audio/webm'
  ];

  const validExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.webm'];
  const fileName = file.name.toLowerCase();
  const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));
  const hasValidMime = file.type && (validTypes.includes(file.type) || file.type.startsWith('audio/'));

  if (!hasValidExtension && !hasValidMime) {
    return {
      valid: false,
      error: `Unsupported format "${file.name}". Please upload an MP3, WAV, FLAC, OGG, or M4A file.`
    };
  }

  // Maximum file size check: 50MB limit
  const maxSizeBytes = 50 * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return {
      valid: false,
      error: `File is too large (${formatBytes(file.size)}). Maximum supported size is 50 MB.`
    };
  }

  return { valid: true };
}

/**
 * Downmixes an AudioBuffer (mono, stereo, or multi-channel) into a single Float32Array.
 * @param {AudioBuffer} audioBuffer
 * @returns {Float32Array}
 */
export function audioBufferToMono(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const numSamples = audioBuffer.length;

  if (numSamples === 0) {
    return new Float32Array(0);
  }

  if (numChannels === 1) {
    return audioBuffer.getChannelData(0);
  }

  // Downmix multi-channel to mono
  const mono = new Float32Array(numSamples);
  const factor = 1.0 / numChannels;

  for (let c = 0; c < numChannels; c++) {
    const channelData = audioBuffer.getChannelData(c);
    for (let i = 0; i < numSamples; i++) {
      mono[i] += channelData[i] * factor;
    }
  }

  return mono;
}

/**
 * Decodes an audio File using Web Audio API to inspect audio buffer metadata.
 * Validates audio integrity and handles decoding exceptions cleanly.
 *
 * @param {File} file
 * @returns {Promise<{ audioBuffer: AudioBuffer, monoData: Float32Array, sampleRate: number, duration: number, channels: number }>}
 */
export async function decodeAudioFile(file) {
  if (!file || file.size === 0) {
    throw new Error('Selected audio file is empty (0 bytes).');
  }

  const ctx = getAudioContext();
  let arrayBuffer;

  try {
    arrayBuffer = await file.arrayBuffer();
  } catch (err) {
    throw new Error(`Failed to read file from disk: ${err.message || 'Unknown read error'}`);
  }

  let audioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } catch (err) {
    throw new Error(
      `Audio decoding failed. Your browser may not support this specific codec, or the audio file is corrupted.`
    );
  }

  if (!audioBuffer || audioBuffer.length === 0 || audioBuffer.duration === 0) {
    throw new Error('The decoded audio track contains no playable audio samples.');
  }

  const monoData = audioBufferToMono(audioBuffer);

  return {
    audioBuffer,
    monoData,
    sampleRate: audioBuffer.sampleRate,
    duration: audioBuffer.duration,
    channels: audioBuffer.numberOfChannels
  };
}

