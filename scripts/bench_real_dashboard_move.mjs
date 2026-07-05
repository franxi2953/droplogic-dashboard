import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const resultsRoot = path.join(repoRoot, "benchmarks", "results", "real-dashboard-move");

const args = parseArgs(process.argv.slice(2));
const mustAcknowledge = Boolean(args["i-understand-this-moves-hardware"]);
if (!mustAcknowledge) {
  console.error("Refusing to run: add --i-understand-this-moves-hardware because this benchmark sends frames to the real electrode matrix.");
  process.exit(2);
}

const dashboardUrl = args.url || "http://127.0.0.1:8787";
const frameDelay = Number(args["frame-delay"] || 1);
const system = args.system || "boxmini";
const pattern = args.pattern || "long_parallel";
const headed = Boolean(args.headed);
const outputDir = path.resolve(
  repoRoot,
  args.output || path.join("benchmarks", "results", "real-dashboard-move", timestampForPath()),
);
const resetSystem = args["no-reset-system"] ? false : true;
const createNewRun = args["same-run"] ? false : true;
const voltageProfile = parseVoltageProfile(args.voltages || "60,55,55,55,55,55,55,55,55");
const executionViewMode = args["execution-view-mode"] || "whole_chip_camera";

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseVoltageProfile(raw) {
  const values = String(raw || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((value) => Number.isFinite(value));
  return values.length ? values : [60, 55, 55, 55, 55, 55, 55, 55, 55];
}

function movementPattern(name) {
  if (name === "reservoir_extract_15") {
    return {
      kind: "reservoir_extract_move",
      reservoir_id: 1,
      extracted_count: 15,
      move_batch_size: 2,
      delete_reservoir_after_extraction: true,
      reservoir: {
        id: 1,
        origin: [49, 6],
        target: [49, 6],
        width: 15,
        height: 30,
        vital_space: 2,
      },
      extraction: {
        reservoir_droplet_id: 1,
        split_mode: "linear",
        linear_drops_number: 15,
        linear_offset: 2,
        linear_space_per_col: 4,
        linear_space_per_row: 4,
        linear_drop_shape: [2, 2],
        linear_direction: [0, 1],
        linear_vital_space: 2,
        linear_post_separation_steps: 3,
        remove_duplicate_frames: false,
      },
      target_cols: [116, 108, 100, 92, 84, 76, 68, 60],
      target_rows: [8, 32, 56, 80, 104],
    };
  }
  if (name === "random5") {
    return {
      kind: "direct_move",
      droplets: [
        { id: 1, origin: [18, 18], target: [18, 18], width: 2, height: 2, vital_space: 2 },
        { id: 2, origin: [18, 48], target: [18, 48], width: 2, height: 2, vital_space: 2 },
        { id: 3, origin: [48, 18], target: [48, 18], width: 2, height: 2, vital_space: 2 },
        { id: 4, origin: [48, 48], target: [48, 48], width: 2, height: 2, vital_space: 2 },
        { id: 5, origin: [78, 32], target: [78, 32], width: 2, height: 2, vital_space: 2 },
      ],
      targets: [
        { id: 1, target: [34, 72] },
        { id: 2, target: [72, 34] },
        { id: 3, target: [96, 62] },
        { id: 4, target: [82, 92] },
        { id: 5, target: [56, 96] },
      ],
    };
  }
  return {
    kind: "direct_move",
    droplets: [
      { id: 1, origin: [18, 12], target: [18, 12], width: 2, height: 2, vital_space: 2 },
      { id: 2, origin: [38, 12], target: [38, 12], width: 2, height: 2, vital_space: 2 },
      { id: 3, origin: [58, 12], target: [58, 12], width: 2, height: 2, vital_space: 2 },
      { id: 4, origin: [78, 12], target: [78, 12], width: 2, height: 2, vital_space: 2 },
      { id: 5, origin: [98, 12], target: [98, 12], width: 2, height: 2, vital_space: 2 },
    ],
    targets: [
      { id: 1, target: [18, 108] },
      { id: 2, target: [38, 108] },
      { id: 3, target: [58, 108] },
      { id: 4, target: [78, 108] },
      { id: 5, target: [98, 108] },
    ],
  };
}

async function waitForDashboardReady(page) {
  await page.goto(dashboardUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#matrixScene", { state: "attached", timeout: 20000 });
  await page.waitForFunction(
    () => window.__droplogicDebug?.state?.ws?.readyState === WebSocket.OPEN,
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(300);
}

async function sendDashboardMessage(page, message, waitForType = "", timeoutMs = 30000) {
  return page.evaluate(({ message, waitForType, timeoutMs }) => new Promise((resolve, reject) => {
    const ws = window.__droplogicDebug?.state?.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error("Dashboard WebSocket is not open."));
      return;
    }
    if (!waitForType) {
      ws.send(JSON.stringify(message));
      resolve({ ok: true });
      return;
    }
    const started = performance.now();
    let done = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      ws.removeEventListener("message", handler);
    };
    const finish = (payload) => {
      if (done) return;
      done = true;
      cleanup();
      resolve({ duration_ms: performance.now() - started, message: payload });
    };
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(`Timed out waiting for ${waitForType}`));
    }, timeoutMs);
    const handler = (event) => {
      let data = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data?.type === waitForType) finish(data);
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify(message));
  }), { message, waitForType, timeoutMs });
}

async function callTool(page, tool, toolArgs = {}, timeoutMs = 180000) {
  const call = await page.evaluate(({ tool, toolArgs, timeoutMs }) => new Promise((resolve, reject) => {
    const ws = window.__droplogicDebug?.state?.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error("Dashboard WebSocket is not open."));
      return;
    }
    const started = performance.now();
    let done = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      ws.removeEventListener("message", handler);
    };
    const finish = (payload) => {
      if (done) return;
      done = true;
      cleanup();
      resolve({ duration_ms: performance.now() - started, message: payload });
    };
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(`Timed out waiting for tool_result: ${tool}`));
    }, timeoutMs);
    const handler = (event) => {
      let data = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data?.type === "tool_result" && data?.event?.tool === tool) finish(data);
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ type: "mcp_tool", tool, arguments: toolArgs || {} }));
  }), { tool, toolArgs, timeoutMs });
  const payload = decodeToolPayload(call.message?.result);
  const event = call.message?.event || {};
  const ok = event.ok !== false && payload?.ok !== false && !payload?.error && !payload?.isError;
  return {
    tool,
    arguments: toolArgs,
    duration_ms: Number(call.duration_ms.toFixed(2)),
    ok,
    dashboard_timing: event.dashboard_timing || null,
    event,
    payload,
  };
}

function decodeToolPayload(raw) {
  if (!raw || typeof raw !== "object") return raw;
  if (raw.structuredContent?.result !== undefined) return raw.structuredContent.result;
  if (raw.structuredContent !== undefined) return raw.structuredContent;
  if (raw.result !== undefined && typeof raw.result !== "string") return raw.result;
  if (Array.isArray(raw.content)) {
    for (const part of raw.content) {
      if (part?.structuredContent?.result !== undefined) return part.structuredContent.result;
      if (part?.structuredContent !== undefined) return part.structuredContent;
      if (typeof part?.text === "string") {
        const parsed = parseJsonMaybe(part.text);
        if (parsed !== null) return parsed?.result !== undefined ? parsed.result : parsed;
      }
    }
  }
  return raw;
}

function parseJsonMaybe(text) {
  const value = String(text || "").trim();
  if (!value || !"[{".includes(value[0])) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function assertToolOk(call) {
  if (call.ok) return;
  throw new Error(`${call.tool} failed: ${JSON.stringify(call.payload || call.event || {}, null, 2)}`);
}

function getPath(root, dotted) {
  let current = root;
  for (const key of dotted.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function plannedFrameCount(planCall) {
  return firstFinite(
    getPath(planCall.payload, "plan.frame_count"),
    getPath(planCall.payload, "result.plan.frame_count"),
    getPath(planCall.payload, "frame_count"),
    getPath(planCall.payload, "failed_plan.frame_count"),
  );
}

function summarizeNumbers(values) {
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return { count: 0 };
  const pick = (p) => clean[Math.min(clean.length - 1, Math.max(0, Math.round((clean.length - 1) * p)))];
  return {
    count: clean.length,
    min: Number(clean[0].toFixed(6)),
    median: Number(pick(0.5).toFixed(6)),
    p95: Number(pick(0.95).toFixed(6)),
    max: Number(clean[clean.length - 1].toFixed(6)),
    mean: Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(6)),
  };
}

function executionMetrics(frameHistory, frameDelaySeconds, plannedPhases = []) {
  const frames = Array.isArray(frameHistory?.frames) ? frameHistory.frames : [];
  const durations = frames.map((frame) => frame.duration_seconds).filter((value) => Number.isFinite(Number(value))).map(Number);
  const startPeriods = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = Number(frames[index - 1]?.started_at);
    const current = Number(frames[index]?.started_at);
    if (Number.isFinite(previous) && Number.isFinite(current)) {
      startPeriods.push(current - previous);
    }
  }
  const matrixLatencies = frames
    .map((frame) => frame.matrix_queue_wait?.high_queue?.command_latency_seconds)
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);
  const firstStarted = firstFinite(...frames.map((frame) => frame.started_at));
  const lastFinished = firstFinite(...[...frames].reverse().map((frame) => frame.finished_at));
  const actual = firstStarted !== null && lastFinished !== null ? lastFinished - firstStarted : null;
  const nominal = frames.length * frameDelaySeconds;
  const medianFrame = summarizeNumbers(durations).median || 0;
  const periodExpected = frames.length > 0
    ? Math.max(0, frames.length - 1) * frameDelaySeconds + medianFrame
    : 0;
  return {
    executed_frame_count: frames.length,
    actual_executor_seconds: actual === null ? null : Number(actual.toFixed(4)),
    nominal_expected_seconds: Number(nominal.toFixed(4)),
    period_expected_seconds: Number(periodExpected.toFixed(4)),
    nominal_error_seconds: actual === null ? null : Number((actual - nominal).toFixed(4)),
    period_error_seconds: actual === null ? null : Number((actual - periodExpected).toFixed(4)),
    frame_start_period_summary: summarizeNumbers(startPeriods),
    frame_duration_summary: summarizeNumbers(durations),
    matrix_command_latency_summary: summarizeNumbers(matrixLatencies),
    timing_evolution_bins: executionTimingBins(frames, frameDelaySeconds, 10),
    phase_timing: executionPhaseTiming(frames, plannedPhases, frameDelaySeconds),
    slowest_frames: [...frames]
      .sort((a, b) => Number(b.duration_seconds || 0) - Number(a.duration_seconds || 0))
      .slice(0, 12),
  };
}

function frameTimingSummary(frames, frameDelaySeconds) {
  const selected = Array.isArray(frames) ? frames : [];
  const durations = selected
    .map((frame) => Number(frame?.duration_seconds))
    .filter(Number.isFinite);
  const matrixLatencies = selected
    .map((frame) => Number(frame?.matrix_queue_wait?.high_queue?.command_latency_seconds))
    .filter(Number.isFinite);
  const startPeriods = [];
  for (let index = 1; index < selected.length; index += 1) {
    const previous = Number(selected[index - 1]?.started_at);
    const current = Number(selected[index]?.started_at);
    if (Number.isFinite(previous) && Number.isFinite(current)) {
      startPeriods.push(current - previous);
    }
  }
  const firstStarted = firstFinite(...selected.map((frame) => frame.started_at));
  const lastStarted = firstFinite(...[...selected].reverse().map((frame) => frame.started_at));
  const startPeriodActual = firstStarted !== null && lastStarted !== null ? lastStarted - firstStarted : null;
  const startPeriodExpected = Math.max(0, selected.length - 1) * frameDelaySeconds;
  return {
    frame_count: selected.length,
    frame_range: selected.length
      ? [Number(selected[0]?.index), Number(selected[selected.length - 1]?.index)]
      : null,
    start_period_actual_seconds: startPeriodActual === null ? null : Number(startPeriodActual.toFixed(4)),
    start_period_expected_seconds: Number(startPeriodExpected.toFixed(4)),
    start_period_error_seconds: startPeriodActual === null ? null : Number((startPeriodActual - startPeriodExpected).toFixed(4)),
    start_period_summary: summarizeNumbers(startPeriods),
    frame_duration_summary: summarizeNumbers(durations),
    matrix_command_latency_summary: summarizeNumbers(matrixLatencies),
  };
}

function executionTimingBins(frames, frameDelaySeconds, binCount) {
  if (!frames.length) return [];
  const bins = [];
  const safeBinCount = Math.max(1, Math.min(Number(binCount) || 1, frames.length));
  for (let bin = 0; bin < safeBinCount; bin += 1) {
    const start = Math.floor((bin * frames.length) / safeBinCount);
    const end = Math.floor(((bin + 1) * frames.length) / safeBinCount);
    const selected = frames.slice(start, Math.max(start + 1, end));
    bins.push({
      bin: bin + 1,
      ...frameTimingSummary(selected, frameDelaySeconds),
    });
  }
  return bins;
}

function executionPhaseTiming(frames, phases, frameDelaySeconds) {
  return (phases || []).map((phase) => {
    const start = Number(phase.start_frame);
    const end = Number(phase.end_frame);
    const selected = frames.filter((frame) => {
      const index = Number(frame?.index);
      return Number.isFinite(index) && index >= start && index <= end;
    });
    return {
      ...phase,
      timing: frameTimingSummary(selected, frameDelaySeconds),
    };
  });
}

async function readRunEvents(runId) {
  if (!runId) return [];
  const eventsPath = path.join(repoRoot, "runs", runId, "events.jsonl");
  if (!fsSync.existsSync(eventsPath)) return [];
  const text = await fs.readFile(eventsPath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function summarizeDashboardEvents(events) {
  const toolResults = events.filter((event) => event.type === "mcp_tool_result");
  const counts = {};
  const timings = [];
  for (const event of toolResults) {
    const tool = String(event.tool || "?");
    counts[tool] = (counts[tool] || 0) + 1;
    const timing = event.dashboard_timing || {};
    if (Number.isFinite(Number(timing.tool_total_seconds))) {
      timings.push({
        tool,
        tool_total_seconds: Number(timing.tool_total_seconds),
        mcp_call_seconds: Number(timing.mcp_call_seconds ?? timing.mcp_total_seconds ?? NaN),
        mcp_lock_wait_seconds: Number(timing.mcp_lock_wait_seconds ?? NaN),
      });
    } else if (Number.isFinite(Number(timing.mcp_total_seconds))) {
      timings.push({
        tool,
        tool_total_seconds: Number(timing.mcp_total_seconds),
        mcp_call_seconds: Number(timing.mcp_call_seconds ?? timing.mcp_total_seconds),
        mcp_lock_wait_seconds: Number(timing.mcp_lock_wait_seconds ?? NaN),
      });
    }
  }
  return {
    event_count: events.length,
    tool_result_counts: counts,
    tool_total_summary: summarizeNumbers(timings.map((item) => item.tool_total_seconds)),
    mcp_call_summary: summarizeNumbers(timings.map((item) => item.mcp_call_seconds)),
    slowest_tools: timings
      .sort((a, b) => b.tool_total_seconds - a.tool_total_seconds)
      .slice(0, 10),
  };
}

function dropletListFromSummary(payload) {
  const droplets = Array.isArray(payload?.droplets) ? payload.droplets : [];
  return droplets
    .map((droplet) => ({
      id: Number(droplet.id),
      active: droplet.active === true,
      current_position: pairOrNull(droplet.current_position),
      target_position: pairOrNull(droplet.target_position),
      vital_space: Number(droplet.vital_space),
      shape_size: Number(droplet.shape_size),
    }))
    .filter((droplet) => Number.isFinite(droplet.id) && droplet.current_position);
}

function pairOrNull(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const row = Number(value[0]);
  const col = Number(value[1]);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return [row, col];
}

function buildReservoirMoveBatches(summaryPayload, scenario) {
  const activeDroplets = dropletListFromSummary(summaryPayload).filter((droplet) => droplet.active);
  const reservoirId = Number(scenario.reservoir_id);
  const extracted = activeDroplets.filter((droplet) => droplet.id !== reservoirId);
  if (extracted.length !== Number(scenario.extracted_count)) {
    throw new Error(`Expected ${scenario.extracted_count} extracted active droplets, found ${extracted.length}.`);
  }
  const sorted = [...extracted].sort((a, b) => {
    const colDelta = Number(b.current_position[1]) - Number(a.current_position[1]);
    if (colDelta !== 0) return colDelta;
    return Number(a.current_position[0]) - Number(b.current_position[0]);
  });
  const batches = [];
  const batchSize = Math.max(1, Number(scenario.move_batch_size) || 5);
  for (let offset = 0; offset < sorted.length; offset += batchSize) {
    const batchIndex = Math.floor(offset / batchSize);
    const droplets = sorted
      .slice(offset, offset + batchSize)
      .sort((a, b) => Number(a.current_position[0]) - Number(b.current_position[0]));
    const targetCol = Number(scenario.target_cols?.[batchIndex] ?? Math.max(12, 116 - batchIndex * 20));
    const targetRows = targetRowsForCount(droplets.length, scenario.target_rows || []);
    const targets = droplets.map((droplet, index) => ({
      id: droplet.id,
      target: [targetRows[index], targetCol],
    }));
    batches.push({
      name: `move_batch_${batchIndex + 1}`,
      droplet_ids: droplets.map((droplet) => droplet.id),
      targets,
    });
  }
  return batches;
}

function targetRowsForCount(count, preferredRows) {
  const rows = (preferredRows || []).map(Number).filter(Number.isFinite);
  if (rows.length >= count) {
    if (count <= 1) return [rows[Math.floor(rows.length / 2)]];
    return Array.from({ length: count }, (_, index) => {
      const sourceIndex = Math.round(((rows.length - 1) * index) / (count - 1));
      return rows[sourceIndex];
    });
  }
  if (count <= 1) return [64];
  const minRow = 8;
  const maxRow = 104;
  return Array.from({ length: count }, (_, index) => Math.round(minRow + ((maxRow - minRow) * index) / (count - 1)));
}

function targetsWithCurrentResets(activeDroplets, batchTargets) {
  const batchById = new Map(batchTargets.map((target) => [Number(target.id), target]));
  return activeDroplets.map((droplet) => {
    const batchTarget = batchById.get(Number(droplet.id));
    if (batchTarget) return batchTarget;
    return { id: Number(droplet.id), target: droplet.current_position };
  });
}

async function clickIfVisible(page, selector) {
  try {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 700 })) {
      await locator.click({ timeout: 1500 });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function main() {
  if (!Number.isFinite(frameDelay) || frameDelay <= 0) {
    throw new Error("--frame-delay must be a positive number.");
  }
  await fs.mkdir(outputDir, { recursive: true });
  const scenario = movementPattern(pattern);
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1040 },
    recordVideo: { dir: outputDir, size: { width: 1680, height: 1040 } },
  });
  const page = await context.newPage();
  const toolCalls = [];
  let runId = "";
  let videoPath = "";
  try {
    await waitForDashboardReady(page);
    await clickIfVisible(page, '[data-bottom-tab="state"]');
    if (createNewRun) {
      await sendDashboardMessage(page, { type: "new_run" }, "run_loaded", 30000);
    }
    runId = await page.evaluate(() => window.__droplogicDebug?.state?.status?.run_id || "");

    const call = async (tool, toolArgs, timeoutMs) => {
      const result = await callTool(page, tool, toolArgs, timeoutMs);
      toolCalls.push({
        tool: result.tool,
        ok: result.ok,
        duration_ms: result.duration_ms,
        dashboard_timing: result.dashboard_timing,
        payload_summary: compactPayloadSummary(result.payload),
      });
      assertToolOk(result);
      return result;
    };
    const planMoveAndWait = async (toolArgs, label, timeoutMs = 900000) => {
      const started = await call("plan_move", { ...toolArgs, background: true }, 300000);
      let latest = started;
      const startedAt = performance.now();
      while (latest.payload?.completed !== true) {
        if (performance.now() - startedAt > timeoutMs) {
          throw new Error(`Timed out waiting for background plan_move (${label}).`);
        }
        if (latest.payload?.running === false && latest.payload?.ok === false) {
          throw new Error(`Background plan_move failed (${label}): ${JSON.stringify(latest.payload, null, 2)}`);
        }
        await page.waitForTimeout(5000);
        latest = await call("planning_job_status", {}, 60000);
      }
      if (latest.payload?.ok === false || latest.payload?.error) {
        throw new Error(`Background plan_move failed (${label}): ${JSON.stringify(latest.payload, null, 2)}`);
      }
      return latest;
    };

    if (resetSystem) {
      await call("restart_system", { system, reset_matrix: true }, 240000);
    } else {
      await call("runtime_status", { detail: "compact" }, 30000);
      await call("set_matrix_cells", {
        value: 0,
        row_min: 0,
        row_max: 127,
        col_min: 0,
        col_max: 127,
        wait_for_queue: true,
        queue_timeout_seconds: 20,
      }, 60000);
    }

    await call("set_matrix_voltage", { values: voltageProfile }, 60000);
    const plannedPhases = [];
    const plannedTargets = [];
    let frameCount = null;
    let previousFrameCount = 0;
    const recordPhase = (name, type, planCall, metadata = {}) => {
      const totalFrames = plannedFrameCount(planCall);
      const phase = {
        name,
        type,
        start_frame: previousFrameCount,
        end_frame: totalFrames === null ? null : Math.max(previousFrameCount, totalFrames - 1),
        frame_count: totalFrames === null ? null : Math.max(0, totalFrames - previousFrameCount),
        ...metadata,
      };
      plannedPhases.push(phase);
      if (totalFrames !== null) {
        previousFrameCount = totalFrames;
        frameCount = totalFrames;
      }
      return phase;
    };

    if (scenario.kind === "reservoir_extract_move") {
      await call("add_droplets", { droplets: [scenario.reservoir] }, 60000);
      const extractionCall = await call("plan_reservoir_extraction", scenario.extraction, 240000);
      recordPhase("linear_extraction_15_from_reservoir", "linear_extraction", extractionCall, {
        reservoir_id: scenario.reservoir_id,
        extracted_count: scenario.extracted_count,
        extraction: scenario.extraction,
      });
      if (scenario.delete_reservoir_after_extraction) {
        const deleteCall = await call("delete_droplet", {
          droplet_id: scenario.reservoir_id,
          persist_electrodes: false,
        }, 60000);
        recordPhase("delete_reservoir_after_extraction", "delete", deleteCall, {
          droplet_id: scenario.reservoir_id,
          persist_electrodes: false,
        });
      }
      const extractionSummaryCall = await call("droplets_summary", {}, 60000);
      const moveBatches = buildReservoirMoveBatches(extractionSummaryCall.payload, scenario);
      for (const batch of moveBatches) {
        const currentSummaryCall = await call("droplets_summary", {}, 60000);
        const activeDroplets = dropletListFromSummary(currentSummaryCall.payload).filter((droplet) => droplet.active);
        const targets = targetsWithCurrentResets(activeDroplets, batch.targets);
        const updateCall = await call("update_droplet_targets", { targets, include_summary: true }, 60000);
        plannedTargets.push(...batch.targets);
        const planCall = await planMoveAndWait({
          mode: "sipp",
          remove_duplicate_frames: false,
          planning_timeout: 600,
        }, batch.name, 900000);
        recordPhase(batch.name, "move", planCall, {
          droplet_ids: batch.droplet_ids,
          targets: batch.targets,
          target_validation: updateCall.payload?.target_validation || null,
        });
      }
    } else {
      await call("add_droplets", { droplets: scenario.droplets }, 60000);
      await call("update_droplet_targets", { targets: scenario.targets, include_summary: true }, 60000);
      plannedTargets.push(...scenario.targets);
      const planCall = await planMoveAndWait({
        mode: "sipp",
        remove_duplicate_frames: false,
        planning_timeout: 240,
      }, "move", 300000);
      recordPhase("move", "move", planCall, {
        droplet_ids: scenario.droplets.map((droplet) => droplet.id),
        targets: scenario.targets,
      });
    }

    await clickIfVisible(page, '[data-bottom-tab="timeline"]');
    await clickIfVisible(page, "#timelineLive");
    await page.waitForTimeout(500);

    const executeStartedPerf = performance.now();
    const executeCall = await call("execute_segment_to_breakpoint", {
      frame_number: null,
      frame_delay: frameDelay,
      wait_mode: "background",
      resume_if_paused: true,
      clear_existing_breakpoints: true,
      allow_failed_plan: false,
      verify_positions: false,
      enable_visualizers: false,
      execution_view_mode: executionViewMode,
      prepare_execution_view: true,
    }, 90000);

    let waitPayload = executeCall.payload?.wait_status || null;
    let waitCallCount = 0;
    const maxExecutionWaitCalls = Number(args["max-execution-waits"] || Math.max(
      30,
      Math.ceil(((frameCount || 0) * frameDelay) / 20) + 10,
    ));
    let recommended = firstFinite(
      executeCall.payload?.recommended_wait_seconds,
      executeCall.payload?.next_check_after_seconds,
      getPath(executeCall.payload, "recommended_status_call.arguments.wait_seconds"),
      30,
    );
    while (true) {
      const running = waitPayload?.running === true || waitPayload?.done === false;
      const okDone = waitPayload?.ok === true && waitPayload?.running === false;
      if (okDone) break;
      if (waitCallCount > maxExecutionWaitCalls) {
        throw new Error(`Execution wait did not finish after ${maxExecutionWaitCalls} status waits.`);
      }
      const waitSeconds = Math.max(1, Math.min(55, Number(recommended) || 30));
      const waitCall = await call("execution_wait_status", { wait_seconds: waitSeconds }, (waitSeconds + 8) * 1000);
      waitCallCount += 1;
      waitPayload = waitCall.payload;
      recommended = firstFinite(
        waitPayload?.recommended_wait_seconds,
        waitPayload?.next_check_after_seconds,
        getPath(waitPayload, "recommended_status_call.arguments.wait_seconds"),
        30,
      );
      if (waitPayload?.running === false && waitPayload?.ok === false) {
        throw new Error(`Execution wait failed: ${JSON.stringify(waitPayload, null, 2)}`);
      }
    }
    const executeEndedPerf = performance.now();

    const historyCall = await call("executor_frame_history", { limit: 2000 }, 60000);
    const statusCall = await call("executor_status", {}, 30000);
    await page.screenshot({ path: path.join(outputDir, "final-dashboard.png"), fullPage: true });
    const events = await readRunEvents(runId);

    const metrics = executionMetrics(historyCall.payload, frameDelay, plannedPhases);
    const summary = {
      benchmark: "real_dashboard_move",
      generated_at: new Date().toISOString(),
      dashboard_url: dashboardUrl,
      run_id: runId,
      output_dir: outputDir,
      pattern,
      system,
      reset_system: resetSystem,
      frame_delay_seconds: frameDelay,
      execution_view_mode: executionViewMode,
      voltage_profile: voltageProfile,
      droplets: scenario.kind === "reservoir_extract_move" ? [scenario.reservoir] : scenario.droplets,
      extraction: scenario.extraction || null,
      targets: plannedTargets,
      planned_phases: plannedPhases,
      planned_frame_count: frameCount,
      execute_tool_wall_ms: Number((executeEndedPerf - executeStartedPerf).toFixed(2)),
      wait_call_count: waitCallCount,
      max_execution_wait_calls: maxExecutionWaitCalls,
      execution: metrics,
      final_executor_status: compactPayloadSummary(statusCall.payload),
      dashboard_events: summarizeDashboardEvents(events),
      tool_calls: toolCalls,
      files: {
        screenshot: path.join(outputDir, "final-dashboard.png"),
        summary_json: path.join(outputDir, "summary.json"),
      },
    };
    await fs.writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      run_id: runId,
      summary_json: path.join(outputDir, "summary.json"),
      planned_frame_count: frameCount,
      executed_frame_count: metrics.executed_frame_count,
      actual_executor_seconds: metrics.actual_executor_seconds,
      nominal_expected_seconds: metrics.nominal_expected_seconds,
      nominal_error_seconds: metrics.nominal_error_seconds,
      period_expected_seconds: metrics.period_expected_seconds,
      period_error_seconds: metrics.period_error_seconds,
    }, null, 2));
  } finally {
    await context.close();
    try {
      videoPath = await page.video()?.path();
    } catch {
      videoPath = "";
    }
    await browser.close();
    if (videoPath) {
      const summaryPath = path.join(outputDir, "summary.json");
      if (fsSync.existsSync(summaryPath)) {
        const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
        summary.files = { ...(summary.files || {}), video: videoPath };
        await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      }
    }
  }
}

function compactPayloadSummary(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const summary = {};
  for (const key of [
    "ok",
    "reason",
    "error",
    "started",
    "started_wait",
    "wait_mode",
    "background_wait_started",
    "recommended_wait_seconds",
    "next_check_after_seconds",
    "frame_count",
    "count",
    "returned_count",
    "duration_summary",
    "matrix_command_latency_summary",
  ]) {
    if (payload[key] !== undefined) summary[key] = payload[key];
  }
  const planFrameCount = firstFinite(
    getPath(payload, "plan.frame_count"),
    getPath(payload, "failed_plan.frame_count"),
    getPath(payload, "result.plan.frame_count"),
  );
  if (planFrameCount !== null) summary.plan_frame_count = planFrameCount;
  const executor = payload.executor_status || payload.executor || payload.status;
  if (executor && typeof executor === "object") {
    summary.executor = {
      is_executing: executor.is_executing,
      current_frame: executor.current_frame,
      total_frames: executor.total_frames,
      frames_executed: executor.frames_executed,
      frame_delay: executor.frame_delay,
      frame_history_count: executor.frame_history_count,
      last_frame: executor.last_frame,
    };
  }
  return Object.keys(summary).length ? summary : payload;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
