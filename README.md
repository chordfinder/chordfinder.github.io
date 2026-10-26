# ChordFinder 🎵

A lightweight, browser-based audio chord detection and music visualization web application built with vanilla web technologies, Tailwind CSS v4, and the Web Audio API.

**Live Application:** [https://chordfinder.github.io/](https://chordfinder.github.io/)

---

## Features

- **Client-Side Privacy**: All audio decoding and digital signal processing (DSP) execute directly in the browser using the native Web Audio API. Zero audio files or data leave the user's machine.
- **Drag & Drop Upload**: Fast audio file loading with drag-and-drop support, format validation (WAV, MP3, OGG, FLAC, AAC, M4A, AIFF), and audio buffer inspection.
- **Audio Preview Player**: In-browser synchronized audio playback with interactive waveform timeline and duration tracking.
- **Chord Detection Engine**:
  - Radix-2 Cooley-Tukey FFT with Hann windowing for spectral analysis.
  - 12-bin Chromagram energy mapping across musical octaves (55 Hz to 2100 Hz).
  - 24 Major and Minor pitch-class correlation via cosine similarity matching.
  - Temporal smoothing window to prevent rapid chord-flicker on noisy signals.
  - Strict silence rejection, low-energy gating, and dyad/single-note filtering.
- **Interactive Chord Timeline**: Visual playback timeline with click-to-seek, active segment highlighting, and time-stamped chord blocks.
- **Diagnostic Inspector**: Built-in developer diagnostic view displaying top triad candidates, cosine similarity metrics, spectral peaks, and energy levels.
- **Zero Runtime Dependencies**: Pure vanilla HTML and native ES modules with no heavy runtime libraries or tracking.

---

## Technology Stack

- **Markup**: HTML5 with semantic landmarks and screen-reader live regions.
- **Styles**: Tailwind CSS v4 compiled via `@tailwindcss/cli`.
- **Logic**: Vanilla JavaScript using native ES Modules (`<script type="module">`).
- **Audio Processing**: Browser-native Web Audio API (`AudioContext`, `decodeAudioData`).
- **CI/CD & Hosting**: GitHub Pages automated via GitHub Actions with `.nojekyll`.

---

## Project Structure

```text
chordfinder/
├── .github/
│   └── workflows/
│       └── deploy.yml            # GitHub Actions CI/CD Pages workflow
├── .gitignore                    # Git exclusions (node_modules, caches, staging)
├── .nojekyll                     # Disables Jekyll processing on GitHub Pages
├── index.html                    # Main web application entry point
├── package.json                  # Project scripts and Tailwind v4 toolchain
├── package-lock.json             # Locked dependency versions
├── README.md                     # Documentation and developer instructions
├── assets/
│   └── css/
│       └── style.css             # Compiled, minified Tailwind production CSS
├── src/
│   ├── css/
│   │   └── input.css             # Tailwind CSS entry stylesheet (@import "tailwindcss")
│   └── js/
│       ├── audio/
│       │   └── audio-manager.js  # AudioContext decoding, format validation, downmix
│       ├── chord-engine/
│       │   ├── note-pitch.js     # Pitch mathematics and MIDI conversions
│       │   ├── fft.js            # Radix-2 Cooley-Tukey FFT implementation
│       │   ├── chromagram.js     # 12-bin chroma energy extraction
│       │   └── chord-matcher.js  # Template correlation, smoothing, and segmentation
│       └── ui/
│           └── app.js            # UI coordination, timeline, and player bindings
└── test/
    ├── accuracy-validation.test.js
    ├── audio-manager.test.js
    ├── boundary-coverage.test.js
    ├── chord-matcher.test.js
    ├── chromagram.test.js
    ├── diagnostics.test.js
    ├── evaluation-metrics.js
    ├── evaluation-metrics.test.js
    ├── fft.test.js
    ├── note-pitch.test.js
    ├── pipeline.test.js
    ├── run-evaluation.js         # Offline evaluation and diagnostic benchmark
    ├── run-stress-tests.js       # 10-category synthetic stress test suite
    ├── synthetic-stress.test.js
    ├── wav-utils.js
    └── fixtures/
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.0.0 or higher)
- `npm` (v9.0.0 or higher)

### Installation

Clone the repository and install development dependencies:

```bash
git clone https://github.com/chordfinder/chordfinder.github.io.git
cd chordfinder.github.io
npm install
```

---

## Development & Build Commands

### 1. Compile CSS during development
To watch for HTML and CSS class changes and compile on save:
```bash
npm run dev:css
```

### 2. Build minified CSS for production
To compile and minify the Tailwind CSS stylesheet:
```bash
npm run build
# or
npm run build:css
```
Output: `./assets/css/style.css`

### 3. Run automated tests
Run the unit, integration, and stress test suites via Node's native test runner:
```bash
npm test
```
To run the 84-case synthetic stress benchmark:
```bash
node test/run-stress-tests.js
```
To run the reproducible evaluation benchmark:
```bash
node test/run-evaluation.js
```

### 4. Run local development server
Serve the application locally using any static web server:
```bash
npx serve .
# or
python -m http.server 8080
```
Then navigate to `http://localhost:8080` in your web browser.

---

## Deployment Configuration (GitHub Pages)

ChordFinder uses a GitHub Actions workflow (`.github/workflows/deploy.yml`) to deploy the application to GitHub Pages at [https://chordfinder.github.io/](https://chordfinder.github.io/).

### How Deployment Works

1. **Trigger**: Pushes to `main` or `master` branches, or manual trigger via **Workflow Dispatch**.
2. **Quality Gate**: Installs dependencies via `npm ci`, runs `npm test` (all 65 tests must pass), and compiles production CSS via `npm run build`.
3. **Clean Staging**: Stages only runtime production files (`index.html`, `.nojekyll`, `assets/`, `src/js/`) into a clean `_site/` directory, deliberately excluding `node_modules`, test files, source CSS, caches, and repository metadata.
4. **Publish**: Publishes the clean static artifact directly to GitHub Pages using official GitHub Actions (`actions/upload-pages-artifact` and `actions/deploy-pages`).

### Configuring GitHub Pages in Repository Settings

To activate GitHub Actions deployment for the repository:
1. Navigate to your repository on GitHub: `https://github.com/chordfinder/chordfinder.github.io`
2. Go to **Settings** &rarr; **Pages** (under "Code and automation").
3. Under **Build and deployment** &rarr; **Source**, select **GitHub Actions** (do not select "Deploy from a branch").
4. Once enabled, the next push to `main` (or running the workflow manually in the Actions tab) will build and publish the live web app to `https://chordfinder.github.io/`.

---

## Current Scope & Limitations (Version 1)

- **Chord Types**: Detects all 24 basic triads (12 Major and 12 Minor chords). Extended 7th chords, suspensions (sus2/sus4), augmented, and diminished chords are not yet template-mapped and will resolve to their closest basic triad or N.C.
- **Audio Inputs**: Optimized for acoustic guitar, piano, and clean chordal instruments. Heavily distorted guitars, complex polyphonic orchestral arrangements, or dense mixes with overpowering drum tracks may reduce chord boundary precision.
- **Browser Compatibility**: Requires modern browsers supporting the Web Audio API and ES6 Modules (Chrome 80+, Firefox 75+, Safari 14.1+, Edge 80+).
