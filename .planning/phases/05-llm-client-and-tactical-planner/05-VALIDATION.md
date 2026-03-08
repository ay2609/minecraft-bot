---
phase: 5
slug: llm-client-and-tactical-planner
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Hand-rolled `assert()` + `async run()` pattern (established in Phase 4) |
| **Config file** | None — tests run as standalone tsx scripts |
| **Quick run command** | `npx tsx src/planner/FireworksLLMClient.test.ts && npx tsc --noEmit` |
| **Full suite command** | `npx tsx src/planner/FireworksLLMClient.test.ts && npx tsx src/planner/TacticalPlanner.test.ts && npx tsc --noEmit && npx eslint src --ext .ts` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsx src/planner/FireworksLLMClient.test.ts && npx tsc --noEmit`
- **After every plan wave:** Run `npx tsx src/planner/FireworksLLMClient.test.ts && npx tsx src/planner/TacticalPlanner.test.ts && npx tsc --noEmit && npx eslint src --ext .ts`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 0 | PLAN-01 | unit | `npx tsx src/planner/FireworksLLMClient.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 0 | PLAN-02 | unit | `npx tsx src/planner/TacticalPlanner.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | PLAN-01 | unit | `npx tsx src/planner/FireworksLLMClient.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 1 | PLAN-02 | unit | `npx tsx src/planner/TacticalPlanner.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 1 | PLAN-01+02 | unit | `npx tsx src/planner/FireworksLLMClient.test.ts && npx tsx src/planner/TacticalPlanner.test.ts` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 2 | PLAN-01+02 | integration | manual smoke test against live Fireworks API | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/planner/FireworksLLMClient.ts` — module under test (create stubs if not yet implemented)
- [ ] `src/planner/FireworksLLMClient.test.ts` — stubs for PLAN-01 retry, error class, finish_reason cases
- [ ] `src/planner/TacticalPlanner.ts` — module under test (create stubs if not yet implemented)
- [ ] `src/planner/TacticalPlanner.test.ts` — stubs for PLAN-02 trigger policy, WAIT fallback, churn, escalation
- [ ] `src/planner/tacticalSchema.ts` — Zod schema used by both planner and tests
- [ ] `src/planner/systemPrompts.ts` — Model B system prompt

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Fireworks API call returns valid JSON action queue | PLAN-01 + PLAN-02 | Requires live API key and network; not safe for CI | Start bot with valid `FIREWORKS_API_KEY`, trigger a goal, observe `tactical:queue-ready` event emitted with valid ActionQueue JSON |
| Bot makes observable progress on simple goal (move + break) | PLAN-02 | End-to-end runtime behavior | Set goal to reach block at known coords and break it; confirm bot executes `move_to` then `break_block` without human intervention |
| WAIT action emitted on unrecoverable parse failure | PLAN-02 | Requires forcing JSON parse failure via mocked LLM | Swap FireworksLLMClient with stub that always returns invalid JSON; confirm `tactical:queue-ready` emits WAIT action and logs diagnostic |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
