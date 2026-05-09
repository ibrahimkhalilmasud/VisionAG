const path   = require('path');
const fs     = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'visionag.db');
let _db = null;

// ── helpers ──────────────────────────────────────────────────
function save() {
  if (!_db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
}

function run(sql, params = []) {
  _db.run(sql, params);
  return { lastInsertRowid: _db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0] };
}

function get(sql, params = []) {
  const r = _db.exec(sql, params);
  if (!r.length || !r[0].values.length) return undefined;
  const row = {};
  r[0].columns.forEach((c, i) => { row[c] = r[0].values[0][i]; });
  return row;
}

function all(sql, params = []) {
  const r = _db.exec(sql, params);
  if (!r.length) return [];
  return r[0].values.map(v => {
    const row = {};
    r[0].columns.forEach((c, i) => { row[c] = v[i]; });
    return row;
  });
}

function prepare(sql) {
  return {
    run:  (...p) => { const flat = p.flat(); return run(sql, flat); },
    get:  (...p) => get(sql, p.flat()),
    all:  (...p) => all(sql, p.flat()),
  };
}

// ── init ─────────────────────────────────────────────────────
async function initializeDatabase() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });

  _db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  _db.run('PRAGMA foreign_keys = ON');

  // ── Check schema version — rebuild products if old schema ──
  const cols = all("PRAGMA table_info(products)").map(r => r.name);
  const needsMigration = cols.length > 0 && !cols.includes('category');
  if (needsMigration) {
    console.log('  Migrating to new schema...');
    _db.run('DROP TABLE IF EXISTS products');
    _db.run('DROP TABLE IF EXISTS stock_movements');
  }
  // ── Add sold_date if missing ──
  if (cols.length > 0 && !cols.includes('sold_date')) {
    console.log('  Adding sold_date column...');
    _db.run("ALTER TABLE products ADD COLUMN sold_date TEXT DEFAULT NULL");
  }
  // ── Add color column if missing ──
  if (cols.length > 0 && !cols.includes('color')) {
    _db.run("ALTER TABLE products ADD COLUMN color TEXT DEFAULT NULL");
  }

  _db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name     TEXT,
      role          TEXT NOT NULL DEFAULT 'staff',
      active        INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      category       TEXT NOT NULL,
      brand          TEXT,
      design         TEXT,
      article        TEXT,
      quality        TEXT,
      qty            REAL DEFAULT 0,
      cost_eur       REAL DEFAULT 0,
      cost_rm        REAL DEFAULT 0,
      cost_piece_rm  REAL DEFAULT 0,
      vip_mt_rm      REAL DEFAULT 0,
      vip_piece_rm   REAL DEFAULT 0,
      sell_mt_rm     REAL DEFAULT 0,
      sell_piece_rm  REAL DEFAULT 0,
      status         TEXT DEFAULT 'available',
      sold_to        TEXT,
      actual_sell_rm REAL DEFAULT 0,
      commission_pct REAL DEFAULT 0,
      net_profit     REAL DEFAULT 0,
      notes          TEXT,
      color          TEXT,
      photo_path     TEXT,
      sold_date      TEXT DEFAULT NULL,
      active         INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now'))
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      phone      TEXT, email TEXT, address TEXT, company TEXT, notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number  TEXT UNIQUE NOT NULL,
      client_id       INTEGER,
      invoice_date    TEXT NOT NULL,
      subtotal        REAL DEFAULT 0,
      discount_pct    REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      tax_pct         REAL DEFAULT 0,
      tax_amount      REAL DEFAULT 0,
      total           REAL DEFAULT 0,
      currency        TEXT DEFAULT 'MYR',
      status          TEXT DEFAULT 'pending',
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id   INTEGER NOT NULL,
      product_id   INTEGER,
      product_name TEXT,
      design       TEXT,
      article      TEXT,
      quality      TEXT,
      quantity     REAL NOT NULL,
      unit_price   REAL NOT NULL,
      subtotal     REAL NOT NULL
    )
  `);

  // ── Seed users ────────────────────────────────────────────
  if (!get("SELECT id FROM users WHERE role='admin' LIMIT 1")) {
    run('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)',
      ['admin', bcrypt.hashSync('admin123', 10), 'Administrator', 'admin']);
    run('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)',
      ['staff', bcrypt.hashSync('staff123', 10), 'Staff User', 'staff']);
    console.log('  ✓ Default users created');
  }

  // ── Seed products from Excel data ─────────────────────────
  if (get('SELECT COUNT(*) as c FROM products').c === 0) {
    const dataFile = path.join(__dirname, 'inventory_data.json');
    if (fs.existsSync(dataFile)) {
      console.log('  Loading inventory from Excel data...');
      const items = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      _db.run('BEGIN');
      for (const it of items) {
        run(`INSERT INTO products
          (category,brand,design,article,quality,qty,cost_eur,cost_rm,cost_piece_rm,
           vip_mt_rm,vip_piece_rm,sell_mt_rm,sell_piece_rm,status,sold_to)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            it.category||'', it.brand||'', it.design||'', it.article||'', it.quality||'',
            it.qty||0, it.cost_eur||0, it.cost_rm||0, it.cost_piece_rm||0,
            it.vip_mt_rm||0, it.vip_piece_rm||0, it.sell_mt_rm||0, it.sell_piece_rm||0,
            it.sold_to ? 'sold' : 'available', it.sold_to||null
          ]
        );
      }
      _db.run('COMMIT');
      console.log(`  ✓ ${items.length} items loaded from Excel`);
    }
  }

  save();
  console.log('✅ Database ready');

  setInterval(save, 15000);
  process.on('exit',   save);
  process.on('SIGINT',  () => { save(); process.exit(0); });
  process.on('SIGTERM', () => { save(); process.exit(0); });

  return { prepare, run, get, all, save };
}

module.exports = { initializeDatabase };
