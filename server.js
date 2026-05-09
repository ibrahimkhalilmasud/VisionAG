'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const ExcelJS = require('exceljs');
const { initializeDatabase } = require('./database');

const app    = express();
const PORT   = Number.parseInt(process.env.PORT, 10) || 3000;
const SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret';
const INVENTORY_JSON_PATH = path.join(__dirname, 'data', 'inventory_data.json');
const ALLOWED_ROLES = new Set(['admin', 'staff']);
const ALLOWED_PRODUCT_STATUSES = new Set(['available', 'pending', 'sold']);
const ALLOWED_INVOICE_STATUSES = new Set(['pending', 'paid', 'cancelled', 'draft']);
const CORS_ORIGINS = (process.env.CORS_ORIGINS || `http://localhost:${PORT},http://127.0.0.1:${PORT}`)
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set. Using development fallback secret.');
}

const cors = require('cors');
app.use(cors({
  origin(origin, cb) {
    if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed by CORS'));
  }
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const log = (level, message, meta = {}) => {
  const entry = { ts: new Date().toISOString(), level, message, ...meta };
  console.log(JSON.stringify(entry));
};

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    log('info', 'http_request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      user_id: req.user?.id || null,
    });
  });
  next();
});

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

// multer for product photos
const photoUpload = multer({
  dest: uploadsDir,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, f, cb) => cb(null, f.mimetype.startsWith('image/'))
});

// multer for excel/csv imports
const importUpload = multer({ dest: uploadsDir, limits: { fileSize: 20 * 1024 * 1024 } });

let db;
const asString = v => (v === undefined || v === null ? '' : String(v).trim());
const asNumber = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const parsePositiveInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const validateRole = role => !role || ALLOWED_ROLES.has(role);
const validateProductStatus = status => !status || ALLOWED_PRODUCT_STATUSES.has(status);
const validateInvoiceStatus = status => !status || ALLOWED_INVOICE_STATUSES.has(status);

const normalizeCellValue = (cellVal) => {
  if (cellVal === undefined || cellVal === null) return '';
  if (typeof cellVal === 'object') {
    if (cellVal.text !== undefined) return asString(cellVal.text);
    if (cellVal.result !== undefined) return asString(cellVal.result);
    if (cellVal.hyperlink !== undefined) return asString(cellVal.hyperlink);
    if (cellVal.richText && Array.isArray(cellVal.richText)) {
      return asString(cellVal.richText.map(rt => rt.text || '').join(''));
    }
    if (cellVal.formula !== undefined) return asString(cellVal.formula);
    if (cellVal.error !== undefined) return asString(cellVal.error);
  }
  return asString(cellVal);
};

const parseSpreadsheetRows = async (filePath, originalName = '') => {
  const workbook = new ExcelJS.Workbook();
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.csv') {
    await workbook.csv.readFile(filePath);
  } else {
    await workbook.xlsx.readFile(filePath);
  }
  const ws = workbook.worksheets[0];
  if (!ws) return { columns: [], rows: [] };

  const headerRow = ws.getRow(1);
  const columns = [];
  for (let i = 1; i <= headerRow.cellCount; i++) {
    const c = normalizeCellValue(headerRow.getCell(i).value);
    columns.push(c || `column_${i}`);
  }

  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    let hasValue = false;
    columns.forEach((column, idx) => {
      const value = normalizeCellValue(row.getCell(idx + 1).value);
      obj[column] = value;
      if (value !== '') hasValue = true;
    });
    if (hasValue) rows.push(obj);
  });

  return { columns, rows };
};

const auth = (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET);
    next();
  } catch { res.status(401).json({ error: 'Please log in' }); }
};
const adminOnly = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });

// ═══════════════ AUTH ════════════════════════════════════════
app.post('/api/auth/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(req.body.username);
  if (!u || !bcrypt.compareSync(req.body.password, u.password_hash))
    return res.status(401).json({ error: 'Invalid username or password' });
  res.json({
    token: jwt.sign({ id: u.id, username: u.username, role: u.role, full_name: u.full_name }, SECRET, { expiresIn: '12h' }),
    user:  { id: u.id, username: u.username, role: u.role, full_name: u.full_name }
  });
});

app.get('/api/auth/me', auth, (req, res) => res.json(req.user));

// ═══════════════ USERS ═══════════════════════════════════════
app.get('/api/users', auth, adminOnly, (_, res) =>
  res.json(db.prepare('SELECT id,username,full_name,role,active,created_at FROM users ORDER BY id').all()));

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, full_name, role } = req.body;
  if (!asString(username)) return res.status(400).json({ error: 'Username required' });
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (!validateRole(role || 'staff')) return res.status(400).json({ error: 'Invalid role' });
  try {
    const r = db.prepare('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)')
                .run(asString(username), bcrypt.hashSync(password, 10), asString(full_name), role||'staff');
    db.save(); res.json({ id: r.lastInsertRowid });
  } catch { res.status(400).json({ error: 'Username already exists' }); }
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const { full_name, role, active, password } = req.body;
  if (!validateRole(role)) return res.status(400).json({ error: 'Invalid role' });
  if (password)
    db.prepare('UPDATE users SET full_name=?,role=?,active=?,password_hash=? WHERE id=?')
      .run(asString(full_name), role, active??1, bcrypt.hashSync(password,10), req.params.id);
  else
    db.prepare('UPDATE users SET full_name=?,role=?,active=? WHERE id=?')
      .run(asString(full_name), role, active??1, req.params.id);
  db.save(); res.json({ success: true });
});

// ═══════════════ PRODUCTS ════════════════════════════════════
app.get('/api/products', auth, (req, res) => {
  const { category, brand, quality, status, color, search, page=1, limit=50 } = req.query;
  const pageNum = parsePositiveInt(page, 1, 1, 100000);
  const limitNum = parsePositiveInt(limit, 50, 1, 200);
  let sql = 'SELECT * FROM products WHERE active=1';
  const p = [];
  if (category) { sql += ' AND category=?'; p.push(category); }
  if (brand)    { sql += ' AND brand=?';    p.push(brand); }
  if (quality)  { sql += ' AND quality=?';  p.push(quality); }
  if (status)   { sql += ' AND status=?';   p.push(status); }
  if (color)    { sql += ' AND color=?';    p.push(color); }
  if (search) {
    sql += ' AND (design LIKE ? OR article LIKE ? OR quality LIKE ? OR brand LIKE ? OR color LIKE ? OR notes LIKE ?)';
    const s = `%${search}%`;
    p.push(s,s,s,s,s,s);
  }
  const total = db.prepare(sql.replace('SELECT *','SELECT COUNT(*) as c')).get(...p)?.c || 0;
  sql += ' ORDER BY category,brand,id';
  const off = (pageNum - 1) * limitNum;
  sql += ` LIMIT ${limitNum} OFFSET ${off}`;
  res.json({ items: db.prepare(sql).all(...p), total, page: pageNum, limit: limitNum });
});

app.get('/api/products/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/products', auth, (req, res) => {
  const { category, brand, design, article, quality, color, qty,
          cost_eur, cost_rm, cost_piece_rm, vip_mt_rm, vip_piece_rm,
          sell_mt_rm, sell_piece_rm, status, sold_to, sold_date, notes } = req.body;
  if (!asString(category)) return res.status(400).json({ error: 'Category required' });
  if (!validateProductStatus(status || 'available')) return res.status(400).json({ error: 'Invalid status' });
  const r = db.prepare(`INSERT INTO products
    (category,brand,design,article,quality,color,qty,cost_eur,cost_rm,cost_piece_rm,
     vip_mt_rm,vip_piece_rm,sell_mt_rm,sell_piece_rm,status,sold_to,sold_date,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(asString(category),asString(brand),asString(design),asString(article),asString(quality),asString(color)||null,asNumber(qty),
         asNumber(cost_eur),asNumber(cost_rm),asNumber(cost_piece_rm),
         asNumber(vip_mt_rm),asNumber(vip_piece_rm),asNumber(sell_mt_rm),asNumber(sell_piece_rm),
         status||'available',asString(sold_to)||null,asString(sold_date)||null,asString(notes)||null);
  db.save(); res.json({ id: r.lastInsertRowid });
});

app.put('/api/products/:id', auth, (req, res) => {
  const { category, brand, design, article, quality, color, qty,
          cost_eur, cost_rm, cost_piece_rm, vip_mt_rm, vip_piece_rm,
          sell_mt_rm, sell_piece_rm, status, sold_to, sold_date,
          actual_sell_rm, commission_pct, net_profit, notes } = req.body;
  if (!asString(category)) return res.status(400).json({ error: 'Category required' });
  if (!validateProductStatus(status || 'available')) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`UPDATE products SET
    category=?,brand=?,design=?,article=?,quality=?,color=?,qty=?,
    cost_eur=?,cost_rm=?,cost_piece_rm=?,vip_mt_rm=?,vip_piece_rm=?,
    sell_mt_rm=?,sell_piece_rm=?,status=?,sold_to=?,sold_date=?,
    actual_sell_rm=?,commission_pct=?,net_profit=?,notes=?,
    updated_at=datetime('now') WHERE id=?`)
    .run(asString(category),asString(brand),asString(design),asString(article),asString(quality),asString(color)||null,asNumber(qty),
         asNumber(cost_eur),asNumber(cost_rm),asNumber(cost_piece_rm),
         asNumber(vip_mt_rm),asNumber(vip_piece_rm),asNumber(sell_mt_rm),asNumber(sell_piece_rm),
         status||'available',asString(sold_to)||null,asString(sold_date)||null,
         asNumber(actual_sell_rm),asNumber(commission_pct),asNumber(net_profit),
         asString(notes)||null,req.params.id);
  db.save(); res.json({ success: true });
});

app.post('/api/products/:id/photo', auth, photoUpload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const old = db.prepare('SELECT photo_path FROM products WHERE id=?').get(req.params.id);
  if (old?.photo_path) { try { fs.unlinkSync(path.join(__dirname, old.photo_path.replace(/^\//,''))); } catch {} }
  const ext = path.extname(req.file.originalname) || '.jpg';
  const newName = req.file.filename + ext;
  fs.renameSync(req.file.path, path.join(uploadsDir, newName));
  const photo_path = `/uploads/${newName}`;
  db.prepare("UPDATE products SET photo_path=?,updated_at=datetime('now') WHERE id=?").run(photo_path, req.params.id);
  db.save(); res.json({ photo_path });
});

app.patch('/api/products/:id/status', auth, (req, res) => {
  const { status, sold_to, sold_date, actual_sell_rm, commission_pct, net_profit } = req.body;
  if (!validateProductStatus(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`UPDATE products SET status=?,sold_to=?,sold_date=?,actual_sell_rm=?,
    commission_pct=?,net_profit=?,updated_at=datetime('now') WHERE id=?`)
    .run(status, asString(sold_to)||null, asString(sold_date)||null, asNumber(actual_sell_rm), asNumber(commission_pct), asNumber(net_profit), req.params.id);
  db.save(); res.json({ success: true });
});

app.delete('/api/products/:id', auth, adminOnly, (req, res) => {
  db.prepare("UPDATE products SET active=0,updated_at=datetime('now') WHERE id=?").run(req.params.id);
  db.save(); res.json({ success: true });
});

// ═══════════════ META ════════════════════════════════════════
app.get('/api/categories', auth, (_, res) => {
  const cats = ['SILK','LACE','CEMB','EMBROIDERY'];
  const result = cats.map(cat => {
    const r = db.prepare(`SELECT COUNT(*) as total,
      SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN status='sold' THEN 1 ELSE 0 END) as sold,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
      COALESCE(SUM(cost_piece_rm),0) as total_cost_rm,
      COALESCE(SUM(CASE WHEN status='available' THEN cost_piece_rm ELSE 0 END),0) as available_cost_rm,
      COALESCE(SUM(CASE WHEN status='available' THEN sell_piece_rm ELSE 0 END),0) as available_sell_rm
      FROM products WHERE active=1 AND category=?`).get(cat);
    return { category: cat, ...r };
  });
  res.json(result);
});

app.get('/api/brands', auth, (req, res) => {
  const { category } = req.query;
  let sql = "SELECT brand, COUNT(*) as count, SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) as available FROM products WHERE active=1 AND brand IS NOT NULL AND brand != ''";
  const p = [];
  if (category) { sql += ' AND category=?'; p.push(category); }
  sql += ' GROUP BY brand ORDER BY brand';
  res.json(db.prepare(sql).all(...p));
});

app.get('/api/qualities', auth, (req, res) => {
  const { category, brand } = req.query;
  let sql = "SELECT quality, COUNT(*) as count FROM products WHERE active=1 AND quality IS NOT NULL AND quality != ''";
  const p = [];
  if (category) { sql += ' AND category=?'; p.push(category); }
  if (brand)    { sql += ' AND brand=?';    p.push(brand); }
  sql += ' GROUP BY quality ORDER BY quality';
  res.json(db.prepare(sql).all(...p));
});

app.get('/api/colors', auth, (req, res) => {
  const { category } = req.query;
  let sql = "SELECT color, COUNT(*) as count FROM products WHERE active=1 AND color IS NOT NULL AND color != ''";
  const p = [];
  if (category) { sql += ' AND category=?'; p.push(category); }
  sql += ' GROUP BY color ORDER BY color';
  res.json(db.prepare(sql).all(...p));
});

// ═══════════════ DASHBOARD ════════════════════════════════════
app.get('/api/dashboard', auth, (_, res) => {
  const g = (s,...p) => db.prepare(s).get(...p);
  const a = (s,...p) => db.prepare(s).all(...p);
  const year = new Date().getFullYear();

  res.json({
    overview: {
      total:              g("SELECT COUNT(*) as c FROM products WHERE active=1").c,
      available:          g("SELECT COUNT(*) as c FROM products WHERE active=1 AND status='available'").c,
      sold:               g("SELECT COUNT(*) as c FROM products WHERE active=1 AND status='sold'").c,
      pending:            g("SELECT COUNT(*) as c FROM products WHERE active=1 AND status='pending'").c,
      total_cost_rm:      g("SELECT COALESCE(SUM(cost_piece_rm),0) as v FROM products WHERE active=1").v,
      available_cost_rm:  g("SELECT COALESCE(SUM(cost_piece_rm),0) as v FROM products WHERE active=1 AND status='available'").v,
      available_sell_rm:  g("SELECT COALESCE(SUM(sell_piece_rm),0) as v FROM products WHERE active=1 AND status='available'").v,
      sold_revenue:       g("SELECT COALESCE(SUM(actual_sell_rm),0) as v FROM products WHERE active=1 AND status='sold'").v,
      net_profit:         g("SELECT COALESCE(SUM(net_profit),0) as v FROM products WHERE active=1 AND status='sold'").v,
    },
    byCategory: a(`SELECT category,
      COUNT(*) as total,
      SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN status='sold' THEN 1 ELSE 0 END) as sold,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
      COALESCE(SUM(cost_piece_rm),0) as total_cost_rm,
      COALESCE(SUM(CASE WHEN status='available' THEN cost_piece_rm ELSE 0 END),0) as available_cost_rm,
      COALESCE(SUM(CASE WHEN status='sold' THEN actual_sell_rm ELSE 0 END),0) as sold_revenue
      FROM products WHERE active=1 GROUP BY category ORDER BY category`),
    monthlySales: a(`SELECT
      strftime('%m', COALESCE(sold_date, updated_at)) as month,
      COUNT(*) as count,
      COALESCE(SUM(actual_sell_rm),0) as revenue,
      COALESCE(SUM(net_profit),0) as profit
      FROM products WHERE active=1 AND status='sold'
      AND strftime('%Y', COALESCE(sold_date, updated_at)) = ?
      GROUP BY month ORDER BY month`, String(year)),
    topBrands: a(`SELECT brand, COUNT(*) as total,
      SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN status='sold' THEN 1 ELSE 0 END) as sold,
      COALESCE(SUM(CASE WHEN status='sold' THEN actual_sell_rm ELSE 0 END),0) as revenue
      FROM products WHERE active=1 AND brand IS NOT NULL AND brand != ''
      GROUP BY brand ORDER BY total DESC LIMIT 10`),
    agentSales: a(`SELECT sold_to as agent, COUNT(*) as count,
      COALESCE(SUM(actual_sell_rm),0) as revenue,
      COALESCE(SUM(net_profit),0) as profit
      FROM products WHERE active=1 AND status='sold' AND sold_to IS NOT NULL
      GROUP BY sold_to ORDER BY revenue DESC`),
    recentlySold: a(`SELECT id,category,brand,design,article,quality,color,
      actual_sell_rm,net_profit,sold_to,sold_date,updated_at
      FROM products WHERE active=1 AND status='sold'
      ORDER BY COALESCE(sold_date, updated_at) DESC LIMIT 8`),
    recentlyAdded: a(`SELECT id,category,brand,design,article,quality,color,qty,cost_piece_rm,status,created_at
      FROM products WHERE active=1 ORDER BY id DESC LIMIT 8`),
  });
});

// ═══════════════ SALES ANALYTICS ═════════════════════════════
app.get('/api/sales', auth, (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const monthly = db.prepare(`SELECT
    strftime('%m', COALESCE(sold_date, updated_at)) as month,
    COUNT(*) as count,
    COALESCE(SUM(actual_sell_rm),0) as revenue,
    COALESCE(SUM(net_profit),0) as profit,
    COALESCE(SUM(cost_piece_rm),0) as cost
    FROM products WHERE active=1 AND status='sold'
    AND strftime('%Y', COALESCE(sold_date, updated_at)) = ?
    GROUP BY month ORDER BY month`).all(year);

  const byAgent = db.prepare(`SELECT sold_to as agent,
    COUNT(*) as count,
    COALESCE(SUM(actual_sell_rm),0) as revenue,
    COALESCE(SUM(net_profit),0) as profit
    FROM products WHERE active=1 AND status='sold' AND sold_to IS NOT NULL
    AND strftime('%Y', COALESCE(sold_date, updated_at)) = ?
    GROUP BY sold_to ORDER BY revenue DESC`).all(year);

  const byCategory = db.prepare(`SELECT category,
    COUNT(*) as count,
    COALESCE(SUM(actual_sell_rm),0) as revenue,
    COALESCE(SUM(net_profit),0) as profit
    FROM products WHERE active=1 AND status='sold'
    AND strftime('%Y', COALESCE(sold_date, updated_at)) = ?
    GROUP BY category ORDER BY revenue DESC`).all(year);

  const byBrand = db.prepare(`SELECT brand,
    COUNT(*) as count,
    COALESCE(SUM(actual_sell_rm),0) as revenue
    FROM products WHERE active=1 AND status='sold' AND brand IS NOT NULL
    AND strftime('%Y', COALESCE(sold_date, updated_at)) = ?
    GROUP BY brand ORDER BY count DESC LIMIT 10`).all(year);

  const years = db.prepare(`SELECT DISTINCT strftime('%Y', COALESCE(sold_date, updated_at)) as yr
    FROM products WHERE active=1 AND status='sold'
    ORDER BY yr DESC`).all().map(r => r.yr).filter(Boolean);

  const totals = db.prepare(`SELECT COUNT(*) as total_units,
    COALESCE(SUM(actual_sell_rm),0) as total_revenue,
    COALESCE(SUM(net_profit),0) as total_profit,
    COALESCE(SUM(cost_piece_rm),0) as total_cost
    FROM products WHERE active=1 AND status='sold'
    AND strftime('%Y', COALESCE(sold_date, updated_at)) = ?`).get(year);

  res.json({ year, years, monthly, byAgent, byCategory, byBrand, totals });
});

// ═══════════════ EXCEL IMPORT ════════════════════════════════
app.post('/api/import/preview', auth, importUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  parseSpreadsheetRows(req.file.path, req.file.originalname)
    .then(({ columns, rows }) => {
      fs.unlinkSync(req.file.path);
      if (!rows.length) return res.status(400).json({ error: 'File appears empty' });
      res.json({ columns, preview: rows.slice(0, 8), total: rows.length, sheets: ['Sheet1'] });
    })
    .catch((e) => {
      try { fs.unlinkSync(req.file.path); } catch {}
      res.status(500).json({ error: 'Could not parse file: ' + e.message });
    });
});

app.post('/api/import/commit', auth, importUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  parseSpreadsheetRows(req.file.path, req.file.originalname)
    .then(({ rows }) => {
      let mapping;
      try {
        mapping = JSON.parse(req.body.mapping || '{}');
      } catch {
        throw new Error('Invalid mapping JSON');
      }
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
        throw new Error('Invalid mapping payload');
      }
      const defaultCategory = asString(req.body.category || 'SILK').toUpperCase();
      if (!defaultCategory) throw new Error('Category is required');

      const getVal = (row, field) => {
        const col = mapping[field];
        if (!col) return '';
        const v = row[col];
        return v !== undefined && v !== null ? String(v).trim() : '';
      };
      const getNum = (row, field) => parseFloat(getVal(row, field)) || 0;

      let imported = 0, skipped = 0;
      db.run('BEGIN');
      for (const row of rows) {
        const design  = getVal(row,'design');
        const article = getVal(row,'article');
        const brand   = getVal(row,'brand');
        if (!design && !article && !brand) { skipped++; continue; }
        try {
          const soldTo = getVal(row,'sold_to');
          const status = soldTo ? 'sold' : (getVal(row,'status') || 'available');
          if (!validateProductStatus(status)) { skipped++; continue; }
          db.run(`INSERT INTO products
            (category,brand,design,article,quality,color,qty,
             cost_eur,cost_rm,cost_piece_rm,vip_mt_rm,vip_piece_rm,
             sell_mt_rm,sell_piece_rm,status,sold_to,sold_date,notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              getVal(row,'category') || defaultCategory,
              brand, design, article,
              getVal(row,'quality'), getVal(row,'color') || null,
              getNum(row,'qty'),
              getNum(row,'cost_eur'), getNum(row,'cost_rm'), getNum(row,'cost_piece_rm'),
              getNum(row,'vip_mt_rm'), getNum(row,'vip_piece_rm'),
              getNum(row,'sell_mt_rm'), getNum(row,'sell_piece_rm'),
              status, soldTo || null,
              getVal(row,'sold_date') || null,
              getVal(row,'notes') || null
            ]
          );
          imported++;
        } catch { skipped++; }
      }
      db.run('COMMIT');
      db.save();
      fs.unlinkSync(req.file.path);
      res.json({ success: true, imported, skipped, total: rows.length });
    })
    .catch((e) => {
      try { db.run('ROLLBACK'); } catch {}
      try { fs.unlinkSync(req.file.path); } catch {}
      res.status(500).json({ error: e.message });
    });
});

// ═══════════════ RELOAD INVENTORY FROM JSON ══════════════════
app.post('/api/admin/reload-inventory', auth, adminOnly, (req, res) => {
  try {
    if (!fs.existsSync(INVENTORY_JSON_PATH)) return res.status(404).json({ error: 'inventory_data.json not found' });
    const items = JSON.parse(fs.readFileSync(INVENTORY_JSON_PATH, 'utf8'));
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'File empty or invalid' });

    db.run('BEGIN');
    db.run('DELETE FROM products');
    let imported = 0;
    for (const it of items) {
      db.run(`INSERT INTO products
        (category,brand,design,article,quality,qty,
         cost_eur,cost_rm,cost_piece_rm,vip_mt_rm,vip_piece_rm,
         sell_mt_rm,sell_piece_rm,actual_sell_rm,commission_pct,
         net_profit,status,sold_to,active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [
          it.category||'', it.brand||'', it.design||'', it.article||'',
          it.quality||'', it.qty||0,
          it.cost_eur||0, it.cost_rm||0, it.cost_piece_rm||0,
          it.vip_mt_rm||0, it.vip_piece_rm||0,
          it.sell_mt_rm||0, it.sell_piece_rm||0,
          it.actual_sell_rm||0, it.commission_pct||0,
          it.net_profit||0,
          it.status||'available', it.sold_to||null
        ]
      );
      imported++;
    }
    db.run('COMMIT');
    db.save();
    res.json({ success: true, imported, message: `${imported} items loaded from master sheet` });
  } catch(e) {
    try { db.run('ROLLBACK'); } catch {}
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════ CSV REPORT DOWNLOAD ═════════════════════════
app.get('/api/reports/csv', auth, (req, res) => {
  const { category, status, year } = req.query;
  let sql = 'SELECT * FROM products WHERE active=1';
  const p = [];
  if (category) { sql += ' AND category=?'; p.push(category); }
  if (status)   { sql += ' AND status=?';   p.push(status); }
  if (year)     { sql += " AND strftime('%Y', COALESCE(sold_date, created_at)) = ?"; p.push(year); }
  sql += ' ORDER BY category,brand,id';
  const items = db.prepare(sql).all(...p);
  const headers = ['ID','Category','Brand','Design','Article','Quality','Color','Qty',
    'Cost EUR','Cost RM','Cost/Piece RM','VIP/Mt RM','VIP/Piece RM','Sell/Mt RM','Sell/Piece RM',
    'Status','Sold To','Actual Sell RM','Commission %','Net Profit','Sold Date','Notes','Created'];
  const rows = items.map(i => [
    i.id, i.category, i.brand||'', i.design||'', i.article||'', i.quality||'', i.color||'', i.qty||0,
    i.cost_eur||0, i.cost_rm||0, i.cost_piece_rm||0,
    i.vip_mt_rm||0, i.vip_piece_rm||0, i.sell_mt_rm||0, i.sell_piece_rm||0,
    i.status||'', i.sold_to||'', i.actual_sell_rm||0, i.commission_pct||0, i.net_profit||0,
    i.sold_date||'', i.notes||'', i.created_at||''
  ]);
  const csv = [headers,...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const date = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition',`attachment; filename="visionag-report-${date}.csv"`);
  res.send(csv);
});

// ═══════════════ P&L STATEMENT ═══════════════════════════════
app.get('/api/pnl', auth, (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const a = (s,...p) => db.prepare(s).all(...p);
  const g = (s,...p) => db.prepare(s).get(...p);

  // Monthly P&L
  const monthly = a(`
    SELECT strftime('%m', COALESCE(sold_date, updated_at)) as month,
      COUNT(*) as units,
      COALESCE(SUM(actual_sell_rm),0) as revenue,
      COALESCE(SUM(cost_piece_rm),0) as cost,
      COALESCE(SUM(net_profit),0) as profit,
      COALESCE(SUM(commission_pct * actual_sell_rm / 100),0) as commission
    FROM products WHERE active=1 AND status='sold'
    AND strftime('%Y', COALESCE(sold_date, updated_at)) = ?
    GROUP BY month ORDER BY month`, year);

  // Yearly totals
  const totals = g(`
    SELECT COUNT(*) as units,
      COALESCE(SUM(actual_sell_rm),0) as revenue,
      COALESCE(SUM(cost_piece_rm),0) as cost,
      COALESCE(SUM(net_profit),0) as profit,
      COALESCE(SUM(commission_pct * actual_sell_rm / 100),0) as commission
    FROM products WHERE active=1 AND status='sold'
    AND strftime('%Y', COALESCE(sold_date, updated_at)) = ?`, year);

  // Stock value (unsold inventory)
  const stockVal = g(`SELECT
    COALESCE(SUM(cost_piece_rm),0) as cost_value,
    COALESCE(SUM(sell_piece_rm),0) as sell_value,
    COUNT(*) as units
    FROM products WHERE active=1 AND status='available'`);

  // Category breakdown for the year
  const byCat = a(`
    SELECT category,
      COUNT(*) as units,
      COALESCE(SUM(actual_sell_rm),0) as revenue,
      COALESCE(SUM(cost_piece_rm),0) as cost,
      COALESCE(SUM(net_profit),0) as profit
    FROM products WHERE active=1 AND status='sold'
    AND strftime('%Y', COALESCE(sold_date, updated_at)) = ?
    GROUP BY category ORDER BY revenue DESC`, year);

  // Available years
  const years = a(`SELECT DISTINCT strftime('%Y', COALESCE(sold_date, updated_at)) as yr
    FROM products WHERE active=1 AND status='sold' ORDER BY yr DESC`)
    .map(r=>r.yr).filter(Boolean);

  res.json({ year, years, monthly, totals, stockVal, byCat });
});

// ═══════════════ CLIENTS ═════════════════════════════════════
app.get('/api/clients', auth, (req, res) => {
  const { search } = req.query;
  if (search) {
    const s = `%${search}%`;
    return res.json(db.prepare('SELECT * FROM clients WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR company LIKE ? ORDER BY name').all(s,s,s,s));
  }
  res.json(db.prepare('SELECT * FROM clients ORDER BY name').all());
});

app.get('/api/clients/:id', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.invoices  = db.prepare('SELECT * FROM invoices WHERE client_id=? ORDER BY invoice_date DESC').all(req.params.id);
  c.purchases = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(actual_sell_rm),0) as total FROM products WHERE sold_to=? AND status='sold'").get(req.params.id);
  res.json(c);
});

app.post('/api/clients', auth, (req, res) => {
  const { name, phone, email, address, company, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = db.prepare('INSERT INTO clients (name,phone,email,address,company,notes) VALUES (?,?,?,?,?,?)').run(name,phone,email,address,company,notes);
  db.save(); res.json({ id: r.lastInsertRowid });
});

app.put('/api/clients/:id', auth, (req, res) => {
  const { name, phone, email, address, company, notes } = req.body;
  db.prepare('UPDATE clients SET name=?,phone=?,email=?,address=?,company=?,notes=? WHERE id=?').run(name,phone,email,address,company,notes,req.params.id);
  db.save(); res.json({ success: true });
});

app.delete('/api/clients/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM clients WHERE id=?').run(req.params.id);
  db.save(); res.json({ success: true });
});

// ═══════════════ INVOICES ════════════════════════════════════
app.get('/api/invoices/next-number', auth, (req, res) => {
  const y = new Date().getFullYear();
  const m = String(new Date().getMonth()+1).padStart(2,'0');
  const n = (db.prepare("SELECT COUNT(*) as c FROM invoices WHERE invoice_number LIKE ?").get(`INV-${y}${m}%`)?.c||0)+1;
  res.json({ invoice_number: `INV-${y}${m}-${String(n).padStart(4,'0')}` });
});

app.get('/api/invoices', auth, (req, res) => {
  const { search, status, client_id } = req.query;
  let sql = 'SELECT i.*,c.name as client_name,c.company as client_company FROM invoices i LEFT JOIN clients c ON i.client_id=c.id WHERE 1=1';
  const p = [];
  if (search)    { sql+=' AND (i.invoice_number LIKE ? OR c.name LIKE ?)'; const s=`%${search}%`; p.push(s,s); }
  if (status)    { sql+=' AND i.status=?'; p.push(status); }
  if (client_id) { sql+=' AND i.client_id=?'; p.push(client_id); }
  res.json(db.prepare(sql+' ORDER BY i.created_at DESC').all(...p));
});

app.get('/api/invoices/:id', auth, (req, res) => {
  const inv = db.prepare('SELECT i.*,c.name as client_name,c.phone as client_phone,c.email as client_email,c.address as client_address,c.company as client_company FROM invoices i LEFT JOIN clients c ON i.client_id=c.id WHERE i.id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(req.params.id);
  res.json(inv);
});

app.post('/api/invoices', auth, (req, res) => {
  const { invoice_number, client_id, invoice_date, currency, discount_pct, tax_pct, notes, status, items } = req.body;
  if (!asString(invoice_number)) return res.status(400).json({ error: 'Invoice number required' });
  if (!asString(invoice_date)) return res.status(400).json({ error: 'Invoice date required' });
  if (!validateInvoiceStatus(status || 'pending')) return res.status(400).json({ error: 'Invalid invoice status' });
  if (!items?.length) return res.status(400).json({ error: 'Add at least one item' });
  if (!items.every(i => asNumber(i.quantity) > 0 && asNumber(i.unit_price) >= 0)) {
    return res.status(400).json({ error: 'Invoice items must have valid quantity and unit price' });
  }
  const subtotal = items.reduce((s,i) => s + i.quantity*i.unit_price, 0);
  const dp=+discount_pct||0, tp=+tax_pct||0;
  const disc=subtotal*(dp/100), tax=(subtotal-disc)*(tp/100), total=subtotal-disc+tax;
  try {
    db.run('BEGIN');
    const r = db.prepare('INSERT INTO invoices (invoice_number,client_id,invoice_date,currency,subtotal,discount_pct,discount_amount,tax_pct,tax_amount,total,notes,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
                .run(invoice_number,client_id,invoice_date,currency||'MYR',subtotal,dp,disc,tp,tax,total,notes,status||'pending');
    const invId = r.lastInsertRowid;
    for (const it of items) {
      db.prepare('INSERT INTO invoice_items (invoice_id,product_id,product_name,design,article,quality,quantity,unit_price,subtotal) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(invId,it.product_id||null,it.product_name,it.design||'',it.article||'',it.quality||'',it.quantity,it.unit_price,it.quantity*it.unit_price);
    }
    db.run('COMMIT');
    db.save();
    res.json({ id: invId, invoice_number, total });
  } catch(e) { db.run('ROLLBACK'); res.status(500).json({ error: e.message }); }
});

app.put('/api/invoices/:id/status', auth, (req, res) => {
  if (!validateInvoiceStatus(req.body.status)) return res.status(400).json({ error: 'Invalid invoice status' });
  db.prepare('UPDATE invoices SET status=? WHERE id=?').run(req.body.status, req.params.id);
  db.save(); res.json({ success: true });
});

app.delete('/api/invoices/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM invoices WHERE id=?').run(req.params.id);
  db.save(); res.json({ success: true });
});

app.get('/api/health', (_, res) => {
  const ping = db.prepare('SELECT 1 as ok').get();
  res.json({
    status: ping?.ok === 1 ? 'ok' : 'degraded',
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ── SPA fallback ──────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  log('error', 'unhandled_error', {
    method: req.method,
    path: req.originalUrl,
    error: err?.message || 'Unknown error',
  });
  if (res.headersSent) return next(err);
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

// ── Start ─────────────────────────────────────────────────────
async function startServer(port = PORT) {
  console.log('\n  Starting VisionAG Inventory v2...');
  db = await initializeDatabase();
  return app.listen(port, () => {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║   VisionAG Inventory v2 — RUNNING    ║');
    console.log(`║   http://localhost:${port}                ║`);
    console.log('║   admin/admin123  |  staff/staff123  ║');
    console.log('╚══════════════════════════════════════╝\n');
  });
}

if (require.main === module) {
  startServer().catch((e) => {
    log('error', 'startup_failed', { error: e.message });
    process.exit(1);
  });
}

module.exports = { app, startServer };
