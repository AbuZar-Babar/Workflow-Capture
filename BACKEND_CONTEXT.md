# Backend & Authentication Context & Task Tracker

> **Branch**: `generic-login`  
> **Lead**: AbuZar Babar  
> **Domain**: Backend Architecture, Authentication/Login System, APIs & Database  
> **Collaborator**: Frontend Partner working on `UI-for-dashboard`

---

## 🎯 High-Level Objectives

1. Implement a robust **Generic Login & Authentication** system (Registration, Login, Password Hashing, JWT/Session tokens, and Protected Routes).
2. Design and expose clean **REST API Contracts** for recorded workflows, replay executions, and user settings.
3. Decouple backend services from the UI to ensure smooth merging with the frontend team's branch (`origin/UI-for-dashboard`).
4. Support **Credential Vault / Secret Injection** during browser replay without storing plain-text passwords.

---

## 📋 Backend Task Checklist

### Phase 1: Authentication & User Management
- [ ] Choose auth strategy (JWT with HTTP-only cookies / Bearer headers).
- [ ] Create user schema / data model (User ID, Email/Username, Password Hash, Salt, CreatedAt).
- [ ] Implement password hashing (`bcrypt` / `argon2` / `scrypt`).
- [ ] Implement `POST /api/auth/register` (User registration with input validation).
- [ ] Implement `POST /api/auth/login` (Authentication, password verification, token issuance).
- [ ] Implement `POST /api/auth/logout` (Token invalidation / cookie clear).
- [ ] Implement `GET /api/auth/me` (Fetch authenticated user profile).
- [ ] Create `authMiddleware` to guard protected API routes.

### Phase 2: Workflow & Execution API Endpoints
- [ ] `GET /api/workflows` — List all workflows owned by the user.
- [ ] `POST /api/workflows` — Save a newly recorded workflow JSON.
- [ ] `GET /api/workflows/:id` — Retrieve workflow details and action step sequence.
- [ ] `PUT /api/workflows/:id` — Update or re-order steps.
- [ ] `DELETE /api/workflows/:id` — Delete a saved workflow.
- [ ] `POST /api/workflows/:id/execute` — Trigger backend headless or CDP replay.
- [ ] `GET /api/runs/:runId` — Status, live logs, error reports, and screenshots.

### Phase 3: Generic Vault & Secret Management
- [ ] Secure credential storage for runtime secret injection (replacing `[REDACTED]` during replay).
- [ ] Environment variable fallback / secret binding per workflow.

### Phase 4: Intelligent List Generalization & Loop Execution Engine
- [ ] **DOM Pattern & Sibling Detection**: Detect when recorded targets belong to repeating structures (`<tr>`, `<li>`, recurring cards/CSS patterns) and generate parameterized item selectors.
- [ ] **Loop Block Boundaries**: Separate workflow into `Setup Steps` (e.g. Login, Navigation), `Loop Block Steps` (actions executed per list item), and `Teardown Steps`.
- [ ] **State Restoration & Context Recovery**:
  - Track list page URL and modal state.
  - If an item action navigates into a detail view or opens a popup/modal, automatically return / restore state before processing the next item.
  - Graceful per-item failure isolation (log error for failed item and continue to next item).
- [ ] **CDP File Download & Artifact Management**:
  - Intercept CDP downloads (`Page.setDownloadBehavior` / `Browser.setDownloadBehavior`).
  - Store files per execution run (`recordings/runs/:runId/downloads/`).
  - Generate an execution manifest linking each downloaded file to its respective list item.
  - Expose `GET /api/runs/:runId/artifacts` and ZIP download endpoint.

---

## 📡 API Contract Specification (For Frontend Integration)

### 1. Authentication Endpoints

#### `POST /api/auth/register`
- **Request Body**:
  ```json
  {
    "username": "abuzar",
    "email": "user@example.com",
    "password": "SecurePassword123!"
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "success": true,
    "user": {
      "id": "usr_12345",
      "username": "abuzar",
      "email": "user@example.com"
    },
    "token": "jwt_token_string_here"
  }
  ```

#### `POST /api/auth/login`
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "SecurePassword123!"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "user": {
      "id": "usr_12345",
      "username": "abuzar",
      "email": "user@example.com"
    },
    "token": "jwt_token_string_here"
  }
  ```

#### `GET /api/auth/me`
- **Headers**: `Authorization: Bearer <token>`
- **Response (200 OK)**:
  ```json
  {
    "user": {
      "id": "usr_12345",
      "username": "abuzar",
      "email": "user@example.com"
    }
  }
  ```

---

### 2. Workflow Management Endpoints

#### `GET /api/workflows`
- **Headers**: `Authorization: Bearer <token>`
- **Response (200 OK)**:
  ```json
  {
    "workflows": [
      {
        "id": "wf_abc123",
        "name": "Portal Login & Export",
        "description": "Logs into ERP and downloads report",
        "targetUrl": "https://example.com/portal",
        "stepCount": 8,
        "createdAt": "2026-09-17T12:00:00.000Z",
        "updatedAt": "2026-09-17T12:15:00.000Z"
      }
    ]
  }
  ```

#### `POST /api/workflows/:id/execute`
- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "headless": true,
    "params": {
      "date": "2026-09-17"
    }
  }
  ```
- **Response (202 Accepted)**:
  ```json
  {
    "runId": "run_98765",
    "status": "QUEUED",
    "streamUrl": "/api/runs/run_98765/stream"
  }
  ```

---

## 🗂️ Proposed Backend Directory Layout

```text
src/
├── auth/                 # Authentication modules (hashing, tokens, middleware)
│   ├── auth-service.js
│   ├── auth-middleware.js
│   └── user-store.js
├── api/                  # REST API Route Handlers
│   ├── auth-routes.js
│   ├── workflow-routes.js
│   └── run-routes.js
├── database/             # Storage adapters (SQLite / Mongo / In-Memory)
│   └── db.js
├── recorder/             # CDP In-page recorder core
├── replay/               # CDP Replay engine
├── shared/               # Shared selector resolvers & constants
└── utils/                # Logger, CDP connector, crypto helpers
```
