# Workflow Capture — Roadmap & TODO

This document tracks completed milestones, architectural enhancements, and upcoming features for the **Workflow Capture** browser automation engine.

---

## 📌 Status Overview

- [x] **Zero-Throwaway CDP Core**: Connect to real, running Google Chrome on port `9222` preserving authenticated sessions and cookies.
- [x] **In-Page Interaction Recording**: Capture `CLICK`, `TYPE`, `SELECT`, `KEY_PRESS`, and buffered input events.
- [x] **Password & Secret Masking**: Redact sensitive input values to `[REDACTED]` automatically during recording.
- [x] **Isomorphic Selector Resolver**: Real-time candidate generation and weighted fingerprint scoring (ID, Data attributes, Semantic attributes, Text, Hierarchical CSS, XPath).
- [x] **Condition-Based Replay Engine**: Active in-page element polling with customizable timeouts (replacing arbitrary sleeps).
- [x] **Enterprise SPA & Angular Material Resiliency**: Support for composite `<mat-option>` with `<mat-pseudo-checkbox>`, transparent backdrop dismissal, and idempotent combobox triggers.
- [x] **Intelligent Loop Replay Engine**: DOM sibling detection, batch item iteration, automatic state reset, and CDP download interception.
- [x] **Human Stealth & Anti-Bot Emulation**: Cubic Bézier mouse trajectories, micro-overshoots, stochastic typing cadence, and preset profiles (`stealth`, `balanced`, `fast`, `instant`).
- [x] **Backend Architecture & Database Layer**: Zero-dependency transactional JSON database (`JsonDB` in `data/db.json`) supporting `users`, `workflows`, `runs`, `secrets`, and `bot_configs`.
- [x] **REST API & Authentication**: JWT token signing and middleware, password hashing (`scrypt`), workflow CRUD, run history, and live execution cancellation.
- [x] **Interactive Web Dashboard**: Single-page management UI with step inspection, workflow editing, live replay streaming, stop buttons, and test portal launchers.
- [x] **Comprehensive Test Suites**: Unit tests for Selector Resolver, Auth/Database, Backend APIs, Loop Engine, and Bot Config, plus automated E2E smoke tests.

---

## ✅ Completed Milestones

### Phase 1: Core Automation & Isomorphic Selector Engine
- [x] Chrome DevTools Protocol (CDP) WebSocket connector.
- [x] In-page DOM event listener injecting into target web pages.
- [x] Dynamic ID detection heuristics (filtering framework-generated hashes like `ng-`, `:r1:`, `ext-gen`).
- [x] Transient CSS class filtering (`mat-focused`, `hover`, `active`).
- [x] Weighted fingerprint matching algorithm (Mandatory Tag Check, Stable ID, Attributes, Exact & Overlap Text).
- [x] Token-based Jaccard overlap scoring for whitespace-resilient text matching.
- [x] Condition-based polling loop with element visibility and interactability verification.
- [x] Structured error hierarchy with detailed `ElementResolutionTimeoutError` diagnostic context.

### Phase 2: Enterprise Framework Hardening
- [x] **Angular Material MDC (v15+) Multi-Select Support**:
  - [x] Composite option control resolution mapping child checkboxes to host `<mat-option>` elements.
  - [x] Direct native click dispatch fallback when virtual click does not toggle `aria-selected`.
- [x] **Transparent Backdrop Dismissal**:
  - [x] Allow `.cdk-overlay-backdrop` and `.cdk-overlay-transparent-backdrop` with `opacity: 0` to pass interactability gates.
  - [x] Semantic fallback candidate queries targeting active overlay containers.
  - [x] Direct `backdrop.click()` dispatch triggering Angular CDK's `backdropClick` event.
- [x] **Dropdown Idempotency**:
  - [x] Detect combobox triggers already in `aria-expanded="true"` state and skip redundant clicks to prevent accidental closure.
- [x] **Event Debouncing**:
  - [x] Recorder bridge duplicate click discarding (<150ms) to ensure clean 1:1 action recording.

### Phase 3: Backend Architecture & Generic Authentication
- [x] **Persistent Database Engine (`src/database/db.js`)**:
  - [x] Lightweight `JsonDB` transactional storage with thread-safe in-memory caching and atomic file writes.
  - [x] Collections for `users`, `workflows`, `runs`, `secrets`, and `bot_configs`.
  - [x] Bi-directional sync between on-disk `recordings/` and `workflows` collection.
- [x] **Authentication & Cryptography (`src/auth/`)**:
  - [x] Salted cryptographic password hashing (`crypto.scrypt`).
  - [x] JWT token signing and Bearer token verification middleware (`authMiddleware`).
  - [x] Auth endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- [x] **REST API Layer (`src/api/`)**:
  - [x] Workflow CRUD endpoints: `GET`, `POST`, `PUT`, `DELETE /api/workflows`.
  - [x] Workflow execution dispatcher: `POST /api/workflows/:id/execute`.
  - [x] Run execution logs and history: `GET /api/runs`, `GET /api/runs/:runId`.
  - [x] Server-Sent Events (SSE) log streaming: `GET /api/runs/:runId/logs`.
- [x] **Execution Cancellation**:
  - [x] Individual run cancellation: `POST /api/runs/:runId/stop`.
  - [x] Global cancellation: `POST /api/runs/stop-all`.
  - [x] Active abort controllers terminating in-flight replay loops.

### Phase 4: Intelligent Loop Replay & Batch Execution
- [x] **Sibling Pattern Detector (`src/shared/loop-detector.js`)**:
  - [x] Automated identification of repeated items in tables (`<tr>`), lists (`<li>`), or card grids.
  - [x] Single recorded action generalization into collection queries.
- [x] **Batch Loop Replay Runner (`src/replay/loop-replay-runner.js`)**:
  - [x] Single-pass setup execution (login, initial navigation).
  - [x] Iterative loop execution over all matching sibling elements.
  - [x] Automated state reset (modal dismissal, back-navigation to list).
  - [x] Per-item fault isolation preventing single-item failures from halting entire batch.
- [x] **CDP File Download Interception**:
  - [x] Intercept browser download events and save files into `recordings/runs/:runId/downloads/`.
  - [x] Generate structured manifest mapping downloaded files to item metadata.

### Phase 5: Bot Stealth & Human Emulation
- [x] **Cubic Bézier Mouse Movement (`src/replay/human-mouse.js`)**:
  - [x] Randomized control point calculation producing natural curvature and acceleration.
  - [x] Micro-overshoots and target corrections simulating physical human hand movements.
- [x] **Stochastic Typing Engine**:
  - [x] Variable inter-key delays with Gaussian distribution.
  - [x] Natural pauses on punctuation (commas, periods, question marks).
  - [x] Realistic hesitation before capital letters and special characters.
- [x] **Bot Configuration Profiles (`src/database/bot-config-presets.js`)**:
  - [x] Preset profiles: `stealth`, `balanced`, `fast`, `instant`.
  - [x] REST endpoints to fetch and configure custom bot parameters.

### Phase 6: Visual Dashboard & Replay Controls
- [x] Visual timeline view of recorded workflow steps.
- [x] Real-time execution status indicators and live SSE log terminal.
- [x] Interactive Stop button on active executions.
- [x] Inspector modal displaying candidate selector rankings and fingerprint confidence scores.
- [x] Built-in launchable test portals (E-Commerce, Sales CRM, Digital Library).

---

## 🚀 Upcoming Milestones & Roadmap

### Phase 7: DOM & Navigation Resilience (In Progress)
- [ ] **Iframe & Nested Frame Support**
  - [ ] Detect if an action occurs inside an `<iframe>` during recording.
  - [ ] Record the iframe hierarchy path (e.g. frame name, index, or unique CSS selector).
  - [ ] Switch execution context to target iframe during replay before resolving elements.
- [ ] **Shadow DOM & Web Components**
  - [ ] Extend selector resolver to traverse open Shadow Roots (`element.shadowRoot`).
  - [ ] Generate deep pierceable CSS selectors (e.g. `>>>` or custom shadow path chains).
- [ ] **Multi-Tab & Popup Handling**
  - [ ] Listen to browser target creation (`targetcreated` CDP event).
  - [ ] Track navigation across new tabs / popup windows and associate actions with specific page targets.
- [ ] **File Upload Support**
  - [ ] Capture `<input type="file">` file-picker interactions.
  - [ ] Implement CDP file payload transfer during replay (`Page.setFileInputFiles`).

### Phase 8: Visual Debugger & Replay HUD
- [ ] **Step-by-Step Replay Mode (`--step` / Dashboard Toggle)**
  - [ ] Add interactive pause/step buttons to step through actions one at a time.
- [ ] **In-Browser Element Highlighting**
  - [ ] Inject animated bounding box overlay onto target elements during replay before action execution.
- [ ] **Floating In-Page Recording Toolbar**
  - [ ] Expand the top-right in-page badge into a collapsible HUD with Pause, Resume, and Step Undo buttons.

### Phase 9: Headless Execution & Production CI/CD
- [ ] **Standalone Headless Execution Mode**
  - [ ] Add `--headless` flag to launch temporary headless Chrome when a real user desktop is not needed.
  - [ ] Support Dockerized container environments (xvfb / headless flags).
- [ ] **CLI & HTML Reporting**
  - [ ] Export interactive HTML execution reports with timelines, pass/fail status, and execution metrics.
  - [ ] Automatically capture error screenshots on failure and embed directly into reports.
- [ ] **GitHub Actions / CI Smoke Tests**
  - [ ] Set up automated CI workflow running scheduled smoke tests against target portals.
