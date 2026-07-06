import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const frontendRoot = path.join(repoRoot, "frontend");
const args = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(repoRoot, args.output || "runtime/perf-bench-motion");
const fps = Math.max(1, Number(args.fps || 10));
const headed = Boolean(args.headed);
const recordVideo = args.video !== "false";
const frameCount = 120;
const runId = "bench_matrix_motion_reservoir_extract_move";
const screenshotPath = path.join(outputDir, "matrix-motion-final.png");
const metricsPath = path.join(outputDir, "matrix-motion-live.json");
const videoDir = path.join(outputDir, "video");

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--headed") {
      parsed.headed = true;
      continue;
    }
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        parsed[key] = next;
        index += 1;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const requestedPath = path.resolve(frontendRoot, `.${pathname}`);
      if (!requestedPath.startsWith(frontendRoot)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      const body = await fs.readFile(requestedPath);
      response.writeHead(200, {
        "content-type": contentType(requestedPath),
        "cache-control": "no-store",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(error?.message || error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function range(count, mapper) {
  return Array.from({ length: count }, (_, index) => mapper(index));
}

function rectShape(height, width) {
  const cells = [];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) cells.push([row, col]);
  }
  return cells;
}

function cellsForDroplet(droplet) {
  const origin = droplet.position || droplet.origin || [0, 0];
  const shape = droplet.shape || [[0, 0]];
  return shape.map((offset) => [origin[0] + offset[0], origin[1] + offset[1]]);
}

function bboxFromCells(cells) {
  if (!cells.length) return null;
  const rows = cells.map((cell) => cell[0]);
  const cols = cells.map((cell) => cell[1]);
  return {
    row_min: Math.min(...rows),
    row_max: Math.max(...rows),
    col_min: Math.min(...cols),
    col_max: Math.max(...cols),
  };
}

function integerRanges(values) {
  const sorted = [...new Set(values.map((value) => Math.trunc(value)))].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const ranges = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const value of sorted.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    ranges.push([start, previous]);
    start = value;
    previous = value;
  }
  ranges.push([start, previous]);
  return ranges;
}

function matrixSummary(droplets, shape = [128, 128]) {
  const rowMap = new Map();
  let activeCount = 0;
  const allCells = [];
  for (const droplet of droplets) {
    if (droplet.active === false) continue;
    for (const [row, col] of cellsForDroplet(droplet)) {
      if (row < 0 || col < 0 || row >= shape[0] || col >= shape[1]) continue;
      const key = String(Math.trunc(row));
      if (!rowMap.has(key)) rowMap.set(key, []);
      rowMap.get(key).push(Math.trunc(col));
      allCells.push([Math.trunc(row), Math.trunc(col)]);
      activeCount += 1;
    }
  }
  const rows = {};
  for (const [row, cols] of rowMap.entries()) rows[row] = integerRanges(cols);
  return {
    type: "matrix_summary",
    source: "synthetic_live_motion",
    shape,
    active_count: activeCount,
    active_bbox: bboxFromCells(allCells),
    encoding: "active_ranges_by_row",
    zeros_are_implicit: true,
    rows,
  };
}

function lerpPoint(start, end, progress) {
  const p = Math.max(0, Math.min(1, progress));
  return [
    Math.round(start[0] + (end[0] - start[0]) * p),
    Math.round(start[1] + (end[1] - start[1]) * p),
  ];
}

function pathBetween(start, end, steps = 28) {
  return range(steps, (index) => lerpPoint(start, end, steps <= 1 ? 1 : index / (steps - 1)))
    .filter((point, index, points) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
}

function makeDroplet(id, position, target, shape, extra = {}) {
  const cells = shape.map((offset) => [position[0] + offset[0], position[1] + offset[1]]);
  return {
    id,
    active: true,
    position,
    origin: position,
    current_position: position,
    target,
    shape,
    shape_size: shape.length,
    cells,
    cells_truncated: false,
    bbox: bboxFromCells(cells),
    target_bbox: null,
    vital_space: id === 1 ? 0 : 2,
    priority: id === 1 ? -1 : 1,
    ...extra,
  };
}

function buildMotionFixture() {
  const baseTime = Math.floor(Date.now() / 1000);
  const shape2 = rectShape(2, 2);
  const reservoirShape = rectShape(30, 15);
  const reservoirOrigin = [49, 4];
  const extractionStart = 8;
  const extractionEnd = 55;
  const moveStart = 56;
  const moveEnd = frameCount - 1;
  const dropletDefs = range(15, (index) => {
    const row = 49 + index * 2;
    const start = [row, 17];
    const staging = [10 + (index % 5) * 22, 35 + Math.floor(index / 5) * 6];
    const final = [13 + (index % 5) * 24, 54 + Math.floor(index / 5) * 26];
    return {
      id: index + 2,
      start,
      staging,
      final,
      appearFrame: extractionStart + index * 2,
      extractionPath: pathBetween(start, staging, 24),
      movePath: pathBetween(staging, final, 38),
    };
  });

  const actions = [
    {
      id: "create-reservoir",
      event_id: 1,
      index: 0,
      type: "create_droplet",
      label: "1. create_droplet",
      frame_span: [0, extractionStart - 1],
      frame_count: extractionStart,
      droplet_ids: [1],
      paths: [{
        key: "1:1",
        droplet_id: 1,
        start: reservoirOrigin,
        end: reservoirOrigin,
        path: [reservoirOrigin],
        path_length: 1,
      }],
      data: { event_id: 1, frame_span: [0, extractionStart - 1], synthetic: true },
    },
    {
      id: "linear-extraction-15",
      event_id: 2,
      index: 1,
      type: "linear_extraction",
      label: "2. linear_extraction",
      frame_span: [extractionStart, extractionEnd],
      frame_count: extractionEnd - extractionStart + 1,
      droplet_ids: dropletDefs.map((item) => item.id),
      paths: dropletDefs.map((item) => ({
        key: `2:${item.id}`,
        droplet_id: item.id,
        start: item.start,
        end: item.staging,
        path: item.extractionPath,
        path_length: item.extractionPath.length,
      })),
      data: { event_id: 2, frame_span: [extractionStart, extractionEnd], mode: "linear", synthetic: true },
    },
    {
      id: "move-15-grid",
      event_id: 3,
      index: 2,
      type: "move",
      label: "3. move",
      frame_span: [moveStart, moveEnd],
      frame_count: moveEnd - moveStart + 1,
      droplet_ids: dropletDefs.map((item) => item.id),
      paths: dropletDefs.map((item) => ({
        key: `3:${item.id}`,
        droplet_id: item.id,
        start: item.staging,
        end: item.final,
        path: item.movePath,
        path_length: item.movePath.length,
      })),
      data: { event_id: 3, frame_span: [moveStart, moveEnd], synthetic: true },
    },
  ];

  const scenes = range(frameCount, (frameIndex) => {
    const droplets = [
      makeDroplet(1, reservoirOrigin, reservoirOrigin, reservoirShape, {
        path: [reservoirOrigin],
        path_length: 1,
      }),
    ];
    for (const item of dropletDefs) {
      if (frameIndex < item.appearFrame) continue;
      let position = item.start;
      if (frameIndex <= extractionEnd) {
        const localProgress = (frameIndex - item.appearFrame) / Math.max(1, extractionEnd - item.appearFrame);
        position = lerpPoint(item.start, item.staging, localProgress);
      } else {
        const localProgress = (frameIndex - moveStart) / Math.max(1, moveEnd - moveStart);
        position = lerpPoint(item.staging, item.final, localProgress);
      }
      const path = frameIndex <= extractionEnd ? item.extractionPath : [...item.extractionPath, ...item.movePath];
      droplets.push(makeDroplet(item.id, position, item.final, shape2, {
        path,
        path_length: path.length,
      }));
    }
    const summary = matrixSummary(droplets);
    const currentAction = actions.find((action) => frameIndex >= action.frame_span[0] && frameIndex <= action.frame_span[1]) || actions.at(-1);
    return {
      available: true,
      session_id: "bench-motion-session",
      updated_at: new Date((baseTime + frameIndex / fps) * 1000).toISOString(),
      matrix: summary,
      frame: {
        index: frameIndex,
        count: frameCount,
        source: "executor_last_applied_frame",
        summary,
        synced_to_executor: true,
      },
      executor: {
        is_executing: frameIndex < frameCount - 1,
        current_frame: frameIndex,
        frames_executed: frameIndex + 1,
        total_frames: frameCount,
        frame_delay: 1 / fps,
        last_applied_frame: {
          index: frameIndex,
          active_droplet_ids: droplets.map((droplet) => droplet.id),
        },
      },
      plan: {
        frame_count: frameCount,
        event_count: actions.length,
        actions,
        current_event: [
          currentAction.frame_span[0],
          currentAction.type,
          {
            ...(currentAction.data || {}),
            event_id: currentAction.event_id,
            frame_span: currentAction.frame_span,
          },
        ],
      },
      droplets,
    };
  });

  const timelineEvents = actions.map((action) => ({
    id: action.id,
    event_id: action.event_id,
    index: action.index,
    type: action.type,
    label: action.label,
    frame_span: action.frame_span,
    frame_count: action.frame_count,
    droplet_ids: action.droplet_ids,
    data: action.data || {},
  }));
  const timelineFrames = scenes.map((scene) => {
    const frameIndex = Number(scene.frame.index);
    const action = actions.find((item) => frameIndex >= item.frame_span[0] && frameIndex <= item.frame_span[1]) || actions.at(-1);
    return {
      index: frameIndex,
      event_id: action?.event_id ?? null,
      event_type: action?.type ?? null,
      active_droplet_ids: (scene.droplets || []).map((droplet) => droplet.id),
      summary: scene.frame.summary,
    };
  });
  const timeline = {
    available: true,
    frame_count: frameCount,
    event_count: timelineEvents.length,
    events: timelineEvents,
    frames: timelineFrames,
    encoding: "per_frame_active_ranges",
    frames_compact: false,
    detailed_frame_limit: 240,
  };
  for (const scene of scenes) {
    scene.timeline = timeline;
  }

  const events = [
    {
      t: baseTime,
      ts: new Date(baseTime * 1000).toISOString(),
      type: "agent",
      role: "agent",
      content: "Synthetic motion benchmark: create reservoir, extract 15 droplets, move to grid.",
    },
  ];

  return {
    runId,
    events,
    scenes,
    status: {
      run_id: runId,
      now: "Matrix motion benchmark",
      agent_busy: false,
      mcp: { running: false },
      live: { updated_at: scenes[0].updated_at },
      speech: { enabled: false, wake_enabled: false, loaded: false, loading: false },
      ai: { provider: "benchmark", model: "fixture" },
      runs: [{
        id: runId,
        run_id: runId,
        created_at: scenes[0].updated_at,
        updated_at: scenes.at(-1).updated_at,
        name: "Reservoir extraction motion benchmark",
      }],
    },
  };
}

function fakeWebSocketScript(fixture) {
  window.__DROPOLOGIC_MOTION_FIXTURE = fixture;
  window.__DROPOLOGIC_MOTION_RECORDS = [];
  window.__DROPOLOGIC_MOTION_LONG_TASKS = [];
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__DROPOLOGIC_MOTION_LONG_TASKS.push({
          startTime: entry.startTime,
          duration: entry.duration,
        });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {}

  class FixtureWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor() {
      this.readyState = FixtureWebSocket.CONNECTING;
      this.sent = [];
      window.__DROPOLOGIC_MOTION_SOCKET = this;
      setTimeout(() => {
        this.readyState = FixtureWebSocket.OPEN;
        this.onopen?.({ type: "open" });
      }, 0);
    }

    send(raw) {
      let message = {};
      try {
        message = JSON.parse(raw);
      } catch {}
      this.sent.push(message);
      if (message.type === "get_status") {
        this.emit({ type: "status", status: fixture.status });
      } else if (message.type === "list_runs") {
        this.emit({ type: "runs", runs: fixture.status.runs });
      } else if (message.type === "select_run") {
        this.emitRunLoaded();
      }
    }

    close() {
      this.readyState = FixtureWebSocket.CLOSED;
      this.onclose?.({ type: "close" });
    }

    emit(message) {
      setTimeout(() => {
        this.onmessage?.({ data: JSON.stringify(message) });
      }, 0);
    }

    emitRunLoaded() {
      this.emit({
        type: "run_loaded",
        status: fixture.status,
        runs: fixture.status.runs,
        events: fixture.events,
        event_window: {
          has_more: false,
          loaded_event_count: fixture.events.length,
          total_event_count: fixture.events.length,
        },
        temperature_history: { schema_version: 1, run_id: fixture.runId, samples: [] },
      });
      this.emit({ type: "live_scene", scene: fixture.scenes[0], updated_at: fixture.scenes[0].updated_at });
    }
  }

  FixtureWebSocket.prototype.addEventListener = function addEventListener(type, handler) {
    this[`on${type}`] = handler;
  };
  FixtureWebSocket.prototype.removeEventListener = function removeEventListener(type, handler) {
    if (this[`on${type}`] === handler) this[`on${type}`] = null;
  };
  FixtureWebSocket.OPEN = FixtureWebSocket.OPEN;
  window.WebSocket = FixtureWebSocket;

  window.__DROPOLOGIC_MOTION_LOAD_RUN = () => window.__DROPOLOGIC_MOTION_SOCKET?.emitRunLoaded();
  window.__DROPOLOGIC_MOTION_PLAY = async (options = {}) => {
    const socket = window.__DROPOLOGIC_MOTION_SOCKET;
    const delayMs = Math.max(1, Number(options.delayMs || 100));
    const scenes = fixture.scenes || [];
    for (let index = 0; index < scenes.length; index += 1) {
      socket?.emit({
        type: "live_scene",
        scene: scenes[index],
        updated_at: scenes[index].updated_at,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  };
}

async function installMotionInstrumentation(page) {
  await page.evaluate(() => {
    const original = window.renderMatrixScene;
    if (typeof original === "function" && !original.__motionWrapped) {
      function wrapped(scene, ...args) {
        const started = performance.now();
        const frame = Number(scene?.frame?.index);
        const active = Number(scene?.frame?.summary?.active_count ?? scene?.matrix?.active_count ?? 0);
        try {
          return original.call(this, scene, ...args);
        } finally {
          window.__DROPOLOGIC_MOTION_RECORDS.push({
            frame: Number.isFinite(frame) ? frame : null,
            active,
            at: performance.now(),
            duration: performance.now() - started,
          });
        }
      }
      wrapped.__motionWrapped = true;
      window.renderMatrixScene = wrapped;
    }
  });
}

async function afterNextPaint(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

function summarizeRecords(records, emittedCount) {
  const uniqueFrames = [...new Set(records.map((record) => record.frame).filter((frame) => Number.isFinite(frame)))].sort((a, b) => a - b);
  const durations = records.map((record) => Number(record.duration)).filter(Number.isFinite).sort((a, b) => a - b);
  const intervals = [];
  for (let index = 1; index < records.length; index += 1) {
    intervals.push(records[index].at - records[index - 1].at);
  }
  const percentile = (values, p) => values.length
    ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))]
    : 0;
  const missingFrames = range(emittedCount, (index) => index).filter((frame) => !uniqueFrames.includes(frame));
  return {
    emitted_frames: emittedCount,
    render_calls: records.length,
    unique_rendered_frames: uniqueFrames.length,
    first_rendered_frame: uniqueFrames[0] ?? null,
    last_rendered_frame: uniqueFrames.at(-1) ?? null,
    missing_frame_count: missingFrames.length,
    missing_frame_sample: missingFrames.slice(0, 12),
    render_duration_ms: {
      avg: Number((durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length)).toFixed(2)),
      p95: Number(percentile(durations, 0.95).toFixed(2)),
      max: Number(Math.max(0, ...durations).toFixed(2)),
      over_16ms: durations.filter((value) => value > 16).length,
      over_50ms: durations.filter((value) => value > 50).length,
    },
    inter_render_interval_ms: {
      avg: Number((intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length)).toFixed(2)),
      p95: Number(percentile(intervals.sort((a, b) => a - b), 0.95).toFixed(2)),
      max: Number(Math.max(0, ...intervals).toFixed(2)),
    },
  };
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  if (recordVideo) await fs.mkdir(videoDir, { recursive: true });
  const fixture = buildMotionFixture();
  const { server, url } = await startStaticServer();
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1040 },
    deviceScaleFactor: 1,
    ...(recordVideo ? { recordVideo: { dir: videoDir, size: { width: 1680, height: 1040 } } } : {}),
  });
  await context.addInitScript(fakeWebSocketScript, fixture);
  const page = await context.newPage();

  let videoPath = "";
  try {
    await page.goto(`${url}/?perf=matrix-motion`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#matrixScene", { state: "attached" });
    await installMotionInstrumentation(page);
    await page.evaluate(() => window.__DROPOLOGIC_MOTION_LOAD_RUN?.());
    await page.waitForFunction(() => window.__droplogicDebug?.state?.live?.scene?.available, null, { timeout: 10000 });
    await page.click('[data-bottom-tab="timeline"]');
    await afterNextPaint(page);

    const started = performance.now();
    await page.evaluate((delayMs) => window.__DROPOLOGIC_MOTION_PLAY?.({ delayMs }), 1000 / fps);
    await afterNextPaint(page);
    const wallMs = performance.now() - started;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const pagePayload = await page.evaluate(() => ({
      records: window.__DROPOLOGIC_MOTION_RECORDS || [],
      longTasks: window.__DROPOLOGIC_MOTION_LONG_TASKS || [],
      meta: document.querySelector("#matrixMeta")?.textContent || "",
      liveFrame: window.__droplogicDebug?.state?.live?.scene?.frame?.index ?? null,
      followLive: window.__droplogicDebug?.state?.timeline?.followLive ?? null,
    }));
    const summary = summarizeRecords(pagePayload.records, fixture.scenes.length);
    const longDurations = pagePayload.longTasks.map((item) => Number(item.duration)).filter(Number.isFinite);
    const payload = {
      run_id: runId,
      generated_at: new Date().toISOString(),
      fps,
      wall_ms: Number(wallMs.toFixed(2)),
      scenario: {
        frame_count: fixture.scenes.length,
        live_scene_bytes: Buffer.byteLength(JSON.stringify(fixture.scenes[0])),
        actions: ["create reservoir", "linear extraction 15 droplets", "move 15 droplets"],
        reservoir: "30 x 15 electrodes",
        extracted_droplets: 15,
        droplet_size: "2 x 2 electrodes",
      },
      matrix: summary,
      long_tasks: {
        count: pagePayload.longTasks.length,
        max_ms: Number(Math.max(0, ...longDurations).toFixed(2)),
        total_ms: Number(longDurations.reduce((sum, value) => sum + value, 0).toFixed(2)),
      },
      final_meta: pagePayload.meta,
      final_live_frame: pagePayload.liveFrame,
      follow_live: pagePayload.followLive,
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
      const targetVideo = path.join(outputDir, "matrix-motion-live.webm");
      try {
        await fs.copyFile(videoPath, targetVideo);
        await fs.rm(videoPath, { force: true });
      } catch {}
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
