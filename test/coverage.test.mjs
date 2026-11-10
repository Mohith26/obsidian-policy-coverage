import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, FlowNetwork, enforces, matchSubject, matchObject, enumeratePaths, coverageMatrix, replayEvents,
  usageCounts, minCutForPolicy, closurePlan, bypassAfter, governCost,
} from '../core/coverage.js';

test('Dinic max-flow on a textbook graph', () => {
  const g = new FlowNetwork();
  const [s, a, b, c, d, t] = ['s', 'a', 'b', 'c', 'd', 't'].map((k) => g.node(k));
  g.addEdge(s, a, 10); g.addEdge(s, c, 10); g.addEdge(a, b, 4); g.addEdge(a, c, 2); g.addEdge(a, d, 8);
  g.addEdge(c, d, 9); g.addEdge(d, b, 6); g.addEdge(b, t, 10); g.addEdge(d, t, 10);
  assert.equal(g.maxflow(s, t), 19);
});

test('route capabilities: Copilot webhook blocks but cannot require approval; direct routes enforce nothing', () => {
  assert.equal(enforces('copilot', 'block'), true);
  assert.equal(enforces('copilot', 'approval'), false);
  assert.equal(enforces('mcp_proxy', 'approval'), true);
  assert.equal(enforces('direct_mcp', 'block'), false);
  assert.equal(enforces('app_native', 'block'), false);
});

test('policy predicates', () => {
  const pol = { subject: { contractor: true }, object: { actions: ['delete'], labels: ['Critical'] } };
  assert.ok(matchSubject(pol, { contractor: true, group: 'Eng', status: 'active' }));
  assert.ok(!matchSubject(pol, { contractor: false }));
  assert.ok(matchObject(pol, { label: 'Critical', app: 'GitHub' }, 'delete'));
  assert.ok(!matchObject(pol, { label: 'Internal' }, 'delete'));
  assert.ok(!matchSubject({ subject: { notGroup: 'Executive' } }, { group: 'Executive' }));
  assert.ok(matchSubject({ subject: { status: ['departed'] } }, { status: 'departed' }));
});

function randomWorld(seed) {
  const rng = mulberry32(seed);
  const people = Array.from({ length: 4 }, (_, i) => ({ id: 'u' + i, group: i === 0 ? 'Executive' : 'Sales', contractor: i === 3, status: 'active' }));
  const apps = ['Salesforce', 'Workday'];
  const resources = [
    { id: 'r0', app: 'Salesforce', label: 'Highly Sensitive', actions: ['read', 'export'] },
    { id: 'r1', app: 'Salesforce', label: 'Internal', actions: ['read', 'export'] },
    { id: 'r2', app: 'Workday', label: 'Highly Sensitive', actions: ['read', 'export'] },
  ];
  const agents = Array.from({ length: 3 }, (_, i) => ({ id: 'a' + i, invokers: people.filter(() => rng() < 0.6).map((p) => p.id) }));
  agents.forEach((a) => { if (!a.invokers.length) a.invokers.push('u1'); });
  const routes = ['direct_mcp', 'direct_token', 'app_native', 'mcp_proxy'];
  const connections = agents.map((a, i) => ({ id: 'c' + i, agent: a.id, app: apps[Math.floor(rng() * 2)], route: routes[Math.floor(rng() * 4)], actions: ['read', 'export'] }));
  const policies = [{ id: 'P', decision: 'block', severity: 1, subject: { notGroup: 'Executive' }, object: { actions: ['export'], labels: ['Highly Sensitive'] } }];
  const events = [];
  for (let i = 0; i < 60; i++) {
    const c = connections[Math.floor(rng() * connections.length)];
    const ag = agents.find((a) => a.id === c.agent);
    const res = resources.filter((r) => r.app === c.app);
    events.push({ person: ag.invokers[Math.floor(rng() * ag.invokers.length)], agent: ag.id, conn: c.id, app: c.app, resource: res[Math.floor(rng() * res.length)].id, action: rng() < 0.5 ? 'export' : 'read' });
  }
  return { world: { people, resources, agents, connections, policies }, events };
}

test('min-cut cost equals brute-force optimum over all fix subsets (40 random tenants)', () => {
  const cfg = { proxyEffort: 3, gatewayEffort: 6, scopeEffort: 2, invokeEffort: 1, disruptionWeight: 0.25 };
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { world, events } = randomWorld(seed);
    const paths = enumeratePaths(world);
    const bp = paths.filter((p) => p.bypass);
    if (!bp.length) continue;
    const usage = usageCounts(world, events);
    const C = Object.fromEntries(world.connections.map((c) => [c.id, c]));
    const cand = new Map();
    for (const p of bp) {
      const g = governCost(C[p.conn], cfg);
      if (isFinite(g)) cand.set('govern:' + p.conn, { cost: g, hit: (x) => x.conn === p.conn });
      cand.set('scope:' + p.conn + '|' + p.action, { cost: cfg.scopeEffort + (usage.scope[p.conn + '|' + p.action] || 0) * cfg.disruptionWeight, hit: (x) => x.conn === p.conn && x.action === p.action });
      cand.set('invoke:' + p.person + '>' + p.agent, { cost: cfg.invokeEffort + (usage.invoke[p.person + '|' + p.agent] || 0) * cfg.disruptionWeight, hit: (x) => x.person === p.person && x.agent === p.agent });
    }
    const list = [...cand.values()];
    assert.ok(list.length <= 16);
    let best = Infinity;
    for (let mask = 0; mask < 1 << list.length; mask++) {
      let cost = 0; const chosen = [];
      for (let i = 0; i < list.length; i++) if (mask & (1 << i)) { cost += list[i].cost; chosen.push(list[i]); }
      if (cost >= best) continue;
      if (bp.every((p) => chosen.some((f) => f.hit(p)))) best = cost;
    }
    const mc = minCutForPolicy(world, paths, 'P', usage, cfg);
    assert.ok(Math.abs(mc.cost - best) < 1e-9, `seed ${seed}: mincut ${mc.cost} vs brute ${best}`);
    checked++;
  }
  assert.ok(checked >= 15, 'enough non-trivial tenants: ' + checked);
});

test('closure plan closes every bypass path and never costs less than the lower bound', () => {
  const cfg = { proxyEffort: 3, gatewayEffort: 6, scopeEffort: 2, invokeEffort: 1, disruptionWeight: 0.25 };
  for (let seed = 100; seed < 130; seed++) {
    const { world, events } = randomWorld(seed);
    const paths = enumeratePaths(world);
    const plan = closurePlan(world, paths, usageCounts(world, events), cfg);
    assert.equal(bypassAfter(world, plan).length, 0);
    assert.ok(plan.total + 1e-9 >= plan.lower);
  }
});

test('coverage matrix accounts for every path', () => {
  const { world } = randomWorld(7);
  const paths = enumeratePaths(world);
  const m = coverageMatrix(paths, world.policies);
  let n = 0; Object.values(m.P).forEach((c) => { n += c.governed + c.bypass; });
  assert.equal(n, paths.length);
});

test('replay separates enforced from went-through by route capability', () => {
  const world = {
    people: [{ id: 'u', group: 'Sales', contractor: false, status: 'active' }],
    resources: [{ id: 'r', app: 'Salesforce', label: 'Highly Sensitive', actions: ['export'] }],
    agents: [{ id: 'a', invokers: ['u'] }],
    connections: [{ id: 'g', agent: 'a', app: 'Salesforce', route: 'mcp_proxy', actions: ['export'] }, { id: 'd', agent: 'a', app: 'Salesforce', route: 'direct_mcp', actions: ['export'] }],
    policies: [{ id: 'P', decision: 'block', severity: 1, subject: { notGroup: 'Executive' }, object: { actions: ['export'], labels: ['Highly Sensitive'] } }],
  };
  const ev = [{ person: 'u', agent: 'a', conn: 'g', resource: 'r', action: 'export' }, { person: 'u', agent: 'a', conn: 'd', resource: 'r', action: 'export' }];
  const r = replayEvents(world, ev);
  assert.equal(r.violating, 2); assert.equal(r.enforced.length, 1); assert.equal(r.through.length, 1);
  assert.equal(r.through[0].conn, 'd');
});
