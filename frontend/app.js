const MATRIX_VIEW_STORAGE_KEY = "droplogic.matrixView.v1";
const MATRIX_SCENE_STORAGE_KEY = "droplogic.matrixScene.v1";
const STREAMER_VIEW_STORAGE_KEY = "droplogic.streamerView.v1";
const DASHBOARD_LAYOUT_STORAGE_KEY = "droplogic.dashboardLayout.v1";
const TEMPERATURE_HISTORY_STORAGE_PREFIX = "droplogic.temperatureHistory.v1.";
const TIMELINE_MIN_VISIBLE_SECONDS = 1;
const TIMELINE_RANGE_MIN_HANDLE_GAP_PX = 14;
const TIMELINE_IDLE_GAP_SECONDS = 120;
const TIMELINE_IDLE_GAP_VISIBLE_SECONDS = 16;
const TIMELINE_TELEMETRY_TAIL_SECONDS = 300;
const TIMELINE_TEMPERATURE_RENDER_MAX_POINTS = 360;
const TIMELINE_TELEMETRY_RENDER_MS = 900;
const TEMPERATURE_HISTORY_PERSIST_MS = 2500;
const WAKE_RECOGNITION_RESTART_MS = 360;
const AUDIO_AUTO_VOICE_THRESHOLD = 0.032;
const LIVE_RENDER_MIN_INTERVAL_MS = 120;
const TIMELINE_ACTIVE_EXECUTION_AUTO_FOLLOW_GRACE_MS = 1200;

const state = {
  ws: null,
  liveWs: null,
  liveWsConnected: false,
  liveWsReconnectTimer: null,
  events: [],
  eventKeys: new Set(),
  eventWindow: {
    hasMore: false,
    loading: false,
    oldestT: null,
    loadedEventCount: 0,
    totalEventCount: 0,
  },
  status: null,
  live: null,
  liveFrameFreshness: {},
  bottomTab: "state",
  agentBusy: false,
  runs: [],
  runsOpen: false,
  controlsOpen: false,
  selectedRunId: "",
  forceConversationRender: false,
  liveRenderQueued: false,
  liveRenderTimer: null,
  lastLiveRenderAt: 0,
  selectedRuns: new Set(),
  namingRuns: new Set(),
  temperatureSamples: [],
  temperatureTargetSamples: [],
  temperatureHistoryMeta: null,
  temperatureRevision: 0,
  temperaturePersistTimer: null,
  temperatureHover: null,
  tokenChartHover: null,
  contextHistogramHover: null,
  matrixHover: null,
  matrixSceneHitboxes: [],
  timelineHitboxes: [],
  timelineOverlayHitboxes: [],
  matrixSceneCache: null,
  matrixView: {
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: false,
    moved: false,
    dragStartX: 0,
    dragStartY: 0,
    dragPanX: 0,
    dragPanY: 0,
    shapeKey: "",
  },
  matrixNav: {
    edgePanActive: false,
    edgePanRaf: null,
    edgePanLastAt: 0,
    edgePanVx: 0,
    edgePanVy: 0,
    minimapDragging: false,
    lastPointerX: null,
    lastPointerY: null,
    lastPointerAt: 0,
    lastCanvasPoint: null,
  },
  streamerView: {
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: false,
    moved: false,
    dragStartX: 0,
    dragStartY: 0,
    dragPanX: 0,
    dragPanY: 0,
    dragButton: null,
    lastRectWidth: 0,
    lastRectHeight: 0,
    lastRequestKey: "",
    requestTimer: null,
    directUrl: "",
    directSrc: "",
    directActive: false,
    directFailedAt: 0,
  },
  matrixPaths: {
    collapsed: true,
    hiddenActions: new Set(),
    hoveredActionId: "",
    revision: "",
    actionCache: {
      movingKey: "",
      movingActions: [],
      staticKey: "",
      staticActions: [],
    },
    renderKey: "",
  },
  matrixPaint: {
    collapsed: true,
    tool: "",
    dragging: false,
    start: null,
    current: null,
    startDisplay: null,
    currentDisplay: null,
    overlays: [],
  },
  matrixSelection: {
    dragging: false,
    moved: false,
    start: null,
    current: null,
    startPoint: null,
    currentPoint: null,
    startDisplay: null,
    currentDisplay: null,
    ids: new Set(),
  },
  matrixMovePreview: {
    rotation: 0,
    hover: null,
  },
  matrixDropletOverrides: new Map(),
  matrixDropletNudge: {
    lastAt: 0,
  },
  matrixCommands: {
    queues: new Map(),
    planning: false,
    lastError: "",
  },
  matrixRenderStats: {
    samples: [],
    history: [],
    fps: 0,
    uniqueFps: 0,
    lastFrameIndex: null,
    lastFrameCount: null,
    lastSource: "",
    lastMode: "",
    lastDelta: null,
    lastStatus: "idle",
    jumps: 0,
    regressions: 0,
    repeats: 0,
    sourceSwitches: 0,
    lastUpdatedAt: "",
  },
  matrixRenderQueue: {
    raf: null,
    timer: null,
    lastAt: 0,
    options: {},
    fallbackScene: null,
  },
  presets: {
    loaded: false,
    loading: false,
    savingKey: "",
    savingDraftKey: "",
    pendingSave: null,
    applyingKey: "",
    lastAppliedKey: "",
    configPath: "",
    data: {},
    drafts: {},
    categories: [],
    selectedCategory: "stage",
    error: "",
  },
  layout: {
    collapsed: {
      visuals: false,
      streamer: false,
      matrix: false,
      bottom: false,
      chat: false,
    },
    chatWidth: 380,
    bottomHeight: 240,
    streamerRatio: 0.5,
    resizing: null,
    renderQueued: false,
  },
  calibration: {
    active: false,
    data: null,
    localPosition: null,
    speedKey: "2",
    jogDirections: { X: 0, Y: 0, Z: 0 },
    jogKeepaliveTimer: null,
    lastJogAt: 0,
    lastMoveAt: 0,
    movePending: false,
  },
  stageMotion: {
    active: false,
    start: null,
    target: null,
    lastPosition: null,
    lastPositionAt: 0,
    eventPosition: null,
    eventPositionAt: 0,
    startedAt: 0,
    durationMs: 0,
    raf: null,
    lastRenderAt: 0,
    callEventId: "",
    source: "",
  },
  timeline: {
    followLive: true,
    liveBootstrappedRunId: "",
    manualPreviewExecutionKey: "",
    manualPreviewAt: 0,
    selectedFrame: null,
    selectedDropletId: null,
    dragging: false,
    moved: false,
    dragMode: "",
    dragStartX: 0,
    dragStartY: 0,
    dragStartOffsetFrame: 0,
    dragStartOffsetTime: 0,
    hoverFrame: null,
    hoverTime: null,
    hoverEvent: null,
    hoverOverlay: null,
    hoverX: 0,
    hoverY: 0,
    hoverHitKey: "",
    hoverContentKey: "",
    hoverTooltipWidth: 0,
    hoverTooltipHeight: 0,
    hoverRaf: null,
    pendingHover: null,
    zoom: 1,
    offsetFrame: 0,
    timeOffset: 0,
    selectedTime: null,
    frameDelay: 1.0,
    overlayMenuOpen: false,
    executorMenuOpen: false,
    overlays: {
      plan: true,
      measuredTemperature: true,
      targetTemperature: true,
      stage: true,
      photos: true,
      timelineStops: true,
    },
    overlayCache: {
      key: "",
      data: null,
    },
    rangeCache: {
      key: "",
      data: null,
    },
    semanticTimesCache: {
      key: "",
      data: null,
    },
    timeWarpCache: {
      key: "",
      data: null,
    },
    telemetryTailCache: {
      key: "",
      data: null,
    },
    stopMarkersCache: {
      key: "",
      data: null,
    },
    eventBoundsCache: {
      key: "",
      data: null,
    },
    layoutCache: {
      key: "",
      layout: null,
    },
    canvasBaseCache: {
      key: "",
      bitmap: null,
    },
    renderQueued: false,
    telemetryRenderTimer: null,
    rangeDrag: {
      active: false,
      mode: "",
      pointerId: null,
      anchorTime: null,
      start: null,
      end: null,
      offset: 0,
      moved: false,
    },
  },
  tokenChartLines: {
    request: true,
    cumulative: false,
    mean5: false,
  },
  lastRenderedConversationKey: "",
  conversationFilters: {
    text: true,
    thinking: true,
    tools: true,
    context: true,
    system: true,
  },
  filtersOpen: false,
  thinkingTick: 0,
  thinkingTimer: null,
  compactingUntil: 0,
  typewriter: new Map(),
  typewriterTimer: null,
  typewriterVersion: 0,
  conversationAtLatest: true,
  audio: {
    modelLoadSupported: false,
    modelLoaded: false,
    modelLoading: false,
    recording: false,
    transcribing: false,
    recorder: null,
    stream: null,
    chunks: [],
    startedAt: 0,
    mimeType: "",
    audioContext: null,
    analyser: null,
    meterData: null,
    timeData: null,
    meterAnimation: null,
    autoTimer: null,
    lastRms: 0,
    autoRecording: false,
    autoHadVoice: false,
    autoLastVoiceAt: 0,
    autoSilenceStartedAt: 0,
    autoStopping: false,
    recordingSource: "manual",
    pendingSource: "",
    pendingAutoSubmit: false,
    wakeListening: false,
    wakeActive: false,
    wakeSupported: false,
    wakeAutoStart: false,
    wakeAutoStarted: false,
    wakeManualStart: false,
    wakeRecognizer: null,
    wakeRestartTimer: null,
    wakePhrase: "BoxMini",
    wakeLanguage: "",
    wakeAutoSubmit: true,
    wakeCommandMaxSeconds: 24,
    wakeSilenceMs: 1200,
    wakeInitialSilenceMs: 5000,
    commandRecognizer: null,
    commandRecognitionActive: false,
    commandRecognitionEnabled: false,
    commandRecognitionFailed: false,
    commandRecognitionRestartTimer: null,
    commandSpeechHadWords: false,
    commandSpeechLastAt: 0,
    commandSpeechActive: false,
    commandSpeechEventSeen: false,
    commandLastTranscriptKey: "",
    commandLastTranscriptAt: 0,
    commandSpeechLastReason: "",
  },
};

window.__droplogicDebug = {
  state,
};

const TYPEWRITER_INTERVAL_MS = 11;
const TYPEWRITER_CHARS_PER_TICK = 4;

const $ = (id) => document.getElementById(id);

restoreMatrixView();
restoreMatrixSceneCache();
restoreStreamerView();
restoreDashboardLayout();

function restoreMatrixView() {
  try {
    const raw = window.localStorage?.getItem(MATRIX_VIEW_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return;
    const zoom = Number(saved.zoom);
    const panX = Number(saved.panX);
    const panY = Number(saved.panY);
    if (Number.isFinite(zoom)) state.matrixView.zoom = clamp(zoom, 0.6, 48);
    if (Number.isFinite(panX)) state.matrixView.panX = panX;
    if (Number.isFinite(panY)) state.matrixView.panY = panY;
    if (typeof saved.shapeKey === "string") state.matrixView.shapeKey = saved.shapeKey;
  } catch {
    // Ignore stale or blocked localStorage; the matrix can always reset to fit.
  }
}

function saveMatrixView() {
  try {
    window.localStorage?.setItem(
      MATRIX_VIEW_STORAGE_KEY,
      JSON.stringify({
        zoom: state.matrixView.zoom,
        panX: state.matrixView.panX,
        panY: state.matrixView.panY,
        shapeKey: state.matrixView.shapeKey,
      }),
    );
  } catch {
    // Best-effort persistence only.
  }
}

function restoreStreamerView() {
  try {
    const raw = window.localStorage?.getItem(STREAMER_VIEW_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return;
    const zoom = Number(saved.zoom);
    const panX = Number(saved.panX);
    const panY = Number(saved.panY);
    if (Number.isFinite(zoom)) state.streamerView.zoom = clamp(zoom, 1, 12);
    if (Number.isFinite(panX)) state.streamerView.panX = panX;
    if (Number.isFinite(panY)) state.streamerView.panY = panY;
  } catch {
    // Best-effort view persistence only.
  }
}

function saveStreamerView() {
  try {
    window.localStorage?.setItem(
      STREAMER_VIEW_STORAGE_KEY,
      JSON.stringify({
        zoom: state.streamerView.zoom,
        panX: state.streamerView.panX,
        panY: state.streamerView.panY,
      }),
    );
  } catch {
    // Best-effort view persistence only.
  }
}

function restoreDashboardLayout() {
  try {
    const raw = window.localStorage?.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return;
    const collapsed = saved.collapsed && typeof saved.collapsed === "object" ? saved.collapsed : {};
    for (const key of Object.keys(state.layout.collapsed)) {
      state.layout.collapsed[key] = Boolean(collapsed[key]);
    }
    const chatWidth = Number(saved.chatWidth);
    const bottomHeight = Number(saved.bottomHeight);
    const streamerRatio = Number(saved.streamerRatio);
    if (Number.isFinite(chatWidth)) state.layout.chatWidth = clamp(chatWidth, 260, 900);
    if (Number.isFinite(bottomHeight)) state.layout.bottomHeight = clamp(bottomHeight, 96, 520);
    if (Number.isFinite(streamerRatio)) state.layout.streamerRatio = clamp(streamerRatio, 0.18, 0.82);
  } catch {
    // Layout persistence should never block the dashboard.
  }
}

function saveDashboardLayout() {
  try {
    window.localStorage?.setItem(
      DASHBOARD_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        collapsed: state.layout.collapsed,
        chatWidth: state.layout.chatWidth,
        bottomHeight: state.layout.bottomHeight,
        streamerRatio: state.layout.streamerRatio,
      }),
    );
  } catch {
    // Best effort only.
  }
}

function restoreMatrixSceneCache() {
  try {
    const raw = window.localStorage?.getItem(MATRIX_SCENE_STORAGE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw);
    const scene = cached?.scene?.result || cached?.scene;
    if (!scene?.available) return;
    if (!matrixSceneMatchesRuntimeSession(scene)) return;
    state.matrixSceneCache = cached;
    state.live = {
      ...(state.live || {}),
      updated_at: cached.updated_at,
      scene: cached.scene,
    };
  } catch {
    state.matrixSceneCache = null;
  }
}

function persistMatrixScene(scene, live = {}) {
  if (!scene?.available) return;
  if (!matrixSceneMatchesRuntimeSession(scene, live)) return;
  const cached = {
    updated_at: live.updated_at || new Date().toISOString(),
    scene,
  };
  state.matrixSceneCache = cached;
  try {
    window.localStorage?.setItem(MATRIX_SCENE_STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // Scene persistence is a convenience cache; skip if storage is full.
  }
}

function mergeLiveWithMatrixCache(live) {
  const nextLive = mergeLiveWithFreshFrames(live || {});
  const scene = nextLive?.scene?.result || nextLive?.scene;
  if (scene?.available) {
    if (matrixSceneMatchesRuntimeSession(scene, nextLive)) {
      const currentScene = state.live?.scene?.result || state.live?.scene;
      if (matrixSceneIsStaleComparedTo(scene, currentScene)) {
        return {
          ...nextLive,
          scene: state.live.scene,
          matrix_scene_stale_ignored: matrixSceneFreshnessSummary(scene, currentScene),
        };
      }
      persistMatrixScene(scene, nextLive);
      return nextLive;
    }
    return {
      ...nextLive,
      scene: {
        available: false,
        reason: "scene_session_mismatch",
        session_id: matrixSceneSessionId(scene),
        runtime_session_id: runtimeSessionIdFromLive(nextLive),
      },
    };
  }
  const cachedScene = state.matrixSceneCache?.scene?.result || state.matrixSceneCache?.scene;
  if (state.matrixSceneCache?.scene && matrixSceneMatchesRuntimeSession(cachedScene, nextLive)) {
    return {
      ...nextLive,
      updated_at: nextLive.updated_at || state.matrixSceneCache.updated_at,
      scene: state.matrixSceneCache.scene,
    };
  }
  return nextLive;
}

function mergeLiveWithFreshFrames(live) {
  if (!live || typeof live !== "object" || !live.frames || typeof live.frames !== "object") return live;
  const frames = { ...(live.frames || {}) };
  let changed = false;
  for (const [visualizer, frame] of Object.entries(frames)) {
    if (!frameIsFreshForVisualizer(visualizer, frame, live.updated_at)) {
      const current = state.live?.frames?.[visualizer];
      if (current) {
        frames[visualizer] = current;
        changed = true;
      }
      continue;
    }
    rememberFrameFreshness(visualizer, frame, live.updated_at);
  }
  return changed ? { ...live, frames } : live;
}

function frameFreshness(frame, updatedAt = "") {
  const roots = [
    frame,
    frame?.dashboard_live,
    frame?.result && typeof frame.result === "object" ? frame.result : null,
    frame?.result?.dashboard_live,
  ].filter(Boolean);
  let sequence = null;
  let capturedAt = "";
  for (const root of roots) {
    const rawSequence = root.dashboard_live_sequence ?? root.sequence;
    const parsedSequence = Number(rawSequence);
    if (sequence === null && Number.isFinite(parsedSequence)) sequence = Math.trunc(parsedSequence);
    const rawTime = root.dashboard_live_captured_at || root.captured_at || root.updated_at || "";
    if (!capturedAt && rawTime) capturedAt = String(rawTime);
  }
  if (!capturedAt && updatedAt) capturedAt = String(updatedAt);
  const capturedMs = capturedAt ? Date.parse(capturedAt) : NaN;
  return {
    sequence,
    capturedAt,
    capturedMs: Number.isFinite(capturedMs) ? capturedMs : null,
  };
}

function frameFreshnessIsNewer(next, previous) {
  if (!previous) return true;
  if (next.sequence !== null && previous.sequence !== null) return next.sequence >= previous.sequence;
  if (next.sequence !== null && previous.sequence === null) return true;
  if (next.sequence === null && previous.sequence !== null) return false;
  if (next.capturedMs !== null && previous.capturedMs !== null) return next.capturedMs >= previous.capturedMs;
  return true;
}

function frameIsFreshForVisualizer(visualizer, frame, updatedAt = "") {
  const next = frameFreshness(frame, updatedAt);
  return frameFreshnessIsNewer(next, state.liveFrameFreshness?.[visualizer]);
}

function rememberFrameFreshness(visualizer, frame, updatedAt = "") {
  state.liveFrameFreshness[visualizer] = frameFreshness(frame, updatedAt);
}

function matrixSceneIsStaleComparedTo(incoming, current) {
  if (!incoming?.available || !current?.available) return false;
  const next = matrixSceneFreshness(incoming);
  const prev = matrixSceneFreshness(current);
  if (next.sessionId && prev.sessionId && next.sessionId !== prev.sessionId) return false;
  if (next.planKey && prev.planKey && next.planKey !== prev.planKey) return false;
  if (Number.isFinite(next.sequence) && Number.isFinite(prev.sequence) && next.sequence < prev.sequence) return true;
  if (Number.isFinite(next.sequence) && Number.isFinite(prev.sequence) && next.sequence > prev.sequence) return false;
  if (
    Number.isFinite(next.frameCount)
    && Number.isFinite(prev.frameCount)
    && next.frameCount !== prev.frameCount
  ) {
    return false;
  }
  if (!Number.isFinite(next.frameIndex) || !Number.isFinite(prev.frameIndex)) return false;
  if (next.frameIndex >= prev.frameIndex) return false;
  const nextTime = firstFiniteNumber(next.appliedAt, next.updatedAt);
  const prevTime = firstFiniteNumber(prev.appliedAt, prev.updatedAt);
  if (Number.isFinite(nextTime) && Number.isFinite(prevTime) && nextTime > prevTime + 0.001) return false;
  return true;
}

function matrixSceneFreshness(scene) {
  const executor = scene?.executor || scene?.executor_status || {};
  const applied = executor.last_applied_frame || scene?.last_applied_frame || {};
  const frame = scene?.frame || {};
  const plan = scene?.plan || {};
  const frameIndex = firstFiniteNumber(
    frame.index,
    applied.index,
    Number.isFinite(Number(executor.current_frame)) ? Number(executor.current_frame) - 1 : null,
  );
  const frameCount = firstFiniteNumber(
    frame.count,
    applied.plan_frame_count,
    executor.total_frames,
    plan.frame_count,
  );
  const planKey = firstNonEmptyString(
    applied.plan_id,
    frame.plan_id,
    plan.plan_id,
    plan.id,
    frameCount,
  );
  return {
    sessionId: matrixSceneSessionId(scene),
    planKey: planKey ? String(planKey) : "",
    frameIndex: Number.isFinite(frameIndex) ? Math.trunc(Number(frameIndex)) : NaN,
    frameCount: Number.isFinite(frameCount) ? Math.trunc(Number(frameCount)) : NaN,
    sequence: firstFiniteNumber(scene?.dashboard_live_sequence, scene?.dashboard_live?.sequence),
    appliedAt: firstFiniteNumber(applied.applied_at, executor.last_update, executor.last_frame?.finished_at),
    updatedAt: firstFiniteNumber(scene?.updated_at, frame.updated_at, plan.updated_at),
  };
}

function matrixSceneFreshnessSummary(incoming, current) {
  return {
    incoming: matrixSceneFreshness(incoming),
    current: matrixSceneFreshness(current),
  };
}

function matrixSceneMatchesRuntimeSession(scene, live = state.live || {}) {
  const runtimeSessionId = runtimeSessionIdFromLive(live);
  if (!runtimeSessionId) return true;
  const sceneSessionId = matrixSceneSessionId(scene);
  return Boolean(sceneSessionId) && sceneSessionId === runtimeSessionId;
}

function runtimeSessionIdFromLive(live = state.live || {}) {
  return firstNonEmptyString(
    live?.runtime?.session_id,
    live?.runtime?.result?.session_id,
    live?.runtime?.structuredContent?.result?.session_id,
    state.status?.runtime?.session_id,
  );
}

function matrixSceneSessionId(scene) {
  return firstNonEmptyString(
    scene?.session_id,
    scene?.result?.session_id,
    scene?.runtime?.session_id,
  );
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function rawLiveStagePosition() {
  const root = typeof currentLiveState === "function"
    ? currentLiveState()
    : (state.live?.state?.value || state.live?.state?.result?.value || state.live?.state || {});
  return normalizeStagePosition(getPath(root, "xy_stage.position"));
}

function stageMotionPosition(options = {}) {
  const motion = state.stageMotion || {};
  if (motion.active && motion.start && motion.target) {
    const now = performance.now();
    const duration = Math.max(1, Number(motion.durationMs) || 1);
    const progress = clamp((now - Number(motion.startedAt || now)) / duration, 0, 1);
    const eased = progress < 1
      ? 1 - Math.pow(1 - progress, 3)
      : 1;
    return interpolateStagePosition(motion.start, motion.target, eased);
  }
  if (options.includeFreshFinal !== false && motion.lastPosition && Date.now() - Number(motion.lastPositionAt || 0) < 5000) {
    return normalizeStagePosition(motion.lastPosition);
  }
  if (options.includeEvent !== false && motion.eventPosition) {
    return normalizeStagePosition(motion.eventPosition);
  }
  return null;
}

function interpolateStagePosition(start, target, progress) {
  const position = {};
  for (const axis of ["X", "Y", "Z"]) {
    const from = Number(start?.[axis]);
    const to = Number(target?.[axis]);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      position[axis] = Math.trunc(from + (to - from) * progress);
    } else if (Number.isFinite(to)) {
      position[axis] = Math.trunc(to);
    } else if (Number.isFinite(from)) {
      position[axis] = Math.trunc(from);
    }
  }
  return Object.keys(position).length ? position : null;
}

function beginStageMotionFromCommand(command = {}) {
  const target = stageMotionTargetFromPayload(command);
  if (!target || !Number.isFinite(Number(target.X)) || !Number.isFinite(Number(target.Y))) return false;
  const start = normalizeStagePosition(command.start_position)
    || stageMotionPosition()
    || rawLiveStagePosition()
    || normalizeStagePosition(state.calibration.localPosition)
    || target;
  const durationMs = estimateStageMotionDurationMs(start, target, command);
  state.stageMotion.active = true;
  state.stageMotion.start = start;
  state.stageMotion.target = target;
  state.stageMotion.startedAt = performance.now();
  state.stageMotion.durationMs = durationMs;
  state.stageMotion.lastPosition = null;
  state.stageMotion.lastPositionAt = 0;
  state.stageMotion.callEventId = String(command.call_event_id || command.callEventId || "");
  state.stageMotion.source = String(command.source || command.via || "");
  state.stageMotion.lastRenderAt = 0;
  scheduleStageMotionAnimation();
  renderMatrixPanel(state.live || {});
  return true;
}

function finishStageMotionFromPayload(payload = {}) {
  if (stageMotionPayloadIsQueuedOnly(payload)) return;
  const actual = stagePositionFromToolPayload(payload)
    || stageMotionTargetFromPayload(payload)
    || normalizeStagePosition(state.stageMotion.target);
  if (actual) {
    state.stageMotion.lastPosition = actual;
    state.stageMotion.lastPositionAt = Date.now();
    state.stageMotion.eventPosition = actual;
    state.stageMotion.eventPositionAt = Date.now();
  }
  state.stageMotion.active = false;
  state.stageMotion.start = null;
  state.stageMotion.target = null;
  if (state.stageMotion.raf !== null) {
    cancelAnimationFrame(state.stageMotion.raf);
    state.stageMotion.raf = null;
  }
  renderMatrixPanel(state.live || {});
  renderStateGrid(state.live || {});
}

function scheduleStageMotionAnimation() {
  if (state.stageMotion.raf !== null) return;
  const step = () => {
    state.stageMotion.raf = null;
    if (!state.stageMotion.active) return;
    const now = performance.now();
    if (now - Number(state.stageMotion.lastRenderAt || 0) >= 80) {
      state.stageMotion.lastRenderAt = now;
      renderMatrixPanel(state.live || {});
    }
    const elapsed = now - Number(state.stageMotion.startedAt || now);
    if (elapsed >= Math.max(1, Number(state.stageMotion.durationMs) || 1)) {
      finishStageMotionFromPayload({
        actual_position: state.stageMotion.target,
        motion_complete: true,
      });
      return;
    }
    state.stageMotion.raf = requestAnimationFrame(step);
  };
  state.stageMotion.raf = requestAnimationFrame(step);
}

function estimateStageMotionDurationMs(start, target, payload = {}) {
  const explicit = firstFiniteNumber(payload.duration_seconds, payload.estimated_seconds, payload.estimate_seconds);
  const timeout = firstFiniteNumber(payload.wait_timeout_seconds, payload.arguments?.wait_timeout_seconds);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(clamp(explicit, 0.25, Math.max(0.3, timeout || 12)) * 1000);
  }
  const dx = Number(target?.X) - Number(start?.X);
  const dy = Number(target?.Y) - Number(start?.Y);
  const dz = Number.isFinite(Number(target?.Z)) && Number.isFinite(Number(start?.Z))
    ? Number(target.Z) - Number(start.Z)
    : 0;
  const distance = Math.hypot(Number.isFinite(dx) ? dx : 0, Number.isFinite(dy) ? dy : 0) + Math.abs(dz) * 0.25;
  const seconds = distance > 0 ? distance / 35000 : 0.35;
  const capped = Number.isFinite(timeout) && timeout > 0 ? Math.min(seconds, timeout) : seconds;
  return Math.round(clamp(capped, 0.35, 12) * 1000);
}

function stageMotionTargetFromPayload(payload = {}) {
  const args = payload.arguments && typeof payload.arguments === "object" ? payload.arguments : payload;
  return stagePositionFromToolPayload(payload, { preferTarget: true })
    || normalizeStagePosition(payload.target_position)
    || normalizeStagePosition(payload.position)
    || normalizeStagePosition(args.target_position)
    || normalizeStagePosition(args.position)
    || presetStagePosition(args.preset || payload.preset, payload.category || args.category);
}

function stagePositionFromToolPayload(payload, options = {}) {
  const roots = toolPayloadRoots(payload);
  const targetFirst = options.preferTarget === true;
  for (const root of roots) {
    const position = targetFirst
      ? normalizeStagePosition(
        getPath(root, "target_position")
        || getPath(root, "position")
        || getPath(root, "actual_position")
        || getPath(root, "result.target_position")
        || getPath(root, "result.position")
        || getPath(root, "result.actual_position"),
      )
      : normalizeStagePosition(
        getPath(root, "actual_position")
        || getPath(root, "target_position")
        || getPath(root, "position")
        || getPath(root, "result.actual_position")
        || getPath(root, "result.target_position")
        || getPath(root, "result.position"),
      );
    if (position) return position;
  }
  return null;
}

function stageMotionPayloadIsQueuedOnly(payload) {
  for (const root of toolPayloadRoots(payload)) {
    if (getPath(root, "queued_only") === true || getPath(root, "result.queued_only") === true) return true;
    if (getPath(root, "motion_complete") === false || getPath(root, "result.motion_complete") === false) return true;
  }
  return false;
}

function toolPayloadRoots(payload) {
  const roots = [];
  const push = (value) => {
    if (value && typeof value === "object" && !roots.includes(value)) roots.push(value);
  };
  push(payload);
  push(payload?.result);
  push(payload?.structuredContent);
  push(payload?.structuredContent?.result);
  push(payload?.result?.structuredContent);
  push(payload?.result?.structuredContent?.result);
  for (const root of [payload, payload?.result]) {
    if (!Array.isArray(root?.content)) continue;
    for (const part of root.content) {
      push(part?.structuredContent);
      push(part?.structuredContent?.result);
      if (typeof part?.text === "string") {
        const parsed = parseJsonMaybe(part.text);
        push(parsed);
        push(parsed?.result);
      }
    }
  }
  return roots;
}

function presetStagePosition(name, category = "") {
  const presetName = String(name || "").trim();
  if (!presetName) return null;
  const categories = category ? [String(category)] : ["stage", "imaging"];
  for (const item of categories) {
    const preset = state.presets.data?.[item]?.[presetName];
    const position = normalizeStagePosition(preset?.position || preset?.stage_position);
    if (position) return position;
  }
  return null;
}

function beginStageMotionFromEvent(event) {
  if (event?.type !== "mcp_tool_call" || String(event.tool || "").toLowerCase() !== "move_stage") return;
  beginStageMotionFromCommand({
    arguments: event.arguments || {},
    call_event_id: event.t,
    source: event.via || "event",
    wait_timeout_seconds: event.arguments?.wait_timeout_seconds,
  });
}

function finishStageMotionFromEvent(event) {
  if (event?.type === "stage_position") {
    finishStageMotionFromPayload({
      actual_position: event.actual_position || event.position,
      target_position: event.target_position || event.position,
      position: event.position || event.actual_position || event.target_position,
      call_event_id: event.parent_call_event_id || event.t,
    });
    return;
  }
  if (event?.type !== "mcp_tool_result" || String(event.tool || "").toLowerCase() !== "move_stage") return;
  finishStageMotionFromPayload({
    ...(event.result && typeof event.result === "object" ? event.result : {}),
    call_event_id: event.call_event_id,
  });
}

function rehydrateStageMotionFromEvents(events = state.events || []) {
  let latest = null;
  for (const event of events || []) {
    const position = stagePositionFromEvent(event);
    if (position) latest = position;
  }
  if (!latest) return;
  state.stageMotion.eventPosition = latest;
  state.stageMotion.eventPositionAt = Date.now();
  state.stageMotion.lastPosition = latest;
  state.stageMotion.lastPositionAt = Date.now();
}

function handleStageMotionMessage(data) {
  if (data.phase === "start") {
    beginStageMotionFromCommand(data);
  } else if (data.phase === "queued") {
    return;
  } else if (data.phase === "end" || data.phase === "done" || data.phase === "stop") {
    finishStageMotionFromPayload(data);
  }
}

function syncStageMotionWithLive() {
  const livePosition = rawLiveStagePosition();
  if (!livePosition) return;
  if (state.stageMotion.active && stagePositionsClose(livePosition, state.stageMotion.target)) {
    finishStageMotionFromPayload({ actual_position: livePosition });
    return;
  }
  if (state.stageMotion.lastPosition && stagePositionsClose(livePosition, state.stageMotion.lastPosition)) {
    state.stageMotion.eventPosition = livePosition;
    state.stageMotion.eventPositionAt = Date.now();
    state.stageMotion.lastPosition = null;
    state.stageMotion.lastPositionAt = 0;
    return;
  }
  if (state.stageMotion.lastPosition && Date.now() - Number(state.stageMotion.lastPositionAt || 0) < 5000) {
    return;
  }
  state.stageMotion.eventPosition = livePosition;
  state.stageMotion.eventPositionAt = Date.now();
}

function stagePositionsClose(a, b) {
  if (!a || !b) return false;
  const dx = Math.abs(Number(a.X) - Number(b.X));
  const dy = Math.abs(Number(a.Y) - Number(b.Y));
  const dz = Number.isFinite(Number(a.Z)) && Number.isFinite(Number(b.Z))
    ? Math.abs(Number(a.Z) - Number(b.Z))
    : 0;
  return dx <= 2 && dy <= 2 && dz <= 2;
}

function appendEvent(event, options = {}) {
  if (isFrontendTelemetryOnlyEvent(event)) {
    ingestFrontendTelemetryEvent(event);
    return;
  }
  const key = eventKey(event);
  if (state.eventKeys.has(key) || state.events.some((item) => eventKey(item) === key)) return;
  state.eventKeys.add(key);
  state.events.push(event);
  state.eventWindow.loadedEventCount = Math.max(
    Number(state.eventWindow.loadedEventCount || 0),
    state.events.length,
  );
  if (options.replay !== true) {
    beginStageMotionFromEvent(event);
    finishStageMotionFromEvent(event);
  }
  if (isAudioTerminalEvent(event)) {
    state.audio.transcribing = false;
    setAudioStatus(event.type === "audio_transcript" ? "Transcript ready" : "Transcription error", event.type !== "audio_transcript");
  }
  if (event?.type === "temperature_sample") {
    ingestTemperatureHistoryEvent(event);
  }
  if ((event.type === "context_compacted" || event.type === "context_ai_summary") && options.replay !== true) {
    state.compactingUntil = Date.now() + 2600;
  }
  if (options.liveAgent === true) scheduleTypewriter(event);
  render();
}

function isFrontendTelemetryOnlyEvent(event) {
  return event?.type === "temperature_sample";
}

function ingestFrontendTelemetryEvent(event) {
  if (event?.type === "temperature_sample") {
    ingestTemperatureHistoryEvent(event);
    renderTemperatureChart();
    scheduleTimelineTelemetryRender();
  }
}

function scheduleTimelineTelemetryRender() {
  if (!isTimelinePanelVisible()) return;
  if (state.timeline.telemetryRenderTimer !== null) return;
  state.timeline.telemetryRenderTimer = window.setTimeout(() => {
    state.timeline.telemetryRenderTimer = null;
    schedulePlanTimelineRender();
  }, TIMELINE_TELEMETRY_RENDER_MS);
}

function schedulePlanTimelineRender() {
  if (!isTimelinePanelVisible()) {
    updateTimelineLightweightControls();
    return;
  }
  if (state.timeline.renderQueued) return;
  state.timeline.renderQueued = true;
  requestAnimationFrame(() => {
    state.timeline.renderQueued = false;
    renderPlanTimeline();
  });
}

function timelineLayoutCacheKey(scene, count, width, height) {
  return [
    timelineDataCacheKey(scene),
    Math.round(Number(width) || 0),
    Math.round(Number(height) || 0),
    Number(count) || 0,
    Number(state.timeline.zoom || 1).toFixed(4),
    Number(state.timeline.timeOffset || 0).toFixed(3),
  ].join("|");
}

function timelineCanvasBaseKey(scene, count, width, height) {
  const executor = scene?.executor || {};
  const overlays = state.timeline.overlays || {};
  return [
    timelineLayoutCacheKey(scene, count, width, height),
    timelineHasFiniteNumber(scene?.frame?.index) ? Math.trunc(Number(scene.frame.index)) : "",
    timelineHasFiniteNumber(executor?.current_frame) ? Math.trunc(Number(executor.current_frame)) : "",
    timelineHasFiniteNumber(executor?.last_applied_frame?.index) ? Math.trunc(Number(executor.last_applied_frame.index)) : "",
    Boolean(executor?.is_executing || executor?.running),
    Boolean(state.matrixCommands.planning),
    Object.keys(overlays).sort().map((key) => `${key}:${overlays[key] !== false ? 1 : 0}`).join(","),
  ].join("|");
}

function cachedTimelineLayout(canvas, scene, count) {
  if (!canvas || !count) return null;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || canvas.width));
  const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || canvas.height));
  const key = timelineLayoutCacheKey(scene, count, width, height);
  if (state.timeline.layoutCache.key === key && state.timeline.layoutCache.layout) {
    return state.timeline.layoutCache.layout;
  }
  const timeline = effectiveTimeline(scene);
  const layout = timelineLayout(width, height, count, scene, timeline);
  state.timeline.layoutCache = { key, layout };
  return layout;
}

function cacheTimelineCanvasBase(canvas, ctx, layout, key) {
  if (!canvas || !ctx || !layout || !key) return;
  try {
    state.timeline.canvasBaseCache = {
      key,
      width: canvas.width,
      height: canvas.height,
      cssWidth: layout.width,
      cssHeight: layout.height,
      layout,
      imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
    };
  } catch {
    state.timeline.canvasBaseCache = { key: "", imageData: null };
  }
}

function restoreTimelineCanvasBase(canvas, ctx, key) {
  const cache = state.timeline.canvasBaseCache;
  if (!canvas || !ctx || !cache?.imageData || cache.key !== key) return false;
  if (cache.width !== canvas.width || cache.height !== canvas.height) return false;
  try {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(cache.imageData, 0, 0);
    ctx.restore();
    return true;
  } catch {
    return false;
  }
}

function renderTimelineHoverCursorFast(scene = state.live?.scene?.result || state.live?.scene, options = {}) {
  const canvas = $("planTimeline");
  const count = timelineFrameCount(scene);
  if (!canvas || !count || !isTimelinePanelVisible()) return false;
  const { ctx, width, height } = prepareCanvas(canvas);
  const key = timelineCanvasBaseKey(scene, count, width, height);
  const cache = state.timeline.canvasBaseCache;
  const layout = cache?.key === key && cache.layout
    ? cache.layout
    : (state.timeline.layoutCache.layout || cachedTimelineLayout(canvas, scene, count));
  if (!layout || !restoreTimelineCanvasBase(canvas, ctx, key)) return false;
  drawTimelineDynamicCursors(ctx, layout, scene);
  if (options.updateControls === true) updateTimelineLightweightControls(scene);
  return true;
}

function drawTimelineDynamicCursors(ctx, layout, scene) {
  const selected = selectedTimelineFrame(scene);
  if (Number.isFinite(selected) && !state.timeline.followLive) {
    drawTimelineTimeCursor(
      ctx,
      layout,
      timelineHasFiniteNumber(state.timeline.selectedTime)
        ? Number(state.timeline.selectedTime)
        : timelineTimeForFrame(layout, selected),
      "rgba(100, 210, 255, 0.98)",
      true,
      "preview",
    );
  }
  if (timelineHasFiniteNumber(state.timeline.hoverTime)) {
    drawTimelineTimeCursor(ctx, layout, Number(state.timeline.hoverTime), "rgba(245, 245, 247, 0.22)", false);
  }
}

function updateTimelineLightweightControls(scene = state.live?.scene?.result || state.live?.scene) {
  const count = timelineFrameCount(scene);
  const processing = Boolean(state.matrixCommands.planning);
  const label = $("timelineFrameLabel");
  if (label) label.textContent = timelineFrameLabel(scene);
  const liveButton = $("timelineLive");
  if (liveButton) {
    liveButton.classList.toggle("active", state.timeline.followLive);
    liveButton.disabled = !count || processing;
    liveButton.textContent = state.timeline.followLive ? "Live" : "Go Live";
    liveButton.title = state.timeline.followLive
      ? "Following the executing frame"
      : "Return to the currently executing frame";
  }
  const trimButton = $("timelineTrimTail");
  if (trimButton) trimButton.disabled = !canTrimTimelineTail(scene) || processing;
}

function resetRunEvents(events = [], eventWindow = {}) {
  state.events = [];
  state.eventKeys = new Set();
  for (const event of events || []) {
    if (isFrontendTelemetryOnlyEvent(event)) {
      ingestFrontendTelemetryEvent(event);
      continue;
    }
    const key = eventKey(event);
    if (state.eventKeys.has(key)) continue;
    state.eventKeys.add(key);
    state.events.push(event);
  }
  state.eventWindow = {
    hasMore: Boolean(eventWindow?.has_more),
    loading: false,
    oldestT: eventWindow?.oldest_t ?? (state.events[0]?.t ?? null),
    loadedEventCount: Number(eventWindow?.loaded_event_count || state.events.length) || state.events.length,
    totalEventCount: Number(eventWindow?.total_event_count || state.events.length) || state.events.length,
  };
}

function prependOlderRunEvents(events = [], eventWindow = {}) {
  const incoming = [];
  for (const event of events || []) {
    if (isFrontendTelemetryOnlyEvent(event)) continue;
    const key = eventKey(event);
    if (state.eventKeys.has(key)) continue;
    state.eventKeys.add(key);
    incoming.push(event);
  }
  state.events = [...incoming, ...state.events];
  state.eventWindow = {
    ...state.eventWindow,
    hasMore: Boolean(eventWindow?.has_more),
    loading: false,
    oldestT: eventWindow?.oldest_t ?? (state.events[0]?.t ?? null),
    loadedEventCount: state.events.length,
    totalEventCount: Number(eventWindow?.total_event_count || state.eventWindow.totalEventCount || state.events.length) || state.events.length,
  };
  state.lastRenderedConversationKey = "";
}

function loadOlderConversationEvents() {
  if (state.eventWindow.loading || !state.eventWindow.hasMore) return;
  state.eventWindow.loading = true;
  state.lastRenderedConversationKey = "";
  renderConversation();
  send({
    type: "load_older_events",
    run_id: state.selectedRunId || state.status?.run_id || "",
    before_t: state.eventWindow.oldestT ?? state.events[0]?.t ?? null,
  });
}

function eventKey(event) {
  if (event?.t !== undefined && event?.t !== null) {
    return `${event.t}|${event.type || ""}|${event.tool || ""}|${event.call_event_id || ""}`;
  }
  const text = String(event?.text || event?.prompt || event?.message || event?.error || "");
  return `${event?.ts || ""}|${event?.type || ""}|${event?.tool || ""}|${text.slice(0, 160)}`;
}

function isAudioTerminalEvent(event) {
  return event?.type === "audio_transcript" || event?.type === "audio_transcription_error";
}

function audioTranscriptionPending(events) {
  let pending = false;
  for (const event of events || []) {
    if (event.type === "audio_transcription_started") pending = true;
    if (isAudioTerminalEvent(event)) pending = false;
  }
  return pending;
}

function syncSpeechConfig(speech) {
  if (!speech || typeof speech !== "object") return;
  const supportsManualLoad = Object.prototype.hasOwnProperty.call(speech, "loaded")
    || Object.prototype.hasOwnProperty.call(speech, "loading");
  state.audio.modelLoadSupported = supportsManualLoad;
  state.audio.modelLoaded = supportsManualLoad ? speech.loaded === true : true;
  state.audio.modelLoading = supportsManualLoad ? speech.loading === true : false;
  state.audio.wakePhrase = String(speech.wake_word || state.audio.wakePhrase || "BoxMini").trim() || "BoxMini";
  state.audio.wakeLanguage = String(speech.wake_language || speech.language || "").trim();
  state.audio.wakeAutoSubmit = speech.wake_auto_submit !== false;
  state.audio.wakeAutoStart = speech.wake_auto_start === true;
  state.audio.wakeCommandMaxSeconds = Math.max(2, Number(speech.wake_command_max_seconds || 24));
  state.audio.wakeSilenceMs = Math.max(250, Number(speech.wake_silence_ms || 1200));
  state.audio.wakeInitialSilenceMs = Math.max(1000, Number(speech.wake_initial_silence_ms || 5000));
  state.audio.wakeSupported = Boolean(wakeRecognitionClass());
  if (speech.enabled === false || speech.wake_enabled === false || !state.audio.modelLoaded) {
    stopWakeListening();
  } else if (state.audio.wakeAutoStart && !state.audio.wakeAutoStarted && !state.audio.wakeListening) {
    state.audio.wakeAutoStarted = true;
    window.setTimeout(() => startWakeListening({ automatic: true }), 250);
  }
}

function render() {
  setText("runId", state.status?.run_id || "-");
  setText("runIdAdvanced", state.status?.run_id || "-");
  setText("mcpState", state.status?.mcp?.running ? "running" : "stopped");
  setText("mcpStateAdvanced", state.status?.mcp?.running ? "running" : "stopped");
  setText("aiState", formatAiState(state.status?.ai));
  setText("liveState", state.live?.updated_at || state.status?.live?.updated_at || "-");
  setText("liveStateAdvanced", state.live?.updated_at || state.status?.live?.updated_at || "-");
  setText("now", state.status?.now || "Idle");
  state.runs = state.status?.runs || state.runs;
  const askButton = $("askAgent");
  if (askButton) {
    askButton.disabled = false;
    askButton.textContent = state.agentBusy ? "Steer" : "Send";
  }
  const queueButton = $("queueAgent");
  if (queueButton) {
    const queueLength = Math.max(0, Number(state.status?.agent_queue_length || 0));
    queueButton.disabled = false;
    queueButton.textContent = queueLength ? `Queue ${queueLength}` : "Queue";
    queueButton.title = queueLength
      ? `${queueLength} prompt${queueLength === 1 ? "" : "s"} waiting`
      : "Queue this prompt after the current agent turn";
  }
  const stopButton = $("stopAgent");
  if (stopButton) stopButton.disabled = !state.agentBusy;
  const cancelButton = $("cancelAgent");
  if (cancelButton) cancelButton.disabled = !state.agentBusy;
  applyDashboardLayout({ repaint: false });
  updateAudioUi();
  renderLive();
  renderConversation();
  updateJumpToBottomButton();
  renderRuns();
  compactStatePanel();
  renderTokenAnalytics();
  updateCopyOutputButton();
  updateThinkingOverlay();
  updateRetryStrip();
  renderGoalStrip();
  renderCalibrationOverlay();
  renderBottomTabs();
  renderPresetsPanel();
  renderPlanTimeline();
  renderTimelineOverlayMenu();
  renderTimelineExecutorMenu();
  renderAiProfilePicker();
  renderControlsPopover();

  const list = $("timeline");
  list.innerHTML = "";
  for (const event of [...state.events].slice(-200).reverse()) {
    const li = document.createElement("li");
    if (event.level) li.classList.add(event.level);
    const time = document.createElement("code");
    time.textContent = event.ts || "";
    const type = document.createElement("strong");
    type.textContent = event.type || "event";
    const body = document.createElement("span");
    body.textContent = summarize(event);
    li.append(time, type, body);
    list.appendChild(li);
  }
  followConversationIfNeeded();
}

function toggleControlsPopover() {
  state.controlsOpen = !state.controlsOpen;
  renderControlsPopover();
}

function renderControlsPopover() {
  const button = $("controlsBtn");
  const popover = $("controlsPopover");
  if (!button || !popover) return;
  button.classList.toggle("active", state.controlsOpen);
  button.setAttribute("aria-expanded", String(state.controlsOpen));
  popover.hidden = !state.controlsOpen;
}

function initializeDashboardLayoutControls() {
  for (const button of document.querySelectorAll("[data-collapse-panel]")) {
    button.addEventListener("click", () => toggleDashboardPanel(button.getAttribute("data-collapse-panel")));
  }
  for (const resizer of document.querySelectorAll("[data-resizer]")) {
    resizer.addEventListener("pointerdown", (event) => startDashboardResize(event, resizer));
    resizer.addEventListener("keydown", (event) => nudgeDashboardResizer(event, resizer));
  }
  document.addEventListener("pointermove", updateDashboardResize);
  document.addEventListener("pointerup", endDashboardResize);
  document.addEventListener("pointercancel", endDashboardResize);
  applyDashboardLayout();
}

function toggleDashboardPanel(panel) {
  if (!(panel in state.layout.collapsed)) return;
  state.layout.collapsed[panel] = !state.layout.collapsed[panel];
  saveDashboardLayout();
  applyDashboardLayout();
}

function applyDashboardLayout(options = {}) {
  const main = $("mainLayout");
  if (!main) return;
  clampDashboardLayoutToViewport();
  const collapsed = state.layout.collapsed;
  main.style.setProperty("--chat-width", `${Math.round(state.layout.chatWidth)}px`);
  main.style.setProperty("--bottom-height", `${Math.round(state.layout.bottomHeight)}px`);
  main.style.setProperty("--streamer-width", `${Math.round(state.layout.streamerRatio * 1000) / 10}%`);
  main.classList.toggle("layout-collapse-streamer", collapsed.streamer);
  main.classList.toggle("layout-collapse-matrix", collapsed.matrix);
  main.classList.toggle("layout-collapse-visuals", collapsed.visuals || (collapsed.streamer && collapsed.matrix));
  main.classList.toggle("layout-collapse-bottom", collapsed.bottom);
  main.classList.toggle("layout-collapse-chat", collapsed.chat);
  document.querySelector(".streamer-panel")?.classList.toggle("collapsed", collapsed.streamer);
  document.querySelector(".matrix-panel")?.classList.toggle("collapsed", collapsed.matrix);
  document.querySelector(".conversation-panel")?.classList.toggle("collapsed", collapsed.chat);
  updateDashboardCollapseButtons();
  if (options.repaint !== false) scheduleDashboardLayoutRender();
}

function clampDashboardLayoutToViewport() {
  const main = $("mainLayout");
  const control = document.querySelector(".control-surface");
  const visual = document.querySelector(".visual-grid");
  const mainWidth = main?.getBoundingClientRect().width || window.innerWidth || 1200;
  const controlHeight = control?.getBoundingClientRect().height || Math.max(360, window.innerHeight - 90);
  state.layout.chatWidth = clamp(Number(state.layout.chatWidth) || 380, 260, Math.max(280, mainWidth - 430));
  state.layout.bottomHeight = clamp(Number(state.layout.bottomHeight) || 240, 96, Math.max(118, controlHeight - 150));
  state.layout.streamerRatio = clamp(Number(state.layout.streamerRatio) || 0.5, 0.18, 0.82);
  if (visual && visual.getBoundingClientRect().width < 520) {
    state.layout.streamerRatio = clamp(state.layout.streamerRatio, 0.28, 0.72);
  }
}

function updateDashboardCollapseButtons() {
  const labels = {
    streamer: "streamer",
    matrix: "matrix",
    visuals: "visual panels",
    bottom: "bottom panels",
    chat: "conversation",
  };
  for (const button of document.querySelectorAll("[data-collapse-panel]")) {
    const panel = button.getAttribute("data-collapse-panel");
    if (!(panel in state.layout.collapsed)) continue;
    const expanded = !state.layout.collapsed[panel];
    const label = labels[panel] || panel;
    button.setAttribute("aria-expanded", String(expanded));
    button.title = `${expanded ? "Fold" : "Unfold"} ${label}`;
    button.setAttribute("aria-label", button.title);
  }
}

function startDashboardResize(event, resizer) {
  if (event.button !== 0) return;
  const kind = resizer.getAttribute("data-resizer");
  if (!canResizeDashboardKind(kind)) return;
  event.preventDefault();
  resizer.setPointerCapture?.(event.pointerId);
  resizer.classList.add("active");
  state.layout.resizing = {
    kind,
    resizer,
    pointerId: event.pointerId,
  };
  document.body.classList.add("resizing-layout");
  document.body.dataset.resizingAxis = kind === "bottom" ? "y" : "x";
}

function canResizeDashboardKind(kind) {
  const collapsed = state.layout.collapsed;
  if (kind === "chat") return !collapsed.chat;
  if (kind === "bottom") return !collapsed.bottom && !collapsed.visuals && !(collapsed.streamer && collapsed.matrix);
  if (kind === "visual") return !collapsed.visuals && !collapsed.streamer && !collapsed.matrix;
  return false;
}

function updateDashboardResize(event) {
  const resizing = state.layout.resizing;
  if (!resizing) return;
  if (resizing.kind === "chat") {
    const rect = $("mainLayout")?.getBoundingClientRect();
    if (rect) {
      state.layout.chatWidth = clamp(rect.right - event.clientX, 260, Math.max(280, rect.width - 430));
    }
  } else if (resizing.kind === "bottom") {
    const rect = document.querySelector(".control-surface")?.getBoundingClientRect();
    if (rect) {
      state.layout.bottomHeight = clamp(rect.bottom - event.clientY, 96, Math.max(118, rect.height - 150));
    }
  } else if (resizing.kind === "visual") {
    const rect = document.querySelector(".visual-grid")?.getBoundingClientRect();
    if (rect) {
      state.layout.streamerRatio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0.18, 0.82);
    }
  }
  applyDashboardLayout();
}

function endDashboardResize(event) {
  const resizing = state.layout.resizing;
  if (!resizing) return;
  if (event?.pointerId !== undefined && resizing.pointerId !== undefined && event.pointerId !== resizing.pointerId) return;
  resizing.resizer?.releasePointerCapture?.(resizing.pointerId);
  resizing.resizer?.classList.remove("active");
  state.layout.resizing = null;
  document.body.classList.remove("resizing-layout");
  delete document.body.dataset.resizingAxis;
  saveDashboardLayout();
  scheduleDashboardLayoutRender();
}

function nudgeDashboardResizer(event, resizer) {
  const kind = resizer.getAttribute("data-resizer");
  const horizontal = kind === "chat" || kind === "visual";
  const negativeKey = horizontal ? "ArrowLeft" : "ArrowUp";
  const positiveKey = horizontal ? "ArrowRight" : "ArrowDown";
  if (event.key !== negativeKey && event.key !== positiveKey) return;
  if (!canResizeDashboardKind(kind)) return;
  event.preventDefault();
  const step = event.shiftKey ? 36 : 12;
  const direction = event.key === positiveKey ? 1 : -1;
  if (kind === "chat") state.layout.chatWidth -= direction * step;
  if (kind === "bottom") state.layout.bottomHeight -= direction * step;
  if (kind === "visual") state.layout.streamerRatio += direction * 0.025;
  applyDashboardLayout();
  saveDashboardLayout();
}

function scheduleDashboardLayoutRender() {
  if (state.layout.renderQueued) return;
  state.layout.renderQueued = true;
  requestAnimationFrame(() => {
    state.layout.renderQueued = false;
    renderLiveOnly();
    refreshStreamerViewForLayout();
    renderTemperatureChart();
    renderTokenAnalytics();
    renderPresetsPanel();
  });
}

function setText(id, text) {
  const node = $(id);
  if (node) node.textContent = text;
}

function renderConversation() {
  const list = $("conversation");
  if (!list) return;
  const events = conversationRenderItems();
  const renderKey = [
    state.selectedRunId || state.status?.run_id || "",
    state.events.length,
    events.length,
    eventKey(events[0] || {}),
    eventKey(events[events.length - 1] || {}),
    state.eventWindow.hasMore ? "more" : "start",
    state.eventWindow.loading ? "loading" : "idle",
    JSON.stringify(state.conversationFilters),
    state.typewriterVersion,
  ].join("::");
  if (renderKey === state.lastRenderedConversationKey) return;
  if (!state.forceConversationRender && hasTextSelectionInside(list)) return;
  const shouldFollowLatest = state.conversationAtLatest;
  const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
  state.forceConversationRender = false;
  state.lastRenderedConversationKey = renderKey;
  list.innerHTML = "";
  if (state.eventWindow.hasMore || state.eventWindow.loading) {
    list.appendChild(renderConversationHistoryLoader());
  }
  for (const event of events) {
    const li = document.createElement("li");
    if (event.level) li.classList.add(event.level);
    li.classList.add(...conversationClass(event).split(/\s+/).filter(Boolean));
    if (event._newThinkingSegment) li.classList.add("new-thinking-segment");
    const contextBadge = contextBadgeForEvent(event);
    if (contextBadge) li.appendChild(contextBadge);
    const toolBadge = toolContextBadgeForEvent(event);
    if (toolBadge) {
      li.classList.add("has-tool-context-badge");
      li.appendChild(toolBadge);
    }
    const body = document.createElement("span");
    body.className = "conversation-text";
    const fullDisplay = conversationDisplay(event);
    const display = {
      ...fullDisplay,
      body: typewriterTextForEvent(event, fullDisplay.body),
    };
    if (event.type === "agent_prompt" || event.type === "agent_steer" || event.type === "agent_response" || event.type === "agent_message") {
      appendRichText(body, display.body);
      appendTypewriterCursor(body, event);
      li.append(body, copyButton(body, fullDisplay.body));
    } else if (
      event.type === "agent_started" ||
      event.type === "agent_thinking" ||
      event.type === "context_compacted" ||
      event.type === "context_ai_summary"
    ) {
      appendRichText(body, display.body, { blockStrong: event.type === "agent_thinking" });
      appendTypewriterCursor(body, event);
      const details = document.createElement("details");
      details.className = event.type.startsWith("context_") ? "thinking-fold context-fold" : "thinking-fold";
      details.open = event.type === "agent_thinking" || event.type.startsWith("context_");
      const summary = document.createElement("summary");
      appendThinkingSummary(summary, conversationTitle(event), display.summary);
      details.append(summary, body);
      li.appendChild(details);
    } else {
      appendRichText(body, display.body);
      const type = document.createElement("strong");
      type.textContent = conversationTitle(event);
      li.append(type, body);
    }
    list.appendChild(li);
  }
  if (shouldFollowLatest) {
    scrollConversationToLatest(false);
  } else {
    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight - distanceFromBottom);
  }
  state.conversationAtLatest = isConversationAtLatest();
  updateJumpToBottomButton();
}

function renderConversationHistoryLoader() {
  const item = document.createElement("li");
  item.className = "conversation-load-more";
  const button = document.createElement("button");
  button.type = "button";
  button.disabled = Boolean(state.eventWindow.loading);
  button.textContent = state.eventWindow.loading ? "Loading previous..." : "Load previous";
  const loaded = Number(state.eventWindow.loadedEventCount || state.events.length) || state.events.length;
  const total = Number(state.eventWindow.totalEventCount || 0);
  const meta = document.createElement("code");
  meta.textContent = total > loaded ? `${loaded}/${total} events` : `${loaded} events`;
  button.addEventListener("click", loadOlderConversationEvents);
  item.append(button, meta);
  return item;
}

function conversationEvents() {
  return state.events.filter((item) => isConversationEvent(item) && passesConversationFilters(item));
}

function conversationRenderItems() {
  let toolBoundary = false;
  let lastThinkingRound = null;
  const items = [];
  for (const event of state.events) {
    if (!isConversationEvent(event)) continue;
    if (event.type === "agent_response" && event.hidden) continue;
    const item = { ...event };
    if (item.type === "mcp_tool_call" || item.type === "mcp_tool_result") {
      toolBoundary = true;
      if (passesConversationFilters(item)) items.push(item);
      continue;
    }
    if (item.type === "agent_thinking") {
      item._newThinkingSegment =
        toolBoundary ||
        (lastThinkingRound !== null && item.round !== undefined && item.round !== lastThinkingRound);
      toolBoundary = false;
      lastThinkingRound = item.round;
      if (passesConversationFilters(item)) items.push(item);
      continue;
    }
    if (item.type === "agent_started" || item.type === "agent_response" || item.type === "agent_finished") {
      toolBoundary = false;
      if (item.type !== "agent_finished") lastThinkingRound = null;
    }
    if (passesConversationFilters(item)) items.push(item);
  }
  return items;
}

function isConversationEvent(item) {
  return [
    "agent_prompt",
    "agent_steer",
    "agent_thinking",
    "context_compacted",
    "context_ai_summary",
    "context_checkpoint_saved",
    "context_checkpoint_used",
    "goal_set",
    "goal_updated",
    "goal_paused",
    "goal_resumed",
    "goal_completed",
    "goal_cleared",
    "goal_context_used",
    "dashboard_tool_call",
    "dashboard_tool_result",
    "agent_provider_retry",
    "agent_finished",
    "agent_response",
    "agent_message",
    "mcp_tool_call",
    "mcp_tool_result",
    "mcp_started",
    "mcp_stopped",
    "live_poll_error",
    "ui_error",
  ].includes(item.type);
}

function passesConversationFilters(item) {
  const group = conversationGroup(item);
  return state.conversationFilters[group] !== false;
}

function hasTextSelectionInside(node) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return node.contains(range.commonAncestorContainer);
}

function isConversationAtLatest() {
  const list = $("conversation");
  if (!list) return true;
  return list.scrollHeight - list.scrollTop - list.clientHeight < 64;
}

function followConversationIfNeeded() {
  const list = $("conversation");
  if (!list || !state.conversationAtLatest) return;
  scrollConversationToLatest(false);
}

function jumpConversationToLatest() {
  scrollConversationToLatest(false);
}

function scrollConversationToLatest(smooth = true) {
  const list = $("conversation");
  if (!list) return;
  state.conversationAtLatest = true;
  list.scrollTo({ top: list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  updateJumpToBottomButton();
}

function updateJumpToBottomButton() {
  const button = $("jumpToBottom");
  if (!button) return;
  button.classList.toggle("visible", !state.conversationAtLatest);
}

function copyButton(source, textOverride = null) {
  const button = document.createElement("button");
  button.className = "copy-message";
  button.type = "button";
  button.textContent = "Copy";
  button.onclick = async () => {
    const text = textOverride ?? source.textContent ?? "";
    await copyText(text, button);
  };
  return button;
}

function scheduleTypewriter(event) {
  if (!isTypewriterEvent(event)) return;
  const text = conversationDisplay(event).body;
  if (!String(text || "").trim()) return;
  state.typewriter.set(eventKey(event), {
    count: 0,
    target: text,
  });
  ensureTypewriterTimer();
}

function isTypewriterEvent(event) {
  return (
    event.type === "agent_response" ||
    event.type === "agent_thinking" ||
    event.type === "context_compacted" ||
    event.type === "context_ai_summary"
  );
}

function typewriterTextForEvent(event, fullText) {
  const active = state.typewriter.get(eventKey(event));
  if (!active) return fullText;
  active.target = String(fullText || "");
  return active.target.slice(0, active.count);
}

function appendTypewriterCursor(node, event) {
  if (!state.typewriter.has(eventKey(event))) return;
  const cursor = document.createElement("span");
  cursor.className = "typewriter-cursor";
  cursor.setAttribute("aria-hidden", "true");
  node.appendChild(cursor);
}

function ensureTypewriterTimer() {
  if (state.typewriterTimer !== null) return;
  state.typewriterTimer = window.setInterval(advanceTypewriter, TYPEWRITER_INTERVAL_MS);
}

function advanceTypewriter() {
  if (!state.typewriter.size) {
    stopTypewriterAnimation();
    return;
  }
  let changed = false;
  for (const [key, item] of state.typewriter.entries()) {
    const target = String(item.target || "");
    if (item.count >= target.length) {
      state.typewriter.delete(key);
      changed = true;
      continue;
    }
    item.count = Math.min(target.length, item.count + typewriterStep());
    changed = true;
  }
  if (!changed) return;
  state.typewriterVersion += 1;
  state.lastRenderedConversationKey = "";
  renderConversation();
}

function typewriterStep() {
  return TYPEWRITER_CHARS_PER_TICK;
}

function stopTypewriterAnimation() {
  if (state.typewriterTimer !== null) {
    window.clearInterval(state.typewriterTimer);
    state.typewriterTimer = null;
  }
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const previous = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = previous || "Copy";
      }, 900);
    }
  } catch {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    document.execCommand("copy");
    scratch.remove();
  }
}

function summarize(event) {
  if (event.type === "agent_prompt") return event.prompt || "";
  if (event.type === "agent_steer") return event.prompt || "";
  if (event.type === "agent_response" || event.type === "agent_message") return event.text || event.error || "";
  if (event.type === "agent_started") return event.message || "Thinking";
  if (event.type === "agent_finished") return event.message || "Done";
  if (event.type === "agent_thinking") return event.text || "";
  if (event.type === "context_compacted") return contextCompactionSummary(event);
  if (event.type === "context_ai_summary") return contextAiSummaryTitle(event);
  if (event.type === "context_checkpoint_saved" || event.type === "context_checkpoint_used") return contextCheckpointSummary(event);
  if (event.type?.startsWith("goal_")) return goalEventSummary(event);
  if (event.type === "agent_provider_retry") return providerRetrySummary(event);
  if (event.type === "mcp_tool_call") return `${event.tool} ${JSON.stringify(event.arguments || {})}`;
  if (event.type === "mcp_tool_result") return `${event.tool}: ${event.ok ? "ok" : "error"}`;
  if (event.type === "mcp_started") return event.command || "";
  if (event.message) return event.message;
  const copy = { ...event };
  delete copy.ts;
  delete copy.type;
  return JSON.stringify(copy);
}

function conversationClass(event) {
  if (event.type === "agent_prompt") return "prompt";
  if (event.type === "agent_steer") return "prompt steer";
  if (event.type === "agent_response" || event.type === "agent_message") return "response";
  if (event.type === "agent_started" || event.type === "agent_thinking" || event.type === "agent_finished") return "thinking";
  if (event.type === "context_compacted" || event.type === "context_ai_summary" || event.type.startsWith("context_checkpoint_")) return "context";
  if (event.type?.startsWith("goal_")) return "goal";
  if (event.type === "dashboard_tool_call" || event.type === "dashboard_tool_result") return "tool";
  if (event.type === "mcp_tool_call" || event.type === "mcp_tool_result") return "tool";
  return "system";
}

function conversationTitle(event) {
  if (event.type === "agent_started") return "Thinking";
  if (event.type === "agent_thinking") return "thinking";
  if (event.type === "context_compacted") return "Context";
  if (event.type === "context_ai_summary") return "AI Memory";
  if (event.type === "context_checkpoint_saved") return "Memory Saved";
  if (event.type === "context_checkpoint_used") return "Memory Loaded";
  if (event.type === "goal_set") return "goal set";
  if (event.type === "goal_updated") return "goal updated";
  if (event.type === "goal_paused") return "goal paused";
  if (event.type === "goal_resumed") return "goal resumed";
  if (event.type === "goal_completed") return "goal complete";
  if (event.type === "goal_cleared") return "goal cleared";
  if (event.type === "goal_context_used") return "goal context";
  if (event.type === "agent_provider_retry") return "provider retry";
  if (event.type === "agent_finished") return "agent";
  if (event.type === "agent_message") return "agent";
  if (event.type === "mcp_tool_call") return `tool call: ${event.tool}`;
  if (event.type === "mcp_tool_result") return `tool result: ${event.tool}`;
  if (event.type === "dashboard_tool_call") return `dashboard tool call: ${event.tool}`;
  if (event.type === "dashboard_tool_result") return `dashboard tool result: ${event.tool}`;
  if (event.type === "mcp_started") return "mcp started";
  if (event.type === "mcp_stopped") return "mcp stopped";
  return event.type || "event";
}

function formatAiState(ai) {
  if (!ai?.configured) return "not configured";
  const provider = ai.provider || hostFromUrl(ai.base_url) || "provider";
  const parts = [provider, ai.model].filter(Boolean);
  if (ai.reasoning_effort) parts.push(`reasoning ${ai.reasoning_effort}`);
  return parts.join(" / ");
}

function renderGoalStrip() {
  const strip = $("goalStrip");
  if (!strip) return;
  const goal = state.status?.goal || {};
  const hasGoal = Boolean(goal.objective);
  const paused = goal.status === "paused";
  const active = goal.status === "active";
  const complete = goal.status === "complete";
  strip.classList.toggle("has-goal", hasGoal);
  strip.classList.toggle("paused", paused);
  strip.classList.toggle("active", active);
  strip.classList.toggle("complete", complete);
  setText("goalStatus", hasGoal ? (complete ? "Goal complete" : paused ? "Paused goal" : "Active goal") : "No goal");
  setText("goalText", hasGoal ? goal.objective : "Set a persistent objective for this run");
  const setButton = $("setGoal");
  const toggleButton = $("toggleGoal");
  const clearButton = $("clearGoal");
  if (setButton) setButton.textContent = hasGoal ? "Update" : "Set";
  if (toggleButton) {
    toggleButton.textContent = paused ? "Resume" : "Pause";
    toggleButton.disabled = !hasGoal || complete;
  }
  if (clearButton) clearButton.disabled = !hasGoal;
}

function setGoalFromPrompt() {
  const input = $("agentPrompt");
  const currentGoal = state.status?.goal?.objective || "";
  const trimmed = (input?.value || "").trim() || currentGoal.trim();
  if (!trimmed) {
    appendEvent({
      ts: new Date().toISOString(),
      type: "ui_error",
      level: "warning",
      message: "Write the goal in the main prompt box, then click Set.",
    });
    return;
  }
  const maxChars = Number(state.status?.goal?.max_chars || 4000);
  if (trimmed.length > maxChars) {
    appendEvent({
      ts: new Date().toISOString(),
      type: "ui_error",
      level: "error",
      message: `Goal is too long (${trimmed.length} > ${maxChars} characters).`,
    });
    return;
  }
  send({ type: "goal_set", objective: trimmed, start_agent: true });
  input.value = "";
}

function toggleGoalPaused() {
  const goal = state.status?.goal || {};
  if (!goal.objective) return;
  send({ type: goal.status === "paused" ? "goal_resume" : "goal_pause" });
}

function clearGoal() {
  if (!state.status?.goal?.objective) return;
  send({ type: "goal_clear" });
}

function goalEventSummary(event) {
  if (event.type === "goal_context_used") return "active goal sent to model";
  if (event.type === "goal_cleared") return "goal cleared";
  if (event.type === "goal_completed") return event.summary || "goal complete";
  if (event.type === "goal_paused") return "goal paused";
  if (event.type === "goal_resumed") return "goal resumed";
  if (event.type === "goal_updated") return "goal updated";
  if (event.type === "goal_set") return "goal set";
  return event.message || "goal event";
}

function goalEventText(event) {
  if (event.type === "goal_context_used") {
    return event.message || "Active goal was sent outside the compactable event log.";
  }
  if (event.type === "goal_completed") {
    const parts = [event.summary, event.evidence ? `Evidence: ${event.evidence}` : ""].filter(Boolean);
    return parts.join("\n");
  }
  return event.objective || event.message || goalEventSummary(event);
}

function renderAiProfilePicker() {
  const select = $("aiProfileSelect");
  if (!select) return;
  const ai = state.status?.ai || {};
  const profiles = Array.isArray(ai.profiles) ? ai.profiles : [];
  const active = ai.active_profile || ai.profile?.id || "";
  const key = JSON.stringify(
    profiles.map((profile) => [
      profile.id,
      profile.label,
      profile.model,
      profile.configured,
      profile.reasoning_effort,
    ])
  );
  if (select.dataset.optionsKey !== key) {
    select.textContent = "";
    const visibleProfiles = profiles.length
      ? profiles
      : [
          {
            id: active || "current",
            label: ai.model || "Current model",
            model: ai.model,
            configured: ai.configured,
            reasoning_effort: ai.reasoning_effort,
          },
        ];
    for (const profile of visibleProfiles) {
      const option = document.createElement("option");
      option.value = profile.id || "";
      option.textContent = aiProfileLabel(profile);
      option.disabled = profile.configured === false;
      select.appendChild(option);
    }
    select.dataset.optionsKey = key;
  }
  select.value = active || select.value;
  select.disabled = state.agentBusy || select.options.length <= 1;
  const activeProfile = profiles.find((profile) => profile.id === select.value) || ai.profile || {};
  select.title = aiProfileTitle(activeProfile);
}

function aiProfileLabel(profile) {
  const label = profile.label || profile.model || profile.id || "Model";
  const effort = profile.reasoning_effort ? ` ${profile.reasoning_effort}` : "";
  const missing = profile.configured === false ? " (missing key)" : "";
  return `${label}${effort}${missing}`;
}

function aiProfileTitle(profile) {
  const parts = [profile.provider || hostFromUrl(profile.base_url), profile.model].filter(Boolean);
  if (profile.reasoning_effort) parts.push(`reasoning ${profile.reasoning_effort}`);
  if (profile.configured === false) parts.push("missing API key or model config");
  return parts.join(" / ") || "AI model profile";
}

function setAiProfile(profileId) {
  if (!profileId || state.agentBusy) {
    renderAiProfilePicker();
    return;
  }
  send({ type: "set_ai_profile", profile_id: profileId });
}

function hostFromUrl(value) {
  if (!value) return "";
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function conversationText(event) {
  if (event.type === "agent_prompt") return event.prompt || "";
  if (event.type === "agent_steer") return event.prompt || "";
  if (event.type === "agent_response" || event.type === "agent_message") return cleanAgentResponseText(event.text || event.error || "");
  if (event.type === "agent_started") return event.message || "Thinking";
  if (event.type === "agent_finished") return event.message || "Done";
  if (event.type === "agent_thinking") return event.text || "";
  if (event.type === "context_compacted") return contextCompactionText(event);
  if (event.type === "context_ai_summary") return contextAiSummaryText(event);
  if (event.type === "context_checkpoint_saved" || event.type === "context_checkpoint_used") return contextCheckpointText(event);
  if (event.type?.startsWith("goal_")) return goalEventText(event);
  if (event.type === "agent_provider_retry") return providerRetryText(event);
  if (event.type === "mcp_tool_call") return JSON.stringify(event.arguments || {});
  if (event.type === "mcp_tool_result") return formatToolResultText(event);
  return summarize(event);
}

function formatToolResultText(event) {
  if (event.ok) return "ok";
  if (event.error) return event.error;
  const result = event.result;
  if (result?.content?.length) {
    const text = result.content
      .map((item) => item?.text || "")
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  return result ? JSON.stringify(result) : "error";
}

function cleanAgentResponseText(text) {
  const value = String(text || "").trim();
  if (!looksLikeRawProviderResponse(value)) return value;
  return "Provider returned only tool calls; raw response hidden.";
}

function looksLikeRawProviderResponse(text) {
  if (!text.startsWith("{") || text.length < 1000) return false;
  try {
    const payload = JSON.parse(text);
    return payload?.object === "response" && Array.isArray(payload?.output);
  } catch {
    return false;
  }
}

function conversationDisplay(event) {
  if (event.type === "context_ai_summary") {
    return {
      summary: contextAiSummaryTitle(event),
      body: contextAiSummaryText(event),
    };
  }
  if (event.type === "context_checkpoint_saved" || event.type === "context_checkpoint_used") {
    return {
      summary: contextCheckpointSummary(event),
      body: contextCheckpointText(event),
    };
  }
  if (event.type === "context_compacted") {
    return {
      summary: contextCompactionSummary(event),
      body: contextCompactionText(event),
    };
  }
  if (event.type === "agent_provider_retry") {
    return {
      summary: providerRetrySummary(event),
      body: providerRetryText(event),
    };
  }
  if (event.type?.startsWith("goal_")) {
    return {
      summary: goalEventSummary(event),
      body: goalEventText(event),
    };
  }
  if (event.type !== "agent_thinking") {
    return { summary: "", body: conversationText(event) };
  }
  return splitThinkingText(conversationText(event));
}

function contextBadgeForEvent(event) {
  const metrics = modelMetricsForEvent(event);
  if (!metrics) return null;
  const tokens = contextTokensForMetrics(metrics);
  if (!Number.isFinite(tokens)) return null;
  const badge = document.createElement("span");
  badge.className = "context-badge";
  const estimated = isEstimatedContextMetrics(metrics);
  const imageCount = Number(metrics.input_image_count || 0);
  badge.textContent = `ctx: ${formatTokenCount(tokens)} tk${estimated ? "~" : ""}${imageCount ? ` +${imageCount} img` : ""}`;
  if (metrics.request_chars) {
    badge.title = `${formatCompactNumber(metrics.request_chars)} request payload${estimated ? "; token count estimated from chars" : ""}`;
  }
  return badge;
}

function toolContextBadgeForEvent(event) {
  if (event.type !== "mcp_tool_result") return null;
  const chars = toolOutputCharsForEvent(event);
  if (!Number.isFinite(chars) || chars <= 0) return null;
  const tokens = Math.ceil(chars / 4);
  const attachments = toolAttachmentSummary(event);
  const attachmentText = attachments.images
    ? ` +${formatByteCount(attachments.bytes)} img`
    : "";
  const nextMetrics = nextModelRequestMetricsForToolResult(event);
  const contextTokens = nextMetrics ? contextTokensForMetrics(nextMetrics) : null;
  const estimatedContext = nextMetrics ? isEstimatedContextMetrics(nextMetrics) : true;
  const badge = document.createElement("span");
  badge.className = "tool-context-badge";
  if (Number.isFinite(contextTokens)) {
    badge.classList.add("with-context");
    badge.innerHTML = `<span>ctx: ${formatTokenCount(contextTokens)} tk${estimatedContext ? "~" : ""}</span><span>out: ${formatTokenCount(tokens)} tk~${attachmentText}</span>`;
    badge.title = [
      `${formatCompactNumber(chars)} tool output`,
      attachmentTitle(attachments),
      `Included in following model request payload: ${formatContextMetricsTitle(nextMetrics)}`,
      "The context graph counts that following model request once, not once per tool.",
    ].filter(Boolean).join("\n");
  } else {
    badge.textContent = `out: ${formatTokenCount(tokens)} tk~${attachmentText}`;
    badge.title = [
      `${formatCompactNumber(chars)} tool output`,
      attachmentTitle(attachments),
      "Waiting for the next model request/retry to know the attached ctx size",
    ].filter(Boolean).join("\n");
  }
  return badge;
}

function toolOutputCharsForEvent(event) {
  const reported = Number(event.model_output_chars);
  const visible = estimateToolResultChars(event);
  const attachments = toolAttachmentSummary(event);
  if (
    attachments.images &&
    Number.isFinite(reported) &&
    Number.isFinite(visible) &&
    reported > visible + Math.max(10000, attachments.bytes)
  ) {
    return visible;
  }
  return Number.isFinite(reported) ? reported : visible;
}

function estimateToolResultChars(event) {
  try {
    return JSON.stringify(event.result ?? event.error ?? "").length;
  } catch {
    return String(event.result ?? event.error ?? "").length;
  }
}

function toolAttachmentSummary(event) {
  const detail = Array.isArray(event.model_attachments) ? event.model_attachments : [];
  let images = Number(event.model_image_count || 0);
  let bytes = Number(event.model_attachment_bytes || 0);
  if ((!images || !bytes) && detail.length) {
    images = 0;
    bytes = 0;
    detail.forEach((attachment) => {
      if (attachment?.type !== "input_image") return;
      images += 1;
      bytes += Number(attachment.bytes || attachment.artifact?.bytes || 0) || 0;
    });
  }
  return { images, bytes };
}

function attachmentTitle(summary) {
  if (!summary.images) return "";
  const count = summary.images === 1 ? "1 image attachment" : `${summary.images} image attachments`;
  const bytes = summary.bytes ? ` (${formatByteCount(summary.bytes)})` : "";
  return `${count}${bytes} sent as model image input`;
}

function modelMetricsForEvent(event) {
  if (!["agent_message", "agent_response", "agent_thinking"].includes(event.type)) return null;
  const round = event.round !== undefined ? Number(event.round) : null;
  for (const candidate of [...state.events].reverse()) {
    if (candidate.type !== "agent_model_response") continue;
    if (round !== null && Number(candidate.round) !== round) continue;
    return candidate;
  }
  return null;
}

function nextModelRequestMetricsForToolResult(event) {
  const startIndex = state.events.findIndex((candidate) => candidate === event || eventKey(candidate) === eventKey(event));
  if (startIndex < 0) return null;
  for (let index = startIndex + 1; index < state.events.length; index += 1) {
    const candidate = state.events[index];
    if (candidate.type === "agent_model_response" || candidate.type === "agent_provider_retry") {
      return candidate;
    }
    if (candidate.type === "agent_finished" || candidate.type === "agent_response") {
      return null;
    }
  }
  return null;
}

function contextTokensForMetrics(metrics) {
  const tokens = Number(metrics?.input_tokens ?? metrics?.estimated_context_tokens ?? 0);
  return Number.isFinite(tokens) && tokens > 0 ? tokens : null;
}

function isEstimatedContextMetrics(metrics) {
  if (!metrics) return true;
  return metrics.input_tokens === undefined || metrics.input_tokens === null;
}

function formatContextMetricsTitle(metrics) {
  if (!metrics) return "pending";
  const tokens = contextTokensForMetrics(metrics);
  const parts = [];
  if (tokens) parts.push(`${formatTokenCount(tokens)} input/context tokens${isEstimatedContextMetrics(metrics) ? " estimated" : ""}`);
  if (metrics.request_chars) parts.push(`${formatCompactNumber(metrics.request_chars)} request payload`);
  if (metrics.input_item_count) parts.push(`${metrics.input_item_count} input items`);
  if (metrics.function_call_output_count) parts.push(`${metrics.function_call_output_count} tool outputs`);
  if (metrics.retry_attempts) parts.push(`${metrics.retry_attempts} retries`);
  if (metrics.attempt) parts.push(`retry attempt ${metrics.attempt}`);
  return parts.join("; ") || "model request metrics unavailable";
}

function contextAiSummaryTitle(event) {
  const count = Number.isFinite(event.source_event_count) ? `${event.source_event_count} events` : "run context";
  return `narrative memory: ${count}`;
}

function contextAiSummaryText(event) {
  const lines = [];
  lines.push(event.message || "AI narrative memory generated for model context.");
  if (event.source_event_count !== undefined) lines.push(`source events: ${event.source_event_count}`);
  if (event.deterministic_context_chars !== undefined) {
    lines.push(`deterministic context sent to memory model: ${formatCompactNumber(event.deterministic_context_chars)}`);
  }
  if (event.safety_note) lines.push(`safety: ${event.safety_note}`);
  if (event.text) lines.push(`\n${event.text}`);
  return lines.join("\n");
}

function contextCheckpointSummary(event) {
  const covered = event.covered_event_count !== undefined ? `${event.covered_event_count} covered` : "checkpoint";
  const newer = event.new_event_count !== undefined ? ` + ${event.new_event_count} new` : "";
  return `${covered}${newer}`;
}

function contextCheckpointText(event) {
  const lines = [];
  lines.push(event.message || "Persistent context checkpoint updated.");
  if (event.scope) lines.push(`scope: ${event.scope}`);
  if (event.covered_event_count !== undefined) lines.push(`covered events: ${event.covered_event_count}`);
  if (event.new_event_count !== undefined) lines.push(`new events after checkpoint: ${event.new_event_count}`);
  if (event.covered_until_t !== undefined && event.covered_until_t !== null) lines.push(`covered until: ${event.covered_until_t}`);
  if (event.source_event_count !== undefined) lines.push(`source events summarized: ${event.source_event_count}`);
  if (event.previous_covered_event_count !== undefined) lines.push(`previous checkpoint covered: ${event.previous_covered_event_count}`);
  if (event.new_source_event_count !== undefined) lines.push(`new events merged: ${event.new_source_event_count}`);
  if (event.deterministic_context_chars !== undefined) {
    lines.push(`deterministic context sent to memory model: ${formatCompactNumber(event.deterministic_context_chars)}`);
  }
  if (event.checkpoint_chars !== undefined) lines.push(`checkpoint text: ${formatCompactNumber(event.checkpoint_chars)}`);
  if (event.estimated_chars_after !== undefined) lines.push(`model context estimate: ${formatCompactNumber(event.estimated_chars_after)}`);
  if (event.max_summary_chars !== undefined) lines.push(`summary limit: ${formatCompactNumber(event.max_summary_chars)}`);
  return lines.join("\n");
}

function contextCompactionSummary(event) {
  const scopeNames = {
    tool_output: event.tool || "tool output",
    run_context: "run context",
    provider_retry_payload: "provider retry payload",
  };
  const scope = scopeNames[event.scope] || event.scope || "run context";
  const before = formatCompactNumber(event.estimated_chars_before);
  const after = formatCompactNumber(event.estimated_chars_after);
  const retry = event.retry_attempt ? `retry ${event.retry_attempt}: ` : "";
  if (before && after) return `${retry}${scope}: ${before} -> ${after}`;
  return scope;
}

function contextCompactionText(event) {
  const lines = [];
  lines.push(event.message || "Model context compacted; full events.jsonl is unchanged.");
  if (event.scope) lines.push(`scope: ${event.scope}`);
  if (event.retry_attempt) lines.push(`retry attempt: ${event.retry_attempt}`);
  if (event.retry_compaction_level) lines.push(`retry compaction level: ${event.retry_compaction_level}`);
  if (event.tool) lines.push(`tool: ${event.tool}`);
  if (event.original_event_count !== undefined) lines.push(`events: ${event.original_event_count} total -> ${event.model_event_count} sent`);
  if (event.omitted_event_count) lines.push(`older events summarized: ${event.omitted_event_count}`);
  if (event.large_event_count) lines.push(`large events summarized: ${event.large_event_count}`);
  if (event.stale_state_event_count) lines.push(`stale state snapshots pruned: ${event.stale_state_event_count}`);
  if (event.compacted_user_context_sections) lines.push(`context sections compacted: ${event.compacted_user_context_sections}`);
  if (event.compacted_image_messages) lines.push(`image attachments compacted: ${event.compacted_image_messages}`);
  if (event.compacted_tool_outputs) lines.push(`tool outputs compacted: ${event.compacted_tool_outputs}`);
  if (event.protected_latest_tool_output) lines.push("latest tool output: protected");
  if (event.latest_tool_output_compacted_for_model) lines.push("latest tool output: compacted for model");
  if (event.artifact_count) lines.push(`artifact refs: ${event.artifact_count}`);
  if (event.estimated_chars_before !== undefined && event.estimated_chars_after !== undefined) {
    lines.push(`estimated context: ${formatCompactNumber(event.estimated_chars_before)} -> ${formatCompactNumber(event.estimated_chars_after)}`);
  }
  if (event.target_context_chars !== undefined) lines.push(`target: ${formatCompactNumber(event.target_context_chars)}`);
  if (event.max_context_chars !== undefined) lines.push(`limit: ${formatCompactNumber(event.max_context_chars)}`);
  return lines.join("\n");
}

function providerRetrySummary(event) {
  const parts = [`attempt ${event.attempt || "?"}`];
  if (event.status_code) parts.push(`HTTP ${event.status_code}`);
  if (event.error_type) parts.push(event.error_type);
  const delay = Number(event.delay_seconds || 0);
  parts.push(delay > 0 ? `after ${delay}s` : "now");
  return parts.join(" / ");
}

function providerRetryText(event) {
  const lines = [];
  lines.push(`Provider retry ${event.attempt || "?"}`);
  if (event.status_code) lines.push(`status: HTTP ${event.status_code} - ${explainErrorCode(event.status_code)}`);
  if (event.error_type) lines.push(`error type: ${event.error_type}`);
  if (event.error) lines.push(`error: ${event.error}`);
  const response = cleanProviderResponsePreview(event.response || event.body_preview || "", event.status_code);
  if (response) lines.push(`response: ${response}`);
  if (event.body_chars) lines.push(`response size: ${formatCompactNumber(event.body_chars)}`);
  const delay = Number(event.delay_seconds || 0);
  lines.push(delay > 0 ? `retry delay before this attempt: ${delay}s` : "retry delay before this attempt: immediate");
  return lines.join("\n");
}

function latestProviderRetry() {
  for (const event of [...state.events].reverse()) {
    if (event.type === "agent_provider_retry") return event;
    if (event.type === "agent_model_response" || event.type === "agent_response" || event.type === "agent_message" || event.type === "agent_finished") return null;
  }
  return null;
}

function updateRetryStrip() {
  const node = $("retryStrip");
  if (!node) return;
  const retry = state.agentBusy ? latestProviderRetry() : null;
  node.classList.toggle("visible", Boolean(retry));
  if (!retry) {
    node.textContent = "";
    return;
  }
  const status = retry.status_code
    ? `HTTP ${retry.status_code}: ${explainErrorCode(retry.status_code)}`
    : `${retry.error_type || "request error"}: ${explainErrorCode(retry.error_type)}`;
  const response = cleanProviderResponsePreview(retry.response || retry.body_preview || retry.error || "", retry.status_code);
  node.textContent = `Retry ${retry.attempt || "?"} - ${status}${response ? ` - ${shortText(response, 180)}` : ""}`;
}

function cleanProviderResponsePreview(value, statusCode = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (!looksLikeHtml(text)) return shortText(text, 260);
  const title = extractTagText(text, "title");
  const heading = extractTagText(text, "h1");
  const code = String(statusCode || title.match(/\b(4\d\d|5\d\d)\b/)?.[1] || "").trim();
  const parts = [title, heading, code ? `HTTP ${code}` : ""].filter(Boolean);
  const deduped = [...new Set(parts)];
  return deduped.length
    ? `HTML gateway error page: ${deduped.join(" / ")}`
    : "HTML gateway error page returned by provider.";
}

function looksLikeHtml(text) {
  const head = text.slice(0, 500).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html") || head.includes("<body");
}

function extractTagText(text, tag) {
  const match = text.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "i"));
  if (!match) return "";
  return match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function explainErrorCode(code) {
  const value = String(code || "").toLowerCase();
  const explanations = {
    "400": "bad request; the provider rejected the payload",
    "401": "authentication failed",
    "403": "request forbidden by the provider",
    "408": "request timed out before the provider answered",
    "429": "rate limited; too many requests or overloaded quota",
    "500": "provider server error",
    "502": "bad gateway; upstream provider failed",
    "503": "provider temporarily unavailable",
    "504": "gateway timeout; RK API did not finish the model request in time",
    "1001": "websocket closed normally or the page/backend connection was interrupted",
    "connectionclosedok": "websocket closed normally or the page/backend connection was interrupted",
  };
  return explanations[value] || "transient provider/network error";
}

function shortText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function formatCompactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (Math.abs(number) >= 1000000) return `${(number / 1000000).toFixed(2)}M chars`;
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(1)}k chars`;
  return `${number} chars`;
}

function formatByteCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0 B";
  if (number >= 1024 * 1024) return `${(number / (1024 * 1024)).toFixed(2)} MB`;
  if (number >= 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${Math.round(number)} B`;
}

function formatTokenCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (Math.abs(number) >= 1000000) return `${(number / 1000000).toFixed(2)}M`;
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(1)}k`;
  return String(Math.round(number));
}

function renderTokenAnalytics() {
  const samples = tokenSamples();
  const totalInput = samples.reduce((sum, sample) => sum + sample.inputTokens, 0);
  const totalOutput = samples.reduce((sum, sample) => sum + sample.outputTokens, 0);
  const totalImages = samples.reduce((sum, sample) => sum + sample.images, 0);
  const meanInput = samples.length ? totalInput / samples.length : 0;
  const last = samples[samples.length - 1];
  setText("tokenSummary", samples.length ? `${samples.length} model calls` : "waiting");
  setText("tokensTotal", samples.length ? `${formatTokenCount(totalInput)} tk` : "-");
  setText("tokensMean", samples.length ? `${formatTokenCount(meanInput)} tk` : "-");
  setText("tokensLast", last ? `${formatTokenCount(last.inputTokens)} tk` : "-");
  setText("tokensImages", samples.length ? String(totalImages) : "-");
  renderTokenContextChart(samples, totalOutput);
  renderContextHistogram(last);
  renderContextEventList();
}

function tokenSamples() {
  return state.events
    .filter((event) => event.type === "agent_model_response")
    .map((event, index) => {
      const inputTokens = Number(event.input_tokens ?? event.estimated_context_tokens ?? 0);
      const outputTokens = Number(event.output_tokens ?? 0);
      const reasoningTokens = Number(event.reasoning_tokens ?? 0);
      return {
        index,
        round: event.round,
        inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
        outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
        reasoningTokens: Number.isFinite(reasoningTokens) ? reasoningTokens : 0,
        totalTokens: Number(event.total_tokens ?? inputTokens + outputTokens) || inputTokens + outputTokens,
        requestChars: Number(event.request_chars || 0),
        images: Number(event.input_image_count || 0),
        inputItems: Number(event.input_item_count || 0),
        toolCalls: Number(event.tool_call_count || 0),
        retryAttempts: Number(event.retry_attempts || 0),
        contextBreakdown: Array.isArray(event.context_breakdown) ? event.context_breakdown : null,
        estimated: event.input_tokens === undefined || event.input_tokens === null,
        ts: event.ts || "",
      };
    })
    .filter((sample) => sample.inputTokens > 0 || sample.outputTokens > 0 || sample.requestChars > 0);
}

function renderTokenContextChart(samples, totalOutput) {
  const canvas = $("tokenCumulativeChart");
  if (!canvas) return;
  const { ctx, width, height } = prepareCanvas(canvas);
  clearChart(ctx, width, height);
  drawGrid(ctx, width, height);
  if (!samples.length) {
    drawEmptyChartText(ctx, "waiting for AI model calls", width, height);
    return;
  }

  const points = [];
  let running = 0;
  for (const [index, sample] of samples.entries()) {
    running += sample.inputTokens;
    const windowStart = Math.max(0, index - 4);
    const windowSamples = samples.slice(windowStart, index + 1);
    const mean5 = windowSamples.reduce((sum, item) => sum + item.inputTokens, 0) / windowSamples.length;
    points.push({ ...sample, cumulative: running, mean5 });
  }
  const series = tokenChartSeries(points);
  const visibleSeries = series.filter((item) => state.tokenChartLines[item.id] !== false);
  const max = Math.max(...visibleSeries.flatMap((item) => item.points.map((point) => point.value)), 1);
  const plot = chartPlotArea(width, height);
  const drawnByIndex = new Map();
  for (const serie of visibleSeries) {
    ctx.strokeStyle = serie.color;
    ctx.lineWidth = serie.id === "request" ? 2.2 : 1.7;
    ctx.setLineDash(serie.dash || []);
    ctx.beginPath();
    serie.points.forEach((point, index) => {
      const x = plot.x + (serie.points.length === 1 ? plot.w / 2 : (index / (serie.points.length - 1)) * plot.w);
      const y = plot.y + plot.h - (point.value / max) * plot.h;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      if (!drawnByIndex.has(index)) drawnByIndex.set(index, { x, sample: point.sample, values: [] });
      drawnByIndex.get(index).values.push({ ...serie, value: point.value, y });
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const point of drawnByIndex.values()) {
    const requestValue = point.values.find((item) => item.id === "request");
    const y = requestValue?.y ?? point.values[0]?.y;
    if (!Number.isFinite(y)) continue;
    ctx.fillStyle = point.sample.images > 0 ? "#ff9f0a" : "#64d2ff";
    ctx.beginPath();
    ctx.arc(point.x, y, point.sample.images > 0 ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const hover = nearestTokenPoint(canvas, [...drawnByIndex.values()]);
  if (hover) drawTokenTooltip(ctx, canvas, hover, width, height);
  ctx.fillStyle = "#a1a1a6";
  ctx.font = "11px -apple-system, BlinkMacSystemFont, Segoe UI";
  ctx.fillText(`${formatTokenCount(max)} input tk/request`, 10, 15);
  ctx.fillText(`${formatTokenCount(totalOutput)} output tk total`, 10, height - 8);
}

function tokenChartSeries(points) {
  return [
    {
      id: "request",
      label: "context/request",
      color: "#64d2ff",
      points: points.map((sample) => ({ sample, value: sample.inputTokens })),
    },
    {
      id: "cumulative",
      label: "total sent",
      color: "#bf5af2",
      dash: [5, 4],
      points: points.map((sample) => ({ sample, value: sample.cumulative })),
    },
    {
      id: "mean5",
      label: "last 5 mean",
      color: "#30d158",
      dash: [2, 4],
      points: points.map((sample) => ({ sample, value: sample.mean5 })),
    },
  ];
}

function renderContextHistogram(sample) {
  const canvas = $("contextHistogram");
  if (!canvas) return;
  const { ctx, width, height } = prepareCanvas(canvas);
  clearChart(ctx, width, height);
  if (!sample) {
    setText("contextBreakdownMeta", "-");
    updateContextBreakdownSummary(null, []);
    drawEmptyChartText(ctx, "no model context yet", width, height);
    return;
  }
  const breakdown = contextBreakdown(sample);
  const total = breakdown.reduce((sum, item) => sum + item.value, 0);
  setText("contextBreakdownMeta", `${formatTokenCount(sample.inputTokens)} tk${sample.estimated ? "~" : ""}`);
  updateContextBreakdownSummary(sample, breakdown);
  const max = Math.max(...breakdown.map((item) => item.value), 1);
  const labelW = Math.min(130, Math.max(92, width * 0.24));
  const valueW = Math.min(118, Math.max(82, width * 0.2));
  const left = labelW;
  const rightPad = 12;
  const top = 16;
  const rowH = Math.max(22, Math.floor((height - 28) / breakdown.length));
  const barH = Math.min(15, Math.max(10, rowH - 8));
  const barW = Math.max(20, width - left - valueW - rightPad);
  const bars = [];
  breakdown.forEach((item, index) => {
    const y = top + index * rowH;
    const w = Math.max(2, (item.value / max) * barW);
    bars.push({ item, x: left, y, w, h: barH });
    ctx.fillStyle = "#a1a1a6";
    ctx.font = "10px -apple-system, BlinkMacSystemFont, Segoe UI";
    ctx.textAlign = "right";
    ctx.fillText(item.label, left - 9, y + barH);
    ctx.textAlign = "left";
    ctx.fillStyle = item.color;
    roundedRect(ctx, left, y, w, barH, 4);
    ctx.fill();
    ctx.fillStyle = "#f5f5f7";
    ctx.font = "9px -apple-system, BlinkMacSystemFont, Segoe UI";
    const percent = total > 0 ? ` ${Math.round((item.value / total) * 100)}%` : "";
    const valueText = `${formatTokenCount(item.value)}${percent}`;
    ctx.fillText(valueText, left + barW + 8, y + barH - 1);
  });
  const hover = nearestHistogramBar(canvas, bars);
  if (hover) drawHistogramTooltip(ctx, canvas, hover, width, height, total);
}

function updateContextBreakdownSummary(sample, breakdown) {
  if (!sample) {
    setText("contextRequestChars", "-");
    setText("contextInputItems", "-");
    setText("contextToolOutputTokens", "-");
    setText("contextOverheadTokens", "-");
    setText("contextLargestBucket", "-");
    setText("contextRetryCount", "-");
    return;
  }
  const bucket = Array.isArray(breakdown) && breakdown.length
    ? breakdown.reduce((best, item) => (item.value > best.value ? item : best), breakdown[0])
    : null;
  const toolOutputs = breakdownValue(breakdown, "Tool Outputs");
  const overhead = breakdownValue(breakdown, "Overhead");
  setText("contextRequestChars", sample.requestChars ? formatCompactNumber(sample.requestChars) : "-");
  setText("contextInputItems", Number.isFinite(sample.inputItems) ? String(sample.inputItems) : "-");
  setText("contextToolOutputTokens", toolOutputs > 0 ? `${formatTokenCount(toolOutputs)} tk` : "-");
  setText("contextOverheadTokens", overhead > 0 ? `${formatTokenCount(overhead)} tk` : "-");
  setText("contextLargestBucket", bucket ? `${bucket.label} ${formatTokenCount(bucket.value)} tk` : "-");
  setText("contextRetryCount", Number.isFinite(sample.retryAttempts) ? String(sample.retryAttempts) : "-");
}

function breakdownValue(breakdown, label) {
  if (!Array.isArray(breakdown)) return 0;
  const item = breakdown.find((entry) => String(entry.label || "").toLowerCase() === label.toLowerCase());
  return Number(item?.value || 0);
}

function renderContextEventList() {
  const list = $("contextEventList");
  if (!list) return;
  const events = state.events
    .filter((event) =>
      [
        "agent_model_response",
        "agent_provider_retry",
        "context_compacted",
        "context_checkpoint_saved",
        "context_checkpoint_used",
        "context_ai_summary",
      ].includes(event.type)
    )
    .slice(-9)
    .reverse();
  list.textContent = "";
  if (!events.length) {
    const li = document.createElement("li");
    li.className = "context-event-empty";
    li.textContent = "No context events yet";
    list.appendChild(li);
    return;
  }
  for (const event of events) {
    const item = contextEventSummary(event);
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "context-event-dot";
    dot.style.background = item.color;
    const main = document.createElement("span");
    main.className = "context-event-main";
    const title = document.createElement("span");
    title.className = "context-event-title";
    title.textContent = item.title;
    const sub = document.createElement("span");
    sub.className = "context-event-sub";
    sub.textContent = item.sub;
    main.append(title, sub);
    const value = document.createElement("span");
    value.className = "context-event-value";
    value.textContent = item.value;
    li.append(dot, main, value);
    list.appendChild(li);
  }
}

function contextEventSummary(event) {
  if (event.type === "agent_model_response") {
    const tk = Number(event.input_tokens ?? event.estimated_context_tokens ?? 0);
    const round = Number.isFinite(Number(event.round)) ? `round ${event.round}` : "model response";
    const calls = Array.isArray(event.tool_calls) && event.tool_calls.length ? `tools: ${event.tool_calls.join(", ")}` : "no tool call";
    return {
      title: `Model ${round}`,
      sub: calls,
      value: tk ? `${formatTokenCount(tk)} tk` : "",
      color: "#64d2ff",
    };
  }
  if (event.type === "agent_provider_retry") {
    const code = event.status_code || event.error_type || "retry";
    return {
      title: `Provider retry ${event.attempt || ""}`.trim(),
      sub: explainErrorCode(code),
      value: event.request_chars ? formatCompactNumber(event.request_chars) : String(code),
      color: "#ff9f0a",
    };
  }
  if (event.type === "context_compacted") {
    const before = event.estimated_chars_before ? formatCompactNumber(event.estimated_chars_before) : "";
    const after = event.estimated_chars_after ? formatCompactNumber(event.estimated_chars_after) : "";
    return {
      title: contextCompactionSummary(event),
      sub: [before, after].filter(Boolean).join(" -> ") || event.scope || "context",
      value: event.estimated_chars_after ? `${formatTokenCount(Number(event.estimated_chars_after) / 4)} tk~` : "",
      color: "#30d158",
    };
  }
  if (event.type === "context_checkpoint_saved" || event.type === "context_checkpoint_used") {
    return {
      title: contextCheckpointSummary(event),
      sub: `${event.covered_event_count || 0} covered events`,
      value: event.checkpoint_chars ? formatCompactNumber(event.checkpoint_chars) : "",
      color: "#bf5af2",
    };
  }
  return {
    title: contextAiSummaryTitle(event),
    sub: event.message || "AI memory event",
    value: event.source_event_count ? `${event.source_event_count} ev` : "",
    color: "#bf5af2",
  };
}

function contextBreakdown(sample) {
  if (Array.isArray(sample.contextBreakdown) && sample.contextBreakdown.length) {
    return sample.contextBreakdown.map((item) => ({
      label: item.label || "Other",
      value: Number(item.tokens ?? (Number(item.chars || 0) / 4)) || 0,
      color: contextBreakdownColor(item.label),
    }));
  }
  const input = Math.max(0, sample.inputTokens || 0);
  const output = Math.max(0, sample.outputTokens || 0);
  const reasoning = Math.max(0, sample.reasoningTokens || 0);
  const imageTokens = Math.min(input, Math.max(0, sample.images || 0) * 1200);
  const toolTokens = Math.min(input - imageTokens, Math.max(0, sample.inputItems - 1) * 180 + sample.toolCalls * 280);
  const systemTokens = Math.min(input - imageTokens - toolTokens, 5500);
  const eventTokens = Math.max(0, input - imageTokens - toolTokens - systemTokens);
  return [
    { label: "Guide/system", value: systemTokens, color: "#bf5af2" },
    { label: "Event log", value: eventTokens, color: "#64d2ff" },
    { label: "Tools", value: toolTokens, color: "#30d158" },
    { label: "Images", value: imageTokens, color: "#ff9f0a" },
    { label: "Output", value: output, color: "#ff375f" },
    { label: "Reasoning", value: reasoning, color: "#ffd60a" },
  ];
}

function contextBreakdownColor(label) {
  const value = String(label || "").toLowerCase();
  if (value.includes("instruction")) return "#bf5af2";
  if (value.includes("tool schema")) return "#0a84ff";
  if (value.includes("guide") || value.includes("event")) return "#64d2ff";
  if (value.includes("history")) return "#8e8e93";
  if (value.includes("tool output")) return "#30d158";
  if (value.includes("image")) return "#ff9f0a";
  if (value.includes("overhead")) return "#636366";
  return "#ff375f";
}

function nearestTokenPoint(canvas, points) {
  if (!state.tokenChartHover || !points.length) return null;
  const x = state.tokenChartHover.x;
  const y = state.tokenChartHover.y;
  let best = null;
  let bestDistance = Infinity;
  for (const point of points) {
    const nearestY = point.values.reduce((current, item) => {
      if (current === null) return item.y;
      return Math.abs(item.y - y) < Math.abs(current - y) ? item.y : current;
    }, null);
    const distance = Math.hypot(point.x - x, (nearestY ?? y) - y);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return bestDistance <= 38 ? best : null;
}

function drawTokenTooltip(ctx, canvas, point, width, height) {
  const sample = point.sample;
  ctx.strokeStyle = "rgba(100, 210, 255, 0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(point.x, 14);
  ctx.lineTo(point.x, height - 16);
  ctx.stroke();
  const lines = [
    `call ${sample.index + 1}${sample.round !== undefined ? ` / round ${sample.round}` : ""}`,
    ...point.values.map((item) => `${item.label}: ${formatTokenCount(item.value)} tk${sample.estimated && item.id === "request" ? "~" : ""}`),
    `output: ${formatTokenCount(sample.outputTokens)} tk${sample.images ? ` / ${sample.images} img` : ""}`,
  ];
  const anchorY = point.values.find((item) => item.id === "request")?.y ?? point.values[0]?.y ?? height / 2;
  for (const item of point.values) {
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(point.x, item.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  drawCanvasTooltip(ctx, lines, point.x + 10, anchorY - 50, width, height);
}

function nearestHistogramBar(canvas, bars) {
  if (!state.contextHistogramHover || !bars.length) return null;
  const x = state.contextHistogramHover.x;
  const y = state.contextHistogramHover.y;
  return bars.find((bar) => y >= bar.y - 4 && y <= bar.y + bar.h + 8 && x >= bar.x - 12 && x <= bar.x + Math.max(bar.w, 18) + 90) || null;
}

function drawHistogramTooltip(ctx, canvas, bar, width, height, total) {
  const percent = total > 0 ? Math.round((bar.item.value / total) * 100) : 0;
  drawCanvasTooltip(
    ctx,
    [bar.item.label, `${formatTokenCount(bar.item.value)} tk`, `${percent}% of shown payload`],
    bar.x + Math.max(bar.w, 12) + 12,
    bar.y - 16,
    width,
    height,
  );
}

function drawCanvasTooltip(ctx, lines, x, y, width, height) {
  ctx.font = "11px -apple-system, BlinkMacSystemFont, Segoe UI";
  const boxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 18;
  const boxHeight = lines.length * 14 + 10;
  const boxX = Math.min(Math.max(8, x), width - boxWidth - 8);
  const boxY = Math.min(Math.max(8, y), height - boxHeight - 8);
  ctx.fillStyle = "rgba(28, 28, 32, 0.96)";
  ctx.strokeStyle = "rgba(100, 210, 255, 0.38)";
  ctx.lineWidth = 1;
  roundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 6);
  ctx.fill();
  ctx.stroke();
  lines.forEach((line, index) => {
    ctx.fillStyle = index === 0 ? "#f5f5f7" : "#a1a1a6";
    ctx.fillText(line, boxX + 9, boxY + 16 + index * 14);
  });
}

function clearChart(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#151519";
  ctx.fillRect(0, 0, width, height);
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || canvas.width));
  const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || canvas.height));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.id === "planTimeline"
    ? canvas.getContext("2d", { willReadFrequently: true })
    : canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function syncMatrixViewerSize() {
  const canvas = $("matrixScene");
  const viewer = canvas?.closest(".viewer.matrix");
  const panel = viewer?.closest(".visual-panel");
  if (!viewer || !panel || panel.classList.contains("collapsed")) return;

  viewer.style.removeProperty("width");
  viewer.style.removeProperty("height");
}

function drawGrid(ctx, width, height) {
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawEmptyChartText(ctx, text, width, height) {
  ctx.fillStyle = "#a1a1a6";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI";
  ctx.fillText(text, 14, height / 2 + 4);
}

function chartPlotArea(width, height) {
  return { x: 12, y: 18, w: width - 26, h: height - 34 };
}

function splitThinkingText(text) {
  const value = String(text || "").trim();
  const matches = [...value.matchAll(/\*\*([^*]+)\*\*/g)];
  if (!matches.length) return { summary: "", body: value };
  const lastMatch = matches[matches.length - 1];
  const before = value.slice(0, lastMatch.index).replace(/[ \t]*$/, "");
  const after = value.slice(lastMatch.index + lastMatch[0].length).replace(/^\s*/, "");
  return {
    summary: lastMatch[1].trim(),
    body: `${before}${after}`.trim(),
  };
}

function appendRichText(node, text, options = {}) {
  const value = String(text || "");
  const pattern = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index > cursor) {
      node.appendChild(document.createTextNode(value.slice(cursor, match.index)));
    }
    const strong = document.createElement("strong");
    strong.textContent = match[1];
    if (options.blockStrong) strong.className = "inline-heading";
    node.appendChild(strong);
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) {
    node.appendChild(document.createTextNode(value.slice(cursor)));
  }
}

function appendThinkingSummary(summaryNode, title, summaryText) {
  const titleNode = document.createElement("span");
  titleNode.textContent = title;
  summaryNode.appendChild(titleNode);
  if (!summaryText) return;
  const strong = document.createElement("strong");
  strong.textContent = summaryText;
  summaryNode.append(" ");
  summaryNode.appendChild(strong);
}

function conversationGroup(event) {
  if (event.type === "agent_prompt" || event.type === "agent_steer" || event.type === "agent_response" || event.type === "agent_message") return "text";
  if (event.type === "agent_started" || event.type === "agent_thinking" || event.type === "agent_finished") return "thinking";
  if (event.type === "mcp_tool_call" || event.type === "mcp_tool_result") return "tools";
  if (event.type === "context_compacted" || event.type === "context_ai_summary") return "context";
  return "system";
}

function send(message) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket is not connected");
  }
  state.ws.send(JSON.stringify(message));
}

function handleRealtimeMessage(data) {
  if (data.type === "live") {
    state.live = mergeLiveWithMatrixCache(data.live);
    bootstrapTimelineLiveFromScene(state.live?.scene?.result || state.live?.scene);
    syncStageMotionWithLive();
    scheduleLiveOnlyRender();
    return true;
  }
  if (data.type === "live_scene") {
    applyLiveScene(data);
    return true;
  }
  if (data.type === "live_frame") {
    applyLiveFrame(data);
    return true;
  }
  if (data.type === "stage_motion") {
    handleStageMotionMessage(data);
    return true;
  }
  return false;
}

function connectLive() {
  if (state.liveWs && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.liveWs.readyState)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const basePort = Number(location.port || (location.protocol === "https:" ? 443 : 80));
  const liveWsPort = basePort + 2;
  const ws = new WebSocket(`${proto}://${location.hostname}:${liveWsPort}/live`);
  state.liveWs = ws;
  ws.onopen = () => {
    if (state.liveWsReconnectTimer) {
      window.clearTimeout(state.liveWsReconnectTimer);
      state.liveWsReconnectTimer = null;
    }
    state.liveWsConnected = true;
    ws.send(JSON.stringify({ type: "get_live" }));
  };
  ws.onclose = () => {
    if (state.liveWs === ws) {
      state.liveWsConnected = false;
      state.liveWs = null;
    }
    if (state.liveWsReconnectTimer) window.clearTimeout(state.liveWsReconnectTimer);
    state.liveWsReconnectTimer = window.setTimeout(connectLive, 1000);
  };
  ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    handleRealtimeMessage(data);
  };
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wsPort = Number(location.port || (location.protocol === "https:" ? 443 : 80)) + 1;
  state.ws = new WebSocket(`${proto}://${location.hostname}:${wsPort}/ws`);
  state.ws.onopen = () => {
    appendEvent({ ts: new Date().toISOString(), type: "ui_connected" });
    send({ type: "get_status" });
    state.streamerView.lastRequestKey = "";
    requestStreamerResolutionUpdate();
    connectLive();
  };
  state.ws.onclose = () => {
    state.audio.transcribing = false;
    updateAudioUi();
    appendEvent({ ts: new Date().toISOString(), type: "ui_disconnected", level: "warning" });
    setTimeout(connect, 1000);
  };
  state.ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.type === "status") {
      state.status = data.status;
      syncSpeechConfig(data.status?.speech);
      if (data.status?.run_id) state.selectedRunId = data.status.run_id;
      state.agentBusy = Boolean(data.status?.agent_busy);
      if (data.status?.calibration?.active) {
        state.calibration.data = data.status.calibration;
        state.calibration.active = true;
        if (data.status.calibration.position) state.calibration.localPosition = data.status.calibration.position;
      } else if (!state.calibration.active && data.status?.calibration) {
        state.calibration.data = null;
      }
      render();
    } else if (data.type === "event") {
      if (data.event?.type === "agent_started") state.agentBusy = true;
      if (data.event?.type === "agent_finished") state.agentBusy = false;
      appendEvent(data.event, {
        replay: Boolean(data.replay),
        liveAgent: !data.replay && isTypewriterEvent(data.event),
      });
    } else if (handleRealtimeMessage(data)) {
      return;
    } else if (data.type === "matrix_paint_result") {
      const result = data.result?.result || data.result;
      if (result?.ok === false || result?.error) {
        state.matrixPaint.overlays = [];
        appendEvent({
          ts: new Date().toISOString(),
          type: "ui_error",
          level: "warning",
          message: result.error || "Matrix paint failed",
        });
      } else if (Array.isArray(result?.droplet_updates)) {
        const failed = result.droplet_updates.filter((item) => item?.ok === false);
        if (failed.length) {
          appendEvent({
            ts: new Date().toISOString(),
            type: "ui_error",
            level: "warning",
            message: `${failed.length} droplet erase update${failed.length === 1 ? "" : "s"} failed`,
          });
        }
      }
    } else if (data.type === "matrix_droplet_update_result") {
      const result = data.result?.result || data.result;
      const dropletId = Number(data.droplet_id);
      if (result?.ok === false || result?.error || result?.updated === false) {
        if (Number.isFinite(dropletId)) state.matrixDropletOverrides.delete(dropletId);
        appendEvent({
          ts: new Date().toISOString(),
          type: "ui_error",
          level: "warning",
          message: result?.error || `Droplet ${dropletId} position update failed`,
        });
        renderMatrixPanel(state.live || {});
      }
    } else if (data.type === "matrix_waypoint_plan_result") {
      state.matrixCommands.planning = false;
      const result = data.result || {};
      if (result.ok === false || result.error) {
        state.matrixCommands.lastError = result.error || result.reason || "Waypoint planning failed";
        appendEvent({
          ts: new Date().toISOString(),
          type: "ui_error",
          level: "warning",
          message: state.matrixCommands.lastError,
        });
      } else {
        state.matrixCommands.lastError = "";
        const dropletId = Number(data.droplet_id ?? result.droplet_id);
        if (Number.isFinite(dropletId)) state.matrixCommands.queues.delete(dropletId);
      }
      renderMatrixPanel(state.live || {});
      renderMatrixCommandPanel();
      schedulePlanTimelineRender();
    } else if (data.type === "matrix_selection_plan_result") {
      state.matrixCommands.planning = false;
      const result = data.result || {};
      if (result.ok === false || result.error) {
        state.matrixCommands.lastError = result.error || result.reason || "Selection planning failed";
        appendEvent({
          ts: new Date().toISOString(),
          type: "ui_error",
          level: "warning",
          message: state.matrixCommands.lastError,
        });
      } else {
        state.matrixCommands.lastError = "";
        state.matrixCommands.queues.clear();
        state.matrixMovePreview.rotation = 0;
      }
      renderMatrixPanel(state.live || {});
      renderMatrixCommandPanel();
      schedulePlanTimelineRender();
    } else if (data.type === "matrix_plan_trim_result") {
      const result = data.result || {};
      if (result.ok === false || result.error) {
        appendEvent({
          ts: new Date().toISOString(),
          type: "ui_error",
          level: "warning",
          message: result.error || result.reason || "Could not trim plan tail",
        });
      } else {
        state.timeline.followLive = true;
        state.timeline.selectedFrame = null;
        state.timeline.selectedTime = null;
      }
      renderMatrixPanel(state.live || {});
      schedulePlanTimelineRender();
    } else if (data.type === "calibration_state") {
      state.calibration.data = data.calibration || null;
      state.calibration.active = Boolean(data.calibration?.active);
      if (data.calibration?.position) state.calibration.localPosition = data.calibration.position;
      if (data.calibration?.speed_key) state.calibration.speedKey = String(data.calibration.speed_key);
      renderCalibrationOverlay();
    } else if (data.type === "calibration_move_result") {
      state.calibration.movePending = false;
      const result = data.result?.result || data.result;
      const actual = result?.actual_position || result?.target_position || data.position;
      if (actual) state.calibration.localPosition = actual;
      if (result?.ok === false || result?.error) {
        appendEvent({
          ts: new Date().toISOString(),
          type: "ui_error",
          level: "warning",
          message: result.error || "Calibration stage move failed",
        });
      }
      renderCalibrationOverlay();
    } else if (data.type === "calibration_jog_result") {
      const result = data.result?.result || data.result;
      const actual = result?.actual_position || result?.position || data.position;
      if (actual) state.calibration.localPosition = actual;
      renderCalibrationOverlay();
    } else if (data.type === "presets_state") {
      applyPresetState(data.presets);
      renderPresetsPanel();
    } else if (data.type === "preset_save_result") {
      const result = data.result || {};
      const failed = result.ok === false || result.error;
      state.presets.error = failed ? (result.error || "Preset save failed") : "";
      if (!failed) applySuccessfulPresetSave(result);
      state.presets.savingKey = "";
      state.presets.savingDraftKey = "";
      state.presets.pendingSave = null;
      renderPresetsPanel();
    } else if (data.type === "preset_apply_result") {
      state.presets.applyingKey = "";
      const result = data.result || {};
      const failed = result.ok === false || result.error;
      state.presets.error = failed ? (result.error || "Preset apply failed") : "";
      state.presets.lastAppliedKey = failed ? "" : `${result.category || ""}.${result.name || ""}`;
      renderPresetsPanel();
    } else if (data.type === "runs") {
      state.runs = data.runs || [];
      renderRuns();
    } else if (data.type === "older_events") {
      if (data.run_id && data.run_id !== (state.selectedRunId || state.status?.run_id || "")) return;
      const list = $("conversation");
      const previousHeight = list?.scrollHeight || 0;
      const previousTop = list?.scrollTop || 0;
      prependOlderRunEvents(data.events || [], data.event_window || {});
      state.forceConversationRender = true;
      state.conversationAtLatest = false;
      render();
      requestAnimationFrame(() => {
        const conversation = $("conversation");
        if (!conversation) return;
        conversation.scrollTop = Math.max(0, conversation.scrollHeight - previousHeight + previousTop);
        state.conversationAtLatest = isConversationAtLatest();
        updateJumpToBottomButton();
      });
    } else if (data.type === "run_naming") {
      if (data.busy) state.namingRuns.add(data.run_id);
      else state.namingRuns.delete(data.run_id);
      renderRuns();
    } else if (data.type === "run_named") {
      state.runs = data.runs || state.runs;
      state.status = data.status || state.status;
      state.namingRuns.delete(data.run_id);
      render();
    } else if (data.type === "run_loaded") {
      state.status = data.status;
      syncSpeechConfig(data.status?.speech);
      state.runs = data.runs || [];
      state.selectedRunId = data.status?.run_id || "";
      resetTimelineLiveBootstrap();
      resetTimelineLiveState();
      resetRunEvents(data.events || [], data.event_window || {});
      rehydrateStageMotionFromEvents(state.events);
      state.audio.transcribing = audioTranscriptionPending(state.events);
      applyTemperatureHistory(data.temperature_history);
      state.temperatureHover = null;
      state.typewriter.clear();
      stopTypewriterAnimation();
      state.lastRenderedConversationKey = "";
      state.forceConversationRender = true;
      state.conversationAtLatest = true;
      state.agentBusy = Boolean(data.status?.agent_busy);
      render();
    } else if (data.type === "tool_result") {
      $("toolResult").textContent = JSON.stringify(data.result, null, 2);
      if ((data.result?.error || data.event?.ok === false) && typeof clearPendingMetricEdit === "function") {
        clearPendingMetricEdit();
      }
    } else if (data.type === "artifact_reveal_result") {
      handleArtifactRevealResult(data.result);
    } else if (data.type === "visualizer_download") {
      handleVisualizerDownload(data);
    } else if (data.type === "audio_model_load") {
      handleAudioModelLoad(data);
    } else if (data.type === "audio_transcription") {
      handleAudioTranscription(data);
    } else if (data.type === "agent_result") {
      $("agentResult").textContent = data.text || JSON.stringify(data, null, 2);
    } else {
      appendEvent(data);
    }
  };
}

window.addEventListener("DOMContentLoaded", () => {
  state.runsOpen = location.hash === "#runs";
  for (const tab of document.querySelectorAll(".tab")) {
    tab.onclick = () => setActiveTab(tab.dataset.tab);
  }
  for (const tab of document.querySelectorAll(".bottom-tab[data-bottom-tab]")) {
    tab.onclick = () => setBottomTab(tab.dataset.bottomTab);
  }
  initializeDashboardLayoutControls();
  const temperatureChart = $("temperatureChart");
  if (temperatureChart) {
    temperatureChart.addEventListener("mousemove", (event) => {
      const rect = temperatureChart.getBoundingClientRect();
      state.temperatureHover = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      renderTemperatureChart();
    });
    temperatureChart.addEventListener("mouseleave", () => {
      state.temperatureHover = null;
      renderTemperatureChart();
    });
  }
  const temperatureReadout = document.querySelector(".temperature-readout");
  if (temperatureReadout) {
    temperatureReadout.addEventListener("click", (event) => {
      if (event.target?.closest?.("input, textarea, select, button")) return;
      if (typeof beginTemperatureTargetEdit === "function") beginTemperatureTargetEdit();
    });
  }
  const tokenChart = $("tokenCumulativeChart");
  if (tokenChart) {
    tokenChart.addEventListener("mousemove", (event) => {
      const rect = tokenChart.getBoundingClientRect();
      state.tokenChartHover = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      renderTokenAnalytics();
    });
    tokenChart.addEventListener("mouseleave", () => {
      state.tokenChartHover = null;
      renderTokenAnalytics();
    });
  }
  const contextHistogram = $("contextHistogram");
  if (contextHistogram) {
    contextHistogram.addEventListener("mousemove", (event) => {
      const rect = contextHistogram.getBoundingClientRect();
      state.contextHistogramHover = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      renderTokenAnalytics();
    });
    contextHistogram.addEventListener("mouseleave", () => {
      state.contextHistogramHover = null;
      renderTokenAnalytics();
    });
  }
  const streamerFrame = $("streamerFrame");
  const streamerViewer = streamerFrame?.closest(".viewer.streamer");
  streamerFrame?.addEventListener("load", () => {
    applyStreamerView();
    requestStreamerResolutionUpdate();
    updateCalibrationOverlayGeometry();
  });
  streamerFrame?.addEventListener("error", () => {
    if (!state.streamerView.directActive) return;
    state.streamerView.directFailedAt = Date.now();
    state.streamerView.directActive = false;
    state.streamerView.directSrc = "";
    renderFrame("streamer", state.live?.frames?.streamer);
  });
  if (streamerViewer) {
    streamerViewer.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomStreamerFrame(event);
    }, { passive: false });
    streamerViewer.addEventListener("auxclick", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    streamerViewer.addEventListener("dblclick", () => {
      resetStreamerView();
      applyStreamerView();
      requestStreamerResolutionUpdate();
    });
    streamerViewer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      streamerViewer.setPointerCapture?.(event.pointerId);
      state.streamerView.dragging = true;
      state.streamerView.moved = false;
      state.streamerView.dragButton = event.button;
      state.streamerView.dragStartX = event.clientX;
      state.streamerView.dragStartY = event.clientY;
      state.streamerView.dragPanX = state.streamerView.panX;
      state.streamerView.dragPanY = state.streamerView.panY;
      streamerViewer.classList.add("dragging");
    });
    streamerViewer.addEventListener("pointermove", (event) => {
      if (!state.streamerView.dragging) return;
      const dx = event.clientX - state.streamerView.dragStartX;
      const dy = event.clientY - state.streamerView.dragStartY;
      if (Math.hypot(dx, dy) > 4) state.streamerView.moved = true;
      state.streamerView.panX = state.streamerView.dragPanX + dx;
      state.streamerView.panY = state.streamerView.dragPanY + dy;
      clampStreamerView();
      applyStreamerView();
    });
    streamerViewer.addEventListener("pointerup", (event) => {
      if (event.button !== state.streamerView.dragButton) return;
      event.preventDefault();
      streamerViewer.releasePointerCapture?.(event.pointerId);
      const wasDragging = state.streamerView.dragging;
      state.streamerView.dragging = false;
      state.streamerView.dragButton = null;
      streamerViewer.classList.remove("dragging");
      if (wasDragging) saveStreamerView();
    });
    streamerViewer.addEventListener("pointercancel", () => {
      const wasDragging = state.streamerView.dragging;
      state.streamerView.dragging = false;
      state.streamerView.moved = false;
      state.streamerView.dragButton = null;
      streamerViewer.classList.remove("dragging");
      if (wasDragging) saveStreamerView();
    });
    streamerViewer.addEventListener("mouseleave", () => {
      const wasDragging = state.streamerView.dragging;
      state.streamerView.dragging = false;
      state.streamerView.moved = false;
      state.streamerView.dragButton = null;
      streamerViewer.classList.remove("dragging");
      if (wasDragging) saveStreamerView();
    });
  }
  $("calibrationStreamerFrame")?.addEventListener("load", updateCalibrationOverlayGeometry);
  window.addEventListener("resize", updateCalibrationOverlayGeometry);
  const matrixScene = $("matrixScene");
  if (matrixScene) {
    matrixScene.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomMatrixScene(event);
    }, { passive: false });
    matrixScene.addEventListener("dblclick", () => {
      resetMatrixView();
      matrixScene.classList.remove("dragging");
      renderMatrixPanel(state.live || {});
    });
    matrixScene.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      hideMatrixContextMenu();
      stopMatrixEdgePan();
      if (event.button === 1 || event.ctrlKey) {
        startMatrixManualPan(event);
        return;
      }
      if (activeMatrixPaintValue() !== null) {
        const pointer = matrixPointerInfoFromEvent(event, { clampToGrid: true });
        if (!pointer) return;
        event.preventDefault();
        matrixScene.setPointerCapture?.(event.pointerId);
        state.matrixPaint.dragging = true;
        state.matrixPaint.start = pointer.electrode;
        state.matrixPaint.current = pointer.electrode;
        state.matrixPaint.startDisplay = pointer.display;
        state.matrixPaint.currentDisplay = pointer.display;
        matrixScene.classList.add("dragging");
        renderMatrixPanel(state.live || {});
        return;
      }
      startMatrixSelectionDrag(event);
    });
    matrixScene.addEventListener("pointermove", (event) => {
      const rect = matrixScene.getBoundingClientRect();
      const pointer = matrixPointerInfoFromEvent(event, { clampToGrid: true, magnetic: true, rect });
      state.matrixHover = pointer?.hover || null;
      updateMatrixEdgePan(event, rect);
      if (state.matrixView.dragging) {
        updateMatrixManualPan(event);
        updateMatrixHover(state.matrixHover);
        updateMatrixCursorHud(state.matrixHover);
        updateMatrixPaintCursor(state.matrixHover);
        return;
      }
      if (state.matrixPaint.dragging) {
        updateMatrixPaintDragFromPointer(pointer);
        updateMatrixHover(state.matrixHover);
        updateMatrixCursorHud(state.matrixHover);
        updateMatrixPaintCursor(state.matrixHover);
        return;
      }
      if (state.matrixSelection.dragging) {
        updateMatrixSelectionDrag(pointer);
        updateMatrixHover(state.matrixHover);
        updateMatrixCursorHud(state.matrixHover);
        updateMatrixPaintCursor(state.matrixHover);
        return;
      }
      updateMatrixMovePreviewFromPointer(event);
      updateMatrixHover(state.matrixHover);
      updateMatrixCursorHud(state.matrixHover);
      updateMatrixPaintCursor(state.matrixHover);
    });
    matrixScene.addEventListener("pointerup", (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      if (event.button === 1) event.preventDefault();
      matrixScene.releasePointerCapture?.(event.pointerId);
      if (state.matrixView.dragging) {
        endMatrixManualPan();
        matrixScene.classList.remove("dragging");
        return;
      }
      if (state.matrixPaint.dragging) {
        updateMatrixPaintDragFromPointer(matrixPointerInfoFromEvent(event, { clampToGrid: true }));
        endMatrixPaintDrag();
        stopMatrixEdgePan();
        matrixScene.classList.remove("dragging");
        return;
      }
      if (state.matrixSelection.dragging) {
        endMatrixSelectionDrag(event);
        stopMatrixEdgePan();
        matrixScene.classList.remove("dragging");
        return;
      }
      handleMatrixSceneClick(event);
      matrixScene.classList.remove("dragging");
    });
    matrixScene.addEventListener("pointercancel", () => {
      if (state.matrixPaint.dragging) {
        cancelMatrixPaintDrag();
        stopMatrixEdgePan();
        matrixScene.classList.remove("dragging");
        return;
      }
      if (state.matrixSelection.dragging) {
        cancelMatrixSelectionDrag();
        stopMatrixEdgePan();
        matrixScene.classList.remove("dragging");
        return;
      }
      if (state.matrixView.dragging) {
        cancelMatrixManualPan();
        matrixScene.classList.remove("dragging");
        return;
      }
      state.matrixView.dragging = false;
      state.matrixView.moved = false;
      matrixScene.classList.remove("dragging");
    });
    matrixScene.addEventListener("mouseleave", () => {
      if (state.matrixPaint.dragging || state.matrixSelection.dragging) return;
      state.matrixHover = null;
      state.matrixMovePreview.hover = null;
      stopMatrixEdgePan();
      if (state.matrixView.dragging) cancelMatrixManualPan();
      matrixScene.classList.remove("dragging");
      updateMatrixHover(null);
      updateMatrixCursorHud(null);
      updateMatrixPaintCursor(null);
    });
    matrixScene.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (activeMatrixPaintValue() !== null) return;
      if (queueMatrixWaypointFromContext(event)) return;
      openMatrixContextMenu(event);
    });
    matrixScene.addEventListener("auxclick", (event) => {
      if (event.button === 1) event.preventDefault();
    });
  }
  const matrixMinimap = $("matrixMinimap");
  if (matrixMinimap) {
    matrixMinimap.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      hideMatrixContextMenu();
      state.matrixNav.minimapDragging = true;
      matrixMinimap.classList.add("dragging");
      matrixMinimap.setPointerCapture?.(event.pointerId);
      centerMatrixFromMinimapEvent(event);
    });
    matrixMinimap.addEventListener("pointermove", (event) => {
      if (!state.matrixNav.minimapDragging) return;
      centerMatrixFromMinimapEvent(event);
    });
    matrixMinimap.addEventListener("pointerup", (event) => {
      matrixMinimap.releasePointerCapture?.(event.pointerId);
      state.matrixNav.minimapDragging = false;
      matrixMinimap.classList.remove("dragging");
      saveMatrixView();
    });
    matrixMinimap.addEventListener("pointercancel", () => {
      state.matrixNav.minimapDragging = false;
      matrixMinimap.classList.remove("dragging");
      saveMatrixView();
    });
  }
  const matrixPaintToggle = $("matrixPaintToggle");
  if (matrixPaintToggle) {
    matrixPaintToggle.addEventListener("click", () => {
      const closing = !state.matrixPaint.collapsed;
      state.matrixPaint.collapsed = closing;
      if (closing) {
        if (state.matrixPaint.dragging) cancelMatrixPaintDrag();
        state.matrixPaint.tool = "";
      }
      renderMatrixPaintPanel();
      renderMatrixPanel(state.live || {});
    });
  }
  for (const button of document.querySelectorAll("[data-paint-tool]")) {
    button.addEventListener("click", () => {
      const tool = button.getAttribute("data-paint-tool") || "";
      state.matrixPaint.tool = state.matrixPaint.tool === tool ? "" : tool;
      state.matrixPaint.collapsed = false;
      if (state.matrixPaint.tool) clearMatrixSelectionForPaintMode();
      renderMatrixPaintPanel();
      updateMatrixPaintCursor(state.matrixHover);
      renderMatrixPanel(state.live || {});
      schedulePlanTimelineRender();
    });
  }
  const planTimeline = $("planTimeline");
  if (planTimeline) {
    planTimeline.addEventListener("wheel", (event) => {
      const scene = state.live?.scene?.result || state.live?.scene;
      const count = timelineFrameCount(scene);
      if (!count) return;
      event.preventDefault();
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const rect = planTimeline.getBoundingClientRect();
        const layout = timelineLayout(rect.width || planTimeline.clientWidth || 1, rect.height || planTimeline.clientHeight || 1, count, scene);
        const delta = (event.deltaX || event.deltaY) / Math.max(24, layout.trackWidth || planTimeline.clientWidth || 1);
        panTimelineTime(delta * layout.visibleTimeRange.duration);
      } else {
        zoomTimelineAtEvent(event);
      }
    }, { passive: false });
    planTimeline.addEventListener("pointerdown", (event) => {
      if (state.matrixCommands.planning) return;
      planTimeline.setPointerCapture?.(event.pointerId);
      state.timeline.dragging = true;
      state.timeline.moved = false;
      state.timeline.dragStartX = event.clientX;
      state.timeline.dragStartY = event.clientY;
      if (event.shiftKey) {
        state.timeline.dragMode = "pan";
        state.timeline.dragStartOffsetFrame = Number(state.timeline.offsetFrame) || 0;
        state.timeline.dragStartOffsetTime = Number(state.timeline.timeOffset) || 0;
        planTimeline.classList.add("panning");
      } else if (timelinePhotoOverlayFromPointerEvent(event)) {
        state.timeline.dragMode = "photo-marker";
      } else {
        state.timeline.dragMode = "scrub";
        selectTimelineFrameFromEvent(event);
      }
    });
    planTimeline.addEventListener("pointermove", (event) => {
      scheduleTimelineHoverFromEvent(event);
      if (!state.timeline.dragging) return;
      if (Math.hypot(event.clientX - state.timeline.dragStartX, event.clientY - state.timeline.dragStartY) >= 4) {
        state.timeline.moved = true;
      }
      if (state.timeline.dragMode === "pan") {
        dragPanTimeline(event);
      } else if (state.timeline.dragMode === "photo-marker") {
        return;
      } else {
        selectTimelineFrameFromEvent(event);
      }
    });
    planTimeline.addEventListener("pointerup", (event) => {
      planTimeline.releasePointerCapture?.(event.pointerId);
      const canOpenMarker = !state.timeline.moved && state.timeline.dragMode === "photo-marker";
      state.timeline.dragging = false;
      state.timeline.dragMode = "";
      planTimeline.classList.remove("panning");
      if (canOpenMarker) handleTimelineMarkerClick(event);
    });
    planTimeline.addEventListener("pointercancel", () => {
      state.timeline.dragging = false;
      state.timeline.moved = false;
      state.timeline.dragMode = "";
      state.timeline.hoverTime = null;
      state.timeline.hoverEvent = null;
      state.timeline.hoverOverlay = null;
      cancelScheduledTimelineHover();
      planTimeline.classList.remove("panning");
      updateTimelineHover(null);
      if (!renderTimelineHoverCursorFast()) schedulePlanTimelineRender();
    });
    planTimeline.addEventListener("mouseleave", () => {
      state.timeline.hoverFrame = null;
      state.timeline.hoverTime = null;
      state.timeline.hoverEvent = null;
      state.timeline.hoverOverlay = null;
      cancelScheduledTimelineHover();
      state.timeline.dragging = false;
      state.timeline.moved = false;
      state.timeline.dragMode = "";
      planTimeline.classList.remove("panning");
      updateTimelineHover(null);
      if (!renderTimelineHoverCursorFast()) schedulePlanTimelineRender();
    });
  }
  const timelineRangeTrack = $("timelineRangeTrack");
  if (timelineRangeTrack) {
    timelineRangeTrack.addEventListener("pointerdown", startTimelineRangeDrag);
    document.addEventListener("pointermove", updateTimelineRangeDrag);
    document.addEventListener("pointerup", endTimelineRangeDrag);
    document.addEventListener("pointercancel", endTimelineRangeDrag);
  }
  $("startMcp").onclick = () => send({ type: "start_mcp" });
  $("stopMcp").onclick = () => send({ type: "stop_mcp" });
  $("statusBtn").onclick = () => send({ type: "mcp_tool", tool: "runtime_status", arguments: {} });
  $("cartridgeCalibration").onclick = () => openCalibrationOverlay();
  $("calibrationClose").onclick = () => closeCalibrationOverlay();
  $("calibrationAccept").onclick = () => acceptCalibrationStep();
  $("calibrationSave").onclick = () => send({ type: "calibration_save" });
  $("calibrationMoveTarget").onclick = () => {
    stopAllCalibrationJogs();
    send({ type: "calibration_move_to_target" });
  };
  for (const button of document.querySelectorAll("[data-calibration-speed]")) {
    button.addEventListener("click", () => {
      setCalibrationSpeed(String(button.getAttribute("data-calibration-speed") || "2"));
      renderCalibrationOverlay();
    });
  }
  document.addEventListener("keydown", handleCalibrationKeydown);
  document.addEventListener("keyup", handleCalibrationKeyup);
  window.addEventListener("blur", () => stopAllCalibrationJogs());
  document.addEventListener("keydown", handleSelectedDropletKeydown);
  $("downloadStreamer").onclick = () => downloadVisualizerFrame("streamer");
  $("downloadMatrix").onclick = () => downloadVisualizerFrame("matrix");
  $("matrixPathToggle").onclick = () => {
    state.matrixPaths.collapsed = !state.matrixPaths.collapsed;
    renderMatrixPathPanel(matrixSceneForTimeline(state.live?.scene?.result || state.live?.scene));
  };
  $("matrixLiveBadge").onclick = () => followLiveTimeline();
  $("timelineLive").onclick = () => followLiveTimeline();
  const timelineZoomIn = $("timelineZoomIn");
  const timelineZoomOut = $("timelineZoomOut");
  if (timelineZoomIn) timelineZoomIn.onclick = () => zoomTimelineButton(1.4);
  if (timelineZoomOut) timelineZoomOut.onclick = () => zoomTimelineButton(1 / 1.4);
  $("timelineTrimTail").onclick = () => trimTimelineTailAfterSelectedFrame();
  $("timelinePlay").onclick = () => playTimelineExecution();
  $("timelinePause").onclick = () => callTimelineExecutionTool("pause_plan", {});
  $("timelineRewind").onclick = () => rewindTimelineExecution();
  $("timelineStopToggle").onclick = () => toggleLogicalTimeline();
  $("timelineOverlayToggle").onclick = () => {
    state.timeline.overlayMenuOpen = !state.timeline.overlayMenuOpen;
    if (state.timeline.overlayMenuOpen) state.timeline.executorMenuOpen = false;
    renderTimelineOverlayMenu();
    renderTimelineExecutorMenu();
  };
  $("timelineExecutorToggle").onclick = () => {
    state.timeline.executorMenuOpen = !state.timeline.executorMenuOpen;
    if (state.timeline.executorMenuOpen) state.timeline.overlayMenuOpen = false;
    renderTimelineExecutorMenu();
    renderTimelineOverlayMenu();
  };
  for (const input of document.querySelectorAll("[data-timeline-overlay]")) {
    input.addEventListener("change", () => {
      const key = input.getAttribute("data-timeline-overlay");
      if (!key || !(key in state.timeline.overlays)) return;
      state.timeline.overlays[key] = Boolean(input.checked);
      renderTimelineOverlayMenu();
      schedulePlanTimelineRender();
    });
  }
  $("refreshPresets").onclick = () => requestPresets();
  $("addPreset").onclick = () => addPresetDraft();
  const frameDelayInput = $("timelineFrameDelay");
  if (frameDelayInput) {
    frameDelayInput.addEventListener("change", () => commitTimelineFrameDelay());
    frameDelayInput.addEventListener("blur", () => commitTimelineFrameDelay());
    frameDelayInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitTimelineFrameDelay();
        frameDelayInput.blur();
      }
    });
  }
  $("matrixCommandClear").onclick = () => clearSelectedMatrixCommandQueue();
  $("matrixCommandPlan").onclick = () => planSelectedMatrixCommandQueue();
  $("controlsBtn").onclick = () => toggleControlsPopover();
  $("runsBtn").onclick = () => {
    state.runsOpen = true;
    send({ type: "list_runs" });
    renderRuns();
  };
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.("#matrixContextMenu")) hideMatrixContextMenu();
    if (
      state.controlsOpen
      && !event.target.closest?.("#controlsPopover")
      && !event.target.closest?.("#controlsBtn")
    ) {
      state.controlsOpen = false;
      renderControlsPopover();
    }
    if (
      state.timeline.overlayMenuOpen
      && !event.target.closest?.("#timelineOverlayMenu")
      && !event.target.closest?.("#timelineOverlayToggle")
    ) {
      state.timeline.overlayMenuOpen = false;
      renderTimelineOverlayMenu();
    }
    if (
      state.timeline.executorMenuOpen
      && !event.target.closest?.("#timelineExecutorMenu")
      && !event.target.closest?.("#timelineExecutorToggle")
    ) {
      state.timeline.executorMenuOpen = false;
      renderTimelineExecutorMenu();
    }
    if (!state.runsOpen) return;
    const drawer = $("runsDrawer");
    const button = $("runsBtn");
    const target = event.target;
    if (drawer?.contains(target) || button?.contains(target)) return;
    state.runsOpen = false;
    renderRuns();
  });
  $("closeRuns").onclick = () => {
    state.runsOpen = false;
    renderRuns();
  };
  $("refreshRuns").onclick = () => send({ type: "list_runs" });
  $("newRun").onclick = () => createAndJoinNewRun();
  $("selectAllRuns").onclick = () => toggleSelectAllRuns();
  $("deleteSelectedRuns").onclick = () => deleteSelectedRuns();
  $("copyOutput").onclick = () => copyLastOutput();
  $("setGoal").onclick = () => setGoalFromPrompt();
  $("toggleGoal").onclick = () => toggleGoalPaused();
  $("clearGoal").onclick = () => clearGoal();
  $("stopAgent").onclick = () => stopAgent();
  $("cancelAgent").onclick = () => stopAgent();
  $("loadAudio").onclick = () => loadAudioModel();
  $("audioInput").onclick = () => toggleAudioInput();
  $("wakeInput").onclick = () => toggleWakeListening();
  $("jumpToBottom").onclick = () => jumpConversationToLatest();
  $("conversation").addEventListener("scroll", () => {
    state.conversationAtLatest = isConversationAtLatest();
    updateJumpToBottomButton();
  });
  $("filtersToggle").onclick = () => toggleFilters();
  $("aiProfileSelect").onchange = (event) => setAiProfile(event.target.value);
  for (const checkbox of document.querySelectorAll("[data-filter]")) {
    checkbox.onchange = () => {
      state.conversationFilters[checkbox.dataset.filter] = checkbox.checked;
      state.lastRenderedConversationKey = "";
      renderConversation();
      renderFilters();
    };
  }
  for (const checkbox of document.querySelectorAll("[data-token-line]")) {
    checkbox.onchange = () => {
      state.tokenChartLines[checkbox.dataset.tokenLine] = checkbox.checked;
      renderTokenAnalytics();
    };
  }
  $("callTool").onclick = () => {
    let args = {};
    try {
      args = JSON.parse($("toolArgs").value || "{}");
    } catch (error) {
      $("toolResult").textContent = `Invalid JSON: ${error.message}`;
      return;
    }
    send({ type: "mcp_tool", tool: $("toolName").value.trim(), arguments: args });
  };
  $("askAgent").onclick = () => sendAgentPrompt();
  $("queueAgent").onclick = () => queueAgentPrompt();
  $("agentPrompt").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendAgentPrompt();
    }
  });
  $("clearLocal").onclick = () => {
    resetRunEvents([], {
      has_more: false,
      loaded_event_count: 0,
      total_event_count: 0,
      oldest_t: null,
    });
    state.typewriter.clear();
    stopTypewriterAnimation();
    render();
  };
  if (state.matrixSceneCache) renderLiveOnly();
  connect();
  renderFilters();
});

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return;
  if (String(event.key || "").toLowerCase() !== "n") return;
  event.preventDefault();
  createAndJoinNewRun();
});

window.addEventListener("resize", () => {
  state.live = mergeLiveWithMatrixCache(state.live || {});
  renderMatrixPanel(state.live || {});
  refreshStreamerViewForLayout();
  renderTemperatureChart();
  renderTokenAnalytics();
});

function setActiveTab(name) {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.tab === name);
  }
  $("mainTab")?.classList.toggle("active", name === "main");
  $("contextTab")?.classList.toggle("active", name === "context");
  $("advancedTab")?.classList.toggle("active", name === "advanced");
  requestAnimationFrame(() => {
    renderMatrixPanel(state.live || {});
    renderTemperatureChart();
    renderTokenAnalytics();
  });
}

function sendAgentPrompt() {
  const input = $("agentPrompt");
  const prompt = input.value.trim();
  if (!prompt) return;
  const type = state.agentBusy ? "steer_agent" : "ask_agent";
  state.agentBusy = true;
  render();
  send({ type, prompt, run_id: state.selectedRunId || state.status?.run_id || "" });
  input.value = "";
}

function queueAgentPrompt() {
  const input = $("agentPrompt");
  const prompt = input.value.trim();
  if (!prompt) return;
  send({
    type: "queue_agent",
    prompt,
    run_id: state.selectedRunId || state.status?.run_id || "",
  });
  input.value = "";
}

function createAndJoinNewRun() {
  try {
    state.runsOpen = false;
    resetTimelineLiveBootstrap();
    resetTimelineLiveState();
    renderRuns();
    send({ type: "new_run" });
  } catch (error) {
    appendEvent({
      ts: new Date().toISOString(),
      type: "ui_error",
      level: "warning",
      message: error?.message || String(error),
    });
  }
}

function stopAgent() {
  if (!state.agentBusy) return;
  send({ type: "cancel_agent" });
}

function audioModelReady() {
  return state.status?.speech?.enabled !== false && (!state.audio.modelLoadSupported || state.audio.modelLoaded === true);
}

function loadAudioModel() {
  if (state.audio.modelLoaded) {
    setAudioStatus("Audio ready");
    return;
  }
  if (state.audio.modelLoading) return;
  try {
    state.audio.modelLoading = true;
    setAudioStatus("Loading audio model");
    updateAudioUi();
    send({ type: "load_audio_model" });
  } catch (error) {
    state.audio.modelLoading = false;
    setAudioStatus(`Audio load error: ${error.message || error}`, true);
    updateAudioUi();
  }
}

async function toggleAudioInput() {
  if (state.audio.transcribing) return;
  if (state.audio.recording) {
    stopAudioRecording();
  } else if (!audioModelReady()) {
    setAudioStatus(state.audio.modelLoading ? "Audio model is loading" : "Click Load Audio first", true);
    updateAudioUi();
  } else {
    await startAudioRecording({ source: "manual" });
  }
}

async function startAudioRecording(options = {}) {
  if (!audioModelReady()) {
    setAudioStatus(state.audio.modelLoading ? "Audio model is loading" : "Click Load Audio first", true);
    updateAudioUi();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setAudioStatus("Audio capture is not available in this browser.", true);
    return;
  }
  if (state.audio.recording || state.audio.transcribing) return;
  stopWakeRecognizer({ keepEnabled: true });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickAudioMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const source = String(options.source || "manual");
    state.audio.stream = stream;
    state.audio.recorder = recorder;
    state.audio.chunks = [];
    state.audio.mimeType = recorder.mimeType || mimeType || "audio/webm";
    state.audio.startedAt = Date.now();
    state.audio.recordingSource = source;
    state.audio.autoRecording = Boolean(options.auto);
    state.audio.autoHadVoice = false;
    state.audio.autoLastVoiceAt = 0;
    state.audio.autoSilenceStartedAt = 0;
    state.audio.autoStopping = false;
    state.audio.lastRms = 0;
    state.audio.commandRecognitionEnabled = false;
    state.audio.commandRecognitionFailed = false;
    state.audio.commandSpeechHadWords = false;
    state.audio.commandSpeechLastAt = 0;
    state.audio.commandSpeechActive = false;
    state.audio.commandSpeechEventSeen = false;
    state.audio.commandLastTranscriptKey = "";
    state.audio.commandLastTranscriptAt = 0;
    state.audio.commandSpeechLastReason = "";
    setupAudioMeter(stream);
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) state.audio.chunks.push(event.data);
    };
    recorder.onstop = () => submitAudioRecording();
    recorder.start();
    state.audio.recording = true;
    if (state.audio.autoRecording) {
      startCommandSpeechRecognizer();
      startAutoRecordingTimer();
    }
    setAudioStatus(state.audio.autoRecording ? "Command listening" : "Recording");
    updateAudioUi();
  } catch (error) {
    cleanupAudioStream();
    state.audio.recording = false;
    state.audio.autoRecording = false;
    setAudioStatus(`Microphone error: ${error.message || error}`, true);
    updateAudioUi();
    scheduleWakeRestart();
  }
}

function stopAudioRecording() {
  state.audio.autoStopping = true;
  stopAutoRecordingTimer();
  stopCommandSpeechRecognizer({ reset: false });
  const recorder = state.audio.recorder;
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  } else {
    submitAudioRecording();
  }
}

async function submitAudioRecording() {
  const chunks = state.audio.chunks.slice();
  state.audio.chunks = [];
  const mimeType = state.audio.mimeType || "audio/webm";
  const durationMs = Date.now() - state.audio.startedAt;
  const source = state.audio.recordingSource || "manual";
  const autoSubmit = state.audio.autoRecording && source === "wake_word" && state.audio.wakeAutoSubmit;
  state.audio.pendingSource = source;
  state.audio.pendingAutoSubmit = autoSubmit;
  stopAutoRecordingTimer();
  stopCommandSpeechRecognizer({ reset: true });
  cleanupAudioStream();
  state.audio.recording = false;
  state.audio.autoRecording = false;
  state.audio.autoHadVoice = false;
  state.audio.autoLastVoiceAt = 0;
  state.audio.autoSilenceStartedAt = 0;
  state.audio.lastRms = 0;
  state.audio.commandSpeechActive = false;
  state.audio.commandSpeechEventSeen = false;
  state.audio.commandLastTranscriptKey = "";
  state.audio.commandLastTranscriptAt = 0;
  state.audio.commandSpeechLastReason = "";
  state.audio.autoStopping = false;
  state.audio.recordingSource = "manual";
  if (!chunks.length) {
    setAudioStatus("No audio captured.", true);
    updateAudioUi();
    scheduleWakeRestart();
    return;
  }
  state.audio.transcribing = true;
  setAudioStatus("Transcribing");
  updateAudioUi();
  try {
    const blob = new Blob(chunks, { type: mimeType });
    const audioBase64 = await blobToBase64(blob);
    send({
      type: "transcribe_audio",
      audio_base64: audioBase64,
      mime_type: mimeType,
      duration_ms: durationMs,
      source,
      run_id: state.selectedRunId || state.status?.run_id || "",
    });
  } catch (error) {
    state.audio.transcribing = false;
    state.audio.pendingSource = "";
    state.audio.pendingAutoSubmit = false;
    setAudioStatus(`Audio send error: ${error.message || error}`, true);
    updateAudioUi();
    scheduleWakeRestart();
  }
}

function cleanupAudioStream() {
  stopAutoRecordingTimer();
  stopAudioMeter();
  if (state.audio.stream) {
    for (const track of state.audio.stream.getTracks()) track.stop();
  }
  state.audio.stream = null;
  state.audio.recorder = null;
}

function pickAudioMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
}

function wakeRecognitionClass() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function wakePhrases() {
  const configured = String(state.audio.wakePhrase || "BoxMini")
    .split(/[,\n|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length ? configured : ["BoxMini"];
}

function normalizeWakeText(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function toggleWakeListening() {
  if (state.audio.wakeListening) {
    stopWakeListening();
  } else {
    await startWakeListening();
  }
}

async function startWakeListening(options = {}) {
  if (state.status?.speech?.enabled === false || state.status?.speech?.wake_enabled === false) {
    if (!options.automatic) setAudioStatus("Wake word is disabled in speech config.", true);
    return;
  }
  if (!audioModelReady()) {
    if (!options.automatic) setAudioStatus(state.audio.modelLoading ? "Audio model is loading" : "Click Load Audio first", true);
    updateAudioUi();
    return;
  }
  const Recognition = wakeRecognitionClass();
  state.audio.wakeSupported = Boolean(Recognition);
  if (!Recognition) {
    if (!options.automatic) setAudioStatus("Wake word is not supported by this browser.", true);
    updateAudioUi();
    return;
  }
  state.audio.wakeListening = true;
  state.audio.wakeManualStart = !options.automatic;
  clearWakeRestart();
  const started = startWakeRecognizer();
  if (started) {
    setAudioStatus(`Wake ready: say "${wakePhrases()[0]}"`);
  } else if (!options.automatic) {
    setAudioStatus("Wake word could not start. Check microphone permission.", true);
  }
  updateAudioUi();
}

function stopWakeListening() {
  state.audio.wakeListening = false;
  clearWakeRestart();
  stopWakeRecognizer({ keepEnabled: false });
  setAudioStatus("");
  updateAudioUi();
}

function startWakeRecognizer() {
  if (!state.audio.wakeListening || state.audio.recording || state.audio.transcribing) return false;
  const Recognition = wakeRecognitionClass();
  if (!Recognition) return false;
  stopWakeRecognizer({ keepEnabled: true });
  const recognizer = new Recognition();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.maxAlternatives = 3;
  if (state.audio.wakeLanguage) recognizer.lang = state.audio.wakeLanguage;
  recognizer.onstart = () => {
    state.audio.wakeActive = true;
    setAudioStatus(`Wake ready: say "${wakePhrases()[0]}"`);
    updateAudioUi();
  };
  recognizer.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const alternatives = Array.from(result || []);
      for (const alternative of alternatives) {
        if (wakeTranscriptMatches(alternative?.transcript)) {
          handleWakePhrase();
          return;
        }
      }
    }
  };
  recognizer.onerror = (event) => {
    state.audio.wakeActive = false;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      state.audio.wakeListening = false;
      setAudioStatus("Microphone permission is needed for wake word.", true);
      updateAudioUi();
      return;
    }
    if (state.audio.wakeListening) scheduleWakeRestart();
  };
  recognizer.onend = () => {
    state.audio.wakeActive = false;
    if (state.audio.wakeListening) scheduleWakeRestart();
    updateAudioUi();
  };
  state.audio.wakeRecognizer = recognizer;
  try {
    recognizer.start();
    return true;
  } catch (error) {
    state.audio.wakeRecognizer = null;
    state.audio.wakeActive = false;
    if (state.audio.wakeManualStart && state.audio.wakeListening) {
      scheduleWakeRestart();
    } else {
      state.audio.wakeListening = false;
      updateAudioUi();
    }
    return false;
  }
}

function wakeTranscriptMatches(transcript) {
  const normalized = normalizeWakeText(transcript);
  if (!normalized) return false;
  return wakePhrases().some((phrase) => {
    const target = normalizeWakeText(phrase);
    return target && normalized.includes(target);
  });
}

function handleWakePhrase() {
  if (!state.audio.wakeListening || state.audio.recording || state.audio.transcribing) return;
  stopWakeRecognizer({ keepEnabled: true });
  setAudioStatus("Wake heard. Speak command.");
  startAudioRecording({ auto: true, source: "wake_word" });
}

function commandTranscriptHasWords(transcript) {
  return /[\p{L}\p{N}]/u.test(String(transcript || ""));
}

function commandTranscriptKey(transcript) {
  return String(transcript || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function commandTranscriptWordCount(key) {
  if (!key) return 0;
  return key.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function markCommandSpeechActivity(reason = "speech") {
  const now = Date.now();
  state.audio.commandSpeechHadWords = true;
  state.audio.commandSpeechLastAt = now;
  state.audio.autoHadVoice = true;
  state.audio.autoLastVoiceAt = now;
  state.audio.autoSilenceStartedAt = 0;
  state.audio.commandSpeechLastReason = reason;
}

function acceptCommandTranscriptActivity(result, transcript) {
  const key = commandTranscriptKey(transcript);
  if (!commandTranscriptHasWords(key)) return false;
  const now = Date.now();
  const confidence = Number(result?.[0]?.confidence);
  const isFinal = Boolean(result?.isFinal);
  const wordCount = commandTranscriptWordCount(key);
  const changed = key !== state.audio.commandLastTranscriptKey;
  const grew = changed && (
    !state.audio.commandLastTranscriptKey
    || key.length >= state.audio.commandLastTranscriptKey.length + 3
    || wordCount > commandTranscriptWordCount(state.audio.commandLastTranscriptKey)
  );
  const highConfidence = Number.isFinite(confidence) && confidence >= 0.55;
  const usefulInterim = grew && (
    state.audio.commandSpeechEventSeen
      ? (wordCount >= 3 && key.length >= 12)
      : wordCount >= 2
  );
  if (!isFinal && !highConfidence && !usefulInterim) return false;
  if (!changed && now - (state.audio.commandLastTranscriptAt || 0) < 1200) return false;
  state.audio.commandLastTranscriptKey = key;
  state.audio.commandLastTranscriptAt = now;
  markCommandSpeechActivity(isFinal ? "final_text" : highConfidence ? "confident_text" : "interim_text");
  return true;
}

function startCommandSpeechRecognizer() {
  const Recognition = wakeRecognitionClass();
  state.audio.commandRecognitionEnabled = Boolean(Recognition);
  state.audio.commandRecognitionFailed = !Recognition;
  state.audio.commandRecognitionActive = false;
  clearCommandSpeechRestart();
  if (!Recognition || !state.audio.autoRecording || !state.audio.recording) return false;

  stopCommandSpeechRecognizer({ reset: false });
  state.audio.commandRecognitionEnabled = true;
  state.audio.commandRecognitionFailed = false;
  const recognizer = new Recognition();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.maxAlternatives = 1;
  if (state.audio.wakeLanguage) recognizer.lang = state.audio.wakeLanguage;
  recognizer.onstart = () => {
    state.audio.commandRecognitionActive = true;
  };
  recognizer.onspeechstart = () => {
    state.audio.commandSpeechEventSeen = true;
    state.audio.commandSpeechActive = true;
    markCommandSpeechActivity("speech_start");
  };
  recognizer.onspeechend = () => {
    state.audio.commandSpeechEventSeen = true;
    state.audio.commandSpeechActive = false;
    markCommandSpeechActivity("speech_end");
  };
  recognizer.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript || "";
      acceptCommandTranscriptActivity(result, transcript);
    }
  };
  recognizer.onerror = (event) => {
    state.audio.commandRecognitionActive = false;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      state.audio.commandRecognitionEnabled = false;
      state.audio.commandRecognitionFailed = true;
      setAudioStatus("Command listening uses audio-level fallback.");
      return;
    }
    if (state.audio.autoRecording && state.audio.recording && !state.audio.autoStopping) {
      scheduleCommandSpeechRestart();
    }
  };
  recognizer.onend = () => {
    state.audio.commandRecognitionActive = false;
    state.audio.commandSpeechActive = false;
    if (state.audio.autoRecording && state.audio.recording && !state.audio.autoStopping) {
      scheduleCommandSpeechRestart();
    }
  };
  state.audio.commandRecognizer = recognizer;
  try {
    recognizer.start();
    return true;
  } catch {
    state.audio.commandRecognizer = null;
    state.audio.commandRecognitionActive = false;
    state.audio.commandRecognitionEnabled = false;
    state.audio.commandRecognitionFailed = true;
    return false;
  }
}

function stopWakeRecognizer({ keepEnabled = true } = {}) {
  clearWakeRestart();
  const recognizer = state.audio.wakeRecognizer;
  state.audio.wakeRecognizer = null;
  state.audio.wakeActive = false;
  if (!keepEnabled) state.audio.wakeListening = false;
  if (recognizer) {
    recognizer.onstart = null;
    recognizer.onresult = null;
    recognizer.onerror = null;
    recognizer.onend = null;
    try {
      recognizer.stop();
    } catch {
      try {
        recognizer.abort();
      } catch {
        // Browser recognizers can throw if already stopped.
      }
    }
  }
}

function stopCommandSpeechRecognizer({ reset = true } = {}) {
  clearCommandSpeechRestart();
  const recognizer = state.audio.commandRecognizer;
  state.audio.commandRecognizer = null;
  state.audio.commandRecognitionActive = false;
  if (recognizer) {
    recognizer.onstart = null;
    recognizer.onresult = null;
    recognizer.onerror = null;
    recognizer.onend = null;
    try {
      recognizer.stop();
    } catch {
      try {
        recognizer.abort();
      } catch {
        // Browser recognizers can throw if already stopped.
      }
    }
  }
  if (reset) {
    state.audio.commandRecognitionEnabled = false;
    state.audio.commandRecognitionFailed = false;
    state.audio.commandSpeechHadWords = false;
    state.audio.commandSpeechLastAt = 0;
    state.audio.commandSpeechActive = false;
    state.audio.commandSpeechEventSeen = false;
    state.audio.commandLastTranscriptKey = "";
    state.audio.commandLastTranscriptAt = 0;
    state.audio.commandSpeechLastReason = "";
  }
}

function clearWakeRestart() {
  if (state.audio.wakeRestartTimer !== null) {
    window.clearTimeout(state.audio.wakeRestartTimer);
    state.audio.wakeRestartTimer = null;
  }
}

function clearCommandSpeechRestart() {
  if (state.audio.commandRecognitionRestartTimer !== null) {
    window.clearTimeout(state.audio.commandRecognitionRestartTimer);
    state.audio.commandRecognitionRestartTimer = null;
  }
}

function scheduleWakeRestart() {
  clearWakeRestart();
  if (!state.audio.wakeListening || state.audio.recording || state.audio.transcribing) return;
  state.audio.wakeRestartTimer = window.setTimeout(() => {
    state.audio.wakeRestartTimer = null;
    startWakeRecognizer();
  }, WAKE_RECOGNITION_RESTART_MS);
}

function scheduleCommandSpeechRestart() {
  clearCommandSpeechRestart();
  if (!state.audio.autoRecording || !state.audio.recording || state.audio.autoStopping) return;
  if (!state.audio.commandRecognitionEnabled || state.audio.commandRecognitionFailed) return;
  state.audio.commandRecognitionRestartTimer = window.setTimeout(() => {
    state.audio.commandRecognitionRestartTimer = null;
    if (state.audio.autoRecording && state.audio.recording && !state.audio.autoStopping) {
      startCommandSpeechRecognizer();
    }
  }, WAKE_RECOGNITION_RESTART_MS);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",", 2)[1] : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read audio blob."));
    reader.readAsDataURL(blob);
  });
}

function handleAudioModelLoad(data) {
  if (data.status) {
    state.audio.modelLoaded = data.status.loaded === true;
    state.audio.modelLoading = data.busy === true || data.status.loading === true;
  } else {
    state.audio.modelLoading = data.busy === true;
  }
  if (data.busy) {
    setAudioStatus("Loading audio model");
  } else if (data.ok) {
    state.audio.modelLoaded = true;
    state.audio.modelLoading = false;
    setAudioStatus("Audio ready");
  } else {
    state.audio.modelLoading = false;
    setAudioStatus(`Audio load error: ${data.error || "unknown error"}`, true);
  }
  updateAudioUi();
}

function handleAudioTranscription(data) {
  if (data.busy) {
    state.audio.transcribing = true;
    state.audio.pendingSource = data.source || state.audio.pendingSource;
    setAudioStatus("Transcribing");
    updateAudioUi();
    return;
  }
  state.audio.transcribing = false;
  if (data.ok) {
    const text = (data.text || "").trim();
    const autoSubmit = Boolean(state.audio.pendingAutoSubmit);
    if (text) {
      appendTranscriptToPrompt(text);
      if (autoSubmit) sendAgentPrompt();
    }
    const elapsed = Number(data.elapsed_seconds || 0);
    const timing = elapsed > 0 ? ` (${formatCompactSeconds(elapsed)})` : "";
    setAudioStatus(text ? (autoSubmit ? `Command sent${timing}` : `Transcript added${timing}`) : "No speech detected", !text);
  } else {
    setAudioStatus(`Transcription error: ${data.error || "unknown error"}`, true);
  }
  state.audio.pendingSource = "";
  state.audio.pendingAutoSubmit = false;
  updateAudioUi();
  scheduleWakeRestart();
}

function appendTranscriptToPrompt(text) {
  const input = $("agentPrompt");
  if (!input) return;
  const prefix = input.value.trim() ? `${input.value.trim()}\n` : "";
  input.value = `${prefix}${text}`;
  input.focus();
}

function formatCompactSeconds(value) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 9.95) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function setAudioStatus(message, isError = false) {
  const node = $("audioStatus");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("error", Boolean(isError));
}

function updateAudioUi() {
  const loadButton = $("loadAudio");
  const button = $("audioInput");
  const wakeButton = $("wakeInput");
  if (!loadButton && !button && !wakeButton) return;
  const composer = (button || wakeButton || loadButton)?.closest(".composer");
  const speechEnabled = state.status?.speech?.enabled !== false;
  const ready = audioModelReady();
  composer?.classList.toggle("recording-audio", state.audio.recording);
  composer?.classList.toggle("transcribing-audio", state.audio.transcribing);
  composer?.classList.toggle("wake-listening", state.audio.wakeListening);
  composer?.classList.toggle("audio-model-loading", state.audio.modelLoading);
  composer?.classList.toggle("audio-model-ready", ready);
  if (loadButton) {
    loadButton.hidden = !state.audio.modelLoadSupported;
    loadButton.disabled = !speechEnabled || state.audio.modelLoading || state.audio.recording || state.audio.transcribing || ready;
    loadButton.classList.toggle("loading", state.audio.modelLoading);
    loadButton.classList.toggle("ready", ready);
    loadButton.textContent = state.audio.modelLoading ? "..." : ready ? "Ready" : "Load";
    loadButton.title = ready
      ? "Audio model is loaded"
      : state.audio.modelLoading
        ? "Loading local audio model"
        : "Load local audio model";
  }
  if (button) {
    button.classList.toggle("recording", state.audio.recording);
    button.classList.toggle("transcribing", state.audio.transcribing);
    button.disabled = state.audio.transcribing || (!ready && !state.audio.recording);
    button.setAttribute(
      "aria-label",
      state.audio.recording ? "Stop audio recording" : "Record audio"
    );
    button.title = !ready && !state.audio.recording
      ? "Load audio first"
      : state.audio.recording
        ? "Stop and transcribe audio"
        : "Record local speech-to-text audio";
  }
  if (wakeButton) {
    const supported = Boolean(wakeRecognitionClass());
    const enabled = speechEnabled && state.status?.speech?.wake_enabled !== false;
    wakeButton.disabled = !supported || !enabled || !ready;
    wakeButton.classList.toggle("active", state.audio.wakeListening);
    wakeButton.classList.toggle("listening", state.audio.wakeActive);
    wakeButton.setAttribute("aria-pressed", state.audio.wakeListening ? "true" : "false");
    wakeButton.title = supported
      ? (!ready ? "Load audio first" : (state.audio.wakeListening ? `Stop wake word: ${wakePhrases()[0]}` : `Listen for wake word: ${wakePhrases()[0]}`))
      : "Wake word is not supported by this browser";
  }
}

function setupAudioMeter(stream) {
  stopAudioMeter();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const audioContext = new AudioContextClass();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.72;
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);
  state.audio.audioContext = audioContext;
  state.audio.analyser = analyser;
  state.audio.meterData = new Uint8Array(analyser.frequencyBinCount);
  state.audio.timeData = new Uint8Array(analyser.fftSize);
  drawAudioMeter();
}

function stopAudioMeter() {
  if (state.audio.meterAnimation) cancelAnimationFrame(state.audio.meterAnimation);
  state.audio.meterAnimation = null;
  state.audio.analyser = null;
  state.audio.meterData = null;
  state.audio.timeData = null;
  if (state.audio.audioContext) {
    state.audio.audioContext.close().catch(() => {});
  }
  state.audio.audioContext = null;
}

function startAutoRecordingTimer() {
  stopAutoRecordingTimer();
  state.audio.autoTimer = window.setInterval(() => {
    updateAutoRecordingVad(Number(state.audio.lastRms) || 0);
  }, 160);
}

function stopAutoRecordingTimer() {
  if (state.audio.autoTimer !== null) {
    window.clearInterval(state.audio.autoTimer);
    state.audio.autoTimer = null;
  }
}

function drawAudioMeter() {
  const canvas = $("audioMeter");
  const analyser = state.audio.analyser;
  const data = state.audio.meterData;
  const timeData = state.audio.timeData;
  if (!canvas || !analyser || !data || !state.audio.recording) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  analyser.getByteFrequencyData(data);
  const rms = audioRms(analyser, timeData);
  state.audio.lastRms = rms;
  updateAutoRecordingVad(rms);
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(100, 210, 255, 0.45)");
  gradient.addColorStop(0.55, "rgba(48, 209, 88, 0.82)");
  gradient.addColorStop(1, "rgba(255, 159, 10, 0.9)");
  ctx.fillStyle = "rgba(8, 8, 10, 0.84)";
  roundedRect(ctx, 0, 0, width, height, 8 * dpr);
  ctx.fill();
  const bars = 38;
  const gap = 2 * dpr;
  const barWidth = Math.max(2 * dpr, (width - gap * (bars - 1)) / bars);
  ctx.fillStyle = gradient;
  for (let index = 0; index < bars; index += 1) {
    const sampleStart = Math.floor((index / bars) * data.length);
    const sampleEnd = Math.max(sampleStart + 1, Math.floor(((index + 1) / bars) * data.length));
    let sum = 0;
    for (let sample = sampleStart; sample < sampleEnd; sample += 1) sum += data[sample];
    const level = sum / (sampleEnd - sampleStart) / 255;
    const shaped = Math.pow(level, 0.62);
    const barHeight = Math.max(3 * dpr, shaped * (height - 16 * dpr));
    const x = index * (barWidth + gap);
    const y = (height - barHeight) / 2;
    roundedRect(ctx, x, y, barWidth, barHeight, Math.min(barWidth / 2, 4 * dpr));
    ctx.fill();
  }
  ctx.fillStyle = "rgba(245, 245, 247, 0.72)";
  ctx.font = `${11 * dpr}px -apple-system, BlinkMacSystemFont, Segoe UI`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const label = state.audio.autoRecording
    ? (commandSpeechSilenceActive() ? "Words" : "Command")
    : "Listening";
  ctx.fillText(label, 12 * dpr, height / 2);
  state.audio.meterAnimation = requestAnimationFrame(drawAudioMeter);
}

function audioRms(analyser, data) {
  if (!analyser || !data) return 0;
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let index = 0; index < data.length; index += 1) {
    const centered = (data[index] - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / data.length);
}

function commandSpeechSilenceActive() {
  return Boolean(state.audio.commandRecognitionEnabled && !state.audio.commandRecognitionFailed);
}

function updateAutoRecordingVad(rms) {
  if (!state.audio.autoRecording || !state.audio.recording || state.audio.autoStopping) return;
  const now = Date.now();
  const elapsedMs = now - state.audio.startedAt;
  if (elapsedMs >= state.audio.wakeCommandMaxSeconds * 1000) {
    stopAudioRecording();
    return;
  }
  if (commandSpeechSilenceActive()) {
    if (!state.audio.commandSpeechHadWords) {
      if (elapsedMs >= state.audio.wakeInitialSilenceMs) stopAudioRecording();
      return;
    }
    const textActivityAt = Number(state.audio.commandLastTranscriptAt) || 0;
    const speechActivityAt = Number(state.audio.commandSpeechLastAt) || state.audio.startedAt;
    const silenceBase = textActivityAt || speechActivityAt;
    if (state.audio.commandSpeechEventSeen && state.audio.commandSpeechActive) {
      const activeSpeechGraceMs = Math.max(state.audio.wakeSilenceMs * 2, 3000);
      if (now - silenceBase >= activeSpeechGraceMs) stopAudioRecording();
      return;
    }
    if (now - silenceBase >= state.audio.wakeSilenceMs) {
      stopAudioRecording();
    }
    return;
  }
  if (rms >= AUDIO_AUTO_VOICE_THRESHOLD) {
    state.audio.autoHadVoice = true;
    state.audio.autoLastVoiceAt = now;
    state.audio.autoSilenceStartedAt = 0;
    return;
  }
  if (!state.audio.autoHadVoice) {
    if (elapsedMs >= state.audio.wakeInitialSilenceMs) stopAudioRecording();
    return;
  }
  if (!state.audio.autoSilenceStartedAt) state.audio.autoSilenceStartedAt = now;
  const silenceSince = Math.max(state.audio.autoLastVoiceAt || 0, state.audio.autoSilenceStartedAt || 0);
  if (now - silenceSince >= state.audio.wakeSilenceMs) stopAudioRecording();
}

function toggleFilters() {
  state.filtersOpen = !state.filtersOpen;
  renderFilters();
}

function renderFilters() {
  const panel = $("conversationFilters");
  if (!panel) return;
  panel.classList.toggle("collapsed", !state.filtersOpen);
  for (const checkbox of panel.querySelectorAll("[data-filter]")) {
    checkbox.checked = state.conversationFilters[checkbox.dataset.filter] !== false;
  }
}

function updateThinkingOverlay() {
  const line = $("agentStatusLine");
  if (!line) return;
  const compacting = Date.now() < state.compactingUntil;
  const active = state.agentBusy || compacting || state.audio.recording || state.audio.transcribing;
  line.classList.toggle("active", active);
  line.classList.toggle("idle", !active);
  line.classList.toggle("compacting", compacting);
  line.classList.toggle("recording", state.audio.recording);
  line.classList.toggle("transcribing", state.audio.transcribing);
  line.classList.remove("error");
  if (!active) {
    stopThinkingAnimation();
    line.textContent = "Idle";
    return;
  }
  line.textContent = agentStatusText(compacting);
  if (state.thinkingTimer === null) {
    state.thinkingTimer = window.setInterval(() => {
      state.thinkingTick = (state.thinkingTick + 1) % 4;
      const node = $("agentStatusLine");
      if (node) {
        const isCompacting = Date.now() < state.compactingUntil;
        const isActive = state.agentBusy || isCompacting || state.audio.recording || state.audio.transcribing;
        node.textContent = agentStatusText(isCompacting);
        node.classList.toggle("compacting", isCompacting);
        node.classList.toggle("active", isActive);
        node.classList.toggle("idle", !isActive);
        node.classList.toggle("recording", state.audio.recording);
        node.classList.toggle("transcribing", state.audio.transcribing);
      }
      if (!state.agentBusy && Date.now() >= state.compactingUntil) updateThinkingOverlay();
    }, 420);
  }
}

function agentStatusText(compacting = Date.now() < state.compactingUntil) {
  const dots = ".".repeat(state.thinkingTick);
  if (state.audio.recording) return `Recording${dots}`;
  if (state.audio.transcribing) return `Transcribing${dots}`;
  if (compacting) return `Compacting${dots}`;
  if (state.agentBusy) return `Thinking${dots}`;
  return "Idle";
}

function stopThinkingAnimation() {
  if (state.thinkingTimer !== null) {
    window.clearInterval(state.thinkingTimer);
    state.thinkingTimer = null;
  }
  state.thinkingTick = 0;
}

function renderLiveOnly() {
  state.lastLiveRenderAt = performance.now();
  setText("liveState", state.live?.updated_at || state.status?.live?.updated_at || "-");
  setText("liveStateAdvanced", state.live?.updated_at || state.status?.live?.updated_at || "-");
  renderLive();
}

function scheduleLiveOnlyRender() {
  if (state.liveRenderQueued || state.liveRenderTimer !== null) return;
  const now = performance.now();
  const nextAt = Number(state.lastLiveRenderAt || 0) + LIVE_RENDER_MIN_INTERVAL_MS;
  const delay = Math.max(0, nextAt - now);
  if (delay > 1) {
    state.liveRenderTimer = window.setTimeout(() => {
      state.liveRenderTimer = null;
      queueLiveOnlyRenderFrame();
    }, delay);
    return;
  }
  queueLiveOnlyRenderFrame();
}

function queueLiveOnlyRenderFrame() {
  if (state.liveRenderQueued) return;
  state.liveRenderQueued = true;
  requestAnimationFrame(() => {
    state.liveRenderQueued = false;
    renderLiveOnly();
  });
}

function copyLastOutput() {
  const button = $("copyOutput");
  const output = lastAgentOutput();
  if (!output) return;
  copyText(output, button);
}

function lastAgentOutput() {
  for (const event of [...state.events].reverse()) {
    if (event.type === "agent_response" && event.hidden) continue;
    if (event.type === "agent_response" || event.type === "agent_message") return event.text || event.error || "";
  }
  return "";
}

function updateCopyOutputButton() {
  const button = $("copyOutput");
  if (!button) return;
  button.disabled = !lastAgentOutput();
}

function renderRuns() {
  const drawer = $("runsDrawer");
  const list = $("runsList");
  if (!drawer || !list) return;
  drawer.classList.toggle("open", state.runsOpen);
  list.innerHTML = "";
  const runs = state.runs || [];
  for (const runId of [...state.selectedRuns]) {
    if (!runs.some((run) => run.run_id === runId)) state.selectedRuns.delete(runId);
  }
  updateBatchRunControls();
  if (!runs.length) {
    const empty = document.createElement("li");
    empty.className = "run-empty";
    empty.textContent = "No runs yet";
    list.appendChild(empty);
    return;
  }
  for (const run of runs) {
    const item = document.createElement("li");
    item.className = "run-item";
    if (run.run_id === state.status?.run_id || run.active) item.classList.add("active");
    if (state.selectedRuns.has(run.run_id)) item.classList.add("selected");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "run-check";
    checkbox.checked = state.selectedRuns.has(run.run_id);
    checkbox.disabled = run.run_id === state.status?.run_id || run.active;
    checkbox.onchange = () => {
      if (checkbox.checked) state.selectedRuns.add(run.run_id);
      else state.selectedRuns.delete(run.run_id);
      renderRuns();
    };

    const main = document.createElement("button");
    main.className = "run-select";
    main.onclick = () => {
      state.selectedRunId = run.run_id;
      state.conversationAtLatest = true;
      resetTimelineLiveBootstrap();
      resetTimelineLiveState();
      send({ type: "select_run", run_id: run.run_id });
    };

    const title = document.createElement("strong");
    title.textContent = run.name || shortRunId(run.run_id);
    title.title = run.name ? run.run_id : "";
    const meta = document.createElement("span");
    meta.textContent = `${formatRunDate(run.last_event_at || run.created_at)} - ${run.event_count || 0} events`;
    const preview = document.createElement("small");
    preview.textContent = run.preview || "No conversation yet";
    main.append(title, meta, preview);

    const rename = document.createElement("button");
    rename.className = "run-rename";
    rename.textContent = "Rename";
    rename.onclick = () => renameRun(run);

    const autoName = document.createElement("button");
    autoName.className = "run-name-ai";
    autoName.textContent = state.namingRuns.has(run.run_id) ? "Naming..." : "Name";
    autoName.disabled = state.namingRuns.has(run.run_id) || !(state.status?.ai?.configured);
    autoName.title = "Ask the AI to infer a concise run name from this conversation";
    autoName.onclick = () => send({ type: "auto_name_run", run_id: run.run_id });

    const del = document.createElement("button");
    del.className = "run-delete";
    del.textContent = "Delete";
    del.disabled = run.run_id === state.status?.run_id || run.active;
    del.onclick = () => {
      if (confirm(`Delete run ${run.run_id}?`)) {
        send({ type: "delete_run", run_id: run.run_id });
      }
    };
    const actions = document.createElement("div");
    actions.className = "run-item-actions";
    actions.append(autoName, rename, del);
    item.append(checkbox, main, actions);
    list.appendChild(item);
  }
}

function updateBatchRunControls() {
  const deleteButton = $("deleteSelectedRuns");
  if (deleteButton) {
    deleteButton.disabled = state.selectedRuns.size === 0;
    deleteButton.textContent = state.selectedRuns.size ? `Delete ${state.selectedRuns.size}` : "Delete Selected";
  }
  const selectButton = $("selectAllRuns");
  if (selectButton) {
    const selectable = selectableRuns();
    const allSelected = selectable.length > 0 && selectable.every((run) => state.selectedRuns.has(run.run_id));
    selectButton.disabled = selectable.length === 0;
    selectButton.textContent = allSelected ? "Clear" : "Select All";
  }
}

function selectableRuns() {
  return (state.runs || []).filter((run) => run.run_id !== state.status?.run_id && !run.active);
}

function toggleSelectAllRuns() {
  const selectable = selectableRuns();
  const allSelected = selectable.length > 0 && selectable.every((run) => state.selectedRuns.has(run.run_id));
  if (allSelected) {
    for (const run of selectable) state.selectedRuns.delete(run.run_id);
  } else {
    for (const run of selectable) state.selectedRuns.add(run.run_id);
  }
  renderRuns();
}

function deleteSelectedRuns() {
  const runIds = [...state.selectedRuns].filter((runId) => runId !== state.status?.run_id);
  if (!runIds.length) return;
  if (!confirm(`Delete ${runIds.length} selected run${runIds.length === 1 ? "" : "s"}?`)) return;
  send({ type: "delete_runs", run_ids: runIds });
  state.selectedRuns.clear();
  renderRuns();
}

function renameRun(run) {
  const next = prompt("Run name", run.name || "");
  if (next === null) return;
  send({ type: "rename_run", run_id: run.run_id, name: next.trim() });
}

function shortRunId(runId) {
  if (!runId) return "-";
  return runId.length > 22 ? `${runId.slice(0, 18)}...` : runId;
}

function formatRunDate(value) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderLive() {
  const live = mergeLiveWithMatrixCache(state.live || {});
  state.live = live;
  syncTimelineSelection(live?.scene?.result || live?.scene);
  if (shouldRenderMatrixPanel()) renderMatrixPanel(live);
  const directStreamer = configureDirectStreamer(live);
  if (!directStreamer) {
    renderFrame("streamer", live.frames?.streamer);
    renderCalibrationFrame(live.frames?.streamer);
  }
  updateTemperatureHistory(live);
  if (isStatePanelVisible()) {
    renderStateGrid(live);
    renderTemperatureChart();
    compactStatePanel();
  }
  schedulePlanTimelineRender();
}

function isMatrixPanelVisible() {
  if (!shouldRenderMatrixPanel()) return false;
  const canvas = $("matrixScene");
  if (!canvas) return false;
  const rect = canvas.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function shouldRenderMatrixPanel() {
  if (state.layout.collapsed.visuals || state.layout.collapsed.matrix) return false;
  const canvas = $("matrixScene");
  if (!canvas) return false;
  return true;
}

function isStatePanelVisible() {
  return state.bottomTab === "state" && !state.layout.collapsed.bottom;
}

function applyLiveFrame(data) {
  const visualizer = String(data?.visualizer || "").trim();
  const frame = data?.frame;
  if (!visualizer || !frame) return;
  if (visualizer === "streamer" && state.streamerView.directActive) return;
  if (!frameIsFreshForVisualizer(visualizer, frame, data.updated_at)) return;
  rememberFrameFreshness(visualizer, frame, data.updated_at);
  const live = state.live && typeof state.live === "object" ? { ...state.live } : {};
  live.frames = { ...(live.frames || {}), [visualizer]: frame };
  live.updated_at = data.updated_at || live.updated_at || new Date().toISOString();
  state.live = live;
  setText("liveState", live.updated_at || state.status?.live?.updated_at || "-");
  setText("liveStateAdvanced", live.updated_at || state.status?.live?.updated_at || "-");
  renderFrame(visualizer, frame);
  if (visualizer === "streamer") renderCalibrationFrame(frame);
}

function applyLiveScene(data) {
  const scene = data?.scene?.result || data?.scene;
  if (!scene?.available) return;
  const live = state.live && typeof state.live === "object" ? { ...state.live } : {};
  live.scene = scene;
  live.updated_at = data.updated_at || live.updated_at || new Date().toISOString();
  state.live = mergeLiveWithMatrixCache(live);
  bootstrapTimelineLiveFromScene(state.live?.scene?.result || state.live?.scene);
  setText("liveState", state.live.updated_at || state.status?.live?.updated_at || "-");
  setText("liveStateAdvanced", state.live.updated_at || state.status?.live?.updated_at || "-");
  if (shouldRenderMatrixPanel()) renderMatrixPanel(state.live || {});
  schedulePlanTimelineRender();
}

function configureDirectStreamer(live) {
  const url = directStreamerUrlFromLive(live);
  const view = state.streamerView;
  if (!url) {
    view.directUrl = "";
    view.directSrc = "";
    view.directActive = false;
    return false;
  }
  if (Date.now() - Number(view.directFailedAt || 0) < 4000) return false;
  view.directUrl = url;
  view.directActive = true;
  refreshDirectStreamerSrc();
  return true;
}

function directStreamerUrlFromLive(live) {
  const visualizers = live?.visualizers?.result || live?.visualizers?.value || live?.visualizers || {};
  const candidates = [
    getPath(visualizers, "streamer.stream.url"),
    getPath(visualizers, "result.streamer.stream.url"),
    getPath(visualizers, "structuredContent.result.streamer.stream.url"),
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

function refreshDirectStreamerSrc() {
  const view = state.streamerView;
  const img = $("streamerFrame");
  if (!view.directActive || !view.directUrl || !img) return false;
  const resolution = streamerResolutionForZoom();
  const url = directStreamerUrlWithOptions(view.directUrl, resolution);
  if (url !== view.directSrc) {
    view.directSrc = url;
    img.src = url;
    const calibrationImg = $("calibrationStreamerFrame");
    if (calibrationImg) {
      calibrationImg.src = url;
      calibrationImg.closest(".calibration-streamer")?.classList.add("has-frame");
      window.requestAnimationFrame(updateCalibrationOverlayGeometry);
    }
  }
  img.closest(".viewer")?.classList.add("has-frame");
  const meta = $("streamerMeta");
  if (meta) {
    meta.dataset.baseText = "direct stream";
    meta.textContent = streamerMetaText(meta.dataset.baseText);
  }
  applyStreamerView();
  return true;
}

function directStreamerUrlWithOptions(baseUrl, resolution) {
  const options = resolution || streamerResolutionForZoom();
  const fullResolution = Boolean(options.full_resolution);
  try {
    const url = new URL(baseUrl, window.location.href);
    url.searchParams.set("source", "processed");
    url.searchParams.set("fresh", "true");
    url.searchParams.set("fps", "24");
    url.searchParams.set("quality", fullResolution ? "92" : "84");
    if (fullResolution) {
      url.searchParams.delete("max_width");
      url.searchParams.delete("max_height");
    } else {
      url.searchParams.set("max_width", String(options.max_width));
      url.searchParams.set("max_height", String(options.max_height));
    }
    return url.toString();
  } catch {
    const separator = String(baseUrl).includes("?") ? "&" : "?";
    const params = [`source=processed`, `fresh=true`, `fps=24`, `quality=${fullResolution ? 92 : 84}`];
    if (!fullResolution) {
      params.push(`max_width=${options.max_width}`, `max_height=${options.max_height}`);
    }
    return `${baseUrl}${separator}${params.join("&")}`;
  }
}

function renderMatrixPanel(live) {
  const effectiveLive = mergeLiveWithMatrixCache(live || {});
  const scene = effectiveLive?.scene?.result || effectiveLive?.scene;
  if (scene?.available) {
    try {
      renderMatrixScene(matrixSceneForTimeline(scene));
    } catch (error) {
      renderMatrixSceneError(error);
    }
    return;
  }
  const cartridgeScene = matrixSceneFromCartridge(scene);
  if (cartridgeScene) {
    try {
      renderMatrixScene(cartridgeScene);
    } catch (error) {
      renderMatrixSceneError(error);
    }
    return;
  }
  const viewer = $("matrixScene")?.closest(".viewer");
  if (viewer) viewer.classList.remove("has-scene");
  state.matrixSceneHitboxes = [];
  updateMatrixHover(null);
  updateMatrixCursorHud(null);
  renderMatrixPaintPanel();
  renderMatrixPathPanel(null);
  renderMatrixMinimap(null);
  renderMatrixCommandPanel();
  updateMatrixLiveBadge(null);
  renderFrame("matrix", effectiveLive.frames?.matrix);
}

function renderMatrixSceneError(error) {
  const meta = $("matrixMeta");
  const canvas = $("matrixScene");
  const viewer = canvas?.closest(".viewer");
  const message = error?.message || String(error || "Matrix render failed");
  if (meta) meta.textContent = `render error: ${message}`;
  if (!canvas || !viewer) return;
  viewer.classList.add("has-scene");
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#050607";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ff9f0a";
  ctx.font = "600 13px -apple-system, BlinkMacSystemFont, Segoe UI";
  ctx.fillText("Matrix render error", 14, 28);
  ctx.fillStyle = "#a1a1a6";
  ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI";
  ctx.fillText(message.slice(0, 120), 14, 48);
}

function updateMatrixLiveBadge(scene) {
  const badge = $("matrixLiveBadge");
  if (!badge) return;
  const show = Boolean(scene?.available && !state.timeline.followLive);
  badge.hidden = !show;
  if (!show) return;
  const label = badge.querySelector("span");
  const selected = selectedTimelineFrame(scene);
  const count = timelineFrameCount(scene);
  const details = [];
  if (timelineHasFiniteNumber(selected) && count) {
    details.push(`Frame ${Math.trunc(Number(selected)) + 1}/${count}`);
  }
  const selectedTime = timelineHasFiniteNumber(state.timeline.selectedTime)
    ? Number(state.timeline.selectedTime)
    : timelineTimeForFrameFromScene(scene, selected);
  if (timelineHasFiniteNumber(selectedTime) && count) {
    const range = timelineDisplayTimeRange(scene, effectiveTimeline(scene), count);
    if (timelineHasFiniteNumber(range?.start)) {
      details.push(`+${formatRelativeSeconds(Number(selectedTime) - Number(range.start))}`);
    }
  }
  if (label) label.textContent = details.length ? details.join(" - ") : "Matrix is paused";
}

function matrixSceneFromCartridge(scene) {
  const cartridge = cartridgeMetadata(scene);
  if (!cartridge) return null;
  const matrix = cartridge.matrix && typeof cartridge.matrix === "object" ? cartridge.matrix : {};
  const rows = Math.max(1, Number(matrix.rows || matrix.row_count || 128));
  const cols = Math.max(1, Number(matrix.columns || matrix.cols || matrix.column_count || 128));
  return {
    ...(scene || {}),
    available: true,
    cartridge,
    matrix: { shape: [rows, cols], rows: {}, active_count: 0 },
    frame: {
      ...(scene?.frame || {}),
      index: 0,
      count: 1,
      source: "cartridge",
      summary: { shape: [rows, cols], rows: {}, active_count: 0 },
    },
    plan: { ...(scene?.plan || {}), actions: [] },
    droplets: [],
  };
}

function renderBottomTabs() {
  for (const tab of document.querySelectorAll(".bottom-tab")) {
    const active = tab.dataset.bottomTab === state.bottomTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  $("stateBottomPanel")?.classList.toggle("active", state.bottomTab === "state");
  $("timelineBottomPanel")?.classList.toggle("active", state.bottomTab === "timeline");
  $("presetsBottomPanel")?.classList.toggle("active", state.bottomTab === "presets");
}

function setBottomTab(name) {
  state.bottomTab = ["state", "timeline", "presets"].includes(name) ? name : "state";
  if (state.bottomTab === "presets" && !state.presets.loaded && !state.presets.loading) requestPresets();
  renderBottomTabs();
  requestAnimationFrame(() => {
    renderTemperatureChart();
    schedulePlanTimelineRender();
    renderPresetsPanel();
  });
}

function requestPresets() {
  if (state.presets.loading) return;
  state.presets.loading = true;
  state.presets.error = "";
  try {
    send({ type: "presets_get" });
  } catch (error) {
    state.presets.loading = false;
    state.presets.error = error.message;
  }
  renderPresetsPanel();
}

function applyPresetState(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  state.presets.loading = false;
  state.presets.loaded = Boolean(data.ok !== false);
  state.presets.error = data.ok === false ? (data.error || "Could not load presets") : "";
  state.presets.configPath = data.config_path || "";
  state.presets.data = data.presets && typeof data.presets === "object" ? data.presets : {};
  state.presets.categories = presetCategoriesFromState(data);
  if (!state.presets.categories.some((item) => item.name === state.presets.selectedCategory)) {
    state.presets.selectedCategory = state.presets.categories[0]?.name || "stage";
  }
}

function presetCategoriesFromState(data) {
  const fromBackend = Array.isArray(data?.categories) ? data.categories : [];
  const seen = new Set();
  const categories = [];
  for (const item of fromBackend) {
    const name = String(item?.name || "").trim();
    if (!name || seen.has(name)) continue;
    const entries = state.presets.data?.[name];
    const count = entries && typeof entries === "object" ? Object.keys(entries).length : Number(item.count || 0);
    seen.add(name);
    categories.push({ name, label: item.label || presetCategoryLabel(name), count });
  }
  for (const [name, entries] of Object.entries(state.presets.data || {})) {
    if (seen.has(name)) continue;
    seen.add(name);
    categories.push({
      name,
      label: presetCategoryLabel(name),
      count: entries && typeof entries === "object" ? Object.keys(entries).length : 0,
    });
  }
  for (const name of ["stage", "imaging"]) {
    if (!seen.has(name)) categories.push({ name, label: presetCategoryLabel(name), count: 0 });
  }
  return categories;
}

function renderPresetsPanel() {
  const status = $("presetStatus");
  const categoriesNode = $("presetCategories");
  const list = $("presetList");
  if (!status || !categoriesNode || !list) return;
  if (state.presets.loading) status.textContent = "loading";
  else if (state.presets.error) status.textContent = state.presets.error;
  else status.textContent = state.presets.configPath ? compactPath(state.presets.configPath) : "config";
  if (presetEditorHasFocus() && !state.presets.savingKey && !state.presets.applyingKey) return;

  categoriesNode.replaceChildren();
  for (const category of state.presets.categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-category";
    button.classList.toggle("active", category.name === state.presets.selectedCategory);
    button.addEventListener("click", () => {
      document.activeElement?.blur?.();
      state.presets.selectedCategory = category.name;
      renderPresetsPanel();
    });
    const label = document.createElement("strong");
    label.textContent = category.label || presetCategoryLabel(category.name);
    const count = document.createElement("code");
    count.textContent = String(category.count || 0);
    button.append(label, count);
    categoriesNode.appendChild(button);
  }

  list.replaceChildren();
  const category = state.presets.selectedCategory;
  const entries = state.presets.data?.[category] && typeof state.presets.data[category] === "object"
    ? state.presets.data[category]
    : {};
  const names = Object.keys(entries).sort((a, b) => a.localeCompare(b));
  if (!names.length) {
    const empty = document.createElement("div");
    empty.className = "preset-empty";
    empty.textContent = "No presets in this category";
    list.appendChild(empty);
  }
  for (const name of names) {
    list.appendChild(renderPresetCard(category, name, entries[name]));
  }
}

function presetEditorHasFocus() {
  const active = document.activeElement;
  return Boolean(active?.closest?.(".preset-card") && active.matches?.(".preset-name-input, .preset-json"));
}

function renderPresetCard(category, name, value) {
  const card = document.createElement("section");
  card.className = "preset-card";
  const key = `${category}.${name}`;
  const draft = presetDraft(category, name, value);
  const busy = Boolean(state.presets.applyingKey || state.presets.savingKey);
  const saving = state.presets.savingDraftKey === key || state.presets.savingKey === key;
  const applicable = presetCanApply(category, value);
  card.classList.toggle("applicable", applicable);
  card.classList.toggle("applied", state.presets.lastAppliedKey === key);
  if (applicable) {
    card.tabIndex = 0;
    card.title = `Use ${category}.${name}`;
    card.addEventListener("click", (event) => {
      if (busy || presetCardControlClicked(event.target)) return;
      applyPreset(category, name);
    });
    card.addEventListener("keydown", (event) => {
      if (busy || event.defaultPrevented || event.target !== card) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      applyPreset(category, name);
    });
  }
  const header = document.createElement("header");
  const nameInput = document.createElement("input");
  nameInput.className = "preset-name-input";
  nameInput.value = draft.name;
  nameInput.disabled = busy;
  nameInput.spellcheck = false;
  nameInput.setAttribute("aria-label", "Preset name");
  nameInput.addEventListener("input", () => updatePresetDraft(category, name, { name: nameInput.value }));
  const actions = document.createElement("div");
  actions.className = "preset-card-actions";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "preset-use-button";
  if (state.presets.applyingKey === key) apply.replaceChildren(presetSpinnerNode(), document.createTextNode("Using"));
  else apply.textContent = state.presets.lastAppliedKey === key ? "In use" : "Use";
  apply.disabled = busy || !applicable;
  apply.title = applicable ? `Apply ${category}.${name} without the LLM` : "This preset category can be saved but not applied yet";
  apply.addEventListener("click", () => applyPreset(category, name));
  const save = document.createElement("button");
  save.type = "button";
  if (saving) save.replaceChildren(presetSpinnerNode());
  else save.textContent = "Save";
  save.disabled = busy;
  actions.append(apply, save);
  header.append(nameInput, actions);

  const textarea = document.createElement("textarea");
  textarea.className = "preset-json";
  textarea.spellcheck = false;
  textarea.value = draft.json;
  textarea.disabled = busy;
  textarea.setAttribute("aria-label", `${category}.${name} JSON`);
  textarea.addEventListener("input", () => updatePresetDraft(category, name, { json: textarea.value }));
  save.addEventListener("click", () => savePreset(category, name, nameInput.value, textarea.value));

  const summary = document.createElement("div");
  summary.className = "preset-summary";
  summary.textContent = presetSummary(category, value);
  const actionPlan = document.createElement("div");
  actionPlan.className = "preset-action-plan";
  for (const item of presetActionPlan(category, value)) {
    const chip = document.createElement("span");
    chip.textContent = item;
    actionPlan.appendChild(chip);
  }
  card.append(header, summary, actionPlan, textarea);
  return card;
}

function presetCanApply(category, value) {
  if (!value || typeof value !== "object") return false;
  return category === "stage" || category === "imaging";
}

function presetCardControlClicked(target) {
  return Boolean(target?.closest?.("button, input, textarea, select, a, label"));
}

function presetActionPlan(category, value) {
  if (!value || typeof value !== "object") return ["Save only"];
  if (category === "stage") return ["Move stage"];
  if (category !== "imaging") return ["Save only"];

  const actions = [];
  const source = String(value.streamer_source || "").trim().toLowerCase();
  const hasCamera = source === "camera" || Boolean(value.camera_settings);
  if (value.position || value.stage_position) actions.push("Move stage");
  if (hasCamera) {
    actions.push("Streamer camera");
    actions.push("Camera settings");
  } else {
    actions.push(`Microscope ${value.channel || value.microscope_settings?.current_channel || "channel"}`);
  }
  if (value.light_settings) actions.push("Light");
  return actions.length ? actions : ["Apply imaging"];
}

function presetDraftKey(category, name) {
  return `${category}.${name}`;
}

function presetDraft(category, name, value) {
  const key = presetDraftKey(category, name);
  const existing = state.presets.drafts[key];
  if (existing) return existing;
  const draft = {
    category,
    originalName: name,
    name,
    json: prettyJson(value || {}),
    dirty: false,
  };
  state.presets.drafts[key] = draft;
  return draft;
}

function updatePresetDraft(category, name, patch) {
  const key = presetDraftKey(category, name);
  const draft = presetDraft(category, name, state.presets.data?.[category]?.[name] || {});
  state.presets.drafts[key] = {
    ...draft,
    ...patch,
    dirty: true,
  };
}

function presetSpinnerNode() {
  const spinner = document.createElement("span");
  spinner.className = "preset-spinner";
  spinner.setAttribute("aria-label", "Saving");
  return spinner;
}

function applySuccessfulPresetSave(result = {}) {
  const pending = state.presets.pendingSave;
  if (!pending) return;
  const category = String(result.category || pending.category || "").trim();
  const name = String(result.name || pending.name || "").trim();
  if (!category || !name) return;
  if (!state.presets.data[category] || typeof state.presets.data[category] !== "object") {
    state.presets.data[category] = {};
  }
  if (
    pending.originalCategory
    && pending.originalName
    && (pending.originalCategory !== category || pending.originalName !== name)
    && state.presets.data[pending.originalCategory]
  ) {
    delete state.presets.data[pending.originalCategory][pending.originalName];
    delete state.presets.drafts[presetDraftKey(pending.originalCategory, pending.originalName)];
  }
  state.presets.data[category][name] = pending.value;
  delete state.presets.drafts[pending.draftKey];
  state.presets.selectedCategory = category;
  state.presets.categories = presetCategoriesFromState({ categories: state.presets.categories });
}

function savePreset(category, originalName, nextName, rawJson) {
  let value;
  try {
    value = JSON.parse(rawJson || "{}");
  } catch (error) {
    state.presets.error = `Invalid JSON: ${error.message}`;
    renderPresetsPanel();
    return;
  }
  const name = String(nextName || "").trim();
  if (!name) {
    state.presets.error = "Preset name cannot be empty";
    renderPresetsPanel();
    return;
  }
  state.presets.savingKey = `${category}.${originalName}`;
  state.presets.savingDraftKey = presetDraftKey(category, originalName);
  state.presets.pendingSave = {
    draftKey: presetDraftKey(category, originalName),
    originalCategory: category,
    originalName,
    category,
    name,
    value,
  };
  state.presets.error = "";
  send({
    type: "preset_save",
    category,
    name,
    original_category: category,
    original_name: originalName,
    value,
  });
  renderPresetsPanel();
}

function applyPreset(category, name) {
  const preset = state.presets.data?.[category]?.[name];
  if (!presetCanApply(category, preset)) {
    state.presets.error = `Preset category '${category}' can be saved but not applied yet.`;
    renderPresetsPanel();
    return;
  }
  state.presets.applyingKey = `${category}.${name}`;
  state.presets.error = "";
  const position = presetStagePosition(name, category);
  if (position) {
    beginStageMotionFromCommand({
      position,
      source: `preset.${category}`,
      wait_timeout_seconds: 20,
    });
  }
  send({ type: "preset_apply", category, name });
  renderPresetsPanel();
}

function addPresetDraft() {
  const categoryInput = $("newPresetCategory");
  const typedCategory = String(categoryInput?.value || "").trim();
  const category = typedCategory || state.presets.selectedCategory || "stage";
  if (!state.presets.data[category] || typeof state.presets.data[category] !== "object") {
    state.presets.data[category] = {};
  }
  let index = 1;
  let name = "new_preset";
  while (state.presets.data[category][name]) {
    index += 1;
    name = `new_preset_${index}`;
  }
  state.presets.data[category][name] = defaultPresetForCategory(category);
  state.presets.selectedCategory = category;
  if (categoryInput) categoryInput.value = "";
  state.presets.loaded = true;
  state.presets.categories = presetCategoriesFromState({ categories: state.presets.categories });
  renderPresetsPanel();
}

function defaultPresetForCategory(category) {
  if (category === "stage") {
    return {
      position: { X: 0, Y: 0, Z: 0 },
      notes: "",
    };
  }
  if (category === "imaging") {
    return {
      streamer_source: "microscope",
      channel: "Brightfield",
      microscope_settings: { auto_exposure: false, exposure_time: 72000, gain: 0 },
      light_settings: { coaxial_intensity: 4, ring_intensity: 0 },
      notes: "",
    };
  }
  return { notes: "" };
}

function presetCategoryLabel(category) {
  const text = String(category || "Presets").replace(/[_-]/g, " ");
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function presetSummary(category, value) {
  if (!value || typeof value !== "object") return "";
  const parts = [];
  const position = value.position;
  if (position && typeof position === "object") {
    parts.push(`XYZ ${formatStageCoordinate(position.X)}, ${formatStageCoordinate(position.Y)}, ${formatStageCoordinate(position.Z)}`);
  }
  const source = value.streamer_source;
  if (source) parts.push(String(source));
  const channel = value.channel || value.microscope_settings?.current_channel;
  if (channel) parts.push(String(channel));
  const camera = value.camera_settings;
  const microscope = value.microscope_settings;
  const exposure = camera?.exposure_time ?? microscope?.exposure_time ?? value.exposure_time;
  if (exposure !== undefined) parts.push(`exp ${exposure}`);
  const light = value.light_settings;
  if (light && typeof light === "object") parts.push(`light ${light.coaxial_intensity ?? 0}/${light.ring_intensity ?? 0}`);
  if (value.notes) parts.push(String(value.notes));
  return parts.join(" - ") || presetCategoryLabel(category);
}

function prettyJson(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function compactPath(path) {
  const value = String(path || "");
  const parts = value.split(/[\\/]+/);
  return parts.length > 2 ? `${parts.at(-2)}/${parts.at(-1)}` : value;
}

function syncTimelineSelection(scene) {
  if (!state.timeline.followLive) return;
  const liveFrame = liveFrameIndex(scene);
  state.timeline.selectedFrame = liveFrame;
  state.timeline.selectedTime = timelineTimeForFrameFromScene(scene, liveFrame);
  ensureTimelineFrameVisible(liveFrame, timelineFrameCount(scene));
}

function liveFrameIndex(scene) {
  if (!timelineExecutorBelongsToRun(scene) && !timelineHasExecutionEventsThisRun()) return null;
  const index = scene?.frame?.index;
  if (index !== null && index !== undefined && Number.isFinite(Number(index))) {
    return Number(index);
  }
  const executorFrame = scene?.executor?.current_frame;
  const count = timelineFrameCount(scene);
  if (Number.isFinite(Number(executorFrame)) && count > 0) {
    return clamp(Number(executorFrame) - 1, 0, count - 1);
  }
  return null;
}

function timelineFrameCount(scene) {
  const runFrameCount = timelineRunPlanEventFrameCount();
  if (!timelineSceneIsRunRelevant(scene) && !runFrameCount) return 0;
  const count = effectiveTimeline(scene)?.frame_count ?? scene?.frame?.count ?? scene?.plan?.frame_count;
  const number = Math.max(Number(count) || 0, runFrameCount);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function effectiveTimeline(scene) {
  const runFrameCount = timelineRunPlanEventFrameCount();
  if (!timelineSceneIsRunRelevant(scene) && !runFrameCount) return null;
  if (scene?.timeline?.available) {
    const frameCount = Math.max(Number(scene.timeline.frame_count || 0), runFrameCount);
    return frameCount > Number(scene.timeline.frame_count || 0)
      ? { ...scene.timeline, frame_count: frameCount }
      : scene.timeline;
  }
  const actions = matrixTimelineActions(scene);
  if (!actions.length && !runFrameCount) return scene?.timeline || null;
  const frameCount = Math.max(Number(scene?.plan?.frame_count || scene?.frame?.count || 0), runFrameCount);
  const lastFrame = actions.reduce((max, action) => {
    const span = action?.frame_span;
    return Array.isArray(span) ? Math.max(max, Number(span[1]) || 0) : max;
  }, 0);
  return {
    available: true,
    derived: true,
    frame_count: Math.max(frameCount, lastFrame + 1),
    event_count: actions.length,
    events: actions.map((action) => ({
      id: action.id,
      event_id: action.event_id,
      index: action.index,
      type: action.type,
      label: action.label,
      frame_span: action.frame_span,
      frame_count: action.frame_count,
      droplet_ids: action.droplet_ids,
      data: action.data || {},
    })),
    frames: [],
  };
}

function timelineSceneIsRunRelevant(scene) {
  if (!scene) return false;
  if (timelineHasPlanOrExecutionEventsThisRun()) return true;
  if (timelineExecutorBelongsToRun(scene)) return true;
  const runStart = timelineRunStartTime();
  if (!Number.isFinite(runStart)) return true;
  const planUpdated = timelineSecondsFromValue(scene?.plan?.updated_at)
    ?? timelineSecondsFromValue(scene?.timeline?.updated_at)
    ?? timelineSecondsFromValue(scene?.frame?.updated_at);
  return Number.isFinite(planUpdated) && planUpdated >= runStart - 0.5;
}

function timelineHasPlanOrExecutionEventsThisRun() {
  return timelineActiveRunEvents().some((event) => {
    const tool = String(event?.tool || "").toLowerCase();
    const type = String(event?.type || "").toLowerCase();
    return timelineToolIsPlanOrExecution(tool)
      || type.startsWith("matrix_selection_plan")
      || type.startsWith("matrix_waypoint_plan")
      || type === "matrix_plan_tail_trimmed";
  });
}

function timelineRunPlanEventFrameCount() {
  let maxFrame = -1;
  for (const event of timelineActiveRunEvents()) {
    const tool = String(event?.tool || "").toLowerCase();
    if (!timelineToolIsPlanOrExecution(tool)) continue;
    if (event?.type !== "mcp_tool_result" && event?.type !== "dashboard_tool_result") continue;
    const extent = timelineRunEventFrameExtent(event);
    if (Number.isFinite(extent)) maxFrame = Math.max(maxFrame, extent);
  }
  return maxFrame >= 0 ? maxFrame + 1 : 0;
}

function timelineRunEventFrameExtent(event) {
  let maxFrame = -1;
  for (const root of eventPayloadRoots(event)) {
    const span = getPath(root, "frame_span") || getPath(root, "result.frame_span");
    if (Array.isArray(span) && span.length >= 2) {
      const start = Number(span[0]);
      const end = Number(span[1]);
      if (Number.isFinite(start)) maxFrame = Math.max(maxFrame, start);
      if (Number.isFinite(end)) maxFrame = Math.max(maxFrame, end);
    }
    const frame = firstFiniteNumber(
      getPath(root, "executor.last_frame.index"),
      getPath(root, "executor_status.last_frame.index"),
      getPath(root, "wait_status.executor_status.last_frame.index"),
      getPath(root, "status.executor.last_frame.index"),
      getPath(root, "status.executor_status.last_frame.index"),
      getPath(root, "frame.index"),
      getPath(root, "frame_idx"),
      getPath(root, "frame_index"),
      getPath(root, "target_frame"),
      getPath(root, "plan.frame_count") !== undefined ? Number(getPath(root, "plan.frame_count")) - 1 : null,
      getPath(root, "failed_plan.frame_count") !== undefined ? Number(getPath(root, "failed_plan.frame_count")) - 1 : null,
    );
    if (Number.isFinite(frame)) maxFrame = Math.max(maxFrame, Number(frame));
  }
  const argFrame = firstFiniteNumber(event?.arguments?.frame_number, event?.arguments?.frame_idx, event?.arguments?.frame_index);
  if (Number.isFinite(argFrame)) maxFrame = Math.max(maxFrame, Number(argFrame));
  const fallback = eventFrameIndex(event);
  if (Number.isFinite(fallback)) maxFrame = Math.max(maxFrame, Number(fallback));
  return maxFrame >= 0 ? Math.trunc(maxFrame) : null;
}

function timelineActiveRunEvents() {
  const events = state.events || [];
  const resetIndex = timelineLastPlanResetEventIndex(events);
  return resetIndex >= 0 ? events.slice(resetIndex + 1) : events;
}

function timelineLastPlanResetEventIndex(events = state.events || []) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (timelineEventClearsCurrentPlan(events[index])) return index;
  }
  return -1;
}

function timelineEventClearsCurrentPlan(event) {
  if (!event || (event.type !== "mcp_tool_result" && event.type !== "dashboard_tool_result")) return false;
  if (String(event.tool || "").toLowerCase() !== "clear_droplet_state") return false;
  let sawSuccessfulClear = false;
  let resetExecutor = false;
  let zeroPlan = false;
  for (const root of eventPayloadRoots(event)) {
    if (!root || typeof root !== "object") continue;
    if (root.ok === false) return false;
    if (root.cleared === true || root.ok === true) sawSuccessfulClear = true;
    if (root.reset_executor === true) resetExecutor = true;
    const frameCount = firstFiniteNumber(
      getPath(root, "plan.frame_count"),
      getPath(root, "result.plan.frame_count"),
    );
    if (Number.isFinite(frameCount) && Number(frameCount) <= 0) zeroPlan = true;
  }
  return sawSuccessfulClear && resetExecutor && zeroPlan;
}

function matrixTimelineActions(scene) {
  const actions = scene?.plan?.actions;
  if (!Array.isArray(actions)) return matrixPathActions(scene, { includeStatic: true });
  return actions
    .filter((action) => action && Array.isArray(action.frame_span))
    .map((action) => ({
      ...action,
      paths: Array.isArray(action.paths) ? action.paths : [],
    }));
}

function matrixSceneForTimeline(scene) {
  if (!scene?.available) return scene;
  if (state.timeline.followLive) return scene;
  const count = timelineFrameCount(scene);
  const frameIndex = Number(state.timeline.selectedFrame);
  if (!count || !Number.isFinite(frameIndex)) return scene;
  return matrixSceneAtFrame(scene, clamp(Math.trunc(frameIndex), 0, count - 1));
}

function matrixSceneAtFrame(scene, frameIndex) {
  const frame = timelineFrame(scene, frameIndex);
  const droplets = dropletsAtTimelineFrame(scene, frameIndex);
  const summary = frame?.summary || matrixSummaryFromDroplets(scene, droplets);
  if (!summary) return scene;
  const clonedPlan = {
    ...(scene.plan || {}),
    current_event: timelineEventAtFrame(scene, frameIndex),
  };
  const clonedFrame = {
    ...(scene.frame || {}),
    index: frameIndex,
    count: timelineFrameCount(scene),
    source: "timeline_preview",
    synced_to_executor: false,
    summary,
  };
  return {
    ...scene,
    frame: clonedFrame,
    plan: clonedPlan,
    droplets,
    timeline_preview: true,
  };
}

function timelineFrame(scene, frameIndex) {
  const frames = effectiveTimeline(scene)?.frames;
  if (!Array.isArray(frames)) return null;
  return frames.find((frame) => Number(frame?.index) === Number(frameIndex)) || frames[frameIndex] || null;
}

function timelineEventAtFrame(scene, frameIndex) {
  const events = effectiveTimeline(scene)?.events;
  if (!Array.isArray(events)) return scene?.plan?.current_event || null;
  const event = events.find((item) => frameInSpan(frameIndex, item?.frame_span));
  if (!event) return null;
  return [
    Array.isArray(event.frame_span) ? event.frame_span[0] : frameIndex,
    event.type || "action",
    {
      ...(event.data || {}),
      event_id: event.event_id,
      frame_span: event.frame_span,
    },
  ];
}

function dropletsAtTimelineFrame(scene, frameIndex) {
  const frame = timelineFrame(scene, frameIndex);
  const frameDroplets = Array.isArray(frame?.droplets) ? frame.droplets : [];
  if (frameDroplets.length) {
    return frameDroplets
      .map((droplet) => normalizeTimelineDroplet(scene, droplet, frameIndex))
      .filter(Boolean);
  }
  const activeIds = new Set((frame?.active_droplet_ids || []).map((id) => Number(id)).filter(Number.isFinite));
  const dropletIds = activeIds.size ? [...activeIds] : dropletIdsFromSummaryAndActions(scene, frameIndex);
  return dropletIds
    .map((dropletId) => dropletAtTimelineFrame(scene, dropletId, frameIndex))
    .filter(Boolean);
}

function normalizeTimelineDroplet(scene, droplet, frameIndex) {
  if (!droplet || droplet.id === undefined || droplet.id === null) return null;
  const dropletId = Number(droplet.id);
  if (!Number.isFinite(dropletId)) return null;
  const point = normalizeMatrixPoint(droplet.position)
    || dropletPositionAtFrame(scene, dropletId, frameIndex)
    || normalizeMatrixPoint(droplet.origin);
  if (!point) return null;
  const template = dropletTemplate(scene, dropletId) || {};
  const shape = normalizeMatrixCells(droplet.shape).length
    ? normalizeMatrixCells(droplet.shape)
    : normalizeMatrixCells(template.shape).length
      ? normalizeMatrixCells(template.shape)
      : [[0, 0]];
  const cells = normalizeMatrixCells(droplet.cells).length
    ? normalizeMatrixCells(droplet.cells)
    : shape.map((offset) => [point[0] + offset[0], point[1] + offset[1]]);
  const path = dropletPathUpToFrame(scene, dropletId, frameIndex);
  const target = normalizeMatrixPoint(droplet.target)
    || dropletTargetFromActions(scene, dropletId)
    || normalizeMatrixPoint(template.target)
    || point;
  return {
    ...template,
    ...droplet,
    id: dropletId,
    position: point,
    origin: normalizeMatrixPoint(droplet.origin) || normalizeMatrixPoint(template.origin) || point,
    target,
    active: droplet.active !== false,
    at_target: target && point[0] === Number(target[0]) && point[1] === Number(target[1]),
    target_reached: false,
    shape,
    shape_size: Number(droplet.shape_size) || shape.length,
    cells,
    cells_truncated: false,
    bbox: droplet.bbox || bboxFromCells(cells),
    target_bbox: droplet.target_bbox || null,
    path,
    path_included: true,
    path_length: Number(droplet.path_length) || path.length,
    timeline_preview: true,
  };
}

function dropletIdsFromSummaryAndActions(scene, frameIndex) {
  const ids = new Set();
  for (const action of matrixPathActions(scene, { includeStatic: true })) {
    if (!frameInSpan(frameIndex, action.frame_span)) continue;
    for (const id of action.droplet_ids || []) {
      const number = Number(id);
      if (Number.isFinite(number)) ids.add(number);
    }
  }
  return [...ids];
}

function dropletAtTimelineFrame(scene, dropletId, frameIndex) {
  const point = dropletPositionAtFrame(scene, dropletId, frameIndex);
  if (!point) return null;
  const template = dropletTemplate(scene, dropletId);
  const shape = normalizeMatrixCells(template?.shape).length
    ? normalizeMatrixCells(template.shape)
    : [[0, 0]];
  const cells = shape.map((offset) => [point[0] + offset[0], point[1] + offset[1]]);
  const target = dropletTargetFromActions(scene, dropletId) || template?.target || point;
  const path = dropletPathUpToFrame(scene, dropletId, frameIndex);
  return {
    ...(template || {}),
    id: dropletId,
    position: point,
    origin: template?.origin || point,
    target,
    active: true,
    at_target: target && point[0] === Number(target[0]) && point[1] === Number(target[1]),
    target_reached: false,
    shape,
    shape_size: shape.length,
    cells,
    cells_truncated: false,
    bbox: bboxFromCells(cells),
    target_bbox: null,
    path,
    path_included: true,
    path_length: path.length,
    timeline_preview: true,
  };
}

function normalizeMatrixPoint(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const row = Number(value[0]);
  const col = Number(value[1]);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return [row, col];
}

function dropletTemplate(scene, dropletId) {
  const current = (scene?.droplets || []).find((droplet) => Number(droplet?.id) === Number(dropletId));
  if (current) return current;
  return null;
}

function dropletPositionAtFrame(scene, dropletId, frameIndex) {
  let best = null;
  for (const action of matrixPathActions(scene, { includeStatic: true })) {
    const span = action.frame_span;
    if (!frameMayUseAction(frameIndex, span)) continue;
    for (const pathInfo of action.paths || []) {
      if (Number(pathInfo?.droplet_id) !== Number(dropletId)) continue;
      const path = compactDisplayPath(pathInfo.path);
      if (!path.length) continue;
      if (frameInSpan(frameIndex, span)) {
        return pathPointForFrame(path, span, frameIndex);
      }
      if (!best || Number(span?.[1]) > best.end) {
        best = { end: Number(span?.[1]), point: path[path.length - 1] };
      }
    }
  }
  return best?.point || null;
}

function dropletPathUpToFrame(scene, dropletId, frameIndex) {
  const points = [];
  for (const action of matrixPathActions(scene, { includeStatic: true })) {
    const span = action.frame_span;
    if (!frameMayUseAction(frameIndex, span)) continue;
    for (const pathInfo of action.paths || []) {
      if (Number(pathInfo?.droplet_id) !== Number(dropletId)) continue;
      const path = compactDisplayPath(pathInfo.path);
      if (!path.length) continue;
      let segment = path;
      if (frameInSpan(frameIndex, span)) {
        const spanStart = Number(span?.[0]);
        const spanEnd = Number(span?.[1]);
        const progress = spanEnd <= spanStart ? 1 : clamp((frameIndex - spanStart) / (spanEnd - spanStart), 0, 1);
        const lastIndex = Math.max(0, Math.min(path.length - 1, Math.round(progress * (path.length - 1))));
        segment = path.slice(0, lastIndex + 1);
      }
      for (const point of segment) {
        const previous = points[points.length - 1];
        if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push(point);
      }
    }
  }
  return points;
}

function dropletTargetFromActions(scene, dropletId) {
  let target = null;
  for (const action of matrixPathActions(scene, { includeStatic: true })) {
    for (const pathInfo of action.paths || []) {
      if (Number(pathInfo?.droplet_id) !== Number(dropletId)) continue;
      const path = compactDisplayPath(pathInfo.path);
      if (path.length) target = path[path.length - 1];
    }
  }
  return target;
}

function matrixSummaryFromDroplets(scene, droplets) {
  const shape = matrixShape(scene);
  const rowsByIndex = new Map();
  let activeCount = 0;
  for (const droplet of droplets || []) {
    for (const cell of dropletDisplayCells(droplet)) {
      const row = Number(cell?.[0]);
      const col = Number(cell?.[1]);
      if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
      if (!rowsByIndex.has(row)) rowsByIndex.set(row, new Set());
      const rowSet = rowsByIndex.get(row);
      if (!rowSet.has(col)) {
        rowSet.add(col);
        activeCount += 1;
      }
    }
  }
  if (!activeCount) return null;
  const rows = {};
  let rowMin = Infinity;
  let rowMax = -Infinity;
  let colMin = Infinity;
  let colMax = -Infinity;
  for (const [row, cols] of rowsByIndex.entries()) {
    const sorted = [...cols].sort((a, b) => a - b);
    rows[String(row)] = integerRanges(sorted);
    rowMin = Math.min(rowMin, row);
    rowMax = Math.max(rowMax, row);
    colMin = Math.min(colMin, sorted[0]);
    colMax = Math.max(colMax, sorted[sorted.length - 1]);
  }
  return {
    type: "matrix_summary",
    source: "timeline_preview",
    shape,
    active_count: activeCount,
    encoding: "active_ranges_by_row",
    zeros_are_implicit: true,
    active_bbox: {
      row_min: rowMin,
      row_max: rowMax,
      col_min: colMin,
      col_max: colMax,
    },
    rows,
  };
}

function integerRanges(values) {
  if (!Array.isArray(values) || !values.length) return [];
  const ranges = [];
  let start = Number(values[0]);
  let previous = start;
  for (const value of values.slice(1)) {
    const number = Number(value);
    if (number === previous + 1) {
      previous = number;
      continue;
    }
    ranges.push([start, previous]);
    start = number;
    previous = number;
  }
  ranges.push([start, previous]);
  return ranges;
}

function frameMayUseAction(frameIndex, span) {
  if (!Array.isArray(span) || span.length < 2) return false;
  const start = Number(span[0]);
  const end = Number(span[1]);
  return Number.isFinite(start) && Number.isFinite(end) && frameIndex >= start;
}

function frameInSpan(frameIndex, span) {
  if (!Array.isArray(span) || span.length < 2) return false;
  const start = Number(span[0]);
  const end = Number(span[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return frameIndex >= Math.min(start, end) && frameIndex <= Math.max(start, end);
}

function pathPointForFrame(path, span, frameIndex) {
  if (!path.length) return null;
  const start = Number(span?.[0]);
  const end = Number(span?.[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return path[path.length - 1];
  const progress = clamp((frameIndex - start) / (end - start), 0, 1);
  return path[Math.max(0, Math.min(path.length - 1, Math.round(progress * (path.length - 1))))];
}

function isTimelinePanelVisible() {
  return state.bottomTab === "timeline" && !state.layout.collapsed.bottom;
}

function renderPlanTimeline() {
  const canvas = $("planTimeline");
  if (!canvas) return;
  if (!isTimelinePanelVisible()) return;
  const scene = state.live?.scene?.result || state.live?.scene;
  const timeline = effectiveTimeline(scene);
  const count = timelineFrameCount(scene);
  syncTimelineDropletPanelLayout(scene);
  const label = $("timelineFrameLabel");
  const liveButton = $("timelineLive");
  const playButton = $("timelinePlay");
  const pauseButton = $("timelinePause");
  const rewindButton = $("timelineRewind");
  const trimButton = $("timelineTrimTail");
  const delayInput = $("timelineFrameDelay");
  const executorToggle = $("timelineExecutorToggle");
  const stopToggle = $("timelineStopToggle");
  const executing = Boolean(scene?.executor?.is_executing || scene?.executor?.running);
  const processing = Boolean(state.matrixCommands.planning);
  const timelineControl = timelineControlStatus(scene, timeline);
  const timelinePaused = Boolean(timelineControl?.paused);
  if (liveButton) {
    liveButton.classList.toggle("active", state.timeline.followLive);
    liveButton.disabled = !count || processing;
    liveButton.textContent = state.timeline.followLive ? "Live" : "Go Live";
    liveButton.title = state.timeline.followLive
      ? "Following the executing frame"
      : "Return to the currently executing frame";
  }
  if (playButton) {
    playButton.classList.toggle("active", executing);
    playButton.disabled = !count || processing;
  }
  if (pauseButton) pauseButton.disabled = !count || processing;
  if (rewindButton) rewindButton.disabled = !count || processing;
  if (trimButton) trimButton.disabled = !canTrimTimelineTail(scene) || processing;
  if (executorToggle) {
    executorToggle.classList.toggle("active", state.timeline.executorMenuOpen || executing);
    executorToggle.disabled = processing;
    executorToggle.textContent = executing ? "Plan Executor running" : "Plan Executor";
    executorToggle.setAttribute("aria-expanded", String(state.timeline.executorMenuOpen));
  }
  if (stopToggle) {
    stopToggle.classList.toggle("active", timelinePaused);
    stopToggle.disabled = processing || (!timelineControl && !count) || timelineControl?.system_loaded === false;
    stopToggle.textContent = timelinePaused ? "Start Recording" : "Stop Recording";
    stopToggle.title = timelinePaused
      ? (timelineControl?.system_loaded === false
          ? "Recording is stopped until a DropLogic system is loaded"
          : "Resume timeline recording")
      : "Stop timeline recording without pausing hardware";
  }
  if (delayInput && document.activeElement !== delayInput) {
    const reportedDelay = Number(scene?.executor?.frame_delay);
    if (Number.isFinite(reportedDelay) && reportedDelay > 0) state.timeline.frameDelay = reportedDelay;
    delayInput.value = timelineFrameDelay().toFixed(2);
  }
  if (label) label.textContent = timelineFrameLabel(scene);

  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111216";
  ctx.fillRect(0, 0, width, height);

  const layout = timelineLayout(width, height, count, scene, timeline);
  const layoutKey = timelineLayoutCacheKey(scene, count, width, height);
  const canvasBaseKey = timelineCanvasBaseKey(scene, count, width, height);
  state.timeline.layoutCache = { key: layoutKey, layout };
  drawTimelineRuler(ctx, layout, count);
  if (!timeline?.available || !count) {
    state.timelineHitboxes = [];
    state.timelineOverlayHitboxes = [];
    updateTimelineHover(null);
    renderTimelineDropletPanel(null);
    renderTimelineRangeSelector(null);
    ctx.fillStyle = "#8e8e93";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI";
    ctx.fillText("waiting for plan frames", layout.left, Math.max(38, height / 2));
    if (processing) drawTimelineProcessing(ctx, width, height, "Processing SIPP plan...");
    return;
  }
  drawTimelineExecutedRegion(ctx, layout, scene);
  if (timelineOverlayEnabled("plan")) drawTimelineEvents(ctx, layout, timelinePlanEvents(scene, timeline, count), count);
  else state.timelineHitboxes = [];
  if (timelineOverlayEnabled("plan")) drawSelectedDropletTimeline(ctx, layout, scene);
  drawTimelineOverlays(ctx, layout, scene, timeline, count);
  drawTimelineCursor(ctx, layout, count - 1, "rgba(191, 90, 242, 0.96)", true, "planned");
  const executed = liveFrameIndex(scene);
  if (Number.isFinite(Number(executed))) {
    drawTimelineCursor(ctx, layout, Number(executed), "rgba(48, 209, 88, 0.98)", true, "executed");
  }
  if (processing) drawTimelineProcessing(ctx, width, height, "Processing SIPP plan...");
  cacheTimelineCanvasBase(canvas, ctx, layout, canvasBaseKey);
  drawTimelineDynamicCursors(ctx, layout, scene);
  renderTimelineDropletPanel(scene);
  renderTimelineRangeSelector(layout);
}

function renderTimelineOverlayMenu() {
  const menu = $("timelineOverlayMenu");
  const toggle = $("timelineOverlayToggle");
  if (!menu || !toggle) return;
  menu.hidden = !state.timeline.overlayMenuOpen;
  toggle.classList.toggle("active", state.timeline.overlayMenuOpen);
  toggle.setAttribute("aria-expanded", String(state.timeline.overlayMenuOpen));
  const activeCount = Object.values(state.timeline.overlays || {}).filter(Boolean).length;
  toggle.textContent = `Overlays ${activeCount}`;
  for (const input of menu.querySelectorAll("[data-timeline-overlay]")) {
    const key = input.getAttribute("data-timeline-overlay");
    input.checked = timelineOverlayEnabled(key);
  }
}

function renderTimelineExecutorMenu() {
  const menu = $("timelineExecutorMenu");
  const toggle = $("timelineExecutorToggle");
  if (!menu || !toggle) return;
  const scene = state.live?.scene?.result || state.live?.scene;
  const executing = Boolean(scene?.executor?.is_executing || scene?.executor?.running);
  const processing = Boolean(state.matrixCommands.planning);
  menu.hidden = !state.timeline.executorMenuOpen;
  toggle.classList.toggle("active", state.timeline.executorMenuOpen || executing);
  toggle.disabled = processing;
  toggle.textContent = executing ? "Plan Executor running" : "Plan Executor";
  toggle.setAttribute("aria-expanded", String(state.timeline.executorMenuOpen));
}

function renderTimelineRangeSelector(layout = null) {
  const selector = $("timelineRangeSelector");
  const windowEl = $("timelineRangeWindow");
  const startLabel = $("timelineRangeStart");
  const endLabel = $("timelineRangeEnd");
  if (!selector || !windowEl || !startLabel || !endLabel) return;
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!layout && count) {
    const timeline = effectiveTimeline(scene);
    const fullTimeRange = timelineDisplayTimeRange(scene, timeline, count);
    syncTimelineViewport(count, fullTimeRange);
    layout = {
      fullTimeRange,
      visibleTimeRange: timelineVisibleTimeRange(fullTimeRange),
    };
  }
  const full = layout?.fullTimeRange;
  const visible = layout?.visibleTimeRange;
  if (!count || !full?.duration || !visible?.duration) {
    selector.classList.add("disabled");
    windowEl.style.left = "0%";
    windowEl.style.width = "100%";
    startLabel.textContent = "+0s";
    endLabel.textContent = "+0s";
    return;
  }
  selector.classList.remove("disabled");
  const left = clamp((visible.start - full.start) / full.duration, 0, 1);
  const width = clamp(visible.duration / full.duration, 0, 1 - left);
  windowEl.style.left = `${left * 100}%`;
  windowEl.style.width = `${Math.max(0.2, width * 100)}%`;
  startLabel.textContent = `+${formatRelativeSeconds(visible.start - full.start)}`;
  endLabel.textContent = `+${formatRelativeSeconds(visible.end - full.start)}`;
  selector.title = `Visible range ${startLabel.textContent} to ${endLabel.textContent}`;
  windowEl.classList.toggle("dragging", Boolean(state.timeline.rangeDrag.active));
}

function startTimelineRangeDrag(event) {
  if (event.button !== 0) return;
  const track = $("timelineRangeTrack");
  if (!track || state.matrixCommands.planning) return;
  const metrics = timelineRangeSelectorMetrics();
  if (!metrics) return;
  event.preventDefault();
  track.setPointerCapture?.(event.pointerId);
  const handle = event.target.closest?.("[data-timeline-range-handle]");
  const inWindow = event.target.closest?.("#timelineRangeWindow");
  const time = timelineRangeTimeFromEvent(event, metrics);
  const mode = handle?.getAttribute("data-timeline-range-handle") || (inWindow ? "move" : "select");
  state.timeline.rangeDrag = {
    active: true,
    mode,
    pointerId: event.pointerId,
    anchorTime: time,
    start: metrics.visible.start,
    end: metrics.visible.end,
    offset: time - metrics.visible.start,
    moved: false,
  };
  if (mode === "select") {
    setTimelineVisibleRange(time, time + timelineMinVisibleDuration(metrics.full), metrics);
  }
  renderTimelineRangeSelector({ fullTimeRange: metrics.full, visibleTimeRange: metrics.visible });
}

function updateTimelineRangeDrag(event) {
  const drag = state.timeline.rangeDrag;
  if (!drag.active) return;
  const metrics = timelineRangeSelectorMetrics();
  if (!metrics) return;
  const time = timelineRangeTimeFromEvent(event, metrics);
  const minDuration = timelineMinVisibleDuration(metrics.full);
  let start = Number(drag.start);
  let end = Number(drag.end);
  if (drag.mode === "start") {
    start = clamp(time, metrics.full.start, end - minDuration);
  } else if (drag.mode === "end") {
    end = clamp(time, start + minDuration, metrics.full.end);
  } else if (drag.mode === "move") {
    const duration = Math.max(minDuration, end - start);
    start = clamp(time - Number(drag.offset || 0), metrics.full.start, metrics.full.end - duration);
    end = start + duration;
  } else {
    start = Math.min(Number(drag.anchorTime), time);
    end = Math.max(Number(drag.anchorTime), time);
    if (end - start < minDuration) {
      const center = (start + end) / 2;
      start = center - minDuration / 2;
      end = center + minDuration / 2;
    }
  }
  drag.moved = true;
  setTimelineVisibleRange(start, end, metrics);
}

function endTimelineRangeDrag(event) {
  const drag = state.timeline.rangeDrag;
  if (!drag.active) return;
  const track = $("timelineRangeTrack");
  if (event?.pointerId !== undefined && drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
  track?.releasePointerCapture?.(drag.pointerId);
  state.timeline.rangeDrag = {
    active: false,
    mode: "",
    pointerId: null,
    anchorTime: null,
    start: null,
    end: null,
    offset: 0,
    moved: false,
  };
  renderTimelineRangeSelector();
}

function timelineRangeSelectorMetrics() {
  const track = $("timelineRangeTrack");
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!track || !count) return null;
  const timeline = effectiveTimeline(scene);
  const full = timelineDisplayTimeRange(scene, timeline, count);
  syncTimelineViewport(count, full);
  return {
    track,
    rect: track.getBoundingClientRect(),
    scene,
    count,
    timeline,
    full,
    visible: timelineVisibleTimeRange(full),
  };
}

function timelineRangeTimeFromEvent(event, metrics) {
  const progress = clamp((event.clientX - metrics.rect.left) / Math.max(1, metrics.rect.width), 0, 1);
  return metrics.full.start + progress * metrics.full.duration;
}

function setTimelineVisibleRange(startTime, endTime, metricsOrScene = null) {
  const metrics = metricsOrScene?.full
    ? metricsOrScene
    : timelineRangeSelectorMetrics();
  if (!metrics?.full?.duration) return;
  const full = metrics.full;
  let start = Number(startTime);
  let end = Number(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  if (end < start) [start, end] = [end, start];
  const minDuration = timelineMinVisibleDuration(full);
  let duration = clamp(end - start, minDuration, full.duration);
  start = clamp(start, full.start, full.end - duration);
  end = start + duration;
  if (end > full.end) {
    end = full.end;
    start = Math.max(full.start, end - duration);
  }
  duration = Math.max(minDuration, end - start);
  state.timeline.followLive = false;
  markTimelineManualPreview(metrics.scene);
  state.timeline.zoom = clamp(full.duration / duration, 1, timelineMaxZoomForRange(full));
  state.timeline.timeOffset = clamp(start - full.start, 0, Math.max(0, full.duration - duration));
  schedulePlanTimelineRender();
}

function timelineOverlayEnabled(key) {
  if (!key) return false;
  return state.timeline.overlays?.[key] !== false;
}

function timelineFrameLabel(scene) {
  const count = timelineFrameCount(scene);
  if (!count) return "-";
  if (state.matrixCommands.planning) return "processing SIPP plan";
  const selected = selectedTimelineFrame(scene);
  const frameText = Number.isFinite(selected) ? `${Math.trunc(selected) + 1}/${count}` : `-/${count}`;
  const event = Number.isFinite(selected) ? timelineEventAtFrame(scene, selected) : null;
  const eventType = Array.isArray(event) ? formatTimelineEventType(event[1], event[2]) : "";
  const mode = state.timeline.followLive ? "live" : "preview";
  const time = state.timeline.followLive
    ? timelineTimeForFrameFromScene(scene, selected)
    : (timelineHasFiniteNumber(state.timeline.selectedTime) ? Number(state.timeline.selectedTime) : null);
  const range = timelineDisplayTimeRange(scene, effectiveTimeline(scene), count);
  const timeText = Number.isFinite(Number(time)) ? `+${formatRelativeSeconds(Number(time) - range.start)}` : "";
  const pausedText = timelineControlStatus(scene)?.paused ? "recording stopped" : "";
  return [mode, frameText, timeText, pausedText, eventType].filter(Boolean).join(" ");
}

function drawTimelineProcessing(ctx, width, height, text) {
  ctx.save();
  ctx.fillStyle = "rgba(5, 6, 7, 0.62)";
  ctx.fillRect(0, 0, width, height);
  const label = text || "Processing...";
  ctx.font = "700 13px -apple-system, BlinkMacSystemFont, Segoe UI";
  const labelWidth = Math.max(168, ctx.measureText(label).width + 34);
  const x = Math.max(12, (width - labelWidth) / 2);
  const y = Math.max(16, (height - 38) / 2);
  roundedRect(ctx, x, y, labelWidth, 38, 9);
  ctx.fillStyle = "rgba(18, 20, 24, 0.94)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 214, 10, 0.46)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = "#ffd60a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + labelWidth / 2, y + 19);
  ctx.restore();
}

function canTrimTimelineTail(scene) {
  if (state.matrixCommands.planning) return false;
  const count = timelineFrameCount(scene);
  if (!count || state.timeline.followLive) return false;
  const selected = selectedTimelineFrame(scene);
  if (!Number.isFinite(selected) || selected >= count - 1) return false;
  const executor = scene?.executor || {};
  if (executor.is_executing || executor.running) return false;
  const currentFrame = Number(executor.current_frame);
  if (Number.isFinite(currentFrame) && selected + 1 < currentFrame) return false;
  const applied = Number(executor.last_applied_frame?.index);
  if (Number.isFinite(applied) && selected < applied) return false;
  return true;
}

function trimTimelineTailAfterSelectedFrame() {
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!canTrimTimelineTail(scene)) return;
  const selected = selectedTimelineFrame(scene);
  if (!Number.isFinite(selected)) return;
  send({
    type: "matrix_trim_plan_tail",
    keep_frames: Math.trunc(selected) + 1,
  });
}

function timelineFrameDelay() {
  const value = Number(state.timeline.frameDelay);
  return Number.isFinite(value) && value > 0 ? clamp(value, 0.01, 60) : 1.0;
}

function commitTimelineFrameDelay() {
  const input = $("timelineFrameDelay");
  const raw = Number(input?.value);
  const delay = Number.isFinite(raw) && raw > 0 ? clamp(raw, 0.01, 60) : 1.0;
  state.timeline.frameDelay = delay;
  if (input) input.value = delay.toFixed(2);
  schedulePlanTimelineRender();
  return delay;
}

function playTimelineExecution() {
  const delay = commitTimelineFrameDelay();
  state.timeline.followLive = true;
  callTimelineExecutionTool("execute_segment_to_breakpoint", {
    frame_number: null,
    frame_delay: delay,
    wait_mode: "background",
    resume_if_paused: true,
    clear_existing_breakpoints: true,
    allow_failed_plan: false,
    enable_visualizers: false,
  });
}

function rewindTimelineExecution() {
  const delay = commitTimelineFrameDelay();
  const scene = state.live?.scene?.result || state.live?.scene;
  state.timeline.followLive = true;
  state.timeline.selectedFrame = 0;
  state.timeline.selectedTime = timelineTimeForFrameFromScene(scene, 0);
  callTimelineExecutionTool("start_plan", {
    frame_delay: delay,
    restart_from_beginning: true,
    allow_failed_plan: false,
    enable_visualizers: false,
  });
}

function callTimelineExecutionTool(tool, arguments) {
  try {
    send({ type: "mcp_tool", tool, arguments: arguments || {} });
  } catch (error) {
    appendEvent({
      ts: new Date().toISOString(),
      type: "ui_error",
      level: "warning",
      message: error?.message || String(error),
    });
  }
}

function toggleLogicalTimeline() {
  const scene = state.live?.scene?.result || state.live?.scene;
  const paused = Boolean(timelineControlStatus(scene)?.paused);
  callTimelineExecutionTool(paused ? "resume_timeline" : "pause_timeline", {
    reason: paused ? "Dashboard user resumed recording" : "Dashboard user stopped recording",
  });
}

function formatTimelineEventType(type, data = {}) {
  const displayType = String(type || "action").replace(/^(planned_|executed_)/i, "");
  const primitive = String(data?.primitive || "").toLowerCase();
  const splitMode = String(data?.split_mode || data?.mode || "").toLowerCase();
  if (primitive === "reservoir_extraction" || displayType.toLowerCase().includes("extraction")) {
    if (splitMode === "linear") return "Linear extraction";
    if (splitMode === "1to2") return "1to2 extraction";
    if (splitMode === "1to3") return "1to3 extraction";
    return "Reservoir extraction";
  }
  const raw = displayType.replace(/[_-]+/g, " ").trim();
  const normalized = raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : "Action";
  const key = raw.toLowerCase();
  if (key === "split" && splitMode) {
    if (splitMode === "linear") return "Linear extraction";
    if (splitMode === "1to2") return "1to2 extraction";
    if (splitMode === "1to3") return "1to3 extraction";
  }
  const dropletHint = data?.droplet_id !== undefined || data?.droplet_ids !== undefined;
  if (key === "create" && dropletHint) return "Create droplet";
  if (key === "delete" && dropletHint) return "Delete droplet";
  return normalized;
}

function selectedTimelineFrame(scene) {
  const count = timelineFrameCount(scene);
  if (!count) return null;
  let frame = state.timeline.followLive ? liveFrameIndex(scene) : state.timeline.selectedFrame;
  if (!timelineHasFiniteNumber(frame)) frame = state.timeline.selectedFrame;
  if (!timelineHasFiniteNumber(frame)) return null;
  return Math.trunc(clamp(Number(frame), 0, count - 1));
}

function timelineLayout(width, height, count, sceneArg = null, timelineArg = null) {
  const scene = sceneArg || state.live?.scene?.result || state.live?.scene;
  const timeline = timelineArg || effectiveTimeline(scene);
  const fullTimeRange = timelineDisplayTimeRange(scene, timeline, count);
  syncTimelineViewport(count, fullTimeRange);
  const left = Math.min(52, Math.max(34, width * 0.055));
  const right = 16;
  const top = 30;
  const bottom = 40;
  const trackWidth = Math.max(1, width - left - right);
  const laneCount = Math.max(2, Math.min(5, Math.floor((height - top - bottom) / 24)));
  const laneGap = 5;
  const laneHeight = Math.max(14, Math.min(20, (height - top - bottom - laneGap * (laneCount - 1)) / laneCount));
  const lanePitch = laneHeight + laneGap;
  const axisY = top + laneCount * lanePitch + 4;
  const visibleTimeRange = timelineVisibleTimeRange(fullTimeRange);
  const frameTimeModel = timelineFrameTimeModel(scene, timeline, count, fullTimeRange);
  const timeWarp = timelineTimeWarp(fullTimeRange, scene, timeline);
  const startFrame = timelineFrameForTimeModel(frameTimeModel, visibleTimeRange.start, count);
  const endFrame = timelineFrameForTimeModel(frameTimeModel, visibleTimeRange.end, count);
  const visibleFrames = Math.max(1, Math.min(count || 1, endFrame - startFrame + 1));
  return {
    left,
    right,
    top,
    bottom,
    trackWidth,
    laneCount,
    laneHeight,
    laneGap,
    lanePitch,
    axisY,
    width,
    height,
    count,
    visibleFrames,
    startFrame,
    endFrame,
    fullTimeRange,
    visibleTimeRange,
    frameTimeModel,
    timeWarp,
  };
}

function timelineXForFrame(layout, frame) {
  const time = timelineTimeForFrame(layout, frame);
  return timelineXForTime(layout, layout.visibleTimeRange, time);
}

function timelineFrameForX(layout, x) {
  return timelineFrameForTime(layout, timelineTimeForX(layout, x));
}

function timelineTimeForX(layout, x) {
  const range = layout?.visibleTimeRange || { start: 0, duration: 1 };
  const progress = clamp((Number(x) - layout.left) / Math.max(1, layout.trackWidth), 0, 1);
  if (layout?.timeWarp) {
    const warpedStart = timelineWarpedTimeForReal(layout.timeWarp, range.start);
    const warpedEnd = timelineWarpedTimeForReal(layout.timeWarp, range.end);
    const warpedDuration = Math.max(0.001, warpedEnd - warpedStart);
    return timelineRealTimeForWarped(layout.timeWarp, warpedStart + progress * warpedDuration);
  }
  return range.start + progress * Math.max(0.001, range.duration || 0.001);
}

function timelineTimeForFrame(layout, frame) {
  return timelineTimeForFrameModel(layout?.frameTimeModel, frame);
}

function timelineTimeForFrameFromScene(scene, frame) {
  const count = timelineFrameCount(scene);
  if (!Number.isFinite(Number(frame)) || !count) return null;
  const timeline = effectiveTimeline(scene);
  const range = timelineDisplayTimeRange(scene, timeline, count);
  return timelineTimeForFrameModel(timelineFrameTimeModel(scene, timeline, count, range), frame);
}

function timelineTimeForFrameModel(model, frame) {
  const numeric = Number(frame);
  if (!model || !Number.isFinite(numeric)) return null;
  const frameIndex = Math.max(0, numeric);
  return Number(model.start)
    + frameIndex * Math.max(0.001, Number(model.frameDelay) || 1)
    + timelinePauseOffsetForFrame(model.pauses, frameIndex, model.executedFrameIndex);
}

function timelineFrameForTime(layout, time) {
  return timelineFrameForTimeModel(layout?.frameTimeModel, time, layout?.count || 0);
}

function timelineFrameForTimeModel(model, time, count) {
  const total = Number(count);
  if (!model || !Number.isFinite(Number(time)) || !Number.isFinite(total) || total <= 0) return 0;
  let low = 0;
  let high = Math.max(0, Math.trunc(total) - 1);
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTime = timelineTimeForFrameModel(model, mid);
    if (Number(midTime) <= Number(time)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.trunc(clamp(best, 0, Math.max(0, total - 1)));
}

function timelineFrameTimeModel(scene, timeline, count, range = null) {
  const sceneDelay = Number(scene?.executor?.frame_delay);
  const delay = Number.isFinite(sceneDelay) && sceneDelay > 0 ? sceneDelay : timelineFrameDelay();
  const pauses = timelineFramePauseIntervals(scene, timeline);
  const executedFrameIndex = timelineExecutedFrameIndex(scene, count);
  const start = timelineExecutionStartTime(scene, delay, pauses, executedFrameIndex)
    ?? (Number.isFinite(Number(range?.start)) ? Number(range.start) : 0);
  const model = {
    start,
    frameDelay: delay,
    pauses,
    executedFrameIndex,
    end: start + Math.max(1, Number(count) || 1) * delay,
  };
  const lastFrame = Math.max(0, (Number(count) || 1) - 1);
  model.end = timelineTimeForFrameModel(model, lastFrame) + delay;
  return model;
}

function timelineExecutionStartTime(scene, delay, pauses = [], executedFrameIndex = null) {
  const executor = scene?.executor || {};
  const appliedIndex = Number(executor?.last_applied_frame?.index);
  const appliedAt = timelineSecondsFromValue(executor?.last_applied_frame?.applied_at);
  if (Number.isFinite(appliedIndex) && Number.isFinite(appliedAt)) {
    if (!timelineTimeBelongsToRun(appliedAt)) return null;
    return appliedAt
      - Math.max(0, appliedIndex) * Math.max(0.001, delay || 1)
      - timelinePauseOffsetForFrame(pauses, appliedIndex, appliedIndex);
  }
  const lastIndex = Number(executor?.last_frame?.index);
  const lastAt = timelineSecondsFromValue(executor?.last_frame?.started_at)
    ?? timelineSecondsFromValue(executor?.last_frame?.finished_at);
  if (Number.isFinite(lastIndex) && Number.isFinite(lastAt)) {
    if (!timelineTimeBelongsToRun(lastAt)) return null;
    return lastAt
      - Math.max(0, lastIndex) * Math.max(0.001, delay || 1)
      - timelinePauseOffsetForFrame(pauses, lastIndex, Number.isFinite(Number(executedFrameIndex)) ? executedFrameIndex : lastIndex);
  }
  const hasExecutorPlan = Boolean(executor?.is_executing || executor?.running)
    || (timelineHasFiniteNumber(executor?.total_frames) && Number(executor.total_frames) > 0)
    || (timelineHasFiniteNumber(executor?.current_frame) && Number(executor.current_frame) > 0);
  if (!hasExecutorPlan) return null;
  for (const event of [...timelineActiveRunEvents()].reverse()) {
    if (event?.type !== "mcp_tool_call") continue;
    if (!["start_plan", "execute_segment_to_breakpoint"].includes(String(event.tool || ""))) continue;
    const time = eventTimeSeconds(event);
    if (Number.isFinite(time)) return time;
  }
  return null;
}

function timelineExecutedFrameIndex(scene, count = timelineFrameCount(scene)) {
  if (!timelineExecutorBelongsToRun(scene) && !timelineHasExecutionEventsThisRun()) return null;
  const total = Number(count);
  const maxFrame = Number.isFinite(total) && total > 0 ? Math.max(0, Math.trunc(total) - 1) : Infinity;
  const executor = scene?.executor || {};
  const candidates = [
    executor?.last_applied_frame?.index,
    Number.isFinite(Number(executor?.frames_executed)) ? Number(executor.frames_executed) - 1 : null,
    scene?.frame?.index,
    Number.isFinite(Number(executor?.current_frame)) ? Number(executor.current_frame) - 1 : null,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) {
      return Math.trunc(clamp(number, 0, maxFrame));
    }
  }
  return null;
}

function timelineRunStartTime() {
  const events = state.events || [];
  const explicit = events.find((event) => event?.type === "cockpit_run_created" || event?.type === "cockpit_started");
  const first = explicit || events[0];
  const time = eventTimeSeconds(first);
  return Number.isFinite(time) ? time : null;
}

function timelineTimeBelongsToRun(time) {
  const start = timelineRunStartTime();
  if (!Number.isFinite(start) || !Number.isFinite(Number(time))) return true;
  return Number(time) >= start - 0.5;
}

function timelineHasExecutionEventsThisRun() {
  return timelineActiveRunEvents().some((event) => (
    (event?.type === "mcp_tool_result" || event?.type === "dashboard_tool_result")
    && timelineToolIsExecution(String(event.tool || "").toLowerCase())
  ));
}

function timelineExecutorBelongsToRun(scene) {
  const executor = scene?.executor || {};
  const times = [
    timelineSecondsFromValue(executor?.last_applied_frame?.applied_at),
    timelineSecondsFromValue(executor?.last_frame?.started_at),
    timelineSecondsFromValue(executor?.last_frame?.finished_at),
  ].filter(Number.isFinite);
  if (!times.length) return timelineHasExecutionEventsThisRun();
  return times.some((time) => timelineTimeBelongsToRun(time));
}

function timelineFramePauseIntervals(scene, timeline = null) {
  const control = timelineControlStatus(scene, timeline);
  const intervals = Array.isArray(control?.intervals) ? control.intervals : [];
  return intervals
    .map((interval) => ({
      afterFrameIndex: Number(interval?.after_frame_index),
      durationSeconds: Number(interval?.duration_seconds),
    }))
    .filter((interval) => (
      Number.isFinite(interval.afterFrameIndex)
      && Number.isFinite(interval.durationSeconds)
      && interval.durationSeconds > 0
    ))
    .sort((a, b) => a.afterFrameIndex - b.afterFrameIndex);
}

function timelinePauseOffsetForFrame(pauses, frame, executedFrameIndex = Infinity) {
  const frameIndex = Number(frame);
  if (!Number.isFinite(frameIndex) || !Array.isArray(pauses)) return 0;
  const executedCap = Number(executedFrameIndex);
  return pauses.reduce((sum, pause) => {
    const afterFrameIndex = Number(pause?.afterFrameIndex);
    const duration = Number(pause?.durationSeconds);
    if (!Number.isFinite(afterFrameIndex) || !Number.isFinite(duration) || duration <= 0) return sum;
    if (Number.isFinite(executedCap) && afterFrameIndex >= executedCap) return sum;
    return frameIndex > afterFrameIndex ? sum + duration : sum;
  }, 0);
}

function timelineSecondsFromValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

function timelineDisplayTimeRange(scene, timeline, count) {
  const overlayRange = timelineOverlayTimeRange(scene);
  const times = [];
  if (Number.isFinite(Number(overlayRange.start))) times.push(Number(overlayRange.start));
  if (Number.isFinite(Number(overlayRange.end))) times.push(Number(overlayRange.end));
  const model = timelineFrameTimeModel(scene, timeline, count, overlayRange);
  if (Number.isFinite(Number(model.start))) {
    times.push(Number(model.start));
    times.push(Number(model.end));
  }
  if (!times.length) return { start: 0, end: 1, duration: 1 };
  const start = Math.min(...times);
  let end = Math.max(...times);
  if (!Number.isFinite(end) || end <= start) end = start + 1;
  return { start, end, duration: Math.max(0.001, end - start) };
}

function timelineTimeWarp(range, scene = null, timeline = null) {
  const start = Number(range?.start);
  const end = Number(range?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { start: 0, end: 1, segments: [], compressedDuration: 1 };
  }
  const cacheKey = [
    timelineDataCacheKey(scene),
    Number(start).toFixed(3),
    Number(end).toFixed(3),
  ].join("|");
  if (state.timeline.timeWarpCache.key === cacheKey && state.timeline.timeWarpCache.data) {
    return state.timeline.timeWarpCache.data;
  }
  const telemetryTail = timelineTelemetryTailRange(scene);
  const anchors = timelineSemanticTimes(scene, timeline, range)
    .filter((time) => Number.isFinite(Number(time)))
    .map(Number)
    .filter((time) => time >= start && time <= end)
    .sort((a, b) => a - b);
  if (!anchors.length || anchors[0] > start) anchors.unshift(start);
  if (anchors[anchors.length - 1] < end) anchors.push(end);
  const unique = [];
  for (const time of anchors) {
    if (!unique.length || Math.abs(time - unique[unique.length - 1]) > 0.5) unique.push(time);
  }
  const segments = [];
  let warpedCursor = start;
  for (let index = 0; index < unique.length - 1; index += 1) {
    const realStart = unique[index];
    const realEnd = unique[index + 1];
    const realDuration = Math.max(0.001, realEnd - realStart);
    const inTelemetryTail = telemetryTail
      && realStart >= Number(telemetryTail.start) - 0.5
      && realEnd <= Number(telemetryTail.end) + 0.5;
    const idle = !inTelemetryTail && realDuration >= TIMELINE_IDLE_GAP_SECONDS;
    const warpedDuration = idle ? Math.min(TIMELINE_IDLE_GAP_VISIBLE_SECONDS, realDuration) : realDuration;
    segments.push({
      realStart,
      realEnd,
      realDuration,
      warpedStart: warpedCursor,
      warpedEnd: warpedCursor + warpedDuration,
      warpedDuration,
      idle,
    });
    warpedCursor += warpedDuration;
  }
  const warp = {
    start,
    end,
    segments,
    compressedDuration: Math.max(0.001, warpedCursor - start),
  };
  state.timeline.timeWarpCache = { key: cacheKey, data: warp };
  return warp;
}

function timelineSemanticTimes(scene = null, timeline = null, range = null) {
  const cacheKey = [
    timelineDataCacheKey(scene),
    Number.isFinite(Number(range?.start)) ? Number(range.start).toFixed(3) : "",
    Number.isFinite(Number(range?.end)) ? Number(range.end).toFixed(3) : "",
  ].join("|");
  if (state.timeline.semanticTimesCache.key === cacheKey && state.timeline.semanticTimesCache.data) {
    return state.timeline.semanticTimesCache.data;
  }
  const times = [];
  const push = (value) => {
    const number = Number(value);
    if (Number.isFinite(number)) times.push(number);
  };
  const runStart = timelineRunStartTime();
  push(runStart);
  const activePlanEvents = new Set(timelineActiveRunEvents());
  for (const event of state.events || []) {
    if (timelineEventIsSemantic(event)) push(eventTimeSeconds(event));
    const markerTime = timelineToolExecutionStartTime(event) ?? eventTimeSeconds(event);
    if (activePlanEvents.has(event) && timelineToolIsPlanOrExecution(String(event?.tool || "").toLowerCase())) push(markerTime);
  }
  for (const marker of timelineStageMarkers(scene)) push(marker.time);
  for (const marker of timelinePhotoMarkers(scene)) push(marker.time);
  for (const marker of timelineTargetTemperatureMarkers(scene)) push(marker.time);
  const telemetryTail = timelineTelemetryTailRange(scene);
  if (telemetryTail) {
    push(telemetryTail.start);
    push(telemetryTail.end);
  }
  for (const marker of timelineStopMarkers(scene, timeline)) {
    push(marker.startTime);
    push(marker.endTime);
  }
  if (range) {
    push(range.start);
    push(range.end);
  }
  state.timeline.semanticTimesCache = { key: cacheKey, data: times };
  return times;
}

function timelineEventIsSemantic(event) {
  const type = String(event?.type || "").toLowerCase();
  const tool = String(event?.tool || "").toLowerCase();
  if (!event) return false;
  if (timelineToolIsPlanOrExecution(tool)) return true;
  if (tool === "move_stage" || tool.includes("capture") || tool.includes("photo") || tool.includes("image")) return true;
  if (/photo|capture|snapshot|stage_position|calibration_move|preset_applied|timeline_|goal_|matrix_/.test(type)) return true;
  if (targetTemperatureFromEvent(event) !== null) return true;
  if (stagePositionFromEvent(event) || photoInfoFromEvent(event)) return true;
  return false;
}

function timelineWarpSegmentForTime(warp, time) {
  if (!warp?.segments?.length || !Number.isFinite(Number(time))) return null;
  const numeric = Number(time);
  return warp.segments.find((segment) => numeric >= segment.realStart && numeric <= segment.realEnd)
    || (numeric < warp.start ? warp.segments[0] : warp.segments[warp.segments.length - 1]);
}

function timelineWarpedTimeForReal(warp, time) {
  if (!warp?.segments?.length || !Number.isFinite(Number(time))) return Number(time);
  const numeric = Number(time);
  if (numeric <= warp.start) return warp.start;
  if (numeric >= warp.end) {
    const last = warp.segments[warp.segments.length - 1];
    return last ? last.warpedEnd : numeric;
  }
  const segment = timelineWarpSegmentForTime(warp, numeric);
  if (!segment) return numeric;
  const progress = clamp((numeric - segment.realStart) / Math.max(0.001, segment.realDuration), 0, 1);
  return segment.warpedStart + progress * segment.warpedDuration;
}

function timelineRealTimeForWarped(warp, warpedTime) {
  if (!warp?.segments?.length || !Number.isFinite(Number(warpedTime))) return Number(warpedTime);
  const numeric = Number(warpedTime);
  if (numeric <= warp.start) return warp.start;
  const last = warp.segments[warp.segments.length - 1];
  if (last && numeric >= last.warpedEnd) return warp.end;
  const segment = warp.segments.find((item) => numeric >= item.warpedStart && numeric <= item.warpedEnd) || last;
  if (!segment) return numeric;
  const progress = clamp((numeric - segment.warpedStart) / Math.max(0.001, segment.warpedDuration), 0, 1);
  return segment.realStart + progress * segment.realDuration;
}

function timelineVisibleTimeRange(range) {
  const full = range || { start: 0, end: 1, duration: 1 };
  const duration = Math.max(0.001, Number(full.duration) || 0.001);
  const zoom = clamp(Number(state.timeline.zoom) || 1, 1, timelineMaxZoomForRange(full));
  const visibleDuration = clamp(duration / zoom, timelineMinVisibleDuration(full), duration);
  const maxOffset = Math.max(0, duration - visibleDuration);
  const offset = clamp(Number(state.timeline.timeOffset) || 0, 0, maxOffset);
  return {
    start: Number(full.start) + offset,
    end: Number(full.start) + offset + visibleDuration,
    duration: visibleDuration,
    offset,
  };
}

function timelineMinVisibleDuration(range) {
  const duration = Math.max(0.001, Number(range?.duration) || 0.001);
  return Math.min(duration, TIMELINE_MIN_VISIBLE_SECONDS);
}

function timelineMaxZoomForRange(range) {
  const duration = Math.max(0.001, Number(range?.duration) || 0.001);
  return Math.max(1, duration / timelineMinVisibleDuration(range));
}

function timelineVisibleFrames(count) {
  if (!count) return 1;
  const zoom = clamp(Number(state.timeline.zoom) || 1, 1, 80);
  return Math.max(1, Math.ceil(count / zoom));
}

function syncTimelineViewport(count, range = null) {
  state.timeline.zoom = clamp(Number(state.timeline.zoom) || 1, 1, range ? timelineMaxZoomForRange(range) : 80);
  if (range?.duration) {
    const duration = Math.max(0.001, Number(range.duration) || 0.001);
    const visibleDuration = clamp(duration / state.timeline.zoom, timelineMinVisibleDuration(range), duration);
    state.timeline.timeOffset = clamp(Number(state.timeline.timeOffset) || 0, 0, Math.max(0, duration - visibleDuration));
  }
  const visible = timelineVisibleFrames(count);
  const maxOffset = Math.max(0, count - visible);
  state.timeline.offsetFrame = clamp(Number(state.timeline.offsetFrame) || 0, 0, maxOffset);
}

function panTimelineFrames(deltaFrames) {
  const count = timelineFrameCount(state.live?.scene?.result || state.live?.scene);
  if (!count) return;
  const scene = state.live?.scene?.result || state.live?.scene;
  const delay = timelineFrameTimeModel(scene, effectiveTimeline(scene), count).frameDelay;
  panTimelineTime(deltaFrames * delay);
}

function panTimelineTime(deltaSeconds) {
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!count) return;
  const range = timelineDisplayTimeRange(scene, effectiveTimeline(scene), count);
  state.timeline.followLive = false;
  markTimelineManualPreview(scene);
  syncTimelineViewport(count, range);
  const visible = timelineVisibleTimeRange(range);
  const maxOffset = Math.max(0, range.duration - visible.duration);
  state.timeline.timeOffset = clamp((Number(state.timeline.timeOffset) || 0) + Number(deltaSeconds || 0), 0, maxOffset);
  schedulePlanTimelineRender();
}

function zoomTimelineAtEvent(event) {
  const canvas = $("planTimeline");
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!canvas || !count) return;
  state.timeline.followLive = false;
  markTimelineManualPreview(scene);
  const rect = canvas.getBoundingClientRect();
  const oldLayout = timelineLayout(rect.width || canvas.clientWidth || 1, rect.height || canvas.clientHeight || 1, count, scene);
  const cursorTime = timelineTimeForX(oldLayout, event.clientX - rect.left);
  const direction = event.deltaY < 0 ? 1 : -1;
  const factor = direction > 0 ? 1.25 : 0.8;
  const range = oldLayout.fullTimeRange || timelineDisplayTimeRange(scene, effectiveTimeline(scene), count);
  const maxZoom = timelineMaxZoomForRange(range);
  const oldZoom = clamp(Number(state.timeline.zoom) || 1, 1, maxZoom);
  const newZoom = clamp(oldZoom * factor, 1, maxZoom);
  if (Math.abs(newZoom - oldZoom) < 0.001) return;
  state.timeline.zoom = newZoom;
  const visibleDuration = clamp(range.duration / newZoom, timelineMinVisibleDuration(range), range.duration);
  const cursorRatio = clamp((event.clientX - rect.left - oldLayout.left) / oldLayout.trackWidth, 0, 1);
  const maxOffset = Math.max(0, range.duration - visibleDuration);
  state.timeline.timeOffset = clamp(cursorTime - range.start - cursorRatio * visibleDuration, 0, maxOffset);
  schedulePlanTimelineRender();
}

function zoomTimelineButton(factor) {
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!count) return;
  state.timeline.followLive = false;
  markTimelineManualPreview(scene);
  const timeline = effectiveTimeline(scene);
  const range = timelineDisplayTimeRange(scene, timeline, count);
  const visible = timelineVisibleTimeRange(range);
  const focus = timelineHasFiniteNumber(state.timeline.selectedTime)
    ? Number(state.timeline.selectedTime)
    : visible.start + visible.duration / 2;
  const maxZoom = timelineMaxZoomForRange(range);
  const oldZoom = clamp(Number(state.timeline.zoom) || 1, 1, maxZoom);
  const newZoom = clamp(oldZoom * factor, 1, maxZoom);
  if (Math.abs(newZoom - oldZoom) < 0.001) return;
  state.timeline.zoom = newZoom;
  const visibleDuration = clamp(range.duration / newZoom, timelineMinVisibleDuration(range), range.duration);
  const maxOffset = Math.max(0, range.duration - visibleDuration);
  state.timeline.timeOffset = clamp(focus - range.start - visibleDuration / 2, 0, maxOffset);
  schedulePlanTimelineRender();
}

function drawTimelineRuler(ctx, layout, count) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 1;
  for (let lane = 0; lane < layout.laneCount; lane += 1) {
    const y = layout.top + lane * layout.lanePitch;
    roundedRect(ctx, layout.left, y, layout.trackWidth, layout.laneHeight, 4);
    ctx.fillStyle = lane % 2 ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.04)";
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(layout.left, layout.axisY);
  ctx.lineTo(layout.left + layout.trackWidth, layout.axisY);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.stroke();

  ctx.fillStyle = "#8e8e93";
  ctx.font = "10px -apple-system, BlinkMacSystemFont, Segoe UI";
  const pxPerFrame = layout.trackWidth / Math.max(1, layout.visibleFrames - 1);
  if (pxPerFrame >= 7) {
    ctx.strokeStyle = "rgba(255,255,255,0.075)";
    const first = Math.ceil(layout.startFrame);
    const last = Math.floor(layout.endFrame);
    for (let frame = first; frame <= last; frame += 1) {
      const x = timelineXForFrame(layout, frame);
      ctx.beginPath();
      ctx.moveTo(x, layout.top - 3);
      ctx.lineTo(x, layout.axisY + 4);
      ctx.stroke();
    }
  }
  const divisions = Math.min(8, Math.max(2, Math.floor(layout.trackWidth / 120)));
  for (let tick = 0; tick <= divisions; tick += 1) {
    const frame = Math.round(layout.startFrame + Math.max(0, layout.visibleFrames - 1) * (tick / divisions));
    const x = timelineXForFrame(layout, frame);
    ctx.beginPath();
    ctx.moveTo(x, layout.axisY - 4);
    ctx.lineTo(x, layout.axisY + 5);
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.stroke();
    ctx.fillText(String(frame + 1), x - 5, layout.axisY + 15);
  }
  ctx.restore();
}

function drawTimelineTimeCursor(ctx, layout, time, color, primary = true, label = "") {
  const numeric = Number(time);
  const range = layout?.visibleTimeRange;
  if (!range || !Number.isFinite(numeric) || numeric < range.start || numeric > range.end) return;
  const x = timelineXForTime(layout, range, numeric);
  if (!Number.isFinite(x)) return;
  ctx.save();
  const top = layout.top - 11;
  const bottom = Math.min(layout.height - 8, layout.axisY + 18);
  if (primary) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
  }
  ctx.beginPath();
  ctx.moveTo(x, top + (primary ? 7 : 0));
  ctx.lineTo(x, bottom);
  ctx.stroke();
  if (primary) {
    roundedRect(ctx, x - 5, top, 10, 14, 5);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(5, 6, 7, 0.88)";
    ctx.fillRect(x - 1, top + 3, 2, 8);
  }
  if (label) {
    ctx.shadowBlur = 0;
    ctx.font = "9px -apple-system, BlinkMacSystemFont, Segoe UI";
    const textWidth = ctx.measureText(label).width + 10;
    const lx = clamp(x - textWidth / 2, layout.left, layout.left + layout.trackWidth - textWidth);
    const ly = Math.max(3, top - 16);
    roundedRect(ctx, lx, ly, textWidth, 14, 5);
    ctx.fillStyle = "rgba(5, 6, 7, 0.78)";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(label, lx + 5, ly + 7);
  }
  ctx.restore();
}

function timelineHasFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function drawTimelineExecutedRegion(ctx, layout, scene) {
  const liveFrame = liveFrameIndex(scene);
  if (!Number.isFinite(Number(liveFrame))) return;
  const visibleLiveFrame = clamp(Number(liveFrame), layout.startFrame, layout.endFrame);
  const x = timelineXForFrame(layout, visibleLiveFrame);
  if (Number(liveFrame) < layout.startFrame) return;
  ctx.save();
  ctx.fillStyle = "rgba(48, 209, 88, 0.08)";
  ctx.fillRect(layout.left, layout.top - 5, Math.max(0, x - layout.left), Math.max(1, layout.axisY - layout.top + 9));
  ctx.restore();
}

function drawTimelineEvents(ctx, layout, events, count) {
  const hitboxes = [];
  ctx.save();
  const selectedDropletId = selectedTimelineDropletId();
  events.forEach((event, index) => {
    const times = timelineVisualEventTimes(event, layout, count);
    if (!times) return;
    const { startTime, endTime, eventStartFrame, eventEndFrame } = times;
    if (!Number.isFinite(Number(startTime)) || !Number.isFinite(Number(endTime))) return;
    const visibleRange = layout.visibleTimeRange || { start: 0, end: 1, duration: 1 };
    if (Number(endTime) < visibleRange.start || Number(startTime) > visibleRange.end) return;
    const lane = index % layout.laneCount;
    const clippedStartTime = clamp(Number(startTime), visibleRange.start, visibleRange.end);
    const clippedEndTime = clamp(Number(endTime), visibleRange.start, visibleRange.end);
    const x0 = timelineXForTime(layout, visibleRange, clippedStartTime);
    const x1 = timelineXForTime(layout, visibleRange, clippedEndTime);
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) return;
    const y = layout.top + lane * layout.lanePitch;
    const singleFrame = eventStartFrame === eventEndFrame || event.time_based;
    const visualW = Math.max(1.5, x1 - x0);
    const hitW = Math.max(singleFrame ? 7 : 5, visualW);
    const clippedW = Math.min(visualW, layout.left + layout.trackWidth - x0);
    const rect = {
      x: x0,
      y: y + 2,
      w: Math.min(hitW, layout.left + layout.trackWidth - x0),
      h: layout.laneHeight - 4,
    };
    const selected = selectedDropletId !== null && timelineEventMentionsDroplet(event, selectedDropletId);
    hitboxes.push({
      ...rect,
      z: 10,
      event,
      label: formatTimelineEventType(event.type, event.data),
    });
    roundedRect(ctx, x0, y + 2, clippedW, layout.laneHeight - 4, 4);
    ctx.fillStyle = timelineEventColor(event.type, selected ? 0.98 : 0.86);
    ctx.fill();
    ctx.strokeStyle = selected ? "rgba(255, 255, 255, 0.88)" : timelineEventColor(event.type, 1);
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();
    if (selected) {
      ctx.save();
      ctx.shadowColor = "rgba(255, 214, 10, 0.52)";
      ctx.shadowBlur = 10;
      roundedRect(ctx, x0, y + 2, clippedW, layout.laneHeight - 4, 4);
      ctx.strokeStyle = "rgba(255, 214, 10, 0.88)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    const markerX = x0 + Math.max(1.5, clippedW) / 2;
    if (visualW < 6 || clippedW < 6) {
      ctx.save();
      ctx.shadowColor = timelineEventColor(event.type, 0.5);
      ctx.shadowBlur = selected ? 9 : 5;
      ctx.strokeStyle = selected ? "rgba(255, 214, 10, 0.95)" : timelineEventColor(event.type, 1);
      ctx.fillStyle = selected ? "rgba(255, 214, 10, 0.95)" : timelineEventColor(event.type, 1);
      ctx.lineWidth = selected ? 2 : 1.4;
      ctx.beginPath();
      ctx.moveTo(markerX, y - 5);
      ctx.lineTo(markerX, y + layout.laneHeight + 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(markerX, y - 7);
      ctx.lineTo(markerX + 4, y - 3);
      ctx.lineTo(markerX, y + 1);
      ctx.lineTo(markerX - 4, y - 3);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(5, 6, 7, 0.9)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    } else if (singleFrame) {
      ctx.beginPath();
      ctx.moveTo(markerX, y - 2);
      ctx.lineTo(markerX - 4, y + 5);
      ctx.lineTo(markerX + 4, y + 5);
      ctx.closePath();
      ctx.fillStyle = timelineEventColor(event.type, 1);
      ctx.fill();
    }
    if (clippedW > 54) {
      ctx.save();
      ctx.beginPath();
      roundedRect(ctx, x0, y + 2, clippedW, layout.laneHeight - 4, 4);
      ctx.clip();
      ctx.fillStyle = "#050607";
      ctx.font = "10px -apple-system, BlinkMacSystemFont, Segoe UI";
      ctx.fillText(formatTimelineEventType(event.type, event.data), x0 + 6, y + layout.laneHeight / 2 + 3);
      ctx.restore();
    }
  });
  ctx.restore();
  state.timelineHitboxes = hitboxes;
}

function timelineVisualEventTimes(event, layout, count) {
  const explicitStart = timelineHasFiniteNumber(event?.start_time) ? Number(event.start_time) : null;
  const explicitEnd = timelineHasFiniteNumber(event?.end_time) ? Number(event.end_time) : null;
  const hasExplicitTime = Number.isFinite(explicitStart);
  const span = event?.frame_span;
  let startFrame = null;
  let endFrame = null;
  if (Array.isArray(span) && span.length >= 2) {
    const start = clamp(Number(span[0]), 0, Math.max(0, count - 1));
    const end = clamp(Number(span[1]), 0, Math.max(0, count - 1));
    if (Number.isFinite(start) && Number.isFinite(end)) {
      startFrame = Math.min(start, end);
      endFrame = Math.max(start, end);
    }
  }
  if (hasExplicitTime) {
    const duration = Number.isFinite(explicitEnd)
      ? Math.max(0.25, explicitEnd - explicitStart)
      : Math.max(0.25, Number(event?.duration_seconds) || 0.25);
    return {
      startTime: explicitStart,
      endTime: explicitStart + duration,
      eventStartFrame: Number.isFinite(startFrame) ? startFrame : 0,
      eventEndFrame: Number.isFinite(endFrame) ? endFrame : startFrame ?? 0,
    };
  }
  if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame)) return null;
  return {
    startTime: timelineTimeForFrame(layout, startFrame),
    endTime: timelineEventEndTime(layout, startFrame, endFrame),
    eventStartFrame: startFrame,
    eventEndFrame: endFrame,
  };
}

function timelinePlanEvents(scene, timeline, count) {
  const executedFrame = timelineExecutedFrameIndex(scene, count);
  const events = (timeline?.events || [])
    .map((event) => timelinePlanActionMarker(event, executedFrame))
    .filter(Boolean);
  const seen = new Set(events.map((event) => `plan:${event?.id || event?.event_id || event?.label || ""}:${event?.frame_span?.join("-") || ""}`));
  const hasPlanPrimitiveEvents = events.length > 0;
  for (const runEvent of timelineActiveRunEvents()) {
    const marker = timelineToolMarkerFromRunEvent(runEvent, count, {
      includeToolMarkers: !hasPlanPrimitiveEvents,
    });
    if (!marker) continue;
    const key = `run:${marker.id}:${marker.frame_span?.join("-") || ""}:${marker.start_time || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(marker);
  }
  return events;
}

function timelinePlanActionMarker(event, executedFrame) {
  if (!event) return null;
  const span = event?.frame_span;
  const type = String(event.type || "action");
  let executionState = "planned";
  if (Array.isArray(span) && span.length >= 2 && Number.isFinite(Number(executedFrame))) {
    const start = Math.min(Number(span[0]), Number(span[1]));
    const end = Math.max(Number(span[0]), Number(span[1]));
    if (Number.isFinite(end) && end <= Number(executedFrame)) executionState = "executed";
    else if (Number.isFinite(start) && start <= Number(executedFrame)) executionState = "executing";
  }
  return {
    ...event,
    type: executionState === "planned" ? `planned_${type}` : type,
    execution_state: executionState,
    planned_preview: executionState === "planned",
  };
}

function timelineToolMarkerFromRunEvent(event, count, options = {}) {
  if (options.includeToolMarkers === false) return null;
  if (event?.type !== "mcp_tool_result" && event?.type !== "dashboard_tool_result") return null;
  const tool = String(event?.tool || "").toLowerCase();
  if (!timelineToolIsPlanOrExecution(tool)) return null;
  const frame = timelineToolEventFrame(event);
  if (!Number.isFinite(frame) || !Number.isFinite(count) || count <= 0) return null;
  const bounded = Math.trunc(clamp(frame, 0, count - 1));
  const span = timelineToolEventFrameSpan(event, bounded, count);
  const toolTime = timelineToolEventTimeSpan(event, tool);
  return {
    id: `run-${event.t || event.ts || ""}-${tool}`,
    type: timelineToolIsExecution(tool) ? "execution_tool" : "plan_tool",
    label: formatTimelineEventType(tool),
    frame_span: span,
    frame_count: Math.max(1, Math.abs(span[1] - span[0]) + 1),
    start_time: toolTime.start,
    end_time: toolTime.end,
    duration_seconds: toolTime.duration,
    time_based: true,
    droplet_ids: timelineToolEventDropletIds(event),
    data: {
      tool,
      ok: event.ok,
      via: event.via,
      frame_idx: bounded,
      ...(event.arguments && typeof event.arguments === "object" ? event.arguments : {}),
    },
    run_event: event,
  };
}

function timelineToolIsExecution(tool) {
  return [
    "start_plan",
    "resume_plan",
    "execute_segment_to_breakpoint",
    "start_execute_until_breakpoint",
    "execute_until_breakpoint",
    "execution_wait_status",
    "pause_plan",
    "stop_plan",
  ].includes(String(tool || "").toLowerCase());
}

function timelineToolEventTimeSpan(event, tool) {
  const eventTime = eventTimeSeconds(event);
  const duration = firstFiniteNumber(
    getPath(event, "dashboard_timing.tool_total_seconds"),
    getPath(event, "result.elapsed_seconds"),
    getPath(event, "result.wait_status.elapsed_seconds"),
    getPath(event, "result.structuredContent.result.wait_status.elapsed_seconds"),
    timelineToolIsExecution(tool) ? timelineExecutionDurationFromEvent(event) : null,
  );
  const safeDuration = Number.isFinite(duration) && duration > 0 ? Number(duration) : 0.35;
  const start = timelineToolIsExecution(tool)
    ? (Number.isFinite(eventTime) ? Math.max(timelineRunStartTime() ?? -Infinity, eventTime - safeDuration) : null)
    : eventTime;
  const end = Number.isFinite(eventTime)
    ? eventTime
    : (Number.isFinite(start) ? start + safeDuration : null);
  return {
    start: Number.isFinite(start) ? start : null,
    end: Number.isFinite(end) ? Math.max(end, Number(start) + 0.25) : null,
    duration: safeDuration,
  };
}

function timelineToolExecutionStartTime(event) {
  const tool = String(event?.tool || "").toLowerCase();
  if (!timelineToolIsExecution(tool)) return null;
  return timelineToolEventTimeSpan(event, tool).start;
}

function timelineExecutionDurationFromEvent(event) {
  const roots = eventPayloadRoots(event);
  for (const root of roots) {
    const frameDelay = firstFiniteNumber(
      getPath(root, "wait_estimate.frame_delay"),
      getPath(root, "execution_status.frame_delay"),
      getPath(root, "executor_status.frame_delay"),
      getPath(root, "executor.frame_delay"),
    );
    const remaining = firstFiniteNumber(
      getPath(root, "wait_estimate.remaining_frames"),
      getPath(root, "remaining_frames"),
    );
    if (Number.isFinite(frameDelay) && Number.isFinite(remaining)) {
      return Math.max(0, Number(frameDelay) * Number(remaining));
    }
  }
  return null;
}

function timelineToolIsPlanOrExecution(tool) {
  return [
    "plan_activation_frame",
    "plan_move",
    "plan_reservoir_extraction",
    "plan_isometric_split",
    "plan_mix",
    "plan_merge",
    "trim_plan_tail",
    "start_plan",
    "resume_plan",
    "execute_segment_to_breakpoint",
    "start_execute_until_breakpoint",
    "execute_until_breakpoint",
    "execution_wait_status",
    "pause_plan",
    "stop_plan",
  ].includes(tool);
}

function timelineToolEventFrame(event) {
  const roots = eventPayloadRoots(event);
  for (const root of roots) {
    const frame = firstFiniteNumber(
      getPath(root, "executor.last_frame.index"),
      getPath(root, "executor_status.last_frame.index"),
      getPath(root, "wait_status.executor_status.last_frame.index"),
      getPath(root, "status.executor.last_frame.index"),
      getPath(root, "status.executor_status.last_frame.index"),
      getPath(root, "frame.index"),
      getPath(root, "frame_idx"),
      getPath(root, "frame_index"),
      getPath(root, "target_frame"),
      getPath(root, "plan.frame_count") !== undefined ? Number(getPath(root, "plan.frame_count")) - 1 : null,
      getPath(root, "failed_plan.frame_count") !== undefined ? Number(getPath(root, "failed_plan.frame_count")) - 1 : null,
    );
    if (Number.isFinite(frame)) return frame;
  }
  const argFrame = firstFiniteNumber(event?.arguments?.frame_number, event?.arguments?.frame_idx, event?.arguments?.frame_index);
  if (Number.isFinite(argFrame)) return event?.arguments?.frame_number !== undefined ? Number(argFrame) : Number(argFrame);
  return eventFrameIndex(event);
}

function timelineToolEventFrameSpan(event, frame, count) {
  const roots = eventPayloadRoots(event);
  for (const root of roots) {
    const rawSpan = getPath(root, "frame_span") || getPath(root, "result.frame_span");
    if (Array.isArray(rawSpan) && rawSpan.length >= 2) {
      const start = Number(rawSpan[0]);
      const end = Number(rawSpan[1]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        return [
          Math.trunc(clamp(Math.min(start, end), 0, count - 1)),
          Math.trunc(clamp(Math.max(start, end), 0, count - 1)),
        ];
      }
    }
  }
  const startFrame = firstFiniteNumber(
    getPath(event, "result.executor_status.current_frame"),
    getPath(event, "result.status.executor_status.current_frame"),
  );
  const start = Number.isFinite(startFrame) ? Math.min(frame, Number(startFrame)) : frame;
  return [
    Math.trunc(clamp(start, 0, count - 1)),
    Math.trunc(clamp(frame, 0, count - 1)),
  ];
}

function timelineToolEventDropletIds(event) {
  const ids = new Set();
  collectDropletIds(event?.arguments || {}, ids);
  collectDropletIds(event?.result || {}, ids);
  return Array.from(ids).sort((a, b) => a - b);
}

function timelineEventEndTime(layout, startFrame, endFrame) {
  const model = layout?.frameTimeModel;
  const eventStart = Number(startFrame);
  const eventEnd = Number(endFrame);
  if (!model || !Number.isFinite(eventStart) || !Number.isFinite(eventEnd)) return null;
  const startTime = timelineTimeForFrameModel(model, eventStart);
  const frameDelay = Math.max(0.001, Number(model.frameDelay) || 1);
  const frameCount = Math.max(1, Math.abs(eventEnd - eventStart) + 1);
  return Number(startTime) + frameCount * frameDelay;
}

function drawTimelineOverlays(ctx, layout, scene, timeline, count) {
  const overlays = timelineOverlayData(scene, timeline, count);
  const hitboxes = [];
  const visibleRange = layout.visibleTimeRange || overlays.timeRange;
  drawTimelineTimeAxis(ctx, layout, visibleRange, layout.fullTimeRange || overlays.timeRange);
  drawTimelineIdleGaps(ctx, layout, visibleRange, hitboxes);
  if (timelineOverlayEnabled("timelineStops")) {
    drawTimelineStopMarkers(ctx, layout, visibleRange, overlays.timelineStops, hitboxes);
  }
  if (timelineOverlayEnabled("stage")) {
    drawTimelineStageMarkers(ctx, layout, visibleRange, overlays.stage, hitboxes);
  }
  if (timelineOverlayEnabled("photos")) {
    drawTimelinePhotoMarkers(ctx, layout, visibleRange, overlays.photos, hitboxes);
  }
  if (timelineOverlayEnabled("plan")) {
    drawTimelineActiveTicks(ctx, layout, timeline.frames || [], count);
  }
  drawTimelineTemperatureLines(ctx, layout, overlays, hitboxes);
  state.timelineOverlayHitboxes = hitboxes;
}

function drawTimelineIdleGaps(ctx, layout, range, hitboxes) {
  const segments = layout?.timeWarp?.segments || [];
  if (!segments.length || !range?.duration) return;
  const top = Math.max(4, layout.top - 22);
  const bottom = Math.max(top + 1, Math.min(layout.height - 8, layout.axisY + 20));
  ctx.save();
  for (const segment of segments) {
    if (!segment.idle) continue;
    if (segment.realEnd < range.start || segment.realStart > range.end) continue;
    const x0 = timelineXForTime(layout, range, clamp(segment.realStart, range.start, range.end));
    const x1 = timelineXForTime(layout, range, clamp(segment.realEnd, range.start, range.end));
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
    const left = Math.min(x0, x1);
    const width = Math.max(8, Math.abs(x1 - x0));
    ctx.fillStyle = "rgba(142, 142, 147, 0.08)";
    ctx.fillRect(left, top, width, bottom - top);
    ctx.strokeStyle = "rgba(245, 245, 247, 0.20)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(left + width / 2, top);
    ctx.lineTo(left + width / 2, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    if (width > 34) {
      ctx.fillStyle = "rgba(245, 245, 247, 0.68)";
      ctx.font = "700 9px -apple-system, BlinkMacSystemFont, Segoe UI";
      ctx.textAlign = "center";
      ctx.fillText("skip", left + width / 2, top + 11);
      ctx.font = "8px -apple-system, BlinkMacSystemFont, Segoe UI";
      ctx.fillText(formatRelativeSeconds(segment.realDuration), left + width / 2, top + 22);
    }
    hitboxes.push({
      x: left,
      y: top,
      w: width,
      h: bottom - top,
      z: 12,
      overlay: {
        kind: "idle_gap",
        label: "Idle gap",
        startTime: segment.realStart,
        endTime: segment.realEnd,
        durationSeconds: segment.realDuration,
        lines: [
          `${eventTimeLabel({ t: segment.realStart })} to ${eventTimeLabel({ t: segment.realEnd })}`,
          `${formatRelativeSeconds(segment.realDuration)} compressed`,
        ],
      },
    });
  }
  ctx.restore();
}

function timelineOverlayData(scene, timeline, count) {
  const key = timelineOverlayCacheKey(scene, count);
  if (state.timeline.overlayCache.key === key && state.timeline.overlayCache.data) {
    return state.timeline.overlayCache.data;
  }
  const range = timelineOverlayTimeRange(scene);
  const samples = timelineMeasuredTemperatureSamples(scene);
  const data = {
    timeRange: range,
    temperatureSamples: samples,
    targetTemperature: timelineTargetTemperatureMarkers(scene),
    stage: timelineStageMarkers(scene),
    photos: timelinePhotoMarkers(scene),
    timelineStops: timelineStopMarkers(scene, timeline),
  };
  state.timeline.overlayCache = { key, data };
  return data;
}

function timelineOverlayCacheKey(scene, count) {
  return [count, timelineDataCacheKey(scene)].join("|");
}

function timelineDataCacheKey(scene = null) {
  const events = state.events || [];
  const firstEvent = events[0] || {};
  const lastEvent = events[events.length - 1] || {};
  const samples = state.temperatureSamples || [];
  const firstSample = samples[0] || {};
  const lastSample = samples[samples.length - 1] || {};
  const targetSamples = state.temperatureTargetSamples || [];
  const firstTargetSample = targetSamples[0] || {};
  const lastTargetSample = targetSamples[targetSamples.length - 1] || {};
  const control = timelineControlStatus(scene);
  const intervals = Array.isArray(control?.intervals) ? control.intervals : [];
  const lastInterval = intervals[intervals.length - 1] || {};
  return [
    state.selectedRunId || state.status?.run_id || "",
    scene?.revision || "",
    Boolean(control?.paused),
    control?.paused_at || "",
    control?.paused_after_frame_index ?? "",
    intervals.length,
    lastInterval.start_time || "",
    lastInterval.end_time || "",
    events.length,
    firstEvent.t || "",
    firstEvent.ts || "",
    lastEvent.t || "",
    lastEvent.ts || "",
    lastEvent.type || "",
    lastEvent.tool || "",
    state.temperatureRevision || 0,
    samples.length || 0,
    firstSample.t ? Math.floor(Number(firstSample.t) / 1000) : "",
    lastSample.t ? Math.floor(Number(lastSample.t) / 30000) : "",
    lastSample.value !== undefined ? Number(lastSample.value).toFixed(2) : "",
    targetSamples.length || 0,
    firstTargetSample.t ? Math.floor(Number(firstTargetSample.t) / 1000) : "",
    lastTargetSample.t || "",
    lastTargetSample.value !== undefined ? Number(lastTargetSample.value).toFixed(2) : "",
  ].join("|");
}

function timelineOverlayTimeRange(scene = null) {
  const key = timelineDataCacheKey(scene);
  if (state.timeline.rangeCache.key === key && state.timeline.rangeCache.data) {
    return state.timeline.rangeCache.data;
  }
  const times = [];
  for (const stop of timelineStopMarkers(scene)) {
    if (Number.isFinite(Number(stop.startTime))) times.push(Number(stop.startTime));
    if (!stop.active && Number.isFinite(Number(stop.endTime))) times.push(Number(stop.endTime));
  }
  for (const event of state.events || []) {
    const eventTime = eventTimeSeconds(event);
    if (timelineTimeIsStopped(eventTime, scene)) continue;
    if (timelineEventIsSemantic(event) && Number.isFinite(eventTime)) {
      times.push(eventTime);
    }
    const target = targetTemperatureFromEvent(event);
    if (Number.isFinite(target) && Number.isFinite(eventTime)) {
      times.push(eventTime);
    }
    if (
      !Number.isFinite(measuredTemperatureFromEvent(event))
      && !Number.isFinite(target)
      && !stagePositionFromEvent(event)
      && !photoInfoFromEvent(event)
    ) {
      continue;
    }
    const t = eventTime;
    if (Number.isFinite(t)) times.push(t);
  }
  for (const marker of timelineTargetTemperatureMarkers(scene)) {
    if (Number.isFinite(Number(marker.time)) && !timelineTimeIsStopped(marker.time, scene)) {
      times.push(Number(marker.time));
    }
  }
  const telemetryTail = timelineTelemetryTailRange(scene);
  if (telemetryTail) {
    times.push(telemetryTail.start, telemetryTail.end);
  }
  if (!times.length) {
    const empty = { start: 0, end: 0, duration: 0 };
    state.timeline.rangeCache = { key, data: empty };
    return empty;
  }
  const start = Math.min(...times);
  const end = Math.max(...times);
  const range = { start, end, duration: Math.max(0.001, end - start) };
  state.timeline.rangeCache = { key, data: range };
  return range;
}

function timelineTelemetryTailRange(scene = null) {
  const key = timelineDataCacheKey(scene);
  if (state.timeline.telemetryTailCache.key === key) {
    return state.timeline.telemetryTailCache.data;
  }
  const stopMarkers = timelineStopMarkers(scene);
  let earliest = null;
  let latest = null;
  const pushTime = (rawTime, value, validator) => {
    if (!validator(value)) return;
    const time = Number(rawTime) / 1000;
    if (!Number.isFinite(time) || timelineTimeIsStoppedWithMarkers(time, stopMarkers)) return;
    earliest = earliest === null ? time : Math.min(earliest, time);
    latest = latest === null ? time : Math.max(latest, time);
  };
  for (const sample of state.temperatureSamples || []) {
    pushTime(sample?.t, sample?.value, isValidMeasuredTemperature);
  }
  for (const sample of state.temperatureTargetSamples || []) {
    pushTime(sample?.t, sample?.value, isValidTemperatureTarget);
  }
  if (!Number.isFinite(latest) || !Number.isFinite(earliest)) {
    state.timeline.telemetryTailCache = { key, data: null };
    return null;
  }
  const bounds = timelineLoadedEventBounds();
  if (bounds && latest <= bounds.end + TIMELINE_IDLE_GAP_SECONDS) {
    state.timeline.telemetryTailCache = { key, data: null };
    return null;
  }
  const tailStart = Math.max(earliest, latest - TIMELINE_TELEMETRY_TAIL_SECONDS);
  if (!Number.isFinite(tailStart) || latest <= tailStart) {
    state.timeline.telemetryTailCache = { key, data: null };
    return null;
  }
  const range = {
    start: tailStart,
    end: latest,
    duration: latest - tailStart,
  };
  state.timeline.telemetryTailCache = { key, data: range };
  return range;
}

function timelineXForTime(layout, range, time) {
  if (!range?.duration || !Number.isFinite(Number(time))) return null;
  let progress;
  if (layout?.timeWarp) {
    const warpedStart = timelineWarpedTimeForReal(layout.timeWarp, range.start);
    const warpedEnd = timelineWarpedTimeForReal(layout.timeWarp, range.end);
    const warpedTime = timelineWarpedTimeForReal(layout.timeWarp, Number(time));
    progress = (warpedTime - warpedStart) / Math.max(0.001, warpedEnd - warpedStart);
  } else {
    progress = (Number(time) - range.start) / range.duration;
  }
  return layout.left + progress * layout.trackWidth;
}

function eventTimeSeconds(event) {
  const t = Number(event?.t);
  if (Number.isFinite(t)) return t;
  if (event?.ts) {
    const parsed = Date.parse(String(event.ts));
    if (Number.isFinite(parsed)) return parsed / 1000;
  }
  return null;
}

function eventFrameIndex(event) {
  const candidates = [
    event?.frame,
    event?.frame_index,
    event?.frame_number !== undefined ? Number(event.frame_number) - 1 : null,
    event?.result?.frame?.index,
    event?.result?.frame_index,
    event?.arguments?.frame_index,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function timelineMeasuredTemperatureSamples(scene = null) {
  const stopMarkers = timelineStopMarkers(scene);
  const eventSamples = [];
  for (const event of state.events || []) {
    for (const sample of timelineTemperatureSamplesFromEvent(event)) {
      if (!timelineTimeIsStoppedWithMarkers(sample.time, stopMarkers)) eventSamples.push(sample);
    }
    const temp = measuredTemperatureFromEvent(event);
    if (!isValidMeasuredTemperature(temp)) continue;
    const time = eventTimeSeconds(event);
    if (!Number.isFinite(time)) continue;
    if (timelineTimeIsStoppedWithMarkers(time, stopMarkers)) continue;
    eventSamples.push({
      time,
      value: temp,
      event,
      label: "Measured temperature",
      lines: [`${temp.toFixed(2)} C`, eventTimeLabel(event)],
    });
  }
  const chartSamples = [];
  for (const sample of state.temperatureSamples || []) {
    const value = Number(sample?.value);
    if (!isValidMeasuredTemperature(value)) continue;
    const time = Number(sample?.t) / 1000;
    if (!Number.isFinite(time) || timelineTimeIsStoppedWithMarkers(time, stopMarkers)) continue;
    chartSamples.push({
      time,
      value,
      source: sample?.source || "history",
      label: "Measured temperature",
    });
  }
  if (!eventSamples.length) return chartSamples;
  return dedupeTimelineSamples([...eventSamples, ...chartSamples], (item) => `${Math.round(item.time * 10)}:${Number(item.value).toFixed(2)}`);
}

function timelineTemperatureSamplesFromEvent(event) {
  const eventTime = eventTimeSeconds(event);
  if (!Number.isFinite(eventTime)) return [];
  const expanded = [];
  for (const root of eventPayloadRoots(event)) {
    expanded.push(...timelineRoutineTemperatureSamples(root, event, eventTime));
    const samples = getPath(root, "samples") || getPath(root, "temperature_samples");
    if (!Array.isArray(samples) || !samples.length) continue;
    const elapsedValues = samples
      .map((sample) => firstFiniteNumber(sample?.elapsed_seconds, sample?.elapsed, sample?.time_seconds))
      .filter(Number.isFinite);
    const maxElapsed = elapsedValues.length ? Math.max(...elapsedValues) : 0;
    const startTime = eventTime - maxElapsed;
    for (const sample of samples) {
      const value = firstFiniteNumber(
        sample?.temperature_c,
        sample?.temperature,
        sample?.current_temperature,
        sample?.current,
        sample?.value,
        sample,
      );
      if (!isValidMeasuredTemperature(value)) continue;
      const elapsed = firstFiniteNumber(sample?.elapsed_seconds, sample?.elapsed, sample?.time_seconds);
      const time = Number.isFinite(elapsed) ? startTime + elapsed : eventTime;
      expanded.push({
        time,
        value,
        event,
        label: "Measured temperature",
        lines: [`${value.toFixed(2)} C`, eventTimeLabel({ t: time })],
      });
    }
  }
  return expanded;
}

function timelineRoutineTemperatureSamples(root, event, eventTime) {
  const samples = [];
  const startedAt = firstFiniteNumber(getPath(root, "started_at"), getPath(root, "routine.started_at"));
  const results = getPath(root, "results");
  let cursor = Number.isFinite(startedAt) ? startedAt : null;
  if (Array.isArray(results)) {
    for (const result of results) {
      const stepSamples = Array.isArray(result?.samples) ? result.samples : [];
      const maxElapsed = maxTemperatureSampleElapsed(stepSamples);
      const stepStart = Number.isFinite(cursor) ? cursor : eventTime - maxElapsed;
      for (const sample of stepSamples) {
        const value = firstFiniteNumber(sample?.temperature_c, sample?.temperature, sample?.current_temperature, sample?.current, sample?.value);
        if (!isValidMeasuredTemperature(value)) continue;
        const elapsed = firstFiniteNumber(sample?.elapsed_seconds, sample?.elapsed, sample?.time_seconds);
        const time = Number.isFinite(elapsed) ? stepStart + elapsed : eventTime;
        samples.push({
          time,
          value,
          event,
          label: "Measured temperature",
          lines: [`${value.toFixed(2)} C`, eventTimeLabel({ t: time })],
        });
      }
      if (Number.isFinite(cursor)) cursor += Math.max(maxElapsed, firstFiniteNumber(result?.hold_seconds, result?.duration_seconds, 0) || 0);
    }
  }
  const activeStep = getPath(root, "active_step");
  const lastSample = getPath(root, "last_sample");
  if (activeStep && lastSample && typeof lastSample === "object") {
    const value = firstFiniteNumber(lastSample.temperature_c, lastSample.temperature, lastSample.current_temperature, lastSample.current, lastSample.value);
    if (isValidMeasuredTemperature(value)) {
      const elapsed = firstFiniteNumber(lastSample.elapsed_seconds, lastSample.elapsed, lastSample.time_seconds);
      const time = Number.isFinite(elapsed) ? eventTime : eventTime;
      samples.push({
        time,
        value,
        event,
        label: "Measured temperature",
        lines: [`${value.toFixed(2)} C`, eventTimeLabel({ t: time })],
      });
    }
  }
  return samples;
}

function maxTemperatureSampleElapsed(samples) {
  if (!Array.isArray(samples) || !samples.length) return 0;
  const values = samples
    .map((sample) => firstFiniteNumber(sample?.elapsed_seconds, sample?.elapsed, sample?.time_seconds))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

function timelineTargetTemperatureMarkers(scene = null) {
  const stopMarkers = timelineStopMarkers(scene);
  const markers = [];
  for (const event of state.events || []) {
    const target = targetTemperatureFromEvent(event);
    const time = eventTimeSeconds(event);
    if (isValidTemperatureTarget(target) && Number.isFinite(time) && !timelineTimeIsStoppedWithMarkers(time, stopMarkers)) {
      markers.push({
        kind: "target-temperature",
        time,
        frame: eventFrameIndex(event),
        value: target,
        event,
        label: "Target temperature",
        lines: [`Set to ${target.toFixed(1)} C`, eventToolLine(event), eventTimeLabel(event)].filter(Boolean),
      });
    }
    markers.push(...timelineRoutineTargetMarkersFromEvent(event, scene, stopMarkers));
  }
  for (const sample of state.temperatureTargetSamples || []) {
    const sampleTime = Number(sample?.t);
    const value = Number(sample?.value);
    if (!Number.isFinite(sampleTime) || !isValidTemperatureTarget(value)) continue;
    const time = sampleTime / 1000;
    if (timelineTimeIsStoppedWithMarkers(time, stopMarkers)) continue;
    markers.push({
      kind: "target-temperature",
      time,
      frame: null,
      value,
      source: sample.source || "state",
      label: "Target temperature",
      lines: [`Set to ${value.toFixed(1)} C`, eventTimeLabel({ t: time })].filter(Boolean),
    });
  }
  const deduped = dedupeTimelineSamples(markers, (item) => `${Math.round(item.time * 2)}:${item.value.toFixed(1)}`);
  const changes = [];
  let lastValue = null;
  for (const marker of deduped) {
    const value = Number(marker.value);
    if (lastValue !== null && Math.abs(value - lastValue) < 0.001) continue;
    changes.push(marker);
    lastValue = value;
  }
  return changes;
}

function timelineRoutineTargetMarkersFromEvent(event, scene = null, stopMarkersArg = null) {
  const eventTime = eventTimeSeconds(event);
  if (!Number.isFinite(eventTime)) return [];
  const stopMarkers = stopMarkersArg || timelineStopMarkers(scene);
  const markers = [];
  for (const root of eventPayloadRoots(event)) {
    const startedAt = firstFiniteNumber(getPath(root, "started_at"), getPath(root, "routine.started_at"));
    const results = getPath(root, "results");
    let cursor = Number.isFinite(startedAt) ? startedAt : null;
    if (Array.isArray(results)) {
      for (const result of results) {
        const value = firstFiniteNumber(result?.target_c, result?.target_temperature, result?.target, result?.set_result?.actual_value);
        const stepSamples = Array.isArray(result?.samples) ? result.samples : [];
        const maxElapsed = maxTemperatureSampleElapsed(stepSamples);
        const time = Number.isFinite(cursor) ? cursor : eventTime - maxElapsed;
        if (isValidTemperatureTarget(value) && Number.isFinite(time) && !timelineTimeIsStoppedWithMarkers(time, stopMarkers)) {
          markers.push({
            kind: "target-temperature",
            time,
            value,
            event,
            source: "temperature_routine",
            label: "Target temperature",
            lines: [`Set to ${value.toFixed(1)} C`, `Routine step ${Number(result?.index ?? markers.length) + 1}`, eventTimeLabel({ t: time })],
          });
        }
        if (Number.isFinite(cursor)) cursor += Math.max(maxElapsed, firstFiniteNumber(result?.hold_seconds, result?.duration_seconds, 0) || 0);
      }
    }
    const activeStep = getPath(root, "active_step");
    if (activeStep && typeof activeStep === "object") {
      const value = firstFiniteNumber(activeStep.target_c, activeStep.target_temperature, activeStep.target);
      const elapsed = firstFiniteNumber(getPath(root, "last_sample.elapsed_seconds"), getPath(root, "last_sample.elapsed"), 0);
      const time = Number.isFinite(elapsed) ? eventTime - elapsed : eventTime;
      if (isValidTemperatureTarget(value) && Number.isFinite(time) && !timelineTimeIsStoppedWithMarkers(time, stopMarkers)) {
        markers.push({
          kind: "target-temperature",
          time,
          value,
          event,
          source: "temperature_routine",
          label: "Target temperature",
          lines: [`Set to ${value.toFixed(1)} C`, `Routine step ${Number(activeStep.index ?? 0) + 1}`, eventTimeLabel({ t: time })],
        });
      }
    }
  }
  return markers;
}

function timelineStageMarkers(scene = null) {
  const markers = [];
  for (const event of state.events || []) {
    const position = stagePositionFromEvent(event);
    if (!position) continue;
    const time = eventTimeSeconds(event);
    if (!Number.isFinite(time)) continue;
    if (timelineTimeIsStopped(time, scene)) continue;
    markers.push({
      kind: "stage",
      time,
      frame: eventFrameIndex(event),
      position,
      event,
      label: "Stage position",
      lines: [
        formatStagePosition(position),
        eventToolLine(event),
        eventTimeLabel(event),
      ].filter(Boolean),
    });
  }
  return dedupeTimelineSamples(markers, (item) => `${Math.round(item.time * 10)}:${formatStagePosition(item.position)}`);
}

function timelinePhotoMarkers(scene = null) {
  const markers = [];
  for (const event of state.events || []) {
    const photo = photoInfoFromEvent(event);
    if (!photo) continue;
    const time = eventTimeSeconds(event);
    if (!Number.isFinite(time)) continue;
    if (timelineTimeIsStopped(time, scene)) continue;
    markers.push({
      kind: "photo",
      time,
      frame: eventFrameIndex(event),
      photo,
      event,
      label: "Photo captured",
      lines: [
        photo.source ? `Source ${photo.source}` : "",
        photo.preset ? `Preset ${photo.preset}` : "",
        photo.path ? `File ${photo.path}` : "",
        (photo.path || photo.absolutePath) ? "Click to reveal the image file" : "",
        eventTimeLabel(event),
      ].filter(Boolean),
    });
  }
  return dedupeTimelineSamples(markers, (item) => `${Math.round(item.time * 10)}:${item.photo.source || ""}:${item.photo.path || ""}`);
}

function timelineControlStatus(scene = null, timeline = null) {
  const effectiveScene = scene || state.live?.scene?.result || state.live?.scene;
  const effective = timeline || effectiveTimeline(effectiveScene);
  return effective?.control
    || effectiveScene?.timeline_control
    || effectiveScene?.timeline?.control
    || state.status?.timeline_control
    || null;
}

function timelineStopMarkers(scene = null, timeline = null) {
  const key = timelineStopMarkersCacheKey(scene, timeline);
  if (state.timeline.stopMarkersCache.key === key && state.timeline.stopMarkersCache.data) {
    return state.timeline.stopMarkersCache.data;
  }
  const control = timelineControlStatus(scene, timeline);
  const intervals = Array.isArray(control?.intervals) ? control.intervals : [];
  const markers = intervals
    .map((interval) => timelineStopMarkerFromInterval(interval, false))
    .filter(Boolean);
  if (control?.paused && Number.isFinite(Number(control.paused_at))) {
    markers.push(timelineStopMarkerFromInterval({
      id: "active",
      start_time: control.paused_at,
      end_time: null,
      duration_seconds: control.active_duration_seconds,
      reason: control.paused_reason,
      source: control.paused_source,
      after_frame_index: control.paused_after_frame_index,
    }, true));
  }
  const filtered = markers
    .filter((marker) => timelineStopMarkerBelongsToLoadedRun(marker))
    .sort((a, b) => a.startTime - b.startTime);
  state.timeline.stopMarkersCache = { key, data: filtered };
  return filtered;
}

function timelineStopMarkersCacheKey(scene = null, timeline = null) {
  const control = timelineControlStatus(scene, timeline);
  const intervals = Array.isArray(control?.intervals) ? control.intervals : [];
  const first = intervals[0] || {};
  const last = intervals[intervals.length - 1] || {};
  return [
    timelineEventBoundsCacheKey(),
    scene?.revision || "",
    Boolean(control?.paused),
    control?.paused_at ?? "",
    control?.paused_after_frame_index ?? "",
    control?.active_duration_seconds ?? "",
    intervals.length,
    first.start_time ?? "",
    first.end_time ?? "",
    last.start_time ?? "",
    last.end_time ?? "",
  ].join("|");
}

function timelineStopMarkerBelongsToLoadedRun(marker) {
  const bounds = timelineLoadedEventBounds();
  if (!bounds) return true;
  const start = Number(marker?.startTime);
  const end = Number(marker?.endTime);
  if (!Number.isFinite(start)) return false;
  const tolerance = 60;
  if (Number.isFinite(end)) {
    return end >= bounds.start - tolerance && start <= bounds.end + tolerance;
  }
  return start >= bounds.start - tolerance && start <= bounds.end + tolerance;
}

function timelineLoadedEventBounds() {
  const key = timelineEventBoundsCacheKey();
  if (state.timeline.eventBoundsCache.key === key) {
    return state.timeline.eventBoundsCache.data;
  }
  let start = Infinity;
  let end = -Infinity;
  for (const event of state.events || []) {
    const time = eventTimeSeconds(event);
    if (!Number.isFinite(time)) continue;
    start = Math.min(start, time);
    end = Math.max(end, time);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    state.timeline.eventBoundsCache = { key, data: null };
    return null;
  }
  const bounds = { start, end };
  state.timeline.eventBoundsCache = { key, data: bounds };
  return bounds;
}

function timelineEventBoundsCacheKey() {
  const events = state.events || [];
  const first = events[0] || {};
  const last = events[events.length - 1] || {};
  return [
    state.selectedRunId || state.status?.run_id || "",
    events.length,
    first.t || "",
    first.ts || "",
    last.t || "",
    last.ts || "",
    last.type || "",
    last.tool || "",
  ].join("|");
}

function timelineTimeIsStopped(time, scene = null, timeline = null) {
  return timelineTimeIsStoppedWithMarkers(time, timelineStopMarkers(scene, timeline));
}

function timelineTimeIsStoppedWithMarkers(time, markers) {
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) return false;
  return (markers || []).some((marker) => {
    const start = Number(marker.startTime);
    if (!Number.isFinite(start) || numeric <= start) return false;
    if (marker.active || !Number.isFinite(Number(marker.endTime))) return true;
    return numeric < Number(marker.endTime);
  });
}

function timelineStopMarkerFromInterval(interval, active) {
  const startTime = Number(interval?.start_time);
  if (!Number.isFinite(startTime)) return null;
  const endTime = Number(interval?.end_time);
  const duration = Number(interval?.duration_seconds);
  const afterFrameIndex = Number(interval?.after_frame_index);
  const durationText = Number.isFinite(duration) && duration > 0
    ? formatRelativeSeconds(duration)
    : active
      ? "running"
      : "0s";
  return {
    kind: "timeline_stop",
    id: interval?.id ?? `${startTime}`,
    time: startTime,
    startTime,
    endTime: Number.isFinite(endTime) ? endTime : null,
    active: Boolean(active),
    frame: Number.isFinite(afterFrameIndex) ? afterFrameIndex : null,
    afterFrameIndex: Number.isFinite(afterFrameIndex) ? afterFrameIndex : null,
    durationSeconds: Number.isFinite(duration) ? duration : null,
    label: "Recording stopped",
    lines: [
      active ? "Still not recording" : `Duration ${durationText}`,
      Number.isFinite(afterFrameIndex) ? `After frame ${Math.trunc(afterFrameIndex) + 1}` : "",
      interval?.reason ? `Reason ${interval.reason}` : "",
      interval?.resume_reason ? `Resume ${interval.resume_reason}` : "",
      interval?.source ? `Source ${interval.source}` : "",
    ].filter(Boolean),
  };
}

function dedupeTimelineSamples(items, keyFn) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped.sort((a, b) => {
    const at = Number(a.time);
    const bt = Number(b.time);
    if (Number.isFinite(at) && Number.isFinite(bt)) return at - bt;
    return Number(a.frame || 0) - Number(b.frame || 0);
  });
}

function drawTimelineTemperatureLines(ctx, layout, overlays, hitboxes) {
  const measuredEnabled = timelineOverlayEnabled("measuredTemperature");
  const targetEnabled = timelineOverlayEnabled("targetTemperature");
  if (!measuredEnabled && !targetEnabled) return;
  const timeRange = layout.visibleTimeRange || overlays.timeRange;
  const measured = measuredEnabled ? visibleTimelineTemperatureValues(overlays.temperatureSamples, timeRange, layout) : [];
  const measuredForRender = measuredEnabled ? simplifyTimelineTemperatureSamplesForRender(measured, layout) : [];
  const targets = targetEnabled ? (overlays.targetTemperature || []).filter((marker) => Number.isFinite(Number(marker.value))) : [];
  const visibleTargets = visibleTimelineTimeValues(targets, timeRange);
  const targetValues = targetEnabled ? timelineTargetValuesForRange(targets, timeRange) : [];
  const values = [
    ...measuredForRender.map((sample) => Number(sample.value)),
    ...targetValues,
  ].filter(Number.isFinite);
  if (!values.length) return;

  const bounds = timelineTemperaturePlotBounds(layout);
  const domain = timelineTemperatureDomain(values);
  const yForValue = (value) => bounds.bottom - ((Number(value) - domain.min) / domain.span) * bounds.height;

  ctx.save();
  const gradient = ctx.createLinearGradient(0, bounds.top, 0, bounds.bottom);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.035)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0.006)");
  ctx.fillStyle = gradient;
  roundedRect(ctx, layout.left, bounds.top, layout.trackWidth, bounds.height, 5);
  ctx.fill();

  if (measuredEnabled) {
    drawTimelineMeasuredTemperatureLine(ctx, layout, timeRange, measuredForRender, yForValue, hitboxes);
  }
  if (targetEnabled) {
    drawTimelineTargetTemperatureLine(ctx, layout, timeRange, targets, visibleTargets, yForValue, hitboxes);
  }
  ctx.restore();
}

function visibleTimelineTimeValues(items, range) {
  return (items || [])
    .filter((item) => Number.isFinite(Number(item.time)) && Number.isFinite(Number(item.value)))
    .filter((item) => !range?.duration || (item.time >= range.start && item.time <= range.end))
    .sort((a, b) => Number(a.time) - Number(b.time));
}

function visibleTimelineTemperatureValues(items, range, layout) {
  return visibleTimelineTimeValues(items, range)
    .filter((item) => !timelineTimeInsideIdleGap(layout, item.time));
}

function timelineTimeInsideIdleGap(layout, time) {
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) return false;
  for (const segment of layout?.timeWarp?.segments || []) {
    if (!segment?.idle) continue;
    if (numeric > Number(segment.realStart) && numeric < Number(segment.realEnd)) return true;
  }
  return false;
}

function timelineTimesCrossIdleGap(layout, start, end) {
  const a = Number(start);
  const b = Number(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const left = Math.min(a, b);
  const right = Math.max(a, b);
  return (layout?.timeWarp?.segments || []).some((segment) => (
    segment?.idle
    && Number(segment.realStart) > left
    && Number(segment.realEnd) < right
  ));
}

function simplifyTimelineTemperatureSamplesForRender(samples, layout) {
  const sorted = (samples || [])
    .filter((sample) => Number.isFinite(Number(sample.time)) && Number.isFinite(Number(sample.value)))
    .sort((a, b) => Number(a.time) - Number(b.time));
  const maxPoints = Math.max(80, Math.min(
    TIMELINE_TEMPERATURE_RENDER_MAX_POINTS,
    Math.floor(Math.max(1, Number(layout?.trackWidth) || 1) / 3),
  ));
  if (sorted.length <= maxPoints) return sorted;
  const bucketCount = Math.max(1, Math.floor(maxPoints / 3));
  const start = Number(sorted[0].time);
  const end = Number(sorted[sorted.length - 1].time);
  const duration = Math.max(0.001, end - start);
  const buckets = Array.from({ length: bucketCount }, () => []);
  for (const sample of sorted) {
    const index = clamp(Math.floor(((Number(sample.time) - start) / duration) * bucketCount), 0, bucketCount - 1);
    buckets[index].push(sample);
  }
  const simplified = [];
  for (const bucket of buckets) {
    if (!bucket.length) continue;
    const first = bucket[0];
    const min = bucket.reduce((best, item) => Number(item.value) < Number(best.value) ? item : best, first);
    const max = bucket.reduce((best, item) => Number(item.value) > Number(best.value) ? item : best, first);
    const last = bucket[bucket.length - 1];
    for (const item of [first, min, max, last].sort((a, b) => Number(a.time) - Number(b.time))) {
      const previous = simplified[simplified.length - 1];
      if (
        previous
        && Math.round(Number(previous.time) * 1000) === Math.round(Number(item.time) * 1000)
        && Math.abs(Number(previous.value) - Number(item.value)) < 0.0001
      ) {
        continue;
      }
      simplified.push(item);
    }
  }
  return simplified;
}

function timelineTargetValuesForRange(markers, range) {
  if (!Array.isArray(markers) || !markers.length) return [];
  if (!range?.duration) return markers.map((marker) => Number(marker.value)).filter(Number.isFinite);
  const sorted = markers
    .filter((marker) => Number.isFinite(Number(marker.time)) && Number.isFinite(Number(marker.value)))
    .sort((a, b) => Number(a.time) - Number(b.time));
  const values = [];
  let carried = null;
  for (const marker of sorted) {
    const time = Number(marker.time);
    const value = Number(marker.value);
    if (time <= range.start) carried = value;
    if (time >= range.start && time <= range.end) values.push(value);
    if (time > range.end) break;
  }
  if (Number.isFinite(carried)) values.push(carried);
  return values;
}

function timelineTemperaturePlotBounds(layout) {
  const top = Math.max(8, layout.top - 6);
  const bottom = Math.min(layout.height - 20, layout.axisY + 5);
  const height = Math.max(34, bottom - top);
  return { top, bottom: top + height, height };
}

function timelineTemperatureDomain(values) {
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const rawSpan = Math.max(0.5, maxValue - minValue);
  const padding = Math.max(0.25, rawSpan * 0.12);
  const min = minValue - padding;
  const max = maxValue + padding;
  return { min, max, span: Math.max(0.5, max - min) };
}

function drawTimelineMeasuredTemperatureLine(ctx, layout, range, samples, yForValue, hitboxes) {
  if (!samples.length) return;
  const points = [];
  ctx.save();
  ctx.beginPath();
  let previousTime = null;
  samples.forEach((sample, index) => {
    const x = timelineXForTime(layout, range, sample.time);
    if (!Number.isFinite(x)) return;
    const y = yForValue(sample.value);
    points.push({ x, y, sample });
    if (index === 0 || timelineTimesCrossIdleGap(layout, previousTime, sample.time)) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    previousTime = sample.time;
  });
  ctx.shadowColor = "rgba(10, 132, 255, 0.45)";
  ctx.shadowBlur = 7;
  ctx.strokeStyle = "rgba(10, 132, 255, 0.96)";
  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  const drawAllPoints = points.length <= 180;
  const pointStep = drawAllPoints ? 1 : Math.max(1, Math.ceil(points.length / 120));
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const hoverKey = timelineOverlayPointKey("measured-temperature", point.sample);
    const hovered = timelineOverlayPointHovered("measured-temperature", point.sample, hoverKey);
    const representative = drawAllPoints || hovered || index % pointStep === 0 || index === points.length - 1;
    if (hovered) {
      ctx.save();
      ctx.shadowColor = "rgba(100, 210, 255, 0.72)";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 7.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(100, 210, 255, 0.20)";
      ctx.fill();
      ctx.restore();
    }
    if (representative) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, hovered ? 4.8 : (points.length === 1 ? 3.5 : 1.8), 0, Math.PI * 2);
      ctx.fillStyle = hovered ? "#dff7ff" : "rgba(100, 210, 255, 0.90)";
      ctx.fill();
      ctx.strokeStyle = hovered ? "rgba(10, 132, 255, 0.98)" : "rgba(3, 20, 32, 0.65)";
      ctx.lineWidth = hovered ? 1.8 : 0.6;
      ctx.stroke();
      hitboxes.push({
        x: point.x - 6,
        y: point.y - 6,
        w: 12,
        h: 12,
        z: 30,
        overlay: {
          ...point.sample,
          kind: "measured-temperature",
          hoverKey,
          label: "Measured temperature",
          lines: point.sample.lines || measuredTemperatureHoverLines(point.sample),
        },
      });
    }
  }
  ctx.restore();
}

function measuredTemperatureHoverLines(sample) {
  const value = Number(sample?.value);
  const time = Number(sample?.time);
  return [
    Number.isFinite(value) ? `${value.toFixed(2)} C` : "",
    Number.isFinite(time) ? eventTimeLabel({ t: time }) : "",
  ].filter(Boolean);
}

function timelineOverlayPointKey(kind, item) {
  const time = Number(item?.time);
  const value = Number(item?.value);
  return [
    kind || "overlay",
    Number.isFinite(time) ? Math.round(time * 1000) : "",
    Number.isFinite(value) ? value.toFixed(3) : "",
  ].join(":");
}

function timelineOverlayPointHovered(kind, item, key = null) {
  const overlay = state.timeline.hoverOverlay;
  if (!overlay || overlay.kind !== kind) return false;
  const overlayKey = overlay.hoverKey || timelineOverlayPointKey(kind, overlay);
  const itemKey = key || timelineOverlayPointKey(kind, item);
  return overlayKey === itemKey;
}

function drawTimelineTargetTemperatureLine(ctx, layout, range, markers, visibleMarkers, yForValue, hitboxes) {
  if (!markers.length) return;
  const sorted = [...markers].sort((a, b) => Number(a.time) - Number(b.time));
  const startTime = range.start;
  const endTime = range.end;
  let currentIndex = -1;
  for (let index = 0; index < sorted.length; index += 1) {
    if (Number(sorted[index].time) <= startTime) currentIndex = index;
  }
  if (currentIndex < 0) {
    currentIndex = sorted.findIndex((marker) => Number(marker.time) <= endTime);
  }
  if (currentIndex < 0) return;

  const current = sorted[currentIndex];
  let currentValue = Number(current.value);
  let cursorTime = Math.max(startTime, Number(current.time));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(timelineXForTime(layout, range, cursorTime), yForValue(currentValue));
  for (let index = currentIndex + 1; index < sorted.length; index += 1) {
    const marker = sorted[index];
    const markerTime = Number(marker.time);
    if (!Number.isFinite(markerTime)) continue;
    if (markerTime < startTime) {
      currentValue = Number(marker.value);
      continue;
    }
    if (markerTime > endTime) break;
    const x = timelineXForTime(layout, range, markerTime);
    ctx.lineTo(x, yForValue(currentValue));
    currentValue = Number(marker.value);
    ctx.lineTo(x, yForValue(currentValue));
    cursorTime = markerTime;
  }
  if (cursorTime <= endTime) {
    ctx.lineTo(timelineXForTime(layout, range, endTime), yForValue(currentValue));
  }
  ctx.shadowColor = "rgba(255, 69, 58, 0.48)";
  ctx.shadowBlur = 7;
  ctx.strokeStyle = "rgba(255, 69, 58, 0.98)";
  ctx.lineWidth = 2.4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  for (const marker of visibleMarkers) {
    drawTimelineTargetTemperatureBubble(ctx, layout, range, marker, yForValue(marker.value), hitboxes);
  }
}

function drawTimelineTargetTemperatureBubble(ctx, layout, range, marker, y, hitboxes) {
  const label = compactTemperatureLabel(marker.value);
  const rawX = timelineXForTime(layout, range, marker.time);
  if (!Number.isFinite(rawX)) return;
  const x = clamp(rawX, layout.left + 13, layout.left + layout.trackWidth - 13);
  ctx.save();
  ctx.font = "800 9px -apple-system, BlinkMacSystemFont, Segoe UI";
  const radius = Math.max(10, Math.min(16, ctx.measureText(label).width / 2 + 5));
  ctx.shadowColor = "rgba(255, 69, 58, 0.52)";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 69, 58, 0.96)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 245, 245, 0.9)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = "#fff7f7";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 0.5);
  ctx.restore();
  hitboxes.push({
    x: x - radius,
    y: y - radius,
    w: radius * 2,
    h: radius * 2,
    z: 60,
    overlay: marker,
  });
}

function compactTemperatureLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toFixed(1);
}

function drawTimelineTimeAxis(ctx, layout, range, fullRange = null) {
  if (!range?.duration || range.duration <= 0.001) return;
  const y = layout.height - 13;
  ctx.save();
  ctx.strokeStyle = "rgba(10, 132, 255, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(layout.left, y);
  ctx.lineTo(layout.left + layout.trackWidth, y);
  ctx.stroke();
  ctx.fillStyle = "rgba(100, 210, 255, 0.76)";
  ctx.font = "9px -apple-system, BlinkMacSystemFont, Segoe UI";
  const divisions = Math.min(7, Math.max(2, Math.floor(layout.trackWidth / 150)));
  for (let tick = 0; tick <= divisions; tick += 1) {
    const progress = tick / divisions;
    const time = range.start + range.duration * progress;
    const x = timelineXForTime(layout, range, time);
    if (!Number.isFinite(x)) continue;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 3);
    ctx.stroke();
    const origin = Number.isFinite(Number(fullRange?.start)) ? Number(fullRange.start) : range.start;
    ctx.fillText(`+${formatRelativeSeconds(time - origin)}`, x - 8, y + 11);
  }
  ctx.restore();
}

function formatRelativeSeconds(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 60) return `${Math.round(value)}s`;
  if (value >= 3600) {
    const hours = Math.floor(value / 3600);
    const minutes = Math.round((value % 3600) / 60);
    return minutes ? `${hours}h${String(minutes).padStart(2, "0")}` : `${hours}h`;
  }
  const minutes = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return `${minutes}m${String(rest).padStart(2, "0")}`;
}

function drawTimelineStopMarkers(ctx, layout, range, markers, hitboxes) {
  if (!Array.isArray(markers) || !markers.length || !range?.duration) return;
  const top = Math.max(4, layout.top - 22);
  const bottom = Math.max(top + 1, Math.min(layout.height - 8, layout.axisY + 20));
  ctx.save();
  for (const marker of markers) {
    const start = Number(marker.startTime);
    const end = Number(marker.endTime);
    if (!Number.isFinite(start)) continue;
    const active = marker.active || !Number.isFinite(end);
    if (!active && (end < range.start || start > range.end)) continue;
    if (active && (start < range.start || start > range.end)) continue;
    const x0 = timelineXForTime(layout, range, clamp(start, range.start, range.end));
    if (!Number.isFinite(x0)) continue;
    if (active) {
      ctx.beginPath();
      ctx.moveTo(x0, top);
      ctx.lineTo(x0, bottom);
      ctx.strokeStyle = "rgba(255, 214, 10, 0.82)";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      drawTimelineStopCap(ctx, x0, top + 7, "stop");
      hitboxes.push({
        x: x0 - 10,
        y: top,
        w: 20,
        h: bottom - top,
        z: 45,
        overlay: marker,
      });
      continue;
    }
    const x1 = timelineXForTime(layout, range, clamp(end, range.start, range.end));
    if (!Number.isFinite(x1)) continue;
    const left = Math.min(x0, x1);
    const width = Math.max(5, Math.abs(x1 - x0));
    ctx.fillStyle = "rgba(255, 214, 10, 0.10)";
    ctx.fillRect(left, top, width, bottom - top);
    ctx.strokeStyle = "rgba(255, 214, 10, 0.38)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, width - 1), Math.max(0, bottom - top - 1));
    ctx.setLineDash([]);
    if (width > 44) {
      ctx.fillStyle = "rgba(255, 224, 102, 0.92)";
      ctx.font = "700 9px -apple-system, BlinkMacSystemFont, Segoe UI";
      ctx.fillText(formatRelativeSeconds(marker.durationSeconds || Math.max(0, end - start)), left + 6, top + 14);
    }
    hitboxes.push({
      x: left,
      y: top,
      w: width,
      h: bottom - top,
      z: 44,
      overlay: marker,
    });
  }
  ctx.restore();
}

function drawTimelineStopCap(ctx, x, y, label) {
  ctx.save();
  const text = String(label || "stop");
  ctx.font = "700 8px -apple-system, BlinkMacSystemFont, Segoe UI";
  const width = Math.max(24, ctx.measureText(text).width + 10);
  roundedRect(ctx, x - width / 2, y - 7, width, 14, 5);
  ctx.fillStyle = "rgba(255, 214, 10, 0.94)";
  ctx.fill();
  ctx.fillStyle = "#171407";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawTimelineStageMarkers(ctx, layout, range, markers, hitboxes) {
  drawTimelineMarkerLane(ctx, layout, markers, hitboxes, {
    range,
    y: timelineOverlayLaneY(layout, 1),
    color: [100, 210, 255],
    radius: 6,
    draw: (_marker, x, y) => {
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(100, 210, 255, 0.95)";
      ctx.fill();
      ctx.strokeStyle = "rgba(245, 245, 247, 0.82)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    },
  });
}

function timelineOverlayLaneY(layout, lane) {
  const base = layout.axisY + 15 + lane * 16;
  return Math.min(layout.height - 13, base);
}

function drawTimelinePhotoMarkers(ctx, layout, range, markers, hitboxes) {
  drawTimelineMarkerLane(ctx, layout, markers, hitboxes, {
    range,
    y: layout.top - 10,
    color: [191, 90, 242],
    radius: 8,
    draw: (_marker, x, y) => {
      drawTimelinePhotoLine(ctx, layout, x);
      drawCameraGlyph(ctx, x, y);
    },
  });
}

function drawTimelinePhotoLine(ctx, layout, x) {
  const y0 = Math.max(4, layout.top - 22);
  const y1 = Math.max(y0 + 1, layout.height - 8);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.strokeStyle = "rgba(245, 215, 255, 0.18)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.strokeStyle = "rgba(191, 90, 242, 0.68)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 5]);
  ctx.stroke();
  ctx.restore();
}

function drawTimelineMarkerLane(ctx, layout, markers, hitboxes, options) {
  if (!Array.isArray(markers) || !markers.length) return;
  ctx.save();
  for (const marker of markers) {
    if (options.range && (marker.time < options.range.start || marker.time > options.range.end)) continue;
    if (!options.range && (marker.frame < layout.startFrame || marker.frame > layout.endFrame)) continue;
    const x = options.range
      ? timelineXForTime(layout, options.range, marker.time)
      : timelineXForFrame(layout, marker.frame);
    if (!Number.isFinite(x)) continue;
    const y = Number(options.y);
    options.draw(marker, x, y);
    const radius = Number(options.radius) || 7;
    if (marker.kind === "photo") {
      const lineTop = Math.max(4, layout.top - 22);
      const lineBottom = Math.max(lineTop + 1, layout.height - 8);
      hitboxes.push({
        x: x - 5,
        y: lineTop,
        w: 10,
        h: lineBottom - lineTop,
        z: 50,
        overlay: marker,
      });
    }
    hitboxes.push({
      x: x - radius,
      y: y - radius,
      w: radius * 2,
      h: radius * 2,
      z: Number(options.z) || (marker.kind === "photo" ? 70 : marker.kind === "stage" ? 40 : 20),
      overlay: marker,
    });
  }
  ctx.restore();
}

function drawTimelineBubble(ctx, x, y, text, rgb, textColor) {
  const label = String(text || "");
  ctx.save();
  ctx.font = "700 9px -apple-system, BlinkMacSystemFont, Segoe UI";
  const w = Math.max(16, ctx.measureText(label).width + 8);
  roundedRect(ctx, x - w / 2, y - 8, w, 16, 8);
  ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.95)`;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.62)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = textColor || "#050607";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 0.5);
  ctx.restore();
}

function drawCameraGlyph(ctx, x, y) {
  ctx.save();
  ctx.shadowColor = "rgba(191, 90, 242, 0.45)";
  ctx.shadowBlur = 8;
  roundedRect(ctx, x - 8, y - 5.5, 16, 11, 3);
  ctx.fillStyle = "rgba(191, 90, 242, 0.96)";
  ctx.fill();
  ctx.shadowBlur = 0;
  roundedRect(ctx, x - 4.5, y - 8, 9, 4, 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = "#050607";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 1.4, 0, Math.PI * 2);
  ctx.fillStyle = "#f5f5f7";
  ctx.fill();
  ctx.restore();
}

function measuredTemperatureFromEvent(event) {
  const roots = eventPayloadRoots(event);
  for (const root of roots) {
    const direct = firstFiniteNumber(
      getPath(root, "temperature.current"),
      getPath(root, "temperature.current_c"),
      getPath(root, "temperature.value"),
      getPath(root, "temperature.temperature"),
      getPath(root, "temperature.current_temperature"),
      getPath(root, "current_temperature"),
      getPath(root, "measured_temperature"),
      getPath(root, "temperature_c"),
      getPath(root, "measured_c"),
      getPath(root, "current_c"),
      getPath(root, "current"),
    );
    if (isValidMeasuredTemperature(direct)) return direct;
    const temperature = getPath(root, "temperature");
    if (temperature && typeof temperature === "object") {
      for (const [key, value] of Object.entries(temperature)) {
        if (/target|setpoint|limit|port|version/i.test(key)) continue;
        const number = Number(value);
        if (isValidMeasuredTemperature(number)) return number;
      }
    }
    const samples = getPath(root, "samples") || getPath(root, "temperature_samples");
    if (Array.isArray(samples) && samples.length) {
      const sample = samples[samples.length - 1];
      const number = firstFiniteNumber(sample?.temperature, sample?.current, sample?.value, sample?.temperature_c, sample);
      if (isValidMeasuredTemperature(number)) return number;
    }
  }
  return null;
}

function isValidMeasuredTemperature(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  // The controller/config can emit sentinel values when no reading exists.
  if (temperatureValueIsMissingSentinel(number)) return false;
  return number > -50 && number < 180;
}

function isValidTemperatureTarget(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  if (temperatureValueIsMissingSentinel(number)) return false;
  return number > -50 && number < 180;
}

function temperatureValueIsMissingSentinel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  return Math.abs(number) < 1e-9 || Math.abs(number + 1) < 1e-9;
}

function targetTemperatureFromEvent(event) {
  const tool = String(event?.tool || "").toLowerCase();
  const type = String(event?.type || "").toLowerCase();
  if (
    (type === "mcp_tool_call" || type === "dashboard_tool_call" || type === "tool_call")
    && (
      tool.includes("temperature")
      || String(getPath(event, "arguments.path") || "").includes("temperature")
      || event?.arguments?.temperature !== undefined
      || event?.arguments?.target_temperature !== undefined
      || event?.arguments?.tarjet_temperature !== undefined
      || event?.arguments?.target_c !== undefined
      || event?.arguments?.target !== undefined
      || event?.arguments?.tarjet !== undefined
    )
  ) {
    const value = firstFiniteNumber(
      getPath(event, "arguments.temperature"),
      getPath(event, "arguments.target_temperature"),
      getPath(event, "arguments.tarjet_temperature"),
      getPath(event, "arguments.target_c"),
      getPath(event, "arguments.target"),
      getPath(event, "arguments.tarjet"),
      getPath(event, "arguments.temp"),
      getPath(event, "arguments.value"),
    );
    if (isValidTemperatureTarget(value)) return value;
  }
  for (const root of eventPayloadRoots(event)) {
    const value = firstFiniteNumber(
      getPath(root, "temperature.target"),
      getPath(root, "temperature.tarjet"),
      getPath(root, "temperature.target_c"),
      getPath(root, "temperature.tarjet_c"),
      getPath(root, "temperature.target_temperature"),
      getPath(root, "temperature.tarjet_temperature"),
      getPath(root, "temperature.setpoint"),
      getPath(root, "temperature.setpoint_c"),
      getPath(root, "target_c"),
      getPath(root, "tarjet_c"),
      getPath(root, "target_temperature"),
      getPath(root, "tarjet_temperature"),
      getPath(root, "target_temperature_c"),
      getPath(root, "tarjet_temperature_c"),
    );
    if (isValidTemperatureTarget(value)) return value;
  }
  return null;
}

function stagePositionFromEvent(event) {
  const tool = String(event?.tool || "").toLowerCase();
  if (event?.type === "mcp_tool_call" && tool === "move_stage") {
    return normalizeStagePosition(event?.arguments?.position || event?.arguments?.target_position || event?.arguments);
  }
  if (event?.type === "preset_applied") {
    const stageAction = (event?.result?.actions || []).find((action) => action?.tool === "move_stage");
    return normalizeStagePosition(stageAction?.result?.actual_position || stageAction?.result?.target_position || stageAction?.arguments?.position);
  }
  const stageEventTypes = new Set(["calibration_move_result", "stage_position", "verify_droplet_step"]);
  if (tool !== "move_stage" && !stageEventTypes.has(String(event?.type || ""))) return null;
  for (const root of eventPayloadRoots(event)) {
    const movements = getPath(root, "stage_movements");
    if (Array.isArray(movements) && movements.length) {
      const last = movements[movements.length - 1];
      const movementPosition = normalizeStagePosition(last?.actual_position || last?.target_position || last?.position);
      if (movementPosition) return movementPosition;
    }
    const position = normalizeStagePosition(
      getPath(root, "actual_position")
      || getPath(root, "target_position")
      || getPath(root, "position")
      || getPath(root, "stage.position")
      || getPath(root, "stage.current_position")
      || getPath(root, "stage")
    );
    if (position) return position;
  }
  return null;
}

function photoInfoFromEvent(event) {
  const tool = String(event?.tool || "").toLowerCase();
  const type = String(event?.type || "").toLowerCase();
  if (type === "mcp_tool_call" || type === "dashboard_tool_call" || type === "tool_call") {
    return null;
  }
  const roots = eventPayloadRoots(event);
  const captureLike = /photo|capture|snapshot|visualizer_frame|image/.test(tool)
    || /photo|capture|snapshot|visualizer|download/.test(type);
  const configuredImaging = event?.type === "preset_applied"
    && String(event?.category || "").toLowerCase() === "imaging";
  if (!captureLike && !configuredImaging) return null;
  const info = {
    source: event?.frame_source || event?.visualizer || event?.arguments?.frame_source || event?.arguments?.visualizer || "",
    preset: configuredImaging ? event?.name : "",
    path: "",
    absolutePath: "",
    mimeType: "",
  };
  const candidates = [];
  const addCandidate = (candidate, priority = 10) => {
    const path = String(candidate?.path || "").trim();
    const absolutePath = String(candidate?.absolutePath || candidate?.absolute_path || "").trim();
    const mimeType = String(candidate?.mimeType || candidate?.mime_type || "").trim();
    if (!path && !absolutePath) return;
    if (!timelinePhotoLooksLikeImage({ path, absolutePath, mimeType })) return;
    candidates.push({
      path,
      absolutePath,
      mimeType,
      priority,
      source: candidate?.source || "",
      preset: candidate?.preset || "",
    });
  };
  for (const root of roots) {
    info.source = info.source
      || getPath(root, "frame.frame_source")
      || getPath(root, "artifact.frame_source")
      || getPath(root, "frame.visualizer")
      || getPath(root, "artifact.visualizer")
      || getPath(root, "frame_source")
      || getPath(root, "visualizer")
      || getPath(root, "source")
      || "";
    info.mimeType = info.mimeType
      || getPath(root, "frame.mime_type")
      || getPath(root, "artifact.mime_type")
      || getPath(root, "mime_type")
      || "";
    info.preset = info.preset || getPath(root, "preset.name") || getPath(root, "name") || "";
    if (root === event?.arguments) continue;
    addExplicitArtifactCandidates(root, addCandidate);
    for (const attachment of root?.model_attachments || []) {
      addCandidate({
        path: attachment?.artifact?.path,
        absolutePath: attachment?.artifact?.absolute_path,
        mimeType: attachment?.artifact?.mime_type || attachment?.mime_type,
        source: attachment?.artifact?.frame_source || attachment?.artifact?.visualizer,
        preset: attachment?.artifact?.preset,
      }, 1);
    }
    addExplicitCaptureCandidates(root, addCandidate);
  }
  candidates.sort((a, b) => a.priority - b.priority);
  const best = candidates[0];
  if (!best && !configuredImaging) return null;
  if (best) {
    info.path = best.path;
    info.absolutePath = best.absolutePath;
    info.mimeType = best.mimeType || info.mimeType;
    info.source = info.source || best.source;
    info.preset = info.preset || best.preset;
  }
  return info;
}

function addExplicitArtifactCandidates(root, addCandidate) {
  addArtifactRefCandidate(root?.artifact, addCandidate, 0);
  addArtifactRefCandidate(root?.artifacts, addCandidate, 1);
  addArtifactRefCandidate(root?.frame?.artifact, addCandidate, 0);
  addArtifactRefCandidate(root?.frame?.artifacts, addCandidate, 1);
  addArtifactRefCandidate(root?.artifact_ref, addCandidate, 1);
  addArtifactRefCandidate(root?.artifact_refs, addCandidate, 1);
  addArtifactRefCandidate(root?._artifact_ref, addCandidate, 1);
  addArtifactRefCandidate(root?.frame?.artifact_ref, addCandidate, 1);
  addArtifactRefCandidate(root?.frame?.artifact_refs, addCandidate, 1);
  addArtifactRefCandidate(root?.frame?._artifact_ref, addCandidate, 1);
  addArtifactRefCandidate(root?.model_image_attachment?.artifact, addCandidate, 1);
}

function addArtifactRefCandidate(ref, addCandidate, priority) {
  if (!ref) return;
  if (Array.isArray(ref)) {
    for (const item of ref) addArtifactRefCandidate(item, addCandidate, priority);
    return;
  }
  if (typeof ref === "string") {
    addCandidate({ path: ref }, priority);
    return;
  }
  if (typeof ref !== "object") return;
  addCandidate({
    path: ref.path,
    absolutePath: ref.absolute_path,
    mimeType: ref.mime_type,
    source: ref.frame_source || ref.visualizer || ref.source,
    preset: ref.preset || ref.name,
  }, priority);
}

function addExplicitCaptureCandidates(root, addCandidate) {
  addCaptureRecordCandidates(root?.capture, addCandidate);
  addCaptureRecordCandidates(root?.captures, addCandidate);
  addCaptureRecordCandidates(root?.frame?.capture, addCandidate);
  addCaptureRecordCandidates(root?.frame?.captures, addCandidate);
}

function addCaptureRecordCandidates(value, addCandidate) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) addCaptureRecordCandidates(item, addCandidate);
    return;
  }
  if (typeof value !== "object") return;
  addCandidate({
    path: value.path,
    absolutePath: value.absolute_path,
    mimeType: value.mime_type,
    source: value.channel || value.frame_source || value.visualizer || value.source,
    preset: value.profile?.preset || value.preset || value.name,
  }, 3);
  addCaptureRecordCandidates(value.capture, addCandidate);
  addCaptureRecordCandidates(value.captures, addCandidate);
}

function eventPayloadRoots(event) {
  const roots = [];
  const push = (value) => {
    if (value && typeof value === "object") roots.push(value);
  };
  push(event);
  push(event?.arguments);
  push(event?.result);
  push(event?.result?.structuredContent);
  push(event?.result?.structuredContent?.result);
  push(event?.result?.result);
  if (Array.isArray(event?.result?.content)) {
    for (const part of event.result.content) {
      if (part?.structuredContent) push(part.structuredContent);
      if (typeof part?.text === "string") {
        const parsed = parseJsonMaybe(part.text);
        push(parsed);
      }
    }
  }
  return roots;
}

function parseJsonMaybe(text) {
  const value = String(text || "").trim();
  if (!value || !/^[\[{]/.test(value)) return null;
  if (value.length > 60000) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeStagePosition(value) {
  if (!value || typeof value !== "object") return null;
  const x = firstFiniteNumber(value.X, value.x, value[0]);
  const y = firstFiniteNumber(value.Y, value.y, value[1]);
  const z = firstFiniteNumber(value.Z, value.z, value[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    X: Math.trunc(x),
    Y: Math.trunc(y),
    ...(Number.isFinite(z) ? { Z: Math.trunc(z) } : {}),
  };
}

function formatStagePosition(position) {
  if (!position) return "";
  const z = Number.isFinite(Number(position.Z)) ? `, Z ${Math.trunc(position.Z)}` : "";
  return `X ${Math.trunc(position.X)}, Y ${Math.trunc(position.Y)}${z}`;
}

function eventToolLine(event) {
  if (!event?.tool) return "";
  return `${event.tool}${event.via ? ` via ${event.via}` : ""}`;
}

function eventTimeLabel(event) {
  if (event?.ts) return String(event.ts).replace("T", " ").replace(/\.\d+.*$/, " UTC");
  const t = Number(event?.t);
  if (Number.isFinite(t)) return new Date(t * 1000).toISOString().replace("T", " ").replace(/\.\d+.*$/, " UTC");
  return "";
}

function drawTimelineActiveTicks(ctx, layout, frames, count) {
  if (!Array.isArray(frames) || !frames.length) return;
  ctx.save();
  const maxActive = Math.max(1, ...frames.map((frame) => Number(frame?.summary?.active_count || 0)));
  const tickHeight = Math.max(8, Math.min(18, layout.height - layout.axisY - 54));
  const tickBaseY = Math.min(layout.height - 10, layout.axisY + 47);
  const barWidth = Math.max(1.5, Math.min(5, layout.trackWidth / Math.max(1, layout.visibleFrames)));
  ctx.fillStyle = "rgba(100, 210, 255, 0.56)";
  const step = Math.max(1, Math.ceil(count / Math.max(1, layout.trackWidth)));
  const firstIndex = Math.max(0, Math.floor(layout.startFrame));
  const lastIndex = Math.min(frames.length - 1, Math.ceil(layout.endFrame));
  for (let index = firstIndex; index <= lastIndex; index += step) {
    const frame = frames[index];
    const frameIndex = Number(frame?.index);
    if (!Number.isFinite(frameIndex)) continue;
    const active = Number(frame?.summary?.active_count || 0);
    if (active <= 0) continue;
    const x = clamp(timelineXForFrame(layout, frameIndex), layout.left + barWidth / 2, layout.left + layout.trackWidth - barWidth / 2);
    const h = Math.max(2, tickHeight * Math.sqrt(active / maxActive));
    ctx.fillRect(x - barWidth / 2, tickBaseY - h, barWidth, h);
  }
  ctx.restore();
}

function selectedTimelineDropletId() {
  const raw = state.timeline.selectedDropletId;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function drawSelectedDropletTimeline(ctx, layout, scene) {
  const dropletId = selectedTimelineDropletId();
  if (dropletId === null) return;
  const detail = selectedDropletTimelineDetail(scene, dropletId);
  if (!detail || !detail.frames.length) return;
  ctx.save();
  const lifeStart = Math.max(layout.startFrame, detail.firstFrame);
  const lifeEnd = Math.min(layout.endFrame, detail.lastFrame);
  if (lifeEnd >= lifeStart) {
    const x0 = timelineXForFrame(layout, lifeStart);
    const x1 = timelineXForFrame(layout, lifeEnd);
    const y = layout.top - 6;
    const h = Math.max(1, layout.axisY - layout.top + 12);
    const gradient = ctx.createLinearGradient(x0, 0, x1, 0);
    gradient.addColorStop(0, "rgba(255, 214, 10, 0.08)");
    gradient.addColorStop(0.5, "rgba(255, 214, 10, 0.2)");
    gradient.addColorStop(1, "rgba(255, 214, 10, 0.08)");
    roundedRect(ctx, x0, y, Math.max(4, x1 - x0), h, 7);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 214, 10, 0.42)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  for (const marker of detail.markers) {
    if (marker.frame < layout.startFrame || marker.frame > layout.endFrame) continue;
    const x = timelineXForFrame(layout, marker.frame);
    ctx.beginPath();
    ctx.arc(x, layout.top - 7, marker.kind === "created" ? 5 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = marker.kind === "created" ? "rgba(48, 209, 88, 0.95)" : "rgba(255, 69, 58, 0.95)";
    ctx.fill();
    ctx.strokeStyle = "#f5f5f7";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.restore();
}

function renderTimelineDropletPanel(scene) {
  const panel = $("timelineDropletPanel");
  if (!panel) return;
  const dropletId = selectedTimelineDropletId();
  if (dropletId === null || !scene?.available) {
    panel.closest(".plan-timeline-panel")?.classList.remove("has-droplet-panel");
    panel.hidden = true;
    panel.replaceChildren();
    return;
  }
  const detail = selectedDropletTimelineDetail(scene, dropletId);
  if (!detail || !detail.frames.length) {
    panel.closest(".plan-timeline-panel")?.classList.remove("has-droplet-panel");
    panel.hidden = true;
    panel.replaceChildren();
    return;
  }

  panel.closest(".plan-timeline-panel")?.classList.add("has-droplet-panel");
  panel.hidden = false;
  panel.replaceChildren();

  const header = document.createElement("div");
  header.className = "timeline-droplet-header";
  const title = document.createElement("strong");
  title.textContent = `Droplet ${dropletId}`;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "x";
  close.setAttribute("aria-label", "Clear selected droplet");
  close.addEventListener("click", () => {
    setMatrixSelectedDropletIds([]);
    renderMatrixPanel(state.live || {});
    schedulePlanTimelineRender();
  });
  header.append(title, close);

  const facts = document.createElement("div");
  facts.className = "timeline-droplet-facts";
  facts.append(
    dropletFact("Created", `F${detail.createdFrame + 1}`),
    dropletFact(detail.erasedFrame === null ? "Active" : "Erased", detail.erasedFrame === null ? `Through F${detail.lastFrame + 1}` : `F${detail.erasedFrame + 1}`),
  );

  const list = document.createElement("div");
  list.className = "timeline-droplet-actions";
  for (const action of detail.actions) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "timeline-droplet-action";
    row.addEventListener("click", () => {
      const frame = Number(action.startFrame);
      if (!Number.isFinite(frame)) return;
      state.timeline.followLive = false;
      markTimelineManualPreview(scene);
      state.timeline.selectedFrame = frame;
      state.timeline.selectedTime = timelineTimeForFrameFromScene(scene, frame);
      ensureTimelineFrameVisible(frame, timelineFrameCount(scene));
      renderMatrixPanel(state.live || {});
      schedulePlanTimelineRender();
    });
    row.addEventListener("mouseenter", () => {
      state.matrixPaths.hoveredActionId = String(action.id || "");
      if (state.matrixPaths.hoveredActionId) {
        scheduleMatrixSceneRender(null, { skipPathPanel: true });
      }
    });
    row.addEventListener("mouseleave", () => {
      if (state.matrixPaths.hoveredActionId === String(action.id || "")) {
        state.matrixPaths.hoveredActionId = "";
        scheduleMatrixSceneRender(null, { skipPathPanel: true });
      }
    });
    const label = document.createElement("span");
    label.textContent = action.label;
    const meta = document.createElement("code");
    meta.textContent = action.spanText;
    row.append(label, meta);
    if (action.meta) row.title = action.meta;
    list.appendChild(row);
  }
  if (!detail.actions.length) {
    const empty = document.createElement("span");
    empty.className = "timeline-droplet-empty";
    empty.textContent = "No logged actions";
    list.appendChild(empty);
  }

  panel.append(header, facts, list);
}

function syncTimelineDropletPanelLayout(scene) {
  const panel = $("timelineDropletPanel");
  const shell = panel?.closest(".plan-timeline-panel");
  if (!panel || !shell) return;
  const dropletId = selectedTimelineDropletId();
  const visible = dropletId !== null
    && scene?.available
    && Boolean(selectedDropletTimelineDetail(scene, dropletId)?.frames?.length);
  shell.classList.toggle("has-droplet-panel", visible);
  if (!visible) {
    panel.hidden = true;
    panel.replaceChildren();
  }
}

function dropletFact(label, value) {
  const item = document.createElement("span");
  const key = document.createElement("small");
  key.textContent = label;
  const text = document.createElement("b");
  text.textContent = value;
  item.append(key, text);
  return item;
}

function selectedDropletTimelineDetail(scene, dropletId) {
  const timeline = effectiveTimeline(scene);
  const count = timelineFrameCount(scene);
  if (!timeline || !count) return null;

  const frames = [];
  for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
    if (timelineFrameHasDroplet(scene, frameIndex, dropletId)) frames.push(frameIndex);
  }
  if (!frames.length) return null;

  const firstFrame = frames[0];
  const lastFrame = frames[frames.length - 1];
  const activeAtEnd = lastFrame >= count - 1;
  const createdFrame = explicitDropletLifecycleFrame(scene, dropletId, "created") ?? firstFrame;
  const erasedFrame = activeAtEnd
    ? null
    : explicitDropletLifecycleFrame(scene, dropletId, "erased") ?? Math.min(count - 1, lastFrame + 1);
  const markers = [
    { kind: "created", frame: createdFrame },
    ...(erasedFrame === null ? [] : [{ kind: "erased", frame: erasedFrame }]),
  ];

  const actionsByKey = new Map();
  for (const action of matrixTimelineActions(scene)) {
    if (!timelineEventMentionsDroplet(action, dropletId)) continue;
    addSelectedDropletAction(actionsByKey, action, "action", scene);
  }
  for (const event of timeline.events || []) {
    if (!timelineEventMentionsDroplet(event, dropletId)) continue;
    addSelectedDropletAction(actionsByKey, event, "event", scene);
  }

  const actions = [...actionsByKey.values()]
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame)
    .map((action) => ({
      ...action,
      spanText: action.startFrame === action.endFrame
        ? `F${action.startFrame + 1}`
        : `F${action.startFrame + 1}-${action.endFrame + 1}`,
    }));

  return { dropletId, frames, firstFrame, lastFrame, createdFrame, erasedFrame, activeAtEnd, markers, actions };
}

function explicitDropletLifecycleFrame(scene, dropletId, kind) {
  const items = [
    ...matrixTimelineActions(scene),
    ...effectiveTimeline(scene)?.events || [],
  ];
  const matches = items
    .filter((item) => timelineEventMentionsDroplet(item, dropletId))
    .filter((item) => kind === "created" ? timelineItemCreatesDroplet(item, dropletId) : timelineItemErasesDroplet(item, dropletId))
    .map((item) => lifecycleFrameFromItem(item, kind))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return matches.length ? Math.trunc(matches[0]) : null;
}

function lifecycleFrameFromItem(item, kind) {
  const span = item?.frame_span;
  if (!Array.isArray(span) || span.length < 2) return Number(item?.index);
  const start = Number(span[0]);
  const end = Number(span[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return kind === "created" ? Math.min(start, end) : Math.max(start, end);
}

function timelineItemCreatesDroplet(item, dropletId) {
  const type = String(item?.type || item?.label || "").toLowerCase();
  const data = item?.data || {};
  if (valueContainsDropletId(data.new_droplet_id, dropletId) || valueContainsDropletId(data.new_droplet_ids, dropletId)) return true;
  if (valueContainsDropletId(data.created_droplet_id, dropletId) || valueContainsDropletId(data.created_droplet_ids, dropletId)) return true;
  return type.includes("create") && timelineEventMentionsDroplet(item, dropletId);
}

function timelineItemErasesDroplet(item, dropletId) {
  const type = String(item?.type || item?.label || "").toLowerCase();
  const data = item?.data || {};
  if (type.includes("delete")) return timelineEventMentionsDroplet(item, dropletId);
  if (!type.includes("merge")) return false;
  if (valueContainsDropletId(data.new_droplet_id, dropletId) || valueContainsDropletId(data.new_droplet_ids, dropletId)) return false;
  return timelineEventMentionsDroplet(item, dropletId);
}

function valueContainsDropletId(value, dropletId) {
  const ids = new Set();
  collectDropletIds(value, ids, "droplet_id", 0, true);
  return ids.has(Number(dropletId));
}

function timelineFrameHasDroplet(scene, frameIndex, dropletId) {
  const frame = timelineFrame(scene, frameIndex);
  const frameIds = new Set();
  for (const id of frame?.active_droplet_ids || []) {
    const number = Number(id);
    if (Number.isFinite(number)) frameIds.add(number);
  }
  for (const droplet of frame?.droplets || []) {
    const number = Number(droplet?.id);
    if (Number.isFinite(number)) frameIds.add(number);
  }
  if (frameIds.has(Number(dropletId))) return true;
  return dropletsAtTimelineFrame(scene, frameIndex).some((droplet) => Number(droplet?.id) === Number(dropletId));
}

function addSelectedDropletAction(actionsByKey, item, source, scene) {
  const span = Array.isArray(item?.frame_span) && item.frame_span.length >= 2
    ? item.frame_span
    : [item?.index ?? 0, item?.index ?? 0];
  const startFrame = Number(span[0]);
  const endFrame = Number(span[1]);
  if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame)) return;
  const id = timelineActionVisualId(item, scene) ?? `${source}-${startFrame}-${endFrame}-${item?.type || item?.label || "action"}`;
  const key = `${id}:${startFrame}:${endFrame}:${item?.type || item?.label || source}`;
  if (actionsByKey.has(key)) return;
  const label = formatTimelineEventType(item?.type || item?.label, item?.data || {});
  const meta = timelineEventMetaLines(item).join("\n");
  actionsByKey.set(key, {
    id,
    label,
    startFrame: Math.trunc(Math.min(startFrame, endFrame)),
    endFrame: Math.trunc(Math.max(startFrame, endFrame)),
    meta,
  });
}

function timelineActionVisualId(item, scene) {
  if (item?.id !== undefined && item?.id !== null) return item.id;
  const eventId = item?.event_id;
  if (eventId === undefined || eventId === null) return null;
  const matchingAction = matrixTimelineActions(scene).find((action) => String(action?.event_id) === String(eventId));
  return matchingAction?.id ?? eventId;
}

function timelineEventMentionsDroplet(event, dropletId) {
  if (dropletId === null || dropletId === undefined) return false;
  const target = Number(dropletId);
  if (!Number.isFinite(target)) return false;
  const ids = new Set();
  collectDropletIds(event, ids);
  return ids.has(target);
}

function collectDropletIds(value, ids, key = "", depth = 0, dropletContext = false) {
  if (value === undefined || value === null || depth > 8) return;
  const normalizedKey = String(key || "").toLowerCase();
  const nextDropletContext = dropletContext || normalizedKey.includes("droplet");
  const dropletIdKey = normalizedKey === "droplet_id"
    || normalizedKey === "droplet_ids"
    || normalizedKey === "new_droplet_id"
    || normalizedKey === "new_droplet_ids"
    || normalizedKey === "reservoir_droplet_id"
    || normalizedKey.endsWith("_droplet_id")
    || normalizedKey.endsWith("_droplet_ids")
    || (dropletContext && (normalizedKey === "id" || normalizedKey.endsWith("_id") || normalizedKey.endsWith("_ids")));
  if (Array.isArray(value)) {
    if (dropletIdKey && value.every((item) => !Array.isArray(item) && (typeof item !== "object" || item === null))) {
      for (const item of value) addDropletId(ids, item);
    }
    for (const item of value) collectDropletIds(item, ids, "", depth + 1, nextDropletContext);
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectDropletIds(childValue, ids, childKey, depth + 1, nextDropletContext);
    }
    return;
  }
  if (dropletIdKey) addDropletId(ids, value);
}

function addDropletId(ids, value) {
  const number = Number(value);
  if (Number.isFinite(number)) ids.add(number);
}

function timelineEventColor(type, alpha = 1) {
  const key = String(type || "action").toLowerCase();
  if (key.includes("execution_tool")) return `rgba(48, 209, 88, ${alpha})`;
  if (key.includes("planned_")) return `rgba(100, 210, 255, ${alpha})`;
  if (key.includes("plan_tool")) return `rgba(100, 210, 255, ${alpha})`;
  if (key.includes("merge")) return `rgba(255, 159, 10, ${alpha})`;
  if (key.includes("split") || key.includes("extraction")) return `rgba(191, 90, 242, ${alpha})`;
  if (key.includes("move")) return `rgba(100, 210, 255, ${alpha})`;
  if (key.includes("delete")) return `rgba(255, 69, 58, ${alpha})`;
  if (key.includes("create")) return `rgba(48, 209, 88, ${alpha})`;
  return `rgba(245, 245, 247, ${alpha})`;
}

function selectTimelineFrameFromEvent(event) {
  const canvas = $("planTimeline");
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!canvas || !count) return;
  const rect = canvas.getBoundingClientRect();
  const layout = cachedTimelineLayout(canvas, scene, count)
    || timelineLayout(rect.width || canvas.clientWidth || 1, rect.height || canvas.clientHeight || 1, count, scene);
  const time = timelineTimeForX(layout, event.clientX - rect.left);
  const frame = timelineFrameForTime(layout, time);
  state.timeline.followLive = false;
  markTimelineManualPreview(scene);
  state.timeline.selectedTime = time;
  state.timeline.selectedFrame = frame;
  ensureTimelineTimeVisible(time, scene, count);
  renderMatrixPanel(state.live || {});
  if (!renderTimelineHoverCursorFast(scene, { updateControls: true })) schedulePlanTimelineRender();
}

function scheduleTimelineHoverFromEvent(event) {
  state.timeline.pendingHover = {
    clientX: event.clientX,
    clientY: event.clientY,
  };
  if (state.timeline.hoverRaf !== null) return;
  state.timeline.hoverRaf = requestAnimationFrame(() => {
    state.timeline.hoverRaf = null;
    const pending = state.timeline.pendingHover;
    state.timeline.pendingHover = null;
    if (!pending) return;
    updateTimelineHoverFromEvent(pending);
  });
}

function cancelScheduledTimelineHover() {
  if (state.timeline.hoverRaf !== null) {
    cancelAnimationFrame(state.timeline.hoverRaf);
    state.timeline.hoverRaf = null;
  }
  state.timeline.pendingHover = null;
}

function updateTimelineHoverFromEvent(event) {
  const canvas = $("planTimeline");
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!canvas || !count) return;
  const rect = canvas.getBoundingClientRect();
  const layout = cachedTimelineLayout(canvas, scene, count)
    || timelineLayout(rect.width || canvas.clientWidth || 1, rect.height || canvas.clientHeight || 1, count, scene);
  const hover = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  state.timeline.hoverTime = timelineTimeForX(layout, hover.x);
  state.timeline.hoverFrame = timelineFrameForTime(layout, state.timeline.hoverTime);
  state.timeline.hoverX = hover.x;
  state.timeline.hoverY = hover.y;
  const hitKey = [
    Math.round(hover.x),
    Math.round(hover.y),
    state.timeline.canvasBaseCache?.key || "",
    state.timelineOverlayHitboxes?.length || 0,
    state.timelineHitboxes?.length || 0,
  ].join("|");
  if (hitKey !== state.timeline.hoverHitKey) {
    const hit = topTimelineHitboxAt(hover, state.timelineOverlayHitboxes, state.timelineHitboxes);
    state.timeline.hoverOverlay = hit?.overlay || null;
    state.timeline.hoverEvent = hit?.overlay ? null : (hit?.event || null);
    state.timeline.hoverHitKey = hitKey;
  }
  if (!renderTimelineHoverCursorFast(scene)) schedulePlanTimelineRender();
  updateTimelineHover(hover);
}

function topTimelineHitboxAt(point, ...groups) {
  let best = null;
  let bestOrder = -1;
  let order = 0;
  for (const group of groups) {
    for (const box of group || []) {
      if (!matrixHitboxContains(box, point)) {
        order += 1;
        continue;
      }
      if (!best || compareTimelineHitbox(box, best, order, bestOrder) < 0) {
        best = box;
        bestOrder = order;
      }
      order += 1;
    }
  }
  return best;
}

function compareTimelineHitbox(a, b, orderA = 0, orderB = 0) {
  const z = Number(b?.z || 0) - Number(a?.z || 0);
  if (z) return z;
  const y = Number(a?.y || 0) - Number(b?.y || 0);
  if (y) return y;
  const h = Number(b?.h || 0) - Number(a?.h || 0);
  if (h) return h;
  return Number(orderA || 0) - Number(orderB || 0);
}

function updateTimelineHover(hover) {
  const tooltip = $("timelineHover");
  if (!tooltip) return;
  const overlay = state.timeline.hoverOverlay;
  const event = state.timeline.hoverEvent;
  if (!hover || (!event && !overlay)) {
    tooltip.classList.remove("overlay");
    tooltip.hidden = true;
    state.timeline.hoverContentKey = "";
    state.timeline.hoverHitKey = "";
    state.timeline.hoverTooltipWidth = 0;
    state.timeline.hoverTooltipHeight = 0;
    return;
  }
  const contentKey = timelineHoverContentKey(event, overlay);
  const contentChanged = contentKey !== state.timeline.hoverContentKey;
  if (contentChanged) {
    const label = overlay?.label || formatTimelineEventType(event.type, event.data);
    const span = overlay ? timelineOverlaySpanText(overlay) : timelineEventSpanText(event);
    const metaLines = overlay ? (overlay.lines || []) : timelineEventMetaLines(event);
    const previewHtml = timelineOverlayPreviewHtml(overlay);
    tooltip.classList.toggle("overlay", Boolean(overlay));
    tooltip.classList.toggle("has-preview", Boolean(previewHtml));
    tooltip.innerHTML = [
      `<strong>${escapeHtml(label)}</strong>`,
      `<span>${escapeHtml(span)}</span>`,
      ...metaLines.map((line) => timelineHoverLineHtml(line)),
      previewHtml,
    ].join("");
    installTimelineHoverMediaHandlers(tooltip);
    state.timeline.hoverContentKey = contentKey;
    tooltip.hidden = false;
    state.timeline.hoverTooltipWidth = tooltip.offsetWidth;
    state.timeline.hoverTooltipHeight = tooltip.offsetHeight;
  }
  if (tooltip.hidden) tooltip.hidden = false;
  positionTimelineHover(tooltip, hover);
}

function timelineHoverLineHtml(line) {
  const text = String(line || "");
  const clickHint = /^click\b/i.test(text) || /reveal (?:the )?(?:image )?file/i.test(text);
  return `<span${clickHint ? ` class="timeline-click-hint"` : ""}>${escapeHtml(text)}</span>`;
}

function installTimelineHoverMediaHandlers(tooltip) {
  for (const image of tooltip.querySelectorAll("img.timeline-photo-preview")) {
    image.addEventListener("load", () => refreshTimelineHoverPosition(), { once: true });
    image.addEventListener("error", () => {
      image.replaceWith(timelinePreviewErrorNode());
      refreshTimelineHoverPosition();
    }, { once: true });
  }
}

function timelinePreviewErrorNode() {
  const node = document.createElement("span");
  node.className = "timeline-preview-error";
  node.textContent = "Preview unavailable";
  return node;
}

function refreshTimelineHoverPosition() {
  const tooltip = $("timelineHover");
  if (!tooltip || tooltip.hidden) return;
  state.timeline.hoverTooltipWidth = tooltip.offsetWidth;
  state.timeline.hoverTooltipHeight = tooltip.offsetHeight;
  if (timelineHasFiniteNumber(state.timeline.hoverX) && timelineHasFiniteNumber(state.timeline.hoverY)) {
    positionTimelineHover(tooltip, { x: state.timeline.hoverX, y: state.timeline.hoverY });
  }
}

function positionTimelineHover(tooltip, hover) {
  const canvas = $("planTimeline");
  const panel = canvas?.closest(".plan-timeline-panel");
  const panelRect = panel?.getBoundingClientRect?.();
  const baseX = (canvas?.offsetLeft || 0) + hover.x;
  const baseY = (canvas?.offsetTop || 0) + hover.y;
  const tooltipWidth = state.timeline.hoverTooltipWidth || tooltip.offsetWidth || 0;
  const tooltipHeight = state.timeline.hoverTooltipHeight || tooltip.offsetHeight || 0;
  const minX = panelRect ? 8 - panelRect.left : 8;
  const maxX = panelRect
    ? Math.max(minX, window.innerWidth - panelRect.left - tooltipWidth - 8)
    : Math.max(8, (panel?.clientWidth || 260) - tooltipWidth - 8);
  const minY = panelRect ? 8 - panelRect.top : 8;
  const maxY = panelRect
    ? Math.max(minY, window.innerHeight - panelRect.top - tooltipHeight - 8)
    : Math.max(8, (panel?.clientHeight || 220) - tooltipHeight - 8);
  const previewOffset = tooltip.classList.contains("has-preview") ? 24 : 12;
  const preferredX = baseX + previewOffset;
  const flippedX = baseX - tooltipWidth - previewOffset;
  const left = preferredX + tooltipWidth <= maxX
    ? preferredX
    : Math.max(minX, flippedX);
  const preferredY = baseY + 12;
  const flippedY = baseY - tooltipHeight - 12;
  const top = preferredY > maxY ? Math.min(maxY, Math.max(minY, flippedY)) : preferredY;
  tooltip.style.left = `${Math.min(maxX, Math.max(minX, left))}px`;
  tooltip.style.top = `${Math.min(maxY, Math.max(minY, top))}px`;
}

function timelineHoverContentKey(event, overlay) {
  if (overlay) {
    return [
      "overlay",
      overlay.kind || "",
      overlay.hoverKey || "",
      overlay.id || "",
      overlay.time ?? overlay.t ?? "",
      overlay.value ?? "",
      overlay.photo?.path || overlay.photo?.absolutePath || overlay.photo?.absolute_path || "",
    ].join("|");
  }
  if (!event) return "";
  return [
    "event",
    event.id || event.event_id || "",
    event.type || "",
    event.t ?? event.ts ?? "",
    event.start_time ?? "",
    event.end_time ?? "",
    Array.isArray(event.frame_span) ? event.frame_span.join("-") : "",
  ].join("|");
}

function timelineOverlayPreviewHtml(overlay) {
  if (overlay?.kind !== "photo") return "";
  const url = timelinePhotoArtifactUrl(overlay.photo);
  if (!url || !timelinePhotoLooksLikeImage(overlay.photo)) return "";
  const alt = overlay.photo?.preset
    ? `Photo preview ${overlay.photo.preset}`
    : "Photo preview";
  return `<img class="timeline-photo-preview" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
}

function timelinePhotoLooksLikeImage(photo) {
  const mime = String(photo?.mimeType || photo?.mime_type || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  const path = String(photo?.path || photo?.absolutePath || photo?.absolute_path || "").toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)($|\?)/.test(path);
}

function timelinePhotoArtifactUrl(photo) {
  const runId = state.selectedRunId || state.status?.run_id || "";
  const path = String(photo?.path || "").trim();
  const absolutePath = String(photo?.absolutePath || photo?.absolute_path || "").trim();
  if (!runId || (!path && !absolutePath)) return "";
  const params = new URLSearchParams({ run_id: runId });
  if (path) params.set("path", path);
  if (absolutePath) params.set("absolute_path", absolutePath);
  return `/run-artifact?${params.toString()}`;
}

function handleTimelineMarkerClick(event) {
  const overlay = timelinePhotoOverlayFromPointerEvent(event);
  if (!overlay) return false;
  revealTimelinePhoto(overlay.photo);
  return true;
}

function timelinePhotoOverlayFromPointerEvent(event) {
  const overlay = timelineOverlayFromPointerEvent(event);
  return overlay?.kind === "photo" && overlay.photo ? overlay : null;
}

function timelineOverlayFromPointerEvent(event) {
  const canvas = $("planTimeline");
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const point = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  const hit = topTimelineHitboxAt(point, state.timelineOverlayHitboxes, state.timelineHitboxes);
  return hit?.overlay || null;
}

function revealTimelinePhoto(photo) {
  const path = String(photo?.path || "").trim();
  const absolutePath = String(photo?.absolutePath || photo?.absolute_path || "").trim();
  if (!path && !absolutePath) {
    appendEvent({
      ts: new Date().toISOString(),
      type: "ui_error",
      level: "warning",
      message: "Photo marker has no saved file path",
    });
    return;
  }
  send({
    type: "reveal_artifact",
    run_id: state.selectedRunId || state.status?.run_id || "",
    path,
    absolute_path: absolutePath,
  });
}

function handleArtifactRevealResult(result) {
  if (result?.ok !== false) return;
  appendEvent({
    ts: new Date().toISOString(),
    type: "ui_error",
    level: "warning",
    message: result?.error || "Could not reveal artifact",
  });
}

function timelineOverlaySpanText(overlay) {
  if (overlay?.kind === "idle_gap") {
    const start = Number(overlay.startTime);
    const end = Number(overlay.endTime);
    const duration = Number(overlay.durationSeconds);
    return `${eventTimeLabel({ t: start })} to ${eventTimeLabel({ t: end })} | skipped ${formatRelativeSeconds(duration)}`;
  }
  if (overlay?.kind === "timeline_stop") {
    const start = Number(overlay.startTime);
    const end = Number(overlay.endTime);
    if (overlay.active || !Number.isFinite(end)) {
      return Number.isFinite(start) ? `Recording stopped at ${eventTimeLabel({ t: start })}` : "Recording stopped";
    }
    const duration = Number(overlay.durationSeconds);
    const durationText = Number.isFinite(duration) ? formatRelativeSeconds(duration) : formatRelativeSeconds(end - start);
    return `${eventTimeLabel({ t: start })} to ${eventTimeLabel({ t: end })} | ${durationText}`;
  }
  const frame = Number(overlay?.frame);
  const time = Number(overlay?.time);
  if (Number.isFinite(frame) && Number.isFinite(time)) {
    return `Frame ${Math.round(frame) + 1} | ${eventTimeLabel({ t: time })}`;
  }
  if (Number.isFinite(time)) return eventTimeLabel({ t: time });
  return Number.isFinite(frame) ? `Frame ${Math.round(frame) + 1}` : "Timeline marker";
}

function timelineEventSpanText(event) {
  const span = event?.frame_span;
  if (!Array.isArray(span) || span.length < 2) return "Frames unavailable";
  const start = Number(span[0]);
  const end = Number(span[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Frames unavailable";
  if (start === end) return `Frame ${Math.trunc(start) + 1}`;
  return `Frames ${Math.trunc(Math.min(start, end)) + 1}-${Math.trunc(Math.max(start, end)) + 1}`;
}

function timelineEventMetaLines(event) {
  const data = event?.data || {};
  const lines = [];
  const droplets = Array.isArray(event?.droplet_ids) && event.droplet_ids.length
    ? event.droplet_ids
    : data.new_droplet_ids || data.droplet_ids || data.droplet_id;
  const dropletText = formatTimelineMetaValue(droplets);
  const showedDroplets = Boolean(dropletText);
  if (dropletText) lines.push(`Droplets ${dropletText}`);
  for (const key of timelinePreferredMetaKeys(data)) {
    if (showedDroplets && ["droplet_id", "droplet_ids", "new_droplet_id", "new_droplet_ids"].includes(key)) continue;
    const value = data[key];
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${formatTimelineMetaKey(key)} ${formatTimelineMetaValue(value)}`);
    if (lines.length >= 6) break;
  }
  return lines;
}

function timelinePreferredMetaKeys(data) {
  const preferred = [
    "primitive",
    "split_mode",
    "reservoir_droplet_id",
    "new_droplet_ids",
    "steps",
    "split_size",
    "linear_drops_number",
    "linear_direction",
    "linear_space_per_col",
    "linear_space_per_row",
    "linear_offset",
    "linear_vital_space",
    "mode",
    "target",
  ];
  const seen = new Set(preferred);
  const rest = Object.keys(data || {})
    .filter((key) => !seen.has(key) && !["event_id", "frame_span"].includes(key))
    .sort();
  return [...preferred, ...rest];
}

function formatTimelineMetaKey(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTimelineMetaValue(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const rendered = value.map((item) => formatTimelineMetaValue(item)).join(", ");
    return `[${shortText(rendered, 80)}]`;
  }
  if (typeof value === "object") {
    try {
      return shortText(JSON.stringify(value), 90);
    } catch {
      return shortText(String(value), 90);
    }
  }
  return shortText(String(value), 90);
}

function timelineLiveBootstrapKey() {
  return state.status?.run_id || state.selectedRunId || "active";
}

function resetTimelineLiveBootstrap() {
  state.timeline.liveBootstrappedRunId = "";
  state.timeline.manualPreviewExecutionKey = "";
  state.timeline.manualPreviewAt = 0;
}

function bootstrapTimelineLiveFromScene(scene) {
  if (!scene?.available) return;
  maybeAutoFollowActiveExecution(scene);
  const key = timelineLiveBootstrapKey();
  if (state.timeline.liveBootstrappedRunId === key) return;

  const userIsPreviewing =
    !state.timeline.followLive &&
    (timelineHasFiniteNumber(state.timeline.selectedFrame) ||
      timelineHasFiniteNumber(state.timeline.selectedTime));
  if (!userIsPreviewing) {
    resetTimelineLiveState(scene);
  }
  state.timeline.liveBootstrappedRunId = key;
}

function timelineActiveExecution(scene) {
  const executor = scene?.executor || scene?.executor_status || {};
  return Boolean(
    executor.is_executing ||
      executor.running ||
      executor.executing ||
      executor.execution_running,
  );
}

function timelineExecutionKey(scene) {
  const executor = scene?.executor || scene?.executor_status || {};
  const applied = executor.last_applied_frame || scene?.last_applied_frame || {};
  const plan = scene?.plan || {};
  const frame = scene?.frame || {};
  const active = timelineActiveExecution(scene) ? "active" : "idle";
  const runId = state.status?.run_id || state.selectedRunId || "active";
  const planId = applied.plan_id || frame.plan_id || plan.plan_id || plan.id || "";
  const totalFrames = executor.total_frames || frame.count || plan.frame_count || timelineFrameCount(scene) || "";
  return [runId, active, planId, totalFrames].join("|");
}

function markTimelineManualPreview(scene = state.live?.scene?.result || state.live?.scene) {
  state.timeline.manualPreviewExecutionKey = timelineExecutionKey(scene);
  state.timeline.manualPreviewAt = performance.now();
}

function maybeAutoFollowActiveExecution(scene) {
  if (!scene?.available || state.timeline.followLive || !timelineActiveExecution(scene)) return;
  if (state.timeline.dragging || state.timeline.rangeDrag?.active) return;
  const key = timelineExecutionKey(scene);
  const userPreviewedThisExecution = state.timeline.manualPreviewExecutionKey === key;
  const manualPreviewAt = Number(state.timeline.manualPreviewAt || 0);
  const justPreviewed = manualPreviewAt > 0
    && performance.now() - manualPreviewAt < TIMELINE_ACTIVE_EXECUTION_AUTO_FOLLOW_GRACE_MS;
  if (userPreviewedThisExecution || justPreviewed) return;
  resetTimelineLiveState(scene);
  updateTimelineLightweightControls(scene);
  schedulePlanTimelineRender();
}

function resetTimelineLiveState(scene = null) {
  const resolvedScene = scene || state.live?.scene?.result || state.live?.scene;
  state.timeline.followLive = true;
  state.timeline.manualPreviewExecutionKey = "";
  state.timeline.manualPreviewAt = 0;
  state.timeline.dragging = false;
  state.timeline.moved = false;
  state.timeline.dragMode = "";
  const frame = liveFrameIndex(resolvedScene);
  if (timelineHasFiniteNumber(frame)) {
    state.timeline.selectedFrame = Math.trunc(Number(frame));
    state.timeline.selectedTime = timelineTimeForFrameFromScene(
      resolvedScene,
      state.timeline.selectedFrame,
    );
  } else {
    state.timeline.selectedFrame = null;
    state.timeline.selectedTime = null;
  }
  state.timeline.hoverFrame = null;
  state.timeline.hoverTime = null;
  state.timeline.hoverEvent = null;
  state.timeline.hoverOverlay = null;
}

function followLiveTimeline() {
  const scene = state.live?.scene?.result || state.live?.scene;
  resetTimelineLiveState(scene);
  if (timelineHasFiniteNumber(state.timeline.selectedFrame)) {
    ensureTimelineFrameVisible(state.timeline.selectedFrame, timelineFrameCount(scene));
  }
  renderMatrixPanel(state.live || {});
  schedulePlanTimelineRender();
}

function ensureTimelineFrameVisible(frame, count) {
  if (!Number.isFinite(Number(frame)) || !count) return;
  const scene = state.live?.scene?.result || state.live?.scene;
  const time = timelineTimeForFrameFromScene(scene, frame);
  if (Number.isFinite(Number(time))) {
    ensureTimelineTimeVisible(Number(time), scene, count);
    return;
  }
  syncTimelineViewport(count);
  const visible = timelineVisibleFrames(count);
  if (frame < state.timeline.offsetFrame) state.timeline.offsetFrame = frame;
  else if (frame > state.timeline.offsetFrame + visible - 1) state.timeline.offsetFrame = frame - visible + 1;
  state.timeline.offsetFrame = clamp(state.timeline.offsetFrame, 0, Math.max(0, count - visible));
}

function ensureTimelineTimeVisible(time, scene, count) {
  if (!Number.isFinite(Number(time)) || !count) return;
  const timeline = effectiveTimeline(scene);
  const range = timelineDisplayTimeRange(scene, timeline, count);
  syncTimelineViewport(count, range);
  const visible = timelineVisibleTimeRange(range);
  if (time < visible.start) {
    state.timeline.timeOffset = Number(time) - range.start;
  } else if (time > visible.end) {
    state.timeline.timeOffset = Number(time) - range.start - visible.duration;
  }
  state.timeline.timeOffset = clamp(state.timeline.timeOffset, 0, Math.max(0, range.duration - visible.duration));
}

function dragPanTimeline(event) {
  const canvas = $("planTimeline");
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!canvas || !count) return;
  const rect = canvas.getBoundingClientRect();
  const layout = timelineLayout(rect.width || canvas.clientWidth || 1, rect.height || canvas.clientHeight || 1, count, scene);
  const secondsPerPixel = layout.visibleTimeRange.duration / Math.max(1, layout.trackWidth);
  const deltaSeconds = -(event.clientX - state.timeline.dragStartX) * secondsPerPixel;
  const maxOffset = Math.max(0, layout.fullTimeRange.duration - layout.visibleTimeRange.duration);
  state.timeline.timeOffset = clamp(state.timeline.dragStartOffsetTime + deltaSeconds, 0, maxOffset);
  schedulePlanTimelineRender();
}

function zoomStreamerFrame(event) {
  const img = $("streamerFrame");
  if (!img) return;
  const viewer = img.closest(".viewer.streamer") || img.closest(".viewer");
  const rect = (viewer || img).getBoundingClientRect();
  const bounds = streamerImageBounds(img, rect);
  const x = event.clientX - rect.left - (viewer?.clientLeft || 0);
  const y = event.clientY - rect.top - (viewer?.clientTop || 0);
  const view = state.streamerView;
  const oldZoom = Number(view.zoom) || 1;
  const nextZoom = clamp(oldZoom * Math.exp(-event.deltaY * 0.0014), 1, 12);
  if (Math.abs(nextZoom - oldZoom) < 0.001) return;
  const oldPanX = Number(view.panX) || 0;
  const oldPanY = Number(view.panY) || 0;
  const centerX = bounds.centerX;
  const centerY = bounds.centerY;
  const imageX = (x - centerX - oldPanX) / oldZoom;
  const imageY = (y - centerY - oldPanY) / oldZoom;
  view.zoom = nextZoom;
  view.panX = x - centerX - imageX * nextZoom;
  view.panY = y - centerY - imageY * nextZoom;
  clampStreamerView();
  applyStreamerView();
  saveStreamerView();
  requestStreamerResolutionUpdate();
}

function resetStreamerView() {
  state.streamerView.zoom = 1;
  state.streamerView.panX = 0;
  state.streamerView.panY = 0;
  state.streamerView.dragging = false;
  state.streamerView.moved = false;
  saveStreamerView();
}

function streamerImageBounds(img = $("streamerFrame"), rect = null) {
  const viewer = img?.closest(".viewer.streamer") || img?.closest(".viewer");
  const viewport = rect || viewer?.getBoundingClientRect();
  const viewportWidth = Math.max(1, Number(viewer?.clientWidth) || Number(viewport?.width) || 1);
  const viewportHeight = Math.max(1, Number(viewer?.clientHeight) || Number(viewport?.height) || 1);
  const naturalWidth = Math.max(1, Number(img?.naturalWidth) || viewportWidth);
  const naturalHeight = Math.max(1, Number(img?.naturalHeight) || viewportHeight);
  const scale = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
  const width = Math.max(1, naturalWidth * scale);
  const height = Math.max(1, naturalHeight * scale);
  return {
    viewportWidth,
    viewportHeight,
    width,
    height,
    x: (viewportWidth - width) / 2,
    y: (viewportHeight - height) / 2,
    centerX: viewportWidth / 2,
    centerY: viewportHeight / 2,
  };
}

function refreshStreamerViewForLayout() {
  if (!$("streamerFrame")) return;
  applyStreamerView();
  requestStreamerResolutionUpdate();
}

function clampStreamerView() {
  const img = $("streamerFrame");
  const view = state.streamerView;
  view.zoom = clamp(Number(view.zoom) || 1, 1, 12);
  if (!img) return;
  const viewer = img.closest(".viewer");
  const rect = viewer?.getBoundingClientRect();
  if (!rect) return;
  const bounds = streamerImageBounds(img, rect);
  preserveStreamerViewAcrossResize(bounds);
  if (view.zoom <= 1.001) {
    view.panX = 0;
    view.panY = 0;
    return;
  }
  const maxPanX = Math.max(0, (bounds.width * view.zoom - bounds.viewportWidth) / 2);
  const maxPanY = Math.max(0, (bounds.height * view.zoom - bounds.viewportHeight) / 2);
  view.panX = clamp(Number(view.panX) || 0, -maxPanX, maxPanX);
  view.panY = clamp(Number(view.panY) || 0, -maxPanY, maxPanY);
}

function preserveStreamerViewAcrossResize(bounds) {
  const view = state.streamerView;
  const width = Number(bounds?.width);
  const height = Number(bounds?.height);
  if (!Number.isFinite(width) || width <= 1 || !Number.isFinite(height) || height <= 1) return;

  const oldWidth = Number(view.lastRectWidth);
  const oldHeight = Number(view.lastRectHeight);
  if (Number.isFinite(oldWidth) && oldWidth > 1 && Number.isFinite(oldHeight) && oldHeight > 1) {
    if (Math.abs(width - oldWidth) > 0.5) view.panX = (Number(view.panX) || 0) * (width / oldWidth);
    if (Math.abs(height - oldHeight) > 0.5) view.panY = (Number(view.panY) || 0) * (height / oldHeight);
  }
  view.lastRectWidth = width;
  view.lastRectHeight = height;
}

function applyStreamerView() {
  const img = $("streamerFrame");
  if (!img) return;
  clampStreamerView();
  const view = state.streamerView;
  const bounds = streamerImageBounds(img);
  img.style.left = `${bounds.x}px`;
  img.style.top = `${bounds.y}px`;
  img.style.width = `${bounds.width}px`;
  img.style.height = `${bounds.height}px`;
  img.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
  img.classList.toggle("zoomed", view.zoom > 1.01);
  img.closest(".viewer")?.classList.toggle("streamer-zoomed", view.zoom > 1.01);
  const meta = $("streamerMeta");
  if (meta?.dataset.baseText) meta.textContent = streamerMetaText(meta.dataset.baseText);
}

function streamerMetaText(baseText) {
  const zoom = Number(state.streamerView.zoom) || 1;
  const resolution = streamerResolutionForZoom(zoom);
  if (resolution.full_resolution) {
    const zoomLabel = zoom > 1.01 ? ` z${zoom.toFixed(1)}x` : "";
    return `${baseText}${zoomLabel} full-res`;
  }
  const zoomLabel = zoom > 1.01 ? ` z${zoom.toFixed(1)}x ${resolution.max_width}x${resolution.max_height}` : "";
  return `${baseText}${zoomLabel}`;
}

function streamerResolutionForZoom(zoom = state.streamerView.zoom) {
  if (state.calibration.active || state.calibration.data?.active) {
    return {
      full_resolution: true,
      max_width: null,
      max_height: null,
    };
  }
  const factor = clamp(Number(zoom) || 1, 1, 12);
  const viewer = $("streamerFrame")?.closest(".viewer.streamer");
  const rect = viewer?.getBoundingClientRect();
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
  const viewportWidth = Math.max(
    Number(viewer?.clientWidth) || Number(rect?.width) || 0,
    960,
  );
  const viewportHeight = Math.max(
    Number(viewer?.clientHeight) || Number(rect?.height) || 0,
    720,
  );
  return {
    max_width: Math.round(clamp(viewportWidth * dpr * factor, 960, 4096)),
    max_height: Math.round(clamp(viewportHeight * dpr * factor, 720, 3072)),
  };
}

function requestStreamerResolutionUpdate() {
  const view = state.streamerView;
  if (view.requestTimer) window.clearTimeout(view.requestTimer);
  view.requestTimer = window.setTimeout(() => {
    view.requestTimer = null;
    const resolution = streamerResolutionForZoom();
    const key = resolution.full_resolution
      ? "full-resolution"
      : `${resolution.max_width}x${resolution.max_height}`;
    if (view.directActive) refreshDirectStreamerSrc();
    if (key === view.lastRequestKey) return;
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    view.lastRequestKey = key;
    const payload = resolution.full_resolution
      ? { type: "set_streamer_view", full_resolution: true }
      : { type: "set_streamer_view", ...resolution };
    send({
      ...payload,
      zoom: Number(state.streamerView.zoom) || 1,
    });
  }, 180);
}

function renderFrame(name, frame) {
  const img = $(`${name}Frame`);
  const meta = $(`${name}Meta`);
  const viewer = img?.closest(".viewer");
  if (!img || !meta || !viewer) return;

  const payload = frame?.result || frame;
  const base64 = payload?.base64;
  if (base64 && payload?.mime_type) {
    img.src = `data:${payload.mime_type};base64,${base64}`;
    viewer.classList.add("has-frame");
    const shape = Array.isArray(payload.shape) ? payload.shape.join("x") : "";
    const baseText = `${payload.frame_source || "frame"} ${shape}`.trim();
    meta.dataset.baseText = baseText;
    meta.textContent = name === "streamer" ? streamerMetaText(baseText) : baseText;
    if (name === "streamer") {
      applyStreamerView();
      requestStreamerResolutionUpdate();
    }
  } else {
    if (name === "streamer" && img.getAttribute("src")) {
      const previous = meta.dataset.baseText || "last frame";
      const message = frame?.error ? `${frame.error} - showing ${previous}` : previous;
      meta.textContent = streamerMetaText(message);
      viewer.classList.add("has-frame");
      return;
    }
    img.removeAttribute("src");
    viewer.classList.remove("has-frame");
    delete meta.dataset.baseText;
    meta.textContent = frame?.error || "waiting";
  }
}

function renderCalibrationFrame(frame) {
  const shell = document.querySelector(".calibration-streamer");
  const img = $("calibrationStreamerFrame");
  if (!shell || !img) return;
  const payload = frame?.result || frame;
  const base64 = payload?.base64;
  if (base64 && payload?.mime_type) {
    img.src = `data:${payload.mime_type};base64,${base64}`;
    shell.classList.add("has-frame");
  } else {
    img.removeAttribute("src");
    shell.classList.remove("has-frame");
  }
  updateCalibrationOverlayGeometry();
}

function updateCalibrationOverlayGeometry() {
  const shell = document.querySelector(".calibration-streamer");
  const img = $("calibrationStreamerFrame");
  if (!shell || !img) return;
  const shellRect = shell.getBoundingClientRect();
  const naturalWidth = Number(img.naturalWidth || 0);
  const naturalHeight = Number(img.naturalHeight || 0);
  if (!shellRect.width || !shellRect.height || !naturalWidth || !naturalHeight) {
    shell.style.removeProperty("--calibration-image-width");
    shell.style.removeProperty("--calibration-image-height");
    shell.style.removeProperty("--calibration-target-width");
    shell.style.removeProperty("--calibration-target-height");
    return;
  }

  const imageAspect = naturalWidth / naturalHeight;
  let imageWidth = shellRect.width;
  let imageHeight = imageWidth / imageAspect;
  if (imageHeight > shellRect.height) {
    imageHeight = shellRect.height;
    imageWidth = imageHeight * imageAspect;
  }
  const calibrationDisplayScale = 0.92;
  imageWidth *= calibrationDisplayScale;
  imageHeight *= calibrationDisplayScale;

  const streamer = calibrationStreamerStatus();
  const frameShape = Array.isArray(streamer?.frame_shape) ? streamer.frame_shape : null;
  const metadataSourceHeight = Number(frameShape?.[0]);
  const metadataSourceWidth = Number(frameShape?.[1]);
  const metadataElectrodeWidth = Number(streamer?.electrode_width_px);
  const metadataElectrodeHeight = Number(streamer?.electrode_height_px);
  const hasMetadataGeometry = (
    Number.isFinite(metadataSourceWidth)
    && metadataSourceWidth > 0
    && Number.isFinite(metadataSourceHeight)
    && metadataSourceHeight > 0
    && Number.isFinite(metadataElectrodeWidth)
    && metadataElectrodeWidth > 0
    && Number.isFinite(metadataElectrodeHeight)
    && metadataElectrodeHeight > 0
  );

  const fallbackWidth = imageWidth * 0.154;
  const fallbackHeight = imageHeight * 0.185;
  let targetWidth = fallbackWidth;
  let targetHeight = fallbackHeight;
  if (hasMetadataGeometry) {
    const scaleX = imageWidth / metadataSourceWidth;
    const scaleY = imageHeight / metadataSourceHeight;
    targetWidth = metadataElectrodeWidth * scaleX;
    targetHeight = metadataElectrodeHeight * scaleY;
    const suspicious = (
      targetWidth > fallbackWidth * 1.8
      || targetHeight > fallbackHeight * 1.8
      || targetWidth < fallbackWidth * 0.45
      || targetHeight < fallbackHeight * 0.45
    );
    if (suspicious) {
      targetWidth = fallbackWidth;
      targetHeight = fallbackHeight;
    }
  }
  targetWidth = Math.max(8, targetWidth);
  targetHeight = Math.max(8, targetHeight);

  shell.style.setProperty("--calibration-image-width", `${imageWidth}px`);
  shell.style.setProperty("--calibration-image-height", `${imageHeight}px`);
  shell.style.setProperty("--calibration-target-width", `${targetWidth}px`);
  shell.style.setProperty("--calibration-target-height", `${targetHeight}px`);
}

function calibrationStreamerStatus() {
  const visualizers = state.live?.visualizers?.result
    || state.live?.visualizers?.value
    || state.live?.visualizers
    || {};
  const candidates = [
    visualizers.streamer,
    getPath(visualizers, "result.streamer"),
    getPath(visualizers, "structuredContent.result.streamer"),
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || {};
}

function openCalibrationOverlay() {
  state.calibration.active = true;
  state.calibration.data = {
    ...(state.calibration.data || {}),
    active: true,
    preparing: true,
    status: "Preparing calibration",
  };
  state.calibration.localPosition = normalizeStagePosition(currentStagePosition());
  renderCalibrationOverlay();
  requestStreamerResolutionUpdate();
  send({ type: "calibration_start" });
}

function closeCalibrationOverlay() {
  stopAllCalibrationJogs();
  state.calibration.active = false;
  state.calibration.data = null;
  state.calibration.localPosition = null;
  state.calibration.movePending = false;
  renderCalibrationOverlay();
  requestStreamerResolutionUpdate();
  send({ type: "calibration_close" });
}

function renderCalibrationOverlay() {
  const overlay = $("calibrationOverlay");
  if (!overlay) return;
  const data = state.calibration.data || {};
  const active = state.calibration.active || Boolean(data.active);
  overlay.hidden = !active;
  document.body.classList.toggle("calibration-active", active);
  if (!active) return;

  setText("calibrationConfig", data.config_path || "-");
  setText("calibrationStatus", data.error || (data.preparing ? "preparing" : data.status || "active"));
  const step = data.current_step || {};
  const stepNumber = Number.isFinite(Number(data.guided_index)) ? Number(data.guided_index) + 1 : "-";
  const stepCount = data.step_count || 3;
  setText("calibrationStepIndex", data.workflow_complete ? "Complete" : `${stepNumber}/${stepCount}`);
  setText("calibrationStepLabel", step.label || "-");

  const position = calibrationPosition();
  setText("calibrationX", formatStageCoordinate(position?.X));
  setText("calibrationY", formatStageCoordinate(position?.Y));
  setText("calibrationZ", formatStageCoordinate(position?.Z));

  const mapping = data.calibration?.electrode_mapping || {};
  const interRow = Array.isArray(mapping.inter_row) ? mapping.inter_row : [];
  const interColumn = Array.isArray(mapping.inter_column) ? mapping.inter_column : [];
  setText("calibrationRowX", formatCalibrationVector(interRow[0]));
  setText("calibrationRowY", formatCalibrationVector(interRow[1]));
  setText("calibrationRowZ", formatCalibrationVector(interRow[2]));
  setText("calibrationColumnX", formatCalibrationVector(interColumn[0]));
  setText("calibrationColumnY", formatCalibrationVector(interColumn[1]));
  setText("calibrationColumnZ", formatCalibrationVector(interColumn[2]));

  const speedKey = String(data.speed_key || state.calibration.speedKey || "2");
  const speedBusy = Boolean(data.preparing || state.calibration.movePending);
  for (const button of document.querySelectorAll("[data-calibration-speed]")) {
    button.classList.toggle(
      "active",
      String(button.getAttribute("data-calibration-speed")) === speedKey,
    );
    button.disabled = speedBusy;
  }
  const accept = $("calibrationAccept");
  if (accept) accept.disabled = Boolean(data.workflow_complete);
  window.requestAnimationFrame(updateCalibrationOverlayGeometry);
}

function formatCalibrationVector(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return Math.abs(number) >= 100 ? number.toFixed(1) : number.toFixed(3);
}

function normalizeStagePosition(position) {
  if (!position || typeof position !== "object") return null;
  const normalized = {};
  for (const axis of ["X", "Y", "Z"]) {
    const value = Number(position[axis]);
    if (Number.isFinite(value)) normalized[axis] = Math.trunc(value);
  }
  return Object.keys(normalized).length ? normalized : null;
}

function calibrationPosition() {
  return normalizeStagePosition(state.calibration.localPosition)
    || normalizeStagePosition(state.calibration.data?.position)
    || normalizeStagePosition(currentStagePosition());
}

function acceptCalibrationStep() {
  stopAllCalibrationJogs();
  const position = calibrationPosition();
  if (!position) {
    appendEvent({
      ts: new Date().toISOString(),
      type: "ui_error",
      level: "warning",
      message: "No stage position available for calibration",
    });
    return;
  }
  send({ type: "calibration_record", position });
}

function keyboardEventTargetsEditor(event) {
  return Boolean(event.target?.closest?.("input, textarea, select, [contenteditable='true'], .metric.editing"));
}

function handleCalibrationKeydown(event) {
  if (!state.calibration.active && !state.calibration.data?.active) return;
  if (keyboardEventTargetsEditor(event)) return;
  const key = event.key;
  if (key === "Escape") {
    event.preventDefault();
    closeCalibrationOverlay();
    return;
  }
  if (key.toLowerCase() === "q") {
    event.preventDefault();
    closeCalibrationOverlay();
    return;
  }
  if (["1", "2", "3"].includes(key)) {
    event.preventDefault();
    if (!calibrationKeyboardBusy()) setCalibrationSpeed(key);
    return;
  }
  const jog = calibrationJogFromKey(key);
  if (calibrationKeyboardBusy() && (jog || key === "Enter" || key.toLowerCase() === "m" || key.toLowerCase() === "s")) {
    event.preventDefault();
    return;
  }
  if (key === "Enter") {
    event.preventDefault();
    acceptCalibrationStep();
    return;
  }
  if (key.toLowerCase() === "m") {
    event.preventDefault();
    stopAllCalibrationJogs();
    send({ type: "calibration_move_to_target" });
    return;
  }
  if (key.toLowerCase() === "s") {
    event.preventDefault();
    send({ type: "calibration_save" });
    return;
  }
  if (!jog) return;

  event.preventDefault();
  startCalibrationJog(jog.axis, jog.direction);
}

function handleCalibrationKeyup(event) {
  if (!state.calibration.active && !state.calibration.data?.active) return;
  const jog = calibrationJogFromKey(event.key);
  if (!jog) return;
  event.preventDefault();
  stopCalibrationJog(jog.axis);
}

function handleSelectedDropletKeydown(event) {
  if (state.calibration.active || state.calibration.data?.active) return;
  if (keyboardEventTargetsEditor(event)) return;
  const selectedIds = selectedMatrixDropletIds();
  if (event.key === "Escape" && selectedIds.length) {
    event.preventDefault();
    setMatrixSelectedDropletIds([]);
    renderMatrixPanel(state.live || {});
    schedulePlanTimelineRender();
    return;
  }
  if (event.key.toLowerCase() === "r" && selectedIds.length && !state.matrixCommands.planning) {
    event.preventDefault();
    state.matrixMovePreview.rotation = (Number(state.matrixMovePreview.rotation) + 1) % 4;
    renderMatrixPanel(state.live || {});
    schedulePlanTimelineRender();
    return;
  }
  const delta = dropletDeltaForVisualArrow(event.key);
  if (!delta) return;
  const droplet = selectedMatrixDropletForNudge();
  if (!droplet) return;
  event.preventDefault();
  nudgeSelectedDroplet(droplet, delta);
}

function dropletDeltaForVisualArrow(key) {
  if (key === "ArrowLeft") return [1, 0];
  if (key === "ArrowRight") return [-1, 0];
  if (key === "ArrowUp") return [0, -1];
  if (key === "ArrowDown") return [0, 1];
  return null;
}

function selectedMatrixDropletForNudge() {
  const dropletId = selectedTimelineDropletId();
  if (dropletId === null) return null;
  const override = state.matrixDropletOverrides.get(Number(dropletId));
  if (override) return override;
  const scene = matrixSceneForTimeline(state.live?.scene?.result || state.live?.scene);
  const droplet = (scene?.droplets || []).find((item) => Number(item?.id) === Number(dropletId));
  return droplet || null;
}

function nudgeSelectedDroplet(droplet, delta) {
  const now = Date.now();
  if (now - state.matrixDropletNudge.lastAt < 45) return;
  state.matrixDropletNudge.lastAt = now;
  const current = normalizeMatrixPoint(droplet.position)
    || normalizeMatrixPoint(droplet.origin)
    || normalizeMatrixPoint(droplet.current_position);
  if (!current) return;
  const scene = state.live?.scene?.result || state.live?.scene;
  const shape = matrixShape(scene);
  const next = clampDropletCorner(
    [current[0] + delta[0], current[1] + delta[1]],
    droplet,
    Math.max(1, Number(shape?.[0] || 128)),
    Math.max(1, Number(shape?.[1] || 128)),
  );
  if (next[0] === current[0] && next[1] === current[1]) return;
  const shifted = shiftedDropletOverride(droplet, current, next);
  state.matrixDropletOverrides.set(Number(droplet.id), shifted);
  renderMatrixPanel(state.live || {});
  send({
    type: "matrix_update_droplet_position",
    droplet_id: Number(droplet.id),
    position: next,
  });
}

function shiftedDropletOverride(droplet, current, next) {
  const deltaRow = next[0] - current[0];
  const deltaCol = next[1] - current[1];
  const shape = normalizeMatrixCells(droplet.shape);
  const cells = shape.length
    ? shape.map((offset) => [next[0] + offset[0], next[1] + offset[1]])
    : normalizeMatrixCells(droplet.cells).map((cell) => [cell[0] + deltaRow, cell[1] + deltaCol]);
  return {
    ...droplet,
    id: Number(droplet.id),
    position: next,
    origin: next,
    current_position: next,
    cells,
    cells_truncated: false,
    bbox: bboxFromCells(cells),
    path: Array.isArray(droplet.path) ? [...droplet.path, next] : [current, next],
  };
}

function clampDropletCorner(position, droplet, rows, cols) {
  const shape = normalizeMatrixCells(droplet.shape);
  const cells = shape.length ? shape : [[0, 0]];
  const rowOffsets = cells.map((cell) => cell[0]);
  const colOffsets = cells.map((cell) => cell[1]);
  const minRowOffset = Math.min(...rowOffsets);
  const maxRowOffset = Math.max(...rowOffsets);
  const minColOffset = Math.min(...colOffsets);
  const maxColOffset = Math.max(...colOffsets);
  return [
    clamp(Math.trunc(position[0]), -minRowOffset, rows - 1 - maxRowOffset),
    clamp(Math.trunc(position[1]), -minColOffset, cols - 1 - maxColOffset),
  ];
}

function setCalibrationSpeed(speedKey) {
  const key = ["1", "2", "3"].includes(String(speedKey)) ? String(speedKey) : "2";
  if (calibrationKeyboardBusy()) {
    renderCalibrationOverlay();
    return;
  }
  if (state.calibration.speedKey === key) {
    renderCalibrationOverlay();
    return;
  }
  state.calibration.speedKey = key;
  renderCalibrationOverlay();
  send({ type: "calibration_set_speed", speed_key: key });
}

function calibrationJogFromKey(key) {
  if (key === "ArrowLeft") return { axis: "X", direction: -1 };
  if (key === "ArrowRight") return { axis: "X", direction: 1 };
  if (key === "ArrowUp") return { axis: "Y", direction: 1 };
  if (key === "ArrowDown") return { axis: "Y", direction: -1 };
  if (key === "-" || key === "_" || key === "PageDown" || key === "Subtract") return { axis: "Z", direction: -1 };
  if (key === "+" || key === "=" || key === "PageUp" || key === "Add") return { axis: "Z", direction: 1 };
  return null;
}

function calibrationKeyboardBusy() {
  return Boolean(state.calibration.data?.preparing || state.calibration.movePending);
}

function startCalibrationJog(axis, direction) {
  if (calibrationKeyboardBusy()) return;
  if (!axis || !direction) return;
  const directions = state.calibration.jogDirections || { X: 0, Y: 0, Z: 0 };
  if (directions[axis] === direction) return;
  directions[axis] = direction;
  state.calibration.jogDirections = directions;
  sendCalibrationJog(axis, direction);
  ensureCalibrationJogKeepalive();
}

function stopCalibrationJog(axis) {
  const directions = state.calibration.jogDirections || { X: 0, Y: 0, Z: 0 };
  if (!axis || directions[axis] === 0) return;
  directions[axis] = 0;
  state.calibration.jogDirections = directions;
  sendCalibrationJog(axis, 0);
  if (!Object.values(directions).some((value) => Number(value) !== 0)) {
    clearCalibrationJogKeepalive();
  }
}

function stopAllCalibrationJogs() {
  const directions = state.calibration.jogDirections || { X: 0, Y: 0, Z: 0 };
  const hadMotion = Object.values(directions).some((value) => Number(value) !== 0);
  state.calibration.jogDirections = { X: 0, Y: 0, Z: 0 };
  clearCalibrationJogKeepalive();
  if (hadMotion || state.calibration.active || state.calibration.data?.active) {
    send({ type: "calibration_jog", stop_all: true });
  }
}

function ensureCalibrationJogKeepalive() {
  if (state.calibration.jogKeepaliveTimer) return;
  state.calibration.jogKeepaliveTimer = window.setInterval(() => {
    if (!state.calibration.active && !state.calibration.data?.active) {
      stopAllCalibrationJogs();
      return;
    }
    const directions = state.calibration.jogDirections || {};
    let active = false;
    for (const axis of ["X", "Y", "Z"]) {
      const direction = Number(directions[axis] || 0);
      if (direction === 0) continue;
      active = true;
      sendCalibrationJog(axis, direction, { keepalive: true });
    }
    if (!active) clearCalibrationJogKeepalive();
  }, 80);
}

function clearCalibrationJogKeepalive() {
  if (!state.calibration.jogKeepaliveTimer) return;
  window.clearInterval(state.calibration.jogKeepaliveTimer);
  state.calibration.jogKeepaliveTimer = null;
}

function sendCalibrationJog(axis, direction, options = {}) {
  const now = Date.now();
  const directionValue = Math.max(-1, Math.min(1, Number(direction) || 0));
  if (!options.keepalive && directionValue !== 0 && now - Number(state.calibration.lastJogAt || 0) < 10) return;
  state.calibration.lastJogAt = now;
  send({
    type: "calibration_jog",
    axis,
    direction: directionValue,
  });
}

function moveCalibrationStage(delta) {
  const now = Date.now();
  if (now - state.calibration.lastMoveAt < 90) return;
  const base = calibrationPosition();
  if (!base) {
    appendEvent({
      ts: new Date().toISOString(),
      type: "ui_error",
      level: "warning",
      message: "No stage position available for calibration move",
    });
    return;
  }
  const position = { ...base };
  for (const [axis, value] of Object.entries(delta)) {
    position[axis] = Math.trunc(Number(position[axis] || 0) + Number(value || 0));
  }
  state.calibration.localPosition = position;
  state.calibration.lastMoveAt = now;
  state.calibration.movePending = true;
  beginStageMotionFromCommand({
    position,
    source: "calibration",
    wait_timeout_seconds: 1.2,
  });
  renderCalibrationOverlay();
  send({
    type: "calibration_move_stage",
    position,
    wait_timeout_seconds: 1.2,
  });
}

function currentMatrixSceneForRender(fallbackScene = null) {
  const scene = state.live?.scene?.result || state.live?.scene || fallbackScene;
  return scene ? matrixSceneForTimeline(scene) : null;
}

function scheduleMatrixSceneRender(fallbackScene = null, options = {}) {
  state.matrixRenderQueue.fallbackScene = fallbackScene || state.matrixRenderQueue.fallbackScene || null;
  state.matrixRenderQueue.options = {
    ...(state.matrixRenderQueue.options || {}),
    ...(options || {}),
  };
  if (state.matrixRenderQueue.raf !== null || state.matrixRenderQueue.timer !== null) return;
  const renderQueued = () => {
    state.matrixRenderQueue.raf = requestAnimationFrame(() => {
      const queued = state.matrixRenderQueue;
      queued.raf = null;
      queued.lastAt = performance.now();
      const scene = currentMatrixSceneForRender(queued.fallbackScene);
      const renderOptions = queued.options || {};
      queued.options = {};
      queued.fallbackScene = null;
      if (scene?.available) renderMatrixScene(scene, renderOptions);
    });
  };
  const elapsed = performance.now() - Number(state.matrixRenderQueue.lastAt || 0);
  if (elapsed >= 33) {
    renderQueued();
    return;
  }
  state.matrixRenderQueue.timer = window.setTimeout(() => {
    state.matrixRenderQueue.timer = null;
    renderQueued();
  }, Math.max(0, 33 - elapsed));
}

function cancelScheduledMatrixSceneRender() {
  if (state.matrixRenderQueue.timer !== null) {
    window.clearTimeout(state.matrixRenderQueue.timer);
    state.matrixRenderQueue.timer = null;
  }
  if (state.matrixRenderQueue.raf !== null) {
    cancelAnimationFrame(state.matrixRenderQueue.raf);
    state.matrixRenderQueue.raf = null;
  }
  state.matrixRenderQueue.options = {};
  state.matrixRenderQueue.fallbackScene = null;
}

function renderMatrixScene(scene, options = {}) {
  cancelScheduledMatrixSceneRender();
  state.matrixRenderQueue.lastAt = performance.now();
  renderMatrixSceneNow(scene, options);
}

function renderMatrixSceneNow(scene, options = {}) {
  const canvas = $("matrixScene");
  const meta = $("matrixMeta");
  const img = $("matrixFrame");
  const viewer = canvas?.closest(".viewer");
  if (!canvas || !viewer || !meta) return;

  viewer.classList.add("has-scene");
  viewer.classList.remove("has-frame");
  img?.removeAttribute("src");
  syncMatrixViewerSize();

  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#050607";
  ctx.fillRect(0, 0, width, height);

  const shape = matrixShape(scene);
  const rows = Math.max(1, Number(shape?.[0] || 128));
  const cols = Math.max(1, Number(shape?.[1] || 128));
  const geom = matrixSceneGeometry(width, height, rows, cols);

  drawMatrixBackground(ctx, geom);
  const renderedSummary = scene.frame?.summary || scene.matrix;
  drawMatrixRanges(ctx, geom, renderedSummary, "rgba(100, 210, 255, 0.45)");
  drawMatrixPaintOverlay(ctx, geom);
  const microscopeFoV = drawMicroscopeFoV(ctx, geom, scene);
  const droplets = matrixDropletsWithOverrides(scene.droplets || [])
    .map((droplet) => dynamicDropletForSceneFrame(scene, droplet));
  syncMatrixPathState(scene);
  drawMatrixPaths(ctx, geom, scene, droplets);
  drawMatrixQueuedPaths(ctx, geom, droplets);
  const hitboxes = drawMatrixDroplets(ctx, geom, droplets);
  drawMatrixMovePreview(ctx, geom, scene, droplets);
  drawMatrixSelectionBox(ctx);
  drawMatrixCoordinateAxes(ctx, geom, scene);
  drawCartridgeInputHoles(ctx, geom, scene);
  const renderStats = recordMatrixRenderStats(scene);
  drawMatrixOverlay(ctx, width, height, scene, renderStats);
  state.matrixSceneHitboxes = hitboxes;
  renderMatrixMinimap(scene, geom);
  renderMatrixPaintPanel();
  updateMatrixHover(state.matrixHover);
  updateMatrixCursorHud(state.matrixHover);
  if (!options.skipPathPanel) renderMatrixPathPanel(scene);
  renderMatrixCommandPanel();

  const frame = scene.frame || {};
  const index = frame.index !== null && frame.index !== undefined && Number.isFinite(Number(frame.index))
    ? Number(frame.index) + 1
    : "-";
  const count = Number.isFinite(Number(frame.count)) ? Number(frame.count) : "-";
  const active = renderedSummary?.active_count ?? 0;
  const source = matrixFrameSource(scene);
  const zoomLabel = Math.abs(geom.zoom - 1) > 0.01 ? ` z${geom.zoom.toFixed(1)}x` : "";
  const pathCount = matrixPathActions(scene).length
    || droplets.filter((droplet) => Array.isArray(droplet.path) && droplet.path.length > 1).length;
  const pathLabel = pathCount ? ` paths ${pathCount}` : "";
  const fovLabel = microscopeFoV ? ` fov ${formatElectrodeCoordinate(microscopeFoV.row)},${formatElectrodeCoordinate(microscopeFoV.col)}` : "";
  const fpsLabel = renderStats ? ` render ${formatMatrixRenderFps(renderStats.fps)}/s` : "";
  meta.textContent = `${source} ${index}/${count} active ${active}${pathLabel}${fovLabel}${zoomLabel}${fpsLabel}`;
  updateMatrixLiveBadge(scene);
}

function matrixFrameSource(scene) {
  return scene?.frame?.source === "executor_last_applied_frame"
    ? "executed"
    : scene?.frame?.source === "state"
      ? "state"
      : scene?.frame?.source === "timeline_preview"
        ? "preview"
        : scene?.frame?.source === "cartridge"
          ? "cartridge"
          : "plan";
}

function recordMatrixRenderStats(scene) {
  const stats = state.matrixRenderStats || {};
  state.matrixRenderStats = stats;
  const now = performance.now();
  const rawFrameIndex = Number(scene?.frame?.index);
  const frameIndex = Number.isFinite(rawFrameIndex) ? Math.trunc(rawFrameIndex) : null;
  const rawFrameCount = Number(scene?.frame?.count);
  const frameCount = Number.isFinite(rawFrameCount) ? Math.trunc(rawFrameCount) : null;
  const source = matrixFrameSource(scene);
  const mode = state.timeline.followLive ? "live" : "preview";
  const previousFrameIndex = Number.isFinite(Number(stats.lastFrameIndex)) ? Number(stats.lastFrameIndex) : null;
  const previousSource = stats.lastSource || "";
  const previousMode = stats.lastMode || "";
  const sourceChanged = Boolean(previousSource && (previousSource !== source || previousMode !== mode));
  let delta = null;
  let status = "steady";

  if (frameIndex !== null && previousFrameIndex !== null) {
    delta = frameIndex - previousFrameIndex;
    if (delta < 0) {
      status = "regress";
      stats.regressions = Number(stats.regressions || 0) + 1;
    } else if (delta > 1) {
      status = "jump";
      stats.jumps = Number(stats.jumps || 0) + 1;
    } else if (delta === 0) {
      status = sourceChanged ? "switch" : "repeat";
      stats.repeats = Number(stats.repeats || 0) + 1;
    } else {
      status = sourceChanged ? "switch" : "advance";
    }
  } else if (sourceChanged) {
    status = "switch";
  }
  if (sourceChanged) stats.sourceSwitches = Number(stats.sourceSwitches || 0) + 1;

  const sample = { t: now, frameIndex, source, mode, status };
  const recent = [...(Array.isArray(stats.samples) ? stats.samples : []), sample]
    .filter((item) => now - Number(item.t || 0) <= 1000);
  stats.samples = recent;
  stats.fps = recent.length;
  stats.uniqueFps = new Set(
    recent
      .map((item) => item.frameIndex)
      .filter((value) => Number.isFinite(Number(value)))
      .map((value) => Number(value))
  ).size;
  stats.lastFrameIndex = frameIndex;
  stats.lastFrameCount = frameCount;
  stats.lastSource = source;
  stats.lastMode = mode;
  stats.lastDelta = delta;
  stats.lastStatus = status;
  stats.lastUpdatedAt = new Date().toISOString();
  stats.history = [
    ...(Array.isArray(stats.history) ? stats.history : []),
    {
      at: stats.lastUpdatedAt,
      frameIndex,
      frameCount,
      source,
      mode,
      delta,
      status,
      fps: stats.fps,
      uniqueFps: stats.uniqueFps,
    },
  ].slice(-120);
  return stats;
}

function formatMatrixRenderFps(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number >= 10 ? String(Math.round(number)) : number.toFixed(1);
}

function matrixShape(scene) {
  return scene?.frame?.summary?.shape || scene?.matrix?.shape || [128, 128];
}

function matrixSceneGeometry(width, height, rows, cols) {
  const view = state.matrixView;
  const shapeKey = `${rows}x${cols}`;
  if (view.shapeKey !== shapeKey) {
    view.shapeKey = shapeKey;
    resetMatrixView();
  }
  const pad = Math.max(34, Math.min(width, height) * 0.06);
  const displayCols = rows;
  const displayRows = cols;
  const fitCell = Math.max(1, Math.min(
    (width - pad * 2) / displayCols,
    (height - pad * 2) / displayRows,
  ));
  const baseCell = fitCell;
  view.zoom = clamp(Number(view.zoom) || 1, 0.6, 48);
  const cell = baseCell * view.zoom;
  const gridWidth = displayCols * cell;
  const gridHeight = displayRows * cell;
  clampMatrixView(width, height, gridWidth, gridHeight, pad);
  const originX = (width - gridWidth) / 2 + view.panX;
  const originY = (height - gridHeight) / 2 + view.panY;
  return {
    rows,
    cols,
    displayRows,
    displayCols,
    baseCell,
    cell,
    zoom: view.zoom,
    originX,
    originY,
    gridWidth,
    gridHeight,
    width,
    height,
    pad,
  };
}

function clampMatrixView(width, height, gridWidth, gridHeight, pad) {
  const view = state.matrixView;
  view.zoom = clamp(Number(view.zoom) || 1, 0.6, 48);
  const maxPanX = matrixPanLimit(width, gridWidth, pad);
  const maxPanY = matrixPanLimit(height, gridHeight, pad);
  view.panX = clamp(view.panX, -maxPanX, maxPanX);
  view.panY = clamp(view.panY, -maxPanY, maxPanY);
}

function matrixPanLimit(viewportSize, gridSize, pad) {
  const viewport = Math.max(1, Number(viewportSize) || 1);
  const grid = Math.max(1, Number(gridSize) || 1);
  const inset = Math.max(0, Number(pad) || 0);
  if (grid <= Math.max(1, viewport - inset * 2)) {
    return grid * 0.5;
  }
  return Math.max(0, grid * 0.5 - inset);
}

function resetMatrixView() {
  state.matrixView.zoom = 1;
  state.matrixView.panX = 0;
  state.matrixView.panY = 0;
  state.matrixView.dragging = false;
  saveMatrixView();
}

function clampMatrixPanForCurrentScene() {
  const canvas = $("matrixScene");
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!canvas || !scene?.available) return;
  const rect = canvas.getBoundingClientRect();
  const shape = matrixShape(scene);
  matrixSceneGeometry(
    Math.max(1, Math.round(rect.width || canvas.clientWidth || 1)),
    Math.max(1, Math.round(rect.height || canvas.clientHeight || 1)),
    Math.max(1, Number(shape?.[0] || 128)),
    Math.max(1, Number(shape?.[1] || 128)),
  );
}

function zoomMatrixScene(event) {
  const canvas = $("matrixScene");
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!canvas || !scene?.available) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const shape = matrixShape(scene);
  const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
  const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1));
  const rows = Math.max(1, Number(shape?.[0] || 128));
  const cols = Math.max(1, Number(shape?.[1] || 128));
  const oldGeom = matrixSceneGeometry(width, height, rows, cols);
  const displayPoint = canvasPointToDisplayCell(oldGeom, x, y);
  const factor = Math.exp(-event.deltaY * 0.0016);
  const nextZoom = clamp(oldGeom.zoom * factor, 0.6, 48);
  if (Math.abs(nextZoom - oldGeom.zoom) < 0.001) return;

  const view = state.matrixView;
  view.zoom = nextZoom;
  const cell = oldGeom.baseCell * nextZoom;
  const gridWidth = oldGeom.displayCols * cell;
  const gridHeight = oldGeom.displayRows * cell;
  const centeredOriginX = (width - gridWidth) / 2;
  const centeredOriginY = (height - gridHeight) / 2;
  view.panX = x - displayPoint.col * cell - centeredOriginX;
  view.panY = y - displayPoint.row * cell - centeredOriginY;
  clampMatrixView(width, height, gridWidth, gridHeight, oldGeom.pad);
  saveMatrixView();
  scheduleMatrixSceneRender();
}

function startMatrixManualPan(event) {
  const canvas = $("matrixScene");
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!canvas || !scene?.available) return;
  event.preventDefault();
  canvas.setPointerCapture?.(event.pointerId);
  state.matrixView.dragging = true;
  state.matrixView.moved = false;
  state.matrixView.dragStartX = event.clientX;
  state.matrixView.dragStartY = event.clientY;
  state.matrixView.dragPanX = Number(state.matrixView.panX) || 0;
  state.matrixView.dragPanY = Number(state.matrixView.panY) || 0;
  canvas.classList.add("dragging");
}

function updateMatrixManualPan(event) {
  if (!state.matrixView.dragging) return;
  const dx = Number(event.clientX) - Number(state.matrixView.dragStartX);
  const dy = Number(event.clientY) - Number(state.matrixView.dragStartY);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  state.matrixView.panX = Number(state.matrixView.dragPanX || 0) + dx;
  state.matrixView.panY = Number(state.matrixView.dragPanY || 0) + dy;
  if (Math.hypot(dx, dy) >= 3) state.matrixView.moved = true;
  clampMatrixPanForCurrentScene();
  scheduleMatrixSceneRender();
}

function endMatrixManualPan() {
  if (!state.matrixView.dragging) return;
  state.matrixView.dragging = false;
  state.matrixView.moved = false;
  saveMatrixView();
}

function cancelMatrixManualPan() {
  if (!state.matrixView.dragging) return;
  state.matrixView.dragging = false;
  state.matrixView.moved = false;
  saveMatrixView();
}

function updateMatrixEdgePan(event, rect) {
  const scene = state.live?.scene?.result || state.live?.scene;
  const selectionDrag = state.matrixSelection.dragging;
  const paintDrag = state.matrixPaint.dragging;
  if (
    !scene?.available
    || (event.buttons && !selectionDrag && !paintDrag)
    || state.matrixView.dragging
    || state.matrixNav.minimapDragging
  ) {
    stopMatrixEdgePan();
    return;
  }
  const edgeX = clamp(rect.width * 0.10, 36, 110);
  const edgeTop = clamp(rect.height * 0.10, 36, 110);
  const edgeBottom = clamp(rect.height * 0.14, 44, 140);
  const outsideX = clamp(rect.width * 0.035, 10, 34);
  const outsideY = clamp(rect.height * 0.05, 12, 46);
  const rawX = event.clientX - rect.left;
  const rawY = event.clientY - rect.top;
  if (
    rawX < -outsideX
    || rawX > rect.width + outsideX
    || rawY < -outsideY
    || rawY > rect.height + outsideY
  ) {
    stopMatrixEdgePan();
    return;
  }
  const x = clamp(rawX, 0, rect.width);
  const y = clamp(rawY, 0, rect.height);
  const speedX = clamp(rect.width * 0.24, 70, 220);
  const speedY = clamp(rect.height * 0.24, 70, 220);
  const vx = matrixEdgeVelocity(x, rect.width, edgeX) * speedX;
  const vy = matrixEdgeVelocity(y, rect.height, edgeTop, edgeBottom) * speedY;
  if (Math.abs(vx) < 1 && Math.abs(vy) < 1) {
    stopMatrixEdgePan();
    return;
  }
  state.matrixNav.edgePanVx = vx;
  state.matrixNav.edgePanVy = vy;
  if (state.matrixNav.edgePanActive) return;
  state.matrixNav.edgePanActive = true;
  state.matrixNav.edgePanLastAt = performance.now();
  state.matrixNav.edgePanRaf = requestAnimationFrame(stepMatrixEdgePan);
}

function matrixEdgeVelocity(position, size, leadingEdge, trailingEdge = leadingEdge) {
  if (position < leadingEdge) {
    const pull = clamp((leadingEdge - position) / leadingEdge, 0, 1);
    return Math.pow(pull, 2.2);
  }
  if (position > size - trailingEdge) {
    const pull = clamp((position - (size - trailingEdge)) / trailingEdge, 0, 1);
    return -Math.pow(pull, 2.2);
  }
  return 0;
}

function stepMatrixEdgePan(now) {
  if (!state.matrixNav.edgePanActive) return;
  const dt = clamp((now - state.matrixNav.edgePanLastAt) / 1000, 0.001, 0.06);
  state.matrixNav.edgePanLastAt = now;
  state.matrixView.panX += state.matrixNav.edgePanVx * dt;
  state.matrixView.panY += state.matrixNav.edgePanVy * dt;
  clampMatrixPanForCurrentScene();
  updateMatrixDragFromStoredPointer();
  scheduleMatrixSceneRender();
  state.matrixNav.edgePanRaf = requestAnimationFrame(stepMatrixEdgePan);
}

function stopMatrixEdgePan() {
  if (!state.matrixNav.edgePanActive) return;
  state.matrixNav.edgePanActive = false;
  if (state.matrixNav.edgePanRaf !== null) cancelAnimationFrame(state.matrixNav.edgePanRaf);
  state.matrixNav.edgePanRaf = null;
  state.matrixNav.edgePanVx = 0;
  state.matrixNav.edgePanVy = 0;
  saveMatrixView();
}

function renderMatrixMinimap(scene, mainGeom = null) {
  const canvas = $("matrixMinimap");
  if (!canvas) return;
  if (!scene?.available) {
    canvas.hidden = true;
    return;
  }
  canvas.hidden = false;
  const { ctx, width, height } = prepareCanvas(canvas);
  const shape = matrixShape(scene);
  const rows = Math.max(1, Number(shape?.[0] || 128));
  const cols = Math.max(1, Number(shape?.[1] || 128));
  const geom = matrixOverviewGeometry(width, height, rows, cols, 6);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(5, 6, 7, 0.96)";
  ctx.fillRect(0, 0, width, height);
  roundedRect(ctx, geom.originX, geom.originY, geom.gridWidth, geom.gridHeight, 5);
  ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const summary = scene.frame?.summary || scene.matrix;
  drawMatrixRanges(ctx, geom, summary, "rgba(100, 210, 255, 0.62)");
  drawCartridgeInputHoles(ctx, geom, scene, { compact: true });
  for (const droplet of matrixDropletsWithOverrides(scene.droplets || [])) {
    const cells = dropletDisplayCells(droplet);
    const bbox = droplet.bbox || bboxFromCells(cells);
    if (!bbox) continue;
    const rect = matrixBboxRect(geom, bbox);
    ctx.fillStyle = dropletColor(droplet.id, 0.9);
    ctx.fillRect(rect.x, rect.y, Math.max(1.5, rect.w), Math.max(1.5, rect.h));
  }

  const viewport = matrixViewportDisplayRect(mainGeom || currentMatrixSceneGeometry());
  if (viewport) {
    const x = geom.originX + viewport.colMin * geom.cell;
    const y = geom.originY + viewport.rowMin * geom.cell;
    const w = Math.max(4, (viewport.colMax - viewport.colMin) * geom.cell);
    const h = Math.max(4, (viewport.rowMax - viewport.rowMin) * geom.cell);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 214, 10, 0.96)";
    ctx.fillStyle = "rgba(255, 214, 10, 0.1)";
    ctx.lineWidth = 1.5;
    roundedRect(ctx, x, y, w, h, 3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function matrixOverviewGeometry(width, height, rows, cols, pad = 6) {
  const displayCols = rows;
  const displayRows = cols;
  const cell = Math.max(0.5, Math.min((width - pad * 2) / displayCols, (height - pad * 2) / displayRows));
  const gridWidth = displayCols * cell;
  const gridHeight = displayRows * cell;
  return {
    rows,
    cols,
    displayRows,
    displayCols,
    baseCell: cell,
    cell,
    zoom: 1,
    originX: (width - gridWidth) / 2,
    originY: (height - gridHeight) / 2,
    gridWidth,
    gridHeight,
    width,
    height,
    pad,
  };
}

function currentMatrixSceneGeometry() {
  const canvas = $("matrixScene");
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!canvas || !scene?.available) return null;
  const rect = canvas.getBoundingClientRect();
  const shape = matrixShape(scene);
  return matrixSceneGeometry(
    Math.max(1, Math.round(rect.width || canvas.clientWidth || 1)),
    Math.max(1, Math.round(rect.height || canvas.clientHeight || 1)),
    Math.max(1, Number(shape?.[0] || 128)),
    Math.max(1, Number(shape?.[1] || 128)),
  );
}

function matrixViewportDisplayRect(geom) {
  if (!geom) return null;
  return {
    colMin: clamp((0 - geom.originX) / geom.cell, 0, geom.displayCols),
    colMax: clamp((geom.width - geom.originX) / geom.cell, 0, geom.displayCols),
    rowMin: clamp((0 - geom.originY) / geom.cell, 0, geom.displayRows),
    rowMax: clamp((geom.height - geom.originY) / geom.cell, 0, geom.displayRows),
  };
}

function centerMatrixFromMinimapEvent(event) {
  const minimap = $("matrixMinimap");
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!minimap || !scene?.available) return;
  const rect = minimap.getBoundingClientRect();
  const shape = matrixShape(scene);
  const overview = matrixOverviewGeometry(
    Math.max(1, rect.width || minimap.clientWidth || 1),
    Math.max(1, rect.height || minimap.clientHeight || 1),
    Math.max(1, Number(shape?.[0] || 128)),
    Math.max(1, Number(shape?.[1] || 128)),
  );
  const displayCol = clamp((event.clientX - rect.left - overview.originX) / overview.cell, 0, overview.displayCols);
  const displayRow = clamp((event.clientY - rect.top - overview.originY) / overview.cell, 0, overview.displayRows);
  centerMatrixViewportOnDisplay(displayCol, displayRow);
}

function centerMatrixViewportOnDisplay(displayCol, displayRow) {
  const canvas = $("matrixScene");
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!canvas || !scene?.available) return;
  const rect = canvas.getBoundingClientRect();
  const shape = matrixShape(scene);
  const rows = Math.max(1, Number(shape?.[0] || 128));
  const cols = Math.max(1, Number(shape?.[1] || 128));
  const geom = matrixSceneGeometry(
    Math.max(1, Math.round(rect.width || canvas.clientWidth || 1)),
    Math.max(1, Math.round(rect.height || canvas.clientHeight || 1)),
    rows,
    cols,
  );
  const cell = geom.baseCell * state.matrixView.zoom;
  const gridWidth = geom.displayCols * cell;
  const gridHeight = geom.displayRows * cell;
  const centeredOriginX = (geom.width - gridWidth) / 2;
  const centeredOriginY = (geom.height - gridHeight) / 2;
  state.matrixView.panX = geom.width / 2 - displayCol * cell - centeredOriginX;
  state.matrixView.panY = geom.height / 2 - displayRow * cell - centeredOriginY;
  clampMatrixView(geom.width, geom.height, gridWidth, gridHeight, geom.pad);
  scheduleMatrixSceneRender();
}

function canvasPointToDisplayCell(geom, x, y, options = {}) {
  const col = (x - geom.originX) / geom.cell;
  const row = (y - geom.originY) / geom.cell;
  if (options.clamp === false) return { col, row };
  return {
    col: clamp(col, 0, geom.displayCols),
    row: clamp(row, 0, geom.displayRows),
  };
}

function canvasPointToElectrode(geom, x, y, options = {}) {
  const info = canvasPointToElectrodeInfo(geom, x, y, options);
  return info ? { row: info.row, col: info.col } : null;
}

function canvasPointToElectrodeInfo(geom, x, y, options = {}) {
  const display = canvasPointToDisplayCell(geom, x, y, { clamp: false });
  const inside = matrixDisplayPointInside(geom, display);
  if (!inside && !options.clampToGrid) return null;
  const electrode = matrixElectrodeFromDisplayPosition(geom, display);
  if (!electrode) return null;
  return {
    ...electrode,
    inside,
    display,
  };
}

function matrixDisplayPointInside(geom, display) {
  return !!geom
    && !!display
    && display.col >= 0
    && display.row >= 0
    && display.col < geom.displayCols
    && display.row < geom.displayRows;
}

function matrixElectrodeFromDisplayPosition(geom, display) {
  if (!geom || !display) return null;
  const displayCol = clamp(Math.floor(Number(display.col)), 0, geom.displayCols - 1);
  const displayRow = clamp(Math.floor(Number(display.row)), 0, geom.displayRows - 1);
  if (!Number.isFinite(displayCol) || !Number.isFinite(displayRow)) return null;
  const row = geom.rows - displayCol - 1;
  const col = displayRow;
  if (row < 0 || row >= geom.rows || col < 0 || col >= geom.cols) return null;
  return { row, col };
}

function matrixGeometryForPointer(rectOverride = null) {
  const canvas = $("matrixScene");
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!canvas || !scene?.available) return null;
  const rect = rectOverride || canvas.getBoundingClientRect();
  const shape = matrixShape(scene);
  const geom = matrixSceneGeometry(
    Math.max(1, Math.round(rect.width || canvas.clientWidth || 1)),
    Math.max(1, Math.round(rect.height || canvas.clientHeight || 1)),
    Math.max(1, Number(shape?.[0] || 128)),
    Math.max(1, Number(shape?.[1] || 128)),
  );
  return { canvas, scene, rect, geom };
}

function matrixPointerInfoFromEvent(event, options = {}) {
  const geometry = matrixGeometryForPointer(options.rect || null);
  if (!geometry) return null;
  const raw = {
    x: event.clientX - geometry.rect.left,
    y: event.clientY - geometry.rect.top,
  };
  const hover = options.magnetic
    ? matrixMagneticHoverPoint(raw, geometry.rect)
    : matrixHoverPoint(raw, geometry.rect);
  state.matrixNav.lastPointerX = raw.x;
  state.matrixNav.lastPointerY = raw.y;
  state.matrixNav.lastPointerAt = performance.now();
  state.matrixNav.lastCanvasPoint = hover;
  return matrixPointerInfoFromCanvasPoint(raw, {
    ...options,
    ...geometry,
    hover,
  });
}

function matrixPointerInfoFromCanvasPoint(point, options = {}) {
  const geometry = options.geom
    ? options
    : matrixGeometryForPointer(options.rect || null);
  if (!geometry?.geom || !point) return null;
  const display = canvasPointToDisplayCell(geometry.geom, point.x, point.y, { clamp: false });
  const electrodeInfo = canvasPointToElectrodeInfo(
    geometry.geom,
    point.x,
    point.y,
    { clampToGrid: options.clampToGrid === true },
  );
  return {
    canvas: geometry.canvas,
    scene: geometry.scene,
    rect: geometry.rect,
    geom: geometry.geom,
    raw: point,
    hover: options.hover || matrixHoverPoint(point, geometry.rect),
    display,
    electrode: electrodeInfo ? { row: electrodeInfo.row, col: electrodeInfo.col } : null,
    insideGrid: !!electrodeInfo?.inside,
  };
}

function matrixHoverPoint(point, rect) {
  if (!point || !rect) return null;
  if (point.x < 0 || point.y < 0 || point.x > rect.width || point.y > rect.height) return null;
  return { x: point.x, y: point.y };
}

function matrixMagneticHoverPoint(point, rect) {
  if (!point || !rect) return null;
  const inside = point.x >= 0 && point.y >= 0 && point.x <= rect.width && point.y <= rect.height;
  if (inside) return { x: point.x, y: point.y };
  const marginX = rect.width * 0.05;
  const marginY = rect.height * 0.05;
  const inTrapBand = point.x >= -marginX
    && point.x <= rect.width + marginX
    && point.y >= -marginY
    && point.y <= rect.height + marginY;
  if (!inTrapBand) return null;
  const previousX = Number(state.matrixNav.lastPointerX);
  const previousY = Number(state.matrixNav.lastPointerY);
  const previousAt = Number(state.matrixNav.lastPointerAt);
  const now = performance.now();
  const dt = previousAt ? Math.max(0.001, (now - previousAt) / 1000) : 0;
  const speed = dt && Number.isFinite(previousX) && Number.isFinite(previousY)
    ? Math.hypot(point.x - previousX, point.y - previousY) / dt
    : 0;
  const escapeSpeed = clamp(Math.max(rect.width, rect.height) * 1.8, 720, 1600);
  if (speed > escapeSpeed) return null;
  return {
    x: clamp(point.x, 0, rect.width),
    y: clamp(point.y, 0, rect.height),
  };
}

function stageFromElectrode(scene, row, col) {
  const mapping = scene?.coordinate_mapping || scene?.stage_mapping;
  if (!mapping || typeof mapping !== "object") return null;
  const origin = mapping.chip_origin || mapping.origin || {};
  const offset = mapping.offset || {};
  const interRow = numericVector(mapping.inter_row);
  const interColumn = numericVector(mapping.inter_column || mapping.inter_col);
  if (interRow.length < 2 || interColumn.length < 2) return null;

  const originX = firstFiniteNumber(origin.X, origin.x);
  const originY = firstFiniteNumber(origin.Y, origin.y);
  if (originX === null || originY === null) return null;

  const offsetX = firstFiniteNumber(offset.X, offset.x, mapping.offset_x) ?? 0;
  const offsetY = firstFiniteNumber(offset.Y, offset.y, mapping.offset_y) ?? 0;
  const x = originX + offsetX + row * interRow[0] + col * interColumn[0];
  const y = originY + offsetY + row * interRow[1] + col * interColumn[1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const originZ = firstFiniteNumber(origin.Z, origin.z);
  const offsetZ = firstFiniteNumber(offset.Z, offset.z, mapping.offset_z) ?? 0;
  const z = originZ === null
    ? null
    : originZ + offsetZ + row * (interRow[2] || 0) + col * (interColumn[2] || 0);

  return {
    X: Math.trunc(x),
    Y: Math.trunc(y),
    ...(Number.isFinite(z) ? { Z: Math.trunc(z) } : {}),
  };
}

function electrodeFromStage(scene, stage) {
  const mapping = scene?.coordinate_mapping || scene?.stage_mapping;
  if (!mapping || typeof mapping !== "object" || !stage || typeof stage !== "object") return null;
  const origin = mapping.chip_origin || mapping.origin || {};
  const offset = mapping.offset || {};
  const interRow = numericVector(mapping.inter_row);
  const interColumn = numericVector(mapping.inter_column || mapping.inter_col);
  if (interRow.length < 2 || interColumn.length < 2) return null;

  const stageX = firstFiniteNumber(stage.X, stage.x);
  const stageY = firstFiniteNumber(stage.Y, stage.y);
  const originX = firstFiniteNumber(origin.X, origin.x);
  const originY = firstFiniteNumber(origin.Y, origin.y);
  if (stageX === null || stageY === null || originX === null || originY === null) return null;

  const offsetX = firstFiniteNumber(offset.X, offset.x, mapping.offset_x) ?? 0;
  const offsetY = firstFiniteNumber(offset.Y, offset.y, mapping.offset_y) ?? 0;
  const targetX = stageX - originX - offsetX;
  const targetY = stageY - originY - offsetY;
  const rowX = interRow[0];
  const rowY = interRow[1];
  const colX = interColumn[0];
  const colY = interColumn[1];
  const determinant = rowX * colY - colX * rowY;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) return null;

  const row = (targetX * colY - colX * targetY) / determinant;
  const col = (rowX * targetY - targetX * rowY) / determinant;
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { row, col };
}

function numericVector(values) {
  if (!Array.isArray(values)) return [];
  const numbers = values.map((value) => Number(value));
  return numbers.every(Number.isFinite) ? numbers : [];
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawMatrixBackground(ctx, geom) {
  ctx.save();
  roundedRect(ctx, geom.originX, geom.originY, geom.gridWidth, geom.gridHeight, 6);
  ctx.fillStyle = "#090b0d";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const fullGrid = geom.cell >= 7;
  const majorEvery = fullGrid ? 1 : Math.max(8, Math.round(Math.max(geom.displayRows, geom.displayCols) / 8));
  ctx.strokeStyle = fullGrid ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let row = 0; row <= geom.displayRows; row += majorEvery) {
    const y = geom.originY + row * geom.cell;
    if (y < -2 || y > geom.height + 2) continue;
    ctx.beginPath();
    ctx.moveTo(geom.originX, y);
    ctx.lineTo(geom.originX + geom.gridWidth, y);
    ctx.stroke();
  }
  for (let col = 0; col <= geom.displayCols; col += majorEvery) {
    const x = geom.originX + col * geom.cell;
    if (x < -2 || x > geom.width + 2) continue;
    ctx.beginPath();
    ctx.moveTo(x, geom.originY);
    ctx.lineTo(x, geom.originY + geom.gridHeight);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCartridgeInputHoles(ctx, geom, scene, options = {}) {
  const holes = cartridgeInputHoles(scene);
  if (!holes.length) return;

  ctx.save();
  for (const hole of holes) {
    const region = hole?.electrode_region || hole?.region || hole;
    const bounds = matrixRegionBounds(region, geom);
    if (!bounds) continue;
    const rect = matrixBboxRect(geom, {
      row_min: bounds.rowMin,
      row_max: bounds.rowMax,
      col_min: bounds.colMin,
      col_max: bounds.colMax,
    });
    const normal = inputHoleDisplayNormal(hole, bounds, geom);
    const port = inputHolePortRect(rect, normal, geom, options);
    if (port.x + port.w < -18 || port.y + port.h < -18 || port.x > geom.width + 18 || port.y > geom.height + 18) {
      continue;
    }

    const colors = inputHoleColors(hole);
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = options.compact ? 4 : Math.max(6, Math.min(18, geom.cell * 1.7));
    ctx.fillStyle = colors.fill;
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = options.compact ? 1 : Math.max(1.1, Math.min(2.2, geom.cell * 0.18));
    roundedRect(ctx, port.x, port.y, port.w, port.h, Math.min(port.w, port.h) * 0.36);
    ctx.fill();
    ctx.stroke();

    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    const dotRadius = Math.max(options.compact ? 1.1 : 2.2, Math.min(options.compact ? 3 : 6, geom.cell * 0.65));
    ctx.shadowBlur = options.compact ? 0 : Math.max(2, Math.min(8, geom.cell));
    ctx.fillStyle = colors.core;
    ctx.beginPath();
    ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    if (!options.compact && geom.cell >= 4.4) {
      const label = inputHoleShortLabel(hole);
      if (label) {
        ctx.shadowBlur = 0;
        ctx.font = `${Math.max(8, Math.min(10, geom.cell * 0.82))}px -apple-system, BlinkMacSystemFont, Segoe UI`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = colors.text;
        ctx.fillText(label, centerX, centerY);
      }
    }
  }
  ctx.restore();
}

function drawMatrixCoordinateAxes(ctx, geom, scene) {
  const cartridge = cartridgeMetadata(scene);
  const tickEvery = Math.max(1, Number(cartridge?.axis_tick_every || 10));
  const rowTicks = electrodeAxisTicks(geom.rows, tickEvery);
  const colTicks = electrodeAxisTicks(geom.cols, tickEvery);
  const topY = geom.originY;
  const rightX = geom.originX + geom.gridWidth;
  const tickLength = Math.max(5, Math.min(12, geom.cell * 2.1));
  const fontSize = Math.max(8, Math.min(11, geom.cell * 1.45));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, Segoe UI`;

  if (topY > -36 && topY < geom.height + 36) {
    const labelY = clamp(topY - tickLength - fontSize - 8, 12, geom.height - 12);
    drawMatrixAxisRail(ctx, geom.originX, topY, geom.originX + geom.gridWidth, topY, "rgba(87, 222, 255, 0.68)");
    ctx.strokeStyle = "rgba(87, 222, 255, 0.62)";
    ctx.fillStyle = "rgba(199, 248, 255, 0.82)";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const row of rowTicks) {
      const x = geom.originX + (geom.rows - row - 0.5) * geom.cell;
      if (x < -28 || x > geom.width + 28) continue;
      ctx.beginPath();
      ctx.moveTo(x, topY - tickLength);
      ctx.lineTo(x, topY - 1);
      ctx.stroke();
      ctx.fillText(String(row), x, topY - tickLength - 2);
    }
    drawMatrixAxisLabel(ctx, "LEFT", clamp(geom.originX + geom.gridWidth / 2, 48, geom.width - 48), labelY, 0, {
      color: "rgba(151, 240, 255, 0.76)",
      glow: "rgba(87, 222, 255, 0.32)",
    });
  }

  if (rightX > -36 && rightX < geom.width + 36) {
    const labelX = clamp(rightX + tickLength + fontSize + 12, 12, geom.width - 12);
    drawMatrixAxisRail(ctx, rightX, geom.originY, rightX, geom.originY + geom.gridHeight, "rgba(255, 196, 92, 0.68)");
    ctx.strokeStyle = "rgba(255, 196, 92, 0.62)";
    ctx.fillStyle = "rgba(255, 230, 184, 0.82)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const col of colTicks) {
      const y = geom.originY + (col + 0.5) * geom.cell;
      if (y < -28 || y > geom.height + 28) continue;
      ctx.beginPath();
      ctx.moveTo(rightX + 1, y);
      ctx.lineTo(rightX + tickLength, y);
      ctx.stroke();
      ctx.save();
      ctx.translate(rightX + tickLength + 5, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(col), 0, 0);
      ctx.restore();
    }
    drawMatrixAxisLabel(ctx, "TOP", labelX, clamp(geom.originY + geom.gridHeight / 2, 42, geom.height - 42), Math.PI / 2, {
      color: "rgba(255, 219, 154, 0.78)",
      glow: "rgba(255, 196, 92, 0.3)",
    });
  }

  ctx.restore();
}

function drawMatrixAxisRail(ctx, x0, y0, x1, y1, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

function drawMatrixAxisLabel(ctx, text, x, y, angle, colors) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `700 12px -apple-system, BlinkMacSystemFont, Segoe UI`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = 10;
  ctx.fillStyle = colors.color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function cartridgeMetadata(scene) {
  const cartridge = scene?.cartridge
    || scene?.metadata?.cartridge
    || scene?.context?.cartridge
    || scene?.result?.cartridge;
  return cartridge && typeof cartridge === "object" ? cartridge : null;
}

function cartridgeInputHoles(scene) {
  const cartridge = cartridgeMetadata(scene);
  const holes = cartridge?.input_holes || cartridge?.inputHoles;
  return Array.isArray(holes) ? holes.filter((hole) => hole && typeof hole === "object") : [];
}

function matrixRegionBounds(region, geom) {
  if (!region || typeof region !== "object") return null;
  let rowRange = normalizeElectrodeRange(firstDefined(
    region.rows,
    region.row_range,
    region.rowRange,
    region.row,
    region.r,
  ), geom.rows);
  let colRange = normalizeElectrodeRange(firstDefined(
    region.columns,
    region.cols,
    region.column_range,
    region.columnRange,
    region.column,
    region.col,
    region.c,
  ), geom.cols);

  const explicitRowMin = firstFiniteNumber(region.row_min, region.rowMin, region.r0, region.start_row);
  const explicitRowMax = firstFiniteNumber(region.row_max, region.rowMax, region.r1, region.end_row);
  const explicitColMin = firstFiniteNumber(region.column_min, region.columnMin, region.col_min, region.colMin, region.c0, region.start_column);
  const explicitColMax = firstFiniteNumber(region.column_max, region.columnMax, region.col_max, region.colMax, region.c1, region.end_column);
  if (!rowRange && Number.isFinite(explicitRowMin) && Number.isFinite(explicitRowMax)) {
    rowRange = normalizeElectrodeRange([explicitRowMin, explicitRowMax], geom.rows);
  }
  if (!colRange && Number.isFinite(explicitColMin) && Number.isFinite(explicitColMax)) {
    colRange = normalizeElectrodeRange([explicitColMin, explicitColMax], geom.cols);
  }
  if (!rowRange || !colRange) return null;
  return {
    rowMin: rowRange[0],
    rowMax: rowRange[1],
    colMin: colRange[0],
    colMax: colRange[1],
  };
}

function normalizeElectrodeRange(value, limit) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return normalizeElectrodeRange([
      firstDefined(value.min, value.start, value.first, value.from),
      firstDefined(value.max, value.end, value.last, value.to),
    ], limit);
  }
  const values = Array.isArray(value) ? value : [value, value];
  if (!values.length) return null;
  const first = Number(values[0]);
  const last = Number(values.length > 1 ? values[1] : values[0]);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  const min = Math.trunc(clamp(Math.min(first, last), 0, limit - 1));
  const max = Math.trunc(clamp(Math.max(first, last), 0, limit - 1));
  return [min, max];
}

function inputHoleDisplayNormal(hole, bounds, geom) {
  const side = String(hole?.side || "").toLowerCase();
  if (side === "left") return { x: 0, y: -1 };
  if (side === "right") return { x: 0, y: 1 };
  if (side === "top") return { x: 1, y: 0 };
  if (side === "bottom") return { x: -1, y: 0 };
  if (bounds.colMin <= 0) return { x: 0, y: -1 };
  if (bounds.colMax >= geom.cols - 1) return { x: 0, y: 1 };
  if (bounds.rowMin <= 0) return { x: 1, y: 0 };
  if (bounds.rowMax >= geom.rows - 1) return { x: -1, y: 0 };
  return { x: 0, y: 0 };
}

function inputHolePortRect(rect, normal, geom, options = {}) {
  const compact = !!options.compact;
  const depth = compact ? Math.max(2.5, geom.cell * 1.8) : Math.max(10, Math.min(24, geom.cell * 3.4));
  const alongPad = compact ? Math.max(0.8, geom.cell * 0.35) : Math.max(4, Math.min(10, geom.cell * 1.05));
  const minAlong = compact ? 2 : 16;
  let x = rect.x;
  let y = rect.y;
  let w = rect.w;
  let h = rect.h;
  if (normal.y < 0) {
    x -= alongPad;
    y -= depth * 0.62;
    w += alongPad * 2;
    h = Math.max(h + depth, minAlong);
  } else if (normal.y > 0) {
    x -= alongPad;
    w += alongPad * 2;
    h = Math.max(h + depth, minAlong);
  } else if (normal.x > 0) {
    y -= alongPad;
    w = Math.max(w + depth, minAlong);
    h += alongPad * 2;
  } else if (normal.x < 0) {
    x -= depth * 0.62;
    y -= alongPad;
    w = Math.max(w + depth, minAlong);
    h += alongPad * 2;
  } else {
    x -= alongPad;
    y -= alongPad;
    w += alongPad * 2;
    h += alongPad * 2;
  }
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

function inputHoleColors(hole) {
  const side = String(hole?.side || "").toLowerCase();
  if (side === "right" || side === "bottom") {
    return {
      fill: "rgba(255, 181, 84, 0.28)",
      stroke: "rgba(255, 202, 116, 0.92)",
      core: "rgba(255, 232, 180, 0.94)",
      glow: "rgba(255, 181, 84, 0.42)",
      text: "rgba(255, 245, 222, 0.9)",
    };
  }
  return {
    fill: "rgba(83, 222, 255, 0.28)",
    stroke: "rgba(126, 237, 255, 0.92)",
    core: "rgba(211, 250, 255, 0.94)",
    glow: "rgba(83, 222, 255, 0.42)",
    text: "rgba(232, 253, 255, 0.9)",
  };
}

function inputHoleShortLabel(hole) {
  const id = String(hole?.id || "").trim();
  if (!id) return "";
  if (id.includes("upper")) return "IN";
  if (id.includes("lower")) return "IN";
  return "IN";
}

function electrodeAxisTicks(count, every = 10) {
  const limit = Math.max(1, Math.trunc(Number(count) || 1));
  const step = Math.max(1, Math.trunc(Number(every) || 10));
  const ticks = [];
  for (let value = 0; value < limit; value += step) ticks.push(value);
  const last = limit - 1;
  if (last > 0 && last - ticks[ticks.length - 1] >= Math.max(4, Math.floor(step / 2))) {
    ticks.push(last);
  }
  return ticks;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function drawMicroscopeFoV(ctx, geom, scene) {
  const center = electrodeFromStage(scene, currentStagePosition());
  if (!center) return null;
  const point = matrixContinuousCellCenter(geom, center.row, center.col);
  const radius = 2.5 * geom.cell;
  const outside = (
    point.x + radius < geom.originX
    || point.x - radius > geom.originX + geom.gridWidth
    || point.y + radius < geom.originY
    || point.y - radius > geom.originY + geom.gridHeight
  );
  if (outside) return null;

  ctx.save();
  roundedRect(ctx, geom.originX, geom.originY, geom.gridWidth, geom.gridHeight, 6);
  ctx.clip();

  ctx.fillStyle = "rgba(255, 214, 10, 0.08)";
  ctx.strokeStyle = "rgba(255, 214, 10, 0.88)";
  ctx.lineWidth = Math.max(1.25, Math.min(3, geom.cell * 0.18));
  ctx.setLineDash([Math.max(3, geom.cell * 0.75), Math.max(2, geom.cell * 0.45)]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255, 214, 10, 0.95)";
  ctx.lineWidth = Math.max(1, Math.min(2, geom.cell * 0.15));
  const cross = Math.max(4, Math.min(12, geom.cell * 0.85));
  ctx.beginPath();
  ctx.moveTo(point.x - cross, point.y);
  ctx.lineTo(point.x + cross, point.y);
  ctx.moveTo(point.x, point.y - cross);
  ctx.lineTo(point.x, point.y + cross);
  ctx.stroke();

  if (geom.cell >= 6) {
    ctx.font = `${Math.max(9, Math.min(12, geom.cell * 0.85))}px -apple-system, BlinkMacSystemFont, Segoe UI`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(255, 214, 10, 0.95)";
    ctx.fillText("FoV", point.x, point.y - radius - 3);
  }

  ctx.restore();
  return center;
}

function drawMatrixRanges(ctx, geom, summary, color) {
  const valueRanges = summary?.values || summary?.ranges_by_value || summary?.rows_by_value;
  if (valueRanges && typeof valueRanges === "object") {
    const entries = Object.entries(valueRanges).sort(([a], [b]) => Number(a) - Number(b));
    for (const [valueKey, payload] of entries) {
      const rows = payload?.rows || payload;
      drawMatrixRangeRows(ctx, geom, rows, matrixValueColor(valueKey, color), matrixValueGlow(valueKey));
    }
    return;
  }
  drawMatrixRangeRows(ctx, geom, summary?.rows, color, "rgba(100, 210, 255, 0.45)");
}

function drawMatrixRangeRows(ctx, geom, rows, color, glowColor) {
  if (!rows || typeof rows !== "object") return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = glowColor || color;
  ctx.shadowBlur = Math.max(0, geom.cell * 0.8);
  for (const [rowKey, ranges] of Object.entries(rows)) {
    const row = Number(rowKey);
    if (!Number.isFinite(row) || !Array.isArray(ranges)) continue;
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length < 2) continue;
      const c0 = Number(range[0]);
      const c1 = Number(range[1]);
      if (!Number.isFinite(c0) || !Number.isFinite(c1)) continue;
      const cStart = Math.min(c0, c1);
      const cEnd = Math.max(c0, c1);
      for (let col = cStart; col <= cEnd; col += 1) {
        const rect = matrixCellRect(geom, row, col);
        ctx.fillRect(rect.x, rect.y, Math.max(geom.cell, 1), Math.max(geom.cell, 1));
      }
    }
  }
  ctx.restore();
}

function matrixValueColor(value, fallback) {
  const numeric = Number(value);
  if (numeric < 0) return "rgba(255, 55, 95, 0.46)";
  if (numeric > 0) return fallback || "rgba(100, 210, 255, 0.45)";
  return fallback || "rgba(100, 210, 255, 0.45)";
}

function matrixValueGlow(value) {
  const numeric = Number(value);
  if (numeric < 0) return "rgba(255, 55, 95, 0.42)";
  if (numeric > 0) return "rgba(100, 210, 255, 0.45)";
  return "rgba(100, 210, 255, 0.36)";
}

function renderMatrixPaintPanel() {
  const panel = $("matrixPaintPanel");
  const toggle = $("matrixPaintToggle");
  const viewer = $("matrixScene")?.closest(".viewer.matrix");
  if (!panel || !toggle) return;
  if (state.matrixPaint.collapsed && state.matrixPaint.tool) {
    state.matrixPaint.tool = "";
  }
  panel.classList.toggle("collapsed", state.matrixPaint.collapsed);
  toggle.setAttribute("aria-expanded", String(!state.matrixPaint.collapsed));
  const active = activeMatrixPaintValue() !== null;
  if (active) {
    if (state.matrixSelection.dragging) resetMatrixSelectionDrag();
    clearMatrixSelectionForPaintMode({ render: false });
  }
  viewer?.classList.toggle("paint-active", active);
  for (const button of panel.querySelectorAll("[data-paint-tool]")) {
    button.classList.toggle("selected", button.getAttribute("data-paint-tool") === state.matrixPaint.tool);
  }
  updateMatrixPaintCursor(state.matrixHover);
}

function clearMatrixSelectionForPaintMode(options = {}) {
  const hadSelection = selectedTimelineDropletId() !== null;
  setMatrixSelectedDropletIds([]);
  state.matrixCommands.lastError = "";
  state.matrixCommands.queues.clear();
  if (options.render !== false && hadSelection) {
    renderMatrixCommandPanel();
    schedulePlanTimelineRender();
  }
}

function updateMatrixPaintCursor(hover) {
  const cursor = $("matrixPaintCursor");
  const canvas = $("matrixScene");
  if (!cursor || !canvas || activeMatrixPaintValue() === null || !hover) {
    if (cursor) cursor.hidden = true;
    return;
  }
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!scene?.available) {
    cursor.hidden = true;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  if (hover.x < 0 || hover.y < 0 || hover.x > rect.width || hover.y > rect.height) {
    cursor.hidden = true;
    return;
  }
  cursor.classList.remove("block", "active", "erase");
  cursor.classList.add(state.matrixPaint.tool);
  cursor.style.left = `${hover.x}px`;
  cursor.style.top = `${hover.y}px`;
  cursor.hidden = false;
}

function activeMatrixPaintValue() {
  if (state.matrixPaint.tool === "blocked") return -1;
  if (state.matrixPaint.tool === "active") return 1;
  if (state.matrixPaint.tool === "erase") return 0;
  return null;
}

function matrixElectrodeFromPointerEvent(event, options = {}) {
  const pointer = matrixPointerInfoFromEvent(event, {
    clampToGrid: options.clampToGrid === true,
    magnetic: options.magnetic === true,
  });
  return pointer?.electrode || null;
}

function updateMatrixPaintDragFromPointer(pointer, options = {}) {
  if (!state.matrixPaint.dragging || !pointer) return;
  if (pointer.electrode) state.matrixPaint.current = pointer.electrode;
  if (pointer.display) state.matrixPaint.currentDisplay = pointer.display;
  if (options.render !== false) scheduleMatrixSceneRender();
}

function updateMatrixDragFromStoredPointer() {
  const x = Number(state.matrixNav.lastPointerX);
  const y = Number(state.matrixNav.lastPointerY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (!state.matrixPaint.dragging && !state.matrixSelection.dragging) return;
  const pointer = matrixPointerInfoFromCanvasPoint(
    { x, y },
    {
      clampToGrid: true,
      hover: state.matrixNav.lastCanvasPoint,
    },
  );
  if (!pointer) return;
  if (state.matrixPaint.dragging) updateMatrixPaintDragFromPointer(pointer, { render: false });
  if (state.matrixSelection.dragging) updateMatrixSelectionDragFromPointer(pointer, { render: false });
}

function matrixElectrodeRectFromDisplayDrag(start, current) {
  const geometry = matrixGeometryForPointer();
  if (!geometry?.geom || !start || !current) return null;
  const geom = geometry.geom;
  const left = Math.min(Number(start.col), Number(current.col));
  const right = Math.max(Number(start.col), Number(current.col));
  const top = Math.min(Number(start.row), Number(current.row));
  const bottom = Math.max(Number(start.row), Number(current.row));
  if (![left, right, top, bottom].every(Number.isFinite)) return null;

  const pointDrag = Math.abs(right - left) < 1e-6 && Math.abs(bottom - top) < 1e-6;
  if (pointDrag) {
    if (!matrixDisplayPointInside(geom, start)) return null;
    const electrode = matrixElectrodeFromDisplayPosition(geom, start);
    return electrode
      ? {
          row_min: electrode.row,
          row_max: electrode.row,
          col_min: electrode.col,
          col_max: electrode.col,
        }
      : null;
  }

  if (
    right < 0
    || left >= geom.displayCols
    || bottom < 0
    || top >= geom.displayRows
  ) {
    return null;
  }

  const displayColMin = clamp(Math.floor(Math.max(left, 0)), 0, geom.displayCols - 1);
  const displayColMax = clamp(Math.floor(Math.min(right, geom.displayCols - 1e-9)), 0, geom.displayCols - 1);
  const displayRowMin = clamp(Math.floor(Math.max(top, 0)), 0, geom.displayRows - 1);
  const displayRowMax = clamp(Math.floor(Math.min(bottom, geom.displayRows - 1e-9)), 0, geom.displayRows - 1);
  if (![displayColMin, displayColMax, displayRowMin, displayRowMax].every(Number.isFinite)) return null;

  return {
    row_min: geom.rows - displayColMax - 1,
    row_max: geom.rows - displayColMin - 1,
    col_min: displayRowMin,
    col_max: displayRowMax,
  };
}

function matrixCanvasRectFromDisplayDrag(start, current) {
  const geometry = matrixGeometryForPointer();
  if (!geometry?.geom || !start || !current) return null;
  const geom = geometry.geom;
  const left = Math.min(Number(start.col), Number(current.col));
  const right = Math.max(Number(start.col), Number(current.col));
  const top = Math.min(Number(start.row), Number(current.row));
  const bottom = Math.max(Number(start.row), Number(current.row));
  if (![left, right, top, bottom].every(Number.isFinite)) return null;
  if (
    right < 0
    || left >= geom.displayCols
    || bottom < 0
    || top >= geom.displayRows
  ) {
    return null;
  }
  const clippedLeft = clamp(left, 0, geom.displayCols);
  const clippedRight = clamp(right, 0, geom.displayCols);
  const clippedTop = clamp(top, 0, geom.displayRows);
  const clippedBottom = clamp(bottom, 0, geom.displayRows);
  return {
    x: geom.originX + clippedLeft * geom.cell,
    y: geom.originY + clippedTop * geom.cell,
    w: Math.max(0, (clippedRight - clippedLeft) * geom.cell),
    h: Math.max(0, (clippedBottom - clippedTop) * geom.cell),
  };
}

function matrixPaintRect() {
  const start = state.matrixPaint.start;
  const current = state.matrixPaint.current;
  const value = activeMatrixPaintValue();
  if (!start || !current || value === null) return null;
  if (state.matrixPaint.startDisplay && state.matrixPaint.currentDisplay) {
    const rect = matrixElectrodeRectFromDisplayDrag(
      state.matrixPaint.startDisplay,
      state.matrixPaint.currentDisplay,
    );
    return rect ? { ...rect, value } : null;
  }
  return {
    row_min: Math.min(start.row, current.row),
    row_max: Math.max(start.row, current.row),
    col_min: Math.min(start.col, current.col),
    col_max: Math.max(start.col, current.col),
    value,
  };
}

function drawMatrixPaintOverlay(ctx, geom) {
  const overlays = state.matrixPaint.overlays.filter((overlay) => Date.now() - overlay.t < 4200);
  state.matrixPaint.overlays = overlays;
  for (const overlay of overlays) {
    drawMatrixPaintRect(ctx, geom, overlay, overlay.value, 0.42);
  }
  const preview = state.matrixPaint.dragging ? matrixPaintRect() : null;
  if (preview) drawMatrixPaintRect(ctx, geom, preview, preview.value, 0.6, true);
}

function drawMatrixPaintRect(ctx, geom, rect, value, alpha = 0.5, preview = false) {
  if (!rect) return;
  const bbox = {
    row_min: rect.row_min,
    row_max: rect.row_max,
    col_min: rect.col_min,
    col_max: rect.col_max,
  };
  const box = matrixBboxRect(geom, bbox);
  const color = value < 0
    ? [255, 55, 95]
    : value > 0
      ? [100, 210, 255]
      : [245, 245, 247];
  ctx.save();
  roundedRect(ctx, box.x, box.y, box.w, box.h, Math.min(5, Math.max(1, geom.cell * 0.35)));
  ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${value === 0 ? alpha * 0.18 : alpha * 0.48})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${preview ? 0.96 : 0.68})`;
  ctx.lineWidth = Math.max(1.2, Math.min(3.2, geom.cell * (preview ? 0.2 : 0.12)));
  if (value === 0) ctx.setLineDash([Math.max(3, geom.cell * 0.8), Math.max(2, geom.cell * 0.45)]);
  ctx.stroke();
  ctx.restore();
}

function endMatrixPaintDrag() {
  const rect = matrixPaintRect();
  const eraseDropletUpdates = rect?.value === 0 ? matrixEraseDropletUpdates(rect) : [];
  state.matrixPaint.dragging = false;
  state.matrixPaint.start = null;
  state.matrixPaint.current = null;
  state.matrixPaint.startDisplay = null;
  state.matrixPaint.currentDisplay = null;
  if (!rect) {
    renderMatrixPanel(state.live || {});
    return;
  }
  if (rect.value === 0) {
    clearMatrixSelectionAfterErase(eraseDropletUpdates);
    applyMatrixEraseOverrides(eraseDropletUpdates);
  }
  state.matrixPaint.overlays.push({ ...rect, t: Date.now() });
  if (state.matrixPaint.overlays.length > 16) {
    state.matrixPaint.overlays.splice(0, state.matrixPaint.overlays.length - 16);
  }
  send({
    type: "paint_matrix_rect",
    droplet_updates: eraseDropletUpdates,
    ...rect,
  });
  renderMatrixPanel(state.live || {});
}

function matrixEraseDropletUpdates(rect) {
  if (!rect || rect.value !== 0) return [];
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!scene?.available) return [];
  const updates = [];
  for (const droplet of scene.droplets || []) {
    const dropletId = Number(droplet?.id);
    if (!Number.isFinite(dropletId)) continue;
    const cells = uniqueMatrixCells(dropletDisplayCells(droplet));
    if (!cells.length) continue;
    const erasedCells = cells.filter((cell) => matrixCellInPaintRect(cell, rect));
    if (!erasedCells.length) continue;
    const remainingCells = cells.filter((cell) => !matrixCellInPaintRect(cell, rect));
    if (!remainingCells.length) {
      updates.push({
        droplet_id: dropletId,
        action: "delete",
      });
      continue;
    }
    const bbox = bboxFromCells(remainingCells);
    const origin = [bbox.row_min, bbox.col_min];
    const shape = remainingCells
      .map((cell) => [cell[0] - origin[0], cell[1] - origin[1]])
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    updates.push({
      droplet_id: dropletId,
      action: "reshape",
      origin,
      target: normalizeMatrixPoint(droplet.target) || origin,
      shape,
      priority: Number.isFinite(Number(droplet.priority)) ? Number(droplet.priority) : 0,
      vital_space: Number.isFinite(Number(droplet.vital_space)) ? Number(droplet.vital_space) : 1,
    });
  }
  return updates;
}

function uniqueMatrixCells(cells) {
  const seen = new Set();
  const unique = [];
  for (const cell of normalizeMatrixCells(cells)) {
    const key = matrixCellKey(cell[0], cell[1]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cell);
  }
  return unique;
}

function matrixCellInPaintRect(cell, rect) {
  const row = Number(cell?.[0]);
  const col = Number(cell?.[1]);
  return Number.isFinite(row)
    && Number.isFinite(col)
    && row >= rect.row_min
    && row <= rect.row_max
    && col >= rect.col_min
    && col <= rect.col_max;
}

function clearMatrixSelectionAfterErase(updates) {
  const selected = selectedMatrixDropletIds();
  setMatrixSelectedDropletIds([]);
  for (const dropletId of selected) state.matrixCommands.queues.delete(dropletId);
  for (const update of updates || []) {
    const dropletId = Number(update?.droplet_id);
    if (Number.isFinite(dropletId)) state.matrixCommands.queues.delete(dropletId);
  }
}

function applyMatrixEraseOverrides(updates) {
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!scene?.available || !Array.isArray(updates)) return;
  const dropletById = new Map((scene.droplets || [])
    .map((droplet) => [Number(droplet?.id), droplet])
    .filter(([id]) => Number.isFinite(id)));
  for (const update of updates) {
    const dropletId = Number(update?.droplet_id);
    if (!Number.isFinite(dropletId)) continue;
    const droplet = dropletById.get(dropletId) || {};
    if (update.action === "delete") {
      state.matrixDropletOverrides.set(dropletId, {
        ...droplet,
        id: dropletId,
        active: false,
        position: null,
        origin: null,
        target: null,
        shape: [],
        cells: [],
        bbox: null,
        path: [],
        path_length: 0,
      });
      continue;
    }
    if (update.action === "reshape") {
      const origin = normalizeMatrixPoint(update.origin);
      const shape = normalizeMatrixCells(update.shape);
      if (!origin || !shape.length) continue;
      const cells = shape.map((cell) => [origin[0] + cell[0], origin[1] + cell[1]]);
      state.matrixDropletOverrides.set(dropletId, {
        ...droplet,
        id: dropletId,
        position: origin,
        origin,
        current_position: origin,
        target: normalizeMatrixPoint(update.target) || origin,
        shape,
        shape_size: shape.length,
        cells,
        cells_truncated: false,
        bbox: bboxFromCells(cells),
      });
    }
  }
}

function cancelMatrixPaintDrag() {
  state.matrixPaint.dragging = false;
  state.matrixPaint.start = null;
  state.matrixPaint.current = null;
  state.matrixPaint.startDisplay = null;
  state.matrixPaint.currentDisplay = null;
  renderMatrixPanel(state.live || {});
}

function drawMatrixPaths(ctx, geom, scene, droplets) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const allActions = matrixPathActions(scene);
  const actions = visibleMatrixPathActions(scene);
  if (allActions.length) {
    for (const action of actions) {
      const hovered = state.matrixPaths.hoveredActionId === String(action.id);
      const dimmed = Boolean(state.matrixPaths.hoveredActionId) && !hovered;
      for (const pathInfo of action.paths || []) {
        drawMatrixPathStroke(ctx, geom, pathInfo.path, {
          color: dropletColor(pathInfo.droplet_id, hovered ? 0.98 : 0.7),
          alpha: hovered ? 0.98 : dimmed ? 0.16 : 0.58,
          width: hovered ? 0.44 : 0.24,
          endpoint: true,
        });
      }
    }
  } else {
    for (const droplet of droplets) {
      drawMatrixPathStroke(ctx, geom, droplet.path, {
        color: "rgba(245, 245, 247, 0.62)",
        alpha: 0.72,
        width: 0.24,
        endpoint: true,
      });
    }
  }

  for (const droplet of droplets) {
    const target = droplet.target ? matrixCellCenter(geom, droplet.target) : null;
    if (target) drawMatrixTargetMarker(ctx, target, geom, droplet);
  }
  ctx.restore();
}

function drawMatrixQueuedPaths(ctx, geom, droplets) {
  if (!state.matrixCommands.queues.size) return;
  const dropletById = new Map((droplets || [])
    .map((droplet) => [Number(droplet?.id), droplet])
    .filter(([id]) => Number.isFinite(id)));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [dropletId, queue] of state.matrixCommands.queues.entries()) {
    if (!Array.isArray(queue) || !queue.length) continue;
    const droplet = dropletById.get(Number(dropletId));
    const start = normalizeMatrixPoint(droplet?.position)
      || normalizeMatrixPoint(droplet?.origin)
      || normalizeMatrixPoint(droplet?.current_position);
    const waypoints = queue
      .map((point) => normalizeMatrixPoint([point.row, point.col]))
      .filter(Boolean);
    if (!waypoints.length) continue;
    const selected = selectedTimelineDropletId() === Number(dropletId);
    const path = start ? [start, ...waypoints] : waypoints;
    const points = path.map((point) => matrixCellCenter(geom, point));
    ctx.save();
    ctx.setLineDash([Math.max(4, geom.cell * 0.75), Math.max(3, geom.cell * 0.55)]);
    ctx.strokeStyle = selected ? "rgba(255, 214, 10, 0.96)" : dropletColor(dropletId, 0.62);
    ctx.lineWidth = Math.max(1.4, Math.min(4.8, geom.cell * (selected ? 0.34 : 0.24)));
    ctx.globalAlpha = selected ? 0.95 : 0.58;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    if (points.length > 1) ctx.stroke();
    ctx.setLineDash([]);
    waypoints.forEach((waypoint, index) => {
      const marker = matrixCellCenter(geom, waypoint);
      const radius = Math.max(3, Math.min(11, geom.cell * 0.95));
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = selected ? "rgba(255, 214, 10, 0.22)" : dropletColor(dropletId, 0.16);
      ctx.strokeStyle = selected ? "rgba(255, 214, 10, 0.98)" : dropletColor(dropletId, 0.82);
      ctx.lineWidth = Math.max(1, Math.min(2.4, geom.cell * 0.18));
      ctx.fill();
      ctx.stroke();
      if (geom.cell >= 6) {
        ctx.fillStyle = selected ? "#ffd60a" : "#f5f5f7";
        ctx.font = `${Math.max(8, Math.min(12, geom.cell * 0.9))}px -apple-system, BlinkMacSystemFont, Segoe UI`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(index + 1), marker.x, marker.y);
      }
    });
    ctx.restore();
  }
  ctx.restore();
}

function queueMatrixWaypointFromContext(event) {
  if (state.matrixCommands.planning || !state.timeline.followLive) return false;
  const dropletId = selectedTimelineDropletId();
  if (dropletId === null) return false;
  const canvas = $("matrixScene");
  if (!canvas) return false;
  const rect = canvas.getBoundingClientRect();
  const target = matrixTargetForPoint({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
  if (!target?.electrode) return false;
  const existing = state.matrixCommands.queues.get(dropletId) || [];
  const next = event.shiftKey ? [...existing] : [];
  next.push({ row: target.electrode.row, col: target.electrode.col });
  state.matrixCommands.queues.set(dropletId, next);
  state.matrixCommands.lastError = "";
  renderMatrixPanel(state.live || {});
  renderMatrixCommandPanel();
  return true;
}

function renderMatrixCommandPanel() {
  const panel = $("matrixCommandPanel");
  const title = $("matrixCommandTitle");
  const meta = $("matrixCommandMeta");
  const clear = $("matrixCommandClear");
  const plan = $("matrixCommandPlan");
  if (!panel || !title || !meta || !clear || !plan) return;
  const dropletId = selectedTimelineDropletId();
  const selectedIds = selectedMatrixDropletIds();
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!selectedIds.length || !scene?.available) {
    panel.hidden = true;
    return;
  }
  const queue = state.matrixCommands.queues.get(dropletId) || [];
  panel.hidden = false;
  title.textContent = selectedIds.length === 1 ? `Droplet ${selectedIds[0]}` : `${selectedIds.length} droplets`;
  if (state.matrixCommands.planning) {
    meta.textContent = "Processing SIPP plan...";
  } else if (state.matrixCommands.lastError) {
    meta.textContent = state.matrixCommands.lastError;
  } else if (!state.timeline.followLive) {
    meta.textContent = "Go Live before adding planned frames";
  } else if (selectedIds.length > 1) {
    meta.textContent = `Hover to preview, press R to rotate, click empty matrix to plan`;
  } else if (queue.length) {
    const last = queue[queue.length - 1];
    meta.textContent = `${queue.length} waypoint${queue.length === 1 ? "" : "s"} -> ${last.row}, ${last.col}`;
  } else {
    meta.textContent = "Hover to preview, R rotates, click empty matrix to plan";
  }
  clear.disabled = state.matrixCommands.planning || !queue.length;
  plan.disabled = state.matrixCommands.planning || !queue.length || selectedIds.length > 1 || !state.timeline.followLive;
}

function clearSelectedMatrixCommandQueue() {
  const dropletId = selectedTimelineDropletId();
  if (dropletId === null || state.matrixCommands.planning) return;
  state.matrixCommands.queues.delete(dropletId);
  state.matrixCommands.lastError = "";
  renderMatrixPanel(state.live || {});
  renderMatrixCommandPanel();
}

function planSelectedMatrixCommandQueue() {
  const dropletId = selectedTimelineDropletId();
  if (dropletId === null || state.matrixCommands.planning || !state.timeline.followLive) return;
  const queue = state.matrixCommands.queues.get(dropletId) || [];
  if (!queue.length) return;
  state.matrixCommands.planning = true;
  state.matrixCommands.lastError = "";
  renderMatrixCommandPanel();
  schedulePlanTimelineRender();
  send({
    type: "matrix_plan_waypoint_paths",
    droplet_id: dropletId,
    mode: "sipp",
    waypoints: queue.map((point) => [Number(point.row), Number(point.col)]),
  });
}

function drawMatrixPathStroke(ctx, geom, path, options = {}) {
  const compacted = compactDisplayPath(path);
  if (!compacted.length) return;
  const points = compacted.map((point) => matrixCellCenter(geom, point));
  ctx.save();
  ctx.strokeStyle = options.color || "rgba(245, 245, 247, 0.62)";
  ctx.lineWidth = Math.max(1, Math.min(options.endpoint ? 4.2 : 2.5, geom.cell * (options.width || 0.24)));
  ctx.globalAlpha = options.alpha ?? 0.72;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (points.length > 1) ctx.stroke();
  if (options.endpoint !== false) drawMatrixPathEndpoint(ctx, points, geom);
  ctx.restore();
}

function compactDisplayPath(path) {
  if (!Array.isArray(path)) return [];
  const compacted = [];
  let previous = null;
  path.forEach((point) => {
    if (!Array.isArray(point) || point.length < 2) return;
    const next = [Number(point[0]), Number(point[1])];
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) return;
    if (previous && previous[0] === next[0] && previous[1] === next[1]) return;
    compacted.push(next);
    previous = next;
  });
  return compacted;
}

function drawMatrixPathEndpoint(ctx, points, geom) {
  if (!points.length) return;
  const end = points[points.length - 1];
  if (points.length === 1) {
    ctx.fillStyle = "rgba(245, 245, 247, 0.7)";
    ctx.beginPath();
    ctx.arc(end.x, end.y, Math.max(2, Math.min(5, geom.cell * 0.55)), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  let previous = points[points.length - 2];
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const candidate = points[index];
    if (candidate.x !== end.x || candidate.y !== end.y) {
      previous = candidate;
      break;
    }
  }
  const dx = end.x - previous.x;
  const dy = end.y - previous.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return;
  const ux = dx / length;
  const uy = dy / length;
  const arrowLength = Math.max(5, Math.min(16, geom.cell * 1.35));
  const arrowAngle = 0.55;
  const left = {
    x: end.x - arrowLength * (ux * Math.cos(arrowAngle) + uy * Math.sin(arrowAngle)),
    y: end.y - arrowLength * (uy * Math.cos(arrowAngle) - ux * Math.sin(arrowAngle)),
  };
  const right = {
    x: end.x - arrowLength * (ux * Math.cos(arrowAngle) - uy * Math.sin(arrowAngle)),
    y: end.y - arrowLength * (uy * Math.cos(arrowAngle) + ux * Math.sin(arrowAngle)),
  };
  ctx.strokeStyle = "rgba(245, 245, 247, 0.72)";
  ctx.lineWidth = Math.max(1, Math.min(2.25, geom.cell * 0.22));
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(left.x, left.y);
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(right.x, right.y);
  ctx.stroke();
}

function drawMatrixTargetMarker(ctx, target, geom, droplet) {
  ctx.save();
  ctx.globalAlpha = droplet.target_reached ? 0.45 : 0.7;
  ctx.strokeStyle = droplet.target_reached ? "rgba(48, 209, 88, 0.82)" : "rgba(245, 245, 247, 0.42)";
  ctx.lineWidth = Math.max(1, Math.min(2, geom.cell * 0.2));
  ctx.setLineDash([Math.max(2, geom.cell * 0.65), Math.max(2, geom.cell * 0.65)]);
  ctx.beginPath();
  ctx.arc(target.x, target.y, Math.max(3, Math.min(14, geom.cell * 1.25)), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawMatrixDroplets(ctx, geom, droplets) {
  const hitboxes = [];
  const selectedIds = new Set(selectedMatrixDropletIds());
  ctx.save();
  for (const droplet of droplets) {
    const cells = dropletDisplayCells(droplet);
    const bbox = droplet.bbox || bboxFromCells(cells);
    if (!bbox) continue;
    const rect = matrixBboxRect(geom, bbox);
    const { x, y, w, h } = rect;
    const selected = selectedIds.has(Number(droplet.id));
    const color = dropletColor(droplet.id, droplet.active === false ? 0.38 : 0.82);
    ctx.fillStyle = color;
    ctx.shadowColor = selected ? "rgba(255, 214, 10, 0.8)" : dropletColor(droplet.id, 0.4);
    ctx.shadowBlur = selected ? Math.max(4, geom.cell * 2.6) : Math.max(2, geom.cell * 1.7);
    if (cells.length) {
      drawDropletCells(ctx, geom, cells);
    } else {
      roundedRect(ctx, x + 1, y + 1, Math.max(2, w - 2), Math.max(2, h - 2), Math.min(8, Math.max(2, geom.cell * 0.8)));
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = selected
      ? "rgba(255, 214, 10, 0.96)"
      : droplet.target_reached ? "rgba(48, 209, 88, 0.95)" : "rgba(245, 245, 247, 0.72)";
    ctx.lineWidth = selected ? Math.max(1.6, Math.min(3.4, geom.cell * 0.28)) : Math.max(1, Math.min(2.5, geom.cell * 0.2));
    if (cells.length) {
      drawDropletCellOutline(ctx, geom, cells);
    } else {
      roundedRect(ctx, x + 1, y + 1, Math.max(2, w - 2), Math.max(2, h - 2), Math.min(8, Math.max(2, geom.cell * 0.8)));
      ctx.stroke();
    }

    const label = String(droplet.id);
    const labelPoint = dropletLabelPoint(geom, cells, rect);
    ctx.font = `${Math.max(9, Math.min(16, geom.cell * 2.2))}px -apple-system, BlinkMacSystemFont, Segoe UI`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#050607";
    ctx.fillText(label, labelPoint.x, labelPoint.y);
    hitboxes.push({ x, y, w, h, cells: cells.map((cell) => matrixCellRect(geom, cell[0], cell[1])), droplet });
  }
  ctx.restore();
  return hitboxes;
}

function matrixDropletsWithOverrides(droplets) {
  if (!state.matrixDropletOverrides.size) return droplets;
  const seen = new Set();
  const merged = droplets.map((droplet) => {
    const id = Number(droplet?.id);
    if (!Number.isFinite(id)) return droplet;
    seen.add(id);
    const override = state.matrixDropletOverrides.get(id);
    return override ? { ...droplet, ...override } : droplet;
  });
  for (const [id, override] of state.matrixDropletOverrides.entries()) {
    if (!seen.has(Number(id))) merged.push(override);
  }
  return merged;
}

function dropletDisplayCells(droplet) {
  const direct = normalizeMatrixCells(droplet?.cells);
  if (direct.length && !droplet?.cells_truncated) return direct;
  const position = Array.isArray(droplet?.position) ? droplet.position : droplet?.origin;
  const shape = normalizeMatrixCells(droplet?.shape);
  if (Array.isArray(position) && position.length >= 2 && shape.length) {
    const row = Number(position[0]);
    const col = Number(position[1]);
    if (Number.isFinite(row) && Number.isFinite(col)) {
      return shape.map((offset) => [row + offset[0], col + offset[1]]);
    }
  }
  return direct;
}

function dynamicDropletForSceneFrame(scene, droplet) {
  if (!droplet || droplet.id === undefined || droplet.id === null) return droplet;
  if (!sceneFrameIsLinearExtraction(scene, Number(droplet.id))) return droplet;
  const summary = scene?.frame?.summary || scene?.matrix;
  const activeCells = matrixSummaryCells(summary);
  if (!activeCells.length) return droplet;

  const siblingCells = new Set();
  for (const sibling of scene?.droplets || []) {
    if (!sibling || Number(sibling.id) === Number(droplet.id) || sibling.active === false) continue;
    for (const cell of dropletDisplayCells(sibling)) {
      siblingCells.add(matrixCellKey(cell[0], cell[1]));
    }
  }
  const cells = activeCells.filter((cell) => !siblingCells.has(matrixCellKey(cell[0], cell[1])));
  if (!cells.length) return droplet;
  return {
    ...droplet,
    cells,
    cells_truncated: false,
    bbox: bboxFromCells(cells),
    shape_size: cells.length,
    dynamic_shape: true,
  };
}

function sceneFrameIsLinearExtraction(scene, dropletId) {
  const currentEvent = scene?.plan?.current_event;
  const type = Array.isArray(currentEvent) ? String(currentEvent[1] || "").toLowerCase() : "";
  const data = Array.isArray(currentEvent) && currentEvent[2] && typeof currentEvent[2] === "object"
    ? currentEvent[2]
    : {};
  const primitive = String(data.primitive || type || "").toLowerCase();
  const splitMode = String(data.split_mode || data.mode || "").toLowerCase();
  const reservoirId = Number(data.reservoir_droplet_id);
  return (
    Number.isFinite(reservoirId)
    && reservoirId === Number(dropletId)
    && (primitive.includes("reservoir_extraction") || type.includes("extraction"))
    && splitMode === "linear"
  );
}

function matrixSummaryCells(summary, maxCells = 20000) {
  if (!summary || typeof summary !== "object") return [];
  if (Array.isArray(summary.active_cells)) return normalizeMatrixCells(summary.active_cells);
  const rows = summary.rows;
  if (!rows || typeof rows !== "object") return [];
  const cells = [];
  for (const [rowKey, ranges] of Object.entries(rows)) {
    const row = Number(rowKey);
    if (!Number.isFinite(row) || !Array.isArray(ranges)) continue;
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length < 2) continue;
      const start = Number(range[0]);
      const end = Number(range[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const lo = Math.trunc(Math.min(start, end));
      const hi = Math.trunc(Math.max(start, end));
      for (let col = lo; col <= hi; col += 1) {
        cells.push([Math.trunc(row), col]);
        if (cells.length >= maxCells) return cells;
      }
    }
  }
  return cells;
}

function normalizeMatrixCells(value) {
  if (!Array.isArray(value)) return [];
  const cells = [];
  value.forEach((cell) => {
    if (!Array.isArray(cell) || cell.length < 2) return;
    const row = Number(cell[0]);
    const col = Number(cell[1]);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return;
    cells.push([row, col]);
  });
  return cells;
}

function drawDropletCells(ctx, geom, cells) {
  const inset = geom.cell >= 8 ? Math.min(1.2, geom.cell * 0.08) : 0;
  cells.forEach((cell) => {
    const rect = matrixCellRect(geom, cell[0], cell[1]);
    ctx.fillRect(
      rect.x + inset,
      rect.y + inset,
      Math.max(1, rect.w - inset * 2),
      Math.max(1, rect.h - inset * 2)
    );
  });
}

function drawDropletCellOutline(ctx, geom, cells) {
  const keys = new Set(cells.map((cell) => matrixCellKey(cell[0], cell[1])));
  ctx.beginPath();
  cells.forEach((cell) => {
    const row = cell[0];
    const col = cell[1];
    const rect = matrixCellRect(geom, row, col);
    if (!keys.has(matrixCellKey(row + 1, col))) drawCellEdge(ctx, rect, "left");
    if (!keys.has(matrixCellKey(row - 1, col))) drawCellEdge(ctx, rect, "right");
    if (!keys.has(matrixCellKey(row, col - 1))) drawCellEdge(ctx, rect, "top");
    if (!keys.has(matrixCellKey(row, col + 1))) drawCellEdge(ctx, rect, "bottom");
  });
  ctx.stroke();
}

function drawCellEdge(ctx, rect, side) {
  if (side === "left") {
    ctx.moveTo(rect.x, rect.y);
    ctx.lineTo(rect.x, rect.y + rect.h);
  } else if (side === "right") {
    ctx.moveTo(rect.x + rect.w, rect.y);
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
  } else if (side === "top") {
    ctx.moveTo(rect.x, rect.y);
    ctx.lineTo(rect.x + rect.w, rect.y);
  } else if (side === "bottom") {
    ctx.moveTo(rect.x, rect.y + rect.h);
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
  }
}

function matrixCellKey(row, col) {
  return `${Number(row)},${Number(col)}`;
}

function dropletLabelPoint(geom, cells, rect) {
  if (!cells.length) return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  const centers = cells.map((cell) => matrixCellCenter(geom, cell));
  return {
    x: centers.reduce((sum, point) => sum + point.x, 0) / centers.length,
    y: centers.reduce((sum, point) => sum + point.y, 0) / centers.length,
  };
}

function drawMatrixSelectionBox(ctx) {
  if (!state.matrixSelection.moved) return;
  const rect = matrixSelectionRect();
  if (!rect || (rect.w < 2 && rect.h < 2)) return;
  ctx.save();
  roundedRect(ctx, rect.x, rect.y, Math.max(1, rect.w), Math.max(1, rect.h), 5);
  ctx.fillStyle = "rgba(255, 214, 10, 0.15)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 214, 10, 0.92)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.restore();
}

function drawMatrixOverlay(ctx, width, height, scene, renderStats = null) {
  const status = scene.executor || {};
  const running = status.is_executing ? "running" : "idle";
  const eventType = Array.isArray(scene.plan?.current_event) ? scene.plan.current_event[1] : "";
  const frameIndex = scene.frame?.index !== null && scene.frame?.index !== undefined ? Number(scene.frame.index) : null;
  const frameLabel = Number.isFinite(frameIndex) ? frameIndex + 1 : "-";
  const frameSource = matrixFrameSource(scene);
  const mode = state.timeline.followLive ? "live" : "preview";
  const metricLine = renderStats
    ? `render ${formatMatrixRenderFps(renderStats.fps)}/s - unique ${renderStats.uniqueFps || 0}/s`
    : "";
  const deltaLine = renderStats ? matrixRenderDeltaLabel(renderStats) : "";
  const lineItems = [
    { text: `${mode} ${frameSource} ${frameLabel}/${scene.frame?.count || 0}`, color: "#f5f5f7" },
    { text: eventType ? `${running} - ${eventType}` : running, color: "#a1a1a6" },
    metricLine ? { text: metricLine, color: "#64d2ff" } : null,
    deltaLine ? { text: deltaLine, color: matrixRenderDeltaColor(renderStats) } : null,
  ].filter(Boolean);
  ctx.save();
  ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI";
  const boxWidth = Math.max(...lineItems.map((line) => ctx.measureText(line.text).width)) + 20;
  const boxHeight = 10 + lineItems.length * 15;
  const x = width - boxWidth - 10;
  const y = 10;
  roundedRect(ctx, x, y, boxWidth, boxHeight, 7);
  ctx.fillStyle = "rgba(15, 15, 18, 0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.stroke();
  lineItems.forEach((line, index) => {
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, x + 10, y + 16 + index * 15);
  });
  ctx.restore();
}

function matrixRenderDeltaLabel(stats) {
  const delta = Number(stats?.lastDelta);
  if (!Number.isFinite(delta)) return stats?.lastStatus === "switch" ? "source changed" : "";
  const prefix = delta > 0 ? "+" : "";
  if (stats.lastStatus === "regress") return `back ${delta}`;
  if (stats.lastStatus === "jump") return `jump ${prefix}${delta}`;
  if (stats.lastStatus === "repeat") return "repeat frame";
  if (stats.lastStatus === "switch") return `source changed ${prefix}${delta}`;
  return `delta ${prefix}${delta}`;
}

function matrixRenderDeltaColor(stats) {
  if (stats?.lastStatus === "regress") return "#ff453a";
  if (stats?.lastStatus === "jump") return "#ffd60a";
  if (stats?.lastStatus === "switch") return "#bf5af2";
  if (stats?.lastStatus === "repeat") return "#8e8e93";
  return "#30d158";
}

function matrixCellCenter(geom, point) {
  const row = Number(point?.[0] || 0);
  const col = Number(point?.[1] || 0);
  const display = matrixDisplayCell(geom, row, col);
  return {
    x: geom.originX + (display.col + 0.5) * geom.cell,
    y: geom.originY + (display.row + 0.5) * geom.cell,
  };
}

function matrixContinuousCellCenter(geom, row, col) {
  return {
    x: geom.originX + (geom.rows - Number(row) - 0.5) * geom.cell,
    y: geom.originY + (Number(col) + 0.5) * geom.cell,
  };
}

function matrixCellRect(geom, row, col) {
  const display = matrixDisplayCell(geom, row, col);
  return {
    x: geom.originX + display.col * geom.cell,
    y: geom.originY + display.row * geom.cell,
    w: geom.cell,
    h: geom.cell,
  };
}

function matrixDisplayCell(geom, row, col) {
  const safeRow = Math.max(0, Math.min(geom.rows - 1, Number(row) || 0));
  const safeCol = Math.max(0, Math.min(geom.cols - 1, Number(col) || 0));
  return {
    row: safeCol,
    col: geom.rows - safeRow - 1,
  };
}

function matrixBboxRect(geom, bbox) {
  const corners = [
    matrixCellRect(geom, Number(bbox.row_min), Number(bbox.col_min)),
    matrixCellRect(geom, Number(bbox.row_min), Number(bbox.col_max)),
    matrixCellRect(geom, Number(bbox.row_max), Number(bbox.col_min)),
    matrixCellRect(geom, Number(bbox.row_max), Number(bbox.col_max)),
  ];
  const left = Math.min(...corners.map((corner) => corner.x));
  const top = Math.min(...corners.map((corner) => corner.y));
  const right = Math.max(...corners.map((corner) => corner.x + corner.w));
  const bottom = Math.max(...corners.map((corner) => corner.y + corner.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function bboxFromCells(cells) {
  if (!Array.isArray(cells) || !cells.length) return null;
  const rows = cells.map((cell) => Number(cell?.[0])).filter(Number.isFinite);
  const cols = cells.map((cell) => Number(cell?.[1])).filter(Number.isFinite);
  if (!rows.length || !cols.length) return null;
  return {
    row_min: Math.min(...rows),
    row_max: Math.max(...rows),
    col_min: Math.min(...cols),
    col_max: Math.max(...cols),
  };
}

function dropletColor(id, alpha = 1) {
  const palette = [
    [100, 210, 255],
    [48, 209, 88],
    [255, 159, 10],
    [191, 90, 242],
    [255, 55, 95],
    [94, 92, 230],
    [255, 214, 10],
    [50, 215, 75],
  ];
  const numeric = Math.abs(Number(id) || 0);
  const color = palette[numeric % palette.length];
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function formatElectrodeCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function updateMatrixCursorHud(hover) {
  const hud = $("matrixCursorHud");
  if (!hud) return;
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!hover || !scene?.available) {
    hud.hidden = true;
    return;
  }
  const canvas = $("matrixScene");
  if (!canvas) {
    hud.hidden = true;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const shape = matrixShape(scene);
  const geom = matrixSceneGeometry(
    Math.max(1, Math.round(rect.width || canvas.clientWidth || 1)),
    Math.max(1, Math.round(rect.height || canvas.clientHeight || 1)),
    Math.max(1, Number(shape?.[0] || 128)),
    Math.max(1, Number(shape?.[1] || 128)),
  );
  const electrode = canvasPointToElectrode(geom, hover.x, hover.y);
  if (!electrode) {
    hud.hidden = true;
    return;
  }

  const stage = stageFromElectrode(scene, electrode.row, electrode.col);
  const title = document.createElement("strong");
  title.textContent = `Electrode ${electrode.row}, ${electrode.col}`;
  const xy = document.createElement("span");
  xy.textContent = stage
    ? `XY ${formatStageCoordinate(stage.X)}, ${formatStageCoordinate(stage.Y)}`
    : "XY unavailable";
  hud.replaceChildren(title, xy);
  hud.hidden = false;
}

function formatStageCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : "-";
}

function syncMatrixPathState(scene) {
  const revision = matrixPathRevision(scene);
  if (state.matrixPaths.revision === revision) return;
  state.matrixPaths.revision = revision;
  state.matrixPaths.hiddenActions = new Set();
  state.matrixPaths.hoveredActionId = "";
  state.matrixPaths.renderKey = "";
  state.matrixPaths.actionCache = {
    movingKey: "",
    movingActions: [],
    staticKey: "",
    staticActions: [],
  };
}

function matrixPathRevision(scene) {
  const actions = Array.isArray(scene?.plan?.actions) ? scene.plan.actions : [];
  return [
    scene?.plan?.frame_count || "",
    scene?.plan?.event_count || "",
    scene?.plan?.scene_plan_source || "",
    actions.map((action) => {
      const paths = Array.isArray(action?.paths) ? action.paths : [];
      const pathKey = paths.map((pathInfo) => matrixPathInfoSignature(pathInfo)).join(",");
      return `${action?.id}:${action?.frame_span?.join("-") || ""}:${paths.length}:${pathKey}`;
    }).join("|"),
  ].join("::");
}

function matrixPathActions(scene, options = {}) {
  const actions = scene?.plan?.actions;
  if (!Array.isArray(actions)) return [];
  const includeStatic = options.includeStatic === true;
  const revision = matrixPathRevision(scene);
  const cacheKey = `${revision}::${includeStatic ? "static" : "moving"}`;
  const cache = state.matrixPaths.actionCache || {};
  if (includeStatic && cache.staticKey === cacheKey) return cache.staticActions || [];
  if (!includeStatic && cache.movingKey === cacheKey) return cache.movingActions || [];
  const prepared = actions
    .map((action) => {
      if (!action || !Array.isArray(action.paths)) return null;
      const paths = [];
      for (const pathInfo of action.paths) {
        const path = compactDisplayPath(pathInfo?.path);
        if (includeStatic ? path.length > 0 : path.length > 1) {
          paths.push({ ...pathInfo, path });
        }
      }
      return paths.length ? { ...action, paths } : null;
    })
    .filter(Boolean);
  if (includeStatic) {
    state.matrixPaths.actionCache.staticKey = cacheKey;
    state.matrixPaths.actionCache.staticActions = prepared;
  } else {
    state.matrixPaths.actionCache.movingKey = cacheKey;
    state.matrixPaths.actionCache.movingActions = prepared;
  }
  return prepared;
}

function matrixPathInfoIsMoving(pathInfo) {
  return compactDisplayPath(pathInfo?.path).length > 1;
}

function matrixPathInfoSignature(pathInfo) {
  if (!pathInfo || typeof pathInfo !== "object") return "";
  const start = Array.isArray(pathInfo.start) ? pathInfo.start.join(",") : "";
  const end = Array.isArray(pathInfo.end) ? pathInfo.end.join(",") : "";
  const length = pathInfo.path_length ?? (Array.isArray(pathInfo.path) ? pathInfo.path.length : "");
  return `${pathInfo.key || ""}:${pathInfo.droplet_id ?? ""}:${length}:${start}:${end}`;
}

function visibleMatrixPathActions(scene) {
  return matrixPathActions(scene).filter((action) => !state.matrixPaths.hiddenActions.has(String(action.id)));
}

function renderMatrixPathPanel(scene) {
  const panel = $("matrixPathPanel");
  const toggle = $("matrixPathToggle");
  const count = $("matrixPathCount");
  const body = $("matrixPathBody");
  if (!panel || !toggle || !count || !body) return;
  const actions = matrixPathActions(scene);
  if (!scene?.available || !actions.length) {
    panel.hidden = true;
    body.textContent = "";
    count.textContent = "0";
    state.matrixPaths.renderKey = "hidden";
    return;
  }
  const renderKey = [
    matrixPathRevision(scene),
    state.matrixPaths.collapsed ? "collapsed" : "open",
    [...state.matrixPaths.hiddenActions].sort().join(","),
    state.matrixPaths.hoveredActionId || "",
  ].join("::");
  if (state.matrixPaths.renderKey === renderKey && !panel.hidden) return;
  state.matrixPaths.renderKey = renderKey;
  panel.hidden = false;
  panel.classList.toggle("collapsed", state.matrixPaths.collapsed);
  toggle.setAttribute("aria-expanded", String(!state.matrixPaths.collapsed));
  count.textContent = `${visibleMatrixPathActions(scene).length}/${actions.length}`;
  body.textContent = "";

  for (const action of actions) {
    const actionId = String(action.id);
    const row = document.createElement("label");
    row.className = "matrix-path-action";
    row.classList.toggle("hovered", state.matrixPaths.hoveredActionId === actionId);
    row.addEventListener("mouseenter", () => {
      if (state.matrixPaths.hoveredActionId === actionId) return;
      state.matrixPaths.hoveredActionId = actionId;
      scheduleMatrixSceneRender(null, { skipPathPanel: true });
    });
    row.addEventListener("mouseleave", () => {
      if (state.matrixPaths.hoveredActionId === actionId) {
        state.matrixPaths.hoveredActionId = "";
        scheduleMatrixSceneRender(null, { skipPathPanel: true });
      }
    });

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !state.matrixPaths.hiddenActions.has(actionId);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.matrixPaths.hiddenActions.delete(actionId);
      else state.matrixPaths.hiddenActions.add(actionId);
      renderMatrixPanel(state.live || {});
    });

    const title = document.createElement("span");
    title.className = "matrix-path-action-title";
    title.textContent = matrixActionLabel(action);

    const meta = document.createElement("code");
    meta.className = "matrix-path-action-meta";
    meta.textContent = matrixActionMeta(action);

    row.append(checkbox, title, meta);
    body.appendChild(row);
  }
}

function matrixActionLabel(action) {
  const label = String(action.label || action.type || "action");
  const droplets = Array.isArray(action.droplet_ids) && action.droplet_ids.length
    ? ` d${action.droplet_ids.join(",")}`
    : "";
  return `${label}${droplets}`;
}

function matrixActionMeta(action) {
  const span = Array.isArray(action.frame_span) && action.frame_span.length >= 2
    ? `${Number(action.frame_span[0]) + 1}-${Number(action.frame_span[1]) + 1}`
    : "-";
  const paths = Array.isArray(action.paths) ? action.paths.length : 0;
  return `${span} - ${paths}`;
}

function startMatrixSelectionDrag(event) {
  const canvas = $("matrixScene");
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!canvas || !scene?.available || activeMatrixPaintValue() !== null) return;
  const pointer = matrixPointerInfoFromEvent(event, { clampToGrid: true });
  if (!pointer) return;
  event.preventDefault();
  canvas.setPointerCapture?.(event.pointerId);
  state.matrixSelection.dragging = true;
  state.matrixSelection.moved = false;
  state.matrixSelection.start = pointer.electrode;
  state.matrixSelection.current = pointer.electrode;
  state.matrixSelection.startPoint = pointer.raw;
  state.matrixSelection.currentPoint = pointer.raw;
  state.matrixSelection.startDisplay = pointer.display;
  state.matrixSelection.currentDisplay = pointer.display;
  canvas.classList.add("dragging");
}

function updateMatrixSelectionDrag(pointer) {
  updateMatrixSelectionDragFromPointer(pointer);
}

function updateMatrixSelectionDragFromPointer(pointer, options = {}) {
  if (!state.matrixSelection.dragging) return;
  if (!pointer) return;
  const point = pointer.raw || pointer.hover;
  if (!point) return;
  const start = state.matrixSelection.startPoint || point;
  state.matrixSelection.current = pointer.electrode;
  state.matrixSelection.currentPoint = point;
  state.matrixSelection.currentDisplay = pointer.display;
  if (Math.hypot(point.x - start.x, point.y - start.y) >= 4) {
    state.matrixSelection.moved = true;
  }
  if (state.matrixSelection.moved && options.render !== false) scheduleMatrixSceneRender();
}

function endMatrixSelectionDrag(event) {
  if (!state.matrixSelection.dragging) return;
  updateMatrixSelectionDragFromPointer(
    matrixPointerInfoFromEvent(event, { clampToGrid: true }),
    { render: false },
  );
  const rect = matrixSelectionRect();
  const useSelectionBox = state.matrixSelection.moved && rect && (rect.w >= 3 || rect.h >= 3);
  resetMatrixSelectionDrag();
  if (useSelectionBox) {
    selectMatrixDropletFromRect(rect);
  } else {
    handleMatrixSceneClick(event);
  }
}

function cancelMatrixSelectionDrag() {
  if (!state.matrixSelection.dragging) return;
  resetMatrixSelectionDrag();
  renderMatrixPanel(state.live || {});
}

function resetMatrixSelectionDrag() {
  state.matrixSelection.dragging = false;
  state.matrixSelection.moved = false;
  state.matrixSelection.start = null;
  state.matrixSelection.current = null;
  state.matrixSelection.startPoint = null;
  state.matrixSelection.currentPoint = null;
  state.matrixSelection.startDisplay = null;
  state.matrixSelection.currentDisplay = null;
}

function matrixCanvasPointFromPointerEvent(event) {
  const canvas = $("matrixScene");
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
  };
}

function matrixSelectionRect() {
  const selection = state.matrixSelection;
  if (!selection.dragging || !selection.start || !selection.current) return null;
  if (selection.startDisplay && selection.currentDisplay) {
    return matrixCanvasRectFromDisplayDrag(selection.startDisplay, selection.currentDisplay);
  }
  const x0 = Number(selection.start.x);
  const y0 = Number(selection.start.y);
  const x1 = Number(selection.current.x);
  const y1 = Number(selection.current.y);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return {
    x,
    y,
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

function selectMatrixDropletFromRect(rect) {
  const hits = matrixSelectionHits(rect);
  const ids = hits
    .map((hit) => Number(hit?.droplet?.id))
    .filter(Number.isFinite);
  setMatrixSelectedDropletIds(ids);
  if (ids.length) setBottomTab("timeline");
  renderMatrixPanel(state.live || {});
  schedulePlanTimelineRender();
}

function bestMatrixSelectionHit(rect) {
  return matrixSelectionHits(rect)[0] || null;
}

function matrixSelectionHits(rect) {
  return (state.matrixSceneHitboxes || [])
    .map((box) => ({ box, score: matrixHitboxSelectionScore(box, rect) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.box);
}

function matrixHitboxSelectionScore(box, rect) {
  const cells = Array.isArray(box?.cells) && box.cells.length
    ? box.cells
    : [{ x: box?.x, y: box?.y, w: box?.w, h: box?.h }];
  return cells.reduce((sum, cell) => sum + rectIntersectionArea(rect, cell), 0);
}

function rectIntersectionArea(a, b) {
  const ax = Number(a?.x);
  const ay = Number(a?.y);
  const aw = Number(a?.w);
  const ah = Number(a?.h);
  const bx = Number(b?.x);
  const by = Number(b?.y);
  const bw = Number(b?.w);
  const bh = Number(b?.h);
  if (![ax, ay, aw, ah, bx, by, bw, bh].every(Number.isFinite)) return 0;
  const left = Math.max(ax, bx);
  const right = Math.min(ax + aw, bx + bw);
  const top = Math.max(ay, by);
  const bottom = Math.min(ay + ah, by + bh);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function setMatrixSelectedDropletIds(ids) {
  const unique = [];
  const seen = new Set();
  for (const raw of ids || []) {
    const id = Number(raw);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  state.matrixSelection.ids = new Set(unique);
  state.timeline.selectedDropletId = unique.length ? unique[0] : null;
  state.matrixPaths.hoveredActionId = "";
  state.matrixMovePreview.rotation = 0;
  state.matrixMovePreview.hover = null;
  if (!unique.length) state.matrixCommands.queues.clear();
}

function selectedMatrixDropletIds() {
  const ids = new Set(state.matrixSelection.ids || []);
  const focused = selectedTimelineDropletId();
  if (focused !== null) ids.add(focused);
  return [...ids].filter(Number.isFinite);
}

function updateMatrixMovePreviewFromPointer(event) {
  const selectedIds = selectedMatrixDropletIds();
  if (
    !selectedIds.length
    || activeMatrixPaintValue() !== null
    || state.matrixCommands.planning
    || state.matrixSelection.dragging
    || !state.timeline.followLive
  ) {
    if (state.matrixMovePreview.hover) {
      state.matrixMovePreview.hover = null;
      scheduleMatrixSceneRender();
    }
    return;
  }
  const electrode = matrixElectrodeFromPointerEvent(event);
  const next = electrode ? { row: electrode.row, col: electrode.col } : null;
  const previous = state.matrixMovePreview.hover;
  const changed = (!previous && next)
    || (previous && !next)
    || (previous && next && (previous.row !== next.row || previous.col !== next.col));
  if (!changed) return;
  state.matrixMovePreview.hover = next;
  scheduleMatrixSceneRender();
}

function matrixMovePreviewState(scene, droplets) {
  const hover = state.matrixMovePreview.hover;
  if (!hover || state.matrixCommands.planning) return null;
  const selectedIds = new Set(selectedMatrixDropletIds());
  if (!selectedIds.size) return null;
  const selected = (droplets || [])
    .filter((droplet) => selectedIds.has(Number(droplet?.id)) && droplet?.active !== false)
    .map((droplet) => {
      const current = normalizeMatrixPoint(droplet.position)
        || normalizeMatrixPoint(droplet.origin)
        || normalizeMatrixPoint(droplet.current_position);
      const cells = uniqueMatrixCells(dropletDisplayCells(droplet));
      const bbox = bboxFromCells(cells);
      return current && bbox ? { droplet, current, cells, bbox } : null;
    })
    .filter(Boolean);
  if (!selected.length) return null;

  const groupBbox = {
    row_min: Math.min(...selected.map((item) => item.bbox.row_min)),
    row_max: Math.max(...selected.map((item) => item.bbox.row_max)),
    col_min: Math.min(...selected.map((item) => item.bbox.col_min)),
    col_max: Math.max(...selected.map((item) => item.bbox.col_max)),
  };
  const groupRows = Math.max(1, groupBbox.row_max - groupBbox.row_min + 1);
  const groupCols = Math.max(1, groupBbox.col_max - groupBbox.col_min + 1);
  const rotation = ((Number(state.matrixMovePreview.rotation) || 0) % 4 + 4) % 4;
  const shape = matrixShape(scene);
  const rows = Math.max(1, Number(shape?.[0] || 128));
  const cols = Math.max(1, Number(shape?.[1] || 128));
  const occupied = new Map();
  for (const droplet of droplets || []) {
    const id = Number(droplet?.id);
    if (!Number.isFinite(id) || selectedIds.has(id) || droplet?.active === false) continue;
    for (const cell of uniqueMatrixCells(dropletDisplayCells(droplet))) {
      occupied.set(`${cell[0]},${cell[1]}`, id);
    }
  }

  const previewCells = new Set();
  const targets = [];
  let valid = true;
  let changed = rotation !== 0;
  let reason = "";
  for (const item of selected) {
    const relative = [
      item.current[0] - groupBbox.row_min,
      item.current[1] - groupBbox.col_min,
    ];
    const rotated = rotateMatrixGroupOffset(relative, groupRows, groupCols, rotation);
    const target = [Math.trunc(hover.row + rotated[0]), Math.trunc(hover.col + rotated[1])];
    if (target[0] !== item.current[0] || target[1] !== item.current[1]) changed = true;
    const deltaRow = target[0] - item.current[0];
    const deltaCol = target[1] - item.current[1];
    const shiftedCells = item.cells.map((cell) => [cell[0] + deltaRow, cell[1] + deltaCol]);
    for (const cell of shiftedCells) {
      const key = `${cell[0]},${cell[1]}`;
      if (cell[0] < 0 || cell[0] >= rows || cell[1] < 0 || cell[1] >= cols) {
        valid = false;
        reason = "Preview is outside the cartridge";
      }
      if (occupied.has(key)) {
        valid = false;
        reason = `Preview overlaps droplet ${occupied.get(key)}`;
      }
      if (previewCells.has(key)) {
        valid = false;
        reason = "Selected droplets overlap after rotation";
      }
      previewCells.add(key);
    }
    targets.push({
      droplet: item.droplet,
      droplet_id: Number(item.droplet.id),
      current: item.current,
      target,
      cells: shiftedCells,
    });
  }
  return { targets, valid, changed, reason, rotation };
}

function rotateMatrixGroupOffset(offset, groupRows, groupCols, rotation) {
  const row = Number(offset?.[0]) || 0;
  const col = Number(offset?.[1]) || 0;
  if (rotation === 1) return [col, groupRows - 1 - row];
  if (rotation === 2) return [groupRows - 1 - row, groupCols - 1 - col];
  if (rotation === 3) return [groupCols - 1 - col, row];
  return [row, col];
}

function drawMatrixMovePreview(ctx, geom, scene, droplets) {
  const preview = matrixMovePreviewState(scene, droplets);
  if (!preview) return;
  ctx.save();
  ctx.globalAlpha = preview.valid ? 0.62 : 0.48;
  for (const item of preview.targets) {
    ctx.fillStyle = preview.valid ? dropletColor(item.droplet_id, 0.28) : "rgba(255, 55, 95, 0.28)";
    ctx.strokeStyle = preview.valid ? "rgba(255, 214, 10, 0.92)" : "rgba(255, 55, 95, 0.9)";
    ctx.shadowColor = preview.valid ? "rgba(255, 214, 10, 0.34)" : "rgba(255, 55, 95, 0.32)";
    ctx.shadowBlur = Math.max(2, geom.cell * 1.3);
    drawDropletCells(ctx, geom, item.cells);
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.2, Math.min(3, geom.cell * 0.24));
    ctx.setLineDash([Math.max(3, geom.cell * 0.55), Math.max(2, geom.cell * 0.42)]);
    drawDropletCellOutline(ctx, geom, item.cells);
    ctx.setLineDash([]);
    const rect = bboxFromCells(item.cells);
    const labelPoint = dropletLabelPoint(geom, item.cells, rect ? matrixBboxRect(geom, rect) : { x: 0, y: 0, w: 0, h: 0 });
    ctx.fillStyle = preview.valid ? "#ffd60a" : "#ff375f";
    ctx.font = `${Math.max(9, Math.min(14, geom.cell * 1.7))}px -apple-system, BlinkMacSystemFont, Segoe UI`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(item.droplet_id), labelPoint.x, labelPoint.y);
  }
  if (!preview.valid && preview.reason) {
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI";
    const text = preview.reason;
    const w = ctx.measureText(text).width + 18;
    const x = Math.max(10, Math.min(geom.width - w - 10, geom.originX + 10));
    const y = Math.max(10, geom.originY + 10);
    roundedRect(ctx, x, y, w, 28, 7);
    ctx.fillStyle = "rgba(35, 8, 16, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 55, 95, 0.55)";
    ctx.stroke();
    ctx.fillStyle = "#ffd3dc";
    ctx.fillText(text, x + 9, y + 18);
  }
  ctx.restore();
}

function commitMatrixMovePreview() {
  if (state.matrixCommands.planning) return false;
  if (!state.timeline.followLive) {
    state.matrixCommands.lastError = "Go Live before adding planned frames";
    renderMatrixCommandPanel();
    schedulePlanTimelineRender();
    return true;
  }
  const scene = state.live?.scene?.result || state.live?.scene;
  const droplets = matrixDropletsWithOverrides(matrixSceneForTimeline(scene)?.droplets || scene?.droplets || []);
  const preview = matrixMovePreviewState(scene, droplets);
  if (!preview || !preview.changed) return false;
  if (!preview.valid) {
    state.matrixCommands.lastError = preview.reason || "Invalid droplet preview";
    renderMatrixCommandPanel();
    schedulePlanTimelineRender();
    return true;
  }
  const targets = preview.targets.map((item) => ({
    droplet_id: Number(item.droplet_id),
    target: [Number(item.target[0]), Number(item.target[1])],
  }));
  state.matrixCommands.planning = true;
  state.matrixCommands.lastError = "";
  state.matrixMovePreview.hover = null;
  renderMatrixPanel(state.live || {});
  renderMatrixCommandPanel();
  schedulePlanTimelineRender();
  send({
    type: "matrix_plan_selection_move",
    mode: "sipp",
    targets,
  });
  return true;
}

function handleMatrixSceneClick(event) {
  const canvas = $("matrixScene");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const point = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  if (event.shiftKey) {
    moveStageToMatrixPoint(point);
    return;
  }
  const hit = topMatrixHitboxAt(point);
  const dropletId = Number(hit?.droplet?.id);
  const selectedIds = selectedMatrixDropletIds();
  const hitIsSelected = Number.isFinite(dropletId) && selectedIds.includes(dropletId);
  if (!Number.isFinite(dropletId) && selectedIds.length && commitMatrixMovePreview()) {
    return;
  }
  if (Number.isFinite(dropletId) && !hitIsSelected) {
    setMatrixSelectedDropletIds([dropletId]);
  } else if (Number.isFinite(dropletId)) {
    setMatrixSelectedDropletIds(selectedIds.length ? selectedIds : [dropletId]);
  } else {
    setMatrixSelectedDropletIds([]);
  }
  if (Number.isFinite(dropletId)) setBottomTab("timeline");
  renderMatrixPanel(state.live || {});
  schedulePlanTimelineRender();
}

function moveStageToMatrixPoint(point) {
  const target = matrixTargetForPoint(point);
  if (!target) return;
  moveStageToTarget(target);
}

function matrixTargetForPoint(point) {
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!scene?.available) return null;
  const canvas = $("matrixScene");
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const shape = matrixShape(scene);
  const geom = matrixSceneGeometry(
    Math.max(1, Math.round(rect.width || canvas.clientWidth || 1)),
    Math.max(1, Math.round(rect.height || canvas.clientHeight || 1)),
    Math.max(1, Number(shape?.[0] || 128)),
    Math.max(1, Number(shape?.[1] || 128)),
  );
  const electrode = canvasPointToElectrode(geom, point.x, point.y);
  if (!electrode) return null;
  const stage = stageFromElectrode(scene, electrode.row, electrode.col);
  const hit = topMatrixHitboxAt(point);
  return { point, electrode, stage, droplet: hit?.droplet || null };
}

function moveStageToTarget(target) {
  const electrode = target?.electrode;
  const stage = target?.stage;
  if (!electrode || !stage) {
    appendEvent({
      ts: new Date().toISOString(),
      type: "ui_error",
      level: "warning",
      message: electrode
        ? `No XY stage mapping for electrode ${electrode.row}, ${electrode.col}`
        : "No electrode under cursor",
    });
    return;
  }
  const current = currentStagePosition();
  const position = {
    X: Math.trunc(Number(stage.X)),
    Y: Math.trunc(Number(stage.Y)),
  };
  const targetZ = Number(stage.Z);
  if (Number.isFinite(targetZ)) {
    position.Z = Math.trunc(targetZ);
  } else if (Number.isFinite(Number(current?.Z))) {
    position.Z = Math.trunc(Number(current.Z));
  }
  beginStageMotionFromCommand({
    position,
    source: "matrix",
    wait_timeout_seconds: 20,
  });
  send({
    type: "mcp_tool",
    tool: "move_stage",
    arguments: {
      position,
      wait_timeout_seconds: 20,
      poll_interval: 0.1,
      wait_for_queue: false,
      wait_for_completion: false,
    },
  });
}

function openMatrixContextMenu(event) {
  const menu = $("matrixContextMenu");
  const canvas = $("matrixScene");
  if (!menu || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const point = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  const target = matrixTargetForPoint(point);
  if (!target) {
    hideMatrixContextMenu();
    return;
  }

  menu.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = target.droplet ? `Droplet ${target.droplet.id}` : "Matrix";
  const electrode = document.createElement("span");
  electrode.textContent = `Electrode ${target.electrode.row}, ${target.electrode.col}`;
  const stage = document.createElement("code");
  stage.textContent = target.stage
    ? `XY ${formatStageCoordinate(target.stage.X)}, ${formatStageCoordinate(target.stage.Y)}`
    : "XY unavailable";
  menu.append(title, electrode, stage);

  const move = document.createElement("button");
  move.type = "button";
  move.textContent = "Move stage here";
  move.disabled = !target.stage;
  move.addEventListener("click", () => {
    hideMatrixContextMenu();
    moveStageToTarget(target);
  });
  menu.appendChild(move);

  if (target.droplet) {
    const select = document.createElement("button");
    select.type = "button";
    select.textContent = "Select droplet";
    select.addEventListener("click", () => {
      hideMatrixContextMenu();
      setMatrixSelectedDropletIds([Number(target.droplet.id)]);
      setBottomTab("timeline");
      renderMatrixPanel(state.live || {});
      schedulePlanTimelineRender();
    });
    menu.appendChild(select);
  }

  menu.hidden = false;
  const viewer = canvas.closest(".viewer");
  const left = Math.min(
    Math.max(8, point.x + 10),
    Math.max(8, (viewer?.clientWidth || rect.width) - menu.offsetWidth - 8),
  );
  const top = Math.min(
    Math.max(8, point.y + 10),
    Math.max(8, (viewer?.clientHeight || rect.height) - menu.offsetHeight - 8),
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function hideMatrixContextMenu() {
  const menu = $("matrixContextMenu");
  if (!menu) return;
  menu.hidden = true;
  menu.replaceChildren();
}

function updateMatrixHover(hover) {
  const tooltip = $("matrixHover");
  if (!tooltip) return;
  if (!hover) {
    tooltip.hidden = true;
    return;
  }
  const hit = topMatrixHitboxAt(hover);
  if (!hit) {
    tooltip.hidden = true;
    return;
  }
  const droplet = hit.droplet;
  tooltip.hidden = false;
  tooltip.innerHTML = [
    `<strong>Droplet ${escapeHtml(String(droplet.id))}</strong>`,
    `<span>pos ${formatPoint(droplet.position)} - target ${formatPoint(droplet.target)}</span>`,
    `<span>${droplet.shape_size || 0} electrodes - path ${droplet.path_length || 0}</span>`,
  ].join("");
  const viewer = $("matrixScene")?.closest(".viewer");
  const maxX = Math.max(8, (viewer?.clientWidth || 240) - tooltip.offsetWidth - 8);
  const maxY = Math.max(8, (viewer?.clientHeight || 240) - tooltip.offsetHeight - 8);
  tooltip.style.left = `${Math.min(maxX, Math.max(8, hover.x + 12))}px`;
  tooltip.style.top = `${Math.min(maxY, Math.max(8, hover.y + 12))}px`;
}

function topMatrixHitboxAt(point) {
  const hitboxes = state.matrixSceneHitboxes || [];
  for (let index = hitboxes.length - 1; index >= 0; index -= 1) {
    const box = hitboxes[index];
    if (matrixHitboxContains(box, point)) return box;
  }
  return null;
}

function matrixHitboxContains(box, point) {
  if (!box || !point) return false;
  if (
    Number.isFinite(Number(box.x))
    && Number.isFinite(Number(box.y))
    && Number.isFinite(Number(box.w))
    && Number.isFinite(Number(box.h))
    && (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h)
  ) {
    return false;
  }
  const cellHit = Array.isArray(box.cells) && box.cells.some((cell) => (
    point.x >= cell.x && point.x <= cell.x + cell.w && point.y >= cell.y && point.y <= cell.y + cell.h
  ));
  if (cellHit) return true;
  if (Array.isArray(box.cells) && box.cells.length) return false;
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}

function formatPoint(point) {
  return Array.isArray(point) && point.length >= 2 ? `[${point[0]}, ${point[1]}]` : "-";
}

function downloadVisualizerFrame(visualizer) {
  const button = visualizer === "streamer" ? $("downloadStreamer") : $("downloadMatrix");
  const frameSource = visualizer === "streamer" ? "camera_raw" : "snapshot";
  if (button) button.classList.add("busy");
  send({
    type: "download_visualizer_frame",
    visualizer,
    frame_source: frameSource,
  });
}

function handleVisualizerDownload(data) {
  const visualizer = data.visualizer || "visualizer";
  const button = visualizer === "streamer" ? $("downloadStreamer") : $("downloadMatrix");
  if (button) button.classList.remove("busy");
  const frame = data.frame?.result || data.frame;
  if (!frame?.base64) {
    appendEvent({
      ts: new Date().toISOString(),
      type: "ui_error",
      level: "warning",
      message: `No ${visualizer} frame available to download`,
    });
    return;
  }
  const mime = frame.mime_type || "image/png";
  const extension = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
  const source = frame.frame_source || data.frame_source || "frame";
  const link = document.createElement("a");
  link.href = `data:${mime};base64,${frame.base64}`;
  link.download = `${visualizer}_${source}_${timestampForFilename()}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function applyTemperatureHistory(history) {
  const runId = state.status?.run_id || state.selectedRunId || "";
  const localHistory = readLocalTemperatureHistory(runId);
  const samples = compactTemperatureHistorySamplesForStorage([
    ...(Array.isArray(history?.samples) ? history.samples : []),
    ...(Array.isArray(localHistory?.samples) ? localHistory.samples : []),
    ...temperatureStorageSamplesFromEvents(state.events || []),
  ]);
  const measured = [];
  const targets = [];
  let lastTarget = null;
  for (const sample of samples) {
    const seconds = Number(sample?.t);
    if (!Number.isFinite(seconds)) continue;
    const timeMs = seconds * 1000;
    const measuredValue = firstFiniteNumber(
      sample?.measured_c,
      sample?.temperature_c,
      sample?.current_c,
      sample?.current,
    );
    if (isValidMeasuredTemperature(measuredValue)) {
      measured.push({
        t: timeMs,
        value: measuredValue,
        source: sample?.source || "history",
      });
    }
    const targetValue = firstFiniteNumber(
      sample?.target_c,
      sample?.tarjet_c,
      sample?.target_temperature,
      sample?.tarjet_temperature,
    );
    if (isValidTemperatureTarget(targetValue) && (lastTarget === null || Math.abs(targetValue - lastTarget) > 0.02)) {
      targets.push({
        t: timeMs,
        value: targetValue,
        source: sample?.source || "history",
      });
      lastTarget = targetValue;
    }
  }
  state.temperatureSamples = dedupeTemperatureHistorySamples(measured);
  state.temperatureTargetSamples = dedupeTemperatureHistorySamples(targets);
  state.temperatureRevision += 1;
  state.temperatureHistoryMeta = history
    ? {
        path: history.path || "temperature_history.json",
        sampleCount: Number(history.sample_count || samples.length) || samples.length,
        storedSampleCount: Number(history.stored_sample_count || samples.length) || samples.length,
        downsampled: Boolean(history.downsampled),
        compactedAt: history.compacted_at || null,
      }
    : null;
  persistTemperatureHistoryLocal();
}

function dedupeTemperatureHistorySamples(samples) {
  const result = [];
  let lastKey = "";
  for (const sample of (samples || []).sort((a, b) => Number(a.t) - Number(b.t))) {
    const time = Number(sample?.t);
    const value = Number(sample?.value);
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    const key = `${Math.round(time)}:${value.toFixed(4)}`;
    if (key === lastKey) continue;
    lastKey = key;
    result.push({ ...sample, t: time, value });
  }
  return result;
}

function temperatureStorageSamplesFromEvents(events) {
  const samples = [];
  for (const event of events || []) {
    const eventTime = eventTimeSeconds(event);
    if (Number.isFinite(eventTime)) {
      const measured = measuredTemperatureFromEvent(event);
      const target = targetTemperatureFromEvent(event);
      if (isValidMeasuredTemperature(measured) || isValidTemperatureTarget(target)) {
        const sample = {
          t: eventTime,
          source: event.tool || event.type || "event",
        };
        if (event.ts) sample.ts = event.ts;
        if (isValidMeasuredTemperature(measured)) sample.measured_c = measured;
        if (isValidTemperatureTarget(target)) sample.target_c = target;
        samples.push(sample);
      }
    }
    for (const sample of timelineTemperatureSamplesFromEvent(event)) {
      if (!Number.isFinite(Number(sample.time)) || !isValidMeasuredTemperature(sample.value)) continue;
      samples.push({
        t: Number(sample.time),
        measured_c: Number(sample.value),
        source: "event_samples",
      });
    }
    for (const marker of timelineRoutineTargetMarkersFromEvent(event, null)) {
      if (!Number.isFinite(Number(marker.time)) || !isValidTemperatureTarget(marker.value)) continue;
      samples.push({
        t: Number(marker.time),
        target_c: Number(marker.value),
        source: marker.source || "temperature_routine",
      });
    }
    samples.push(...plannedTemperatureRoutineStorageSamples(event));
  }
  return compactTemperatureHistorySamplesForStorage(samples);
}

function plannedTemperatureRoutineStorageSamples(event) {
  if (event?.type !== "mcp_tool_call" || event?.tool !== "start_temperature_routine") return [];
  const eventTime = eventTimeSeconds(event);
  const steps = getPath(event, "arguments.steps");
  if (!Number.isFinite(eventTime) || !Array.isArray(steps)) return [];
  let cursor = eventTime;
  const samples = [];
  steps.forEach((step, index) => {
    if (!step || typeof step !== "object") return;
    const target = firstFiniteNumber(
      step.target_c,
      step.target_temperature,
      step.target,
      step.tarjet_c,
      step.tarjet_temperature,
      step.tarjet,
    );
    if (isValidTemperatureTarget(target)) {
      samples.push({
        t: cursor,
        target_c: target,
        source: "routine_plan",
        step_index: index,
      });
    }
    const hold = firstFiniteNumber(step.hold_seconds, step.duration_seconds, step.seconds);
    if (Number.isFinite(hold) && hold > 0) cursor += hold;
  });
  return samples;
}

function ingestTemperatureHistoryEvent(event) {
  const sample = normalizeTemperatureHistoryStorageSample(event);
  if (!sample) return;
  appendTemperatureStorageSampleToState(sample);
  scheduleTemperatureHistoryPersist();
}

function appendTemperatureStorageSampleToState(sample) {
  const seconds = Number(sample?.t);
  if (!Number.isFinite(seconds)) return;
  const measured = firstFiniteNumber(sample?.measured_c, sample?.temperature_c, sample?.current_c, sample?.current);
  const target = firstFiniteNumber(sample?.target_c, sample?.tarjet_c, sample?.target_temperature, sample?.tarjet_temperature);
  const timeMs = seconds * 1000;
  if (isValidMeasuredTemperature(measured)) {
    state.temperatureSamples = dedupeTemperatureHistorySamples([
      ...(state.temperatureSamples || []),
      { t: timeMs, value: measured, source: sample.source || "event" },
    ]);
    state.temperatureRevision += 1;
  }
  if (isValidTemperatureTarget(target)) {
    const lastTarget = state.temperatureTargetSamples[state.temperatureTargetSamples.length - 1];
    if (!lastTarget || Math.abs(Number(lastTarget.value) - target) > 0.02) {
      state.temperatureTargetSamples = dedupeTemperatureHistorySamples([
        ...(state.temperatureTargetSamples || []),
        { t: timeMs, value: target, source: sample.source || "event" },
      ]);
      state.temperatureRevision += 1;
    }
  }
}

function scheduleTemperatureHistoryPersist() {
  if (state.temperaturePersistTimer !== null) return;
  state.temperaturePersistTimer = window.setTimeout(() => {
    state.temperaturePersistTimer = null;
    persistTemperatureHistoryLocal();
  }, TEMPERATURE_HISTORY_PERSIST_MS);
}

function persistTemperatureHistoryLocal() {
  const runId = state.status?.run_id || state.selectedRunId || "";
  if (!runId) return;
  const samples = compactTemperatureHistorySamplesForStorage(temperatureHistorySamplesForStorage());
  const limited = simplifyTemperatureHistoryStorageSamples(samples, 12000);
  const payload = {
    schema_version: 1,
    run_id: runId,
    updated_at: new Date().toISOString(),
    samples: limited,
  };
  try {
    window.localStorage?.setItem(temperatureHistoryStorageKey(runId), JSON.stringify(payload));
  } catch {
    try {
      payload.samples = simplifyTemperatureHistoryStorageSamples(limited, 4000);
      window.localStorage?.setItem(temperatureHistoryStorageKey(runId), JSON.stringify(payload));
    } catch {
      // Local cache is only a reload aid; the run JSON is the durable source.
    }
  }
}

function readLocalTemperatureHistory(runId) {
  if (!runId) return null;
  try {
    const raw = window.localStorage?.getItem(temperatureHistoryStorageKey(runId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function temperatureHistoryStorageKey(runId) {
  return `${TEMPERATURE_HISTORY_STORAGE_PREFIX}${runId}`;
}

function temperatureHistorySamplesForStorage() {
  const samples = [];
  for (const sample of state.temperatureSamples || []) {
    const t = Number(sample?.t);
    const value = Number(sample?.value);
    if (!Number.isFinite(t) || !isValidMeasuredTemperature(value)) continue;
    samples.push({
      t: t / 1000,
      measured_c: value,
      source: sample.source || "state",
    });
  }
  for (const sample of state.temperatureTargetSamples || []) {
    const t = Number(sample?.t);
    const value = Number(sample?.value);
    if (!Number.isFinite(t) || !isValidTemperatureTarget(value)) continue;
    samples.push({
      t: t / 1000,
      target_c: value,
      source: sample.source || "state",
    });
  }
  return samples;
}

function normalizeTemperatureHistoryStorageSample(sample) {
  if (!sample || typeof sample !== "object") return null;
  const seconds = firstFiniteNumber(sample.t, sample.time, sample.timestamp);
  if (!Number.isFinite(seconds)) return null;
  const measured = firstFiniteNumber(sample.measured_c, sample.temperature_c, sample.current_c, sample.current);
  const target = firstFiniteNumber(sample.target_c, sample.tarjet_c, sample.target_temperature, sample.tarjet_temperature);
  if (!isValidMeasuredTemperature(measured) && !isValidTemperatureTarget(target)) return null;
  const normalized = {
    t: Number(seconds),
    source: String(sample.source || "").slice(0, 64) || "event",
  };
  if (sample.ts) normalized.ts = String(sample.ts);
  if (isValidMeasuredTemperature(measured)) normalized.measured_c = Number(measured);
  if (isValidTemperatureTarget(target)) normalized.target_c = Number(target);
  return normalized;
}

function compactTemperatureHistorySamplesForStorage(samples) {
  const normalized = (samples || [])
    .map(normalizeTemperatureHistoryStorageSample)
    .filter(Boolean)
    .sort((a, b) => Number(a.t) - Number(b.t));
  const compacted = [];
  let lastKey = "";
  for (const sample of normalized) {
    const measured = Number(sample.measured_c);
    const target = Number(sample.target_c);
    const key = [
      Math.round(Number(sample.t) * 1000),
      Number.isFinite(measured) ? measured.toFixed(4) : "",
      Number.isFinite(target) ? target.toFixed(4) : "",
    ].join(":");
    if (key === lastKey) continue;
    lastKey = key;
    compacted.push(sample);
  }
  return compacted;
}

function simplifyTemperatureHistoryStorageSamples(samples, maxSamples) {
  const compacted = compactTemperatureHistorySamplesForStorage(samples);
  const limit = Math.max(20, Number(maxSamples) || 12000);
  if (compacted.length <= limit) return compacted;
  const keepRecent = Math.min(1500, Math.max(100, Math.floor(limit / 5)));
  const recent = compacted.slice(-keepRecent);
  const older = compacted.slice(0, -keepRecent);
  const targetChanges = [];
  let lastTarget = null;
  for (const sample of older) {
    const target = Number(sample.target_c);
    if (!isValidTemperatureTarget(target)) continue;
    if (lastTarget === null || Math.abs(target - lastTarget) > 0.02) {
      targetChanges.push(sample);
      lastTarget = target;
    }
  }
  const remaining = Math.max(20, limit - recent.length - targetChanges.length);
  const measured = simplifyTimelineTemperatureSamplesForRender(
    older
      .filter((sample) => isValidMeasuredTemperature(sample.measured_c))
      .map((sample) => ({ ...sample, time: Number(sample.t), value: Number(sample.measured_c) })),
    { trackWidth: Math.max(20, remaining / 2.5) },
  ).map((sample) => ({
    t: Number(sample.time),
    measured_c: Number(sample.value),
    source: sample.source || "state",
  }));
  return compactTemperatureHistorySamplesForStorage([...targetChanges, ...measured, ...recent]).slice(-limit);
}

function updateTemperatureHistory(live) {
  const value = live?.state?.value || live?.state?.result?.value || live?.state;
  const rawTemp = extractTemperature(value);
  const temp = isValidMeasuredTemperature(rawTemp) ? rawTemp : null;
  const target = extractTemperatureTarget(value);
  const label = $("temperatureValue");
  if (label) label.textContent = Number.isFinite(temp) ? `${temp.toFixed(1)} C` : "-";
  const targetLabel = $("temperatureTarget");
  if (targetLabel && !targetLabel.closest(".temperature-readout")?.classList.contains("editing")) {
    targetLabel.textContent = isValidTemperatureTarget(target) ? `target ${target.toFixed(1)} C` : "target -";
  }
  const now = Date.now();
  let changed = false;
  if (isValidTemperatureTarget(target)) {
    const lastTarget = state.temperatureTargetSamples[state.temperatureTargetSamples.length - 1];
    if (!lastTarget || Math.abs(Number(lastTarget.value) - target) > 0.02) {
      state.temperatureTargetSamples.push({ t: now, value: target, source: "state" });
      changed = true;
    }
  }
  if (!Number.isFinite(temp)) {
    if (changed) scheduleTemperatureHistoryPersist();
    return;
  }

  const last = state.temperatureSamples[state.temperatureSamples.length - 1];
  if (!last || now - last.t > 900 || Math.abs(last.value - temp) > 0.02) {
    state.temperatureSamples.push({ t: now, value: temp });
    changed = true;
  }
  if (changed) scheduleTemperatureHistoryPersist();
}

function extractTemperatureTarget(root) {
  const candidates = [
    getPath(root, "temperature.target"),
    getPath(root, "temperature.tarjet"),
    getPath(root, "temperature.target_c"),
    getPath(root, "temperature.tarjet_c"),
    getPath(root, "temperature.target_temperature"),
    getPath(root, "temperature.tarjet_temperature"),
    getPath(root, "temperature.setpoint"),
    getPath(root, "temperature.setpoint_c"),
  ];
  const temperature = getPath(root, "temperature");
  if (temperature && typeof temperature === "object") {
    for (const [key, value] of Object.entries(temperature)) {
      if (/target|setpoint/i.test(key) && typeof value === "number") candidates.push(value);
    }
  }
  return candidates.find((value) => isValidTemperatureTarget(value));
}

function compactStatePanel() {
  const panel = document.querySelector(".state-panel");
  const grid = $("stateGrid");
  if (!panel || !grid) return;
  panel.classList.remove("state-tight", "state-ultra-tight");
  if (grid.scrollHeight > grid.clientHeight) panel.classList.add("state-tight");
  if (grid.scrollHeight > grid.clientHeight) panel.classList.add("state-ultra-tight");
}

function isTemperatureChartVisible() {
  return state.bottomTab === "state" && !state.layout.collapsed.bottom;
}

function renderTemperatureChart() {
  const canvas = $("temperatureChart");
  if (!canvas) return;
  if (!isTemperatureChartVisible()) return;
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#151519";
  ctx.fillRect(0, 0, width, height);

  const samples = (state.temperatureSamples || []).slice(-180);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (samples.length < 2) {
    ctx.fillStyle = "#a1a1a6";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI";
    ctx.fillText("waiting for temperature samples", 14, height / 2 + 4);
    return;
  }

  const values = samples.map((sample) => sample.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (Math.abs(max - min) < 0.5) {
    min -= 0.25;
    max += 0.25;
  }
  const firstT = samples[0].t;
  const lastT = samples[samples.length - 1].t;
  const span = Math.max(1, lastT - firstT);

  ctx.strokeStyle = "#64d2ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const points = [];
  samples.forEach((sample, index) => {
    const x = ((sample.t - firstT) / span) * (width - 20) + 10;
    const y = height - 10 - ((sample.value - min) / (max - min)) * (height - 20);
    points.push({ x, y, sample });
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  if (state.temperatureHover) {
    const hoverX = state.temperatureHover.x;
    const nearest = points.reduce((best, point) => {
      if (!best) return point;
      return Math.abs(point.x - hoverX) < Math.abs(best.x - hoverX) ? point : best;
    }, null);
    if (nearest) {
      const label = `${nearest.sample.value.toFixed(2)} C`;
      const time = new Date(nearest.sample.t).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      ctx.strokeStyle = "rgba(100, 210, 255, 0.42)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(nearest.x, 8);
      ctx.lineTo(nearest.x, height - 8);
      ctx.stroke();

      ctx.fillStyle = "#64d2ff";
      ctx.beginPath();
      ctx.arc(nearest.x, nearest.y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI";
      const textWidth = Math.max(ctx.measureText(label).width, ctx.measureText(time).width) + 18;
      const boxX = Math.min(width - textWidth - 8, Math.max(8, nearest.x + 10));
      const boxY = Math.max(8, nearest.y - 42);
      ctx.fillStyle = "rgba(28, 28, 32, 0.94)";
      ctx.strokeStyle = "rgba(100, 210, 255, 0.45)";
      roundedRect(ctx, boxX, boxY, textWidth, 36, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f5f5f7";
      ctx.fillText(label, boxX + 9, boxY + 15);
      ctx.fillStyle = "#a1a1a6";
      ctx.fillText(time, boxX + 9, boxY + 29);
    }
  }

  ctx.fillStyle = "#a1a1a6";
  ctx.font = "11px -apple-system, BlinkMacSystemFont, Segoe UI";
  ctx.fillText(`${max.toFixed(1)} C`, 10, 15);
  ctx.fillText(`${min.toFixed(1)} C`, 10, height - 8);
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

function extractTemperature(root) {
  const candidates = [
    getPath(root, "temperature.current"),
    getPath(root, "temperature.current_c"),
    getPath(root, "temperature.value"),
    getPath(root, "temperature.temperature"),
    getPath(root, "temperature.current_temperature"),
  ];
  const temperature = getPath(root, "temperature");
  if (temperature && typeof temperature === "object") {
    for (const value of Object.values(temperature)) {
      if (typeof value === "number") candidates.push(value);
      if (value && typeof value === "object") {
        for (const nested of Object.values(value)) {
          if (typeof nested === "number") candidates.push(nested);
        }
      }
    }
  }
  return candidates.find((value) => isValidMeasuredTemperature(value));
}

function formatTemperatureSummary(root, options = {}) {
  const temp = extractTemperature(root);
  const target = firstValidTemperatureTarget([
    getPath(root, "temperature.target"),
    getPath(root, "temperature.target_c"),
    getPath(root, "temperature.target_temperature"),
  ]);
  const parts = [];
  if (Number.isFinite(temp)) parts.push(options.compact ? `${temp.toFixed(2)} C` : `current ${temp.toFixed(2)} C`);
  if (isValidTemperatureTarget(target)) parts.push(options.compact ? `target ${target.toFixed(2)}` : `target ${target.toFixed(2)} C`);
  return parts.join("\n") || shortJson(getPath(root, "temperature"));
}

function formatStageSummary(position) {
  if (!position || typeof position !== "object") return shortJson(position);
  return ["X", "Y", "Z"]
    .filter((axis) => position[axis] !== undefined)
    .map((axis) => `${axis} ${position[axis]}`)
    .join("\n");
}

function formatImagingSummary(settings) {
  if (!settings || typeof settings !== "object") return shortJson(settings);
  const fields = [
    ["channel", settings.current_channel || settings.channel],
    ["exp", settings.exposure_time],
    ["gain", settings.gain || settings.analog_gain],
    ["auto", settings.auto_exposure],
  ];
  return fields
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([label, value]) => `${label} ${value}`)
    .join("\n") || shortJson(settings);
}

function formatLightSummary(settings) {
  if (!settings || typeof settings !== "object") return shortJson(settings);
  const fields = [
    ["on", settings.light_on],
    ["coax", settings.coaxial_intensity],
    ["ring", settings.ring_intensity],
  ];
  return fields
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([label, value]) => `${label} ${value}`)
    .join("\n");
}

function formatMatrixSummary(matrix) {
  if (!matrix || typeof matrix !== "object") return shortJson(matrix);
  const fields = [
    ["active", matrix.active_electrode_count || matrix.active_count],
    ["shape", Array.isArray(matrix.shape) ? matrix.shape.join("x") : matrix.shape],
    ["voltage", matrix.voltage],
  ];
  return fields
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([label, value]) => `${label} ${value}`)
    .join("\n") || shortJson(matrix);
}

function formatVisualizerSummary(visualizers) {
  if (!visualizers || typeof visualizers !== "object") return "";
  if (typeof visualizers.text === "string") {
    return visualizers.text.includes("No system loaded") ? "not loaded" : visualizers.text;
  }
  return Object.entries(visualizers)
    .map(([name, item]) => {
      if (!item || typeof item !== "object") return `${name}: ${shortJson(item)}`;
      const mode = item.window_mode || (item.available === false ? "unavailable" : "ready");
      const source = item.source ? ` ${item.source}` : "";
      return `${name}: ${mode}${source}`;
    })
    .join("\n");
}

function firstFinite(values) {
  return values.find((value) => Number.isFinite(value));
}

function firstValidTemperatureTarget(values) {
  return values.find((value) => isValidTemperatureTarget(value));
}

function formatPath(root, path) {
  const value = getPath(root, path);
  return shortJson(value);
}

function getPath(root, path) {
  let current = root;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function shortJson(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => (
    {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[char] || char
  ));
}
