# ChordFinder 🎵

A lightweight, browser-based audio chord detection application built with vanilla web technologies and the Web Audio API.

## Features

- **Client-Side Privacy**: All audio decoding and signal processing happen directly within the user's browser via the native Web Audio API. Zero audio files or data leave your machine.
- **Drag & Drop Upload**: Streamlined audio file loading with drag-and-drop support, format validation, and file metadata extraction.
- **Audio Preview Player**: In-browser audio playback preview with waveform and duration tracking.
- **Modern Dark UI**: Clean, responsive interface styled with Tailwind CSS v4.
- **Modular ES Modules**: Clean separation between the UI presentation layer, the Web Audio manager, and the chord detection engine.

## Technology Stack

- **HTML5**: Semantic, accessible markup.
- **Tailwind CSS v4**: Built locally via `@tailwindcss/cli`.
- **Vanilla JavaScript**: Native ES modules (`<script type="module">`).
- **Web Audio API**: Browser-native audio decoding and DSP pipeline.
- **GitHub Pages**: Static hosting ready with `.nojekyll`.

## Project Structure

```text
chordfinder/
├── index.html
├── package.json
├── package-lock.json
├── README.md
├── .gitignore
├── .nojekyll
├── src/
│   ├── css/
│   │   └── input.css
│   └── js/
│       ├── audio/
│       │   └── audio-manager.js
│       ├── chord-engine/
│       │   ├── note-pitch.js
│       │   ├── chromagram.js
│       │   └── chord-matcher.js
│       └── ui/
│           └── app.js
└── assets/
    └── css/
        └── style.css
```

## Getting Started

### Prerequisites

Node.js (v18+) and npm installed locally.

### Development & Build Commands

1. **Watch CSS for development:**
   ```bash
   npm run dev:css
   ```
   Runs:
   ```bash
   npx @tailwindcss/cli -i ./src/css/input.css -o ./assets/css/style.css --watch
   ```

2. **Build minified CSS for production:**
   ```bash
   npm run build:css
   ```
   Runs:
   ```bash
   npx @tailwindcss/cli -i ./src/css/input.css -o ./assets/css/style.css --minify
   ```

3. **Run automated test suite:**
   ```bash
   npm test
   ```
   Runs the 23 unit and integration tests covering pitch math, FFT radix-2 algorithm, chromagram feature extraction, 24 chord template matching, and end-to-end signal segmentation via Node.js's native test runner.

4. **Preview locally:**
   Serve static files using any local HTTP server:
   ```bash
   npx serve .
   # or
   python -m http.server 8000
   ```
   Then open `http://localhost:8000` in your web browser.

## Project Roadmap

- [x] **Phase 1: Project Setup & Upload Interface**
  - Tailwind CSS v4 CLI toolchain
  - Audio upload, drag-and-drop, format validation
  - In-browser native audio player preview
  - Audio buffer decoding & metadata inspection
  - Modular chord engine stubs
- [x] **Phase 2: Signal Processing & Real Chord Detection Engine**
  - In-place Radix-2 Cooley-Tukey FFT with precomputed Hann windowing
  - 12-dimensional Chromagram energy extraction (55 Hz to 2100 Hz)
  - 24 Major & Minor pitch class template correlation via Cosine Similarity
  - Temporal smoothing & flicker reduction (weighted majority vote window)
  - Audio-synchronized interactive timeline with click-to-seek playback
  - Silence & low-confidence rejection
  - Automated Node.js unit & integration test suite (23 tests passing)
