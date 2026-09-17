# AI Agent Project Context & Guidelines

## 📌 Project Overview
**Workflow Capture** is a browser automation MVP engine featuring CDP-based recording, fingerprint-based resilient selector resolution, and replay with real-time logging.

---

## 👥 Team Workflows & Branch Division

| Contributor | Branch | Primary Responsibility |
| :--- | :--- | :--- |
| **AbuZar (You / Current Branch)** | `generic-login` (Backend) | **Backend Architecture, Authentication / Login, Database, API Endpoints, Execution Engine Integration, Security** |
| **Partner** | `UI-for-dashboard` (Frontend) | **Frontend UI / Dashboard, Client Components, Visual Styling, User Experience** |

---

## 🎯 Backend Scope & Responsibilities (Current Working Focus)

When assisting on this branch (`generic-login`), strictly focus on backend tasks:
1. **Generic Login & Authentication**:
   - User authentication (Signup, Login, Logout, Session / JWT token management, Password hashing).
   - Auth middleware for route protection.
   - User credentials vault / secret injection for replay automation.
2. **REST API & Workflow Data Management**:
   - Workflow CRUD endpoints (`/api/workflows`, `/api/recordings`).
   - Replay / execution endpoints (`/api/workflows/:id/execute`, `/api/runs`).
   - Maintaining clean API contracts and JSON schemas so the frontend team can integrate seamlessly without merge conflicts.
3. **Core Engine Integration**:
   - Server-side CDP integration, recording bridges, and replay runner dispatching.
   - Storage layer (SQLite / MongoDB / JSON persistence).

---

## ⚠️ Collaboration & Merge Boundary Rules

1. **Do not overwrite frontend UI files** (`src/dashboard/public/*` or partner-designated frontend folders) unless exposing backend API endpoints or providing agreed mock data.
2. **Maintain Backward-Compatible API Contracts**: Document all API routes in [BACKEND_CONTEXT.md](file:///c:/Users/AbuZar/Desktop/Fyp/Workflow-Capture/BACKEND_CONTEXT.md) so the frontend branch can consume them without breaks.
3. Keep database migrations, auth models, and server logic modular inside `src/server/` or dedicated backend submodules.

Refer to [BACKEND_CONTEXT.md](file:///c:/Users/AbuZar/Desktop/Fyp/Workflow-Capture/BACKEND_CONTEXT.md) for full endpoint specifications, database schemas, and current task progress.
