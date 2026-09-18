# Utility & Migration Scripts

This folder contains standalone maintenance and migration scripts for **Workflow Capture**.

### Available Scripts:
- `node scripts/migrate-recordings.js`: Migrates legacy filesystem recording JSON files in `recordings/` into the database for the primary test user.
- `node scripts/migrate-recordings-all-users.js`: Copies legacy recordings to all registered users in `data/db.json`.
- `node scripts/fix-workflow-schema.js`: Normalizes legacy workflow records to ensure `targetUrl` and `steps` fields exist.
