/**
 * Workflow Capture — Persistent JSON Database Store
 * 
 * Lightweight, zero-dependency, transactional file-based storage engine.
 * Supports collections for users, workflows, runs, and secrets with
 * thread-safe in-memory caching and atomic disk persistence.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Default Database Schema
const DEFAULT_SCHEMA = {
  users: [],
  workflows: [],
  runs: [],
  secrets: []
};

class JsonDB {
  constructor(dbPath = DB_FILE) {
    this.dbPath = dbPath;
    this.dataDir = path.dirname(dbPath);
    this.state = JSON.parse(JSON.stringify(DEFAULT_SCHEMA));
    this.init();
  }

  init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        this.state = { ...DEFAULT_SCHEMA, ...JSON.parse(raw) };
      } catch (err) {
        console.error(`[DB] Failed reading ${this.dbPath}, initializing fresh schema`, err);
        this.save();
      }
    } else {
      this.save();
    }
  }

  save() {
    try {
      const tempPath = `${this.dbPath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tempPath, this.dbPath);
    } catch (err) {
      console.error('[DB] Error persisting database to disk:', err);
    }
  }

  // --- Collection Query Helpers ---

  find(collection, filterFn = () => true) {
    if (!this.state[collection]) return [];
    return this.state[collection].filter(filterFn);
  }

  findOne(collection, filterFn) {
    if (!this.state[collection]) return null;
    return this.state[collection].find(filterFn) || null;
  }

  findById(collection, id) {
    return this.findOne(collection, item => item.id === id);
  }

  insert(collection, item) {
    if (!this.state[collection]) {
      this.state[collection] = [];
    }
    const record = {
      id: item.id || `${collection.slice(0, 3)}_${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...item
    };
    this.state[collection].push(record);
    this.save();
    return record;
  }

  update(collection, id, updates) {
    if (!this.state[collection]) return null;
    const index = this.state[collection].findIndex(item => item.id === id);
    if (index === -1) return null;

    const existing = this.state[collection][index];
    const updated = {
      ...existing,
      ...updates,
      id: existing.id, // Immutable ID
      createdAt: existing.createdAt, // Preserve creation
      updatedAt: new Date().toISOString()
    };

    this.state[collection][index] = updated;
    this.save();
    return updated;
  }

  delete(collection, id) {
    if (!this.state[collection]) return false;
    const initialLen = this.state[collection].length;
    this.state[collection] = this.state[collection].filter(item => item.id !== id);
    if (this.state[collection].length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Reset database for test environments
  reset() {
    this.state = JSON.parse(JSON.stringify(DEFAULT_SCHEMA));
    this.save();
  }
}

const db = new JsonDB();

module.exports = {
  db,
  JsonDB
};
