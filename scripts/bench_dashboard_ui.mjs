import http from "node:http";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const frontendRoot = path.join(repoRoot, "frontend");
const runtimeRoot = path.join(repoRoot, "runtime");
const defaultRunId = readRememberedRunId() || "bench_ui_stress_latest";

const args = parseArgs(process.argv.slice(2));
const runId = args.run || defaultRunId;
const headed = Boolean(args.headed);
const outputDir = path.resolve(repoRoot, args.output || "runtime/perf-bench");
const screenshotPath = path.join(outputDir, `dashboard-ui-${runId}.png`);
const metricsPath = path.join(outputDir, `dashboard-ui-${runId}.json`);

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

function readRememberedRunId() {
  try {
    const value = fsSync.readFileSync(path.join(repoRoot, "runs", ".last_run"), "utf8").trim();
    return value || "";
  } catch {
    return "";
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function loadFixture() {
  const runDir = path.join(repoRoot, "runs", runId);
  const eventsText = await fs.readFile(path.join(runDir, "events.jsonl"), "utf8");
  const events = eventsText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const run = await readJson(path.join(runDir, "run.json"), {});
  const temperatureHistory = await readJson(path.join(runDir, "temperature_history.json"), {
    schema_version: 1,
    run_id: runId,
    samples: [],
  });
  const scene = await readJson(path.join(runDir, "scene.json"), null)
    ?? await readJson(path.join(runDir, "dashboard_scene.json"), null)
    ?? await readJson(path.join(runtimeRoot, "dashboard_scene.json"), {});
  const firstTs = events.find((event) => event.ts)?.ts || run.created_at || new Date().toISOString();
  const lastTs = [...events].reverse().find((event) => event.ts)?.ts || firstTs;
  return {
    runId,
    run,
    events,
    temperatureHistory,
    scene,
    firstTs,
    lastTs,
    status: {
      run_id: runId,
      now: "Benchmark fixture",
      agent_busy: false,
      mcp: { running: false },
      live: { updated_at: lastTs },
      speech: { enabled: false, wake_enabled: false, loaded: false, loading: false },
      ai: { provider: "benchmark", model: "fixture" },
      runs: [
        {
          id: runId,
          run_id: runId,
          created_at: run.created_at || firstTs,
          updated_at: lastTs,
          name: run.name || "Heavy UI benchmark run",
        },
      ],
    },
  };
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

function fakeWebSocketScript(fixture) {
  window.__DROPOLOGIC_BENCHMARK_FIXTURE = fixture;
  window.__DROPOLOGIC_BENCHMARK_EVENTS = [];
  window.__DROPOLOGIC_BENCHMARK_LONG_TASKS = [];
  window.__DROPOLOGIC_BENCHMARK_EVENT_LATENCIES = [];

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__DROPOLOGIC_BENCHMARK_LONG_TASKS.push({
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
        });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {}

  window.addEventListener("pointermove", (event) => {
    const id = event.target?.id || event.target?.closest?.("[id]")?.id || "";
    if (id !== "planTimeline" && id !== "matrixScene") return;
    window.__DROPOLOGIC_BENCHMARK_EVENT_LATENCIES.push({
      id,
      delay: performance.now() - event.timeStamp,
      at: performance.now(),
    });
  }, true);

  class FixtureWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor() {
      this.readyState = FixtureWebSocket.CONNECTING;
      this.sent = [];
      window.__DROPOLOGIC_BENCHMARK_SOCKET = this;
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
      } else if (message.type === "load_older_events") {
        this.emit({
          type: "older_events",
          run_id: fixture.runId,
          events: [],
          event_window: {
            has_more: false,
            loaded_event_count: fixture.events.length,
            total_event_count: fixture.events.length,
          },
        });
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
          oldest_t: fixture.events[0]?.t ?? null,
          loaded_event_count: fixture.events.length,
          total_event_count: fixture.events.length,
        },
        temperature_history: fixture.temperatureHistory,
      });
      this.emitLive();
    }

    emitLive() {
      this.emit({
        type: "live",
        live: {
          updated_at: fixture.lastTs,
          scene: fixture.scene,
          state: {
            result: {
              ok: true,
              value: {
                temperature: {
                  current: 37.2,
                  target: 37.0,
                },
              },
            },
          },
        },
      });
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
  window.__DROPOLOGIC_BENCHMARK_LOAD_RUN = () => window.__DROPOLOGIC_BENCHMARK_SOCKET?.emitRunLoaded();
  window.__DROPOLOGIC_BENCHMARK_EMIT_LIVE = () => window.__DROPOLOGIC_BENCHMARK_SOCKET?.emitLive();
}

async function installPageInstrumentation(page) {
  await page.evaluate(() => {
    const bench = {
      calls: {},
      failures: [],
      mark(name, duration) {
        const bucket = this.calls[name] || {
          count: 0,
          total: 0,
          max: 0,
          over16: 0,
          over50: 0,
          samples: [],
        };
        bucket.count += 1;
        bucket.total += duration;
        bucket.max = Math.max(bucket.max, duration);
        if (duration > 16) bucket.over16 += 1;
        if (duration > 50) bucket.over50 += 1;
        if (bucket.samples.length < 200) bucket.samples.push(duration);
        this.calls[name] = bucket;
      },
      wrap(name) {
        const original = window[name];
        if (typeof original !== "function" || original.__benchWrapped) {
          if (typeof original !== "function") this.failures.push(name);
          return;
        }
        const self = this;
        function wrapped(...args) {
          const started = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            self.mark(name, performance.now() - started);
          }
        }
        wrapped.__benchWrapped = true;
        window[name] = wrapped;
      },
      summary() {
        const calls = {};
        for (const [name, item] of Object.entries(this.calls)) {
          const sorted = [...item.samples].sort((a, b) => a - b);
          const percentile = (p) => sorted.length
            ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]
            : 0;
          calls[name] = {
            count: item.count,
            total_ms: Number(item.total.toFixed(2)),
            avg_ms: Number((item.total / Math.max(1, item.count)).toFixed(2)),
            max_ms: Number(item.max.toFixed(2)),
            p50_ms: Number(percentile(0.5).toFixed(2)),
            p95_ms: Number(percentile(0.95).toFixed(2)),
            over_16ms: item.over16,
            over_50ms: item.over50,
          };
        }
        const latencies = window.__DROPOLOGIC_BENCHMARK_EVENT_LATENCIES || [];
        const latencySummary = {};
        for (const id of ["planTimeline", "matrixScene"]) {
          const values = latencies
            .filter((item) => item.id === id)
            .map((item) => item.delay)
            .sort((a, b) => a - b);
          latencySummary[id] = values.length
            ? {
                count: values.length,
                avg_ms: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
                p95_ms: Number(values[Math.floor((values.length - 1) * 0.95)].toFixed(2)),
                max_ms: Number(values[values.length - 1].toFixed(2)),
              }
            : { count: 0, avg_ms: 0, p95_ms: 0, max_ms: 0 };
        }
        const longTasks = window.__DROPOLOGIC_BENCHMARK_LONG_TASKS || [];
        return {
          calls,
          failures: this.failures,
          long_tasks: {
            count: longTasks.length,
            total_ms: Number(longTasks.reduce((sum, item) => sum + item.duration, 0).toFixed(2)),
            max_ms: Number(Math.max(0, ...longTasks.map((item) => item.duration)).toFixed(2)),
            top: [...longTasks]
              .sort((a, b) => b.duration - a.duration)
              .slice(0, 12)
              .map((item) => ({
                name: item.name,
                start_ms: Number(item.startTime.toFixed(2)),
                duration_ms: Number(item.duration.toFixed(2)),
              })),
          },
          event_latency: latencySummary,
          dom_nodes: document.querySelectorAll("*").length,
          visible_tab: document.querySelector(".bottom-tab.active")?.textContent?.trim() || "",
          timeline_hitboxes: window.__droplogicDebug?.state?.timelineHitboxes?.length ?? null,
          timeline_overlay_hitboxes: window.__droplogicDebug?.state?.timelineOverlayHitboxes?.length ?? null,
          event_count: window.__droplogicDebug?.state?.events?.length ?? null,
          temperature_samples: window.__droplogicDebug?.state?.temperatureSamples?.length ?? null,
        };
      },
    };
    window.__DROPOLOGIC_BENCHMARK = bench;
    [
      "render",
      "renderLiveOnly",
      "renderLive",
      "renderConversation",
      "renderPlanTimeline",
      "renderMatrixScene",
      "renderMatrixPanel",
      "renderTemperatureChart",
      "renderTimelineRangeSelector",
      "syncTimelineDropletPanelLayout",
      "renderTimelineDropletPanel",
      "prepareCanvas",
      "timelineLayout",
      "timelineDisplayTimeRange",
      "timelineFrameTimeModel",
      "timelineTimeWarp",
      "timelineSemanticTimes",
      "timelineXForTime",
      "timelineWarpedTimeForReal",
      "timelineRealTimeForWarped",
      "timelineOverlayData",
      "timelineOverlayTimeRange",
      "drawTimelineTemperatureLines",
      "drawTimelineOverlays",
      "drawTimelineRuler",
      "drawTimelineEvents",
      "drawTimelineExecutedRegion",
      "drawTimelineActiveTicks",
      "drawTimelineTimeCursor",
      "drawSelectedDropletTimeline",
      "timelinePlanEvents",
      "conversationRenderItems",
    ].forEach((name) => bench.wrap(name));
  });
}

async function afterNextPaint(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function timed(label, fn) {
  console.error(`[bench] ${label}...`);
  const started = performance.now();
  await fn();
  const result = { label, ms: Number((performance.now() - started).toFixed(2)) };
  console.error(`[bench] ${label}: ${result.ms} ms`);
  return result;
}

async function moveAcross(page, selector, count = 80) {
  const box = await page.locator(selector).boundingBox();
  if (!box) return;
  for (let index = 0; index < count; index += 1) {
    const progress = count <= 1 ? 0 : index / (count - 1);
    const x = box.x + 12 + progress * Math.max(1, box.width - 24);
    const y = box.y + 18 + ((index % 7) / 6) * Math.max(1, box.height - 36);
    await page.mouse.move(x, y);
  }
}

async function wheelOn(page, selector, count = 12) {
  const box = await page.locator(selector).boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.48);
  for (let index = 0; index < count; index += 1) {
    await page.mouse.wheel(0, index % 2 === 0 ? -180 : 140);
  }
}

async function dragTimeline(page) {
  const box = await page.locator("#planTimeline").boundingBox();
  if (!box) return;
  const y = box.y + box.height * 0.55;
  await page.mouse.move(box.x + box.width * 0.12, y);
  await page.mouse.down();
  for (let index = 0; index < 28; index += 1) {
    const progress = index / 27;
    await page.mouse.move(box.x + box.width * (0.12 + progress * 0.72), y + Math.sin(progress * Math.PI * 3) * 12);
  }
  await page.mouse.up();
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const fixture = await loadFixture();
  const { server, url } = await startStaticServer();
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1040 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(fakeWebSocketScript, fixture);
  const page = await context.newPage();

  const timings = [];
  try {
    timings.push(await timed("navigate", async () => {
      await page.goto(`${url}/?perf=1`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#planTimeline", { state: "attached" });
    }));
    await installPageInstrumentation(page);
    timings.push(await timed("load_run_fixture", async () => {
      await page.evaluate(() => window.__DROPOLOGIC_BENCHMARK_LOAD_RUN?.());
      await page.waitForFunction(() => window.__droplogicDebug?.state?.events?.length > 0, null, { timeout: 10000 });
      await afterNextPaint(page);
    }));
    timings.push(await timed("open_timeline_tab", async () => {
      await page.click('[data-bottom-tab="timeline"]');
      await afterNextPaint(page);
    }));
    timings.push(await timed("timeline_mousemove_100", async () => {
      await moveAcross(page, "#planTimeline", 100);
      await afterNextPaint(page);
    }));
    timings.push(await timed("timeline_wheel_16", async () => {
      await wheelOn(page, "#planTimeline", 16);
      await afterNextPaint(page);
    }));
    timings.push(await timed("timeline_drag", async () => {
      await dragTimeline(page);
      await afterNextPaint(page);
    }));
    timings.push(await timed("matrix_mousemove_80", async () => {
      await moveAcross(page, "#matrixScene", 80);
      await afterNextPaint(page);
    }));
    timings.push(await timed("matrix_wheel_10", async () => {
      await wheelOn(page, "#matrixScene", 10);
      await afterNextPaint(page);
    }));
    timings.push(await timed("live_update_burst_20", async () => {
      for (let index = 0; index < 20; index += 1) {
        await page.evaluate(() => window.__DROPOLOGIC_BENCHMARK_EMIT_LIVE?.());
      }
      await afterNextPaint(page);
    }));

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const pageMetrics = await page.evaluate(() => window.__DROPOLOGIC_BENCHMARK.summary());
    const payload = {
      run_id: runId,
      generated_at: new Date().toISOString(),
      fixture: {
        events: fixture.events.length,
        temperature_samples: fixture.temperatureHistory?.samples?.length || 0,
        scene_bytes: Buffer.byteLength(JSON.stringify(fixture.scene)),
      },
      timings,
      page: pageMetrics,
      screenshot: path.relative(repoRoot, screenshotPath),
    };
    await fs.writeFile(metricsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
