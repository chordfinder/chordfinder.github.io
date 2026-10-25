/**
 * ChordFinder - Radix-2 Cooley-Tukey Fast Fourier Transform (FFT)
 * Pure vanilla JavaScript DSP implementation with Hann windowing and magnitude extraction.
 */

/**
 * Creates a precomputed Hann window of length N.
 * w[n] = 0.5 * (1 - cos(2 * PI * n / (N - 1)))
 *
 * @param {number} size - Window length
 * @returns {Float32Array}
 */
export function createHannWindow(size) {
  const window = new Float32Array(size);
  if (size <= 1) {
    window.fill(1.0);
    return window;
  }
  const factor = (2 * Math.PI) / (size - 1);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos(factor * i));
  }
  return window;
}

/**
 * Computes the next power of two >= n.
 * @param {number} n
 * @returns {number}
 */
export function nextPowerOfTwo(n) {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(2, n))));
}

/**
 * Performs an in-place radix-2 Cooley-Tukey Decimation-in-Time (DIT) FFT.
 * real and imag arrays must have length equal to a power of 2.
 *
 * @param {Float32Array|Float64Array} real - Real component array (modified in place)
 * @param {Float32Array|Float64Array} imag - Imaginary component array (modified in place)
 */
export function radix2FFT(real, imag) {
  const n = real.length;
  if (n !== imag.length) {
    throw new Error('Real and imaginary arrays must have matching lengths.');
  }
  if ((n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be a power of 2, received ${n}`);
  }

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempReal = real[i];
      real[i] = real[j];
      real[j] = tempReal;

      const tempImag = imag[i];
      imag[i] = imag[j];
      imag[j] = tempImag;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Cooley-Tukey Butterflies
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepReal = Math.cos(angle);
    const wStepImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wReal = 1.0;
      let wImag = 0.0;

      for (let k = 0; k < halfLen; k++) {
        const uReal = real[i + k];
        const uImag = imag[i + k];

        const vIdx = i + k + halfLen;
        const vReal = real[vIdx] * wReal - imag[vIdx] * wImag;
        const vImag = real[vIdx] * wImag + imag[vIdx] * wReal;

        real[i + k] = uReal + vReal;
        imag[i + k] = uImag + vImag;

        real[vIdx] = uReal - vReal;
        imag[vIdx] = uImag - vImag;

        // Advance twiddle factor
        const nextWReal = wReal * wStepReal - wImag * wStepImag;
        const nextWImag = wReal * wStepImag + wImag * wStepReal;
        wReal = nextWReal;
        wImag = nextWImag;
      }
    }
  }
}

/**
 * High-performance FFT Analyzer with reusable internal buffers to minimize GC overhead.
 */
export class FFTAnalyzer {
  /**
   * @param {number} frameSize - Must be power of 2 (e.g. 4096, 8192)
   */
  constructor(frameSize = 8192) {
    if ((frameSize & (frameSize - 1)) !== 0) {
      throw new Error(`Frame size must be a power of 2, received ${frameSize}`);
    }
    this.frameSize = frameSize;
    this.halfSize = frameSize >> 1;
    this.window = createHannWindow(frameSize);
    this.real = new Float32Array(frameSize);
    this.imag = new Float32Array(frameSize);
    this.magnitudes = new Float32Array(this.halfSize);
  }

  /**
   * Analyzes a time-domain frame of audio samples and returns magnitude spectrum.
   *
   * @param {Float32Array|Array<number>} timeDomainData - Slice of length this.frameSize
   * @returns {Float32Array} Magnitude spectrum of length this.frameSize / 2
   */
  analyze(timeDomainData) {
    const n = this.frameSize;
    const len = Math.min(n, timeDomainData.length);

    // Apply Hann window and copy to real buffer, clear imag buffer
    for (let i = 0; i < len; i++) {
      this.real[i] = timeDomainData[i] * this.window[i];
      this.imag[i] = 0.0;
    }
    for (let i = len; i < n; i++) {
      this.real[i] = 0.0;
      this.imag[i] = 0.0;
    }

    radix2FFT(this.real, this.imag);

    // Compute half-spectrum magnitudes
    const half = this.halfSize;
    for (let k = 0; k < half; k++) {
      const r = this.real[k];
      const im = this.imag[k];
      this.magnitudes[k] = Math.sqrt(r * r + im * im);
    }

    return this.magnitudes;
  }
}
