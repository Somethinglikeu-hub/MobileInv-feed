/**
 * BIST Picker - Core Application Logic
 * Rebuilt from scratch to ensure complete parity with the Android Kotlin application.
 */

window.livePrices = {};
let dbInstance = null;

// --- Global Chart Instances ---
let priceChartInstance = null;
let factorChartInstance = null;
let backtestChartInstance = null;

// ==========================================================================
// 1. PWA Service Worker & Cache Busting Setup
// ==========================================================================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
      .catch(err => console.error('[PWA] Service Worker registration failed:', err));
  });
}

// ==========================================================================
// 2. IndexedDB Snapshot Storage
// ==========================================================================

const IDB_NAME = 'BistPickerCache';
const IDB_VERSION = 1;
const STORE_NAME = 'snapshots';

function openIDB() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('IndexedDB open timeout (iOS Safari workaround)'));
    }, 2000);

    try {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => {
        clearTimeout(timeout);
        resolve(e.target.result);
      };
      request.onerror = (e) => {
        clearTimeout(timeout);
        reject(request.error || new Error('IndexedDB error'));
      };
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

async function getCachedSnapshot() {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(1);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[DB] IndexedDB load failed:', err);
    return null;
  }
}

async function setCachedSnapshot(data) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ id: 1, ...data });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('[DB] IndexedDB save failed:', err);
    throw err;
  }
}

// ==========================================================================
// 3. Database Downloader (With Real-time Progress Tracking)
// ==========================================================================

async function fetchWithProgress(url, onProgress, options = {}) {
  const { timeout = 60000 } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    
    if (total === 0) {
      console.warn('[Fetch] Content-Length is missing, fallback to buffered ArrayBuffer');
      const buf = await response.arrayBuffer();
      return buf;
    }

    const reader = response.body.getReader();
    let loaded = 0;
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      
      const percent = Math.round((loaded / total) * 100);
      onProgress(percent);
    }

    // Combine chunks
    const result = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result.buffer;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ==========================================================================
// 4. SQL Engine Helper Wrappers (Room Queries Parity)
// ==========================================================================

function queryAll(sql, params = {}) {
  if (!dbInstance) {
    console.error('[SQL] DB is not initialized!');
    return [];
  }
  let stmt = null;
  try {
    stmt = dbInstance.prepare(sql);
    stmt.bind(params);
    const list = [];
    while (stmt.step()) {
      list.push(stmt.getAsObject());
    }
    return list;
  } catch (e) {
    console.error('[SQL] Error executing query:', sql, params, e);
    return [];
  } finally {
    if (stmt) stmt.free();
  }
}

function queryOne(sql, params = {}) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Load simulated live rates from price history
function loadSimulatedLivePrices(tickers) {
  window.livePrices = {};
  tickers.forEach(t => {
    const row = queryOne(`
      SELECT close FROM price_history_730d
      WHERE company_id = (SELECT id FROM companies WHERE ticker = :ticker LIMIT 1)
      ORDER BY date DESC LIMIT 1
    `, { ':ticker': t });
    if (row) {
      window.livePrices[t] = row.close;
    }
  });

  const xu100Row = queryOne(`
    SELECT close FROM price_history_730d
    WHERE company_id = (SELECT id FROM companies WHERE ticker = 'XU100' LIMIT 1)
    ORDER BY date DESC LIMIT 1
  `);
  if (xu100Row) {
    window.livePrices['XU100'] = xu100Row.close;
  }
}

// ==========================================================================
// 5. Weekly Performance Calculations (WeeklyPerformanceManager.kt Parity)
// ==========================================================================

function getTurkeyTimeComponents() {
  const dateTR = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
  const trDay = dateTR.getDay(); // 0: Sun, 1: Mon, ..., 5: Fri, 6: Sat
  const trHour = dateTR.getHours();
  const trMin = dateTR.getMinutes();

  let isPastFridayClose = false;
  if (trDay === 5) { // Friday
    isPastFridayClose = (trHour > 18) || (trHour === 18 && trMin >= 15);
  } else if (trDay === 6 || trDay === 0) { // Saturday, Sunday
    isPastFridayClose = true;
  }
  return { trDay, trHour, trMin, isPastFridayClose, dateTR };
}

function getTurkeyCurrentMonday() {
  const { dateTR } = getTurkeyTimeComponents();
  const day = dateTR.getDay();
  const diff = (day >= 1) ? (1 - day) : -6;
  const monday = new Date(dateTR);
  monday.setDate(dateTR.getDate() + diff);

  const y = monday.getFullYear();
  const m = (monday.getMonth() + 1).toString().padStart(2, '0');
  const d = monday.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getPriceOnOrBefore(ticker, dateStr) {
  const row = queryOne(`
    SELECT close FROM price_history_730d 
    WHERE company_id = (SELECT id FROM companies WHERE ticker = :ticker LIMIT 1) 
      AND date <= :date 
    ORDER BY date DESC LIMIT 1
  `, { ':ticker': ticker, ':date': dateStr });
  return row ? row.close : null;
}

function areConsecutiveWeeks(dateStr1, dateStr2) {
  try {
    const d1 = new Date(dateStr1);
    const d2 = new Date(dateStr2);
    const diffMs = d2.getTime() - d1.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays >= 6 && diffDays <= 8;
  } catch (e) {
    return false;
  }
}

function seedInitialRecords() {
  return [
    {
      weekStartDate: "2026-05-18",
      positions: [
        { ticker: "PCILT", entryPrice: 32.48, exitPrice: 33.10, returnPct: 0.0191 },
        { ticker: "KIMMR", entryPrice: 17.29, exitPrice: 17.19, returnPct: -0.0058 },
        { ticker: "ASELS", entryPrice: 428.00, exitPrice: 410.00, returnPct: -0.0421 },
        { ticker: "LILAK", entryPrice: 36.08, exitPrice: 34.30, returnPct: -0.0493 },
        { ticker: "TCKRC", entryPrice: 111.80, exitPrice: 141.30, returnPct: 0.2639 }
      ],
      portfolioReturn: 0.0372,
      bist100StartPrice: 14029.54,
      bist100EndPrice: 13808.20,
      bist100Return: -0.0158,
      isCompleted: true
    }
  ];
}

function updateActiveWeek(dbPositions, livePrices) {
  let storageRecords = localStorage.getItem('bist_weekly_records');
  let records = [];
  
  if (storageRecords) {
    try {
      records = JSON.parse(storageRecords);
    } catch (e) {
      records = seedInitialRecords();
    }
  } else {
    records = seedInitialRecords();
  }

  const currentMonday = getTurkeyCurrentMonday();
  const { isPastFridayClose } = getTurkeyTimeComponents();
  let updated = false;

  // 1. Mark older uncompleted weeks as completed
  for (let i = 0; i < records.length; i++) {
    if (records[i].weekStartDate !== currentMonday && !records[i].isCompleted) {
      records[i].isCompleted = true;
      updated = true;
    }
  }

  // 2. Find or create the current active week
  let index = records.findIndex(r => r.weekStartDate === currentMonday);

  if (index === -1) {
    records.sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
    const prevRecord = records[records.length - 1];
    const isConsecutive = prevRecord && areConsecutiveWeeks(prevRecord.weekStartDate, currentMonday);
    
    const prevPositionsMap = {};
    if (isConsecutive && prevRecord && prevRecord.positions) {
      prevRecord.positions.forEach(pos => {
        prevPositionsMap[pos.ticker] = pos.exitPrice;
      });
    }

    const stockRecords = dbPositions.map(pos => {
      const mondayPrice = getPriceOnOrBefore(pos.ticker, currentMonday);
      const entry = prevPositionsMap[pos.ticker] || mondayPrice || pos.entry_price || pos.current_price || 1.0;
      const live = livePrices[pos.ticker] || entry;
      return {
        ticker: pos.ticker,
        entryPrice: entry,
        exitPrice: live,
        returnPct: entry > 0 ? (live / entry - 1.0) : 0.0
      };
    });

    const prevBistEnd = (isConsecutive && prevRecord) ? prevRecord.bist100EndPrice : null;
    const dbBistMonday = getPriceOnOrBefore('XU100', currentMonday) || 13808.20;
    const startBist100 = prevBistEnd || dbBistMonday;
    const liveBist100 = livePrices['XU100'] || startBist100;

    const newRecord = {
      weekStartDate: currentMonday,
      positions: stockRecords,
      portfolioReturn: stockRecords.length > 0 ? stockRecords.map(s => s.returnPct).reduce((a, b) => a + b, 0) / stockRecords.length : 0.0,
      bist100StartPrice: startBist100,
      bist100EndPrice: liveBist100,
      bist100Return: startBist100 > 0 ? (liveBist100 / startBist100 - 1.0) : 0.0,
      isCompleted: isPastFridayClose
    };
    
    records.push(newRecord);
    updated = true;
  } else {
    const rec = records[index];
    if (!rec.isCompleted) {
      const shouldPopulate = !rec.positions || rec.positions.length === 0 || rec.positions.every(p => p.entryPrice === 1.0 && p.exitPrice === 1.0);
      
      let basePositions = [];
      if (shouldPopulate) {
        const prevRecord = index > 0 ? records[index - 1] : null;
        const isConsecutive = prevRecord && areConsecutiveWeeks(prevRecord.weekStartDate, currentMonday);
        const prevPositionsMap = {};
        if (isConsecutive && prevRecord && prevRecord.positions) {
          prevRecord.positions.forEach(pos => {
            prevPositionsMap[pos.ticker] = pos.exitPrice;
          });
        }

        basePositions = dbPositions.map(pos => {
          const mondayPrice = getPriceOnOrBefore(pos.ticker, currentMonday);
          const entry = prevPositionsMap[pos.ticker] || mondayPrice || pos.entry_price || pos.current_price || 1.0;
          return {
            ticker: pos.ticker,
            entryPrice: entry,
            exitPrice: entry,
            returnPct: 0.0
          };
        });
      } else {
        basePositions = rec.positions;
      }

      const updatedStocks = basePositions.map(stock => {
        const live = livePrices[stock.ticker];
        if (live !== undefined && live !== null) {
          return {
            ...stock,
            exitPrice: live,
            returnPct: stock.entryPrice > 0 ? (live / stock.entryPrice - 1.0) : 0.0
          };
        }
        return stock;
      });

      const startBist100 = rec.bist100StartPrice || 13808.20;
      const liveBist100 = livePrices['XU100'] || rec.bist100EndPrice || startBist100;

      records[index] = {
        ...rec,
        positions: updatedStocks,
        portfolioReturn: updatedStocks.length > 0 ? updatedStocks.map(s => s.returnPct).reduce((a, b) => a + b, 0) / updatedStocks.length : 0.0,
        bist100EndPrice: liveBist100,
        bist100Return: startBist100 > 0 ? (liveBist100 / startBist100 - 1.0) : 0.0,
        isCompleted: isPastFridayClose
      };

      if (shouldPopulate || isPastFridayClose) {
        updated = true;
      }
    }
  }

  if (updated || isPastFridayClose) {
    localStorage.setItem('bist_weekly_records', JSON.stringify(records));
  }
  return records;
}

// ==========================================================================
// 6. Navigation Router
// ==========================================================================

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabPages = document.querySelectorAll('.tab-page');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      
      navItems.forEach(i => i.classList.remove('active'));
      tabPages.forEach(p => p.classList.remove('active'));
      
      item.classList.add('active');
      const targetPage = document.getElementById(`page-${tab}`);
      if (targetPage) targetPage.classList.add('active');

      renderPage(tab);
    });
  });
}

function renderPage(tab) {
  if (tab === 'picks') renderPicksPage();
  else if (tab === 'browse') renderBrowsePage();
  else if (tab === 'market') renderMarketPage();
  else if (tab === 'history') renderHistoryPage();
}

// ==========================================================================
// 7. Page Render Implementations
// ==========================================================================

// --- PAGE 1: PICKS (Home) ---
function renderPicksPage() {
  const home = queryOne('SELECT * FROM home_summary WHERE id = 1');
  const updateDateEl = document.getElementById('app-update-date');
  if (home && home.macro_date) {
    updateDateEl.textContent = `Güncelleme: ${home.macro_date}`;
  }

  const positions = queryAll(`
    SELECT op.*, c.name as fullname 
    FROM open_positions op 
    LEFT JOIN companies c ON c.ticker = op.ticker 
    ORDER BY op.sort_order ASC
  `);
  
  const portListEl = document.getElementById('portfolio-list');
  document.getElementById('picks-count-badge').textContent = `${positions.length} Hisse`;
  
  portListEl.innerHTML = '';
  if (positions.length === 0) {
    portListEl.innerHTML = `<p style="color:var(--text-muted); font-size:12px; text-align:center; padding:24px;">Portföyde hisse bulunmuyor.</p>`;
  } else {
    positions.forEach(pos => {
      const live = window.livePrices[pos.ticker] || pos.current_price;
      const entry = pos.entry_price || 1.0;
      const pnl = ((live / entry) - 1) * 100;
      const pnlClass = pnl >= 0 ? 'pos-text' : 'neg-text';

      const row = document.createElement('div');
      row.className = 'list-item-row';
      row.innerHTML = `
        <div>
          <div class="ticker-block">
            <span class="ticker-name">${pos.ticker}</span>
            <span class="badge badge-live">CANLI</span>
          </div>
          <div class="company-fullname">${pos.fullname || pos.name || '—'}</div>
        </div>
        <div style="text-align: right;">
          <div class="tabular-nums" style="font-weight:700; font-size:14px;">${live.toFixed(2)} TL</div>
          <div class="${pnlClass} tabular-nums" style="font-size:11px; font-weight:800; margin-top:2px;">
            ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%
          </div>
        </div>
      `;
      row.addEventListener('click', () => openStockDetail(pos.ticker));
      portListEl.appendChild(row);
    });
  }

  // --- REBALANCE SIGNALS (Kotlin matching constraints) ---
  const signalsListEl = document.getElementById('signals-list');
  signalsListEl.innerHTML = '';

  const topScoring = queryAll(`
    SELECT * FROM scoring_latest 
    WHERE alpha_core_eligible = 1 
    ORDER BY ranking_score DESC 
    LIMIT 12
  `);

  const openTickers = new Set(positions.map(p => p.ticker));
  const top12Tickers = new Set(topScoring.map(t => t.ticker));

  const buys = [];
  const holds = [];
  const sells = [];

  // 1. Buy: Top 5 eligible positions not in current portfolio
  topScoring.slice(0, 5).forEach(row => {
    if (!openTickers.has(row.ticker)) {
      buys.push({ ticker: row.ticker, action: 'BUY', reason: 'Haftalık Model: Yeni giriş' });
    }
  });

  // 2. Holds & Sells:
  positions.forEach(pos => {
    if (!top12Tickers.has(pos.ticker)) {
      sells.push({ ticker: pos.ticker, action: 'SELL', reason: 'Model kriterlerinden tamamen düştü.' });
    } else {
      holds.push({ ticker: pos.ticker, action: 'HOLD', reason: 'Şirket hala güçlü, potansiyel devam ediyor.' });
    }
  });

  // 3. Overflow target check: limit buys+holds to 5
  const currentTargetCount = holds.length + buys.length;
  if (currentTargetCount > 5) {
    const overflow = currentTargetCount - 5;
    const holdsWithScores = holds.map(h => {
      const scoreRow = topScoring.find(t => t.ticker === h.ticker);
      return { hold: h, score: scoreRow ? scoreRow.ranking_score : 0 };
    });
    holdsWithScores.sort((a, b) => a.score - b.score);

    const strongestNewcomer = buys.length > 0 ? buys[0].ticker : "yeni fırsatlar";
    
    for (let i = 0; i < overflow; i++) {
      const weakest = holdsWithScores[i].hold;
      const idx = holds.indexOf(weakest);
      if (idx !== -1) holds.splice(idx, 1);
      
      sells.push({
        ticker: weakest.ticker,
        action: 'SELL',
        reason: `Hisse güçlü ancak ${strongestNewcomer}'a yer açmak için feda edildi.`
      });
    }
  }

  const finalSignals = [...buys, ...holds, ...sells];

  if (finalSignals.length === 0) {
    signalsListEl.innerHTML = `<p style="color:var(--text-muted); font-size:11px; font-style:italic;">Haftalık rebalans kararı bulunmuyor.</p>`;
  } else {
    finalSignals.forEach(sig => {
      const colorMap = { BUY: 'var(--success)', SELL: 'var(--danger)', HOLD: 'var(--secondary)' };
      const labelMap = { BUY: 'AL', SELL: 'SAT', HOLD: 'TUT' };

      const row = document.createElement('div');
      row.className = 'list-item-row';
      row.style.borderBottom = 'none';
      row.style.padding = '8px 0';
      row.innerHTML = `
        <div>
          <div style="font-weight:700; font-size:12px;">${sig.ticker}</div>
          <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">${sig.reason}</div>
        </div>
        <div style="font-weight:900; font-size:12px; color:${colorMap[sig.action]}">${labelMap[sig.action]}</div>
      `;
      row.addEventListener('click', () => openStockDetail(sig.ticker));
      signalsListEl.appendChild(row);
    });
  }
}

// --- PAGE 2: BROWSE ---
let currentFilterMode = 'ALL';

function setupBrowseFilters() {
  const pills = document.querySelectorAll('.filter-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilterMode = pill.getAttribute('data-mode');
      renderBrowsePage();
    });
  });

  document.getElementById('browse-search').addEventListener('input', renderBrowsePage);
  document.getElementById('filter-sector').addEventListener('change', renderBrowsePage);
  document.getElementById('filter-risk').addEventListener('change', renderBrowsePage);
  document.getElementById('filter-sort').addEventListener('change', renderBrowsePage);
}

function populateSectorDropdown() {
  const sectors = queryAll('SELECT DISTINCT sector FROM scoring_latest WHERE sector IS NOT NULL ORDER BY sector');
  const dropdown = document.getElementById('filter-sector');
  dropdown.innerHTML = '<option value="">Sektör: Tümü</option>';
  sectors.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.sector;
    opt.textContent = s.sector;
    dropdown.appendChild(opt);
  });
}

function renderBrowsePage() {
  const searchVal = document.getElementById('browse-search').value.trim().toUpperCase();
  const sectorVal = document.getElementById('filter-sector').value;
  const riskVal = document.getElementById('filter-risk').value;
  const sortVal = document.getElementById('filter-sort').value;

  let query = `SELECT * FROM scoring_latest WHERE is_active = 1`;
  const params = {};

  if (currentFilterMode === 'ALPHA_CORE') {
    query += ` AND alpha_core_eligible = 1`;
  } else if (currentFilterMode === 'ALPHA_X') {
    query += ` AND alpha_x_eligible = 1`;
  } else if (currentFilterMode === 'RESEARCH') {
    query += ` AND (alpha_research_bucket = 'QualityShadow' OR alpha_research_bucket = 'FreeFloatShadow' OR alpha_research_bucket = 'NonCoreResearch')`;
  }

  if (searchVal) {
    query += ` AND (ticker LIKE :search OR name LIKE :search)`;
    params[':search'] = `%${searchVal}%`;
  }

  if (sectorVal) {
    query += ` AND sector = :sector`;
    params[':sector'] = sectorVal;
  }

  if (riskVal) {
    query += ` AND risk = :risk`;
    params[':risk'] = riskVal;
  }

  if (sortVal === 'SCORE_DESC') {
    query += ` ORDER BY ranking_score DESC`;
  } else if (sortVal === 'TICKER_ASC') {
    query += ` ORDER BY ticker ASC`;
  } else if (sortVal === 'RISK_ASC') {
    query += ` ORDER BY CASE risk WHEN 'LOW' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END ASC`;
  }

  const rows = queryAll(query, params);
  const listEl = document.getElementById('browse-list');
  listEl.innerHTML = '';

  if (rows.length === 0) {
    listEl.innerHTML = `<p style="color:var(--text-muted); font-size:12px; text-align:center; padding:32px;">Hisse bulunamadı.</p>`;
    return;
  }

  rows.forEach(row => {
    const alphaVal = row.alpha || 0.0;
    const riskText = row.risk || 'UNKNOWN';
    const alphaClass = alphaVal >= 0 ? 'pos-text' : 'neg-text';

    const item = document.createElement('div');
    item.className = 'list-item-row';
    item.innerHTML = `
      <div>
        <div class="ticker-block">
          <span class="ticker-name">${row.ticker}</span>
        </div>
        <div class="company-fullname">${row.name || '—'}</div>
      </div>
      <div style="text-align: right;">
        <div class="${alphaClass} tabular-nums" style="font-weight: 800; font-size: 14px;">
          ${alphaVal >= 0 ? '+' : ''}${alphaVal.toFixed(1)}%
        </div>
        <div style="font-size: 10px; color: var(--text-muted); font-weight: bold; margin-top:2px;">
          ${riskText} RİSK
        </div>
      </div>
    `;
    item.addEventListener('click', () => openStockDetail(row.ticker));
    listEl.appendChild(item);
  });
}

// --- PAGE 3: MARKET (Macro Indicators) ---
function renderMarketPage() {
  const home = queryOne('SELECT * FROM home_summary WHERE id = 1');
  if (!home) return;

  const policyRate = home.policy_rate_pct || 0.0;
  const inflation = home.cpi_yoy_pct || 0.0;
  const realYield = policyRate - inflation;
  const isPositive = realYield > 0;

  document.getElementById('macro-policy-rate').textContent = `${(policyRate * 100).toFixed(1)}%`;
  document.getElementById('macro-inflation').textContent = `${(inflation * 100).toFixed(1)}%`;
  
  const yieldValEl = document.getElementById('macro-real-yield-val');
  const yieldBadgeEl = document.getElementById('macro-real-yield-badge');
  const yieldPinEl = document.getElementById('macro-yield-pin');
  const yieldDescEl = document.getElementById('macro-yield-desc');

  yieldValEl.textContent = `${realYield >= 0 ? '+' : ''}${(realYield * 100).toFixed(2)}%`;
  yieldValEl.className = `yield-value ${isPositive ? 'pos-text' : 'neg-text'}`;

  if (isPositive) {
    yieldBadgeEl.textContent = 'POZİTİF REEL';
    yieldBadgeEl.style.backgroundColor = 'rgba(34, 197, 94, 0.15)';
    yieldBadgeEl.style.color = 'var(--success)';
    yieldDescEl.textContent = "Pozitif Reel Faiz: Nakit ve risksiz mevduat getirileri enflasyon karşısında değerini korur. Seçici hisse yatırımları sürdürülmelidir.";
  } else {
    yieldBadgeEl.textContent = 'NEGATİF REEL';
    yieldBadgeEl.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    yieldBadgeEl.style.color = 'var(--danger)';
    yieldDescEl.textContent = "Negatif Reel Faiz: Nakit ve mevduat tutmak reel değer kaybı yaratır. Hisse senetleri ve reel varlıklar enflasyona karşı doğal korumadır.";
  }

  // Pin slider calculations (clamped between -15% and +15%)
  const clampedYield = Math.max(-0.15, Math.min(0.15, realYield));
  const pinPercent = ((clampedYield + 0.15) / 0.30) * 100;
  yieldPinEl.style.left = `${pinPercent}%`;
  yieldPinEl.style.borderColor = isPositive ? 'var(--success)' : 'var(--danger)';

  // Cash allocation split bar
  const cashState = home.cash_state || 'NORMAL';
  const cashPct = home.cash_pct || 0.0;
  const targetState = home.cash_target_state || 'NORMAL';
  
  const stateColorMap = {
    NORMAL: 'var(--success)',
    CAUTION: 'var(--warning)',
    DEFENSIVE: 'var(--warning)',
    RISK_OFF: 'var(--danger)'
  };
  const labelMap = {
    NORMAL: 'NORMAL (Hisse Ağırlıklı)',
    CAUTION: 'İHTİYAT (Seçici Nakit)',
    DEFENSIVE: 'SAVUNMA (Yüksek Nakit)',
    RISK_OFF: 'RİSK DIŞI (Tam Nakit)'
  };

  const cashStateEl = document.getElementById('macro-cash-state');
  cashStateEl.textContent = labelMap[cashState] || cashState;
  cashStateEl.style.color = stateColorMap[cashState] || 'var(--text)';

  document.getElementById('macro-cash-target').textContent = targetState;
  document.getElementById('macro-cash-split').textContent = `${(cashPct * 100).toFixed(0)}% Nakit / ${((1 - cashPct) * 100).toFixed(0)}% Hisse`;
  
  const cashProgress = document.getElementById('macro-cash-progress');
  cashProgress.style.width = `${cashPct * 100}%`;
  cashProgress.style.backgroundColor = stateColorMap[cashState] || 'var(--primary)';

  const notesEl = document.getElementById('macro-cash-notes');
  if (home.cash_notes) {
    notesEl.textContent = home.cash_notes;
    notesEl.style.display = 'block';
  } else {
    notesEl.style.display = 'none';
  }

  // Piyasa rejimi
  const regimeEl = document.getElementById('macro-regime');
  regimeEl.textContent = home.regime || '—';
  regimeEl.style.color = home.regime === 'RISK_ON' ? 'var(--success)' : 'var(--danger)';
  document.getElementById('macro-usdtry').textContent = `${(home.usdtry_rate || 0).toFixed(4)} TL`;
}

// --- PAGE 4: HISTORY ---
function renderHistoryPage() {
  const dbPos = queryAll('SELECT * FROM open_positions');
  const records = updateActiveWeek(dbPos, window.livePrices);

  // Cumulative performance math
  let cumPort = 1.0;
  let cumBist = 1.0;
  records.forEach(rec => {
    cumPort *= (1.0 + rec.portfolioReturn);
    cumBist *= (1.0 + rec.bist100Return);
  });

  const totalPort = (cumPort - 1.0) * 100;
  const totalBist = (cumBist - 1.0) * 100;
  const alpha = totalPort - totalBist;

  const startDate = records[0]?.weekStartDate || "2026-05-18";
  document.getElementById('history-start-date').textContent = `Başlangıç: ${formatDateToTurkish(startDate)}`;

  const portEl = document.getElementById('history-total-port');
  portEl.textContent = `${totalPort >= 0 ? '+' : ''}${totalPort.toFixed(2)}%`;
  portEl.className = `value ${totalPort >= 0 ? 'pos-text' : 'neg-text'}`;

  const bistEl = document.getElementById('history-total-bist');
  bistEl.textContent = `${totalBist >= 0 ? '+' : ''}${totalBist.toFixed(2)}%`;
  bistEl.className = `value ${totalBist >= 0 ? 'pos-text' : 'neg-text'}`;

  const alphaEl = document.getElementById('history-total-alpha');
  alphaEl.textContent = `Endekse Karşı Fark: ${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%`;
  alphaEl.style.backgroundColor = alpha >= 0 ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)';
  alphaEl.style.color = alpha >= 0 ? 'var(--success)' : 'var(--danger)';

  // CANLI TAKİP active week check
  const hasActive = records.some(r => !r.isCompleted);
  document.getElementById('live-tracking-badge').style.display = hasActive ? 'inline-flex' : 'none';

  // Render list of weekly rows
  const listEl = document.getElementById('weekly-history-list');
  listEl.innerHTML = '';

  records.slice().reverse().forEach(rec => {
    const diff = (rec.portfolioReturn - rec.bist100Return) * 100;
    const diffClass = diff >= 0 ? 'pos-text' : 'neg-text';

    const card = document.createElement('div');
    card.className = 'collapsible-card';
    card.innerHTML = `
      <div class="collapsible-header">
        <div class="collapsible-header-left">
          <span class="collapsible-header-title">${formatDateToTurkish(rec.weekStartDate)} Haftası</span>
          <span class="collapsible-header-subtitle ${diffClass}">Haftalık Fark: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%</span>
        </div>
        <div class="collapsible-header-right">
          ${!rec.isCompleted ? '<span class="badge badge-live">AKTİF</span>' : ''}
          <span class="material-symbols-rounded icon-arrow">expand_more</span>
        </div>
      </div>
      <div class="collapsible-body">
        <div class="collapsible-body-metrics">
          <div>
            <span style="color:var(--text-muted);">Portföy Getirisi:</span>
            <strong class="${rec.portfolioReturn >= 0 ? 'pos-text' : 'neg-text'}">${(rec.portfolioReturn * 100).toFixed(2)}%</strong>
          </div>
          <div>
            <span style="color:var(--text-muted);">BIST100 Getirisi:</span>
            <strong class="${rec.bist100Return >= 0 ? 'pos-text' : 'neg-text'}">${(rec.bist100Return * 100).toFixed(2)}%</strong>
          </div>
        </div>
        <div style="border-top:1px dashed var(--outline); padding-top:10px;">
          <div style="font-size:9px; font-weight:800; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">SEÇİLEN HİSSELER VE GETİRİLERİ</div>
          <div id="history-details-${rec.weekStartDate}" class="spaced-y"></div>
        </div>
      </div>
    `;

    // Collapsible click trigger
    card.querySelector('.collapsible-header').addEventListener('click', () => {
      card.classList.toggle('open');
    });

    listEl.appendChild(card);

    // Populate positions
    const detailsContainer = document.getElementById(`history-details-${rec.weekStartDate}`);
    if (rec.positions && rec.positions.length > 0) {
      rec.positions.forEach(pos => {
        const stockPct = pos.returnPct * 100;
        const pClass = stockPct >= 0 ? 'pos-text' : 'neg-text';

        const row = document.createElement('div');
        row.className = 'stock-performance-item';
        row.innerHTML = `
          <span style="font-size:11px; font-weight:700; color:var(--text);">${pos.ticker}</span>
          <div class="tabular-nums" style="font-size:10px; color:var(--text-muted);">
            ${pos.entryPrice.toFixed(2)} → ${pos.exitPrice.toFixed(2)} TL
            <span class="${pClass}" style="font-weight:800; margin-left:8px;">${stockPct >= 0 ? '+' : ''}${stockPct.toFixed(2)}%</span>
          </div>
        `;
        detailsContainer.appendChild(row);
      });
    }
  });
}

function formatDateToTurkish(dateStr) {
  try {
    const parts = dateStr.split('-');
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  } catch (e) {
    return dateStr;
  }
}

// ==========================================================================
// 8. Stock Details Overlay Sheet (Parity Visuals & Options)
// ==========================================================================

function openStockDetail(ticker) {
  const score = queryOne('SELECT * FROM scoring_latest WHERE ticker = :ticker LIMIT 1', { ':ticker': ticker });
  if (!score) return;

  const company = queryOne('SELECT * FROM companies WHERE ticker = :ticker LIMIT 1', { ':ticker': ticker });
  const openPos = queryOne('SELECT * FROM open_positions WHERE ticker = :ticker LIMIT 1', { ':ticker': ticker });
  
  // Basic Headers
  document.getElementById('detail-ticker').textContent = ticker;
  document.getElementById('detail-name').textContent = score.name || company?.name || '—';
  document.getElementById('detail-in-portfolio-badge').style.display = openPos ? 'inline-flex' : 'none';

  // Sectoral metadata
  const sector = score.sector || company?.sector_custom || 'Tümü';
  document.getElementById('detail-sector').textContent = sector;
  document.getElementById('detail-float').textContent = company?.free_float_pct ? `${(company.free_float_pct * 100).toFixed(1)}%` : '—';
  document.getElementById('detail-class').textContent = score.is_bist100 ? 'BIST 100' : 'BIST DIŞI';

  // Live Price and Model Score
  const livePrice = window.livePrices[ticker] || score.current_price || 1.0;
  document.getElementById('detail-price-val').textContent = `${livePrice.toFixed(2)} TL`;
  document.getElementById('detail-model-score').textContent = score.ranking_score ? score.ranking_score.toFixed(1) : '—';
  document.getElementById('detail-live-indicator').style.display = window.livePrices[ticker] ? 'inline-flex' : 'none';

  // Smart rebalance warnings
  const banner = document.getElementById('detail-signal-banner');
  const bannerText = document.getElementById('detail-signal-text');

  // Compute smart action signal specifically for this stock
  const allPositions = queryAll('SELECT * FROM open_positions');
  const top10Scoring = queryAll('SELECT * FROM scoring_latest WHERE alpha_core_eligible = 1 ORDER BY ranking_score DESC LIMIT 10');
  const openTickers = new Set(allPositions.map(p => p.ticker));
  const top12Tickers = new Set(queryAll('SELECT ticker FROM scoring_latest WHERE alpha_core_eligible = 1 ORDER BY ranking_score DESC LIMIT 12').map(t => t.ticker));

  let action = 'HOLD';
  if (!openTickers.has(ticker)) {
    if (top10Scoring.slice(0, 5).some(t => t.ticker === ticker)) action = 'BUY';
  } else {
    if (!top12Tickers.has(ticker)) action = 'SELL';
  }

  if (action === 'SELL') {
    banner.style.display = 'flex';
    banner.className = 'signal-banner';
    bannerText.textContent = 'Model Sinyali: Model kriterlerinden tamamen düştü, SATIM önerilir.';
  } else if (action === 'BUY') {
    banner.style.display = 'flex';
    banner.className = 'signal-banner pos-text';
    banner.style.backgroundColor = 'rgba(34, 197, 94, 0.08)';
    banner.style.borderColor = 'rgba(34, 197, 94, 0.2)';
    bannerText.textContent = 'Model Sinyali: ALPHA Core modeli yeni giriş listesinde, ALIM önerilir.';
  } else {
    banner.style.display = 'none';
  }

  // Price lane slider
  const stopLoss = score.stop_loss_price || 0.0;
  const targetPrice = score.target_price || 0.0;

  document.getElementById('lane-stop-label').textContent = `Stop: ${stopLoss > 0 ? stopLoss.toFixed(2) + ' TL' : '—'}`;
  document.getElementById('lane-target-label').textContent = `Hedef: ${targetPrice > 0 ? targetPrice.toFixed(2) + ' TL' : '—'}`;
  
  const laneProgressBar = document.getElementById('price-lane-progress');
  const lanePin = document.getElementById('price-lane-pin');

  if (stopLoss > 0 && targetPrice > 0) {
    const range = targetPrice - stopLoss;
    const progress = range > 0 ? ((livePrice - stopLoss) / range) * 100 : 0;
    const clampedProgress = Math.max(0, Math.min(100, progress));

    laneProgressBar.style.width = `${clampedProgress}%`;
    laneProgressBar.style.backgroundColor = (livePrice >= stopLoss) ? 'var(--success)' : 'var(--danger)';
    lanePin.style.left = `${clampedProgress}%`;
  } else {
    laneProgressBar.style.width = '0%';
    lanePin.style.left = '50%';
  }

  // Investment Thesis Bullets
  const thesisList = document.getElementById('detail-thesis-list');
  thesisList.innerHTML = '';
  
  const thesisItems = [];
  if ((score.buffett || 0) >= 0.75) thesisItems.push("Güçlü Buffett Sahip Kazanç Marjı ve istikrarlı nakit yaratımı.");
  if ((score.graham || 0) >= 0.75) thesisItems.push("Graham formülüne göre yüksek güvenlik marjı (İçsel değer iskontosu).");
  if ((score.momentum || 0) >= 0.75) thesisItems.push("Hisse fiyatı güçlü momentum ve teknik trend desteği barındırıyor.");
  if ((score.piotroski || 0) >= 7.0) thesisItems.push(`Finansal sağlık rasyoları mükemmel (Piotroski F-Score: ${score.piotroskiRaw}/9).`);
  
  if (thesisItems.length === 0) {
    thesisItems.push("Şirket genel model ağırlıkları bakımından dengeli skor yapısına sahip.");
  }
  thesisItems.forEach(t => {
    const li = document.createElement('li');
    li.textContent = t;
    thesisList.appendChild(li);
  });

  // Basic financial grids
  const metrics = queryOne('SELECT * FROM adjusted_metrics_latest WHERE company_id = :id LIMIT 1', { ':id': score.company_id });
  
  document.getElementById('fin-roe').textContent = metrics?.roe_adjusted ? `${(metrics.roe_adjusted * 100).toFixed(1)}%` : '—';
  
  const fcfVal = metrics?.free_cash_flow;
  document.getElementById('fin-fcf').textContent = fcfVal ? formatLargeMoney(fcfVal) : '—';
  
  document.getElementById('fin-eps-growth').textContent = metrics?.real_eps_growth_pct ? `${(metrics.real_eps_growth_pct * 100).toFixed(1)}%` : '—';

  // Sector benchmark card
  const bench = queryOne('SELECT * FROM sector_benchmarks WHERE sector = :sector LIMIT 1', { ':sector': sector });
  const benchText = document.getElementById('detail-benchmark-text');
  if (bench) {
    benchText.textContent = `Şirket, kendi sektöründe yer alan ${bench.company_count} aktif firma ile karşılaştırılmıştır.`;
    document.getElementById('bench-company-roe').textContent = metrics?.roe_adjusted ? `${(metrics.roe_adjusted * 100).toFixed(1)}%` : '—';
    document.getElementById('bench-sector-roe').textContent = bench.roe_median ? `${(bench.roe_median * 100).toFixed(1)}%` : '—';
    document.getElementById('bench-company-roa').textContent = metrics?.roa_adjusted ? `${(metrics.roa_adjusted * 100).toFixed(1)}%` : '—';
    document.getElementById('bench-sector-roa').textContent = bench.roa_median ? `${(bench.roa_median * 100).toFixed(1)}%` : '—';
  } else {
    benchText.textContent = 'Sektör karşılaştırma verisi bulunmuyor.';
  }

  // COLLAPSIBLE ADVANCED PARAMETERS (TAS 29)
  const auditWarningCard = document.getElementById('audit-warning-card');
  const relatedPct = metrics?.related_party_revenue_pct || 0.0;
  if (relatedPct > 0.15) {
    auditWarningCard.style.display = 'flex';
    document.getElementById('audit-related-pct').textContent = (relatedPct * 100).toFixed(1);
  } else {
    auditWarningCard.style.display = 'none';
  }

  document.getElementById('adv-reported-net').textContent = metrics?.reported_net_income ? formatLargeMoney(metrics.reported_net_income) : '—';
  document.getElementById('adv-monetary-gain').textContent = metrics?.monetary_gain_loss ? formatLargeMoney(metrics.monetary_gain_loss) : '—';
  document.getElementById('adv-adjusted-net').textContent = metrics?.adjusted_net_income ? formatLargeMoney(metrics.adjusted_net_income) : '—';

  // DCF Intrinsic
  document.getElementById('adv-dcf-intrinsic').textContent = score.dcf_intrinsic_value ? `${score.dcf_intrinsic_value.toFixed(2)} TL` : '—';
  document.getElementById('adv-dcf-growth').textContent = score.dcf_growth_rate_pct ? `${(score.dcf_growth_rate_pct * 100).toFixed(1)}%` : '—';
  document.getElementById('adv-dcf-discount').textContent = score.dcf_discount_rate_pct ? `${(score.dcf_discount_rate_pct * 100).toFixed(1)}%` : '—';
  document.getElementById('adv-dcf-mos').textContent = score.dcf_mos ? `${(score.dcf_mos * 100).toFixed(1)}%` : '—';

  // Quality Flags check
  const flagsContainer = document.getElementById('adv-quality-flags');
  flagsContainer.innerHTML = '';
  const rawFlags = score.quality_flags_json || openPos?.quality_flags_json || '[]';
  let flagsList = [];
  try {
    flagsList = JSON.parse(rawFlags);
  } catch(e) {}
  
  if (flagsList.length === 0) {
    flagsContainer.innerHTML = '<span class="flag-tag">Herhangi bir denetim riski bulunmuyor</span>';
  } else {
    flagsList.forEach(f => {
      const tag = document.createElement('span');
      tag.className = 'flag-tag';
      tag.textContent = f;
      flagsContainer.appendChild(tag);
    });
  }

  // APEXCHARTS: Price Chart (730d)
  const priceHistory = queryAll('SELECT date, close FROM price_history_730d WHERE company_id = :id ORDER BY date ASC', { ':id': score.company_id });
  renderPriceHistoryChart(priceHistory);

  // APEXCHARTS: Factor Quarterly Breakdown
  const factorHistory = queryAll('SELECT quarter_end, buffett, graham, piotroski, momentum, technical, dcf_mos FROM factor_history_quarterly WHERE company_id = :id ORDER BY quarter_end ASC', { ':id': score.company_id });
  renderFactorHistoryChart(factorHistory);

  // Open sliding sheet
  document.getElementById('detail-sheet').classList.add('open');
}

function formatLargeMoney(val) {
  const abs = Math.abs(val);
  const sign = val >= 0 ? '' : '-';
  if (abs >= 1e9) return `${sign}${(val / 1e9).toFixed(2)} Milyar TL`;
  if (abs >= 1e6) return `${sign}${(val / 1e6).toFixed(2)} Milyon TL`;
  return `${sign}${val.toLocaleString('tr-TR')} TL`;
}

// Render Apex Price Chart
function renderPriceHistoryChart(history) {
  if (priceChartInstance) priceChartInstance.destroy();
  if (history.length === 0) return;

  const data = history.map(h => ({ x: new Date(h.date).getTime(), y: h.close }));

  const options = {
    series: [{ name: 'Fiyat', data: data }],
    chart: { type: 'area', height: 220, toolbar: { show: false }, background: 'transparent' },
    colors: ['#FFB48A'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 90, 100] }
    },
    grid: { show: true, borderColor: '#1F1F23', strokeDashArray: 4 },
    xaxis: { type: 'datetime', labels: { style: { colors: '#B5B5B2', fontSize: '9px' } } },
    yaxis: { labels: { style: { colors: '#B5B5B2', fontSize: '9px' }, formatter: val => val.toFixed(1) } },
    theme: { mode: 'dark' }
  };

  priceChartInstance = new ApexCharts(document.getElementById('detail-price-chart'), options);
  priceChartInstance.render();
}

// Render Apex Factor Line Chart
function renderFactorHistoryChart(history) {
  if (factorChartInstance) factorChartInstance.destroy();
  if (history.length === 0) return;

  const categories = history.map(h => h.quarter_end);
  const buffettSeries = history.map(h => (h.buffett || 0.0) * 100);
  const grahamSeries = history.map(h => (h.graham || 0.0) * 100);
  const piotroskiSeries = history.map(h => ((h.piotroski || 0.0) / 9.0) * 100);
  const momentumSeries = history.map(h => (h.momentum || 0.0) * 100);
  const dcfSeries = history.map(h => (h.dcf_mos || 0.0) * 100);

  const options = {
    series: [
      { name: 'Buffett', data: buffettSeries },
      { name: 'Graham', data: grahamSeries },
      { name: 'Piotroski', data: piotroskiSeries },
      { name: 'Momentum', data: momentumSeries },
      { name: 'DCF (MOS)', data: dcfSeries }
    ],
    chart: { type: 'line', height: 220, toolbar: { show: false }, background: 'transparent' },
    colors: ['#FFB48A', '#7DD3FC', '#A78BFA', '#22C55E', '#EAB308'],
    stroke: { curve: 'smooth', width: 2 },
    grid: { borderColor: '#1F1F23', strokeDashArray: 4 },
    xaxis: { categories: categories, labels: { style: { colors: '#B5B5B2', fontSize: '9px' } } },
    yaxis: { max: 100, min: 0, labels: { style: { colors: '#B5B5B2', fontSize: '9px' }, formatter: val => `${val.toFixed(0)}%` } },
    legend: { position: 'bottom', horizontalAlign: 'center', fontSize: '10px', labels: { colors: '#F5F5F4' } },
    theme: { mode: 'dark' }
  };

  factorChartInstance = new ApexCharts(document.getElementById('detail-factor-chart'), options);
  factorChartInstance.render();
}

// ==========================================================================
// 9. Backtesting Overlay Sheet
// ==========================================================================

function openBacktestingSheet() {
  const perfPoints = queryAll('SELECT date, strategy_return, benchmark_return FROM model_performance ORDER BY date ASC');
  if (perfPoints.length === 0) return;

  // Render Apex Area Backtest Chart
  renderBacktestAreaChart(perfPoints);

  // Cumulative numbers
  const latestPoint = perfPoints[perfPoints.length - 1];
  const stratRet = latestPoint.strategy_return - 100.0;
  const benchRet = latestPoint.benchmark_return - 100.0;
  const alpha = stratRet - benchRet;

  document.getElementById('bt-nav-return').textContent = `${stratRet >= 0 ? '+' : ''}${stratRet.toFixed(1)}%`;
  document.getElementById('bt-index-return').textContent = `${benchRet >= 0 ? '+' : ''}${benchRet.toFixed(1)}%`;
  
  const alphaEl = document.getElementById('bt-alpha-banner');
  alphaEl.textContent = `10 Yıllık Model Alphası: ${alpha >= 0 ? '+' : ''}${alpha.toFixed(1)}%`;
  alphaEl.style.backgroundColor = alpha >= 0 ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)';
  alphaEl.style.color = alpha >= 0 ? 'var(--success)' : 'var(--danger)';

  // Render completed transactions list
  const closedPositions = queryAll('SELECT * FROM portfolio_history ORDER BY exit_date DESC, sort_order ASC');
  const closedListEl = document.getElementById('bt-transactions-list');
  closedListEl.innerHTML = '';

  if (closedPositions.length === 0) {
    closedListEl.innerHTML = `<p style="color:var(--text-muted); font-size:11px; font-style:italic;">Tamamlanmış işlem kaydı bulunmuyor.</p>`;
  } else {
    closedPositions.forEach(pos => {
      const pnl = pos.pnl_pct || 0.0;
      const pnlClass = pnl >= 0 ? 'pos-text' : 'neg-text';

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; font-size:11px; align-items:center;">
          <div>
            <strong style="color:var(--primary); font-size:12px;">${pos.ticker}</strong>
            <div style="font-size:9px; color:var(--text-muted); margin-top:2px;">
              ${formatDateToTurkish(pos.selection_date)} - ${formatDateToTurkish(pos.exit_date)} (${pos.holding_days} Gün)
            </div>
          </div>
          <div style="text-align:right;">
            <strong class="${pnlClass} tabular-nums" style="font-size:12px;">${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%</strong>
            <div style="font-size:8px; color:var(--text-muted); margin-top:2px;">${pos.exit_reason || 'Model Değişimi'}</div>
          </div>
        </div>
      `;
      closedListEl.appendChild(card);
    });
  }

  // Open sliding sheet
  document.getElementById('backtest-sheet').classList.add('open');
}

function renderBacktestAreaChart(points) {
  if (backtestChartInstance) backtestChartInstance.destroy();
  
  const stratData = points.map(p => ({ x: new Date(p.date).getTime(), y: (p.strategy_return - 100.0) }));
  const benchData = points.map(p => ({ x: new Date(p.date).getTime(), y: (p.benchmark_return - 100.0) }));

  const options = {
    series: [
      { name: 'ALPHA Core Model', data: stratData },
      { name: 'BIST 100 Endeksi', data: benchData }
    ],
    chart: { type: 'area', height: 250, toolbar: { show: false }, background: 'transparent' },
    colors: ['#FFB48A', '#7DD3FC'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.25, opacityTo: 0.02, stops: [0, 95, 100] }
    },
    grid: { borderColor: '#1F1F23', strokeDashArray: 4 },
    xaxis: { type: 'datetime', labels: { style: { colors: '#B5B5B2', fontSize: '9px' } } },
    yaxis: { labels: { style: { colors: '#B5B5B2', fontSize: '9px' }, formatter: val => `${val.toFixed(0)}%` } },
    legend: { position: 'bottom', horizontalAlign: 'center', fontSize: '10px', labels: { colors: '#F5F5F4' } },
    theme: { mode: 'dark' }
  };

  backtestChartInstance = new ApexCharts(document.getElementById('backtest-area-chart'), options);
  backtestChartInstance.render();
}

// ==========================================================================
// 10. Application Launch Sequence (Robust Load + Failsafe Timer)
// ==========================================================================

async function initApp() {
  console.log('[BIST] Application init sequence started...');
  const statusEl = document.getElementById('splash-status');
  const progressFill = document.getElementById('splash-progress');
  const retryBtn = document.getElementById('splash-retry-btn');
  
  // 15-second failsafe timer
  const failsafeTimer = setTimeout(() => {
    if (document.getElementById('splash-screen').style.display !== 'none') {
      console.warn('[Failsafe] Load timeout triggered.');
      statusEl.innerHTML = `<span style="color:var(--danger)">❌ Yükleme zaman aşımına uğradı!</span><br/>Bağlantınızı kontrol edip tekrar deneyin.`;
      retryBtn.style.display = 'block';
    }
  }, 15000);

  try {
    statusEl.textContent = '🔍 Manifest bilgileri sorgulanıyor...';
    progressFill.style.width = '10%';
    
    let manifest = null;
    try {
      const res = await fetch('./manifest.json?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        manifest = await res.json();
        console.log('[DB] Live manifest found:', manifest.snapshot_version);
      }
    } catch(e) {
      console.warn('[DB] Could not query live manifest:', e.message);
    }

    statusEl.textContent = '🗃️ Önbellek kontrol ediliyor...';
    progressFill.style.width = '20%';
    const cached = await getCachedSnapshot();

    let rawBytes = null;
    let newManifestToCache = manifest;

    if (cached && manifest && cached.sha256 === manifest.snapshot.sha256) {
      statusEl.textContent = '📦 Önbellekteki veriler yükleniyor...';
      progressFill.style.width = '50%';
      rawBytes = cached.db_blob;
    } else if (cached && !manifest) {
      statusEl.textContent = '📴 Çevrimdışı Mod: Önbellekteki veriler yükleniyor...';
      progressFill.style.width = '50%';
      rawBytes = cached.db_blob;
      newManifestToCache = {
        exported_at: cached.exported_at,
        snapshot_version: cached.snapshot_version,
        snapshot: { sha256: cached.sha256 }
      };
    } else {
      if (!manifest) {
        throw new Error('Canlı manifest alınamadı ve önbellekte kayıtlı veri bulunmuyor!');
      }
      
      const downloadFilename = manifest.snapshot.filename || 'mobile_snapshot.db.gz';
      const downloadUrl = `./${downloadFilename}?t=${Date.now()}`;
      statusEl.textContent = '⬇️ Güncel veritabanı indiriliyor (~10MB)...';
      
      const arrayBuffer = await fetchWithProgress(downloadUrl, (percent) => {
        progressFill.style.width = `${20 + percent * 0.4}%`;
        statusEl.textContent = `⬇️ İndiriliyor: %${percent}...`;
      });
      
      statusEl.textContent = '📦 Veritabanı arşivi açılıyor...';
      progressFill.style.width = '70%';
      
      const gzBytes = new Uint8Array(arrayBuffer);
      rawBytes = pako.ungzip(gzBytes);
      
      statusEl.textContent = '💾 Veriler önbelleğe yazılıyor...';
      progressFill.style.width = '80%';
      try {
        await setCachedSnapshot({
          db_blob: rawBytes,
          sha256: manifest.snapshot.sha256,
          exported_at: manifest.exported_at,
          snapshot_version: manifest.snapshot_version
        });
      } catch(cacheErr) {
        console.warn('[DB] Failed writing database snapshot to browser IndexedDB:', cacheErr);
      }
    }

    statusEl.textContent = '⚙️ SQL veritabanı motoru başlatılıyor...';
    progressFill.style.width = '90%';
    
    const SQL = await initSqlJs({
      locateFile: filename => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${filename}`
    });
    
    dbInstance = new SQL.Database(rawBytes);
    progressFill.style.width = '100%';
    
    // Clear failsafe timer on success
    clearTimeout(failsafeTimer);
    console.log('[DB] SQL.Database initialization completed successfully!');

    // Initialize live price mocks based on database rows
    const tickers = queryAll('SELECT ticker FROM open_positions').map(p => p.ticker);
    loadSimulatedLivePrices(tickers);

    // Populate advanced dropdowns
    populateSectorDropdown();

    // Wire up dynamic events
    setupBrowseFilters();
    setupNavigation();

    // Render Home tab initially
    renderPage('picks');

    // Dismiss splash screen with minor timeout to ensure UI elements settled
    setTimeout(() => {
      document.getElementById('splash-screen').style.display = 'none';
      document.getElementById('app-content').style.display = 'flex';
    }, 400);

  } catch(err) {
    clearTimeout(failsafeTimer);
    console.error('[Launch] App start failed:', err);
    statusEl.innerHTML = `<span style="color:var(--danger)">❌ Hata: ${err.message}</span>`;
    retryBtn.style.display = 'block';
  }
}

// Document Load Listener
window.addEventListener('load', () => {
  // Wire up close buttons
  document.getElementById('close-detail-btn').addEventListener('click', () => {
    document.getElementById('detail-sheet').classList.remove('open');
  });
  
  document.getElementById('close-backtest-btn').addEventListener('click', () => {
    document.getElementById('backtest-sheet').classList.remove('open');
  });

  document.getElementById('open-backtest-btn').addEventListener('click', openBacktestingSheet);
  
  document.getElementById('refresh-db-btn').addEventListener('click', () => {
    localStorage.removeItem('bist_weekly_records');
    window.location.reload();
  });
  
  document.getElementById('splash-retry-btn').addEventListener('click', () => {
    window.location.reload();
  });

  // Collapsible toggle on details
  const advToggle = document.getElementById('detail-advanced-toggle');
  const advBody = document.getElementById('detail-advanced-body');
  const collapsibleSection = advToggle.closest('.collapsible-section');
  
  advToggle.addEventListener('click', () => {
    const isOpen = advBody.style.display !== 'none';
    if (isOpen) {
      advBody.style.display = 'none';
      collapsibleSection.classList.remove('open');
    } else {
      advBody.style.display = 'block';
      collapsibleSection.classList.add('open');
    }
  });

  // Run app
  initApp();
});
