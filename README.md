# Workflow Capture

Workflow Capture is a browser automation platform for recording workflows, discovering repeated portal items, filtering them, executing item-level workflows, and organizing downloaded artifacts.

## Core workflow

```
Record workflow
     ↓
Discover repeated items
     ↓
Review / filter items
     ↓
Run workflow for selected items
     ↓
Track execution
     ↓
Download / organize artifacts
```

The main idea is: **record the procedure, not every individual record.**

## Features

- Browser workflow recording through Chrome DevTools Protocol (CDP)
- Workflow replay with resilient selector resolution
- Repeated-item discovery for tables, lists, cards, and similar structures
- Item filtering with compound conditions and date ranges
- Loop execution with item-level retries and checkpoints
- Download and artifact tracking
- Visual dashboard for recording, editing, execution, and results
- Local JSON-based persistence
- REST APIs and Server-Sent Events (SSE)

## Architecture

```
Dashboard
   ↓
Workflow JSON
   ↓
Automation Engine
 ├─ Selector Resolver
 ├─ Item Discovery
 ├─ Filter
 ├─ Loop / Batch Runner
 └─ Download / Artifact Manager
   ↓
Portal
   ↓
Artifacts
```

### Technology

- Node.js
- Native Node.js HTTP server
- Puppeteer / Puppeteer-core
- Chrome DevTools Protocol (CDP)
- Vanilla JavaScript
- Drawflow
- REST + SSE

## Running the project

### Requirements

- Node.js 18+ (Node 20+ recommended)
- npm
- Google Chrome or Chromium for browser-based features and E2E tests

### 1. Install dependencies

From the repository root:

```bash
npm install
```

### 2. Start the dashboard

```bash
npm run dashboard
```

Open:

**http://127.0.0.1:3000**

To use another port:

```bash
PORT=3001 npm run dashboard
```

On Windows PowerShell:

```powershell
$env:PORT=3001; npm run dashboard
```

The server binds to `127.0.0.1` by default.

### 3. Connect Chrome

Workflow Capture uses Chrome through CDP. Start Chrome with remote debugging enabled, then use the dashboard's browser controls to connect to the debugging session.

The default CDP port is **9222**.

### 4. Stop the dashboard

Press `Ctrl+C` in the terminal running the server.

## Testing

Workflow Capture employs a tiered testing architecture designed for developer speed, deterministic validation, and isolation.

### Fast Suite (Default)

The fast suite runs pure unit and mock-backed API/integration tests sequentially without launching an external browser or requiring Chrome. It executes in seconds and is safe for local development and CI:

```bash
# Default test command: executes the fast suite (Unit + API)
npm test

# Equivalent explicit fast suite command
npm run test:fast
```

The fast suite executes:
- `npm run test:unit`: Unit tests executed sequentially (`--test-concurrency=1`) to prevent race conditions on local SQLite/JsonDB state.
- `npm run test:api`: API and integration tests executed sequentially (`--test-concurrency=1`).

### Key Test Coverage Areas

#### Unit Suites (`npm run test:unit`)
- **Item Discovery (`test/item-discovery.test.js`)**: Candidate collection scoring, structure heuristics, toolbar exclusion.
- **Item Filtering (`test/item-filter.test.js`)**: Pure compound evaluator supporting `all`/`any` match modes, text `contains`/`equals`, inclusive `dateBetween` calendar ranges, and limit slicing.
- **Action Generalization (`test/action-generalizer.test.js`)**: Selector scoping (`:scope`, relative paths), nth-row conversion, multi-action generalization.
- **Selector Resolution (`test/selector-resolver.test.js`)**: Multi-strategy candidate scoring, transient class stripping, ID stability heuristics.
- **Loop Engine (`test/loop-engine.test.js` & `test/dropdown-loop.test.js`)**: Sibling item detection, setup vs loop sequence partitioning, dropdown option pattern matching.
- **Downloads & Storage (`test/download-deduplication.test.js`)**: JsonDB schema, slugified run paths, content hash deduplication, zip archiving.
- **Security & Anti-Detection (`test/secret-vault.test.js` & `test/bot-config.test.js`)**: AES-256 secret vault, Bezier mouse trajectories, typing cadence.
- **Action Replay & Idempotency (`test/checkbox-idempotency.test.js`)**: ARIA roles, state detection, and idempotent click skipping.
- **Cross-Portal Fixtures (`test/cross-portal-synthetic.test.js`)**: Synthetic multi-portal fixture validation.

#### API & Integration Suites (`npm run test:api`)
- **Filter API & Runtime Parity (`test/filter-api-runtime.test.js`)**: Preview endpoint vs runtime execution parity, compound filter validation, attempt limit semantics, error handling.
- **Row Filter Discrimination (`test/row-filter-discrimination.test.js`)**: Row filter parameter handling in run controller, item matching/skipping.
- **Backend API & Runs Lifecycle (`test/backend-api.test.js`)**: REST API endpoints for authentication, workflow CRUD, runs lifecycle, stop run.
- **Dashboard Security (`test/dashboard-security.test.js`)**: HTTP server loopback binding, token enforcement, bypass protection, CORS policies.
- **Authentication (`test/auth.test.js`)**: JWT signing, bcrypt password hashing, auth middleware, token verification.
- **Execution Mode (`test/execution-mode.test.js`)**: Run controller execution branching (standard macro vs loop replay).

#### Targeted Feature Test Scripts

For rapid iteration on specific subsystems during development:

```bash
npm run test:item-discovery     # Item discovery heuristics
npm run test:filter             # Compound filter evaluator
npm run test:filter-runtime     # Filter API endpoints and runtime integration
npm run test:loop               # Loop engine sibling detection
npm run test:action-generalizer # Action generalization
npm run test:security           # Dashboard security and loopback binding
npm run test:auth               # Authentication controller and middleware
npm run test:backend            # REST API endpoints
```

## Documentation

- [Architecture](./ARCHITECTURE.md) — Comprehensive system architecture, data flows, component boundaries, live compound filter/limit contracts, and Architectural Decision Records (ADRs 001–010).

## Project status

The core foundation (recording, replay, repeated-item discovery, compound boolean filtering, loop execution, artifact tracking, and dashboard) is fully implemented and tested.

The repository documentation is consolidated into this `README.md` and the root `ARCHITECTURE.md` as the definitive guides for the system.
