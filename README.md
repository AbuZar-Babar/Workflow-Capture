# Workflow Capture — Browser Automation Platform

A generic, portal-agnostic browser automation and workflow capture engine. It connects directly to an existing, authenticated Google Chrome browser instance via the Chrome DevTools Protocol (CDP), captures user interactions into clean, normalized workflow JSON files, and reliably replays them across complex, dynamic enterprise applications (Angular Material, ExtJS, DevExpress, React, Vue) using an isomorphic Selector Resolver with weighted fingerprint scoring and condition-based waiting.

---

## 🎯 Product Direction

Workflow Capture is **not being developed as a simple record-and-replay macro**.

The primary use case is automating repetitive document collection for management companies and similar organizations. A user should be able to demonstrate how to download **one** invoice or document, after which the system discovers the remaining matching records and executes the same item workflow across the collection.

The target flow is:

```
Human demonstrates one item
        ↓
Workflow Capture records the procedure
        ↓
Discover matching records
        ↓
Confirm collection size
        ↓
Process every item
        ↓
Handle pagination / dynamic lists
        ↓
Download + track artifacts
        ↓
Produce run manifest
        ↓
Future: Document AI processing
```

The architectural principle is **record the procedure, not the individual records**.

The immediate MVP is therefore:

> **Record one invoice → discover all invoices → download every invoice → track success/failure.**

The existing CDP recorder, selector resolver, replay engine, loop engine, dashboard, authentication and download infrastructure form the foundation for this direction.

For the complete product and technical plan, see [PROJECT-PLAN.md](docs/PROJECT-PLAN.md).

### Architecture at a glance

```
Dashboard
   ↓
Workflow Definition
   ├── Fixed Actions
   └── Discovery / Item Model
            ↓
      Workflow Engine
       ├── Conditions
       ├── Loops
       └── Pagination
            ↓
      Download Engine
            ↓
       Run Manifest
            ↓
       File Storage
            ↓
   Future Document AI
```

The long-term design keeps deterministic automation as the normal execution path. AI/Browser Use-style capabilities may later be added for discovery or recovery when deterministic resolution fails; they are not required to replace the core engine.

---

## 🎯 Architecture & Key Features

### 1. Zero-Throwaway Browser Session (Live CDP Connection)
- Connects directly to an existing, running Google Chrome instance on port `9222`.
- Reuses authenticated sessions, user logins, cookies, Multi-Factor Authentication (MFA), and Single Sign-On (SSO) state without needing credential handoffs or session reconstruction.

### 2. Isomorphic Shared Selector Resolver (`src/shared/selector-resolver.js`)
- **Dual-Phase Execution**: Runs in-browser during recording to discover and rank candidate selectors with real-time uniqueness validation, and runs in-browser during replay to resolve targets.
- **Weighted Multi-Factor Fingerprint Scoring**: Matches candidates against element fingerprints combining tag name, non-dynamic IDs, data attributes, semantic ARIA attributes, exact and tokenized text overlap, and hierarchical CSS.
- **Dynamic ID & Transient Class Filtering**: Automatically detects and strips auto-generated framework IDs (e.g. `mat-input-0`, `:r1:`, `ext-gen1042`) and volatile state classes (`mat-focused`, `active`, `hover`).
- **Semantic Fallback Resolution**: Employs spatial and textual fallbacks when positional selectors shift due to dynamic DOM updates.

### 3. Enterprise Framework & Angular Material Resiliency
- **Composite Control Mapping**: Handles composite UI pairs (e.g. Angular Material MDC `<mat-option>` with `<mat-pseudo-checkbox>`) by prioritizing actionable container hosts.
- **Transparent Backdrop Dismissal**: Automatically identifies and interacts with transparent overlay dismissal layers (e.g. `.cdk-overlay-backdrop` with `opacity: 0`) to close popups and select lists cleanly.
- **Idempotent Combobox Triggers**: Prevents accidental dropdown closures during replay by checking `aria-expanded` states before clicking trigger elements.
- **Whitespace & Multi-Line Resiliency**: Uses tokenized Jaccard overlap scoring for robust text matching against Angular/SPA template spacing variations.

### 4. Human Stealth & Anti-Bot Emulation (`src/replay/human-mouse.js`)
- **Cubic Bézier Mouse Trajectories**: Simulates natural human hand movements with curved paths, acceleration/deceleration curves, and micro-overshoot corrections.
- **Stochastic Typing Cadence**: Applies variable inter-keystroke intervals, punctuation hesitation, and natural human pauses.
- **Configurable Speed & Stealth Presets**: Four out-of-the-box profiles (`stealth`, `balanced`, `fast`, `instant`) tailored for everything from bot-detection evasion to high-throughput testing.

### 5. Intelligent Loop & Batch Replay Engine (`src/replay/loop-replay-runner.js`)
- **Sibling Pattern Detection (`src/shared/loop-detector.js`)**: Automatically detects repeated table rows, list cards, or search results and generalizes a single recorded action into a batch loop.
- **State Recovery & Isolation**: Automatically resets state between iterations (dismisses detail modals, navigates back to list view) and isolates errors so one failed item does not abort the entire batch.
- **CDP Download Interceptor**: Catches and organizes downloaded artifacts (PDFs, CSVs, invoices) per loop item and generates a structured run manifest.

### 6. Transactional Database & REST API (`src/database/`, `src/api/`)
- **Lightweight Persistent JSON DB (`data/db.json`)**: Zero-external-dependency, file-based ACID-like storage engine with thread-safe in-memory caching and atomic file writes.
- **Full Collection Support**: Manages `users`, `workflows`, `runs`, `secrets`, and `bot_configs`.
- **JWT Authentication & Security**: Salted cryptographic password hashing and Bearer token verification on all protected endpoints.
- **Live Execution Control**: Dedicated APIs and abort signals to stop running workflows mid-execution (`POST /api/runs/:runId/stop` and `POST /api/runs/stop-all`).

### 7. Interactive Visual Dashboard (`src/dashboard/`)
- **Control Room UI**: Single-page management application for recording, editing, inspecting, running, and stopping workflows.
- **Workflow Editor**: Visual timeline of recorded steps with selector hierarchy inspection and parameter editing.
- **Live Stream Logs**: Server-Sent Events (SSE) log terminal streaming real-time replay progress directly to the browser.
- **Built-in Test Portals**: Three launchable sandbox web environments demonstrating e-commerce, CRM, and digital library workflows.

### 8. Sensitive Data Redaction
- Automatic masking of sensitive input fields (`type="password"`) to `[REDACTED]` during recording.
- Runtime credential injection via encrypted secrets and environment variables.

---

## 📁 Project Structure

```text
Workflow-Capture/
├── package.json
├── data/                         # Local JSON database storage (db.json) [Git ignored]
├── recordings/                   # Recorded workflow JSON files & run artifacts [Git ignored]
│   └── runs/                     # Downloaded files and manifests per execution run
├── src/
│   ├── api/                      # Express REST API controllers
│   │   ├── auth-controller.js    # Registration, login, session verification
│   │   ├── bot-config-controller.js # Stealth presets and custom bot profiles
│   │   ├── run-controller.js     # Run history, log streaming, execution stop
│   │   ├── secret-controller.js  # Runtime credential vault
│   │   └── workflow-controller.js# Workflow CRUD, execution dispatch, disk sync
│   ├── auth/                     # Security & authentication layer
│   │   ├── auth-middleware.js    # JWT verification middleware
│   │   ├── password-util.js      # Salted scrypt password hashing & validation
│   │   ├── secret-util.js        # AES credential encryption / decryption
│   │   └── token-service.js      # JWT signing and validation service
│   ├── dashboard/                # Web UI & Express Server
│   │   ├── server.js             # Dashboard HTTP server, API router & SSE log manager
│   │   └── public/               # Vanilla JS frontend client (views, components, CSS)
│   ├── database/                 # Persistent storage layer
│   │   ├── bot-config-presets.js # Out-of-the-box stealth and speed presets
│   │   └── db.js                 # JsonDB transactional storage engine
│   ├── recorder/                 # In-browser interaction capture
│   │   ├── index.js              # Recorder CLI entrypoint
│   │   ├── recorder-bridge.js    # Node.js CDP session controller & event debouncer
│   │   └── recorder-injected.js  # In-page event capture script & input buffer
│   ├── replay/                   # Automation execution & replay
│   │   ├── index.js              # Replay CLI entrypoint
│   │   ├── action-executors.js   # Puppeteer interaction drivers (CLICK, TYPE, SELECT)
│   │   ├── human-mouse.js        # Bézier curve mouse trajectory generator
│   │   ├── loop-replay-runner.js # Batch list iterator & download interceptor
│   │   └── replay-engine.js      # Condition-based wait loop & step orchestrator
│   ├── shared/                   # Isomorphic modules shared across Node and Browser
│   │   ├── constants.js          # Action types, scoring weights, timeout defaults
│   │   ├── loop-detector.js      # Sibling repeating pattern analysis
│   │   ├── selector-resolver.js  # Candidate generator, fingerprint scorer & fallback matcher
│   │   └── types.js              # JSDoc type definitions
│   └── utils/                    # Shared utilities
│       ├── cdp-connector.js      # Reusable CDP browser connection manager
│       ├── errors.js             # Structured automation error hierarchy
│       └── logger.js             # Formatted terminal and execution logger
└── test/                         # Comprehensive unit & integration test suites
    ├── auth.test.js              # Database, password hashing, and JWT tests
    ├── backend-api.test.js       # REST API endpoints & execution stop tests
    ├── bot-config.test.js        # Stealth presets & Bézier curve generation tests
    ├── loop-engine.test.js       # Sibling detector & loop replay tests
    ├── selector-resolver.test.js # Fingerprint scoring & heuristic unit tests
    ├── e2e-smoke.js              # Automated round-trip browser smoke test
    ├── ecommerce-portal.html     # Sandbox: NovaGear E-Commerce & Checkout
    ├── sales-portal.html         # Sandbox: Stratos B2B SaaS CRM & Quoting
    └── library-portal.html       # Sandbox: Alexandria Digital Library & DRM Portal
```

---

## 🚀 Quick Start Guide

### 1. Launch Google Chrome with Remote Debugging

Close all running Chrome instances, then run:

**Windows (PowerShell):**
```powershell
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\temp\chrome-debug-profile"
```

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug-profile"
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug-profile"
```

> **Note**: A separate `--user-data-dir` ensures Chrome starts cleanly with remote debugging enabled without conflicting with standard user profiles.

### 2. Install Dependencies

```bash
npm install
```

### 3. Launch the Web Dashboard

```bash
npm run dashboard
```

Open **`http://localhost:3000`** in your browser. From the dashboard you can:
- 🎙️ **Record Workflows**: Enter a workflow name, click "Start Recording", interact with Chrome, and click "Stop & Save".
- ▶️ **Replay Workflows**: Run any workflow with adjustable speed multipliers (`0.5x` to `3.0x`) and custom stealth presets.
- ⏹️ **Stop Execution**: Halt running workflows instantly with active abort signals.
- 🔍 **Inspect & Edit**: Inspect candidate selector rankings, fingerprint scores, and configure batch loop parameters.
- 💻 **Live Console Stream**: Watch step-by-step execution logs in real time.
- 🌐 **Launch Test Portals**: Test recordings against pre-configured sandbox portals directly from the sidebar.

---

### Alternative: CLI Commands

#### Record a Workflow
With Chrome open on your target web page:
```bash
npm run record -- --name my-workflow
```
- The in-page badge `● REC (Workflow)` will display in the top-right corner.
- Perform your workflow steps in Chrome.
- Press **Enter** in the terminal to finish and save to `recordings/my-workflow.json`.

#### Replay a Workflow
```bash
npm run replay -- recordings/my-workflow.json
```

**CLI Flags:**
- `--speed <number>`: Speed multiplier (e.g. `--speed 1.5`).
- `--timeout <ms>`: Maximum element resolution timeout (default: `5000`).
- `--port <number>`: CDP debugging port (default: `9222`).

---

## 🛡️ Action & Selector Strategy Hierarchy

During recording and replay, elements are evaluated through a ranked candidate hierarchy:

| Strategy | Generation Logic | Replay Priority |
| :--- | :--- | :---: |
| **`id`** | Non-dynamic, stable IDs (filtered against framework hashes, numbers, UUIDs) | 1 |
| **`data-attr`** | Test attributes: `data-testid`, `data-qa`, `data-cy`, `data-id`, `name` | 2 |
| **`attribute`** | Semantic ARIA & form attributes: `name`, `aria-label`, `placeholder`, `role` | 3 |
| **`text`** | Visible text exact match and tokenized overlap for buttons, links, and options | 4 |
| **`css-path`** | Hierarchical CSS path scoped to the closest stable ancestor element | 5 |
| **`xpath`** | Fallback DOM path | 6 |

---

## 🧪 Testing & Verification

The test suite covers algorithmic scoring, security, REST APIs, and end-to-end browser automation:

```bash
# Run all unit test suites (Selector Resolver, Auth, REST API, Loop Detector, Bot Stealth)
npm test

# Run individual test suites
node test/selector-resolver.test.js
node test/auth.test.js
node test/backend-api.test.js
node test/loop-engine.test.js
node test/bot-config.test.js

# Run full end-to-end automated browser smoke test
npm run test:e2e
```

### Sandbox Test Environments
The repository includes three realistic client-side applications in `test/` for testing complex automation scenarios:
1. **🛒 NovaGear E-Commerce Store** (`test/ecommerce-portal.html`): Catalog search, category filters, cart management, masked CVV/PIN inputs, and async inventory check.
2. **💼 Stratos Sales CRM & Revenue Cloud** (`test/sales-portal.html`): SaaS pricing plans, volume sliders, lead forms, confidential NDA tokens, and async quote generation.
3. **📚 Alexandria Digital Library** (`test/library-portal.html`): Manuscript archives, subject filters, multi-format downloads (PDF/EPUB), and cryptographic DRM token verification.

---

## 🔒 Data Privacy & Git Workflow

- All recorded workflow JSON files in `recordings/` and local database records in `data/db.json` are excluded from Git via `.gitignore`.
- This ensures test workflows, downloaded artifacts, and sensitive session credentials remain strictly local to your machine.
