# Workflow Capture — Browser Automation MVP

A generic, portal-agnostic browser automation MVP designed for a team of 2 developers. It connects to an existing, authenticated Google Chrome browser instance via Chrome DevTools Protocol (CDP), records user interactions into a normalized `recording.json` file, and replays them reliably using an isomorphic Shared Selector Resolver with weighted fingerprint scoring and condition-based waiting..

---

## 🎯 Architecture Highlights

1. **Zero-Throwaway Browser (Connect to Real Chrome via CDP)**:
   - Connects to an already running Chrome instance on port 9222.
   - Reuses existing users logins, cookies, and authenticated sessions (e.g. CityMart).
2. **Isomorphic Shared Selector Resolver (`src/shared/selector-resolver.js`)**:
   - Executes in-page during recording to extract and rank selector candidates with live uniqueness counts.
   - Evaluates in-page during replay to match candidates and validate elements against recorded semantic fingerprints (Tag, ID, Attributes, Visible Text, Classes).
3. **Condition-Based In-Page Polling Resolver**:
   - Replaces arbitrary sleeps with active polling (default 5000ms max, 100ms poll interval).
   - Validates visibility and interactability before executing actions, seamlessly handling async animations, delays, and dynamic DOM insertions.
4. **Buffered Text Typing & Password Redaction**:
   - Inputs are batched per element and flushed as a single `TYPE` action on `blur`, `change`, Enter key, or clicks on other elements.
   - Any input with `type="password"` has its value automatically masked to `[REDACTED]` and never stored in plaintext.
5. **Robust Error Diagnostics**:
   - When an element fails to resolve, a structured `ElementResolutionTimeoutError` reports all attempted candidates and specific failure reasons.

---

## 🚀 Quick Start Guide

### 1. Launch Chrome with Remote Debugging

Close all running Chrome instances, then open your terminal / command prompt:

**Windows (PowerShell or CMD):**
```powershell
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\temp\chrome-debug-profile"
```

> **Note**: Using a dedicated `--user-data-dir` ensures Chrome starts cleanly with remote debugging enabled even if your standard user Chrome is running.

### 2. Install Dependencies

```bash
npm install
```

### 3. Launch the Interactive Web Dashboard (Recommended)

Start the local control center UI:

```bash
npm run dashboard
```

Open **`http://localhost:3000`** in your browser. From the dashboard you can:
- 🎙️ **Record Workflows**: Enter a workflow name, click "Start Recording", interact with Chrome, and click "Stop & Save".
- ▶️ **Replay Workflows**: Choose a recording, adjust speed multiplier (`0.5x` - `3.0x`), and watch live step-by-step progress.
- 🔍 **Inspect Steps & Selectors**: Click "Inspect" to view detailed candidate hierarchies and fingerprint confidence scores.
- 💻 **Live Console Stream**: Monitor in-page events and CDP messages in real time.
- 🧪 **Run Tests**: Execute unit and smoke tests with a single click.

---

### Alternative: CLI Commands

#### Record Actions via CLI

Navigate to your target portal (e.g. CityMart or any web app) in the Chrome window you just opened. Then in your project terminal:

```bash
npm run record -- --name citymart-flow
```

- Interact with the page (click buttons, type into inputs, choose dropdown options).
- In-page recording badge `● REC (Workflow)` indicates the recorder is active.
- When finished, return to your terminal and **press Enter** or **Ctrl+C**.
- The recording will be saved to `recordings/citymart-flow.json`.

### 4. Replay Workflow

Reload or navigate to the initial page in Chrome, then run:

```bash
npm run replay -- recordings/citymart-flow.json
```

Options:
- `--speed <number>`: Adjust replay pacing (e.g. `--speed 1.5` for 1.5x speed).
- `--timeout <ms>`: Adjust maximum wait timeout for dynamic elements (e.g. `--timeout 10000`).
- `--port <number>`: Specify custom CDP port (default: 9222).

---

## 🧪 Testing & Verification

### Unit Tests
Verify stable ID detection, transient class filtering, and fingerprint scoring algorithms:
```bash
npm test
```

### Automated End-to-End Smoke Test
Launches a test Chrome instance on port 9222, opens `test/mock-portal.html`, records actions, tests password redaction, reloads the portal, and replays all actions verifying 100% DOM reproduction:
```bash
npm run test:e2e
```

---

## 📁 Project Structure

```text
Workflow-Capture/
├── package.json
├── src/
│   ├── shared/
│   │   ├── constants.js          # Action types, resolver weights, timeout defaults
│   │   ├── types.js              # JSDoc definitions for recordings and targets
│   │   └── selector-resolver.js  # ISOMORPHIC candidate generator & fingerprint matcher
│   ├── recorder/
│   │   ├── recorder-injected.js  # In-browser DOM event listener & input buffer
│   │   ├── recorder-bridge.js    # Node.js CDP controller & stream aggregator
│   │   └── index.js              # Recorder CLI
│   ├── replay/
│   │   ├── action-executors.js   # Puppeteer interaction drivers (CLICK, TYPE, SELECT)
│   │   ├── replay-engine.js      # Replay orchestrator & condition-based wait loop
│   │   └── index.js              # Replay CLI
│   └── utils/
│       ├── cdp-connector.js      # Reusable CDP browser connector
│       ├── errors.js             # Structured automation error hierarchy
│       └── logger.js             # Styled terminal logger
├── test/
│   ├── mock-portal.html          # Test portal with async delay & forms
│   ├── selector-resolver.test.js # Unit test suite
│   └── e2e-smoke.js              # Full round-trip automated test
└── recordings/                   # Output folder for recorded workflow JSON files
```

---

## 🛡️ Action & Selector Strategy Hierarchy

| Strategy | Generation Logic | Replay Priority |
| :--- | :--- | :---: |
| **`id`** | Clean, non-dynamic IDs (filtered against `:r1:`, `ng-`, UUIDs) | 1 |
| **`data-attr`** | `data-testid`, `data-qa`, `data-cy`, `data-id`, `name` | 2 |
| **`attribute`** | Semantic attributes: `name`, `aria-label`, `placeholder`, `role` | 3 |
| **`text`** | Visible text exact match for buttons, links, labels (`<= 40` chars) | 4 |
| **`css-path`** | Hierarchical CSS path scoped to closest stable ancestor | 5 |
| **`xpath`** | Fallback DOM path | 6 |
