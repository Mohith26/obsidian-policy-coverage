# Policy Coverage for Obsidian Runtime Security (concept demo)

**Live demo:** https://mohith26.github.io/obsidian-policy-coverage/

Unofficial concept demo by Mohith Gajjela. Not affiliated with Obsidian Security. All data is synthetic. Defensive tooling only: it finds and closes gaps in a security team's own policy enforcement.

## What it is

Obsidian's Runtime Policy Decision Engine (Nov 10, 2026) lets a security team write one set of agent policies and enforce them at several points: Claude Code / Cowork hooks, the Codex sidecar, the MCP Security Proxy, the Policy Decision API in customer gateways, and native platform webhooks. A policy is only as strong as the routes that consult it. An agent that reaches Snowflake through a direct MCP connection, an n8n workflow holding a raw API token, or an app-native agent (Agentforce, Databricks Genie) never asks the engine. Obsidian's own posts call out that direct MCP connections bypass security's controls.

**Coverage** is a new tab next to Events / Policies / Exceptions that answers, for every policy:

1. **Which agent action paths does this policy target that no enforcement point governs?** Paths are enumerated over the Knowledge Graph: person -> agent -> connection (route) -> resource -> action, matched against each policy's subject and object predicates. A path is a bypass if its route can't enforce the policy's decision. Example: the Copilot Studio webhook can block but can't require approval, so an approval policy is only partly covered there.
2. **Did it matter?** It replays 30 days of activity (which Obsidian already ingests from app audit logs, including for direct routes) through the policies. It counts the actions a policy would have stopped that went through because their route couldn't enforce it.
3. **What is the cheapest way to close every gap?** It builds a closure plan from three fix types: route a connection through an enforcement point (MCP Security Proxy for supported apps, the Policy Decision API for tokens), remove an action from a connection's grant, or stop a person invoking an agent. Each fix is costed by effort plus the legitimate 30-day actions it would break. For one policy, finding the cheapest set of fixes that leaves no bypass path is an s-t minimum cut, solved exactly with Dinic's max-flow. Policies are solved in severity order, with fixes already chosen costing zero. Redundant steps are then pruned. A lower bound (the largest single-policy optimum) is reported next to the plan cost. The plan is re-verified by enumerating every path again on the patched graph.

## Demo tenant (seeded, `scripts/generate.mjs`)

36 people (3 contractors, 1 departed engineer), 14 agents across Claude Code, Codex, Claude Cowork, Copilot Studio, Agentforce, Databricks Genie, n8n, ChatGPT, a custom LangGraph agent behind a gateway, and a GitHub Actions bot. 25 connections, 18 labeled resources in 8 apps, 5 policies, and 8,412 agent actions over Oct 11 - Nov 9, 2026.

Results computed by the page:

| | value |
|---|---|
| Bypass paths (agent, connection, resource, action) | 32 across 10 agents and 13 connections |
| Policy-violating actions in 30 days | 491 |
| ...enforced | 380 |
| ...went through on ungoverned routes | 111 |
| Closure plan (default weights) | 14 changes: 4 connections routed through an enforcement point, 9 scope removals, 1 invoker stop. 0 bypass paths left |
| Plan cost vs lower bound | 40.25 vs 21.25 |

A slider changes how much a broken legitimate action costs relative to migration effort, and the plan is recomputed live.

## Tests

```
node scripts/generate.mjs
node --test test/coverage.test.mjs   # 7 tests
```
- Dinic max-flow returns the textbook value
- route capability semantics (block-only vs approval)
- policy predicates
- **min-cut cost equals the brute-force optimum** over every subset of fixes, on 40 random tenants (at least 15 non-trivial)
- the combined plan always closes every bypass path and never costs less than its lower bound
- the coverage matrix accounts for every path
- replay separates enforced from went-through actions by route

## Honest limitations

- Synthetic tenant and activity. Route capabilities are my reading of Obsidian's public posts (e.g. Copilot Studio as block-only, app-native agents with discovery but no runtime enforcement) and may not match the product exactly.
- Policies are simple attribute predicates (contractor, group, status, action, label, app), not Obsidian's policy language.
- The per-policy plan is optimal. The combined multi-policy plan is a sequential exact-then-prune heuristic, so it can cost more than the true joint optimum (here 40.25 vs a 21.25 lower bound). A joint ILP would close that gap at higher cost.
- Fix costs (effort points, disruption weight) are made-up defaults for illustration.
- Scope removal assumes per-action grants. Real OAuth scopes are often coarser, which would raise those costs.
- No offensive content: the tool only reasons about a tenant's own policies, routes and logs.

## Novelty note

As of Nov 10, 2026, Obsidian ships agent discovery, toxic-combination scoring, reachable-path views, blast radius for integrations, sanctioned/unsanctioned MCP inventory, and (new today) the Runtime Policy Decision Engine with four enforcement points. I found no public description of a per-policy coverage view (which targeted paths no enforcement point governs), a replay of would-be blocks that went through, or a min-cut closure plan. Speakeasy defines "MCP gateway bypass" as a concept, but I found no product that computes coverage per policy.
