---
status: awaiting_human_verify
trigger: "Investigate issue: bot-cannot-move-or-execute-actions"
created: 2026-03-08T17:58:28Z
updated: 2026-03-08T20:03:13Z
---

## Current Focus

hypothesis: Local exploration fallback + malformed-action normalization can remove queue-drain LLM stalls and invalid_state escalations, while keeping action chains productive.
test: Validate runtime logs for `local-explore queue-ready`, `filled-missing-target`, and reduced `invalid_state` incidence; re-run lint/typecheck.
expecting: immediate follow-up dispatch after queue drain (gap ~0-2ms), fewer malformed-action escalations, and more sustained move/break execution without 3-7s pauses.
next_action: request in-game human verification on latest build

## Symptoms

expected: Bot should execute action queues end-to-end (move, break, craft, etc.), not just chat.
actual: Bot mostly only sends chat; movement/action execution appears stuck or absent.
errors: Runtime logs intermittently show prompt/model failures.
reproduction: Repeat this loop until behavior is stable: (1) run `npm start` and read console output, (2) identify and fix issues, (3) improve logging to expose model inputs/outputs and runtime state (action queue, position, current action, planner/executor flow), adding more diagnostics as needed.
started: Reported in current state of the project; chat path was fixed in a separate earlier session.

## Eliminated

- hypothesis: Tactical planner never returns from Model B calls.
  evidence: Runtime showed a second TacticalPlanner trigger with `trigger=executor-result`, which only happens after a queue-ready action executes and emits executor result.
  timestamp: 2026-03-08T18:04:04Z

## Evidence

- timestamp: 2026-03-08T17:58:48Z
  checked: Repository layout and source modules
  found: Planner (`src/planner/*`), executor (`src/executor/*`), and movement/inventory skills all exist with integration tests.
  implication: Missing capabilities are unlikely; investigation should focus on runtime wiring, model outputs, and action dispatch flow.
- timestamp: 2026-03-08T17:59:49Z
  checked: Runtime startup via `npm start` in sandbox
  found: Process failed at `tsx` bootstrap with `listen EPERM` on `/var/folders/.../tsx-501/*.pipe` before app logic started.
  implication: Need escalated run permissions to gather valid bot runtime evidence; this failure is environmental, not application logic.
- timestamp: 2026-03-08T18:01:54Z
  checked: Escalated 45-second runtime logs
  found: Bot spawned and strategic plan became ready, then TacticalPlanner logged two "calling Model B" messages, but no tactical result/executor-action logs appeared before shutdown.
  implication: Non-chat execution is blocked downstream of Model B invocation (response handling, failure handling, or dispatch), not in spawn/strategic plan generation.
- timestamp: 2026-03-08T18:04:04Z
  checked: Runtime wiring and executor skill implementations (`src/index.ts`, `src/executor/*`)
  found: `initializeApplication` dispatches `executeAction(nextAction)` without dependencies; `move_to`/`follow_entity` hard-fail without `movementCoordinator`; several non-chat skills only run real work when runtime `attempt` behavior is injected.
  implication: Current runtime can plan actions but cannot reliably execute non-chat actions due missing executor dependency injection and missing bot-bound action attempt wiring.
- timestamp: 2026-03-08T18:50:19Z
  checked: Runtime logs + break skill wrapper (`/tmp/gsd-debug-start.log`, `src/index.ts`)
  found: log shows `result skill=break_block ... durationMs=3885`; `break_block` runtime attempt awaits `collectNearbyDrop`, which races movement with a 2500ms timeout on every successful dig.
  implication: break actions incur avoidable built-in delay before planner handoff; this directly contributes to 3–7s perceived downtime between break actions.
- timestamp: 2026-03-08T18:56:02Z
  checked: Static validation (`npm run typecheck`, `npm run lint`)
  found: both commands completed successfully after applying fast-path + logging changes.
  implication: patch compiles and lints cleanly.
- timestamp: 2026-03-08T18:56:02Z
  checked: 55-second runtime log capture (`/tmp/gsd-debug-start.log`)
  found: `executor-fast-path` dispatches show `gapSinceResultMs=0..1`; TacticalPlanner logs `fast-path skipping model call` while queue has pending actions; break successes now around `durationMs=3002..3235` (previous evidence had `3885`).
  implication: inter-action queue handoff latency is reduced to near-zero for queued break chains, with tactical replanning retained on queue drain/failure.
- timestamp: 2026-03-08T19:03:13Z
  checked: 60-second runtime log capture (`/tmp/gsd-debug-start-3.log`) after break retarget patch
  found: repeated `break_block retarget from=(...) to=(...) type=birch_log` entries followed by `result skill=break_block success=true` and fewer immediate `target_unavailable` failures in the same flow.
  implication: runtime now recovers stale break coordinates locally, reducing needless failure/replan loops.
- timestamp: 2026-03-08T20:03:13Z
  checked: runtime captures (`/tmp/gsd-debug-start-6.log`, `/tmp/gsd-debug-start-7.log`) after malformed-action normalization + local exploration fallback
  found: invalid_state spikes from missing break/craft params were eliminated in the latest run; queue-drain now shows immediate local follow-up (`local-explore queue-ready`, `gapSinceResultMs=0..2`) instead of waiting for model response on every move step.
  implication: core latency bottleneck shifted away from planner round-trips during exploration, matching desired “continuous motion/action” behavior more closely.

## Resolution

root_cause: Multi-factor latency/instability loop: (1) queued action chains were interrupted by frequent tactical round-trips after queue drain; (2) stale/malformed model actions (`break_block` missing/invalid targets, `craft_item` schema mismatches) triggered invalid_state/escalation churn; (3) post-break drop collection previously added fixed idle.
fix: Added runtime executor fast-path + tactical skip for pending queues; reduced post-break drop-collection cap; added break-target retarget + missing-target fill; normalized craft_item payloads (`recipe/count` -> `item/quantity` + inferred inventory/recipes); added local exploration queue fallback for wood goals to keep movement continuous between planner calls.
verification: `npm run lint` PASS; `npm run typecheck` PASS; runtime logs show immediate local follow-ups (`gapSinceResultMs=0..2`) and `local-explore queue-ready` continuity in latest capture.
files_changed: [src/index.ts, src/planner/TacticalPlanner.ts, .planning/debug/bot-cannot-move-or-execute-actions.md]
