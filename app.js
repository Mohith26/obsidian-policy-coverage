import {
  ROUTES, ROUTE_ORDER, enforces, enumeratePaths, replayEvents, usageCounts, closurePlan, bypassAfter, governCost,
} from './core/coverage.js';

const D = window.COVERAGE_DATA;
const W = D.world;
const $ = (id) => document.getElementById(id);
const P = Object.fromEntries(W.people.map((p) => [p.id, p]));
const A = Object.fromEntries(W.agents.map((a) => [a.id, a]));
const C = Object.fromEntries(W.connections.map((c) => [c.id, c]));
const R = Object.fromEntries(W.resources.map((r) => [r.id, r]));
const POL = Object.fromEntries(W.policies.map((p) => [p.id, p]));
const APP = { Salesforce: ['#00a1e0', 'sf'], Snowflake: ['#29b5e8', '*'], 'Google Drive': ['#1fa463', 'G'], Slack: ['#4a154b', '#'], GitHub: ['#181717', 'gh'], Workday: ['#f38b00', 'W'], Databricks: ['#ff3621', 'D'], Notion: ['#111', 'N'] };
const ACTION = { read: 'Read', export: 'Bulk export', update: 'Update', write: 'Write / push', delete: 'Delete', share_external: 'Share externally', grant_admin: 'Grant admin' };
const DAY = 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtTs = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`; };
const fmtDay = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const cube = `<svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2l9 5-9 5-9-5z" fill="#ff5fa2"/><path d="M3 7l9 5v10l-9-5z" fill="#3fb6ff"/><path d="M21 7l-9 5v10l9-5z" fill="#4ad66d"/><path d="M12 12l9-5v4l-9 5z" fill="#ffb02e" opacity=".85"/></svg>`;
const appDot = (app) => { const [bg, t] = APP[app] || ['#888', '?']; return `<span class="dot" style="background:${bg}">${t}</span>`; };
const decisionChip = (d) => (d === 'approval' ? '<span class="out approval">Require approval</span>' : '<span class="out block">Block</span>');
const routeChip = (route, decision) => {
  const partial = ROUTES[route].governs && decision && !enforces(route, decision);
  const cls = !ROUTES[route].governs ? 'route-bad' : partial ? 'route-part' : '';
  return `<span class="chip ${cls}">${ROUTES[route].label}</span>`;
};
const personLabel = (pid) => { const p = P[pid]; return p.name + (p.contractor ? ' (contractor)' : '') + (p.status !== 'active' ? ` (${p.status})` : ''); };

// ---------- analysis (all computed live) ----------
const paths = enumeratePaths(W);
const keyOf = (p) => [p.agent, p.conn, p.resource, p.action].join('|');
const rp = replayEvents(W, D.events);
const throughByKey = {};
rp.through.forEach((e) => { const k = [e.agent, e.conn, e.resource, e.action].join('|'); (throughByKey[k] = throughByKey[k] || []).push(e); });

// aggregate bypass paths to (agent, connection, resource, action)
const agg = {};
paths.filter((p) => p.bypass).forEach((p) => {
  const k = keyOf(p);
  const g = (agg[k] = agg[k] || { key: k, agent: p.agent, conn: p.conn, route: p.route, app: p.app, resource: p.resource, action: p.action, policies: new Set(), people: new Set() });
  g.policies.add(p.policy); g.people.add(p.person);
});
const bypassRows = Object.values(agg).map((g) => ({ ...g, policies: [...g.policies].sort(), people: [...g.people], uses: (throughByKey[g.key] || []).length }))
  .sort((a, b) => b.uses - a.uses || POL[b.policies[0]].severity - POL[a.policies[0]].severity);

let cfg = { ...D.cfg };
let plan = null;
const state = { view: 'paths', filters: {}, q: '' };

function distinct(list, f) { return new Set(list.map(f)).size; }

function renderCards() {
  $('kBypass').innerHTML = `${bypassRows.length}<small>across ${distinct(bypassRows, (r) => r.agent)} agents · ${distinct(bypassRows, (r) => r.conn)} connections</small>`;
  const modeA = document.querySelector('[data-for="tblA"] a.active').dataset.mode;
  if (modeA === 'policy') {
    $('tblA').innerHTML = '<tr><th>Policy</th><th class="num">Bypass paths</th></tr>' + W.policies.map((p) => {
      const n = bypassRows.filter((r) => r.policies.includes(p.id)).length;
      return `<tr><td><span class="pid">${p.id}</span>${p.name.length > 46 ? p.name.slice(0, 44) + '\u2026' : p.name}</td><td class="num">${n}</td></tr>`;
    }).slice(0, 5).join('');
  } else {
    $('tblA').innerHTML = '<tr><th>Route</th><th class="num">Bypass paths</th></tr>' + ROUTE_ORDER.map((rt) => [rt, bypassRows.filter((r) => r.route === rt).length]).filter((x) => x[1]).sort((a, b) => b[1] - a[1])
      .map(([rt, n]) => `<tr><td>${ROUTES[rt].label}</td><td class="num">${n}</td></tr>`).join('');
  }
  const t0 = D.start, t1 = D.start + 29 * DAY;
  $('kThrough').innerHTML = `${rp.through.length}<small>of ${rp.violating} policy-violating actions</small>`;
  $('subThrough').textContent = `Actions from ${fmtDay(t0)} to ${fmtDay(t1)} that a policy would have stopped, on routes that could not enforce it. The other ${rp.enforced.length} were enforced.`;
  const modeB = document.querySelector('[data-for="tblB"] a.active').dataset.mode;
  const cnt = {};
  rp.through.forEach((e) => { const k = modeB === 'agent' ? e.agent : e.policies[0]; cnt[k] = (cnt[k] || 0) + 1; });
  $('tblB').innerHTML = `<tr><th>${modeB === 'agent' ? 'Agent' : 'Policy'}</th><th class="num">Went through</th></tr>` + Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, n]) => `<tr><td>${modeB === 'agent' ? `<span class="agent">${cube}<a>${A[k].name}</a></span>` : `<span class="pid">${k}</span>${POL[k].name.slice(0, 42)}\u2026`}</td><td class="num">${n}</td></tr>`).join('');
}

function renderMatrix() {
  const head = '<tr><th>Policy</th>' + ROUTE_ORDER.map((r) => `<th>${ROUTES[r].label}</th>`).join('') + '</tr>';
  const rows = W.policies.map((pol) => {
    const cells = ROUTE_ORDER.map((rt) => {
      const ps = paths.filter((p) => p.policy === pol.id && p.route === rt);
      const n = distinct(ps, keyOf);
      if (!n) return '<td><span class="cell na">\u2013</span></td>';
      if (enforces(rt, pol.decision)) return `<td><span class="cell ok">${n}</span></td>`;
      return `<td><span class="cell ${ROUTES[rt].governs ? 'part' : 'bad'}">${n}</span></td>`;
    }).join('');
    return `<tr><td><span class="pid">${pol.id}</span>${pol.name}<span class="dec">${decisionChip(pol.decision)}</span></td>${cells}</tr>`;
  });
  $('matrix').innerHTML = head + rows.join('');
}

function sparkFor(list) {
  const days = new Array(30).fill(0);
  list.forEach((e) => { const d = Math.floor((e.ts - D.start) / DAY); if (d >= 0 && d < 30) days[d]++; });
  const mx = Math.max(1, ...days);
  return '<span class="spark">' + days.map((v) => (v ? `<i style="height:${Math.max(3, Math.round((18 * v) / mx))}px"></i>` : '<i class="z"></i>')).join('') + '</span>';
}

function facetDefs() {
  if (state.view === 'paths') return [
    ['Policy', (r) => r.policies, (v) => `${v} \u00b7 ${POL[v].decision === 'approval' ? 'approval' : 'block'}`],
    ['Route', (r) => [r.route], (v) => ROUTES[v].label],
    ['App', (r) => [r.app], (v) => v],
  ];
  return [
    ['Policy', (r) => r.policies, (v) => `${v} \u00b7 ${POL[v].decision === 'approval' ? 'approval' : 'block'}`],
    ['Agent', (r) => [r.agent], (v) => A[v].name],
    ['Route', (r) => [C[r.conn].route], (v) => ROUTES[v].label],
  ];
}
function currentRows() {
  let rows = state.view === 'paths' ? bypassRows : rp.through.slice().reverse();
  const q = state.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => [A[r.agent].name, C[r.conn].app, R[r.resource].name, ACTION[r.action], ROUTES[C[r.conn].route].label].join(' ').toLowerCase().includes(q));
  for (const [name, f] of facetDefs()) { const sel = state.filters[name]; if (sel) rows = rows.filter((r) => f(r).includes(sel)); }
  return rows;
}
function renderFacets(rowsAll) {
  const html = facetDefs().map(([name, f, label]) => {
    const cnt = {};
    rowsAll.forEach((r) => f(r).forEach((v) => { cnt[v] = (cnt[v] || 0) + 1; }));
    const tot = rowsAll.length || 1;
    const items = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([v, n]) => {
      const pctv = (100 * n) / tot;
      return `<div class="fitem ${state.filters[name] === v ? 'on' : ''}" data-f="${name}" data-v="${v}"><span class="fl">${label(v)}</span><span class="fc">${n} <span>(${pctv < 1 ? '<1' : Math.round(pctv)}%)</span></span><span class="pm">+</span><span class="pm">\u2212</span><i class="fbar" style="width:${Math.max(2, pctv * 0.62)}%"></i></div>`;
    }).join('');
    return `<div class="fgroup"><h4>${name}<span class="muted">\u02c4</span></h4>${items}</div>`;
  }).join('');
  $('facets').innerHTML = html;
  document.querySelectorAll('.fitem').forEach((el) => el.addEventListener('click', () => {
    const f = el.dataset.f, v = el.dataset.v; state.filters[f] = state.filters[f] === v ? null : v; renderGrid();
  }));
}
function renderGrid() {
  const all = state.view === 'paths' ? bypassRows : rp.through;
  renderFacets(all);
  const rows = currentRows();
  const fixKeys = plan ? new Set(plan.fixes.map((f) => f.key)) : new Set();
  const LIMIT = 14;
  if (state.view === 'paths') {
    $('rowCount').textContent = `${rows.length} bypass paths`;
    $('grid').innerHTML = '<tr><th>Agent</th><th>Acting for</th><th>Connection</th><th>Resource</th><th>Action</th><th>Policy</th><th>Uses (30 days)</th></tr>' + rows.slice(0, LIMIT).map((r) => {
      const pol = POL[r.policies[0]];
      const fix = ['govern:' + r.conn, 'scope:' + r.conn + '|' + r.action].find((k) => fixKeys.has(k)) || r.people.map((p) => 'invoke:' + p + '>' + r.agent).find((k) => fixKeys.has(k));
      const fixLabel = !fix ? '<span class="muted">\u2013</span>' : fix.startsWith('govern') ? `<span class="kind govern">${C[r.conn].route === 'direct_mcp' ? 'Proxy' : 'API'}</span>` : fix.startsWith('scope') ? '<span class="kind scope">Scope</span>' : '<span class="kind invoke">Invoker</span>';
      return `<tr><td><span class="agent">${cube}<a>${A[r.agent].name}</a></span></td>
        <td class="nw">${r.people.length === 1 && P[r.people[0]].status !== 'active' ? P[r.people[0]].name.split(' ')[0] + ' <span class="muted">(departed)</span>' : `${P[r.people[0]].name.split(' ')[0]}${r.people.length > 1 ? ` <span class="muted">+${r.people.length - 1}</span>` : ''}`}</td>
        <td>${routeChip(r.route, pol.decision)}</td>
        <td><span class="chip">${appDot(r.app)}${R[r.resource].name}</span><span class="app2">${R[r.resource].label}</span></td>
        <td class="nw">${ACTION[r.action]}</td>
        <td><span class="polcell"><span class="pid">${r.policies.join(', ')}</span>${decisionChip(pol.decision)}</span></td>
        <td class="nw">${sparkFor(throughByKey[r.key] || [])} <b>${r.uses}</b></td></tr>`;
    }).join('') + (rows.length > LIMIT ? `<tr><td colspan="7" class="more">${rows.length - LIMIT} more bypass paths</td></tr>` : '');
  } else {
    $('rowCount').textContent = `${rows.length} actions went through`;
    $('grid').innerHTML = '<tr><th>Timestamp</th><th>Agent</th><th>Acting for</th><th>Connection</th><th>Resource</th><th>Action</th><th>Would-be outcome</th></tr>' + rows.slice(0, LIMIT).map((e) => {
      const pol = POL[e.policies[0]];
      return `<tr><td class="nw">${fmtTs(e.ts)}</td><td><span class="agent">${cube}<a>${A[e.agent].name}</a></span></td><td class="nw">${P[e.person].name}${P[e.person].status !== 'active' ? ' <span class="muted">(departed)</span>' : P[e.person].contractor ? ' <span class="muted">(contractor)</span>' : ''}</td>
        <td>${routeChip(C[e.conn].route, pol.decision)}</td><td><span class="chip">${appDot(e.app)}${R[e.resource].name}</span>${e.rows ? `<span class="app2">${e.rows.toLocaleString()} rows</span>` : ''}</td>
        <td class="nw">${ACTION[e.action]}</td><td class="nw">${decisionChip(pol.decision)} <span class="muted">${e.policies.join(', ')}</span></td></tr>`;
    }).join('') + (rows.length > LIMIT ? `<tr><td colspan="7" class="more">${rows.length - LIMIT} more actions</td></tr>` : '');
  }
}

function renderPlan() {
  const usage = usageCounts(W, D.events);
  plan = closurePlan(W, paths, usage, cfg);
  const after = bypassAfter(W, plan);
  $('wVal').textContent = cfg.disruptionWeight.toFixed(2) + ' pts';
  const closes = (f) => bypassRows.filter((r) => (f.kind === 'govern' ? r.conn === f.conn : f.kind === 'scope' ? r.conn === f.conn && r.action === f.action : r.agent === f.agent && r.people.includes(f.person))).length;
  const broken = (f) => (f.kind === 'scope' ? usage.scope[f.conn + '|' + f.action] || 0 : f.kind === 'invoke' ? usage.invoke[f.person + '|' + f.agent] || 0 : 0);
  const describe = (f) => {
    if (f.kind === 'govern') { const c = C[f.conn]; return `<span class="kind govern"><i data-lucide="shield-check"></i>Route through ${c.route === 'direct_mcp' ? 'MCP Security Proxy' : 'Policy Decision API'}</span><span class="app2">${A[c.agent].name} \u2192 ${c.app} (${ROUTES[c.route].label})</span>`; }
    if (f.kind === 'scope') { const c = C[f.conn]; return `<span class="kind scope"><i data-lucide="scissors"></i>Remove ${ACTION[f.action].toLowerCase()} from grant</span><span class="app2">${A[c.agent].name} \u2192 ${c.app} (${ROUTES[c.route].label})</span>`; }
    return `<span class="kind invoke"><i data-lucide="user-x"></i>Stop invoking agent</span><span class="app2">${personLabel(f.person)} \u2192 ${A[f.agent].name}</span>`;
  };
  const rows = plan.fixes.slice().sort((a, b) => closes(b) - closes(a));
  const effort = (f) => (f.kind === 'govern' ? governCost(C[f.conn], cfg) : f.kind === 'scope' ? cfg.scopeEffort : cfg.invokeEffort);
  $('planTable').innerHTML = '<tr><th>Change</th><th>For policy</th><th class="num">Bypass paths closed</th><th class="num">Legitimate actions broken (30d)</th><th class="num">Effort</th><th class="num">Cost</th></tr>' + rows.map((f) =>
    `<tr><td>${describe(f)}</td><td><span class="pid">${f.policy}</span> <span class="muted">${POL[f.policy].name.split(' ').slice(0, 5).join(' ')}\u2026</span></td><td class="num">${closes(f)}</td><td class="num">${broken(f)}</td><td class="num">${effort(f)}</td><td class="num">${f.cost.toFixed(2)}</td></tr>`).join('');
  const totalLegit = D.events.length - rp.violating;
  const brokenAll = plan.fixes.reduce((s, f) => s + broken(f), 0);
  const nG = plan.fixes.filter((f) => f.kind === 'govern').length, nS = plan.fixes.filter((f) => f.kind === 'scope').length, nI = plan.fixes.filter((f) => f.kind === 'invoke').length;
  $('planSub').textContent = `${plan.fixes.length} changes: route ${nG} connection${nG === 1 ? '' : 's'} through an enforcement point, remove ${nS} scope${nS === 1 ? '' : 's'}, stop ${nI} invocation${nI === 1 ? '' : 's'}. Solved exactly per policy (Dinic max-flow), in severity order, then pruned.`;
  $('planFoot').innerHTML = `After the plan: <b>${after.length} bypass paths</b> (re-checked by enumerating every path again). Legitimate actions that would break: <b>${brokenAll}</b> of ${totalLegit.toLocaleString()} in 30 days (${((100 * brokenAll) / totalLegit).toFixed(2)}%). Plan cost <b>${plan.total.toFixed(2)}</b>; no plan can cost less than <b>${plan.lower.toFixed(2)}</b> (largest single-policy minimum cut)${plan.pruned.length ? `; ${plan.pruned.length} redundant step${plan.pruned.length === 1 ? '' : 's'} pruned` : ''}. Effort points: proxy route ${cfg.proxyEffort}, API route ${cfg.gatewayEffort}, scope change ${cfg.scopeEffort}, invoker change ${cfg.invokeEffort}.`;
  $('kPlan').innerHTML = `${plan.fixes.length}<small>changes \u00b7 ${after.length} paths left</small>`;
  $('tblC').innerHTML = '<tr><th>Change</th><th class="num">Closes</th></tr>' + rows.slice(0, 5).map((f) => {
    const c = f.conn ? C[f.conn] : null;
    const t = f.kind === 'govern' ? `Route ${A[c.agent].name.split(' ')[0]} \u2192 ${c.app} via ${c.route === 'direct_mcp' ? 'proxy' : 'API'}` : f.kind === 'scope' ? `Remove ${ACTION[f.action].toLowerCase()}: ${A[c.agent].name.split(' ')[0]} \u2192 ${c.app}` : `Stop ${P[f.person].name.split(' ')[0]} \u2192 ${A[f.agent].name.split(' ')[0]}`;
    return `<tr><td>${t}</td><td class="num">${closes(f)}</td></tr>`;
  }).join('');
}

function renderAll() { renderCards(); renderMatrix(); renderPlan(); renderGrid(); if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 } }); }

document.querySelectorAll('.mini-tabs[data-for] a').forEach((a) => a.addEventListener('click', () => {
  a.parentElement.querySelectorAll('a').forEach((x) => x.classList.toggle('active', x === a)); renderCards(); if (window.lucide) window.lucide.createIcons();
}));
document.querySelectorAll('#viewSeg a').forEach((a) => a.addEventListener('click', () => {
  document.querySelectorAll('#viewSeg a').forEach((x) => x.classList.toggle('active', x === a)); state.view = a.dataset.view; state.filters = {}; renderGrid();
}));
$('search').addEventListener('input', (e) => { state.q = e.target.value; renderGrid(); });
$('w').value = cfg.disruptionWeight;
$('w').addEventListener('input', (e) => { cfg = { ...cfg, disruptionWeight: Number(e.target.value) }; renderPlan(); renderGrid(); if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 } }); });
if (location.hash === '#through') { state.view = 'through'; document.querySelectorAll('#viewSeg a').forEach((x) => x.classList.toggle('active', x.dataset.view === 'through')); }
renderAll();
