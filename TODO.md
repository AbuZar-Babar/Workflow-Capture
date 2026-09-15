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

## 🔐 Phase 2: Credentials & Variable Parameterization

- [ ] **Runtime Credential Vault / Secret Injection**
  - [ ] Replace `[REDACTED]` passwords at replay time using environment variables (e.g. `WF_SECRET_<FIELD_NAME>`).
  - [ ] Support secure prompt input in CLI if secrets are missing.
- [ ] **Dynamic Data & Variable Interpolation**
  - [ ] Parameterize text input actions with template variables (e.g. `{{customer_id}}`, `{{today_date}}`).
  - [ ] Accept a JSON/CSV data dataset for batch workflow replays.
- [ ] **Data Extraction Actions (`EXTRACT` / `ASSERT`)**
  - [ ] Record assertion steps (e.g. verify element contains text, check order status).
  - [ ] Extract table or text values from the page and export results to JSON / CSV.

---

## 🛠️ Phase 3: Developer Experience & Replay Controls

- [ ] **Interactive Visual Replay Debugger**
  - [ ] Step-by-step execution mode (`--step` flag) pausing before each action.
  - [ ] Highlight target element with a visible bounding box overlay during replay.
  - [ ] Option to inspect failed element matches in real time.
- [ ] **Live Recording Control Panel**
  - [ ] In-page floating toolbar with Pause, Resume, and Stop buttons.
  - [ ] Option to add custom markers or manual assertion checkpoints during live recording.
- [ ] **Workflow Editor Web UI**
  - [ ] Lightweight local web dashboard to review, edit, reorder, or delete recorded actions.
  - [ ] Visual timeline view of recorded steps with screenshot previews.

---

## 🧠 Phase 4: Self-Healing Selectors & Recovery

- [ ] **Heuristic Auto-Repair & Re-indexing**
  - [ ] Log telemetry when primary selectors fail and fallback fingerprints are used.
  - [ ] Auto-update `recording.json` with repaired high-confidence selectors when approved.
- [ ] **Visual Fallback Matching**
  - [ ] Capture element bounding box screenshots during recording.
  - [ ] Fallback to visual anchor matching if DOM hierarchy changes drastically.

---

## ⚡ Phase 5: Headless & CI/CD Deployment

- [ ] **Headless Execution Support**
  - [ ] Add flag to launch standalone headless Chrome when real interactive browser is not required.
- [ ] **CLI Reporting & Artifacts**
  - [ ] Generate HTML replay reports with execution timelines and pass/fail statuses.
  - [ ] Automatically capture error screenshots on failure and attach to report.
- [ ] **GitHub Actions / CI Integration**
  - [ ] Setup workflow to run scheduled smoke tests across target portals.
