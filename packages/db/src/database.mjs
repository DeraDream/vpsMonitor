import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_SETTINGS = {
  telegram: { botTokenEncrypted: "", chatId: "", enabled: false, showBuyLink: true, template: "standard" },
  updates: { repository: "DeraDream/vpsMonitor", branch: "main" }
};

export function createDatabase(dataDir = process.env.DATA_DIR || "./data") {
  const dir = resolve(dataDir); mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "vps-monitor.db"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_plans_provider ON plans(provider_id);
    CREATE TABLE IF NOT EXISTS monitors (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, next_attempt_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_events_at ON events(at DESC);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  seedSettings(db);
  migrateLegacyStore(db, dir);
  return new Store(db);
}
function seedSettings(db) {
  const ins = db.prepare("INSERT OR IGNORE INTO kv(key,value) VALUES (?,?)");
  ins.run("settings", JSON.stringify(DEFAULT_SETTINGS));
  ins.run("runtime", JSON.stringify({schedulerStartedAt:new Date().toISOString(),lastTickAt:null}));
}
function migrateLegacyStore(db, dir) {
  const file = join(dir, "store.json"); if (!existsSync(file)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const count = Number(db.prepare("SELECT COUNT(*) AS c FROM providers").get().c || 0) + Number(db.prepare("SELECT COUNT(*) AS c FROM monitors").get().c || 0);
    if (count > 0 || !existsSync(file)) { db.exec("COMMIT"); return; }
    const data = JSON.parse(readFileSync(file, "utf8"));
    for (const p of (data.providers || []).filter(p => p.status !== "pending")) db.prepare("INSERT OR REPLACE INTO providers(id,payload) VALUES (?,?)").run(p.id, JSON.stringify(p));
    for (const p of data.plans || []) db.prepare("INSERT OR REPLACE INTO plans(id,provider_id,payload) VALUES (?,?,?)").run(p.id, p.providerId, JSON.stringify(p));
    for (const m of data.monitors || []) db.prepare("INSERT OR REPLACE INTO monitors(id,provider_id,payload) VALUES (?,?,?)").run(m.id, m.providerId, JSON.stringify(m));
    for (const n of data.notifications || []) db.prepare("INSERT OR REPLACE INTO notifications(id,next_attempt_at,payload) VALUES (?,?,?)").run(n.id, n.nextAttemptAt || new Date().toISOString(), JSON.stringify(n));
    for (const e of data.events || []) db.prepare("INSERT OR REPLACE INTO events(id,at,payload) VALUES (?,?,?)").run(e.id, e.at || new Date().toISOString(), JSON.stringify(e));
    const settings = structuredClone(DEFAULT_SETTINGS);
    Object.assign(settings.updates, data.settings?.updates || {});
    Object.assign(settings.telegram, data.settings?.telegram || {});
    delete settings.telegram.botToken; delete settings.telegram.showQuantity; delete settings.telegram.soldoutMode;
    db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES ('settings',?)").run(JSON.stringify(settings));
    db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES ('runtime',?)").run(JSON.stringify({...{schedulerStartedAt:new Date().toISOString(),lastTickAt:null},...(data.runtime||{})}));
    db.exec("COMMIT");
    if (existsSync(file)) renameSync(file, `${file}.migrated`);
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
}

class Store {
  constructor(db){this.db=db;}
  listProviders(){return this.db.prepare("SELECT payload FROM providers ORDER BY rowid").all().map(r=>JSON.parse(r.payload));}
  getProvider(id){const r=this.db.prepare("SELECT payload FROM providers WHERE id=?").get(id);return r?JSON.parse(r.payload):null;}
  putProvider(v){this.db.prepare("INSERT OR REPLACE INTO providers(id,payload) VALUES (?,?)").run(v.id,JSON.stringify(v));}
  listPlans(providerId=null){const rows=providerId?this.db.prepare("SELECT payload FROM plans WHERE provider_id=? ORDER BY rowid").all(providerId):this.db.prepare("SELECT payload FROM plans ORDER BY rowid").all();return rows.map(r=>JSON.parse(r.payload));}
  getPlan(id){const r=this.db.prepare("SELECT payload FROM plans WHERE id=?").get(id);return r?JSON.parse(r.payload):null;}
  putPlan(v){this.db.prepare("INSERT OR REPLACE INTO plans(id,provider_id,payload) VALUES (?,?,?)").run(v.id,v.providerId,JSON.stringify(v));}
  listMonitors(){return this.db.prepare("SELECT payload FROM monitors ORDER BY rowid").all().map(r=>JSON.parse(r.payload));}
  getMonitor(id){const r=this.db.prepare("SELECT payload FROM monitors WHERE id=?").get(id);return r?JSON.parse(r.payload):null;}
  getMonitorByProvider(providerId){const r=this.db.prepare("SELECT payload FROM monitors WHERE provider_id=?").get(providerId);return r?JSON.parse(r.payload):null;}
  putMonitor(v){this.db.prepare("INSERT OR REPLACE INTO monitors(id,provider_id,payload) VALUES (?,?,?)").run(v.id,v.providerId,JSON.stringify(v));}
  deleteMonitor(id){this.db.prepare("DELETE FROM monitors WHERE id=?").run(id);}
  listNotifications(){return this.db.prepare("SELECT payload FROM notifications ORDER BY next_attempt_at").all().map(r=>JSON.parse(r.payload));}
  putNotification(v){this.db.prepare("INSERT OR REPLACE INTO notifications(id,next_attempt_at,payload) VALUES (?,?,?)").run(v.id,v.nextAttemptAt,JSON.stringify(v));}
  deleteNotification(id){this.db.prepare("DELETE FROM notifications WHERE id=?").run(id);}
  addEvent(v){this.db.prepare("INSERT OR REPLACE INTO events(id,at,payload) VALUES (?,?,?)").run(v.id,v.at,JSON.stringify(v));this.db.exec("DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY at DESC LIMIT 500)");}
  listEvents(limit=500){return this.db.prepare("SELECT payload FROM events ORDER BY at DESC LIMIT ?").all(limit).map(r=>JSON.parse(r.payload));}
  getSettings(){return JSON.parse(this.db.prepare("SELECT value FROM kv WHERE key='settings'").get().value);}
  setSettings(v){this.db.prepare("UPDATE kv SET value=? WHERE key='settings'").run(JSON.stringify(v));}
  getRuntime(){return JSON.parse(this.db.prepare("SELECT value FROM kv WHERE key='runtime'").get().value);}
  setRuntime(v){this.db.prepare("UPDATE kv SET value=? WHERE key='runtime'").run(JSON.stringify(v));}
  close(){this.db.close();}
}
