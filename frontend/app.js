const MATRIX_VIEW_STORAGE_KEY = "droplogic.matrixView.v1";
const MATRIX_SCENE_STORAGE_KEY = "droplogic.matrixScene.v1";
const STREAMER_VIEW_STORAGE_KEY = "droplogic.streamerView.v1";

const state = {
  ws: null,
  events: [],
  status: null,
  live: null,
  bottomTab: "state",
  agentBusy: false,
  runs: [],
  runsOpen: false,
  controlsOpen: false,
  selectedRunId: "",
  forceConversationRender: false,
  selectedRuns: new Set(),
  namingRuns: new Set(),
  temperatureSamples: [],
  temperatureHover: null,
  tokenChartHover: null,
  contextHistogramHover: null,
  matrixHover: null,
  matrixSceneHitboxes: [],
  timelineHitboxes: [],
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
    lastRequestKey: "",
    requestTimer: null,
  },
  matrixPaths: {
    collapsed: true,
    hiddenActions: new Set(),
    hoveredActionId: "",
    revision: "",
  },
  matrixPaint: {
    collapsed: true,
    tool: "",
    dragging: false,
    start: null,
    current: null,
    overlays: [],
  },
  matrixSelection: {
    dragging: false,
    moved: false,
    start: null,
    current: null,
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
  calibration: {
    active: false,
    data: null,
    localPosition: null,
    jogStep: 100,
    lastMoveAt: 0,
    movePending: false,
  },
  timeline: {
    followLive: true,
    selectedFrame: null,
    selectedDropletId: null,
    dragging: false,
    moved: false,
    dragMode: "",
    dragStartX: 0,
    dragStartY: 0,
    dragStartOffsetFrame: 0,
    hoverFrame: null,
    hoverEvent: null,
    hoverX: 0,
    hoverY: 0,
    zoom: 1,
    offsetFrame: 0,
    frameDelay: 1.0,
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
    meterAnimation: null,
  },
};

const TYPEWRITER_INTERVAL_MS = 11;
const TYPEWRITER_CHARS_PER_TICK = 4;

const $ = (id) => document.getElementById(id);

restoreMatrixView();
restoreMatrixSceneCache();
restoreStreamerView();

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

function restoreMatrixSceneCache() {
  try {
    const raw = window.localStorage?.getItem(MATRIX_SCENE_STORAGE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw);
    const scene = cached?.scene?.result || cached?.scene;
    if (!scene?.available) return;
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
  const nextLive = live || {};
  const scene = nextLive?.scene?.result || nextLive?.scene;
  if (scene?.available) {
    persistMatrixScene(scene, nextLive);
    return nextLive;
  }
  if (state.matrixSceneCache?.scene) {
    return {
      ...nextLive,
      updated_at: nextLive.updated_at || state.matrixSceneCache.updated_at,
      scene: state.matrixSceneCache.scene,
    };
  }
  return nextLive;
}

function appendEvent(event, options = {}) {
  const key = eventKey(event);
  if (state.events.some((item) => eventKey(item) === key)) return;
  state.events.push(event);
  if (isAudioTerminalEvent(event)) {
    state.audio.transcribing = false;
    setAudioStatus(event.type === "audio_transcript" ? "Transcript ready" : "Transcription error", event.type !== "audio_transcript");
  }
  if ((event.type === "context_compacted" || event.type === "context_ai_summary") && options.replay !== true) {
    state.compactingUntil = Date.now() + 2600;
  }
  if (options.liveAgent === true) scheduleTypewriter(event);
  render();
}

function eventKey(event) {
  return `${event.t || ""}|${event.type || ""}|${event.tool || ""}|${event.text || event.prompt || event.message || event.error || ""}`;
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
    askButton.textContent = state.agentBusy ? "Steer" : "Ask";
  }
  const stopButton = $("stopAgent");
  if (stopButton) stopButton.disabled = !state.agentBusy;
  const cancelButton = $("cancelAgent");
  if (cancelButton) cancelButton.disabled = !state.agentBusy;
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
  renderPlanTimeline();
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

function setText(id, text) {
  const node = $(id);
  if (node) node.textContent = text;
}

function renderConversation() {
  const list = $("conversation");
  if (!list) return;
  const events = conversationRenderItems();
  const renderKey = `${state.selectedRunId || state.status?.run_id || ""}::${state.events.length}::${events.map(eventKey).join("||")}::${JSON.stringify(state.conversationFilters)}::${state.typewriterVersion}`;
  if (renderKey === state.lastRenderedConversationKey) return;
  if (!state.forceConversationRender && hasTextSelectionInside(list)) return;
  const shouldFollowLatest = state.conversationAtLatest;
  const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
  state.forceConversationRender = false;
  state.lastRenderedConversationKey = renderKey;
  list.innerHTML = "";
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
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
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

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wsPort = Number(location.port || (location.protocol === "https:" ? 443 : 80)) + 1;
  state.ws = new WebSocket(`${proto}://${location.hostname}:${wsPort}/ws`);
  state.ws.onopen = () => {
    appendEvent({ ts: new Date().toISOString(), type: "ui_connected" });
    send({ type: "get_status" });
    state.streamerView.lastRequestKey = "";
    requestStreamerResolutionUpdate();
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
    } else if (data.type === "live") {
      state.live = mergeLiveWithMatrixCache(data.live);
      renderLiveOnly();
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
      renderPlanTimeline();
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
      renderPlanTimeline();
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
      }
      renderMatrixPanel(state.live || {});
      renderPlanTimeline();
    } else if (data.type === "calibration_state") {
      state.calibration.data = data.calibration || null;
      state.calibration.active = Boolean(data.calibration?.active);
      if (data.calibration?.position) state.calibration.localPosition = data.calibration.position;
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
    } else if (data.type === "runs") {
      state.runs = data.runs || [];
      renderRuns();
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
      state.runs = data.runs || [];
      state.selectedRunId = data.status?.run_id || "";
      state.events = data.events || [];
      state.audio.transcribing = audioTranscriptionPending(state.events);
      state.temperatureSamples = [];
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
    } else if (data.type === "visualizer_download") {
      handleVisualizerDownload(data);
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
  for (const tab of document.querySelectorAll(".bottom-tab")) {
    tab.onclick = () => setBottomTab(tab.dataset.bottomTab);
  }
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
  if (streamerViewer) {
    streamerViewer.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomStreamerFrame(event);
    }, { passive: false });
    streamerViewer.addEventListener("dblclick", () => {
      resetStreamerView();
      applyStreamerView();
      requestStreamerResolutionUpdate();
    });
    streamerViewer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      streamerViewer.setPointerCapture?.(event.pointerId);
      state.streamerView.dragging = true;
      state.streamerView.moved = false;
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
      if (event.button !== 0) return;
      streamerViewer.releasePointerCapture?.(event.pointerId);
      const wasDragging = state.streamerView.dragging;
      state.streamerView.dragging = false;
      streamerViewer.classList.remove("dragging");
      if (wasDragging) saveStreamerView();
    });
    streamerViewer.addEventListener("pointercancel", () => {
      const wasDragging = state.streamerView.dragging;
      state.streamerView.dragging = false;
      state.streamerView.moved = false;
      streamerViewer.classList.remove("dragging");
      if (wasDragging) saveStreamerView();
    });
    streamerViewer.addEventListener("mouseleave", () => {
      const wasDragging = state.streamerView.dragging;
      state.streamerView.dragging = false;
      state.streamerView.moved = false;
      streamerViewer.classList.remove("dragging");
      if (wasDragging) saveStreamerView();
    });
  }
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
      if (event.button !== 0) return;
      hideMatrixContextMenu();
      stopMatrixEdgePan();
      if (activeMatrixPaintValue() !== null) {
        const electrode = matrixElectrodeFromPointerEvent(event);
        if (!electrode) return;
        event.preventDefault();
        matrixScene.setPointerCapture?.(event.pointerId);
        state.matrixPaint.dragging = true;
        state.matrixPaint.start = electrode;
        state.matrixPaint.current = electrode;
        matrixScene.classList.add("dragging");
        renderMatrixPanel(state.live || {});
        return;
      }
      startMatrixSelectionDrag(event);
    });
    matrixScene.addEventListener("pointermove", (event) => {
      const rect = matrixScene.getBoundingClientRect();
      state.matrixHover = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      updateMatrixEdgePan(event, rect);
      if (state.matrixPaint.dragging) {
        const electrode = matrixElectrodeFromPointerEvent(event);
        if (electrode) {
          state.matrixPaint.current = electrode;
          renderMatrixPanel(state.live || {});
        }
        updateMatrixHover(state.matrixHover);
        updateMatrixCursorHud(state.matrixHover);
        updateMatrixPaintCursor(state.matrixHover);
        return;
      }
      if (state.matrixSelection.dragging) {
        updateMatrixSelectionDrag(event);
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
      if (event.button !== 0) return;
      matrixScene.releasePointerCapture?.(event.pointerId);
      if (state.matrixPaint.dragging) {
        endMatrixPaintDrag();
        matrixScene.classList.remove("dragging");
        return;
      }
      if (state.matrixSelection.dragging) {
        endMatrixSelectionDrag(event);
        matrixScene.classList.remove("dragging");
        return;
      }
      handleMatrixSceneClick(event);
      matrixScene.classList.remove("dragging");
    });
    matrixScene.addEventListener("pointercancel", () => {
      if (state.matrixPaint.dragging) {
        cancelMatrixPaintDrag();
        matrixScene.classList.remove("dragging");
        return;
      }
      if (state.matrixSelection.dragging) {
        cancelMatrixSelectionDrag();
        matrixScene.classList.remove("dragging");
        return;
      }
      state.matrixView.dragging = false;
      state.matrixView.moved = false;
      matrixScene.classList.remove("dragging");
    });
    matrixScene.addEventListener("mouseleave", () => {
      state.matrixHover = null;
      state.matrixMovePreview.hover = null;
      stopMatrixEdgePan();
      if (state.matrixPaint.dragging) {
        cancelMatrixPaintDrag();
        matrixScene.classList.remove("dragging");
      }
      if (state.matrixSelection.dragging) {
        cancelMatrixSelectionDrag();
        matrixScene.classList.remove("dragging");
      }
      state.matrixView.dragging = false;
      state.matrixView.moved = false;
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
      renderPlanTimeline();
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
        const visible = timelineVisibleFrames(count);
        const delta = (event.deltaX || event.deltaY) / Math.max(24, planTimeline.clientWidth || 1);
        panTimelineFrames(delta * visible);
      } else {
        zoomTimelineAtEvent(event);
      }
    }, { passive: false });
    planTimeline.addEventListener("pointerdown", (event) => {
      if (state.matrixCommands.planning) return;
      planTimeline.setPointerCapture?.(event.pointerId);
      state.timeline.dragging = true;
      if (event.shiftKey) {
        state.timeline.dragMode = "pan";
        state.timeline.dragStartX = event.clientX;
        state.timeline.dragStartOffsetFrame = Number(state.timeline.offsetFrame) || 0;
        planTimeline.classList.add("panning");
      } else {
        state.timeline.dragMode = "scrub";
        selectTimelineFrameFromEvent(event);
      }
    });
    planTimeline.addEventListener("pointermove", (event) => {
      updateTimelineHoverFromEvent(event);
      if (!state.timeline.dragging) return;
      if (state.timeline.dragMode === "pan") {
        dragPanTimeline(event);
      } else {
        selectTimelineFrameFromEvent(event);
      }
    });
    planTimeline.addEventListener("pointerup", (event) => {
      planTimeline.releasePointerCapture?.(event.pointerId);
      state.timeline.dragging = false;
      state.timeline.dragMode = "";
      planTimeline.classList.remove("panning");
    });
    planTimeline.addEventListener("pointercancel", () => {
      state.timeline.dragging = false;
      state.timeline.dragMode = "";
      state.timeline.hoverEvent = null;
      planTimeline.classList.remove("panning");
      updateTimelineHover(null);
    });
    planTimeline.addEventListener("mouseleave", () => {
      state.timeline.hoverFrame = null;
      state.timeline.hoverEvent = null;
      state.timeline.dragging = false;
      state.timeline.dragMode = "";
      planTimeline.classList.remove("panning");
      updateTimelineHover(null);
      renderPlanTimeline();
    });
  }
  $("startMcp").onclick = () => send({ type: "start_mcp" });
  $("stopMcp").onclick = () => send({ type: "stop_mcp" });
  $("statusBtn").onclick = () => send({ type: "mcp_tool", tool: "runtime_status", arguments: {} });
  $("cartridgeCalibration").onclick = () => openCalibrationOverlay();
  $("calibrationClose").onclick = () => closeCalibrationOverlay();
  $("calibrationAccept").onclick = () => acceptCalibrationStep();
  $("calibrationSave").onclick = () => send({ type: "calibration_save" });
  $("calibrationMoveTarget").onclick = () => send({ type: "calibration_move_to_target" });
  for (const button of document.querySelectorAll("[data-calibration-step]")) {
    button.addEventListener("click", () => {
      state.calibration.jogStep = Number(button.getAttribute("data-calibration-step")) || 100;
      renderCalibrationOverlay();
    });
  }
  document.addEventListener("keydown", handleCalibrationKeydown);
  document.addEventListener("keydown", handleSelectedDropletKeydown);
  $("downloadStreamer").onclick = () => downloadVisualizerFrame("streamer");
  $("downloadMatrix").onclick = () => downloadVisualizerFrame("matrix");
  $("matrixPathToggle").onclick = () => {
    state.matrixPaths.collapsed = !state.matrixPaths.collapsed;
    renderMatrixPathPanel(matrixSceneForTimeline(state.live?.scene?.result || state.live?.scene));
  };
  $("timelineLive").onclick = () => followLiveTimeline();
  $("timelineZoomIn").onclick = () => zoomTimelineButton(1.4);
  $("timelineZoomOut").onclick = () => zoomTimelineButton(1 / 1.4);
  $("timelineTrimTail").onclick = () => trimTimelineTailAfterSelectedFrame();
  $("timelinePlay").onclick = () => playTimelineExecution();
  $("timelinePause").onclick = () => callTimelineExecutionTool("pause_plan", {});
  $("timelineRewind").onclick = () => rewindTimelineExecution();
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
  $("newRun").onclick = () => send({ type: "new_run" });
  $("selectAllRuns").onclick = () => toggleSelectAllRuns();
  $("deleteSelectedRuns").onclick = () => deleteSelectedRuns();
  $("copyOutput").onclick = () => copyLastOutput();
  $("setGoal").onclick = () => setGoalFromPrompt();
  $("toggleGoal").onclick = () => toggleGoalPaused();
  $("clearGoal").onclick = () => clearGoal();
  $("stopAgent").onclick = () => stopAgent();
  $("cancelAgent").onclick = () => stopAgent();
  $("audioInput").onclick = () => toggleAudioInput();
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
  $("agentPrompt").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendAgentPrompt();
    }
  });
  $("clearLocal").onclick = () => {
    state.events = [];
    state.typewriter.clear();
    stopTypewriterAnimation();
    render();
  };
  if (state.matrixSceneCache) renderLiveOnly();
  connect();
  renderFilters();
});

window.addEventListener("resize", () => {
  state.live = mergeLiveWithMatrixCache(state.live || {});
  renderMatrixPanel(state.live || {});
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

function stopAgent() {
  if (!state.agentBusy) return;
  send({ type: "cancel_agent" });
}

async function toggleAudioInput() {
  if (state.audio.transcribing) return;
  if (state.audio.recording) {
    stopAudioRecording();
  } else {
    await startAudioRecording();
  }
}

async function startAudioRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setAudioStatus("Audio capture is not available in this browser.", true);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickAudioMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    state.audio.stream = stream;
    state.audio.recorder = recorder;
    state.audio.chunks = [];
    state.audio.mimeType = recorder.mimeType || mimeType || "audio/webm";
    state.audio.startedAt = Date.now();
    setupAudioMeter(stream);
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) state.audio.chunks.push(event.data);
    };
    recorder.onstop = () => submitAudioRecording();
    recorder.start();
    state.audio.recording = true;
    setAudioStatus("Recording");
    updateAudioUi();
  } catch (error) {
    cleanupAudioStream();
    setAudioStatus(`Microphone error: ${error.message || error}`, true);
    updateAudioUi();
  }
}

function stopAudioRecording() {
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
  cleanupAudioStream();
  state.audio.recording = false;
  if (!chunks.length) {
    setAudioStatus("No audio captured.", true);
    updateAudioUi();
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
      duration_ms: Date.now() - state.audio.startedAt,
      run_id: state.selectedRunId || state.status?.run_id || "",
    });
  } catch (error) {
    state.audio.transcribing = false;
    setAudioStatus(`Audio send error: ${error.message || error}`, true);
    updateAudioUi();
  }
}

function cleanupAudioStream() {
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

function handleAudioTranscription(data) {
  if (data.busy) {
    state.audio.transcribing = true;
    setAudioStatus("Transcribing");
    updateAudioUi();
    return;
  }
  state.audio.transcribing = false;
  if (data.ok) {
    const text = (data.text || "").trim();
    if (text) appendTranscriptToPrompt(text);
    setAudioStatus(text ? "Transcript added" : "No speech detected", !text);
  } else {
    setAudioStatus(`Transcription error: ${data.error || "unknown error"}`, true);
  }
  updateAudioUi();
}

function appendTranscriptToPrompt(text) {
  const input = $("agentPrompt");
  if (!input) return;
  const prefix = input.value.trim() ? `${input.value.trim()}\n` : "";
  input.value = `${prefix}${text}`;
  input.focus();
}

function setAudioStatus(message, isError = false) {
  const node = $("audioStatus");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("error", Boolean(isError));
}

function updateAudioUi() {
  const button = $("audioInput");
  if (!button) return;
  const composer = button.closest(".composer");
  composer?.classList.toggle("recording-audio", state.audio.recording);
  composer?.classList.toggle("transcribing-audio", state.audio.transcribing);
  button.classList.toggle("recording", state.audio.recording);
  button.classList.toggle("transcribing", state.audio.transcribing);
  button.disabled = state.audio.transcribing;
  button.setAttribute(
    "aria-label",
    state.audio.recording ? "Stop audio recording" : "Record audio"
  );
  button.title = state.audio.recording ? "Stop and transcribe audio" : "Record local speech-to-text audio";
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
  drawAudioMeter();
}

function stopAudioMeter() {
  if (state.audio.meterAnimation) cancelAnimationFrame(state.audio.meterAnimation);
  state.audio.meterAnimation = null;
  state.audio.analyser = null;
  state.audio.meterData = null;
  if (state.audio.audioContext) {
    state.audio.audioContext.close().catch(() => {});
  }
  state.audio.audioContext = null;
}

function drawAudioMeter() {
  const canvas = $("audioMeter");
  const analyser = state.audio.analyser;
  const data = state.audio.meterData;
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
  ctx.fillText("Listening", 12 * dpr, height / 2);
  state.audio.meterAnimation = requestAnimationFrame(drawAudioMeter);
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
  line.classList.toggle("compacting", compacting);
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
        node.textContent = agentStatusText(isCompacting);
        node.classList.toggle("compacting", isCompacting);
        node.classList.toggle(
          "active",
          state.agentBusy || isCompacting || state.audio.recording || state.audio.transcribing
        );
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
  setText("liveState", state.live?.updated_at || state.status?.live?.updated_at || "-");
  setText("liveStateAdvanced", state.live?.updated_at || state.status?.live?.updated_at || "-");
  renderLive();
  renderPlanTimeline();
  compactStatePanel();
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
  renderMatrixPanel(live);
  renderFrame("streamer", live.frames?.streamer);
  renderCalibrationFrame(live.frames?.streamer);
  updateTemperatureHistory(live);
  renderStateGrid(live);
  renderTemperatureChart();
  renderPlanTimeline();
}

function renderMatrixPanel(live) {
  const effectiveLive = mergeLiveWithMatrixCache(live || {});
  const scene = effectiveLive?.scene?.result || effectiveLive?.scene;
  if (scene?.available) {
    renderMatrixScene(matrixSceneForTimeline(scene));
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
  renderFrame("matrix", effectiveLive.frames?.matrix);
}

function renderBottomTabs() {
  for (const tab of document.querySelectorAll(".bottom-tab")) {
    const active = tab.dataset.bottomTab === state.bottomTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  $("stateBottomPanel")?.classList.toggle("active", state.bottomTab === "state");
  $("timelineBottomPanel")?.classList.toggle("active", state.bottomTab === "timeline");
}

function setBottomTab(name) {
  state.bottomTab = name === "timeline" ? "timeline" : "state";
  renderBottomTabs();
  requestAnimationFrame(() => {
    renderTemperatureChart();
    renderPlanTimeline();
  });
}

function syncTimelineSelection(scene) {
  if (!state.timeline.followLive) return;
  const liveFrame = liveFrameIndex(scene);
  state.timeline.selectedFrame = liveFrame;
  ensureTimelineFrameVisible(liveFrame, timelineFrameCount(scene));
}

function liveFrameIndex(scene) {
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
  const count = effectiveTimeline(scene)?.frame_count ?? scene?.frame?.count ?? scene?.plan?.frame_count;
  const number = Number(count);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function effectiveTimeline(scene) {
  if (scene?.timeline?.available) return scene.timeline;
  const actions = matrixTimelineActions(scene);
  if (!actions.length) return scene?.timeline || null;
  const frameCount = Number(scene?.plan?.frame_count || scene?.frame?.count || 0);
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

function renderPlanTimeline() {
  const canvas = $("planTimeline");
  if (!canvas) return;
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
  const executing = Boolean(scene?.executor?.is_executing || scene?.executor?.running);
  const processing = Boolean(state.matrixCommands.planning);
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

  const layout = timelineLayout(width, height, count);
  drawTimelineRuler(ctx, layout, count);
  if (!timeline?.available || !count) {
    state.timelineHitboxes = [];
    updateTimelineHover(null);
    renderTimelineDropletPanel(null);
    ctx.fillStyle = "#8e8e93";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI";
    ctx.fillText("waiting for plan frames", layout.left, Math.max(38, height / 2));
    if (processing) drawTimelineProcessing(ctx, width, height, "Processing SIPP plan...");
    return;
  }

  drawTimelineExecutedRegion(ctx, layout, scene);
  drawTimelineEvents(ctx, layout, timeline.events || [], count);
  drawSelectedDropletTimeline(ctx, layout, scene);
  drawTimelineActiveTicks(ctx, layout, timeline.frames || [], count);
  drawTimelineCursor(ctx, layout, count - 1, "rgba(191, 90, 242, 0.96)", true, "planned");
  const executed = liveFrameIndex(scene);
  if (Number.isFinite(Number(executed))) {
    drawTimelineCursor(ctx, layout, Number(executed), "rgba(48, 209, 88, 0.98)", true, "executed");
  }
  if (Number.isFinite(Number(state.timeline.hoverFrame))) {
    drawTimelineCursor(ctx, layout, Number(state.timeline.hoverFrame), "rgba(245, 245, 247, 0.22)", false);
  }
  const selected = selectedTimelineFrame(scene);
  if (Number.isFinite(selected) && !state.timeline.followLive) {
    drawTimelineCursor(
      ctx,
      layout,
      selected,
      "rgba(100, 210, 255, 0.98)",
      true,
      "preview",
    );
  }
  if (processing) drawTimelineProcessing(ctx, width, height, "Processing SIPP plan...");
  renderTimelineDropletPanel(scene);
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
  return eventType ? `${mode} ${frameText} ${eventType}` : `${mode} ${frameText}`;
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
  renderPlanTimeline();
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
    execution_view_mode: "follow_droplets",
  });
}

function rewindTimelineExecution() {
  const delay = commitTimelineFrameDelay();
  state.timeline.followLive = true;
  state.timeline.selectedFrame = 0;
  callTimelineExecutionTool("start_plan", {
    frame_delay: delay,
    restart_from_beginning: true,
    allow_failed_plan: false,
    enable_visualizers: false,
    execution_view_mode: "follow_droplets",
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

function formatTimelineEventType(type, data = {}) {
  const primitive = String(data?.primitive || "").toLowerCase();
  const splitMode = String(data?.split_mode || data?.mode || "").toLowerCase();
  if (primitive === "reservoir_extraction" || String(type || "").toLowerCase().includes("extraction")) {
    if (splitMode === "linear") return "Linear extraction";
    if (splitMode === "1to2") return "1to2 extraction";
    if (splitMode === "1to3") return "1to3 extraction";
    return "Reservoir extraction";
  }
  const raw = String(type || "action").replace(/[_-]+/g, " ").trim();
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
  if (!Number.isFinite(Number(frame))) frame = state.timeline.selectedFrame;
  if (!Number.isFinite(Number(frame))) return null;
  return Math.trunc(clamp(Number(frame), 0, count - 1));
}

function timelineLayout(width, height, count) {
  syncTimelineViewport(count);
  const left = Math.min(52, Math.max(34, width * 0.055));
  const right = 16;
  const top = 30;
  const bottom = 25;
  const trackWidth = Math.max(1, width - left - right);
  const laneCount = Math.max(2, Math.min(5, Math.floor((height - top - bottom) / 24)));
  const laneGap = 5;
  const laneHeight = Math.max(14, Math.min(20, (height - top - bottom - laneGap * (laneCount - 1)) / laneCount));
  const lanePitch = laneHeight + laneGap;
  const axisY = top + laneCount * lanePitch + 4;
  const visibleFrames = timelineVisibleFrames(count);
  const startFrame = Math.max(0, Math.min(Math.max(0, count - visibleFrames), state.timeline.offsetFrame || 0));
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
    endFrame: Math.min(Math.max(0, count - 1), startFrame + Math.max(0, visibleFrames - 1)),
  };
}

function timelineXForFrame(layout, frame) {
  if (layout.visibleFrames <= 1) return layout.left;
  return layout.left + ((frame - layout.startFrame) / (layout.visibleFrames - 1)) * layout.trackWidth;
}

function timelineFrameForX(layout, x) {
  if (layout.visibleFrames <= 1) return Math.round(layout.startFrame);
  const progress = clamp((x - layout.left) / layout.trackWidth, 0, 1);
  return Math.round(layout.startFrame + progress * (layout.visibleFrames - 1));
}

function timelineVisibleFrames(count) {
  if (!count) return 1;
  const zoom = clamp(Number(state.timeline.zoom) || 1, 1, 80);
  return Math.max(1, Math.ceil(count / zoom));
}

function syncTimelineViewport(count) {
  state.timeline.zoom = clamp(Number(state.timeline.zoom) || 1, 1, 80);
  const visible = timelineVisibleFrames(count);
  const maxOffset = Math.max(0, count - visible);
  state.timeline.offsetFrame = clamp(Number(state.timeline.offsetFrame) || 0, 0, maxOffset);
}

function panTimelineFrames(deltaFrames) {
  const count = timelineFrameCount(state.live?.scene?.result || state.live?.scene);
  if (!count) return;
  state.timeline.followLive = false;
  syncTimelineViewport(count);
  const visible = timelineVisibleFrames(count);
  const maxOffset = Math.max(0, count - visible);
  state.timeline.offsetFrame = clamp((Number(state.timeline.offsetFrame) || 0) + deltaFrames, 0, maxOffset);
  renderPlanTimeline();
}

function zoomTimelineAtEvent(event) {
  const canvas = $("planTimeline");
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!canvas || !count) return;
  state.timeline.followLive = false;
  const rect = canvas.getBoundingClientRect();
  const oldLayout = timelineLayout(rect.width || canvas.clientWidth || 1, rect.height || canvas.clientHeight || 1, count);
  const cursorFrame = timelineFrameForX(oldLayout, event.clientX - rect.left);
  const direction = event.deltaY < 0 ? 1 : -1;
  const factor = direction > 0 ? 1.25 : 0.8;
  const oldZoom = clamp(Number(state.timeline.zoom) || 1, 1, 80);
  const newZoom = clamp(oldZoom * factor, 1, 80);
  if (Math.abs(newZoom - oldZoom) < 0.001) return;
  state.timeline.zoom = newZoom;
  const visible = timelineVisibleFrames(count);
  const cursorRatio = clamp((event.clientX - rect.left - oldLayout.left) / oldLayout.trackWidth, 0, 1);
  const maxOffset = Math.max(0, count - visible);
  state.timeline.offsetFrame = clamp(cursorFrame - cursorRatio * Math.max(0, visible - 1), 0, maxOffset);
  renderPlanTimeline();
}

function zoomTimelineButton(factor) {
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!count) return;
  state.timeline.followLive = false;
  const focus = selectedTimelineFrame(scene) ?? (state.timeline.offsetFrame + timelineVisibleFrames(count) / 2);
  const oldZoom = clamp(Number(state.timeline.zoom) || 1, 1, 80);
  const newZoom = clamp(oldZoom * factor, 1, 80);
  if (Math.abs(newZoom - oldZoom) < 0.001) return;
  state.timeline.zoom = newZoom;
  const visible = timelineVisibleFrames(count);
  const maxOffset = Math.max(0, count - visible);
  state.timeline.offsetFrame = clamp(focus - visible / 2, 0, maxOffset);
  renderPlanTimeline();
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
    ctx.fillText(String(frame + 1), x - 5, layout.axisY + 18);
  }
  ctx.restore();
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
    const span = event?.frame_span;
    if (!Array.isArray(span) || span.length < 2) return;
    const start = clamp(Number(span[0]), 0, count - 1);
    const end = clamp(Number(span[1]), 0, count - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (Math.max(start, end) < layout.startFrame || Math.min(start, end) > layout.endFrame) return;
    const lane = index % layout.laneCount;
    const visibleStart = Math.max(layout.startFrame, Math.min(start, end));
    const visibleEnd = Math.min(layout.endFrame, Math.max(start, end));
    const x0 = timelineXForFrame(layout, visibleStart);
    const x1 = timelineXForFrame(layout, visibleEnd);
    const y = layout.top + lane * layout.lanePitch;
    const singleFrame = Math.min(start, end) === Math.max(start, end);
    const w = Math.max(singleFrame ? 8 : 5, x1 - x0 + Math.max(4, layout.trackWidth / Math.max(1, layout.visibleFrames) * 0.6));
    const clippedW = Math.min(w, layout.left + layout.trackWidth - x0);
    const rect = {
      x: x0,
      y: y + 2,
      w: clippedW,
      h: layout.laneHeight - 4,
    };
    const selected = selectedDropletId !== null && timelineEventMentionsDroplet(event, selectedDropletId);
    hitboxes.push({
      ...rect,
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
    if (singleFrame) {
      ctx.beginPath();
      ctx.moveTo(x0 + clippedW / 2, y - 2);
      ctx.lineTo(x0 + clippedW / 2 - 5, y + 6);
      ctx.lineTo(x0 + clippedW / 2 + 5, y + 6);
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

function drawTimelineActiveTicks(ctx, layout, frames, count) {
  if (!Array.isArray(frames) || !frames.length) return;
  ctx.save();
  const maxActive = Math.max(1, ...frames.map((frame) => Number(frame?.summary?.active_count || 0)));
  const tickBaseY = Math.min(layout.height - 10, layout.axisY + 22);
  const tickHeight = Math.max(8, layout.height - tickBaseY - 6);
  ctx.fillStyle = "rgba(100, 210, 255, 0.36)";
  const step = Math.max(1, Math.ceil(count / Math.max(1, layout.trackWidth)));
  const firstIndex = Math.max(0, Math.floor(layout.startFrame));
  const lastIndex = Math.min(frames.length - 1, Math.ceil(layout.endFrame));
  for (let index = firstIndex; index <= lastIndex; index += step) {
    const frame = frames[index];
    const frameIndex = Number(frame?.index);
    if (!Number.isFinite(frameIndex)) continue;
    const active = Number(frame?.summary?.active_count || 0);
    if (active <= 0) continue;
    const x = timelineXForFrame(layout, frameIndex);
    const h = Math.max(2, tickHeight * Math.sqrt(active / maxActive));
    ctx.fillRect(x, tickBaseY + tickHeight - h, Math.max(1, layout.trackWidth / count), h);
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
    renderPlanTimeline();
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
      state.timeline.selectedFrame = frame;
      ensureTimelineFrameVisible(frame, timelineFrameCount(scene));
      renderMatrixPanel(state.live || {});
      renderPlanTimeline();
    });
    row.addEventListener("mouseenter", () => {
      state.matrixPaths.hoveredActionId = String(action.id || "");
      if (state.matrixPaths.hoveredActionId) {
        renderMatrixScene(matrixSceneForTimeline(state.live?.scene?.result || state.live?.scene), { skipPathPanel: true });
      }
    });
    row.addEventListener("mouseleave", () => {
      if (state.matrixPaths.hoveredActionId === String(action.id || "")) {
        state.matrixPaths.hoveredActionId = "";
        renderMatrixScene(matrixSceneForTimeline(state.live?.scene?.result || state.live?.scene), { skipPathPanel: true });
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
  const layout = timelineLayout(rect.width || canvas.clientWidth || 1, rect.height || canvas.clientHeight || 1, count);
  const frame = timelineFrameForX(layout, event.clientX - rect.left);
  state.timeline.followLive = false;
  state.timeline.selectedFrame = frame;
  ensureTimelineFrameVisible(frame, count);
  renderMatrixPanel(state.live || {});
  renderPlanTimeline();
}

function updateTimelineHoverFromEvent(event) {
  const canvas = $("planTimeline");
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!canvas || !count) return;
  const rect = canvas.getBoundingClientRect();
  const layout = timelineLayout(rect.width || canvas.clientWidth || 1, rect.height || canvas.clientHeight || 1, count);
  const hover = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  state.timeline.hoverFrame = timelineFrameForX(layout, hover.x);
  state.timeline.hoverX = hover.x;
  state.timeline.hoverY = hover.y;
  const hit = [...state.timelineHitboxes].reverse().find((box) => matrixHitboxContains(box, hover));
  state.timeline.hoverEvent = hit?.event || null;
  renderPlanTimeline();
  updateTimelineHover(hover);
}

function updateTimelineHover(hover) {
  const tooltip = $("timelineHover");
  if (!tooltip) return;
  const event = state.timeline.hoverEvent;
  if (!hover || !event) {
    tooltip.hidden = true;
    return;
  }
  const label = formatTimelineEventType(event.type, event.data);
  const span = timelineEventSpanText(event);
  const metaLines = timelineEventMetaLines(event);
  tooltip.innerHTML = [
    `<strong>${escapeHtml(label)}</strong>`,
    `<span>${escapeHtml(span)}</span>`,
    ...metaLines.map((line) => `<span>${escapeHtml(line)}</span>`),
  ].join("");
  tooltip.hidden = false;
  const canvas = $("planTimeline");
  const panel = canvas?.closest(".plan-timeline-panel");
  const baseX = (canvas?.offsetLeft || 0) + hover.x;
  const baseY = (canvas?.offsetTop || 0) + hover.y;
  const maxX = Math.max(8, (panel?.clientWidth || 260) - tooltip.offsetWidth - 8);
  const maxY = Math.max(8, (panel?.clientHeight || 220) - tooltip.offsetHeight - 8);
  tooltip.style.left = `${Math.min(maxX, Math.max(8, baseX + 12))}px`;
  tooltip.style.top = `${Math.min(maxY, Math.max(8, baseY + 12))}px`;
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

function followLiveTimeline() {
  state.timeline.followLive = true;
  const scene = state.live?.scene?.result || state.live?.scene;
  state.timeline.selectedFrame = liveFrameIndex(scene);
  ensureTimelineFrameVisible(state.timeline.selectedFrame, timelineFrameCount(scene));
  renderMatrixPanel(state.live || {});
  renderPlanTimeline();
}

function ensureTimelineFrameVisible(frame, count) {
  if (!Number.isFinite(Number(frame)) || !count) return;
  syncTimelineViewport(count);
  const visible = timelineVisibleFrames(count);
  if (frame < state.timeline.offsetFrame) {
    state.timeline.offsetFrame = frame;
  } else if (frame > state.timeline.offsetFrame + visible - 1) {
    state.timeline.offsetFrame = frame - visible + 1;
  }
  state.timeline.offsetFrame = clamp(state.timeline.offsetFrame, 0, Math.max(0, count - visible));
}

function dragPanTimeline(event) {
  const canvas = $("planTimeline");
  const scene = state.live?.scene?.result || state.live?.scene;
  const count = timelineFrameCount(scene);
  if (!canvas || !count) return;
  const rect = canvas.getBoundingClientRect();
  const layout = timelineLayout(rect.width || canvas.clientWidth || 1, rect.height || canvas.clientHeight || 1, count);
  const framesPerPixel = layout.visibleFrames / Math.max(1, layout.trackWidth);
  const deltaFrames = -(event.clientX - state.timeline.dragStartX) * framesPerPixel;
  const maxOffset = Math.max(0, count - layout.visibleFrames);
  state.timeline.offsetFrame = clamp(state.timeline.dragStartOffsetFrame + deltaFrames, 0, maxOffset);
  renderPlanTimeline();
}

function zoomStreamerFrame(event) {
  const img = $("streamerFrame");
  if (!img) return;
  const viewer = img.closest(".viewer.streamer") || img.closest(".viewer");
  const rect = (viewer || img).getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const view = state.streamerView;
  const oldZoom = Number(view.zoom) || 1;
  const nextZoom = clamp(oldZoom * Math.exp(-event.deltaY * 0.0014), 1, 12);
  if (Math.abs(nextZoom - oldZoom) < 0.001) return;
  const oldPanX = Number(view.panX) || 0;
  const oldPanY = Number(view.panY) || 0;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
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

function clampStreamerView() {
  const img = $("streamerFrame");
  const view = state.streamerView;
  view.zoom = clamp(Number(view.zoom) || 1, 1, 12);
  if (!img) return;
  const viewer = img.closest(".viewer");
  const rect = viewer?.getBoundingClientRect();
  if (!rect) return;
  const maxPanX = Math.max(0, rect.width * (view.zoom - 1) / 2);
  const maxPanY = Math.max(0, rect.height * (view.zoom - 1) / 2);
  view.panX = clamp(Number(view.panX) || 0, -maxPanX, maxPanX);
  view.panY = clamp(Number(view.panY) || 0, -maxPanY, maxPanY);
}

function applyStreamerView() {
  const img = $("streamerFrame");
  if (!img) return;
  clampStreamerView();
  const view = state.streamerView;
  img.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
  img.classList.toggle("zoomed", view.zoom > 1.01);
  img.closest(".viewer")?.classList.toggle("streamer-zoomed", view.zoom > 1.01);
  const meta = $("streamerMeta");
  if (meta?.dataset.baseText) meta.textContent = streamerMetaText(meta.dataset.baseText);
}

function streamerMetaText(baseText) {
  const zoom = Number(state.streamerView.zoom) || 1;
  const resolution = streamerResolutionForZoom(zoom);
  const zoomLabel = zoom > 1.01 ? ` z${zoom.toFixed(1)}x ${resolution.max_width}x${resolution.max_height}` : "";
  return `${baseText}${zoomLabel}`;
}

function streamerResolutionForZoom(zoom = state.streamerView.zoom) {
  const factor = clamp(Number(zoom) || 1, 1, 12);
  return {
    max_width: Math.round(clamp(720 * factor, 720, 3200)),
    max_height: Math.round(clamp(460 * factor, 460, 2200)),
  };
}

function requestStreamerResolutionUpdate() {
  const view = state.streamerView;
  if (view.requestTimer) window.clearTimeout(view.requestTimer);
  view.requestTimer = window.setTimeout(() => {
    view.requestTimer = null;
    const resolution = streamerResolutionForZoom();
    const key = `${resolution.max_width}x${resolution.max_height}`;
    if (key === view.lastRequestKey) return;
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    view.lastRequestKey = key;
    send({
      type: "set_streamer_view",
      ...resolution,
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
}

function openCalibrationOverlay() {
  state.calibration.active = true;
  state.calibration.localPosition = normalizeStagePosition(currentStagePosition());
  renderCalibrationOverlay();
  send({ type: "calibration_start" });
}

function closeCalibrationOverlay() {
  state.calibration.active = false;
  state.calibration.data = null;
  state.calibration.localPosition = null;
  state.calibration.movePending = false;
  renderCalibrationOverlay();
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
  setText("calibrationStepLabel", step.label ? `Target ${step.label}` : "-");

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

  for (const button of document.querySelectorAll("[data-calibration-step]")) {
    button.classList.toggle(
      "active",
      Number(button.getAttribute("data-calibration-step")) === Number(state.calibration.jogStep),
    );
  }
  const accept = $("calibrationAccept");
  if (accept) accept.disabled = Boolean(data.workflow_complete);
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
  if (key === "Enter") {
    event.preventDefault();
    acceptCalibrationStep();
    return;
  }
  if (key.toLowerCase() === "m") {
    event.preventDefault();
    send({ type: "calibration_move_to_target" });
    return;
  }
  if (key.toLowerCase() === "s") {
    event.preventDefault();
    send({ type: "calibration_save" });
    return;
  }
  if (key === "1" || key === "2" || key === "3") {
    event.preventDefault();
    state.calibration.jogStep = key === "1" ? 25 : key === "2" ? 100 : 500;
    renderCalibrationOverlay();
    return;
  }

  const step = Number(state.calibration.jogStep) || 100;
  const delta = {};
  if (key === "ArrowLeft") delta.X = -step;
  else if (key === "ArrowRight") delta.X = step;
  else if (key === "ArrowUp") delta.Y = step;
  else if (key === "ArrowDown") delta.Y = -step;
  else if (key === "-" || key === "_" || key === "PageDown") delta.Z = -step;
  else if (key === "+" || key === "=" || key === "PageUp") delta.Z = step;
  else return;

  event.preventDefault();
  moveCalibrationStage(delta);
}

function handleSelectedDropletKeydown(event) {
  if (state.calibration.active || state.calibration.data?.active) return;
  if (keyboardEventTargetsEditor(event)) return;
  const selectedIds = selectedMatrixDropletIds();
  if (event.key === "Escape" && selectedIds.length) {
    event.preventDefault();
    setMatrixSelectedDropletIds([]);
    renderMatrixPanel(state.live || {});
    renderPlanTimeline();
    return;
  }
  if (event.key.toLowerCase() === "r" && selectedIds.length && !state.matrixCommands.planning) {
    event.preventDefault();
    state.matrixMovePreview.rotation = (Number(state.matrixMovePreview.rotation) + 1) % 4;
    renderMatrixPanel(state.live || {});
    renderPlanTimeline();
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
  renderCalibrationOverlay();
  send({
    type: "calibration_move_stage",
    position,
    wait_timeout_seconds: 1.2,
  });
}

function renderMatrixScene(scene, options = {}) {
  const canvas = $("matrixScene");
  const meta = $("matrixMeta");
  const img = $("matrixFrame");
  const viewer = canvas?.closest(".viewer");
  if (!canvas || !viewer || !meta) return;

  viewer.classList.add("has-scene");
  viewer.classList.remove("has-frame");
  img?.removeAttribute("src");

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
  const droplets = matrixDropletsWithOverrides(scene.droplets || []);
  syncMatrixPathState(scene);
  drawMatrixPaths(ctx, geom, scene, droplets);
  drawMatrixQueuedPaths(ctx, geom, droplets);
  const hitboxes = drawMatrixDroplets(ctx, geom, droplets);
  drawMatrixMovePreview(ctx, geom, scene, droplets);
  drawMatrixSelectionBox(ctx);
  drawMatrixOverlay(ctx, width, height, scene);
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
  const source = scene.frame?.source === "executor_last_applied_frame"
    ? "executed"
    : scene.frame?.source === "state"
      ? "state"
      : scene.frame?.source === "timeline_preview"
        ? "preview"
      : "plan";
  const zoomLabel = Math.abs(geom.zoom - 1) > 0.01 ? ` z${geom.zoom.toFixed(1)}x` : "";
  const pathCount = matrixPathActions(scene).length
    || droplets.filter((droplet) => Array.isArray(droplet.path) && droplet.path.length > 1).length;
  const pathLabel = pathCount ? ` paths ${pathCount}` : "";
  const fovLabel = microscopeFoV ? ` fov ${formatElectrodeCoordinate(microscopeFoV.row)},${formatElectrodeCoordinate(microscopeFoV.col)}` : "";
  meta.textContent = `${source} ${index}/${count} active ${active}${pathLabel}${fovLabel}${zoomLabel}`;
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
  const pad = Math.max(10, Math.min(width, height) * 0.035);
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
  renderMatrixPanel(state.live || {});
}

function updateMatrixEdgePan(event, rect) {
  const scene = state.live?.scene?.result || state.live?.scene;
  const selectionDrag = state.matrixSelection.dragging;
  if (
    !scene?.available
    || (event.buttons && !selectionDrag)
    || state.matrixView.dragging
    || state.matrixPaint.dragging
    || state.matrixNav.minimapDragging
  ) {
    stopMatrixEdgePan();
    return;
  }
  const shortSide = Math.min(rect.width, rect.height);
  const edge = clamp(shortSide * 0.16, 44, 96);
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const speed = clamp(shortSide * 0.46, 90, 300);
  const vx = matrixEdgeVelocity(x, rect.width, edge) * speed;
  const vy = matrixEdgeVelocity(y, rect.height, edge) * speed;
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

function matrixEdgeVelocity(position, size, edge) {
  if (position < edge) {
    const pull = clamp((edge - position) / edge, 0, 1);
    return Math.pow(pull, 2.2);
  }
  if (position > size - edge) {
    const pull = clamp((position - (size - edge)) / edge, 0, 1);
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
  renderMatrixPanel(state.live || {});
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
  renderMatrixPanel(state.live || {});
}

function canvasPointToDisplayCell(geom, x, y) {
  return {
    col: clamp((x - geom.originX) / geom.cell, 0, geom.displayCols),
    row: clamp((y - geom.originY) / geom.cell, 0, geom.displayRows),
  };
}

function canvasPointToElectrode(geom, x, y) {
  const displayCol = (x - geom.originX) / geom.cell;
  const displayRow = (y - geom.originY) / geom.cell;
  if (
    displayCol < 0
    || displayRow < 0
    || displayCol >= geom.displayCols
    || displayRow >= geom.displayRows
  ) {
    return null;
  }
  const row = geom.rows - Math.floor(displayCol) - 1;
  const col = Math.floor(displayRow);
  if (row < 0 || row >= geom.rows || col < 0 || col >= geom.cols) return null;
  return { row, col };
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
    renderPlanTimeline();
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

function matrixElectrodeFromPointerEvent(event) {
  const canvas = $("matrixScene");
  const scene = state.live?.scene?.result || state.live?.scene;
  if (!canvas || !scene?.available) return null;
  const rect = canvas.getBoundingClientRect();
  const shape = matrixShape(scene);
  const geom = matrixSceneGeometry(
    Math.max(1, Math.round(rect.width || canvas.clientWidth || 1)),
    Math.max(1, Math.round(rect.height || canvas.clientHeight || 1)),
    Math.max(1, Number(shape?.[0] || 128)),
    Math.max(1, Number(shape?.[1] || 128)),
  );
  return canvasPointToElectrode(geom, event.clientX - rect.left, event.clientY - rect.top);
}

function matrixPaintRect() {
  const start = state.matrixPaint.start;
  const current = state.matrixPaint.current;
  const value = activeMatrixPaintValue();
  if (!start || !current || value === null) return null;
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
  renderPlanTimeline();
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

function drawMatrixOverlay(ctx, width, height, scene) {
  const status = scene.executor || {};
  const running = status.is_executing ? "running" : "idle";
  const eventType = Array.isArray(scene.plan?.current_event) ? scene.plan.current_event[1] : "";
  const frameIndex = scene.frame?.index !== null && scene.frame?.index !== undefined ? Number(scene.frame.index) : null;
  const frameLabel = Number.isFinite(frameIndex) ? frameIndex + 1 : "-";
  const frameSource = scene.frame?.source === "executor_last_applied_frame"
    ? "executed"
    : scene.frame?.source === "state"
      ? "state"
      : scene.frame?.source === "timeline_preview"
        ? "preview"
      : "plan";
  const lines = [
    `${frameSource} ${frameLabel}/${scene.frame?.count || 0}`,
    eventType ? `${running} - ${eventType}` : running,
  ];
  ctx.save();
  ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI";
  const boxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 20;
  const boxHeight = 40;
  const x = width - boxWidth - 10;
  const y = 10;
  roundedRect(ctx, x, y, boxWidth, boxHeight, 7);
  ctx.fillStyle = "rgba(15, 15, 18, 0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.stroke();
  lines.forEach((line, index) => {
    ctx.fillStyle = index === 0 ? "#f5f5f7" : "#a1a1a6";
    ctx.fillText(line, x + 10, y + 16 + index * 15);
  });
  ctx.restore();
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
}

function matrixPathRevision(scene) {
  const actions = matrixPathActions(scene);
  return [
    scene?.plan?.frame_count || "",
    scene?.plan?.event_count || "",
    scene?.plan?.scene_plan_source || "",
    actions.map((action) => `${action.id}:${action.frame_span?.join("-") || ""}:${action.paths?.length || 0}`).join("|"),
  ].join("::");
}

function matrixPathActions(scene, options = {}) {
  const actions = scene?.plan?.actions;
  if (!Array.isArray(actions)) return [];
  const includeStatic = options.includeStatic === true;
  return actions
    .map((action) => {
      if (!action || !Array.isArray(action.paths)) return null;
      const paths = action.paths.filter((pathInfo) => (
        includeStatic ? compactDisplayPath(pathInfo?.path).length > 0 : matrixPathInfoIsMoving(pathInfo)
      ));
      return paths.length ? { ...action, paths } : null;
    })
    .filter(Boolean);
}

function matrixPathInfoIsMoving(pathInfo) {
  return compactDisplayPath(pathInfo?.path).length > 1;
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
    return;
  }
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
      renderMatrixScene(matrixSceneForTimeline(state.live?.scene?.result || state.live?.scene), { skipPathPanel: true });
    });
    row.addEventListener("mouseleave", () => {
      if (state.matrixPaths.hoveredActionId === actionId) {
        state.matrixPaths.hoveredActionId = "";
        renderMatrixScene(matrixSceneForTimeline(state.live?.scene?.result || state.live?.scene), { skipPathPanel: true });
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
  const point = matrixCanvasPointFromPointerEvent(event);
  if (!point) return;
  event.preventDefault();
  canvas.setPointerCapture?.(event.pointerId);
  state.matrixSelection.dragging = true;
  state.matrixSelection.moved = false;
  state.matrixSelection.start = point;
  state.matrixSelection.current = point;
  canvas.classList.add("dragging");
}

function updateMatrixSelectionDrag(event) {
  if (!state.matrixSelection.dragging) return;
  const point = matrixCanvasPointFromPointerEvent(event);
  if (!point) return;
  const start = state.matrixSelection.start || point;
  state.matrixSelection.current = point;
  if (Math.hypot(point.x - start.x, point.y - start.y) >= 4) {
    state.matrixSelection.moved = true;
  }
  if (state.matrixSelection.moved) renderMatrixPanel(state.live || {});
}

function endMatrixSelectionDrag(event) {
  if (!state.matrixSelection.dragging) return;
  const point = matrixCanvasPointFromPointerEvent(event);
  if (point) state.matrixSelection.current = point;
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
  renderPlanTimeline();
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
      renderMatrixPanel(state.live || {});
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
  renderMatrixPanel(state.live || {});
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
    renderPlanTimeline();
    return true;
  }
  const scene = state.live?.scene?.result || state.live?.scene;
  const droplets = matrixDropletsWithOverrides(matrixSceneForTimeline(scene)?.droplets || scene?.droplets || []);
  const preview = matrixMovePreviewState(scene, droplets);
  if (!preview || !preview.changed) return false;
  if (!preview.valid) {
    state.matrixCommands.lastError = preview.reason || "Invalid droplet preview";
    renderMatrixCommandPanel();
    renderPlanTimeline();
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
  renderPlanTimeline();
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
  const hit = [...state.matrixSceneHitboxes].reverse().find((box) => matrixHitboxContains(box, point));
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
  renderPlanTimeline();
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
  const hit = [...state.matrixSceneHitboxes].reverse().find((box) => matrixHitboxContains(box, point));
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
  send({
    type: "mcp_tool",
    tool: "move_stage",
    arguments: {
      position,
      wait_timeout_seconds: 20,
      poll_interval: 0.1,
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
      renderPlanTimeline();
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
  const hit = [...state.matrixSceneHitboxes].reverse().find((box) => matrixHitboxContains(box, hover));
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

function matrixHitboxContains(box, point) {
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

function updateTemperatureHistory(live) {
  const value = live?.state?.value || live?.state?.result?.value || live?.state;
  const temp = extractTemperature(value);
  const target = extractTemperatureTarget(value);
  const label = $("temperatureValue");
  if (label) label.textContent = Number.isFinite(temp) ? `${temp.toFixed(1)} C` : "-";
  const targetLabel = $("temperatureTarget");
  if (targetLabel && !targetLabel.closest(".temperature-readout")?.classList.contains("editing")) {
    targetLabel.textContent = Number.isFinite(target) ? `target ${target.toFixed(1)} C` : "target -";
  }
  if (!Number.isFinite(temp)) return;

  const last = state.temperatureSamples[state.temperatureSamples.length - 1];
  const now = Date.now();
  if (!last || now - last.t > 900 || Math.abs(last.value - temp) > 0.02) {
    state.temperatureSamples.push({ t: now, value: temp });
    if (state.temperatureSamples.length > 180) {
      state.temperatureSamples.splice(0, state.temperatureSamples.length - 180);
    }
  }
}

function extractTemperatureTarget(root) {
  const candidates = [
    getPath(root, "temperature.target"),
    getPath(root, "temperature.target_c"),
    getPath(root, "temperature.target_temperature"),
    getPath(root, "temperature.setpoint"),
    getPath(root, "temperature.setpoint_c"),
  ];
  const temperature = getPath(root, "temperature");
  if (temperature && typeof temperature === "object") {
    for (const [key, value] of Object.entries(temperature)) {
      if (/target|setpoint/i.test(key) && typeof value === "number") candidates.push(value);
    }
  }
  return candidates.find((value) => Number.isFinite(value));
}

function compactStatePanel() {
  const panel = document.querySelector(".state-panel");
  const grid = $("stateGrid");
  if (!panel || !grid) return;
  panel.classList.remove("state-tight", "state-ultra-tight");
  if (grid.scrollHeight > grid.clientHeight) panel.classList.add("state-tight");
  if (grid.scrollHeight > grid.clientHeight) panel.classList.add("state-ultra-tight");
}

function renderTemperatureChart() {
  const canvas = $("temperatureChart");
  if (!canvas) return;
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#151519";
  ctx.fillRect(0, 0, width, height);

  const samples = state.temperatureSamples;
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
  return candidates.find((value) => Number.isFinite(value));
}

function formatTemperatureSummary(root, options = {}) {
  const temp = extractTemperature(root);
  const target = firstFinite([
    getPath(root, "temperature.target"),
    getPath(root, "temperature.target_c"),
    getPath(root, "temperature.target_temperature"),
  ]);
  const parts = [];
  if (Number.isFinite(temp)) parts.push(options.compact ? `${temp.toFixed(2)} C` : `current ${temp.toFixed(2)} C`);
  if (Number.isFinite(target)) parts.push(options.compact ? `target ${target.toFixed(2)}` : `target ${target.toFixed(2)} C`);
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
