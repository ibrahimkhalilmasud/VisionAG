// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
const S = {
  token:    localStorage.getItem('visionag_token'),
  user:     JSON.parse(localStorage.getItem('visionag_user')||'null'),
  page:     'dashboard',
  currency: 'MYR',
  eurRate:  4.90,
  inv: { category:'', brand:'', quality:'', status:'', color:'', search:'', page:1 },
  invTotal: 0,
  currentRenderFn:      null,
  currentCacheRenderFn: null,   // lightweight re-render from cached data
};

const AGENTS = { M:'VIP-M', S:'Sherry', A:'Angie', FK:'Fong King', B:'Bani', C:'Mr.Cetin', K:'Ms.Klara' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CAT_COLORS = { SILK:'#7c3aed', LACE:'#0ea5e9', CEMB:'#10b981', EMBROIDERY:'#f59e0b' };

// ══════════════════════════════════════════════════════════
// CHART INSTANCE MANAGEMENT
// ══════════════════════════════════════════════════════════
const _charts = {};
function destroyChart(id) {
  if (_charts[id]) { try { _charts[id].destroy(); } catch(e){} delete _charts[id]; }
  // Also kill any orphaned instance Chart.js left on the canvas
  const c = Chart.getChart ? Chart.getChart(id) : null;
  if (c) { try { c.destroy(); } catch(e){} }
}
function makeChart(id, config) {
  destroyChart(id);
  const el = document.getElementById(id);
  if (!el) return null;
  _charts[id] = new Chart(el, config);
  return _charts[id];
}

// ══════════════════════════════════════════════════════════
// CURRENCY — switches display without re-fetching API
// ══════════════════════════════════════════════════════════
function setCurrency(c) {
  S.currency = c;
  S.eurRate = parseFloat(document.getElementById('eur-rate').value) || 4.90;
  document.getElementById('btn-myr').classList.toggle('active', c==='MYR');
  document.getElementById('btn-eur').classList.toggle('active', c==='EUR');
  rerenderPage();
}
function rerenderPage() {
  S.eurRate = parseFloat(document.getElementById('eur-rate').value) || 4.90;
  // Use cached render fn if available (no API call) — else full render
  if (S.currentCacheRenderFn) S.currentCacheRenderFn();
  else if (S.currentRenderFn) S.currentRenderFn();
}

function fmt(n, forceEur=false) {
  const v = +n || 0;
  if (S.currency === 'EUR' || forceEur) {
    const e = v / S.eurRate;
    return '€' + e.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
  }
  return 'RM ' + v.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fmtN(n) { return (+n||0).toLocaleString(); }
function agentName(k) { return AGENTS[k] || k || '—'; }

// ══════════════════════════════════════════════════════════
// API
// ══════════════════════════════════════════════════════════
async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type':'application/json', Authorization:'Bearer '+S.token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { logout(); return; }
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error||'Request failed'); }
  return r.json();
}

function toast(msg, ok=true) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = ok ? '#1a1a2e' : '#dc2626';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

// ══════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════
function logout() {
  localStorage.removeItem('visionag_token');
  localStorage.removeItem('visionag_user');
  window.location.href = '/login.html';
}

function checkAuth() {
  if (!S.token || !S.user) { window.location.href = '/login.html'; return false; }
  document.getElementById('user-badge').textContent = S.user.full_name || S.user.username;
  if (S.user.role === 'admin') document.getElementById('nav-users').style.display = 'flex';
  return true;
}

function bindStaticEventHandlers() {
  document.querySelectorAll('[data-nav-page]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.navPage, el.dataset.navCategory || ''));
  });

  document.querySelectorAll('[data-currency]').forEach(el => {
    el.addEventListener('click', () => setCurrency(el.dataset.currency));
  });

  document.getElementById('eur-rate')?.addEventListener('change', rerenderPage);
  document.getElementById('btn-logout')?.addEventListener('click', logout);
  document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
}

// ══════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════
function navigate(page, category='') {
  S.page = page;
  if (category) { S.inv.category = category; S.inv.page = 1; }

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const key = category ? `inv-${category}` : page;
  const target = document.querySelector(`[data-page="${key}"]`);
  if (target) target.classList.add('active');

  const titles = {
    dashboard:'Dashboard', sales:'Sales Analytics', inventory:'Inventory',
    clients:'Clients', invoices:'Invoices', import:'Import Excel',
    reports:'Reports', pnl:'Profit & Loss Statement', users:'User Management'
  };
  document.getElementById('page-title').textContent = titles[page] || page;

  const renders = {
    dashboard: renderDashboard,
    sales:     renderSales,
    inventory: renderInventory,
    clients:   renderClients,
    invoices:  renderInvoices,
    import:    renderImport,
    reports:   renderReports,
    pnl:       renderPnl,
    users:     renderUsers,
  };
  const cacheRenders = {
    dashboard: () => _dashData  ? _renderDash()  : renderDashboard(),
    sales:     () => _salesData ? _renderSales() : renderSales(),
  };
  S.currentRenderFn      = renders[page] || null;
  S.currentCacheRenderFn = cacheRenders[page] || null;
  renders[page]?.();
}

// ══════════════════════════════════════════════════════════
// MODAL
// ══════════════════════════════════════════════════════════
function openModal() { document.getElementById('modal').classList.add('open'); }
function closeModal() { document.getElementById('modal').classList.remove('open'); }
document.getElementById('modal').addEventListener('click', e => { if(e.target.id==='modal') closeModal(); });

// ══════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════
let _dashData = null;
async function renderDashboard() {
  document.getElementById('content').innerHTML = '<div class="empty"><div class="empty-icon">⏳</div>Loading dashboard...</div>';
  _dashData = await api('GET','/dashboard');
  _renderDash();
}

function _renderDash() {
  const d = _dashData; if (!d) return;
  const ov = d.overview;
  const byCat = d.byCategory;

  // Build monthly chart data (fill all 12 months)
  const monthlyRevArr = Array(12).fill(0);
  const monthlyProfArr = Array(12).fill(0);
  (d.monthlySales||[]).forEach(m => {
    const i = parseInt(m.month)-1;
    if (i>=0&&i<12) { monthlyRevArr[i]=m.revenue; monthlyProfArr[i]=m.profit; }
  });

  document.getElementById('content').innerHTML = `
  <div class="kpi-grid">
    <div class="kpi k-total"><div class="kpi-label">Total Items</div><div class="kpi-value">${fmtN(ov.total)}</div><div class="kpi-sub">All categories</div></div>
    <div class="kpi k-avail"><div class="kpi-label">Available</div><div class="kpi-value">${fmtN(ov.available)}</div><div class="kpi-sub">${fmt(ov.available_cost_rm)} cost</div></div>
    <div class="kpi k-sold"><div class="kpi-label">Sold</div><div class="kpi-value">${fmtN(ov.sold)}</div><div class="kpi-sub">${fmt(ov.sold_revenue)} revenue</div></div>
    <div class="kpi k-pend"><div class="kpi-label">Pending</div><div class="kpi-value">${fmtN(ov.pending)}</div><div class="kpi-sub">Awaiting</div></div>
    <div class="kpi k-val"><div class="kpi-label">Stock Value (Cost)</div><div class="kpi-value" style="font-size:17px">${fmt(ov.available_cost_rm)}</div><div class="kpi-sub">Available items</div></div>
    <div class="kpi k-rev"><div class="kpi-label">Stock Value (Sell)</div><div class="kpi-value" style="font-size:17px">${fmt(ov.available_sell_rm)}</div><div class="kpi-sub">Potential revenue</div></div>
    <div class="kpi k-profit"><div class="kpi-label">Net Profit</div><div class="kpi-value" style="font-size:17px;color:#10b981">${fmt(ov.net_profit)}</div><div class="kpi-sub">From sold items</div></div>
  </div>

  <div class="chart-grid three">
    <div class="chart-box">
      <h4>Monthly Sales Revenue — ${new Date().getFullYear()}</h4>
      <canvas id="monthChart" height="180"></canvas>
    </div>
    <div class="chart-box">
      <h4>Stock by Category</h4>
      <canvas id="catChart" height="180"></canvas>
    </div>
  </div>

  <div class="two-col">
    <div class="panel" style="margin:0">
      <div class="panel-header"><h3>Category Breakdown</h3></div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Category</th><th>Total</th><th>Avail</th><th>Sold</th><th>Pending</th><th>Cost Value</th></tr></thead>
          <tbody>
            ${byCat.map(c=>`<tr>
              <td><span class="badge ${c.category.toLowerCase()}">${c.category}</span></td>
              <td><strong>${fmtN(c.total)}</strong></td>
              <td style="color:#16a34a">${fmtN(c.available)}</td>
              <td style="color:#dc2626">${fmtN(c.sold)}</td>
              <td style="color:#b45309">${fmtN(c.pending)}</td>
              <td>${fmt(c.available_cost_rm)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel" style="margin:0">
      <div class="panel-header"><h3>Agent Sales Performance</h3></div>
      <div class="panel-body">
        ${d.agentSales.length ? (() => {
          const maxRev = Math.max(...d.agentSales.map(a=>a.revenue),1);
          return d.agentSales.map(a=>`
            <div class="agent-bar">
              <div class="agent-bar-label">${agentName(a.agent)}</div>
              <div class="agent-bar-track"><div class="agent-bar-fill" style="width:${(a.revenue/maxRev*100).toFixed(1)}%"></div></div>
              <div class="agent-bar-val">${fmtN(a.count)} pcs</div>
            </div>`).join('');
        })() : '<div class="empty" style="padding:20px">No sales data yet</div>'}
      </div>
    </div>
  </div>

  <div class="two-col" style="margin-top:14px">
    <div class="panel" style="margin:0">
      <div class="panel-header"><h3>Recently Added</h3><button class="btn btn-ghost btn-sm" onclick="navigate('inventory')">View All</button></div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Category</th><th>Brand</th><th>Design</th><th>Status</th></tr></thead>
          <tbody>
            ${d.recentlyAdded.map(p=>`<tr>
              <td><span class="badge ${p.category.toLowerCase()}">${p.category}</span></td>
              <td>${p.brand||'—'}</td>
              <td><code>${p.design||p.article||'—'}</code></td>
              <td><span class="badge ${p.status}">${p.status}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel" style="margin:0">
      <div class="panel-header"><h3>Recently Sold</h3><button class="btn btn-ghost btn-sm" onclick="navigate('sales')">Analytics</button></div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Brand</th><th>Design</th><th>Agent</th><th>Revenue</th></tr></thead>
          <tbody>
            ${d.recentlySold.length ? d.recentlySold.map(p=>`<tr>
              <td>${p.brand||'—'}</td>
              <td><code>${p.design||p.article||'—'}</code></td>
              <td><span class="tag">${p.sold_to||'—'}</span></td>
              <td style="color:#16a34a;font-weight:600">${fmt(p.actual_sell_rm)}</td>
            </tr>`).join('') : '<tr><td colspan="4" class="empty" style="padding:20px;text-align:center">No sales recorded</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;

  // Monthly chart
  makeChart('monthChart', {
    type:'bar',
    data:{
      labels: MONTHS,
      datasets:[
        { label:'Revenue', data: monthlyRevArr, backgroundColor:'rgba(14,165,233,.75)', borderRadius:4 },
        { label:'Profit',  data: monthlyProfArr, backgroundColor:'rgba(16,185,129,.65)', borderRadius:4 }
      ]
    },
    options:{
      responsive:true,
      plugins:{ legend:{position:'top',labels:{font:{size:11},boxWidth:10}} },
      scales:{
        y:{ ticks:{ callback:v=>(S.currency==='EUR'?'€':'RM')+(v/1000).toFixed(0)+'k', font:{size:10} }, grid:{color:'#f0f2f5'} },
        x:{ ticks:{ font:{size:10} }, grid:{display:false} }
      }
    }
  });

  // Category donut
  const catAvail = byCat.map(c=>c.available);
  makeChart('catChart', {
    type:'doughnut',
    data:{
      labels: byCat.map(c=>c.category),
      datasets:[{ data:catAvail, backgroundColor:byCat.map(c=>CAT_COLORS[c.category]||'#999'), borderWidth:2, borderColor:'#fff' }]
    },
    options:{ plugins:{ legend:{position:'bottom',labels:{font:{size:11},boxWidth:10}} }, cutout:'62%' }
  });
}

// ══════════════════════════════════════════════════════════
// SALES ANALYTICS
// ══════════════════════════════════════════════════════════
let _salesYear = String(new Date().getFullYear());
let _salesData = null;

async function renderSales() {
  document.getElementById('content').innerHTML = '<div class="empty"><div class="empty-icon">⏳</div>Loading sales data...</div>';
  _salesData = await api('GET',`/sales?year=${_salesYear}`);
  _renderSales();
}

function _renderSales() {
  const d = _salesData; if (!d) return;
  const t = d.totals || {};
  const years = d.years.length ? d.years : [String(new Date().getFullYear())];

  const monthlyRevArr = Array(12).fill(0);
  const monthlyProfArr = Array(12).fill(0);
  (d.monthly||[]).forEach(m => {
    const i = parseInt(m.month)-1;
    if (i>=0&&i<12) { monthlyRevArr[i]=m.revenue; monthlyProfArr[i]=m.profit; }
  });

  const maxAgentRev = Math.max(...(d.byAgent||[]).map(a=>a.revenue),1);

  document.getElementById('content').innerHTML = `
  <div class="year-tabs">
    ${years.map(y=>`<button class="year-tab ${y===d.year?'active':''}" onclick="switchSalesYear('${y}')">${y}</button>`).join('')}
    <button class="year-tab" onclick="switchSalesYear('${new Date().getFullYear()}')" style="${years.includes(String(new Date().getFullYear()))?'display:none':''}">
      ${new Date().getFullYear()}
    </button>
  </div>

  <div class="kpi-grid">
    <div class="kpi k-sold"><div class="kpi-label">Units Sold</div><div class="kpi-value">${fmtN(t.total_units)}</div><div class="kpi-sub">${d.year}</div></div>
    <div class="kpi k-rev"><div class="kpi-label">Total Revenue</div><div class="kpi-value" style="font-size:17px">${fmt(t.total_revenue)}</div><div class="kpi-sub">Actual sell price</div></div>
    <div class="kpi k-profit"><div class="kpi-label">Net Profit</div><div class="kpi-value" style="font-size:17px;color:#10b981">${fmt(t.total_profit)}</div><div class="kpi-sub">After commission</div></div>
    <div class="kpi k-val"><div class="kpi-label">Total Cost</div><div class="kpi-value" style="font-size:17px">${fmt(t.total_cost)}</div><div class="kpi-sub">Cost price</div></div>
    <div class="kpi" style="border-left-color:#f59e0b"><div class="kpi-label">Best Agent</div>
      <div class="kpi-value" style="font-size:16px">${d.byAgent[0]?agentName(d.byAgent[0].agent):'—'}</div>
      <div class="kpi-sub">${d.byAgent[0]?fmt(d.byAgent[0].revenue)+' revenue':'No data'}</div>
    </div>
    <div class="kpi" style="border-left-color:#7c3aed"><div class="kpi-label">Top Category</div>
      <div class="kpi-value" style="font-size:16px">${d.byCategory[0]?.category||'—'}</div>
      <div class="kpi-sub">${d.byCategory[0]?fmtN(d.byCategory[0].count)+' units':'No data'}</div>
    </div>
  </div>

  <div class="chart-grid">
    <div class="chart-box">
      <h4>Monthly Revenue & Profit — ${d.year}</h4>
      <canvas id="salesMonthChart" height="200"></canvas>
    </div>
    <div class="chart-box">
      <h4>Sales by Category — ${d.year}</h4>
      <canvas id="salesCatChart" height="200"></canvas>
    </div>
  </div>

  <div class="two-col">
    <div class="panel" style="margin:0">
      <div class="panel-header"><h3>Agent Performance — ${d.year}</h3></div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Agent</th><th>Units</th><th>Revenue</th><th>Profit</th><th>Bar</th></tr></thead>
          <tbody>
            ${d.byAgent.length ? d.byAgent.map(a=>`<tr>
              <td><strong>${agentName(a.agent)}</strong> <span class="tag">${a.agent}</span></td>
              <td>${fmtN(a.count)}</td>
              <td style="color:#0ea5e9;font-weight:600">${fmt(a.revenue)}</td>
              <td style="color:#10b981">${fmt(a.profit)}</td>
              <td style="min-width:80px"><div style="height:6px;background:#f0f2f5;border-radius:3px"><div style="width:${(a.revenue/maxAgentRev*100).toFixed(0)}%;height:6px;background:#0ea5e9;border-radius:3px"></div></div></td>
            </tr>`).join('') : '<tr><td colspan="5" class="empty" style="padding:20px;text-align:center">No agent sales this year</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel" style="margin:0">
      <div class="panel-header"><h3>Monthly Breakdown — ${d.year}</h3></div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Month</th><th>Units</th><th>Revenue</th><th>Profit</th></tr></thead>
          <tbody>
            ${d.monthly.length ? d.monthly.map(m=>`<tr>
              <td><strong>${MONTHS[parseInt(m.month)-1]||m.month}</strong></td>
              <td>${fmtN(m.count)}</td>
              <td style="color:#0ea5e9">${fmt(m.revenue)}</td>
              <td style="color:#10b981">${fmt(m.profit)}</td>
            </tr>`).join('') : '<tr><td colspan="4" class="empty" style="padding:20px;text-align:center">No sales this year</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;

  makeChart('salesMonthChart', {
    type:'bar',
    data:{
      labels: MONTHS,
      datasets:[
        { label:'Revenue', data:monthlyRevArr, backgroundColor:'rgba(14,165,233,.75)', borderRadius:4 },
        { label:'Profit',  data:monthlyProfArr, backgroundColor:'rgba(16,185,129,.65)', borderRadius:4 }
      ]
    },
    options:{ responsive:true,
      plugins:{ legend:{position:'top',labels:{font:{size:11},boxWidth:10}} },
      scales:{
        y:{ ticks:{ callback:v=>(S.currency==='EUR'?'€':'RM')+(v/1000).toFixed(0)+'k', font:{size:10} }, grid:{color:'#f0f2f5'} },
        x:{ ticks:{ font:{size:10} }, grid:{display:false} }
      }
    }
  });

  if (d.byCategory.length) {
    makeChart('salesCatChart', {
      type:'doughnut',
      data:{
        labels: d.byCategory.map(c=>c.category),
        datasets:[{ data:d.byCategory.map(c=>c.count), backgroundColor:d.byCategory.map(c=>CAT_COLORS[c.category]||'#999'), borderWidth:2, borderColor:'#fff' }]
      },
      options:{ plugins:{ legend:{position:'bottom',labels:{font:{size:11},boxWidth:10}} }, cutout:'60%' }
    });
  }
}

async function switchSalesYear(y) {
  _salesYear = y;
  _salesData = await api('GET',`/sales?year=${y}`);
  _renderSales();
}

// ══════════════════════════════════════════════════════════
// INVENTORY
// ══════════════════════════════════════════════════════════
async function renderInventory() {
  const { category, brand, quality, status, color, search, page } = S.inv;

  const [brandsData, qualData] = await Promise.all([
    api('GET', `/brands${category?'?category='+category:''}`),
    api('GET', `/qualities${category?'?category='+category:''}${brand?'&brand='+encodeURIComponent(brand):''}`),
  ]);

  const params = new URLSearchParams({ page, limit:50 });
  if (category) params.set('category',category);
  if (brand)    params.set('brand',brand);
  if (quality)  params.set('quality',quality);
  if (status)   params.set('status',status);
  if (color)    params.set('color',color);
  if (search)   params.set('search',search);
  const data = await api('GET',`/products?${params}`);
  S.invTotal = data.total;

  const brands   = brandsData.map(b=>b.brand);
  const qualities = qualData.map(q=>q.quality);
  const totalPages = Math.ceil(S.invTotal / 50);

  const rows = data.items.map(p=>`
    <tr>
      <td>${p.photo_path?`<img src="${p.photo_path}" class="photo-thumb">`:`<div class="photo-ph">📷</div>`}</td>
      <td><span class="badge ${p.category.toLowerCase()}">${p.category}</span></td>
      <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.brand||'—'}</td>
      <td><code>${p.design||'—'}</code></td>
      <td><code style="color:#0369a1">${p.article||'—'}</code></td>
      <td>${p.quality||'—'}</td>
      <td>${p.color||'—'}</td>
      <td style="text-align:right">${(+p.qty||0).toFixed(1)}m</td>
      <td style="text-align:right">${fmt(p.cost_piece_rm)}</td>
      <td style="text-align:right">${fmt(p.sell_piece_rm)}</td>
      <td><span class="badge ${p.status}">${p.status}</span>${p.sold_to?` <span class="tag">${p.sold_to}</span>`:''}</td>
      <td>
        <button class="btn-icon" onclick="editProduct(${p.id})" title="Edit">✏️</button>
        <button class="btn-icon" onclick="quickStatus(${p.id},'${p.status}')" title="Change Status">🔄</button>
        ${S.user.role==='admin'?`<button class="btn-icon" onclick="deleteProduct(${p.id})" title="Delete">🗑️</button>`:''}
      </td>
    </tr>`).join('');

  const cats = ['','SILK','LACE','CEMB','EMBROIDERY'];
  document.getElementById('content').innerHTML = `
  <div class="cat-tabs">
    ${cats.map(c=>`<button class="cat-tab ${S.inv.category===c?'active':''}" onclick="setCat('${c}')">${c||'All'}</button>`).join('')}
  </div>

  <div class="panel" style="margin-bottom:12px">
    <div class="panel-body" style="padding:10px 14px">
      <div class="toolbar">
        <input type="text" placeholder="Search design, article, brand, quality..." value="${search}" oninput="debSearch(this.value)" id="inv-search"/>
        <select onchange="setFilter('brand',this.value)">
          <option value="">All Brands</option>
          ${brands.map(b=>`<option value="${b}" ${brand===b?'selected':''}>${b}</option>`).join('')}
        </select>
        <select onchange="setFilter('quality',this.value)">
          <option value="">All Qualities</option>
          ${qualities.map(q=>`<option value="${q}" ${quality===q?'selected':''}>${q}</option>`).join('')}
        </select>
        <select onchange="setFilter('status',this.value)">
          <option value="">All Status</option>
          <option value="available" ${status==='available'?'selected':''}>Available</option>
          <option value="sold" ${status==='sold'?'selected':''}>Sold</option>
          <option value="pending" ${status==='pending'?'selected':''}>Pending</option>
        </select>
        <button class="btn btn-ghost btn-sm" onclick="clearInvFilters()">Clear</button>
        <button class="btn btn-primary btn-sm" onclick="openAddProduct()" style="margin-left:auto">+ Add Item</button>
      </div>
      <div class="stat-row">
        <div class="stat-pill">Showing: <strong>${fmtN(data.items.length)}</strong> of <strong>${fmtN(S.invTotal)}</strong></div>
        <div class="stat-pill" style="color:#16a34a">Available: <strong>${fmtN(data.items.filter(p=>p.status==='available').length)}</strong></div>
        <div class="stat-pill" style="color:#dc2626">Sold: <strong>${fmtN(data.items.filter(p=>p.status==='sold').length)}</strong></div>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Photo</th><th>Cat</th><th>Brand</th><th>Design</th><th>Article</th>
          <th>Quality</th><th>Color</th><th>Qty</th><th>Cost RM</th><th>Sell RM</th>
          <th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="12" class="empty" style="padding:40px;text-align:center"><div class="empty-icon">📦</div>No items found</td></tr>'}</tbody>
      </table>
    </div>
    <div class="pagination">
      <button class="page-btn" onclick="invPage(${page-1})" ${page<=1?'disabled':''}>← Prev</button>
      <span style="font-size:11.5px;color:#888">Page ${page} of ${Math.max(totalPages,1)}</span>
      <button class="page-btn" onclick="invPage(${page+1})" ${page>=totalPages?'disabled':''}>Next →</button>
    </div>
  </div>`;
}

let _debTimer;
function debSearch(v){ clearTimeout(_debTimer); _debTimer=setTimeout(()=>{ S.inv.search=v; S.inv.page=1; renderInventory(); },350); }
function setCat(c){ S.inv.category=c; S.inv.brand=''; S.inv.quality=''; S.inv.page=1;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));
  const key = c ? `inv-${c}` : 'inventory';
  document.querySelector(`[data-page="${key}"]`)?.classList.add('active');
  renderInventory();
}
function setFilter(k,v){ S.inv[k]=v; S.inv.page=1; renderInventory(); }
function clearInvFilters(){ S.inv={category:S.inv.category,brand:'',quality:'',status:'',color:'',search:'',page:1}; renderInventory(); }
function invPage(p){ S.inv.page=p; renderInventory(); }

// ── PRODUCT FORM ──────────────────────────────────────────
const CATEGORIES = ['SILK','LACE','CEMB','EMBROIDERY'];

function productForm(p={}) {
  return `
  <div class="form-grid">
    <div class="form-group"><label>Category *</label>
      <select id="f-category">
        ${CATEGORIES.map(c=>`<option value="${c}" ${p.category===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Brand</label>
      <input type="text" id="f-brand" value="${p.brand||''}" placeholder="e.g. M&M 1-70, ARGO">
    </div>
    <div class="form-group"><label>Design No.</label>
      <input type="text" id="f-design" value="${p.design||''}" placeholder="e.g. VSS-1A">
    </div>
    <div class="form-group"><label>Article No.</label>
      <input type="text" id="f-article" value="${p.article||''}" placeholder="e.g. ALB-103A">
    </div>
    <div class="form-group"><label>Quality</label>
      <input type="text" id="f-quality" value="${p.quality||''}" placeholder="e.g. CDC, GEORGETTE">
    </div>
    <div class="form-group"><label>Color</label>
      <input type="text" id="f-color" value="${p.color||''}" placeholder="e.g. Red, Blue, Navy">
    </div>
    <div class="form-group"><label>Qty (meters)</label>
      <input type="number" id="f-qty" value="${p.qty||''}" step="0.1" placeholder="0.0">
    </div>
    <div class="form-group"><label>Status</label>
      <select id="f-status" onchange="toggleSoldFields()">
        <option value="available" ${(!p.status||p.status==='available')?'selected':''}>Available</option>
        <option value="sold" ${p.status==='sold'?'selected':''}>Sold</option>
        <option value="pending" ${p.status==='pending'?'selected':''}>Pending</option>
      </select>
    </div>

    <div class="section-divider">Pricing</div>
    <div class="form-group"><label>Cost / meter (EUR)</label>
      <input type="number" id="f-cost_eur" value="${p.cost_eur||''}" step="0.01">
    </div>
    <div class="form-group"><label>Cost / meter (RM)</label>
      <input type="number" id="f-cost_rm" value="${p.cost_rm||''}" step="0.01">
    </div>
    <div class="form-group"><label>Cost / piece (RM)</label>
      <input type="number" id="f-cost_piece_rm" value="${p.cost_piece_rm||''}" step="0.01">
    </div>
    <div class="form-group"><label>VIP / piece (RM)</label>
      <input type="number" id="f-vip_piece_rm" value="${p.vip_piece_rm||''}" step="0.01">
    </div>
    <div class="form-group"><label>Sell / meter (RM)</label>
      <input type="number" id="f-sell_mt_rm" value="${p.sell_mt_rm||''}" step="0.01">
    </div>
    <div class="form-group"><label>Sell / piece (RM)</label>
      <input type="number" id="f-sell_piece_rm" value="${p.sell_piece_rm||''}" step="0.01">
    </div>

    <div id="sold-fields" style="${(p.status==='sold'||p.status==='pending')?'':'display:none;'}grid-column:1/-1">
      <div class="section-divider">Sale Details</div>
      <div class="form-grid">
        <div class="form-group"><label>Agent / Sold To</label>
          <select id="f-sold_to">
            <option value="">— Select Agent —</option>
            ${Object.entries(AGENTS).map(([k,v])=>`<option value="${k}" ${p.sold_to===k?'selected':''}>${v} (${k})</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Sale Date</label>
          <input type="date" id="f-sold_date" value="${p.sold_date||''}">
        </div>
        <div class="form-group"><label>Actual Sell Price (RM)</label>
          <input type="number" id="f-actual_sell_rm" value="${p.actual_sell_rm||''}" step="0.01">
        </div>
        <div class="form-group"><label>Commission %</label>
          <input type="number" id="f-commission_pct" value="${p.commission_pct||''}" step="0.1">
        </div>
        <div class="form-group"><label>Net Profit (RM)</label>
          <input type="number" id="f-net_profit" value="${p.net_profit||''}" step="0.01">
        </div>
      </div>
    </div>

    <div class="form-group full"><label>Notes</label>
      <textarea id="f-notes">${p.notes||''}</textarea>
    </div>
  </div>`;
}

function toggleSoldFields() {
  const s = document.getElementById('f-status').value;
  document.getElementById('sold-fields').style.display = (s==='sold'||s==='pending') ? '' : 'none';
}

function getProductFormData() {
  return {
    category:       document.getElementById('f-category').value,
    brand:          document.getElementById('f-brand').value.trim(),
    design:         document.getElementById('f-design').value.trim(),
    article:        document.getElementById('f-article').value.trim(),
    quality:        document.getElementById('f-quality').value.trim(),
    color:          document.getElementById('f-color').value.trim(),
    qty:            document.getElementById('f-qty').value,
    cost_eur:       document.getElementById('f-cost_eur').value,
    cost_rm:        document.getElementById('f-cost_rm').value,
    cost_piece_rm:  document.getElementById('f-cost_piece_rm').value,
    vip_piece_rm:   document.getElementById('f-vip_piece_rm').value,
    sell_mt_rm:     document.getElementById('f-sell_mt_rm').value,
    sell_piece_rm:  document.getElementById('f-sell_piece_rm').value,
    status:         document.getElementById('f-status').value,
    sold_to:        document.getElementById('f-sold_to')?.value || null,
    sold_date:      document.getElementById('f-sold_date')?.value || null,
    actual_sell_rm: document.getElementById('f-actual_sell_rm')?.value || 0,
    commission_pct: document.getElementById('f-commission_pct')?.value || 0,
    net_profit:     document.getElementById('f-net_profit')?.value || 0,
    notes:          document.getElementById('f-notes').value.trim(),
  };
}

function openAddProduct() {
  document.getElementById('modal-title').textContent = 'Add New Item';
  document.getElementById('modal-body').innerHTML = productForm({ category: S.inv.category || 'SILK' });
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveProduct()">Add Item</button>`;
  openModal();
}

async function editProduct(id) {
  const p = await api('GET',`/products/${id}`);
  document.getElementById('modal-title').textContent = 'Edit Item #' + id;
  document.getElementById('modal-body').innerHTML = productForm(p) + `
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid #f0f2f5">
      <div class="form-group"><label>Photo</label>
        <div style="display:flex;align-items:center;gap:12px;margin-top:6px">
          ${p.photo_path?`<img src="${p.photo_path}" style="width:72px;height:72px;border-radius:8px;object-fit:cover;border:1px solid #e0e0e0">`:`<div style="width:72px;height:72px;border-radius:8px;background:#f0f2f5;display:flex;align-items:center;justify-content:center;font-size:24px">📷</div>`}
          <div>
            <input type="file" id="photo-input" accept="image/*" style="display:none" onchange="uploadPhoto(${id}, this)">
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('photo-input').click()">Upload Photo</button>
          </div>
        </div>
      </div>
    </div>`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveProduct(${id})">Save Changes</button>`;
  openModal();
}

async function saveProduct(id) {
  const d = getProductFormData();
  if (!d.category) return toast('Category is required', false);
  try {
    if (id) await api('PUT',`/products/${id}`, d);
    else    await api('POST','/products', d);
    toast(id ? 'Item updated ✓' : 'Item added ✓');
    closeModal(); renderInventory();
  } catch(e) { toast(e.message, false); }
}

async function uploadPhoto(id, input) {
  const file = input.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('photo', file);
  try {
    const r = await fetch(`/api/products/${id}/photo`, { method:'POST', headers:{Authorization:'Bearer '+S.token}, body:fd });
    if (r.ok) { toast('Photo uploaded ✓'); closeModal(); renderInventory(); }
    else toast('Upload failed', false);
  } catch { toast('Upload failed', false); }
}

async function deleteProduct(id) {
  if (!confirm('Delete this item? Cannot be undone.')) return;
  try { await api('DELETE',`/products/${id}`); toast('Deleted'); renderInventory(); }
  catch(e) { toast(e.message, false); }
}

function quickStatus(id, currentStatus) {
  document.getElementById('modal-title').textContent = 'Quick Status Change';
  document.getElementById('modal-body').innerHTML = `
    <p style="font-size:13px;color:#666;margin-bottom:14px">Item #${id} — current status: <span class="badge ${currentStatus}">${currentStatus}</span></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn btn-success" onclick="applyQuickStatus(${id},'available')">✓ Available</button>
      <button class="btn btn-warning" onclick="applyQuickStatus(${id},'pending')">⏳ Pending</button>
      <button class="btn btn-danger" onclick="showSoldForm(${id})">💰 Mark Sold</button>
    </div>
    <div id="qs-sold-form" style="display:none">
      <div class="form-grid">
        <div class="form-group"><label>Agent / Sold To</label>
          <select id="qs-agent">
            <option value="">— Select —</option>
            ${Object.entries(AGENTS).map(([k,v])=>`<option value="${k}">${v} (${k})</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Sale Date</label>
          <input type="date" id="qs-date" value="${new Date().toISOString().split('T')[0]}">
        </div>
        <div class="form-group"><label>Actual Sell (RM)</label>
          <input type="number" id="qs-sell" step="0.01" placeholder="0.00">
        </div>
        <div class="form-group"><label>Commission %</label>
          <input type="number" id="qs-comm" step="0.1" placeholder="20">
        </div>
        <div class="form-group"><label>Net Profit (RM)</label>
          <input type="number" id="qs-profit" step="0.01" placeholder="0.00">
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-danger" onclick="confirmSold(${id})">Confirm Sale</button>
        <button class="btn btn-ghost" onclick="document.getElementById('qs-sold-form').style.display='none'">Cancel</button>
      </div>
    </div>`;
  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost" onclick="closeModal()">Close</button>`;
  openModal();
}

function showSoldForm(id) {
  document.getElementById('qs-sold-form').style.display = '';
}

async function applyQuickStatus(id, status) {
  try {
    await api('PATCH',`/products/${id}/status`, { status });
    toast(`Status → ${status}`); closeModal(); renderInventory();
  } catch(e) { toast(e.message, false); }
}

async function confirmSold(id) {
  const body = {
    status: 'sold',
    sold_to:        document.getElementById('qs-agent').value || null,
    sold_date:      document.getElementById('qs-date').value || null,
    actual_sell_rm: document.getElementById('qs-sell').value || 0,
    commission_pct: document.getElementById('qs-comm').value || 0,
    net_profit:     document.getElementById('qs-profit').value || 0,
  };
  try {
    await api('PATCH',`/products/${id}/status`, body);
    toast('Sale recorded ✓'); closeModal(); renderInventory();
  } catch(e) { toast(e.message, false); }
}

// ══════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════
async function renderClients() {
  const clients = await api('GET','/clients');
  document.getElementById('content').innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <h3>Clients <span style="font-size:12px;color:#888;font-weight:400">(${clients.length})</span></h3>
      <button class="btn btn-primary btn-sm" onclick="openAddClient()">+ Add Client</button>
    </div>
    ${clients.length === 0 ? `
      <div class="empty"><div class="empty-icon">👥</div>No clients yet. Add your first client above.</div>
    ` : `
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>#</th><th>Name</th><th>Company</th><th>Phone</th><th>Email</th><th>Address</th><th>Actions</th></tr></thead>
        <tbody>
          ${clients.map((c,i)=>`<tr>
            <td style="color:#888;font-size:11px">${i+1}</td>
            <td><strong>${c.name}</strong></td>
            <td>${c.company||'—'}</td>
            <td>${c.phone||'—'}</td>
            <td>${c.email||'—'}</td>
            <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:#666">${c.address||'—'}</td>
            <td>
              <button class="btn-icon" onclick="editClient(${c.id})" title="Edit">✏️</button>
              ${S.user.role==='admin'?`<button class="btn-icon" onclick="deleteClient(${c.id})" title="Delete">🗑️</button>`:''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`}
  </div>`;
}

function clientForm(c={}) {
  return `<div class="form-grid">
    <div class="form-group"><label>Name *</label><input type="text" id="fc-name" value="${c.name||''}"></div>
    <div class="form-group"><label>Company</label><input type="text" id="fc-company" value="${c.company||''}"></div>
    <div class="form-group"><label>Phone</label><input type="text" id="fc-phone" value="${c.phone||''}"></div>
    <div class="form-group"><label>Email</label><input type="text" id="fc-email" value="${c.email||''}"></div>
    <div class="form-group full"><label>Address</label><textarea id="fc-address">${c.address||''}</textarea></div>
    <div class="form-group full"><label>Notes</label><textarea id="fc-notes">${c.notes||''}</textarea></div>
  </div>`;
}

function openAddClient() {
  document.getElementById('modal-title').textContent = 'Add Client';
  document.getElementById('modal-body').innerHTML = clientForm();
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveClient()">Add Client</button>`;
  openModal();
}

async function editClient(id) {
  const c = await api('GET',`/clients/${id}`);
  document.getElementById('modal-title').textContent = 'Edit Client — ' + c.name;
  document.getElementById('modal-body').innerHTML = clientForm(c);
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveClient(${id})">Save</button>`;
  openModal();
}

async function saveClient(id) {
  const d = {
    name:    document.getElementById('fc-name').value.trim(),
    company: document.getElementById('fc-company').value.trim(),
    phone:   document.getElementById('fc-phone').value.trim(),
    email:   document.getElementById('fc-email').value.trim(),
    address: document.getElementById('fc-address').value.trim(),
    notes:   document.getElementById('fc-notes').value.trim(),
  };
  if (!d.name) return toast('Name is required', false);
  try {
    if (id) await api('PUT',`/clients/${id}`, d);
    else    await api('POST','/clients', d);
    toast(id ? 'Client updated ✓' : 'Client added ✓');
    closeModal(); renderClients();
  } catch(e) { toast(e.message, false); }
}

async function deleteClient(id) {
  if (!confirm('Delete this client?')) return;
  try { await api('DELETE',`/clients/${id}`); toast('Client deleted'); renderClients(); }
  catch(e) { toast(e.message, false); }
}

// ══════════════════════════════════════════════════════════
// INVOICES
// ══════════════════════════════════════════════════════════
const INV_STATUS_COLOR = { pending:'pending', paid:'paid', cancelled:'cancelled', draft:'draft' };

async function renderInvoices() {
  const invs = await api('GET','/invoices');
  const totalVal = invs.reduce((s,i)=>s+i.total,0);
  const paidVal  = invs.filter(i=>i.status==='paid').reduce((s,i)=>s+i.total,0);

  document.getElementById('content').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
    <div class="kpi k-total"><div class="kpi-label">Total Invoices</div><div class="kpi-value">${invs.length}</div></div>
    <div class="kpi k-rev"><div class="kpi-label">Total Value</div><div class="kpi-value" style="font-size:17px">${fmt(totalVal)}</div></div>
    <div class="kpi k-profit"><div class="kpi-label">Paid</div><div class="kpi-value" style="font-size:17px;color:#10b981">${fmt(paidVal)}</div></div>
    <div class="kpi k-pend"><div class="kpi-label">Pending</div><div class="kpi-value">${invs.filter(i=>i.status==='pending').length}</div></div>
  </div>
  <div class="panel">
    <div class="panel-header">
      <h3>Invoices</h3>
      <button class="btn btn-primary btn-sm" onclick="openAddInvoice()">+ New Invoice</button>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Invoice #</th><th>Client</th><th>Date</th><th>Currency</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${invs.length ? invs.map(i=>`<tr>
            <td><strong>${i.invoice_number}</strong></td>
            <td>${i.client_name||'<span style="color:#bbb">No client</span>'} ${i.client_company?`<span class="tag">${i.client_company}</span>`:''}</td>
            <td style="font-size:11.5px;color:#666">${i.invoice_date||'—'}</td>
            <td><span class="tag">${i.currency}</span></td>
            <td><strong>${i.currency==='EUR'?'€':'RM '}${(+i.total||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></td>
            <td><span class="badge ${INV_STATUS_COLOR[i.status]||''}">${i.status}</span></td>
            <td style="display:flex;gap:4px;align-items:center">
              <button class="btn-icon" onclick="viewInvoice(${i.id})" title="View">👁️</button>
              <select onchange="updateInvStatus(${i.id},this.value)" style="font-size:11px;border:1px solid #e0e0e0;border-radius:4px;padding:2px 4px">
                ${['pending','paid','cancelled','draft'].map(s=>`<option value="${s}" ${i.status===s?'selected':''}>${s}</option>`).join('')}
              </select>
              ${S.user.role==='admin'?`<button class="btn-icon" onclick="deleteInvoice(${i.id})" title="Delete">🗑️</button>`:''}
            </td>
          </tr>`).join('') : '<tr><td colspan="7" class="empty" style="padding:40px;text-align:center"><div class="empty-icon">🧾</div>No invoices yet</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}

async function updateInvStatus(id, status) {
  await api('PUT',`/invoices/${id}/status`,{status});
  toast(`Invoice → ${status}`);
}

async function viewInvoice(id) {
  const inv = await api('GET',`/invoices/${id}`);
  const sym = inv.currency==='EUR'?'€':'RM ';
  const mf = v => sym+(+v||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('modal-title').textContent = `Invoice ${inv.invoice_number}`;
  document.getElementById('modal-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:16px">
      <div><span style="color:#888">Client:</span> <strong>${inv.client_name||'—'}</strong></div>
      <div><span style="color:#888">Date:</span> <strong>${inv.invoice_date}</strong></div>
      <div><span style="color:#888">Status:</span> <span class="badge ${inv.status}">${inv.status}</span></div>
      <div><span style="color:#888">Currency:</span> <span class="tag">${inv.currency}</span></div>
      ${inv.client_phone?`<div><span style="color:#888">Phone:</span> ${inv.client_phone}</div>`:''}
      ${inv.client_email?`<div><span style="color:#888">Email:</span> ${inv.client_email}</div>`:''}
    </div>
    <table style="width:100%;font-size:12px;margin-bottom:14px">
      <thead><tr style="background:#f8f9fa">
        <th style="padding:7px 9px;text-align:left">Item</th>
        <th style="padding:7px 9px;text-align:right">Qty</th>
        <th style="padding:7px 9px;text-align:right">Price</th>
        <th style="padding:7px 9px;text-align:right">Subtotal</th>
      </tr></thead>
      <tbody>
        ${inv.items.map(it=>`<tr style="border-bottom:1px solid #f0f2f5">
          <td style="padding:7px 9px">${it.product_name||it.design||'—'} ${it.quality?`<span class="tag">${it.quality}</span>`:''}</td>
          <td style="padding:7px 9px;text-align:right">${it.quantity}</td>
          <td style="padding:7px 9px;text-align:right">${mf(it.unit_price)}</td>
          <td style="padding:7px 9px;text-align:right">${mf(it.subtotal)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="text-align:right;font-size:13px;border-top:1px solid #f0f2f5;padding-top:10px">
      <div style="color:#666">Subtotal: ${mf(inv.subtotal)}</div>
      ${inv.discount_amount?`<div style="color:#dc2626">Discount: -${mf(inv.discount_amount)}</div>`:''}
      ${inv.tax_amount?`<div style="color:#666">Tax: +${mf(inv.tax_amount)}</div>`:''}
      <div style="font-size:16px;font-weight:700;margin-top:8px">Total: ${mf(inv.total)}</div>
    </div>
    ${inv.notes?`<div style="margin-top:12px;padding:10px;background:#f8f9fa;border-radius:6px;font-size:12px;color:#555">${inv.notes}</div>`:''}`;
  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost" onclick="closeModal()">Close</button>`;
  openModal();
}

let _invItems = [];
async function openAddInvoice() {
  _invItems = [];
  const [numData, clients] = await Promise.all([api('GET','/invoices/next-number'), api('GET','/clients')]);
  document.getElementById('modal-title').textContent = 'New Invoice';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-grid" style="margin-bottom:14px">
      <div class="form-group"><label>Invoice #</label><input type="text" id="fi-num" value="${numData.invoice_number}"></div>
      <div class="form-group"><label>Date</label><input type="date" id="fi-date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="form-group"><label>Client</label>
        <select id="fi-client"><option value="">— No Client —</option>
          ${clients.map(c=>`<option value="${c.id}">${c.name}${c.company?' ('+c.company+')':''}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Currency</label>
        <select id="fi-currency"><option>MYR</option><option>EUR</option><option>USD</option></select>
      </div>
      <div class="form-group"><label>Discount %</label><input type="number" id="fi-disc" value="0" step="0.1"></div>
      <div class="form-group"><label>Tax %</label><input type="number" id="fi-tax" value="0" step="0.1"></div>
      <div class="form-group full"><label>Notes</label><textarea id="fi-notes" style="min-height:50px"></textarea></div>
    </div>
    <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Items</div>
    <div id="inv-items-wrap"></div>
    <button class="btn btn-ghost btn-sm" onclick="addInvItem()" style="margin-top:6px">+ Add Item</button>
    <div style="margin-top:10px;text-align:right;font-size:12.5px;padding:8px;background:#f8f9fa;border-radius:6px" id="inv-total-display"></div>`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveInvoice()">Create Invoice</button>`;
  openModal();
  addInvItem();
}

function addInvItem() {
  _invItems.push({ product_name:'', design:'', quality:'', quantity:1, unit_price:0 });
  const i = _invItems.length - 1;
  const wrap = document.getElementById('inv-items-wrap');
  const div = document.createElement('div');
  div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:6px;align-items:end;margin-bottom:6px;background:#f8f9fa;padding:8px;border-radius:6px';
  div.id = `inv-item-${i}`;
  div.innerHTML = `
    <div><label style="font-size:10px;color:#888;text-transform:uppercase">Item Name</label>
      <input type="text" placeholder="Product/Design" oninput="_invItems[${i}].product_name=this.value;_invItems[${i}].design=this.value"></div>
    <div><label style="font-size:10px;color:#888;text-transform:uppercase">Quality</label>
      <input type="text" placeholder="Quality" oninput="_invItems[${i}].quality=this.value"></div>
    <div><label style="font-size:10px;color:#888;text-transform:uppercase">Qty</label>
      <input type="number" value="1" min="0.1" step="0.1" oninput="_invItems[${i}].quantity=+this.value;calcInvTotal()"></div>
    <div><label style="font-size:10px;color:#888;text-transform:uppercase">Unit Price</label>
      <input type="number" value="0" step="0.01" oninput="_invItems[${i}].unit_price=+this.value;calcInvTotal()"></div>
    <button class="btn-icon" onclick="removeInvItem(${i})" style="margin-bottom:2px;font-size:16px">✕</button>`;
  wrap.appendChild(div);
  calcInvTotal();
}

function removeInvItem(i) {
  _invItems[i] = null;
  document.getElementById(`inv-item-${i}`)?.remove();
  calcInvTotal();
}

function calcInvTotal() {
  const items = _invItems.filter(Boolean);
  const sub  = items.reduce((s,i)=>s+i.quantity*i.unit_price,0);
  const disc = sub*(+(document.getElementById('fi-disc')?.value||0)/100);
  const tax  = (sub-disc)*(+(document.getElementById('fi-tax')?.value||0)/100);
  const cur  = document.getElementById('fi-currency')?.value || 'MYR';
  const sym  = cur==='EUR'?'€':'RM ';
  const mf   = v => sym+(+v||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
  const el = document.getElementById('inv-total-display');
  if (el) el.innerHTML = `Subtotal: ${mf(sub)} &nbsp;|&nbsp; Discount: -${mf(disc)} &nbsp;|&nbsp; Tax: +${mf(tax)} &nbsp;|&nbsp; <strong>Total: ${mf(sub-disc+tax)}</strong>`;
}

async function saveInvoice() {
  const items = _invItems.filter(Boolean).filter(i=>i.product_name.trim());
  if (!items.length) return toast('Add at least one item', false);
  const body = {
    invoice_number: document.getElementById('fi-num').value,
    client_id:      document.getElementById('fi-client').value || null,
    invoice_date:   document.getElementById('fi-date').value,
    currency:       document.getElementById('fi-currency').value,
    discount_pct:   document.getElementById('fi-disc').value,
    tax_pct:        document.getElementById('fi-tax').value,
    notes:          document.getElementById('fi-notes').value,
    status: 'pending', items,
  };
  try {
    const r = await api('POST','/invoices', body);
    toast(`Invoice ${r.invoice_number} created ✓`);
    _invItems = []; closeModal(); renderInvoices();
  } catch(e) { toast(e.message, false); }
}

async function deleteInvoice(id) {
  if (!confirm('Delete this invoice?')) return;
  await api('DELETE',`/invoices/${id}`);
  toast('Invoice deleted'); renderInvoices();
}

// ══════════════════════════════════════════════════════════
// IMPORT EXCEL
// ══════════════════════════════════════════════════════════
let _importFile = null;
let _importMapping = {};
let _importColumns = [];
let _importTotal = 0;

function renderImport() {
  document.getElementById('content').innerHTML = `
  <div class="panel">
    <div class="panel-header"><h3>Import Excel / CSV</h3></div>
    <div class="panel-body">
      <p style="font-size:13px;color:#555;margin-bottom:14px">
        Upload an Excel (.xlsx, .xls) or CSV file. After upload, map the columns to the correct fields, then import.
      </p>
      <div class="drop-zone" id="drop-zone" onclick="document.getElementById('import-file').click()"
           ondragover="event.preventDefault();this.classList.add('drag-over')"
           ondragleave="this.classList.remove('drag-over')"
           ondrop="handleImportDrop(event)">
        <div style="font-size:36px">📥</div>
        <p><strong>Click to choose file</strong> or drag & drop here</p>
        <p style="font-size:11px;color:#aaa;margin-top:4px">Supports .xlsx, .xls, .csv — up to 20 MB</p>
        <input type="file" id="import-file" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleImportFile(this.files[0])">
      </div>
    </div>
  </div>

  <div id="import-mapping-panel" style="display:none">
    <div class="panel">
      <div class="panel-header">
        <h3 id="import-file-info">Column Mapping</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <label style="font-size:12px;color:#555;text-transform:none">Default Category:</label>
          <select id="import-cat" style="font-size:12px;padding:4px 8px;border:1px solid #e0e0e0;border-radius:5px">
            ${CATEGORIES.map(c=>`<option>${c}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="panel-body">
        <p style="font-size:12px;color:#888;margin-bottom:12px">Map your spreadsheet columns to the system fields. Leave blank to skip a field.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px" id="mapping-grid"></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h3>Data Preview (first 8 rows)</h3></div>
      <div class="tbl-wrap" id="import-preview"></div>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:20px">
      <button class="btn btn-primary" onclick="doImport()" id="import-btn">Import <span id="import-count"></span> Rows</button>
      <button class="btn btn-ghost" onclick="resetImport()">Start Over</button>
    </div>
    <div id="import-result" style="display:none"></div>
  </div>`;
}

function handleImportDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleImportFile(file);
}

async function handleImportFile(file) {
  if (!file) return;
  _importFile = file;
  document.getElementById('drop-zone').innerHTML = `<div style="font-size:28px">📄</div><p><strong>${file.name}</strong></p><p style="font-size:11px;color:#888">${(file.size/1024).toFixed(0)} KB — Parsing...</p>`;

  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await fetch('/api/import/preview', { method:'POST', headers:{Authorization:'Bearer '+S.token}, body:fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);

    _importColumns = data.columns;
    _importTotal   = data.total;

    document.getElementById('drop-zone').innerHTML = `<div style="font-size:28px">✅</div><p><strong>${file.name}</strong> — ${data.total} rows found</p>`;
    document.getElementById('import-mapping-panel').style.display = '';
    document.getElementById('import-file-info').textContent = `Column Mapping — ${file.name} (${data.total} rows)`;
    document.getElementById('import-count').textContent = data.total;

    // Build mapping UI
    const fields = [
      { key:'category',       label:'Category' },
      { key:'brand',          label:'Brand' },
      { key:'design',         label:'Design No.' },
      { key:'article',        label:'Article No.' },
      { key:'quality',        label:'Quality' },
      { key:'color',          label:'Color' },
      { key:'qty',            label:'Qty (meters)' },
      { key:'cost_eur',       label:'Cost EUR' },
      { key:'cost_rm',        label:'Cost RM' },
      { key:'cost_piece_rm',  label:'Cost/Piece RM' },
      { key:'vip_mt_rm',      label:'VIP/Mt RM' },
      { key:'vip_piece_rm',   label:'VIP/Piece RM' },
      { key:'sell_mt_rm',     label:'Sell/Mt RM' },
      { key:'sell_piece_rm',  label:'Sell/Piece RM' },
      { key:'sold_to',        label:'Sold To' },
      { key:'sold_date',      label:'Sale Date' },
      { key:'status',         label:'Status' },
      { key:'notes',          label:'Notes' },
    ];

    // Enhanced auto-match: exact key, label words, or common aliases
    const DATE_ALIASES  = ['date','sold date','sale date','sold_date','saledate','solddate','transaction date','txn date','tanggal','tarikhh'];
    const AGENT_ALIASES = ['agent','sold to','soldto','buyer','customer','pembeli','sold by','salesperson'];
    const STATUS_ALIASES= ['status','state','condition','availability'];
    function autoMatch(f, cols) {
      const key   = f.key.toLowerCase().replace(/[\s_]/g,'');
      const label = f.label.toLowerCase().replace(/[\s\/]/g,'');
      // exact key match
      let m = cols.find(c => c.toLowerCase().replace(/[\s_]/g,'') === key);
      if (m) return m;
      // label match
      m = cols.find(c => c.toLowerCase().replace(/[\s_]/g,'') === label);
      if (m) return m;
      // special alias sets
      if (f.key === 'sold_date')  { m = cols.find(c => DATE_ALIASES.some(a  => c.toLowerCase().includes(a))); if(m) return m; }
      if (f.key === 'sold_to')    { m = cols.find(c => AGENT_ALIASES.some(a => c.toLowerCase().includes(a))); if(m) return m; }
      if (f.key === 'status')     { m = cols.find(c => STATUS_ALIASES.some(a=> c.toLowerCase().includes(a))); if(m) return m; }
      // partial first word
      const word = f.key.split('_')[0];
      m = cols.find(c => c.toLowerCase().includes(word));
      return m || null;
    }

    const grid = document.getElementById('mapping-grid');
    grid.innerHTML = fields.map(f => {
      const auto = autoMatch(f, _importColumns);
      return `<div class="col-map-row">
        <div class="col-map-label">${f.label}</div>
        <select id="map-${f.key}" onchange="_importMapping['${f.key}']=this.value">
          <option value="">— skip —</option>
          ${_importColumns.map(c=>`<option value="${c}" ${c===auto?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>`;
    }).join('');

    // Init mapping from auto-selects
    _importMapping = {};
    fields.forEach(f => {
      const el = document.getElementById(`map-${f.key}`);
      if (el && el.value) _importMapping[f.key] = el.value;
    });

    // Preview table
    const colsToShow = data.columns.slice(0,8);
    document.getElementById('import-preview').innerHTML = `
      <table>
        <thead><tr>${colsToShow.map(c=>`<th>${c}</th>`).join('')}${data.columns.length>8?'<th>...</th>':''}</tr></thead>
        <tbody>${data.preview.map(row=>`<tr>
          ${colsToShow.map(c=>`<td>${String(row[c]||'').substring(0,30)}</td>`).join('')}
          ${data.columns.length>8?'<td style="color:#aaa">...</td>':''}
        </tr>`).join('')}</tbody>
      </table>`;

  } catch(e) {
    toast('Error: ' + e.message, false);
    document.getElementById('drop-zone').innerHTML = `<div style="font-size:28px">❌</div><p style="color:#dc2626">${e.message}</p><p style="font-size:12px;margin-top:4px">Click to try again</p>`;
  }
}

async function doImport() {
  if (!_importFile) return toast('No file selected', false);
  const btn = document.getElementById('import-btn');
  btn.disabled = true; btn.textContent = 'Importing...';

  const fd = new FormData();
  fd.append('file', _importFile);
  fd.append('mapping', JSON.stringify(_importMapping));
  fd.append('category', document.getElementById('import-cat').value);

  try {
    const r = await fetch('/api/import/commit', { method:'POST', headers:{Authorization:'Bearer '+S.token}, body:fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);

    const result = document.getElementById('import-result');
    result.style.display = '';
    result.innerHTML = `
      <div style="background:#dcfce7;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;font-size:13px">
        <div style="font-size:16px;font-weight:700;color:#15803d;margin-bottom:6px">✓ Import Complete</div>
        <div>Imported: <strong>${data.imported}</strong> items</div>
        <div>Skipped: <strong>${data.skipped}</strong> empty rows</div>
        <div>Total rows: <strong>${data.total}</strong></div>
        <div style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="navigate('inventory')">View Inventory →</button></div>
      </div>`;
    toast(`${data.imported} items imported ✓`);
    btn.disabled = false; btn.textContent = 'Import Again';
  } catch(e) {
    toast('Import failed: ' + e.message, false);
    btn.disabled = false; btn.textContent = 'Retry Import';
  }
}

function resetImport() {
  _importFile = null; _importMapping = {}; _importColumns = []; _importTotal = 0;
  renderImport();
}

// ══════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════
let _reportFilter = { category:'', status:'', year:'' };
let _reportData   = null;

async function renderReports() {
  document.getElementById('content').innerHTML = `
  <div class="panel" style="margin-bottom:12px">
    <div class="panel-header"><h3>Report Filters</h3></div>
    <div class="panel-body">
      <div class="toolbar">
        <select id="rpt-cat" onchange="_reportFilter.category=this.value">
          <option value="">All Categories</option>
          ${CATEGORIES.map(c=>`<option value="${c}" ${_reportFilter.category===c?'selected':''}>${c}</option>`).join('')}
        </select>
        <select id="rpt-status" onchange="_reportFilter.status=this.value">
          <option value="">All Status</option>
          <option value="available" ${_reportFilter.status==='available'?'selected':''}>Available</option>
          <option value="sold" ${_reportFilter.status==='sold'?'selected':''}>Sold</option>
          <option value="pending" ${_reportFilter.status==='pending'?'selected':''}>Pending</option>
        </select>
        <input type="text" id="rpt-year" placeholder="Year e.g. 2024" value="${_reportFilter.year}" style="width:120px;flex:none" onchange="_reportFilter.year=this.value">
        <button class="btn btn-primary btn-sm" onclick="loadReport()">🔍 Generate Report</button>
        <button class="btn btn-success btn-sm" onclick="downloadCSV()">⬇ Download CSV</button>
      </div>
    </div>
  </div>
  <div id="report-output"><div class="empty"><div class="empty-icon">📋</div>Set filters above and click Generate Report</div></div>`;
}

async function loadReport() {
  document.getElementById('report-output').innerHTML = '<div class="empty"><div class="empty-icon">⏳</div>Loading...</div>';
  const { category, status, year } = _reportFilter;
  const params = new URLSearchParams({ page:1, limit:200 });
  if (category) params.set('category',category);
  if (status)   params.set('status',status);

  _reportData = await api('GET',`/products?${params}`);
  const items = _reportData.items;

  const totalCost   = items.reduce((s,i)=>s+(+i.cost_piece_rm||0),0);
  const totalSell   = items.reduce((s,i)=>s+(+i.sell_piece_rm||0),0);
  const totalRev    = items.reduce((s,i)=>s+(+i.actual_sell_rm||0),0);
  const totalProfit = items.reduce((s,i)=>s+(+i.net_profit||0),0);

  document.getElementById('report-output').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:14px">
    <div class="kpi k-total"><div class="kpi-label">Items</div><div class="kpi-value">${fmtN(items.length)}</div></div>
    <div class="kpi k-avail"><div class="kpi-label">Available</div><div class="kpi-value">${fmtN(items.filter(i=>i.status==='available').length)}</div></div>
    <div class="kpi k-sold"><div class="kpi-label">Sold</div><div class="kpi-value">${fmtN(items.filter(i=>i.status==='sold').length)}</div></div>
    <div class="kpi k-val"><div class="kpi-label">Total Cost Value</div><div class="kpi-value" style="font-size:15px">${fmt(totalCost)}</div></div>
    <div class="kpi k-profit"><div class="kpi-label">Net Profit</div><div class="kpi-value" style="font-size:15px;color:#10b981">${fmt(totalProfit)}</div></div>
  </div>
  <div class="panel">
    <div class="panel-header">
      <h3>Report Results (${items.length} items)</h3>
      <button class="btn btn-success btn-sm" onclick="downloadCSV()">⬇ Download CSV</button>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Category</th><th>Brand</th><th>Design</th><th>Article</th>
          <th>Quality</th><th>Color</th><th>Qty</th>
          <th>Cost RM</th><th>Sell RM</th><th>Status</th><th>Agent</th><th>Revenue</th><th>Profit</th>
        </tr></thead>
        <tbody>
          ${items.map(p=>`<tr>
            <td><span class="badge ${p.category.toLowerCase()}">${p.category}</span></td>
            <td>${p.brand||'—'}</td>
            <td><code>${p.design||'—'}</code></td>
            <td><code style="color:#0369a1">${p.article||'—'}</code></td>
            <td>${p.quality||'—'}</td>
            <td>${p.color||'—'}</td>
            <td style="text-align:right">${(+p.qty||0).toFixed(1)}</td>
            <td style="text-align:right">${fmt(p.cost_piece_rm)}</td>
            <td style="text-align:right">${fmt(p.sell_piece_rm)}</td>
            <td><span class="badge ${p.status}">${p.status}</span></td>
            <td>${p.sold_to?`<span class="tag">${p.sold_to}</span>`:'—'}</td>
            <td style="text-align:right;color:#0ea5e9">${p.actual_sell_rm?fmt(p.actual_sell_rm):'—'}</td>
            <td style="text-align:right;color:#10b981">${p.net_profit?fmt(p.net_profit):'—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${items.length===200?'<div style="padding:10px 14px;font-size:11.5px;color:#f59e0b">⚠ Showing first 200 items. Download CSV for full data.</div>':''}
  </div>`;
}

function downloadCSV() {
  const { category, status, year } = _reportFilter;
  const params = new URLSearchParams();
  if (category) params.set('category',category);
  if (status)   params.set('status',status);
  if (year)     params.set('year',year);
  fetch('/api/reports/csv?' + params, { headers:{ Authorization:'Bearer '+S.token } })
    .then(r=>r.blob())
    .then(blob=>{
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `visionag-report-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
    })
    .catch(()=>toast('Download failed',false));
}

// ══════════════════════════════════════════════════════════
// PROFIT & LOSS STATEMENT
// ══════════════════════════════════════════════════════════
let _pnlYear = String(new Date().getFullYear());
let _pnlData  = null;

async function renderPnl() {
  document.getElementById('content').innerHTML = '<div class="empty"><div class="empty-icon">⏳</div>Loading P&L...</div>';
  _pnlData = await api('GET', `/pnl?year=${_pnlYear}`);
  _renderPnl();
}

function _renderPnl() {
  const d = _pnlData; if (!d) return;
  const t = d.totals || {};
  const marginPct = t.revenue ? ((t.profit / t.revenue) * 100).toFixed(1) : '0.0';
  const grossPct  = t.revenue ? (((t.revenue - t.cost) / t.revenue) * 100).toFixed(1) : '0.0';
  const years = d.years.length ? d.years : [_pnlYear];

  // Build monthly arrays
  const mRevArr  = Array(12).fill(0);
  const mCostArr = Array(12).fill(0);
  const mProfArr = Array(12).fill(0);
  (d.monthly||[]).forEach(m => {
    const i = parseInt(m.month)-1;
    if (i>=0 && i<12) { mRevArr[i]=m.revenue; mCostArr[i]=m.cost; mProfArr[i]=m.profit; }
  });

  document.getElementById('content').innerHTML = `
  <div class="year-tabs">
    ${years.map(y=>`<button class="year-tab ${y===_pnlYear?'active':''}" onclick="switchPnlYear('${y}')">${y}</button>`).join('')}
  </div>

  <div class="kpi-grid">
    <div class="kpi k-rev"><div class="kpi-label">Total Revenue</div><div class="kpi-value" style="font-size:17px">${fmt(t.revenue)}</div><div class="kpi-sub">${fmtN(t.units)} units sold</div></div>
    <div class="kpi k-val"><div class="kpi-label">Total Cost</div><div class="kpi-value" style="font-size:17px">${fmt(t.cost)}</div><div class="kpi-sub">Cost of goods sold</div></div>
    <div class="kpi" style="border-left-color:#f59e0b"><div class="kpi-label">Commission</div><div class="kpi-value" style="font-size:17px">${fmt(t.commission)}</div><div class="kpi-sub">Agent commissions</div></div>
    <div class="kpi k-profit"><div class="kpi-label">Net Profit</div><div class="kpi-value" style="font-size:17px;color:#10b981">${fmt(t.profit)}</div><div class="kpi-sub">After all costs</div></div>
    <div class="kpi" style="border-left-color:#0ea5e9"><div class="kpi-label">Gross Margin</div><div class="kpi-value" style="font-size:20px;color:#0ea5e9">${grossPct}%</div><div class="kpi-sub">Revenue − Cost / Revenue</div></div>
    <div class="kpi" style="border-left-color:#7c3aed"><div class="kpi-label">Net Margin</div><div class="kpi-value" style="font-size:20px;color:#7c3aed">${marginPct}%</div><div class="kpi-sub">Profit / Revenue</div></div>
  </div>

  <div class="chart-grid" style="margin-bottom:14px">
    <div class="chart-box">
      <h4>Monthly Revenue vs Cost vs Profit — ${_pnlYear}</h4>
      <canvas id="pnlMonthChart" height="200"></canvas>
    </div>
    <div class="chart-box">
      <h4>Revenue by Category — ${_pnlYear}</h4>
      <canvas id="pnlCatChart" height="200"></canvas>
    </div>
  </div>

  <div class="two-col">
    <div class="panel" style="margin:0">
      <div class="panel-header"><h3>Monthly P&amp;L Breakdown</h3></div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Month</th><th>Units</th><th>Revenue</th><th>Cost</th><th>Commission</th><th>Net Profit</th><th>Margin</th></tr></thead>
          <tbody>
            ${d.monthly.length ? d.monthly.map(m => {
              const mgn = m.revenue ? ((m.profit/m.revenue)*100).toFixed(1) : '—';
              const color = m.profit >= 0 ? '#10b981' : '#ef4444';
              return `<tr>
                <td><strong>${MONTHS[parseInt(m.month)-1]||m.month}</strong></td>
                <td>${fmtN(m.units)}</td>
                <td style="color:#0ea5e9">${fmt(m.revenue)}</td>
                <td style="color:#888">${fmt(m.cost)}</td>
                <td style="color:#f59e0b">${fmt(m.commission)}</td>
                <td style="color:${color};font-weight:600">${fmt(m.profit)}</td>
                <td style="color:${color}">${mgn}%</td>
              </tr>`;
            }).join('') : '<tr><td colspan="7" class="empty" style="padding:20px;text-align:center">No sales data for ${_pnlYear}</td></tr>'}
            ${d.monthly.length ? `<tr style="background:#f8f9fa;font-weight:700">
              <td>TOTAL</td>
              <td>${fmtN(t.units)}</td>
              <td style="color:#0ea5e9">${fmt(t.revenue)}</td>
              <td style="color:#888">${fmt(t.cost)}</td>
              <td style="color:#f59e0b">${fmt(t.commission)}</td>
              <td style="color:#10b981">${fmt(t.profit)}</td>
              <td style="color:#7c3aed">${marginPct}%</td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel" style="margin:0">
      <div class="panel-header"><h3>Category P&amp;L — ${_pnlYear}</h3></div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Category</th><th>Units</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th></tr></thead>
          <tbody>
            ${d.byCat.length ? d.byCat.map(c => {
              const mgn = c.revenue ? ((c.profit/c.revenue)*100).toFixed(1) : '0.0';
              return `<tr>
                <td><span class="badge ${c.category.toLowerCase()}">${c.category}</span></td>
                <td>${fmtN(c.units)}</td>
                <td style="color:#0ea5e9">${fmt(c.revenue)}</td>
                <td style="color:#888">${fmt(c.cost)}</td>
                <td style="color:#10b981;font-weight:600">${fmt(c.profit)}</td>
                <td style="color:#7c3aed">${mgn}%</td>
              </tr>`;
            }).join('') : '<tr><td colspan="6" class="empty" style="padding:20px;text-align:center">No data</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="panel-body" style="border-top:1px solid #f0f2f5">
        <div style="font-size:12px;color:#555;font-weight:600;margin-bottom:8px">📦 Current Stock Value</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div style="background:#f8f9fa;padding:10px;border-radius:8px;text-align:center">
            <div style="font-size:10px;color:#888;margin-bottom:4px">UNITS</div>
            <div style="font-size:16px;font-weight:700">${fmtN(d.stockVal?.units)}</div>
          </div>
          <div style="background:#f0fdf4;padding:10px;border-radius:8px;text-align:center">
            <div style="font-size:10px;color:#888;margin-bottom:4px">AT COST</div>
            <div style="font-size:14px;font-weight:700;color:#16a34a">${fmt(d.stockVal?.cost_value)}</div>
          </div>
          <div style="background:#eff6ff;padding:10px;border-radius:8px;text-align:center">
            <div style="font-size:10px;color:#888;margin-bottom:4px">AT SELL PRICE</div>
            <div style="font-size:14px;font-weight:700;color:#2563eb">${fmt(d.stockVal?.sell_value)}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  // Monthly chart
  makeChart('pnlMonthChart', {
    type:'bar',
    data:{
      labels: MONTHS,
      datasets:[
        { label:'Revenue', data:mRevArr,  backgroundColor:'rgba(14,165,233,.7)',  borderRadius:3 },
        { label:'Cost',    data:mCostArr, backgroundColor:'rgba(239,68,68,.55)',   borderRadius:3 },
        { label:'Profit',  data:mProfArr, backgroundColor:'rgba(16,185,129,.75)', borderRadius:3 },
      ]
    },
    options:{
      responsive:true,
      plugins:{ legend:{position:'top',labels:{font:{size:11},boxWidth:10}} },
      scales:{
        y:{ ticks:{ callback:v=>(S.currency==='EUR'?'€':'RM')+(v/1000).toFixed(0)+'k', font:{size:10} }, grid:{color:'#f0f2f5'}, stacked:false },
        x:{ ticks:{ font:{size:10} }, grid:{display:false} }
      }
    }
  });

  if (d.byCat.length) {
    makeChart('pnlCatChart', {
      type:'doughnut',
      data:{
        labels: d.byCat.map(c=>c.category),
        datasets:[{ data:d.byCat.map(c=>c.revenue), backgroundColor:d.byCat.map(c=>CAT_COLORS[c.category]||'#999'), borderWidth:2, borderColor:'#fff' }]
      },
      options:{ plugins:{ legend:{position:'bottom',labels:{font:{size:11},boxWidth:10}} }, cutout:'60%' }
    });
  }
}

async function switchPnlYear(y) {
  _pnlYear = y;
  _pnlData = await api('GET', `/pnl?year=${y}`);
  _renderPnl();
}

// ══════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════
async function renderUsers() {
  const users = await api('GET','/users');
  document.getElementById('content').innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <h3>User Management</h3>
      <button class="btn btn-primary btn-sm" onclick="openAddUser()">+ Add User</button>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Username</th><th>Full Name</th><th>Role</th><th>Status</th><th>Created</th><th>Action</th></tr></thead>
        <tbody>
          ${users.map(u=>`<tr>
            <td><strong>${u.username}</strong></td>
            <td>${u.full_name||'—'}</td>
            <td><span class="badge ${u.role}">${u.role}</span></td>
            <td><span class="badge ${u.active?'available':'sold'}">${u.active?'Active':'Inactive'}</span></td>
            <td style="font-size:11px;color:#888">${u.created_at?.substring(0,10)||'—'}</td>
            <td><button class="btn-icon" onclick="editUser(${u.id})">✏️</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function userForm(u={}) {
  return `<div class="form-grid">
    <div class="form-group"><label>Username *</label>
      <input type="text" id="fu-username" value="${u.username||''}" ${u.id?'readonly':''}></div>
    <div class="form-group"><label>Password ${u.id?'(leave blank = keep)':' *'}</label>
      <input type="text" id="fu-password" placeholder="${u.id?'New password...':'Set password'}"></div>
    <div class="form-group"><label>Full Name</label>
      <input type="text" id="fu-fullname" value="${u.full_name||''}"></div>
    <div class="form-group"><label>Role</label>
      <select id="fu-role">
        <option value="staff" ${u.role==='staff'?'selected':''}>Staff</option>
        <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
      </select>
    </div>
    ${u.id?`<div class="form-group"><label>Active</label>
      <select id="fu-active">
        <option value="1" ${u.active?'selected':''}>Active</option>
        <option value="0" ${!u.active?'selected':''}>Inactive</option>
      </select>
    </div>`:''}
  </div>`;
}

function openAddUser() {
  document.getElementById('modal-title').textContent = 'Add User';
  document.getElementById('modal-body').innerHTML = userForm();
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveUser()">Add User</button>`;
  openModal();
}

async function editUser(id) {
  const users = await api('GET','/users');
  const u = users.find(x=>x.id===id);
  document.getElementById('modal-title').textContent = 'Edit User — ' + u.username;
  document.getElementById('modal-body').innerHTML = userForm(u);
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveUser(${id})">Save</button>`;
  openModal();
}

async function saveUser(id) {
  const d = {
    username:  document.getElementById('fu-username').value.trim(),
    password:  document.getElementById('fu-password').value,
    full_name: document.getElementById('fu-fullname').value.trim(),
    role:      document.getElementById('fu-role').value,
    active:    document.getElementById('fu-active')?.value ?? 1,
  };
  if (!d.username) return toast('Username required', false);
  if (!id && !d.password) return toast('Password required', false);
  try {
    if (id) await api('PUT',`/users/${id}`, d);
    else    await api('POST','/users', d);
    toast(id ? 'User updated ✓' : 'User added ✓');
    closeModal(); renderUsers();
  } catch(e) { toast(e.message, false); }
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
async function init() {
  bindStaticEventHandlers();
  if (!checkAuth()) return;
  try {
    const cats = await api('GET','/categories');
    const total = cats.reduce((s,c)=>s+c.total,0);
    const avail = cats.reduce((s,c)=>s+c.available,0);
    const sold  = cats.reduce((s,c)=>s+c.sold,0);
    document.getElementById('sidebar-info').innerHTML = `
      <div style="color:#ccd">${total.toLocaleString()} items</div>
      <div style="color:#22c55e">${avail.toLocaleString()} available</div>
      <div style="color:#ef4444">${sold.toLocaleString()} sold</div>`;
  } catch {}
  navigate('dashboard');
}

init();
