import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const mustAcknowledge = Boolean(args["i-understand-this-may-change-mcp-state"]);
if (!mustAcknowledge) {
  console.error("Refusing to run: add --i-understand-this-may-change-mcp-state because this benchmark asks the dashboard agent to call MCP tools.");
  process.exit(2);
}

const dashboardUrl = args.url || "http://127.0.0.1:8787";
const outputDir = path.resolve(
  repoRoot,
  args.output || path.join("benchmarks", "results", "agent-matrix-motion", timestampForPath()),
);
const headed = Boolean(args.headed);
const recordVideo = args.video !== "false";
const allowLoadedSystemRestart = Boolean(args["allow-loaded-system-restart"]);
const requestedSystem = String(args.system || "simulator").trim().toLowerCase();
const frameDelay = Number(args["frame-delay"] || 0.1);
const prompt = args.prompt || defaultPrompt({ requestedSystem, frameDelay });
const agentTimeoutMs = Math.max(30_000, Number(args.timeout || 20 * 60 * 1000));
const screenshotPath = path.join(outputDir, "agent-matrix-motion-final.png");
const metricsPath = path.join(outputDir, "agent-matrix-motion.json");

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

function defaultPrompt({ requestedSystem, frameDelay }) {
  const systemInstruction = requestedSystem === "boxmini"
    ? "Use the currently loaded BoxMini hardware for this benchmark. Do not switch to simulator."
    : `Use the ${requestedSystem} system only for this benchmark. Do not use real BoxMini hardware.`;
  const setupInstruction = requestedSystem === "boxmini"
    ? "If BoxMini is not loaded, call load_system(system=\"boxmini\"). Then call emergency_stop(deactivate_electrodes=true), clear_droplet_state(reset_executor=true), and confirm the new plan starts at frame 0 before creating droplets."
    : `Restart or load a clean ${requestedSystem} system with a cleared matrix.`;
  return [
    "Benchmark task for the dashboard matrix visualizer.",
    systemInstruction,
    "Do not ask for user confirmation.",
    setupInstruction,
    "Resume timeline recording for active work.",
    "Create a left-side reservoir in the center rows, 30 rows by 15 columns.",
    "From that reservoir, use linear extraction to extract 15 droplets of 2 by 2 electrodes.",
    "Then move the extracted droplets across the cartridge into a conservative spaced 3 by 5 grid in the right half, away from edges; prefer target columns around 70-110, not above 114, and leave vital-space margins.",
    "Move those droplets in executed batches of 5 droplets maximum: set targets for one batch, plan_move, execute that segment, wait for completion, then continue with the next batch.",
    "If a movement target fails once, choose a nearer/intermediate parking target or use suggested targets; do not retry the same hard edge target repeatedly.",
    "Execute the extraction and every movement segment so the matrix visualizer can follow the frame-by-frame motion.",
    `For this benchmark, explicitly execute with frame_delay=${frameDelay} seconds per frame.`,
    "Use background execution waits instead of tight polling.",
    "When complete, pause/stop timeline recording and report a short summary.",
  ].join("\n");
}

async function waitForDashboardReady(page) {
  await page.goto(dashboardUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#matrixScene", { state: "attached", timeout: 20_000 });
  await page.waitForFunction(
    () => window.__droplogicDebug?.state?.ws?.readyState === WebSocket.OPEN,
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(300);
}

async function sendDashboardMessage(page, message, waitForType = "", timeoutMs = 30_000) {
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

async function callTool(page, tool, toolArgs = {}, timeoutMs = 120_000) {
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
  return {
    tool,
    duration_ms: Number(call.duration_ms.toFixed(2)),
    event: call.message?.event || {},
    payload: decodeToolPayload(call.message?.result),
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

async function installInstrumentation(page) {
  await page.evaluate(() => {
    window.__DROPOLOGIC_AGENT_MATRIX_BENCH = {
      matrixRecords: [],
      wsMessages: [],
      longTasks: [],
      wsAttachTimer: null,
    };
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__DROPOLOGIC_AGENT_MATRIX_BENCH.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {}
    const original = window.renderMatrixScene;
    if (typeof original === "function" && !original.__agentMatrixBenchWrapped) {
      function wrapped(scene, ...rest) {
        const started = performance.now();
        const frame = Number(scene?.frame?.index);
        const active = Number(scene?.frame?.summary?.active_count ?? scene?.matrix?.active_count ?? 0);
        try {
          return original.call(this, scene, ...rest);
        } finally {
          window.__DROPOLOGIC_AGENT_MATRIX_BENCH.matrixRecords.push({
            frame: Number.isFinite(frame) ? frame : null,
            active: Number.isFinite(active) ? active : null,
            source: scene?.frame?.source || "",
            agentBusy: Boolean(window.__droplogicDebug?.state?.agentBusy),
            at: performance.now(),
            duration: performance.now() - started,
            meta: document.querySelector("#matrixMeta")?.textContent || "",
          });
        }
      }
      wrapped.__agentMatrixBenchWrapped = true;
      window.renderMatrixScene = wrapped;
    }
    const recordWsMessage = (socket, event) => {
      let data = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const record = {
        at: performance.now(),
        socket,
        type: data?.type || "",
        event_type: data?.event?.type || "",
        tool: data?.event?.tool || "",
        live_frame: data?.scene?.frame?.index ?? data?.live?.scene?.frame?.index ?? null,
      };
      window.__DROPOLOGIC_AGENT_MATRIX_BENCH.wsMessages.push(record);
    };
    const attachWebSocket = (socket, ws) => {
      if (!ws) return;
      const key = socket === "live" ? "__agentMatrixBenchLiveListener" : "__agentMatrixBenchMainListener";
      if (ws[key]) return;
      ws[key] = true;
      ws.addEventListener("message", (event) => recordWsMessage(socket, event));
    };
    const attachCurrentSockets = () => {
      const debugState = window.__droplogicDebug?.state || {};
      attachWebSocket("main", debugState.ws);
      attachWebSocket("live", debugState.liveWs);
    };
    window.__DROPOLOGIC_AGENT_MATRIX_BENCH.attachCurrentSockets = attachCurrentSockets;
    attachCurrentSockets();
    if (!window.__DROPOLOGIC_AGENT_MATRIX_BENCH.wsAttachTimer) {
      window.__DROPOLOGIC_AGENT_MATRIX_BENCH.wsAttachTimer = window.setInterval(attachCurrentSockets, 250);
    }
  });
}

async function waitForAgentFinished(page, timeoutMs) {
  await page.waitForFunction(() => {
    const events = window.__droplogicDebug?.state?.events || [];
    return events.some((event) => event.type === "agent_started")
      && events.some((event) => event.type === "agent_finished");
  }, null, { timeout: timeoutMs });
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

function summarizeNumbers(values) {
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return { count: 0 };
  const pick = (p) => clean[Math.min(clean.length - 1, Math.max(0, Math.round((clean.length - 1) * p)))];
  return {
    count: clean.length,
    min: Number(clean[0].toFixed(4)),
    median: Number(pick(0.5).toFixed(4)),
    p95: Number(pick(0.95).toFixed(4)),
    max: Number(clean[clean.length - 1].toFixed(4)),
    mean: Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(4)),
  };
}

function summarizeMatrixRecords(records) {
  const finiteFrames = records
    .map((record) => Number(record.frame))
    .filter(Number.isFinite);
  const uniqueFrames = [...new Set(finiteFrames)].sort((a, b) => a - b);
  const missingFrames = [];
  if (uniqueFrames.length) {
    for (let frame = uniqueFrames[0]; frame <= uniqueFrames.at(-1); frame += 1) {
      if (!uniqueFrames.includes(frame)) missingFrames.push(frame);
    }
  }
  const intervals = [];
  for (let index = 1; index < records.length; index += 1) {
    intervals.push(Number(records[index].at) - Number(records[index - 1].at));
  }
  return {
    render_calls: records.length,
    unique_rendered_frames: uniqueFrames.length,
    first_rendered_frame: uniqueFrames[0] ?? null,
    last_rendered_frame: uniqueFrames.at(-1) ?? null,
    missing_frame_count: missingFrames.length,
    missing_frame_sample: missingFrames.slice(0, 20),
    render_duration_ms: summarizeNumbers(records.map((record) => record.duration)),
    inter_render_interval_ms: summarizeNumbers(intervals),
    render_calls_while_agent_busy: records.filter((record) => record.agentBusy).length,
    sources: countBy(records.map((record) => record.source || "?")),
    final_meta: records.at(-1)?.meta || "",
  };
}

function summarizeWsMessages(messages) {
  return {
    total: messages.length,
    by_type: countBy(messages.map((message) => message.type || "?")),
    event_types: countBy(messages.filter((message) => message.type === "event").map((message) => message.event_type || "?")),
    tool_events: countBy(messages.map((message) => message.tool).filter(Boolean)),
    live_scene_count: messages.filter((message) => message.type === "live_scene").length,
    live_count: messages.filter((message) => message.type === "live").length,
  };
}

function summarizeEvents(events) {
  return {
    total: events.length,
    by_type: countBy(events.map((event) => event.type || "?")),
    tools_called: countBy(events.filter((event) => event.type === "mcp_tool_call").map((event) => event.tool || "?")),
    tool_results: countBy(events.filter((event) => event.type === "mcp_tool_result").map((event) => event.tool || "?")),
    agent_finished: events.findLast?.((event) => event.type === "agent_finished") || [...events].reverse().find((event) => event.type === "agent_finished") || null,
  };
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    const key = String(value || "?");
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function getPath(root, dotted) {
  let current = root;
  for (const key of dotted.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

async function ensureSafeSystemState(page) {
  const status = await callTool(page, "runtime_status", { detail: "compact" }, 60_000);
  const systemLoaded = getPath(status.payload, "system.loaded") === true;
  const systemName = String(getPath(status.payload, "system.system") || "").toLowerCase();
  const executing = Boolean(getPath(status.payload, "executor.is_executing"));
  if (executing) {
    throw new Error("Refusing to start agent benchmark while executor is executing.");
  }
  if (
    systemLoaded
    && systemName
    && systemName !== requestedSystem
    && !allowLoadedSystemRestart
  ) {
    throw new Error(
      `Refusing to restart loaded system '${systemName}' to '${requestedSystem}'. `
      + "Re-run with --allow-loaded-system-restart when that is intentional.",
    );
  }
  return { systemLoaded, systemName, status };
}

async function main() {
  if (!Number.isFinite(frameDelay) || frameDelay <= 0) {
    throw new Error("--frame-delay must be a positive number.");
  }
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1040 },
    ...(recordVideo ? { recordVideo: { dir: outputDir, size: { width: 1680, height: 1040 } } } : {}),
  });
  const page = await context.newPage();
  let runId = "";
  let videoPath = "";
  try {
    await waitForDashboardReady(page);
    await installInstrumentation(page);
    await ensureSafeSystemState(page);
    await sendDashboardMessage(page, { type: "new_run" }, "run_loaded", 30_000);
    runId = await page.evaluate(() => window.__droplogicDebug?.state?.status?.run_id || "");
    await page.click('[data-bottom-tab="timeline"]').catch(() => {});

    const started = performance.now();
    await sendDashboardMessage(page, {
      type: "ask_agent",
      prompt,
      run_id: runId,
    });
    await waitForAgentFinished(page, agentTimeoutMs);
    await page.waitForTimeout(1000);
    const wallMs = performance.now() - started;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const bench = await page.evaluate(() => window.__DROPOLOGIC_AGENT_MATRIX_BENCH || {});
    const events = await readRunEvents(runId);
    const longDurations = (bench.longTasks || []).map((item) => Number(item.duration)).filter(Number.isFinite);
    const payload = {
      benchmark: "agent_matrix_motion",
      generated_at: new Date().toISOString(),
      dashboard_url: dashboardUrl,
      run_id: runId,
      output_dir: outputDir,
      requested_system: requestedSystem,
      frame_delay_seconds: frameDelay,
      prompt,
      wall_ms: Number(wallMs.toFixed(2)),
      matrix: summarizeMatrixRecords(bench.matrixRecords || []),
      websocket: summarizeWsMessages(bench.wsMessages || []),
      events: summarizeEvents(events),
      long_tasks: {
        count: longDurations.length,
        total_ms: Number(longDurations.reduce((sum, value) => sum + value, 0).toFixed(2)),
        max_ms: Number(Math.max(0, ...longDurations).toFixed(2)),
      },
      screenshot: path.relative(repoRoot, screenshotPath),
    };
    await fs.writeFile(metricsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    if (recordVideo) {
      try {
        videoPath = await page.video()?.path() || "";
      } catch {}
    }
    await browser.close();
    if (videoPath) {
      const targetVideo = path.join(outputDir, "agent-matrix-motion.webm");
      try {
        await fs.copyFile(videoPath, targetVideo);
        await fs.rm(videoPath, { force: true });
      } catch {}
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
