// Policy Coverage core: enumerate agent action paths, evaluate runtime policies,
// find paths that no enforcement point governs, replay activity, and compute a
// minimum-cost closure plan with max-flow / min-cut (Dinic). Defensive only.
// Pure ES module; runs in the browser and under `node --test`.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Enforcement routes and what each one can enforce.
// governs: the action is checked by the Runtime Policy Decision Engine before it runs.
export const ROUTES = {
  claude_code: { label: 'Claude Code hook', governs: true, block: true, approval: true },
  codex: { label: 'Codex sidecar', governs: true, block: true, approval: true },
  mcp_proxy: { label: 'MCP Security Proxy', governs: true, block: true, approval: true },
  gateway: { label: 'Policy Decision API', governs: true, block: true, approval: false },
  copilot: { label: 'Copilot Studio webhook', governs: true, block: true, approval: false },
  direct_mcp: { label: 'Direct MCP', governs: false, block: false, approval: false },
  direct_token: { label: 'Direct API token', governs: false, block: false, approval: false },
  app_native: { label: 'App-native agent', governs: false, block: false, approval: false },
};
export const ROUTE_ORDER = ['claude_code', 'codex', 'mcp_proxy', 'gateway', 'copilot', 'direct_mcp', 'direct_token', 'app_native'];

// Can this route enforce this decision?
export function enforces(route, decision) {
  const r = ROUTES[route];
  if (!r || !r.governs) return false;
  return decision === 'approval' ? r.approval : r.block;
}

// ---------- policy evaluation ----------
// Policy: { id, name, decision: 'block'|'approval', severity, subject(person)->bool, object(resource, action, app)->bool }
// Predicates are data (serializable) so the same policy runs in node and the browser.
export function matchSubject(pol, person) {
  const s = pol.subject || {};
  if (s.contractor != null && person.contractor !== s.contractor) return false;
  if (s.notGroup && person.group === s.notGroup) return false;
  if (s.status && !s.status.includes(person.status)) return false;
  return true;
}
export function matchObject(pol, resource, action) {
  const o = pol.object || {};
  if (o.actions && !o.actions.includes(action)) return false;
  if (o.labels && !o.labels.includes(resource.label)) return false;
  if (o.apps && !o.apps.includes(resource.app)) return false;
  return true;
}
export function policiesFor(policies, person, resource, action) {
  return policies.filter((p) => matchSubject(p, person) && matchObject(p, resource, action));
}

// ---------- path enumeration ----------
// A path is (person -> agent -> connection -> resource, action). It is "targeted"
// by a policy if subject and object match. It is a BYPASS for that policy if the
// connection's route cannot enforce the policy's decision.
export function enumeratePaths(world) {
  const { people, agents, connections, resources, policies } = world;
  const P = Object.fromEntries(people.map((p) => [p.id, p]));
  const A = Object.fromEntries(agents.map((a) => [a.id, a]));
  const byApp = {};
  resources.forEach((r) => { (byApp[r.app] = byApp[r.app] || []).push(r); });
  const out = [];
  for (const c of connections) {
    const agent = A[c.agent];
    for (const r of byApp[c.app] || []) {
      for (const action of c.actions) {
        if (!r.actions.includes(action)) continue;
        for (const pid of agent.invokers) {
          const person = P[pid];
          for (const pol of policies) {
            if (!matchSubject(pol, person) || !matchObject(pol, r, action)) continue;
            out.push({ policy: pol.id, person: pid, agent: agent.id, conn: c.id, route: c.route, app: c.app, resource: r.id, action, bypass: !enforces(c.route, pol.decision) });
          }
        }
      }
    }
  }
  return out;
}

// Coverage matrix: policy x route -> { governed, bypass } path counts.
export function coverageMatrix(paths, policies) {
  const m = {};
  policies.forEach((p) => { m[p.id] = {}; ROUTE_ORDER.forEach((r) => { m[p.id][r] = { governed: 0, bypass: 0 }; }); });
  paths.forEach((x) => { m[x.policy][x.route][x.bypass ? 'bypass' : 'governed']++; });
  return m;
}

// ---------- replay ----------
// Evaluate each logged action against every policy; an action that a policy would
// stop but whose route cannot enforce it "went through".
export function replayEvents(world, events) {
  const P = Object.fromEntries(world.people.map((p) => [p.id, p]));
  const R = Object.fromEntries(world.resources.map((r) => [r.id, r]));
  const C = Object.fromEntries(world.connections.map((c) => [c.id, c]));
  const through = [], enforced = [];
  let violating = 0;
  for (const e of events) {
    const pols = policiesFor(world.policies, P[e.person], R[e.resource], e.action);
    if (!pols.length) continue;
    violating++;
    const c = C[e.conn];
    const unenforced = pols.filter((p) => !enforces(c.route, p.decision));
    if (unenforced.length) through.push({ ...e, policies: unenforced.map((p) => p.id) });
    else enforced.push(e);
  }
  return { violating, through, enforced };
}

// ---------- max-flow / min-cut (Dinic) ----------
export class FlowNetwork {
  constructor() { this.adj = []; this.edges = []; this.nodes = new Map(); }
  node(key) { if (!this.nodes.has(key)) { this.nodes.set(key, this.adj.length); this.adj.push([]); } return this.nodes.get(key); }
  addEdge(u, v, cap, meta) {
    const e = { u, v, cap, flow: 0, meta }; const r = { u: v, v: u, cap: 0, flow: 0, meta: null };
    e.rev = r; r.rev = e; this.adj[u].push(e); this.adj[v].push(r); this.edges.push(e); return e;
  }
  maxflow(s, t) {
    let total = 0; const n = this.adj.length;
    for (;;) {
      const level = new Array(n).fill(-1); level[s] = 0; const q = [s];
      for (let qi = 0; qi < q.length; qi++) { const u = q[qi]; for (const e of this.adj[u]) if (level[e.v] < 0 && e.cap - e.flow > 1e-9) { level[e.v] = level[u] + 1; q.push(e.v); } }
      if (level[t] < 0) break;
      const it = new Array(n).fill(0);
      const dfs = (u, f) => {
        if (u === t) return f;
        for (; it[u] < this.adj[u].length; it[u]++) {
          const e = this.adj[u][it[u]];
          if (level[e.v] === level[u] + 1 && e.cap - e.flow > 1e-9) {
            const d = dfs(e.v, Math.min(f, e.cap - e.flow));
            if (d > 1e-9) { e.flow += d; e.rev.flow -= d; return d; }
          }
        }
        return 0;
      };
      let f; while ((f = dfs(s, Infinity)) > 1e-9) { total += f; if (!isFinite(total)) return Infinity; }
    }
    return total;
  }
  // Source side of the min cut after maxflow.
  reachable(s) {
    const seen = new Array(this.adj.length).fill(false); seen[s] = true; const q = [s];
    for (let qi = 0; qi < q.length; qi++) { const u = q[qi]; for (const e of this.adj[u]) if (!seen[e.v] && e.cap - e.flow > 1e-9) { seen[e.v] = true; q.push(e.v); } }
    return seen;
  }
}

// ---------- fix costs ----------
export const PROXY_APPS = ['Salesforce', 'Snowflake', 'Google Drive', 'Slack', 'Notion', 'Databricks', 'GitHub'];
export function governCost(conn, cfg) {
  if (conn.route === 'direct_mcp') return PROXY_APPS.includes(conn.app) ? cfg.proxyEffort : Infinity;
  if (conn.route === 'direct_token') return cfg.gatewayEffort;
  return Infinity; // app-native agents: no enforcement point available yet
}
// Legitimate (non-violating) uses of a connection/resource/action, or of a person->agent invocation.
export function usageCounts(world, events) {
  const P = Object.fromEntries(world.people.map((p) => [p.id, p]));
  const R = Object.fromEntries(world.resources.map((r) => [r.id, r]));
  const scope = {}, invoke = {}, scopeAll = {};
  for (const e of events) {
    const k = e.conn + '|' + e.action;
    scopeAll[k] = (scopeAll[k] || 0) + 1;
    if (policiesFor(world.policies, P[e.person], R[e.resource], e.action).length) continue;
    scope[k] = (scope[k] || 0) + 1;
    const j = e.person + '|' + e.agent;
    invoke[j] = (invoke[j] || 0) + 1;
  }
  return { scope, invoke, scopeAll };
}

// Exact minimum-cost closure for ONE policy. Fix options on each bypass path:
//  - govern the connection (route it through an enforcement point): effort cost
//  - remove an action from the connection's grant (OAuth scopes are per action, not
//    per record): cost = scopeEffort + legit uses broken x weight
//  - stop that person invoking the agent: cost = invokeEffort + legit invocations broken x weight
// `done` holds fixes already chosen (cost 0 here).
export function minCutForPolicy(world, paths, policyId, usage, cfg, done = new Set()) {
  const bp = paths.filter((p) => p.policy === policyId && p.bypass);
  if (!bp.length) return { cost: 0, fixes: [], paths: 0 };
  const C = Object.fromEntries(world.connections.map((c) => [c.id, c]));
  const g = new FlowNetwork(); const s = g.node('s'); const t = g.node('t');
  const once = new Set();
  const cost = (fix, base) => (done.has(fix.key) ? 0 : base);
  for (const p of bp) {
    const person = g.node('P:' + p.person), agentIn = g.node('A:' + p.person + '>' + p.agent);
    const cin = g.node('Ci:' + p.conn), cout = g.node('Co:' + p.conn), ca = g.node('S:' + p.conn + '|' + p.action);
    const add = (key, u, v, cap, meta) => { if (once.has(key)) return; once.add(key); g.addEdge(u, v, cap, meta); };
    add('s>' + p.person, s, person, Infinity, null);
    const inv = { kind: 'invoke', key: 'invoke:' + p.person + '>' + p.agent, person: p.person, agent: p.agent };
    add(inv.key, person, agentIn, cost(inv, cfg.invokeEffort + (usage.invoke[p.person + '|' + p.agent] || 0) * cfg.disruptionWeight), inv);
    add('a>c:' + p.person + '>' + p.conn, agentIn, cin, Infinity, null);
    const gov = { kind: 'govern', key: 'govern:' + p.conn, conn: p.conn };
    add(gov.key, cin, cout, cost(gov, governCost(C[p.conn], cfg)), gov);
    const sc = { kind: 'scope', key: 'scope:' + p.conn + '|' + p.action, conn: p.conn, action: p.action };
    add(sc.key, cout, ca, cost(sc, cfg.scopeEffort + (usage.scope[p.conn + '|' + p.action] || 0) * cfg.disruptionWeight), sc);
    add('ca>t:' + sc.key, ca, t, Infinity, null);
  }
  const value = g.maxflow(s, t);
  const side = g.reachable(s);
  const fixes = g.edges.filter((e) => e.meta && side[e.u] && !side[e.v]).map((e) => ({ ...e.meta, cost: e.cap }));
  return { cost: value, fixes, paths: bp.length };
}

// Combined plan: policies in severity order, each solved exactly given fixes so far.
// Also returns a lower bound (largest single-policy optimum) for honesty.
export function closurePlan(world, paths, usage, cfg) {
  const order = [...world.policies].sort((a, b) => b.severity - a.severity);
  const done = new Set(); const fixes = []; let total = 0, lower = 0;
  const standalone = {};
  for (const pol of order) {
    standalone[pol.id] = minCutForPolicy(world, paths, pol.id, usage, cfg).cost;
    lower = Math.max(lower, standalone[pol.id]);
    const r = minCutForPolicy(world, paths, pol.id, usage, cfg, done);
    for (const f of r.fixes) if (!done.has(f.key)) { done.add(f.key); fixes.push({ ...f, policy: pol.id }); total += f.cost; }
  }
  // Prune fixes made redundant by later ones (e.g. a scope removal on a connection
  // that a later step routes through an enforcement point). Most expensive first.
  const pruned = [];
  let kept = fixes.slice();
  for (const f of [...fixes].sort((a, b) => b.cost - a.cost)) {
    const trial = kept.filter((x) => x.key !== f.key);
    if (bypassAfter(world, { fixes: trial }).length === 0) { kept = trial; pruned.push(f); total -= f.cost; }
  }
  return { fixes: kept, total, lower, standalone, pruned };
}

// Apply a plan to the world (returns a new world) so coverage can be re-checked.
export function applyPlan(world, plan) {
  const govern = new Set(plan.fixes.filter((f) => f.kind === 'govern').map((f) => f.conn));
  const scopes = new Set(plan.fixes.filter((f) => f.kind === 'scope').map((f) => f.conn + '|' + f.action));
  const invokes = new Set(plan.fixes.filter((f) => f.kind === 'invoke').map((f) => f.person + '>' + f.agent));
  const connections = world.connections.map((c) => (govern.has(c.id) ? { ...c, route: c.route === 'direct_mcp' ? 'mcp_proxy' : 'gateway' } : c));
  const agents = world.agents.map((a) => ({ ...a, invokers: a.invokers.filter((p) => !invokes.has(p + '>' + a.id)) }));
  return { ...world, connections, agents, blockedScopes: scopes };
}
export function bypassAfter(world, plan) {
  const w2 = applyPlan(world, plan);
  return enumeratePaths(w2).filter((p) => p.bypass && !w2.blockedScopes.has(p.conn + '|' + p.action));
}
