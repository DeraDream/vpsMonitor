import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { encryptToken } from "../../core/src/crypto.mjs";

const DEFAULT_SETTINGS = {
  activity: { refreshIntervalSeconds: 10 },
  telegram: { botTokenEncrypted: "", chatId: "", channelEnabled: true, personalChatId: "", personalEnabled: false, enabled: false, showBuyLink: true, template: "standard", notificationMode: "restock", notifyNewPlans: true, quietHours: { enabled: false, start: "23:00", end: "08:00" } },
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
    CREATE TABLE IF NOT EXISTS notification_claims (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_events_at ON events(at DESC);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  try { seedSettings(db); migrateLegacyStore(db, dir); } catch (error) { db.close(); throw error; }
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
    if (settings.telegram.botToken) settings.telegram.botTokenEncrypted = encryptToken(settings.telegram.botToken);
    delete settings.telegram.botToken; delete settings.telegram.showQuantity; delete settings.telegram.soldoutMode;
    db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES ('settings',?)").run(JSON.stringify(settings));
    db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES ('runtime',?)").run(JSON.stringify({...{schedulerStartedAt:new Date().toISOString(),lastTickAt:null},...(data.runtime||{})}));
    if (data.settings?.telegram?.botToken) {
      data.settings.telegram = { ...settings.telegram };
      writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
    }
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
  transaction(fn){this.db.exec("BEGIN IMMEDIATE");try{const result=fn();this.db.exec("COMMIT");return result;}catch(error){this.db.exec("ROLLBACK");throw error;}}
  deleteMonitor(id){this.transaction(()=>{const monitor=this.getMonitor(id);if(monitor)for(const job of this.listNotifications()){const plan=this.getPlan(job.planId);if(job.monitorId===id||(!job.monitorId&&plan?.providerId===monitor.providerId))this.deleteNotification(job.id);}this.db.prepare("DELETE FROM monitors WHERE id=?").run(id);});}
  listNotifications(){return this.db.prepare("SELECT payload FROM notifications ORDER BY next_attempt_at,rowid").all().map(r=>JSON.parse(r.payload));}
  getNotification(id){const row=this.db.prepare("SELECT payload FROM notifications WHERE id=?").get(id);return row?JSON.parse(row.payload):null;}
  putNotification(v){this.db.prepare("INSERT OR REPLACE INTO notifications(id,next_attempt_at,payload) VALUES (?,?,?)").run(v.id,v.nextAttemptAt,JSON.stringify(v));}
  claimNotification(id,owner,now=Date.now()){
    return Boolean(this.db.prepare(`INSERT INTO notification_claims(id,owner,expires_at)
      SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM notifications WHERE id=?)
      ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
      WHERE notification_claims.expires_at<=? RETURNING owner`).get(id,owner,now+60000,id,now));
  }
  finishNotification(id,owner,retry=null){return this.transaction(()=>{if(this.db.prepare("SELECT owner FROM notification_claims WHERE id=?").get(id)?.owner!==owner)return false;if(retry)this.putNotification(retry);else this.db.prepare("DELETE FROM notifications WHERE id=?").run(id);this.db.prepare("DELETE FROM notification_claims WHERE id=? AND owner=?").run(id,owner);return true;});}
  releaseNotification(id,owner){this.db.prepare("DELETE FROM notification_claims WHERE id=? AND owner=?").run(id,owner);}
  deleteNotification(id){this.db.prepare("DELETE FROM notifications WHERE id=?").run(id);this.db.prepare("DELETE FROM notification_claims WHERE id=?").run(id);}
  addEvent(v){this.db.prepare("INSERT OR REPLACE INTO events(id,at,payload) VALUES (?,?,?)").run(v.id,v.at,JSON.stringify(v));this.db.exec(`DELETE FROM events WHERE id NOT IN (
      SELECT id FROM (SELECT id FROM events WHERE json_extract(payload, '$.type') IN ('new_plan','restocked','sold_out','stock_changed','delisted') ORDER BY at DESC LIMIT 500)
      UNION SELECT id FROM (SELECT id FROM events WHERE COALESCE(json_extract(payload, '$.type'),'') NOT IN ('new_plan','restocked','sold_out','stock_changed','delisted') ORDER BY at DESC LIMIT 500)
    )`);}
  listEvents(limit=500,types=null){
    const filtered=Array.isArray(types)&&types.length;
    const query=filtered?`SELECT payload FROM events WHERE json_extract(payload, '$.type') IN (${types.map(()=>'?').join(',')}) ORDER BY at DESC LIMIT ?`:"SELECT payload FROM events ORDER BY at DESC LIMIT ?";
    return this.db.prepare(query).all(...(filtered?[...types,limit]:[limit])).map(r=>JSON.parse(r.payload));
  }
  pageEvents({types,limit=30,cursor=null}={}){
    const clauses=[],args=[];
    if(types?.length){clauses.push(`json_extract(payload, '$.type') IN (${types.map(()=>'?').join(',')})`);args.push(...types);}
    if(cursor){clauses.push('(at < ? OR (at = ? AND id < ?))');args.push(cursor.at,cursor.at,cursor.id);}
    const rows=this.db.prepare(`SELECT payload FROM events ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY at DESC,id DESC LIMIT ?`).all(...args,limit+1).map(row=>JSON.parse(row.payload));
    const hasMore=rows.length>limit,items=rows.slice(0,limit),last=items.at(-1);
    return {items,nextCursor:hasMore?Buffer.from(JSON.stringify({at:last.at,id:last.id})).toString('base64url'):null};
  }
  getSettings(){const saved=JSON.parse(this.db.prepare("SELECT value FROM kv WHERE key='settings'").get().value);return {...saved,activity:{...DEFAULT_SETTINGS.activity,...saved.activity},updates:{...DEFAULT_SETTINGS.updates,...saved.updates},telegram:{...DEFAULT_SETTINGS.telegram,...saved.telegram,quietHours:{...DEFAULT_SETTINGS.telegram.quietHours,...saved.telegram?.quietHours}}};}
  setSettings(v){this.db.prepare("UPDATE kv SET value=? WHERE key='settings'").run(JSON.stringify(v));}
  getRuntime(){return JSON.parse(this.db.prepare("SELECT value FROM kv WHERE key='runtime'").get().value);}
  setRuntime(v){this.db.prepare("UPDATE kv SET value=? WHERE key='runtime'").run(JSON.stringify(v));}
  close(){this.db.close();}
}
