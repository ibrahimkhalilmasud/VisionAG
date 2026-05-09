/**
 * reload_inventory.js
 * Run this ONCE (with server STOPPED) to replace all products with master sheet data.
 * Usage:  node reload_inventory.js
 */
'use strict';
const path = require('path');
const fs   = require('fs');

async function main() {
  const { initializeDatabase } = require('./database');
  const db = await initializeDatabase();

  const dataFile = path.join(__dirname, 'data', 'inventory_data.json');
  if (!fs.existsSync(dataFile)) {
    console.error('❌  inventory_data.json not found');
    process.exit(1);
  }

  const items = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  console.log(`📂  Loaded ${items.length} items from inventory_data.json`);

  db.run('DELETE FROM products');
  console.log('🗑   Cleared existing products');

  db.run('BEGIN');
  let n = 0;
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
    n++;
  }
  db.run('COMMIT');
  db.save();

  // Summary
  const { all } = db;
  const rows = db.all(
    "SELECT category, status, COUNT(*) as c FROM products WHERE active=1 GROUP BY category, status ORDER BY category, status"
  );
  console.log(`\n✅  ${n} items imported\n`);
  console.log('  CATEGORY       STATUS       COUNT');
  console.log('  ' + '-'.repeat(38));
  for (const r of rows) {
    const lbl = r.status === 'available' ? 'AVAILABLE' : r.status.toUpperCase();
    console.log(`  ${r.category.padEnd(15)} ${lbl.padEnd(12)} ${r.c}`);
  }
  console.log('\n✅  Done. You can now restart the server (START.bat).');
  process.exit(0);
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
