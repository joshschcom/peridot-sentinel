import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ConnectError } from '../../packages/sentinel-sdk/index.mjs';

export class Journal {
  constructor(path, keeperPath) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.keeperPath = keeperPath;
    this.db.exec(`PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS proposal(id TEXT PRIMARY KEY, body TEXT NOT NULL, hash TEXT UNIQUE, nonce INTEGER, outcome TEXT);
      CREATE TABLE IF NOT EXISTS invalid_proposal(id TEXT PRIMARY KEY, reason TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_connect_pending ON proposal((1)) WHERE hash IS NOT NULL AND outcome IS NULL`);
  }
  propose(id, body) {
    this.db
      .prepare('INSERT OR IGNORE INTO proposal(id,body) VALUES(?,?)')
      .run(id, JSON.stringify(body));
  }
  get(id) {
    return this.db
      .prepare(
        'SELECT p.*, invalid.reason AS invalidReason FROM proposal p LEFT JOIN invalid_proposal invalid ON p.id=invalid.id WHERE p.id=?',
      )
      .get(id);
  }
  invalidateUnsent(id, reason) {
    return this.atomic(() => {
      const row = this.get(id);
      if (!row || row.hash) return false;
      this.db
        .prepare('INSERT OR IGNORE INTO invalid_proposal(id,reason) VALUES(?,?)')
        .run(id, reason);
      return true;
    });
  }
  connectKeeper() {
    if (this.shared) return;
    mkdirSync(dirname(this.keeperPath), { recursive: true, mode: 0o700 });
    this.db.prepare('ATTACH DATABASE ? AS keeper').run(this.keeperPath);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS keeper.pending(slot INTEGER PRIMARY KEY CHECK(slot=1),hash TEXT NOT NULL,nonce INTEGER NOT NULL,account TEXT)',
    );
    const cols = this.db.prepare('PRAGMA keeper.table_info(pending)').all();
    if (!cols.some((c) => c.name === 'account'))
      this.db.exec('ALTER TABLE keeper.pending ADD COLUMN account TEXT');
    this.shared = true;
  }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  reserve(id, hash, nonce, account) {
    this.connectKeeper();
    return this.atomic(() => {
      const existing = this.get(id);
      if (existing.hash) return false;
      if (existing.invalidReason)
        throw new ConnectError(
          existing.invalidReason,
          'This unsigned proposal is no longer active',
        );
      const slot = this.db.prepare('SELECT hash FROM keeper.pending WHERE slot=1').get();
      const prior = this.db
        .prepare('SELECT id FROM proposal WHERE hash IS NOT NULL AND outcome IS NULL')
        .get();
      if (slot || prior)
        throw new ConnectError(
          'OPERATOR_BUSY',
          'An operator transaction is pending; reconcile its original hash',
        );
      this.db
        .prepare('INSERT INTO keeper.pending(slot,hash,nonce,account) VALUES(1,?,?,?)')
        .run(hash, nonce, account);
      this.db
        .prepare('UPDATE proposal SET hash=?,nonce=? WHERE id=? AND hash IS NULL')
        .run(hash, nonce, id);
      return true;
    });
  }
  settle(id, hash, outcome) {
    this.connectKeeper();
    this.atomic(() => {
      this.db
        .prepare('UPDATE proposal SET outcome=? WHERE id=? AND hash=?')
        .run(JSON.stringify(outcome), id, hash);
      this.db.prepare('DELETE FROM keeper.pending WHERE hash=?').run(hash);
    });
  }
  close() {
    this.db.close();
  }
}
