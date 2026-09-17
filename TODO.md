# Workflow Capture — Roadmap & TODO

This document tracks upcoming milestones, features, and architectural enhancements for the **Workflow Capture** browser automation engine.

---

## 📌 Status Overview

- [x] **MVP Core**: Connect to Chrome via CDP (port 9222)
- [x] **In-page Recording**: Track `CLICK`, `TYPE`, `SELECT`, and buffered input events
- [x] **Password Redaction**: Automatically mask sensitive inputs to `[REDACTED]`
- [x] **Isomorphic Selector Resolver**: Fingerprint scoring (ID, Data attributes, Semantic attributes, Text, Hierarchical CSS)
- [x] **Condition-Based Replay Engine**: Polling element resolution with customizable timeouts
- [x] **Test Harness**: Unit test suite & automated mock portal E2E smoke test

---

## 🚀 Phase 1: DOM & Navigation Resilience

- [ ] **Iframe & Nested Frame Support**
  - [ ] Detect if an action occurs inside an `<iframe>` during recording.
  - [ ] Record the iframe hierarchy path (e.g. frame name, index, or unique selector).
  - [ ] Switch execution context to target iframe during replay before resolving elements.
- [ ] **Shadow DOM & Web Components**
  - [ ] Extend selector resolver to traverse open Shadow Roots (`element.shadowRoot`).
  - [ ] Generate deep pierceable CSS selectors (e.g. `>>>` or custom shadow path chains).
- [ ] **Multi-Tab & Popup Handling**
  - [ ] Listen to browser target creation (`targetcreated` CDP event).
  - [ ] Track navigation across new tabs / popup windows and associate actions with specific page targets.
- [ ] **File Upload & Download Support**
  - [ ] Capture `<input type="file">` file-picker interactions.
  - [ ] Implement CDP file payload transfer during replay (`Page.setFileInputFiles`).

---

## 🔐 Phase 2: Backend Architecture & Generic Authentication (`generic-login` Branch)

- [ ] **Persistent Storage & Database Layer (`src/database/`)**
  - [ ] User, workflow, run execution, and encrypted credential models.
- [ ] **Authentication & Security (`src/auth/`)**
  - [ ] Salted password hashing (`crypto.scrypt` / `bcrypt`).
  - [ ] JWT token issuance, verification, and expiration.
  - [ ] `authMiddleware` for route protection.
  - [ ] Auth endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- [ ] **Workflow Management & REST APIs (`src/api/`)**
  - [ ] Workflow CRUD endpoints (`GET/POST/PUT/DELETE /api/workflows`).
  - [ ] Execution dispatcher endpoints (`POST /api/workflows/:id/execute`).
  - [ ] Real-time execution logs & SSE status streams (`GET /api/runs/:runId/logs`).
- [ ] **Runtime Credential Vault / Secret Injection**
  - [ ] Replace `[REDACTED]` passwords at replay time using user-stored secrets or environment variables.

---

## 🧠 Phase 3: Intelligent List Generalization & Loop Replay Engine

- [x] **DOM Sibling & Repeating Pattern Detector (`src/shared/loop-detector.js`)**
  - [x] Detect when an action occurs on an item within a repeated list/table (`<tr>`, `<li>`, recurring item containers).
  - [x] Parameterize single target fingerprint into a collection query selector.
- [x] **Batch Loop Replay Runner (`src/replay/loop-replay-runner.js`)**
  - [x] Execute `Setup Steps` once (Login, Navigation).
  - [x] Iterate through all resolved list items and apply target sub-workflow action.
  - [x] State restoration: Return to list URL or dismiss detail modals automatically between items.
  - [x] Per-item error isolation: Log failing items and continue without breaking the full run.
- [x] **CDP File Download & Artifact Interceptor**
  - [x] Intercept CDP download events and save files into `recordings/runs/:runId/downloads/`.
  - [x] Generate run manifest JSON mapping downloaded files to list item metadata.
  - [x] Automated E2E test suite (`npm run test:loop-e2e`) validating 100% item loop execution on live portals.

---

## 🛠️ Phase 4: Developer Experience & Replay Controls (Frontend `UI-for-dashboard` Collaboration)

- [ ] **Interactive Visual Replay Debugger**
  - [ ] Step-by-step execution mode (`--step` flag) pausing before each action.
  - [ ] Highlight target element with a visible bounding box overlay during replay.
- [ ] **Live Recording Control Panel**
  - [ ] In-page floating toolbar with Pause, Resume, and Stop buttons.
- [ ] **Workflow Editor Web UI**
  - [ ] Visual timeline view of recorded steps with screenshot previews.
  - [ ] "Loop over list items" configuration toggle.

---

## ⚡ Phase 5: Headless & CI/CD Deployment

- [ ] **Headless Execution Support**
  - [ ] Add flag to launch standalone headless Chrome when real interactive browser is not required.
- [ ] **CLI Reporting & Artifacts**
  - [ ] Generate HTML replay reports with execution timelines and pass/fail statuses.
  - [ ] Automatically capture error screenshots on failure and attach to report.
- [ ] **GitHub Actions / CI Integration**
  - [ ] Setup workflow to run scheduled smoke tests across target portals.

