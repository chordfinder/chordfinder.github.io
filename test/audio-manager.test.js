import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatBytes,
  formatTime,
  validateAudioFile,
  audioBufferToMono
} from '../src/js/audio/audio-manager.js';

test('Audio Manager: formatBytes and formatTime helpers', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1048576), '1.0 MB');
  assert.equal(formatBytes(1572864), '1.5 MB');

  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(4.5), '00:04');
  assert.equal(formatTime(65), '01:05');
  assert.equal(formatTime(360), '06:00');
  assert.equal(formatTime(-1), '00:00');
  assert.equal(formatTime(NaN), '00:00');
});

test('Audio Manager: validateAudioFile format and size constraints', () => {
  // Empty / null file
  assert.equal(validateAudioFile(null).valid, false);

  // Supported audio extensions / MIME types
  const validWav = { name: 'test.wav', size: 1024 * 1024, type: 'audio/wav' };
  assert.equal(validateAudioFile(validWav).valid, true);

  const validMp3 = { name: 'guitar.mp3', size: 2 * 1024 * 1024, type: 'audio/mpeg' };
  assert.equal(validateAudioFile(validMp3).valid, true);

  const validFlac = { name: 'piano.flac', size: 5 * 1024 * 1024, type: 'audio/flac' };
  assert.equal(validateAudioFile(validFlac).valid, true);

  const validOgg = { name: 'chords.ogg', size: 500 * 1024, type: 'audio/ogg' };
  assert.equal(validateAudioFile(validOgg).valid, true);

  // Unsupported formats
  const invalidTxt = { name: 'document.txt', size: 1024, type: 'text/plain' };
  const resTxt = validateAudioFile(invalidTxt);
  assert.equal(resTxt.valid, false);
  assert.ok(resTxt.error.includes('Unsupported format'));

  const invalidPdf = { name: 'sheetmusic.pdf', size: 50000, type: 'application/pdf' };
  assert.equal(validateAudioFile(invalidPdf).valid, false);

  // Oversized file (> 50 MB)
  const hugeFile = { name: 'huge.wav', size: 55 * 1024 * 1024, type: 'audio/wav' };
  const resHuge = validateAudioFile(hugeFile);
  assert.equal(resHuge.valid, false);
  assert.ok(resHuge.error.includes('too large'));
});

test('Audio Manager: audioBufferToMono downmix logic', () => {
  // Mock Mono AudioBuffer
  const mockMono = {
    numberOfChannels: 1,
    length: 4,
    getChannelData: (c) => new Float32Array([0.1, 0.2, 0.3, 0.4])
  };
  const monoResult = audioBufferToMono(mockMono);
  assert.equal(monoResult.length, 4);
  assert.ok(Math.abs(monoResult[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(monoResult[3] - 0.4) < 1e-6);

  // Mock Stereo AudioBuffer: channel 0 = [1, 1], channel 1 = [0, 0] -> mono = [0.5, 0.5]
  const mockStereo = {
    numberOfChannels: 2,
    length: 2,
    getChannelData: (c) => (c === 0 ? new Float32Array([1.0, 1.0]) : new Float32Array([0.0, 0.0]))
  };
  const stereoResult = audioBufferToMono(mockStereo);
  assert.equal(stereoResult.length, 2);
  assert.ok(Math.abs(stereoResult[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(stereoResult[1] - 0.5) < 1e-6);
});
