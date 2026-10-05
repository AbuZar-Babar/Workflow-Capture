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

The default test command runs the fast unit and API suites:

```bash
npm test
```

Run browser/E2E tests when Chrome is available:

```bash
npm run test:browser
```

Run the complete validation suite:

```bash
npm run test:all
```

Useful focused tests:

```bash
npm run test:item-discovery
npm run test:filter
npm run test:filter-runtime
npm run test:loop
npm run test:loop-e2e
npm run test:action-generalizer
```

See [Testing Guide](docs/TESTING.md) for the full test matrix and environment configuration.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system structure and component responsibilities
- [Project Plan](docs/PROJECT-PLAN.md) — planned product and engineering work
- [Testing Guide](docs/TESTING.md) — test suites and validation commands
- [Loop & Filter Requirements](docs/LOOP-FILTER-REQUIREMENTS.md) — discovery, filtering, and loop behavior
- [Implementation Status](docs/IMPLEMENTATION-STATUS.md) — current implementation evidence

## Project status

The core recording, replay, discovery, filtering, loop execution, and artifact-tracking foundations are implemented. Cross-portal and full end-to-end validation remain areas for continued verification.

The main README intentionally stays focused on the product, setup, running, and testing. Detailed task history, agent work plans, and temporary development notes belong in the supporting documentation.
