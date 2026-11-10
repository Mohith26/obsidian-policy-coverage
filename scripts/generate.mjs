// Seeded synthetic tenant + 30 days of agent activity. node scripts/generate.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { mulberry32, enumeratePaths, replayEvents, usageCounts, closurePlan, bypassAfter, coverageMatrix } from '../core/coverage.js';

const rng = mulberry32(20261110);
const pick = (a) => a[Math.floor(rng() * a.length)];
const START = Date.UTC(2026, 9, 11); // Oct 11 2026, 30 days to Nov 9

// ---------- people ----------
const GROUPS = { Executive: 4, Sales: 7, Engineering: 9, Data: 5, Finance: 4, People: 3 };
const FIRST = ['Nancette', 'Emily', 'Curtis', 'Tracy', 'Nancy', 'Priya', 'Marcus', 'Elena', 'Daniel', 'Grace', 'Omar', 'Hannah', 'Leo', 'Sofia', 'Raj', 'Mei', 'Jonah', 'Ava', 'Samir', 'Chloe', 'Victor', 'Iris', 'Theo', 'Nina', 'Felix', 'Rosa', 'Kenji', 'Lena', 'Diego', 'Maya', 'Arjun', 'Bea'];
const LAST = ['Exampler', 'Johnson', 'Jones', 'Admin', 'Okafor', 'Shah', 'Bell', 'Novak', 'Park', 'Haddad', 'Reyes', 'Lindqvist', 'Moreau', 'Kim', 'Patel', 'Chen', 'Weiss', 'Torres', 'Iyer', 'Dubois', 'Castro', 'Nakamura', 'Fischer', 'Ortiz', 'Ali', 'Brooks', 'Silva', 'Wu', 'Grant', 'Rossi', 'Mehta', 'Lopez'];
const people = [];
let k = 0;
for (const [g, n] of Object.entries(GROUPS)) for (let i = 0; i < n; i++, k++) people.push({ id: 'u' + k, name: FIRST[k] + ' ' + LAST[k], group: g, contractor: false, status: 'active' });
// contractors and a departed engineer
people.push({ id: 'u' + k++, name: 'Jules Carter', group: 'Engineering', contractor: true, status: 'active' });
people.push({ id: 'u' + k++, name: 'Wren Abbott', group: 'Engineering', contractor: true, status: 'active' });
people.push({ id: 'u' + k++, name: 'Ivy Lambert', group: 'Data', contractor: true, status: 'active' });
people.push({ id: 'u' + k++, name: 'Owen Price', group: 'Engineering', contractor: false, status: 'departed' });
const inGroup = (g) => people.filter((p) => p.group === g && p.status === 'active').map((p) => p.id);
const byName = (n) => people.find((p) => p.name === n).id;

// ---------- resources (app, label, supported actions) ----------
const resources = [
  ['sf-contact', 'Salesforce', 'Contact', 'Highly Sensitive', ['read', 'export', 'update']],
  ['sf-opp', 'Salesforce', 'Opportunity', 'Confidential', ['read', 'export', 'update', 'delete']],
  ['sf-case', 'Salesforce', 'Case', 'Internal', ['read', 'update']],
  ['sf-perm', 'Salesforce', 'Permission sets', 'Critical', ['read', 'grant_admin']],
  ['sn-rev', 'Snowflake', 'FIN.REVENUE_DAILY', 'Critical', ['read', 'export', 'delete']],
  ['sn-cust', 'Snowflake', 'CUST.CONTACTS', 'Highly Sensitive', ['read', 'export']],
  ['sn-events', 'Snowflake', 'ANALYTICS.EVENTS', 'Internal', ['read', 'export', 'delete']],
  ['sn-comp', 'Snowflake', 'HR.COMPENSATION', 'Highly Sensitive', ['read', 'export']],
  ['gd-board', 'Google Drive', 'Board Materials', 'Highly Sensitive', ['read', 'export', 'share_external']],
  ['gd-contracts', 'Google Drive', 'Customer Contracts', 'Confidential', ['read', 'share_external']],
  ['gd-eng', 'Google Drive', 'Engineering Docs', 'Internal', ['read', 'share_external']],
  ['sl-exec', 'Slack', '#exec-staff', 'Highly Sensitive', ['read', 'export']],
  ['sl-general', 'Slack', '#general', 'Internal', ['read', 'share_external']],
  ['gh-pay', 'GitHub', 'payments-service', 'Critical', ['read', 'write', 'delete', 'grant_admin']],
  ['gh-docs', 'GitHub', 'docs-site', 'Internal', ['read', 'write']],
  ['wd-comp', 'Workday', 'Compensation', 'Highly Sensitive', ['read', 'export']],
  ['db-feat', 'Databricks', 'ml.features', 'Confidential', ['read', 'export', 'delete']],
  ['no-road', 'Notion', 'Product Roadmap', 'Confidential', ['read', 'share_external']],
].map(([id, app, name, label, actions]) => ({ id, app, name, label, actions }));

// ---------- agents (platform, owner, invokers) ----------
const A = (id, name, platform, owner, invokers) => ({ id, name, platform, owner: byName(owner), invokers: invokers.map((x) => (x.startsWith('u') ? x : byName(x))) });
const sales = inGroup('Sales'), eng = inGroup('Engineering'), data = inGroup('Data'), exec = inGroup('Executive'), fin = inGroup('Finance'), hr = inGroup('People');
const agents = [
  A('ag1', 'Keystone Insights AI', 'Claude Code', 'Nancette Exampler', [...data.slice(0, 3), 'Ivy Lambert']),
  A('ag2', 'Helix Process Agent', 'n8n', 'Nancette Exampler', sales.slice(0, 5)),
  A('ag3', 'Horizon Planning Assistant', 'Copilot Studio', 'Emily Johnson', [...exec, ...fin.slice(0, 2)]),
  A('ag4', 'Flux Automation Agent', 'n8n', 'Tracy Admin', [...data, ...fin]),
  A('ag5', 'Apex Decision Engine', 'Codex', 'Emily Johnson', [...eng.slice(0, 5), 'Jules Carter', 'Wren Abbott']),
  A('ag6', 'Lumina Support AI', 'Agentforce', 'Curtis Jones', sales),
  A('ag7', 'Vector Optimization Agent', 'Claude Code', 'Nancette Exampler', [...eng.slice(3, 9), 'Jules Carter']),
  A('ag8', 'Beacon Alerting AI', 'ChatGPT', 'Nancette Exampler', [...sales.slice(2), ...exec.slice(0, 2)]),
  A('ag9', 'Echo Knowledge Agent', 'Claude Cowork', 'Nancette Exampler', [...hr, ...exec.slice(1)]),
  A('ag10', 'Stratus Resource Manager', 'LangGraph (custom)', 'Nancette Exampler', [...fin, ...data.slice(1, 4)]),
  A('ag11', 'Nimbus Coordination Agent', 'Claude Code', 'Nancy Okafor', ['Owen Price', ...eng.slice(6, 9)]),
  A('ag12', 'Prism Intelligence AI', 'Databricks Genie', 'Nancette Exampler', [...data, 'Ivy Lambert']),
  A('ag13', 'Orion Release Bot', 'GitHub Actions agent', 'Owen Price', ['Owen Price', ...eng.slice(0, 2), 'Wren Abbott']),
  A('ag14', 'Quill Contract Assistant', 'ChatGPT', 'Curtis Jones', [...sales.slice(0, 4), ...fin.slice(2)]),
];
// ---------- connections (agent -> app via route, granted actions) ----------
const C = (id, agent, app, route, actions) => ({ id, agent, app, route, actions });
const connections = [
  C('c1', 'ag1', 'Snowflake', 'claude_code', ['read', 'export', 'delete']),
  C('c2', 'ag1', 'GitHub', 'claude_code', ['read', 'write']),
  C('c3', 'ag2', 'Salesforce', 'direct_token', ['read', 'export', 'update']),
  C('c4', 'ag2', 'Google Drive', 'direct_token', ['read', 'share_external']),
  C('c5', 'ag3', 'Google Drive', 'copilot', ['read', 'export', 'share_external']),
  C('c6', 'ag3', 'Salesforce', 'copilot', ['read', 'export']),
  C('c7', 'ag4', 'Snowflake', 'direct_token', ['read', 'export', 'delete']),
  C('c8', 'ag4', 'Slack', 'direct_token', ['read', 'share_external']),
  C('c9', 'ag5', 'GitHub', 'codex', ['read', 'write', 'delete']),
  C('c10', 'ag5', 'Snowflake', 'direct_mcp', ['read', 'export', 'delete']),
  C('c11', 'ag6', 'Salesforce', 'app_native', ['read', 'export', 'update', 'delete']),
  C('c12', 'ag7', 'GitHub', 'claude_code', ['read', 'write', 'delete']),
  C('c13', 'ag7', 'Databricks', 'direct_mcp', ['read', 'export', 'delete']),
  C('c14', 'ag8', 'Salesforce', 'direct_mcp', ['read', 'export']),
  C('c15', 'ag8', 'Slack', 'mcp_proxy', ['read', 'export', 'share_external']),
  C('c16', 'ag9', 'Workday', 'direct_token', ['read', 'export']),
  C('c17', 'ag9', 'Google Drive', 'claude_code', ['read', 'export', 'share_external']),
  C('c18', 'ag10', 'Snowflake', 'gateway', ['read', 'export']),
  C('c19', 'ag10', 'Salesforce', 'gateway', ['read', 'export', 'update']),
  C('c20', 'ag11', 'GitHub', 'direct_token', ['read', 'write', 'delete', 'grant_admin']),
  C('c21', 'ag12', 'Databricks', 'app_native', ['read', 'export', 'delete']),
  C('c22', 'ag13', 'GitHub', 'direct_token', ['read', 'write', 'grant_admin']),
  C('c23', 'ag14', 'Google Drive', 'direct_mcp', ['read', 'share_external']),
  C('c24', 'ag14', 'Notion', 'direct_mcp', ['read', 'share_external']),
  C('c25', 'ag3', 'Salesforce', 'copilot', ['grant_admin']),
];
// ---------- runtime policies (as a security team would write them) ----------
const policies = [
  { id: 'P1', name: 'Block destructive actions on Critical data by contractors\u2019 agents', decision: 'block', severity: 5, subject: { contractor: true }, object: { actions: ['delete', 'write'], labels: ['Critical'] } },
  { id: 'P2', name: 'Block bulk export of Highly Sensitive data outside the Executive team', decision: 'block', severity: 4, subject: { notGroup: 'Executive' }, object: { actions: ['export'], labels: ['Highly Sensitive'] } },
  { id: 'P3', name: 'Require approval to share files or messages externally', decision: 'approval', severity: 3, subject: {}, object: { actions: ['share_external'] } },
  { id: 'P4', name: 'Block any agent from granting admin permissions', decision: 'block', severity: 5, subject: {}, object: { actions: ['grant_admin'] } },
  { id: 'P5', name: 'Block agents acting for departed or suspended users', decision: 'block', severity: 5, subject: { status: ['departed', 'suspended'] }, object: {} },
];
const world = { people, resources, agents, connections, policies };

// ---------- 30 days of activity ----------
const R = Object.fromEntries(resources.map((r) => [r.id, r]));
const actionWeight = { read: 30, update: 6, write: 6, export: 1.6, share_external: 1.0, delete: 0.35, grant_admin: 0.06 };
const events = [];
for (let day = 0; day < 30; day++) {
  const dow = new Date(START + day * 86400000).getUTCDay();
  const busy = dow === 0 || dow === 6 ? 0.25 : 1;
  for (const c of connections) {
    const ag = agents.find((a) => a.id === c.agent);
    const appRes = resources.filter((r) => r.app === c.app);
    for (const pid of ag.invokers) {
      const person = people.find((p) => p.id === pid);
      const rate = (person.status === 'departed' ? 0.35 : 1) * busy * 2.4;
      const nInv = Math.floor(rate * (0.5 + rng() * 1.5));
      for (let i = 0; i < nInv; i++) {
        const opts = [];
        appRes.forEach((r) => c.actions.forEach((a) => { if (r.actions.includes(a)) opts.push([r, a, actionWeight[a] * (r.label === 'Internal' ? 1.6 : 1)]); }));
        if (!opts.length) continue;
        const tot = opts.reduce((s, o) => s + o[2], 0);
        let x = rng() * tot, ch = opts[0];
        for (const o of opts) { x -= o[2]; if (x <= 0) { ch = o; break; } }
        const ts = START + day * 86400000 + Math.floor((dow === 0 || dow === 6 ? 10 : 8 + rng() * 10) * 3600000 + rng() * 3600000);
        events.push({ ts, person: pid, agent: c.agent, conn: c.id, app: c.app, resource: ch[0].id, action: ch[1], rows: ch[1] === 'export' ? Math.round(2000 + rng() * 60000) : undefined });
      }
    }
  }
}
events.sort((a, b) => a.ts - b.ts);

// ---------- precomputed summary (UI recomputes everything live; this is for README/tests) ----------
const cfg = { proxyEffort: 3, gatewayEffort: 6, scopeEffort: 2, invokeEffort: 1, disruptionWeight: 0.25 };
const paths = enumeratePaths(world);
const rp = replayEvents(world, events);
const usage = usageCounts(world, events);
const plan = closurePlan(world, paths, usage, cfg);
const after = bypassAfter(world, plan);
const summary = {
  people: people.length, agents: agents.length, connections: connections.length, resources: resources.length, events: events.length,
  paths: paths.length, bypass: paths.filter((p) => p.bypass).length,
  violating: rp.violating, through: rp.through.length, enforced: rp.enforced.length,
  plan: { fixes: plan.fixes.map((f) => f.key), total: plan.total, lower: plan.lower }, bypassAfter: after.length,
};
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/data.js', import.meta.url), 'window.COVERAGE_DATA = ' + JSON.stringify({ world, events, cfg, start: START, summary }) + ';\n');
writeFileSync(new URL('../data/summary.json', import.meta.url), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log(coverageMatrix(paths, policies));
