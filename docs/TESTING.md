# Workflow Capture — Testing Guide & Suite Directory

## 1. Overview & Architecture

Workflow Capture employs a tiered testing architecture designed for developer speed, deterministic validation, and safe browser isolation:

1. **Fast Suite (Default)**: Pure unit and mock-backed API/integration tests that execute in seconds without launching an external browser or requiring Chrome.
2. **Browser & E2E Suite**: End-to-end tests that provision isolated headless Chrome processes using dynamic debugging ports and temporary profiles.
3. **Manual / Optional Suite**: Targeted browser verification tests reserved for interactive validation or specialized inspection.

### Core Invariants

- **Zero Browser Assumptions in Default `npm test`**: Running `npm test` never attempts to spawn Chrome or connect to CDP. It runs everywhere (developer laptops, containerized CI, lightweight VMs).
- **Process & Profile Isolation**: Browser-backed tests use `test/helpers/chrome-fixture.js` or dynamic port allocators to prevent port collisions, await process exit before profile cleanup, and isolate run directories.
- **Sequential Execution for State Safety**: Multi-test composite commands (`test:unit`, `test:api`) run with `--test-concurrency=1` to prevent race conditions on local SQLite/JsonDB state and port bindings.
- **Parity Between Local & CI**: CI workflows invoke the exact same npm scripts defined in `package.json`.

---

## 2. Complete Test Suite Directory & Classification

Every single test file in the repository is audited and assigned to one of four categories below:

| Test File | Suite | Scope / Associated Task | Requires Chrome? | Direct Script | Description |
|:---|:---|:---|:---:|:---|:---|
| `test/action-generalizer.test.js` | **Unit** | Core / Selector Engine | No | `npm run test:action-generalizer` | Selector scoping (`:scope`, relative paths), nth-row conversion, multi-action generalization. |
| `test/bot-config.test.js` | **Unit** | Core / Anti-Detection | No | `npm run test:bot` | Bot presets (ultra-stealth, balanced, fast, erp), Bezier trajectory math, typing delay cadence. |
| `test/checkbox-idempotency.test.js` | **Unit** | Core / Action Replay | No | `npm run test:checkbox` | Checkbox state detection, ARIA roles, and state-aware idempotent click skipping. |
| `test/devexpress-iframe-capture.test.js` | **Unit** | Core / Selector Resolver | No | `npm run test:devexpress` | Selector candidate generation for DevExpress toolbar buttons and iframe DOM mocks. |
| `test/download-deduplication.test.js` | **Unit** | Core / File Organization | No | `npm run test:downloads` | JsonDB schema, slugified run paths, content hash deduplication, zip archiving. |
| `test/dropdown-loop.test.js` | **Unit** | Core / Loop Detection | No | `npm run test:dropdown-loop` | Mat-option and dropdown pattern recognition, action generalization, item selection. |
| `test/item-discovery.test.js` | **Unit** | Core / Item Discovery | No | `npm run test:item-discovery` | Candidate collection scoring, confidence heuristics, navigation toolbar exclusion. |
| `test/item-filter.test.js` | **Unit** | Task 4 & Task 12 (Evaluator) | No | `npm run test:filter` | Pure reusable filter evaluator, compound AND/OR logic, `dateBetween` inclusive ranges, limit slicing, batch preview. |
| `test/loop-engine.test.js` | **Unit** | Core / Loop Detection | No | `npm run test:loop` | Table row/list item sibling detection, setup vs loop step sequence partitioning. |
| `test/secret-vault.test.js` | **Unit** | Core / Security | No | `npm run test:vault` | AES-256 secret encryption/decryption, master key derivation, database secret storage. |
| `test/selector-resolver.test.js` | **Unit** | Core / Selector Engine | No | `npm run test:selector` | ID stability heuristics, transient class stripping, element fingerprint scoring, human-friendly naming. |
| `test/auth.test.js` | **API / Integration** | Task 1 & Core Auth | No | `npm run test:auth` | Authentication controller, password hashing, JWT signing, Auth middleware, token verification. |
| `test/backend-api.test.js` | **API / Integration** | Core / REST API | No | `npm run test:backend` | REST API endpoints for user auth, workflow CRUD, runs lifecycle, stop run. |
| `test/dashboard-security.test.js` | **API / Integration** | Task 1 (Local Security) | No | `npm run test:security` | In-process HTTP server startup, loopback binding, token enforcement, developer bypass guards, CORS policies. |
| `test/execution-mode.test.js` | **API / Integration** | Core / Run Controller | No | `npm run test:mode` | Run controller execution mode branching (STANDARD macro vs LOOP). |
| `test/filter-api-runtime.test.js` | **API / Integration** | Task 6 (Filter API/Runtime) | No | `npm run test:filter-runtime` | Filter/limit API endpoints, preview vs runtime agreement, date range filtering, limit semantics, error handling. |
| `test/row-filter-discrimination.test.js` | **API / Integration** | Core / Task 6 (Row Filters) | No | `npm run test:row-filter` | Row filter parameter handling in run controller, simulated ERP row item matching/skipping. |
| `test/loop-e2e.test.js` | **Browser / E2E** | Task 3 & Core E2E | **Yes** | `npm run test:loop-e2e` | E2E loop replay & batch downloads on `invoices-portal.html` using `createChromeFixture`. |
| `test/e2e-smoke.js` | **Browser / E2E** | Task 3 & Core E2E | **Yes** | `npm run test:smoke` | Full recorder attach, live action capture, redaction, persistence, and replay on `mock-portal.html`. |
| `test/loop-reliability.test.js` | **Browser / E2E** | Task 2 (Loop Reliability) | **Yes** | `npm run test:loop-reliability` | Loop stall regression, human disturbance guard, failure isolation, abort/resume, and 4-item invoice scenario with real Chrome. |
| `test/iframe-click-capture-robustness.test.js` | **Manual / Optional** | Core / Verification | **Yes** | `npm run test:iframe-robustness` | Automated verification test suite for nested iframe injection, mousedown suppression, canvas clicks, and DevExpress icons. |

---

## 3. Primary Test Commands Reference

### Fast & Standard Local Commands

```bash
# Default test command: executes the fast suite (Unit + API)
npm test

# Equivalent explicit fast suite command
npm run test:fast

# Run all unit tests only (11 test files, ~6s)
npm run test:unit

# Run all API & integration tests only (6 test files, ~14s)
npm run test:api
npm run test:integration
```

### Browser & End-to-End Commands (Requires Chrome)

```bash
# Run all browser-backed E2E tests sequentially
npm run test:browser
npm run test:e2e

# Run targeted E2E scenarios
npm run test:loop-e2e          # Invoice loop replay with batch downloads
npm run test:smoke             # Full recording + replay smoke test on mock portal
npm run test:loop-reliability  # Multi-item loop reliability, abort/resume, and stall regression
```

### Canonical Full Validation Command

When Google Chrome is installed and full system validation is desired:

```bash
# Runs fast suite (Unit + API) followed by all browser-backed E2E tests
npm run test:all
```

### Targeted Regression & Feature Test Commands

For rapid iteration on specific subsystems during development:

```bash
npm run test:filter            # Task 4/12 item filter evaluator suite
npm run test:filter-runtime    # Task 6 filter API endpoints and loop runner integration
npm run test:security          # Task 1 dashboard security and loopback binding
npm run test:row-filter        # Row filter discrimination
npm run test:checkbox          # Checkbox idempotency
npm run test:downloads         # Download organization and deduplication
npm run test:auth              # Authentication, tokens, and middleware
npm run test:backend           # REST API endpoints
npm run test:loop              # Loop detector engine
npm run test:item-discovery    # Item discovery heuristics
npm run test:bot               # Bot configuration and human mouse curves
npm run test:vault             # Secret vault encryption
npm run test:selector          # Selector resolver heuristics
npm run test:mode              # Execution mode resolution
npm run test:devexpress        # DevExpress toolbar mocks
npm run test:dropdown-loop     # Dropdown options loop
```

---

## 4. Prerequisites & Environment

### Node.js & npm

- **Node.js**: Minimum supported version is **Node 18.x LTS**. Recommended: **Node 20.x LTS** or **22.x LTS** (Node 25.x is also validated).
- **npm**: npm 9.x or later.
- **Dependencies**: No external test frameworks (Jest, Mocha) are required. The suites utilize Node's built-in `node:test`, `node:assert`, and standard module execution.

### Browser Prerequisites (For Browser / E2E Suites Only)

- **Google Chrome**: A desktop installation of Google Chrome or Chromium is required for `npm run test:browser`, `npm run test:e2e`, and `npm run test:all`.
- **Supported Detection Paths**:
  - **Windows**: `C:\Program Files\Google\Chrome\Application\chrome.exe`, `C:\Program Files (x86)\...`, or `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`.
  - **macOS**: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (or Canary / Chromium).
  - **Linux**: `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, or `/usr/bin/chromium`.

---

## 5. Environment Variables & Overrides

| Environment Variable | Target Subsystem | Default | Description |
|:---|:---|:---|:---|
| `CHROME_PATH` | Browser Tests / CDP | Auto-detected | Explicit absolute path to the Chrome/Chromium executable. |
| `CHROME_BIN` | Browser Tests / CDP | Auto-detected | Alternate environment variable for Chrome binary path. |
| `PUPPETEER_EXECUTABLE_PATH` | Browser Tests / CDP | Auto-detected | Puppeteer-compatible Chrome binary override. |
| `PORT` | Dashboard Server | `3000` | Port for the dashboard HTTP server. |
| `ALLOW_DEV_BYPASS` | Auth Middleware | `false` | When set to `'true'` on loopback (`127.0.0.1`), enables bypass tokens for testing. |
| `ALLOWED_ORIGINS` | Auth Middleware | None (Same-origin) | Comma-separated list of cross-origin domains permitted to access API endpoints. |
| `JWT_SECRET` | Auth Token Service | Ephemeral dev secret | Secret string used for signing and verifying JSON Web Tokens. |
| `MASTER_KEY` | Secret Vault | Ephemeral dev key | 32-byte hexadecimal master key for encrypting stored credentials. |

---

## 6. Chrome Dependency Matrix

| Test Suite / Command | Requires Chrome? | Local Developer Machine | GitHub Actions CI |
|:---|:---:|:---|:---|
| `npm test` (`test:fast`) | **No** | Runs with Node only | Runs on Ubuntu matrix (Node 18, 20, 22) |
| `npm run test:unit` | **No** | Runs with Node only | Runs in CI fast job |
| `npm run test:api` | **No** | Runs with Node only | Runs in CI fast job |
| `npm run test:browser` | **Yes** | Requires local Google Chrome | Runs on Windows runner with verified Chrome |
| `npm run test:all` | **Yes** | Requires local Google Chrome | Runs when all suites are requested |
| `npm run test:iframe-robustness` | **Yes** | Requires local Google Chrome | Manual / Optional run only |

---

## 7. Test Artifacts, Output & Disk Hygiene

Running test suites produces temporary and persistent output files in specific directories:

1. **`downloads/`**:
   - Files downloaded during loop replays (e.g. `downloads/<workflow-slug>/<YYYY-MM-DD>/<filename>`).
   - Each run creates a `manifest.json` indexing downloaded files.
   - *Note*: Before running download deduplication tests or creating archive ZIPs, ensuring `downloads/` is clean prevents large legacy download files from slowing down archiving.
2. **`recordings/runs/`**:
   - Contains run execution directories keyed by `runId`.
   - Each directory contains `checkpoint.json`, temporary files, and run logs.
3. **`data/database.json`**:
   - In-memory/file JSON database used for workflows, runs, users, and secrets.
   - Tests initialize or reset their records using isolated identifiers or temporary instances.
4. **Temporary Profiles (`%TEMP%` or `/tmp`)**:
   - Browser fixtures create isolated profile directories prefixed with `chrome-loop-profile-*` or `chrome-smoke-profile-*`.
   - `chrome-fixture.js` automatically shuts down Chrome and deletes these directories upon test completion.

---

## 8. Manual & Optional Checks

### `test/iframe-click-capture-robustness.test.js`

- **Purpose**: Verifies recursive injection into nested iframes, mousedown suppression (`stopImmediatePropagation`), canvas relative coordinate clicks, and DevExpress toolbar icon capture.
- **Why Manual/Optional**:
  1. It requires an active Google Chrome installation.
  2. It launches Puppeteer directly rather than via `chrome-fixture.js`. On Windows systems, Puppeteer's default process shutdown can occasionally hit an OS file lock (`EBUSY: resource busy or locked, unlink ...\first_party_sets.db-journal`) when unlinking temporary profiles before Chrome background threads fully terminate.
- **Execution**: Run directly when verifying iframe or canvas interactions:
  ```bash
  npm run test:iframe-robustness
  ```

### Static Portal Fixtures

The repository includes standalone HTML fixtures under `test/` for testing complex DOM structures:
- `test/invoices-portal.html`: Tabular ERP invoice grid with downloads and buttons.
- `test/mock-portal.html`: E-commerce catalog with search, category select, and sensitive password input.
- `test/ecommerce-portal.html`: Pagination and cart workflow fixtures.
- `test/sales-portal.html` & `test/library-portal.html`: Table data variations.

---

## 9. Continuous Integration (CI) Architecture

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request to `main`, `multi-agent`, and agent work branches (`chatgpt/**`, `gemini/**`):

1. **Job 1: Fast Test Suite (`fast-tests`)**
   - **Environment**: `ubuntu-latest`.
   - **Matrix**: Node.js `18.x`, `20.x`, `22.x`.
   - **Command**: `npm test` (executes `npm run test:fast`).
   - **Characteristics**: Fast (~20s), zero browser dependencies, fully deterministic.
2. **Job 2: Browser & End-to-End Suite (`browser-e2e`)**
   - **Environment**: `windows-latest`.
   - **Prerequisite Step**: Explicitly verifies the existence of `C:\Program Files\Google\Chrome\Application\chrome.exe` and logs its version. Fails immediately if Chrome is absent.
   - **Command**: `npm run test:browser`.
   - **Characteristics**: Runs real headless Chrome through CDP, tests loop replay, downloads, and recorder fidelity.
