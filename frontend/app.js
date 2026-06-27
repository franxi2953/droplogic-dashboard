const state = {
  ws: null,
  events: [],
  status: null,
  live: null,
  agentBusy: false,
  runs: [],
  runsOpen: false,
  selectedRunId: "",
  forceConversationRender: false,
  selectedRuns: new Set(),
  namingRuns: new Set(),
  temperatureSamples: [],
  temperatureHover: null,
  tokenChartHover: null,
  contextHistogramHover: null,
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
};

const TYPEWRITER_INTERVAL_MS = 11;
const TYPEWRITER_CHARS_PER_TICK = 4;

const $ = (id) => document.getElementById(id);

function appendEvent(event, options = {}) {
  const key = eventKey(event);
  if (state.events.some((item) => eventKey(item) === key)) return;
  state.events.push(event);
  if ((event.type === "context_compacted" || event.type === "context_ai_summary") && options.replay !== true) {
    state.compactingUntil = Date.now() + 2600;
  }
  if (options.liveAgent === true) scheduleTypewriter(event);
  render();
}

function eventKey(event) {
  return `${event.t || ""}|${event.type || ""}|${event.tool || ""}|${event.text || event.prompt || event.message || event.error || ""}`;
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
    askButton.textContent = state.agentBusy ? "Steer" : "Ask Agent";
  }
  const stopButton = $("stopAgent");
  if (stopButton) stopButton.disabled = !state.agentBusy;
  const cancelButton = $("cancelAgent");
  if (cancelButton) cancelButton.disabled = !state.agentBusy;
  renderLive();
  renderConversation();
  updateJumpToBottomButton();
  renderRuns();
  compactStatePanel();
  renderTokenAnalytics();
  updateCopyOutputButton();
  updateThinkingOverlay();
  updateRetryStrip();

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
  if (event.type === "agent_provider_retry") return "provider retry";
  if (event.type === "agent_finished") return "agent";
  if (event.type === "agent_message") return "agent";
  if (event.type === "mcp_tool_call") return `tool call: ${event.tool}`;
  if (event.type === "mcp_tool_result") return `tool result: ${event.tool}`;
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
  const chars = Number(event.model_output_chars ?? estimateToolResultChars(event));
  if (!Number.isFinite(chars) || chars <= 0) return null;
  const tokens = Number(event.estimated_model_output_tokens ?? Math.ceil(chars / 4));
  const nextMetrics = nextModelRequestMetricsForToolResult(event);
  const contextTokens = nextMetrics ? contextTokensForMetrics(nextMetrics) : null;
  const estimatedContext = nextMetrics ? isEstimatedContextMetrics(nextMetrics) : true;
  const badge = document.createElement("span");
  badge.className = "tool-context-badge";
  if (Number.isFinite(contextTokens)) {
    badge.classList.add("with-context");
    badge.innerHTML = `<span>ctx: ${formatTokenCount(contextTokens)} tk${estimatedContext ? "~" : ""}</span><span>out: ${formatTokenCount(tokens)} tk~</span>`;
    badge.title = [
      `${formatCompactNumber(chars)} tool output`,
      `Included in following model request payload: ${formatContextMetricsTitle(nextMetrics)}`,
      "The context graph counts that following model request once, not once per tool.",
    ].join("\n");
  } else {
    badge.textContent = `out: ${formatTokenCount(tokens)} tk~`;
    badge.title = `${formatCompactNumber(chars)} tool output; waiting for the next model request/retry to know the attached ctx size`;
  }
  return badge;
}

function estimateToolResultChars(event) {
  try {
    return JSON.stringify(event.result ?? event.error ?? "").length;
  } catch {
    return String(event.result ?? event.error ?? "").length;
  }
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
  };
  state.ws.onclose = () => {
    appendEvent({ ts: new Date().toISOString(), type: "ui_disconnected", level: "warning" });
    setTimeout(connect, 1000);
  };
  state.ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.type === "status") {
      state.status = data.status;
      if (data.status?.run_id) state.selectedRunId = data.status.run_id;
      state.agentBusy = Boolean(data.status?.agent_busy);
      render();
    } else if (data.type === "event") {
      if (data.event?.type === "agent_started") state.agentBusy = true;
      if (data.event?.type === "agent_finished") state.agentBusy = false;
      appendEvent(data.event, {
        replay: Boolean(data.replay),
        liveAgent: !data.replay && isTypewriterEvent(data.event),
      });
    } else if (data.type === "live") {
      state.live = data.live;
      renderLiveOnly();
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
  $("startMcp").onclick = () => send({ type: "start_mcp" });
  $("stopMcp").onclick = () => send({ type: "stop_mcp" });
  $("statusBtn").onclick = () => send({ type: "mcp_tool", tool: "runtime_status", arguments: {} });
  $("downloadStreamer").onclick = () => downloadVisualizerFrame("streamer");
  $("downloadMatrix").onclick = () => downloadVisualizerFrame("matrix");
  $("runsBtn").onclick = () => {
    state.runsOpen = true;
    send({ type: "list_runs" });
    renderRuns();
  };
  document.addEventListener("pointerdown", (event) => {
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
  $("stopAgent").onclick = () => stopAgent();
  $("cancelAgent").onclick = () => stopAgent();
  $("jumpToBottom").onclick = () => jumpConversationToLatest();
  $("conversation").addEventListener("scroll", () => {
    state.conversationAtLatest = isConversationAtLatest();
    updateJumpToBottomButton();
  });
  $("filtersToggle").onclick = () => toggleFilters();
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
  connect();
  renderFilters();
});

window.addEventListener("resize", () => {
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
  const overlay = $("thinkingOverlay");
  if (!overlay) return;
  const compacting = Date.now() < state.compactingUntil;
  const visible = state.agentBusy || compacting;
  overlay.classList.toggle("visible", visible);
  overlay.classList.toggle("compacting", compacting);
  if (!visible) {
    stopThinkingAnimation();
    overlay.textContent = "Thinking";
    return;
  }
  if (state.thinkingTimer === null) {
    state.thinkingTimer = window.setInterval(() => {
      state.thinkingTick = (state.thinkingTick + 1) % 4;
      const node = $("thinkingOverlay");
      if (node) {
        const label = Date.now() < state.compactingUntil ? "Compacting context" : "Thinking";
        node.textContent = `${label}${".".repeat(state.thinkingTick)}`;
        node.classList.toggle("compacting", Date.now() < state.compactingUntil);
      }
      if (!state.agentBusy && Date.now() >= state.compactingUntil) updateThinkingOverlay();
    }, 420);
  }
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
  const live = state.live || {};
  renderFrame("matrix", live.frames?.matrix);
  renderFrame("streamer", live.frames?.streamer);
  updateTemperatureHistory(live);
  renderStateGrid(live);
  renderTemperatureChart();
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
    meta.textContent = `${payload.frame_source || "frame"} ${shape}`;
  } else {
    img.removeAttribute("src");
    viewer.classList.remove("has-frame");
    meta.textContent = frame?.error || "waiting";
  }
}

function downloadVisualizerFrame(visualizer) {
  const button = visualizer === "streamer" ? $("downloadStreamer") : $("downloadMatrix");
  if (button) button.classList.add("busy");
  send({
    type: "download_visualizer_frame",
    visualizer,
    frame_source: "snapshot",
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
  const link = document.createElement("a");
  link.href = `data:${mime};base64,${frame.base64}`;
  link.download = `${visualizer}_${timestampForFilename()}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function renderStateGrid(live) {
  const container = $("stateGrid");
  if (!container) return;
  container.innerHTML = "";

  const value = live?.state?.value || live?.state?.result?.value || live?.state;
  const rows = [
    {
      kind: "stage",
      label: "Stage",
      content: renderStageCard(getPath(value, "xy_stage")),
      span: true,
    },
    {
      kind: "microscope",
      label: "Scope",
      content: renderImagingCard(getPath(value, "microscope_settings"), "Microscope"),
    },
    {
      kind: "camera",
      label: "Camera",
      content: renderImagingCard(getPath(value, "camera_settings"), "Camera"),
    },
    {
      kind: "light",
      label: "Light",
      content: renderLightCard(getPath(value, "light_settings")),
    },
  ];

  for (const { kind, label, content, span: wide } of rows) {
    const card = document.createElement("div");
    card.className = "state-card";
    card.dataset.kind = kind;
    if (wide) card.classList.add("wide");
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const body = document.createElement("div");
    body.className = "state-card-body";
    if (content instanceof Node) body.appendChild(content);
    else body.textContent = content || "-";
    card.append(labelNode, body);
    container.appendChild(card);
  }
}

function updateTemperatureHistory(live) {
  const value = live?.state?.value || live?.state?.result?.value || live?.state;
  const temp = extractTemperature(value);
  const target = extractTemperatureTarget(value);
  const label = $("temperatureValue");
  if (label) label.textContent = Number.isFinite(temp) ? `${temp.toFixed(1)} C` : "-";
  const targetLabel = $("temperatureTarget");
  if (targetLabel) targetLabel.textContent = Number.isFinite(target) ? `target ${target.toFixed(1)} C` : "target -";
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

function renderStageCard(stage) {
  const position = stage?.position || {};
  const motion = stage?.motion_params || {};
  const wrapper = document.createElement("div");
  wrapper.className = "instrument-block";
  wrapper.appendChild(metricGrid([
    ["X", position.X],
    ["Y", position.Y],
    ["Z", position.Z],
  ]));
  wrapper.appendChild(metricGrid([
    ["dMaxV", motion.dMaxV],
    ["dMaxA", motion.dMaxA],
    ["Jerk", motion.dJerk],
  ], "secondary"));
  return wrapper;
}

function renderImagingCard(settings, title) {
  const exposure = firstDefined(settings?.exposure_time, settings?.ExposureTime, settings?.exposure);
  const gain = firstDefined(settings?.gain, settings?.analog_gain, settings?.AnalogGain);
  const channel = firstDefined(settings?.current_channel, settings?.channel);
  return metricGrid([
    ["Exp", formatExposure(exposure)],
    ["Gain", formatValue(gain)],
    ...(channel !== undefined ? [["Ch", channel]] : []),
  ], "compact");
}

function renderLightCard(settings) {
  return metricGrid([
    ["Coax", settings?.coaxial_intensity],
    ["Ring", settings?.ring_intensity],
  ], "compact");
}

function metricGrid(items, variant = "") {
  const grid = document.createElement("div");
  grid.className = `metric-grid ${variant}`.trim();
  for (const [label, value] of items) {
    const item = document.createElement("div");
    item.className = "metric";
    const labelEl = document.createElement("span");
    labelEl.className = "metric-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("strong");
    valueEl.className = "metric-value";
    valueEl.textContent = formatValue(value);
    item.append(labelEl, valueEl);
    grid.appendChild(item);
  }
  return grid;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function formatExposure(value) {
  if (!Number.isFinite(value)) return formatValue(value);
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)} s`;
  return `${Math.round(value)} us`;
}

function formatValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "-";
    return Math.abs(value) >= 1000 ? String(Math.round(value)) : String(value);
  }
  return String(value);
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

