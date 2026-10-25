import fs from 'node:fs';
import path from 'node:path';

/**
 * Creates a standard 16-bit mono PCM WAV file buffer from a Float32Array of samples [-1, 1].
 */
export function createWavBuffer(samples, sampleRate = 44100) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // "fmt " sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // "data" sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write 16-bit PCM audio samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    buffer.writeInt16LE(Math.round(val), offset);
    offset += 2;
  }

  return buffer;
}

/**
 * Simple WAV file parser: reads a standard PCM WAV buffer and returns Float32Array samples + sampleRate.
 */
export function parseWavBuffer(buffer) {
  const riff = buffer.toString('ascii', 0, 4);
  const wave = buffer.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Not a valid RIFF/WAVE buffer');
  }

  let offset = 12;
  let sampleRate = 44100;
  let numChannels = 1;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < buffer.length) {
    const subchunkId = buffer.toString('ascii', offset, offset + 4);
    const subchunkSize = buffer.readUInt32LE(offset + 4);

    if (subchunkId === 'fmt ') {
      const audioFormat = buffer.readUInt16LE(offset + 8);
      if (audioFormat !== 1 && audioFormat !== 3) {
        // 1 = PCM, 3 = IEEE Float
        throw new Error(`Unsupported audio format: ${audioFormat}`);
      }
      numChannels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    } else if (subchunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = subchunkSize;
      break;
    }

    offset += 8 + subchunkSize;
  }

  if (dataOffset === 0) {
    throw new Error('No data chunk found in WAV');
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / (bytesPerSample * numChannels));
  const samples = new Float32Array(totalSamples);

  let readIdx = dataOffset;
  for (let i = 0; i < totalSamples; i++) {
    let sampleVal = 0;
    if (bitsPerSample === 16) {
      sampleVal = buffer.readInt16LE(readIdx) / 32768.0;
    } else if (bitsPerSample === 8) {
      sampleVal = (buffer.readUInt8(readIdx) - 128) / 128.0;
    } else if (bitsPerSample === 32) {
      sampleVal = buffer.readFloatLE(readIdx);
    }
    samples[i] = sampleVal;
    readIdx += bytesPerSample * numChannels; // downmix first channel
  }

  return { samples, sampleRate, duration: totalSamples / sampleRate };
}

// Generate fixtures if run directly
const outDir = path.resolve('test/fixtures');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// 1. Synthetic test progression: C Major (1.5s) -> G Major (1.5s) -> A Minor (1.5s)
const sr = 44100;
const totalSamples = Math.floor(4.5 * sr);
const pSamples = new Float32Array(totalSamples);

// C Major: C4 (261.63), E4 (329.63), G4 (392.00)
for (let i = 0; i < 1.5 * sr; i++) {
  pSamples[i] = 0.28 * Math.sin(2 * Math.PI * 261.63 * i / sr) +
                0.28 * Math.sin(2 * Math.PI * 329.63 * i / sr) +
                0.28 * Math.sin(2 * Math.PI * 392.00 * i / sr);
}

// G Major: G3 (196.00), B3 (246.94), D4 (293.66)
for (let i = Math.floor(1.5 * sr); i < 3.0 * sr; i++) {
  pSamples[i] = 0.28 * Math.sin(2 * Math.PI * 196.00 * i / sr) +
                0.28 * Math.sin(2 * Math.PI * 246.94 * i / sr) +
                0.28 * Math.sin(2 * Math.PI * 293.66 * i / sr);
}

// A Minor: A3 (220.00), C4 (261.63), E4 (329.63)
for (let i = Math.floor(3.0 * sr); i < totalSamples; i++) {
  pSamples[i] = 0.28 * Math.sin(2 * Math.PI * 220.00 * i / sr) +
                0.28 * Math.sin(2 * Math.PI * 261.63 * i / sr) +
                0.28 * Math.sin(2 * Math.PI * 329.63 * i / sr);
}

const wavBuffer = createWavBuffer(pSamples, sr);
fs.writeFileSync(path.join(outDir, 'synthetic_c_g_am.wav'), wavBuffer);

// Write ground truth reference JSON
const groundTruth = {
  fileName: 'synthetic_c_g_am.wav',
  category: 'synthetic_benchmark',
  sampleRate: sr,
  duration: 4.5,
  segments: [
    { startTime: 0.0, endTime: 1.5, chord: 'C Major', root: 'C', quality: 'major' },
    { startTime: 1.5, endTime: 3.0, chord: 'G Major', root: 'G', quality: 'major' },
    { startTime: 3.0, endTime: 4.5, chord: 'A Minor', root: 'A', quality: 'minor' }
  ]
};
fs.writeFileSync(path.join(outDir, 'synthetic_c_g_am.json'), JSON.stringify(groundTruth, null, 2));

// 2. Invalid text document for error testing
fs.writeFileSync(path.join(outDir, 'invalid_document.txt'), 'This is a text document, not an audio file.');

console.log('Fixtures generated successfully.');
