# Primitive benchmark runs

Analysis of the eight named dashboard runs completed on 2--3 September 2026 (four models, primitives 1 and 2). The additional unnamed run `20260904_004736_47935112` is excluded because it is a separate session with no primitive/model label.

## Definitions

- `task success`: the run emitted `goal_completed` and its evidence described the requested final state.
- `MCP success`: fraction of `mcp_tool_result` events with `ok=true`. A failed result can be a runtime-health or planning failure that the agent recovered from; it is not automatically a model tool-call error.
- `frames`: executor frames reported in the completion evidence. For runs whose evidence did not include a fraction, the explicit total-frame statement was used.
- `estimated API cost`: input/output token counts from `agent_model_response`, multiplied by the OpenRouter reference prices checked on 3 September 2026. The runs themselves identify `rkapi` as the provider, so this is a normalized price estimate, not an invoice.

## Results

| Primitive | Model | Task | MCP calls | MCP success | Retries | Frames | Input tokens | Output tokens | Model time (s) | Wall time (s) | Est. cost (USD) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Claude Opus 4.8 | pass | 33 | 100.0% | 0 | 95/95 | 20,357 | 4,966 | 206.8 | 619.8 | 0.226 |
| 1 | Claude Opus 5 | pass | 36 | 97.2% | 0 | 58/58 | 24,028 | 5,418 | 244.6 | 583.1 | 0.256 |
| 1 | GPT-5.6 Terra | pass | 38 | 94.7% | 0 | 42/42 | 1,009,900 | 3,836 | 390.7 | 4,598.2 | 2.066 |
| 1 | GPT-5.6 Sol | pass | 36 | 100.0% | 0 | 32/33 | 868,645 | 4,915 | 280.0 | 1,368.3 | 1.786 |
| 2 | Claude Opus 4.8 | pass | 73 | 90.4% | 0 | 430/430 | 44,328 | 8,881 | 408.0 | 1,525.0 | 0.444 |
| 2 | Claude Opus 5 | pass | 45 | 97.8% | 0 | 385/385 | 32,149 | 7,888 | 327.6 | 1,020.9 | 0.358 |
| 2 | GPT-5.6 Terra | pass | 54 | 96.3% | 8 | 309/309 | 1,415,079 | 10,189 | 731.2 | 1,997.2 | 2.952 |
| 2 | GPT-5.6 Sol | pass | 17 | 100.0% | 1 | 309/309 | 241,231 | 4,612 | 234.4 | 554.7 | 0.529 |

## Interpretation

All eight named runs reached the requested final state. Primitive 2 is more discriminating: Opus 4.8 required 73 MCP calls and had seven failed MCP results during planning/recovery; Terra required eight provider retries and two failed MCP results; Sol completed with 17 calls and no failed MCP result, although one intermediate completion check was rejected before final validation. The failures are mostly recorded as runtime health/planning events, so they should be reported as recovery burden rather than labelled hallucinations without inspecting the individual tool arguments.

The very large input-token totals for Terra and Sol indicate repeated context transmission/compaction behaviour and dominate their normalized OpenRouter cost. Wall time includes deliberate dashboard waits and provider latency, so it should not be interpreted as pure hardware execution time. Frame count is a useful execution workload proxy; final-state success and safety/tool correctness remain the primary endpoints.

## Recommended reporting columns

For the manuscript, report per primitive and model: final-state success (binary), stage completion, valid tool-call rate, failed calls by category (schema/argument, planning, runtime health), recovery count, human interventions, frames executed/planned, model latency, wall time, input/output tokens, context-compaction count, and normalized cost. Keep the raw run ID beside every aggregate so the result remains auditable.

Raw source files are the corresponding `runs/<run-id>/run.json` and `events.jsonl` bundles.
