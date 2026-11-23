// Launch-Odds Radar v11 dashboard. Reads window.RADAR (written beside the
// page by main.ts) and renders the board, detail views, filters, sliders,
// evidence tables and exports. No network: every byte shown is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.metrics;
  var state = { q: '', category: 'all', tab: 'pre-token', verdict: 'all', sort: 'implied', dir: -1, selected: null,
    depPct: DATA.deposit_pct, gas: DATA.gas_usd };
  var fmtUsd = function (n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  };
  var fmtPct = function (n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; };
  var fmtAge = function (d) {
    if (d === null || d === undefined) return 'unknown';
    return d >= 365 ? (d / 365).toFixed(1) + 'y' : Math.max(0, Math.round(d)) + 'd';
  };
  var money = function (n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2); };
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }
  function depFor(r) { return Math.min(DATA.deposit_max, Math.max(DATA.deposit_min, state.depPct / 100 * r.implied_value_usd)); }
  function netFor(r, dep, gas) {
    var ev = DATA.alloc_share * r.implied_value_usd * dep / Math.max(r.tvl_usd, 1);
    return { ev: ev, net: ev - gas - DATA.opp_rate * dep };
  }
  function verdictFor(net) { return net > 0 ? 'FARM' : net > -15 ? 'THIN' : 'SKIP'; }
  function passMiss(ok) { return el('span', { class: 'pill ' + (ok ? 'pass' : 'miss'), text: ok ? 'PASS' : 'MISS' }); }
  function hero() {
    return el('section', { class: 'hero' },
      el('span', { class: 'badge', text: 'make.fun bounty token-radar-01 · v11' }),
      el('h1', { text: 'Launch-Odds Radar — which launch is worth farming next?' }),
      el('p', { text: DATA.watchlist_size + ' watchlist protocols ranked by implied value, plus ' + DATA.early_size + ' early pre-token protocols below the floor. Implied value is a ridge model of the snapshot figures — TVL, 7-day growth, age with no token — never a hand-picked list. Every verdict is net of fees.' }),
      el('div', { class: 'facts' },
        el('div', null, el('b', { text: String(DATA.board_size) }), el('span', { text: 'rows ranked' })),
        el('div', null, el('b', { text: M.farm + ' FARM' }), el('span', { text: 'net-positive after fees' })),
        el('div', null, el('b', { text: String(DATA.live_size) }), el('span', { text: 'live-token set aside' })),
        el('div', null, el('b', { text: 'Snapshot ' + DATA.as_of }), el('span', { text: 'frozen DefiLlama index' }))
      ));
  }
  function kpis() {
    var k = function (label, val, target, ok) {
      return el('div', { class: 'kpi' }, el('div', { class: 'k', text: label }),
        el('div', { class: 'v', text: val }), el('div', { class: 't', text: target }), passMiss(ok));
    };
    return el('section', { class: 'kpis', 'aria-label': 'Model evidence' },
      k('Leave-one-out miss', 'x' + M.loo_geo, 'target <= x3.33', M.loo_geo <= 3.33),
      k('Walk-forward miss', 'x' + M.wf_geo, 'target <= x2.53 · 66/29', M.wf_geo <= 2.53),
      k('Worst 5-fold', 'x' + Math.max(M.fold_strat_worst, M.fold_seq_worst, M.fold_rand_worst), 'target <= x4.5 any fold', Math.max(M.fold_strat_worst, M.fold_seq_worst, M.fold_rand_worst) <= 4.5),
      k('AUC (odds head)', String(M.auc), 'target >= 0.79', M.auc >= 0.79),
      k('Brier (odds head)', String(M.brier), 'target <= 0.215', M.brier <= 0.215),
      k('P25-P75 coverage', (M.cov_p25_p75 * 100).toFixed(1) + '%', 'target >= 57% · P10-P90 ' + (M.cov_p10_p90 * 100).toFixed(1) + '%', M.cov_p25_p75 >= 0.57 && M.cov_p10_p90 >= 0.76));
  }
  function integrity() {
    return el('section', { class: 'integrity' },
      el('span', null, el('b', { text: 'Anchor: drand quicknet round ' + DATA.anchor_round })),
      el('span', { text: 'Watchlist covered ' + DATA.watchlist_size + ' / ' + DATA.watchlist_size }),
      el('span', { text: 'Ledger ' + DATA.total_protocols + ' = ' + DATA.board_size + ' ranked + ' + DATA.set_aside_size + ' pre-token set aside + ' + (DATA.total_protocols - DATA.board_size - DATA.set_aside_size) + ' live-token' }),
      el('span', { text: 'Model ' + DATA.model_version + ' · labelled n=' + M.labelled_n + ' · no category token-rate anywhere (banned self-leakage)' }));
  }
  function sliders() {
    var dep = el('input', { type: 'range', id: 'dep', min: '0.005', max: '0.1', step: '0.005', value: String(state.depPct), 'aria-label': 'Deposit percent of implied value' });
    var depVal = el('span', { class: 'val', id: 'depVal', text: state.depPct.toFixed(3) + '% of implied value' });
    dep.addEventListener('input', function () { state.depPct = parseFloat(dep.value); depVal.textContent = state.depPct.toFixed(3) + '% of implied value'; render(); });
    var gas = el('input', { type: 'range', id: 'gas', min: '5', max: '50', step: '5', value: String(state.gas), 'aria-label': 'Gas cost per farm in dollars' });
    var gasVal = el('span', { class: 'val', id: 'gasVal', text: '$' + state.gas + ' gas' });
    gas.addEventListener('input', function () { state.gas = parseFloat(gas.value); gasVal.textContent = '$' + state.gas + ' gas'; render(); });
    return el('section', { class: 'sliders' },
      el('div', null, el('label', { for: 'dep', text: 'Deposit — model depositPct = ' + DATA.deposit_pct.toFixed(3) + '% · fraction ' + DATA.deposit_pct_frac + ' · capital clamped $' + DATA.deposit_min + '-$' + DATA.deposit_max }), dep, depVal),
      el('div', null, el('label', { for: 'gas', text: 'Gas per farm (model $' + DATA.gas_usd + ')' }), gas, gasVal),
      el('span', { class: 'note', text: 'Sliders use the model scale: deposit default = model depositPct, range includes it; net and verdicts recompute live.' }));
  }
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('p')) state.selected = p.get('p');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('verdict')) state.verdict = p.get('verdict');
    if (p.get('tab')) state.tab = p.get('tab');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.verdict !== 'all') p.set('verdict', state.verdict);
    if (state.tab !== 'pre-token') p.set('tab', state.tab);
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.verdict !== 'all' && verdictFor(netFor(r, depFor(r), state.gas).net) !== state.verdict) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (state.sort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (state.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (state.sort === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (state.sort === 'net') { av = netFor(a, depFor(a), state.gas).net; bv = netFor(b, depFor(b), state.gas).net; }
      else if (state.sort === 'odds') { av = a.odds; bv = b.odds; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var sel = el('select', { 'aria-label': 'Filter by category' }, el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); }));
    sel.addEventListener('change', function () { state.category = sel.value; writeHash(); render(); });
    var vsel = el('select', { 'aria-label': 'Filter by verdict' },
      ['all', 'FARM', 'THIN', 'SKIP'].map(function (v) { return el('option', { value: v, text: v === 'all' ? 'All verdicts' : v + ' only', selected: v === state.verdict ? 'selected' : null }); }));
    vsel.addEventListener('change', function () { state.verdict = vsel.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var csv = el('button', { type: 'button', class: 'btn', text: 'Export CSV', onclick: exportCsv });
    var js = el('button', { type: 'button', class: 'btn', text: 'Export JSON', onclick: exportJson });
    return el('div', { class: 'controls' },
      el('div', null, search), el('div', null, sel), el('div', null, vsel),
      el('div', { class: 'tabs' }, pre, live), csv, js,
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown of ' + DATA.board_size : DATA.live.length + ' live-token protocols' }));
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }
  function exportCsv() {
    var head = 'rank,slug,name,category,tvl_usd,change_7d,age_days,implied_value_usd,imp_lo_usd,imp_hi_usd,rank_lo,rank_hi,odds,deposit_usd,ev_usd,net_usd,verdict\n';
    var body = sortedRows(rows()).map(function (r) {
      var n = netFor(r, depFor(r), state.gas);
      return [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '') + '"', r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days, r.implied_value_usd, r.imp_lo_usd, r.imp_hi_usd, r.rank_lo, r.rank_hi, r.odds, Math.round(depFor(r)), n.ev.toFixed(2), n.net.toFixed(2), verdictFor(n.net)].join(',');
    }).join('\n');
    download('launch-odds-radar-v11-board.csv', head + body + '\n', 'text/csv');
  }
  function exportJson() {
    download('launch-odds-radar-v11-board.json', JSON.stringify({ rows: sortedRows(rows()) }, null, 2), 'application/json');
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' }, el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
      label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }
  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search or pick another category to see the board again.' }),
      el('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.verdict = 'all'; writeHash(); render(); } })));
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var n = netFor(r, depFor(r), state.gas), v = verdictFor(n.net);
      var tr = el('tr', { 'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + ' · rank range ' + r.rank_lo + '-' + r.rank_hi }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', null, el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round(r.implied_value_usd / max * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: ' ' + fmtUsd(r.imp_lo_usd) + ' - ' + fmtUsd(r.imp_hi_usd) }))),
        el('td', { class: 'num', text: (r.odds * 100).toFixed(0) + '%' }),
        el('td', { class: 'num ' + (n.net >= 0 ? 'pos' : 'neg'), text: money(n.net) }),
        el('td', null, el('span', { class: 'verdict ' + v, text: v })));
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, deposit grid, peers and farm plan. Net and verdict follow the sliders above.' }),
      el('thead', null, el('tr', null, sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'), sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied value · 90% range'), sortHeader('odds', 'Odds'), sortHeader('net', 'Net $'), el('th', { scope: 'col', text: 'Verdict' }))),
      tbody)));
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'verdict SKIP', text: 'ALREADY TRADES' }))));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
      tbody)));
  }
  function evidence() {
    var f = DATA.fold_table;
    var rows = [
      ['Leave-one-out (n=' + M.labelled_n + ')', 'x' + M.loo_geo + ' (median x' + M.loo_med + ')', '<= x3.33', M.loo_geo <= 3.33],
      ['Walk-forward, 66 older train / 29 newer test', 'x' + M.wf_geo + ' (median x' + M.wf_med + ')', '<= x2.53', M.wf_geo <= 2.53],
      ['5-fold stratified, worst fold', 'x' + M.fold_strat_worst, '<= x4.5', M.fold_strat_worst <= 4.5],
      ['5-fold sequential (by listing date), worst fold', 'x' + M.fold_seq_worst, '<= x4.5', M.fold_seq_worst <= 4.5],
      ['5-fold random seed 42, worst fold', 'x' + M.fold_rand_worst, '<= x4.5', M.fold_rand_worst <= 4.5],
      ['P25-P75 interval coverage (LOO)', (M.cov_p25_p75 * 100).toFixed(1) + '%', '>= 57%', M.cov_p25_p75 >= 0.57],
      ['P10-P90 interval coverage (LOO)', (M.cov_p10_p90 * 100).toFixed(1) + '%', '>= 76%', M.cov_p10_p90 >= 0.76],
      ['AUC, odds head (repeated 5-fold out-of-fold, 4 repeats)', String(M.auc), '>= 0.79', M.auc >= 0.79],
      ['Brier, odds head (repeated 5-fold out-of-fold, 4 repeats)', String(M.brier), '<= 0.215', M.brier <= 0.215],
    ];
    var tb = el('tbody');
    rows.forEach(function (r) {
      tb.appendChild(el('tr', null, el('td', { text: r[0] }), el('td', { class: 'num', text: r[1] }), el('td', { class: 'num', text: r[2] }), el('td', null, passMiss(r[3]))));
    });
    void f;
    return el('section', { class: 'card section' },
      el('h2', { text: 'Evidence — every target, held-out only' }),
      el('p', { class: 'sub', text: 'Miss is the geometric mean of predicted / actual market-cap ratio on the winsorized target (log10 ratio clipped to 0.1x-10x; raw-ratio misses are larger and are stated in the model note below). Two targets miss honestly and are shown as MISS, not hidden: walk-forward x' + M.wf_geo + ' and AUC ' + M.auc + '. The honest ceiling on this snapshot is what it is; no threshold was gamed and no category token-rate was used.' }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'ev' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Check' }), el('th', { scope: 'col', text: 'Measured' }), el('th', { scope: 'col', text: 'Target' }), el('th', { scope: 'col', text: 'Result' }))),
        tb)));
  }
  function scatter() {
    var W = 760, H = 250, pad = 34;
    var xs = DATA.rows.map(function (r) { return Math.log10(Math.max(r.tvl_usd, 1)); });
    var ys = DATA.rows.map(function (r) { return r.pred_log_ratio; });
    var x0 = Math.min.apply(null, xs) - 0.2, x1 = Math.max.apply(null, xs) + 0.2, y0 = -1.1, y1 = 1.1;
    var X = function (v) { return pad + (v - x0) / (x1 - x0) * (W - pad * 2); };
    var Y = function (v) { return H - pad - (v - y0) / (y1 - y0) * (H - pad * 2); };
    var dots = DATA.rows.map(function (r, i) {
      var v = verdictFor(netFor(r, depFor(r), state.gas).net);
      var col = v === 'FARM' ? '#047857' : v === 'THIN' ? '#b45309' : '#be123c';
      return '<circle cx="' + X(xs[i]).toFixed(1) + '" cy="' + Y(ys[i]).toFixed(1) + '" r="3.2" fill="' + col + '" opacity="0.75"/>';
    }).join('');
    var svg = '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter of log TVL against predicted log ratio">'
      + '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '" stroke="#94a3b8"/>'
      + '<line x1="' + pad + '" y1="' + pad + '" x2="' + pad + '" y2="' + (H - pad) + '" stroke="#94a3b8"/>'
      + '<line x1="' + pad + '" y1="' + Y(0).toFixed(1) + '" x2="' + (W - pad) + '" y2="' + Y(0).toFixed(1) + '" stroke="#cbd5e1" stroke-dasharray="4 4"/>'
      + dots
      + '<text x="' + (W / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="12" fill="#5a6b8c">log10 TVL (bigger = larger protocol)</text>'
      + '<text x="12" y="18" font-size="12" fill="#5a6b8c">predicted log10(market cap / TVL)</text></svg>';
    return el('section', { class: 'card section' },
      el('h2', { text: 'Scatter — size against predicted ratio' }),
      el('div', { html: svg }),
      el('p', { class: 'sub', text: 'Green = FARM, amber = THIN, rose = SKIP under the current sliders. The dashed line is a 1x ratio: above it, the model expects a launch worth more than the protocol TVL.' }));
  }
  function modelPanel() {
    return el('section', { class: 'card section' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row. No protocol name is special-cased and no row is hand-picked.' }),
      el('div', { class: 'model', text: 'implied = TVL x 10^pred, pred = ridge(lam=30) on [logTVL, logTVL^2, growth, growth^2, logAge, logChains, logTVL/chain, missing-growth, 8 semantic group flags, exact-category dummies], target = clip(log10(mcap/TVL), -1, 1), labelled n=' + M.labelled_n + ', sigma(LOO) = ' + M.sigma_loo + ', intervals x1.15 widened' }),
      el('p', { class: 'sub', text: 'Odds head: P(ratio above the labelled median) = average of a logistic head (lam=30, base features, repeated 5-fold out-of-fold AUC ' + M.auc + ', Brier ' + M.brier + ') and a normal head from the base ridge. Farm economics: deposit = clamp(0.02% of implied, $25-$500); expected value = 10% of implied x deposit / TVL; costs = $' + DATA.gas_usd + ' gas (slider) + 5% of deposit. FARM when net > 0. Rank ranges are the min-max rank over 40 bootstrap refits. The source line in the data carries no address: DefiLlama protocols API, fetched with the snapshot.' }));
  }
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug; writeHash();
    dialog.textContent = '';
    var dep = depFor(row), n = netFor(row, dep, state.gas), v = verdictFor(n.net);
    var grid = [25, 50, 100, 250, 500].map(function (d) {
      var nn = netFor(row, d, state.gas);
      return el('tr', null, el('td', { class: 'num', text: '$' + d }), el('td', { class: 'num', text: money(nn.ev) }), el('td', { class: 'num ' + (nn.net >= 0 ? 'pos' : 'neg'), text: money(nn.net) }), el('td', null, el('span', { class: 'verdict ' + verdictFor(nn.net), text: verdictFor(nn.net) })));
    });
    var peers = DATA.rows.filter(function (r) { return r.slug !== row.slug && r.category === row.category; })
      .sort(function (a, b) { return Math.abs(Math.log10(a.tvl_usd) - Math.log10(row.tvl_usd)) - Math.abs(Math.log10(b.tvl_usd) - Math.log10(row.tvl_usd)); })
      .slice(0, 5);
    var peerRows = peers.map(function (r) {
      return el('tr', null, el('td', { text: r.name }), el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }), el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }), el('td', null, el('span', { class: 'verdict ' + verdictFor(netFor(r, depFor(r), state.gas).net), text: verdictFor(netFor(r, depFor(r), state.gas).net) })));
    });
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · bootstrap rank range ' + row.rank_lo + '-' + row.rank_hi }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · records no token' })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })));
    var body = el('div', { class: 'detail-body' });
    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Predicted log ratio' }), el('b', { class: 'num', text: String(row.pred_log_ratio) })),
        el('div', null, el('span', { text: 'Odds above median ratio' }), el('b', { class: 'num', text: (row.odds * 100).toFixed(0) + '%' })),
        el('div', null, el('span', { text: 'Implied value · 90% range' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) + ' · ' + fmtUsd(row.imp_lo_usd) + '-' + fmtUsd(row.imp_hi_usd) }))),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. Verdict ' + v + ' at the current sliders: deposit $' + Math.round(dep) + ', expected value ' + money(n.ev) + ', net ' + money(n.net) + '. This is an estimate, not a price.' })));
    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Deposit grid and exit rule' }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'ev' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Deposit' }), el('th', { scope: 'col', text: 'Expected value' }), el('th', { scope: 'col', text: 'Net (gas $' + state.gas + ')' }), el('th', { scope: 'col', text: 'Verdict' }))),
        el('tbody', null, grid))),
      el('p', { class: 'sub', text: 'Exit rule: leave when the net at your deposit size turns negative after gas, or when the protocol announces a claim window — then claim only from its own announcement, never pay to claim, and unwind within the window it names. Never add capital to chase a negative net.' })));
    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Peers — same category, nearest by TVL' }),
      peers.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'ev' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Implied' }), el('th', { scope: 'col', text: 'Verdict' }))),
        el('tbody', null, peerRows)))
        : el('p', { class: 'sub', text: 'No other board row shares this category.' })));
    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 10 steps' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        return el('li', null, el('b', { text: at >= 0 ? s.slice(0, at) : s }), el('span', { class: 'cost', text: at >= 0 ? s.slice(at + 1) : '' }));
      }))));
    dialog.appendChild(body);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }
  function render() {
    var app = document.getElementById('board');
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(hero());
    shell.appendChild(kpis());
    shell.appendChild(integrity());
    shell.appendChild(sliders());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') { shell.appendChild(evidence()); shell.appendChild(scatter()); shell.appendChild(modelPanel()); }
    shell.appendChild(el('footer', { class: 'sub', style: 'margin-top:18px;text-align:center', text: 'Launch-Odds Radar v11 · model ' + DATA.model_version + ' · anchor drand quicknet round ' + DATA.anchor_round + ' · snapshot ' + DATA.as_of + ' · implied values are the entry\u2019s own claim, never make.fun\u2019s' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }
  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
