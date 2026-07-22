let activeMetricEdit = null;
let pendingMetricEdit = null;
let lastStateGridRenderKey = "";
let pendingStreamerSource = "";
let pendingStreamerSourceAt = 0;

const STAGE_SPEED_PRESETS = {
  slow: { label: "Slow", velocity: 1000, acceleration: 10000 },
  medium: { label: "Medium", velocity: 5000, acceleration: 100000 },
  fast: { label: "Fast", velocity: 10000, acceleration: 1000000 },
};

document.addEventListener("pointerdown", (event) => {
  if (!activeMetricEdit) return;
  if (activeMetricEdit.item?.contains?.(event.target)) return;
  activeMetricEdit.close(false);
});

function renderStateGrid(live) {
  const container = $("stateGrid");
  if (!container) return;
  if (container.querySelector(".metric.editing")) return;
  resolvePendingMetricEditFromLive(live);
  syncPendingStreamerSource(live);
  const renderKey = stateGridRenderKey(live);
  if (renderKey === lastStateGridRenderKey && container.childElementCount > 0) return;
  lastStateGridRenderKey = renderKey;
  container.innerHTML = "";

  const value = live?.state?.value || live?.state?.result?.value || live?.state;
  const streamerStatus = streamerStatusFromLive(live);
  const queueSummary = queueSummaryFromLive(live);
  const rows = [
    {
      kind: "streamer",
      label: "Streamer",
      content: renderStreamerSourceCard(streamerStatus),
    },
    {
      kind: "queues",
      label: "Queues",
      content: renderQueueCard(queueSummary),
    },
    {
      kind: "stage",
      label: "Stage",
      content: renderStageCard(getPath(value, "xy_stage")),
      span: true,
    },
    {
      kind: "matrix",
      label: "Matrix",
      content: renderMatrixCard(getPath(value, "electrode_matrix")),
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

function stateGridRenderKey(live) {
  const value = live?.state?.value || live?.state?.result?.value || live?.state || {};
  const stage = getPath(value, "xy_stage") || {};
  const matrix = getPath(value, "electrode_matrix") || {};
  const matrixSummary = matrix?.matrix && typeof matrix.matrix === "object" ? matrix.matrix : {};
  const microscope = getPath(value, "microscope_settings") || {};
  const camera = getPath(value, "camera_settings") || {};
  const light = getPath(value, "light_settings") || {};
  const streamer = streamerStatusFromLive(live);
  const queues = queueSummaryFromLive(live);
  return JSON.stringify({
    pending: pendingMetricEdit ? `${pendingMetricEdit.kind}:${pendingMetricEdit.field || pendingMetricEdit.axis || ""}:${pendingMetricEdit.value}` : "",
    streamer: {
      source: streamerSourceFromStatus(streamer),
      device: streamer?.device,
      raw: streamer?.raw_frame_buffered,
      processed: streamer?.processed_frame_buffered,
      pending: pendingStreamerSource,
    },
    queues,
    stage: {
      position: stage.position || {},
      motion: stage.motion_params || {},
    },
    matrix: {
      active: firstDefined(matrixSummary.active_count, matrixSummary.active_electrode_count, matrix?.active_count),
      shape: matrixShapeDisplay(matrix, matrixSummary),
      voltages: matrixVoltageBoxValues(matrix, 9),
    },
    microscope: {
      channel: firstDefined(microscope.current_channel, microscope.channel),
      exposure: firstDefined(microscope.exposure_time, microscope.ExposureTime, microscope.exposure),
      gain: firstDefined(microscope.gain, microscope.analog_gain, microscope.AnalogGain),
    },
    camera: {
      exposure: firstDefined(camera.exposure_time, camera.ExposureTime, camera.exposure),
      gain: firstDefined(camera.gain, camera.analog_gain, camera.AnalogGain),
    },
    light: {
      coaxial: firstDefined(light.coaxial_intensity, light.coaxial, light.coaxial_light),
      ring: firstDefined(light.ring_intensity, light.ring, light.ring_light),
      on: firstDefined(light.light_on, light.enabled, light.on),
    },
  });
}

function queueSummaryFromLive(live = state.live) {
  const runtime = live?.runtime || {};
  const roots = [
    runtime,
    runtime?.result,
    runtime?.value,
    getPath(runtime, "structuredContent.result"),
  ];
  for (const root of roots) {
    const summary = root?.system?.queue_summary;
    if (summary && typeof summary === "object") return summary;
  }
  return { pending_commands: null, queues: {} };
}

function renderQueueCard(summary) {
  const queues = summary?.queues && typeof summary.queues === "object" ? summary.queues : {};
  const priorities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const items = priorities.map((priority) => {
    const queue = queues[priority] || {};
    const pending = firstDefined(queue.pending_commands, queue.unfinished_tasks, queue.queue_size);
    return [priority.slice(0, 4), Number.isFinite(Number(pending)) ? Math.max(0, Number(pending)) : "-"];
  });
  return metricGrid(items, "queue-summary");
}

function streamerStatusFromLive(live = state.live) {
  const visualizers = live?.visualizers?.result
    || live?.visualizers?.value
    || live?.visualizers
    || {};
  const candidates = [
    visualizers.streamer,
    getPath(visualizers, "result.streamer"),
    getPath(visualizers, "structuredContent.result.streamer"),
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || {};
}

function streamerSourceFromStatus(status = streamerStatusFromLive()) {
  const source = String(status?.source || "").trim().toLowerCase();
  if (source === "microscope" || source === "camera") return source;
  const device = String(status?.device || "").toLowerCase();
  if (device.includes("microscope")) return "microscope";
  if (device.includes("camera")) return "camera";
  return "";
}

function streamerSourceLabel(source) {
  if (source === "microscope") return "Microscope";
  if (source === "camera") return "Camera";
  return "Unknown";
}

function renderStreamerSourceCard(status) {
  const source = streamerSourceFromStatus(status);
  const grid = metricGrid([
    ["Source", streamerSourceLabel(source)],
    ["Device", status?.device || "-"],
    ["Raw", status?.raw_frame_buffered ? "yes" : "no"],
    ["Proc", status?.processed_frame_buffered ? "yes" : "no"],
  ], "streamer-source");
  const sourceMetric = grid.querySelector(".metric");
  const value = sourceMetric?.querySelector(".metric-value");
  if (!sourceMetric || !value) return grid;

  const select = document.createElement("select");
  const selectedSource = pendingStreamerSource || source;
  select.className = "streamer-source-select";
  select.disabled = Boolean(pendingStreamerSource);
  select.title = pendingStreamerSource
    ? `Switching to ${streamerSourceLabel(pendingStreamerSource)}`
    : "Select the streamer source";
  for (const option of [
    { value: "", label: "Unknown", disabled: true },
    { value: "microscope", label: "Microscope" },
    { value: "camera", label: "Camera" },
  ]) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    node.disabled = Boolean(option.disabled);
    select.appendChild(node);
  }
  select.value = selectedSource;
  select.addEventListener("change", () => selectStreamerSource(select.value));
  value.replaceChildren(select);
  return grid;
}

function syncPendingStreamerSource(live = state.live) {
  const status = streamerStatusFromLive(live);
  const source = streamerSourceFromStatus(status);
  if (pendingStreamerSource && source === pendingStreamerSource) {
    pendingStreamerSource = "";
    pendingStreamerSourceAt = 0;
  }
  if (pendingStreamerSource && Date.now() - Number(pendingStreamerSourceAt || 0) > 12000) {
    pendingStreamerSource = "";
    pendingStreamerSourceAt = 0;
  }
}

function selectStreamerSource(target) {
  if (target !== "camera" && target !== "microscope") return;
  const source = streamerSourceFromStatus(streamerStatusFromLive(state.live));
  if (target === source) return;
  pendingStreamerSource = target;
  pendingStreamerSourceAt = Date.now();
  renderStateGrid(state.live || {});
  send({
    type: "mcp_tool",
    tool: "set_streamer_source",
    arguments: {
      source: target,
      electrode_overlay: target === "microscope",
      coordinates: false,
      bring_to_front: false,
    },
  });
}

function renderStageCard(stage) {
  const position = stage?.position || {};
  const motion = stage?.motion_params || {};
  const wrapper = document.createElement("div");
  wrapper.className = "instrument-block";
  wrapper.appendChild(metricGrid([
    editableMetric("X", position.X, { kind: "stage", axis: "X", input: "number" }),
    editableMetric("Y", position.Y, { kind: "stage", axis: "Y", input: "number" }),
    editableMetric("Z", position.Z, { kind: "stage", axis: "Z", input: "number" }),
  ]));
  const speedKey = stageSpeedKeyFromMotion(motion);
  const speedOptions = Object.entries(STAGE_SPEED_PRESETS).map(([value, preset]) => ({
    value,
    label: preset.label,
  }));
  if (!speedKey) speedOptions.unshift({ value: "custom", label: "Custom" });
  wrapper.appendChild(metricGrid([
    editableMetric("Speed", speedKey || "custom", {
      kind: "stage_speed",
      field: "speed",
      input: "select",
      display: stageSpeedDisplay(motion),
      options: speedOptions,
    }),
    ["dMaxV", motion.dMaxV],
    ["dMaxA", motion.dMaxA],
    ["Jerk", motion.dJerk],
  ], "secondary stage-speed"));
  return wrapper;
}

function stageSpeedKeyFromMotion(motion = {}) {
  const velocity = Number(motion?.dMaxV);
  const acceleration = Number(motion?.dMaxA);
  if (!Number.isFinite(velocity) || !Number.isFinite(acceleration)) return "";
  for (const [key, preset] of Object.entries(STAGE_SPEED_PRESETS)) {
    if (
      Math.abs(velocity - preset.velocity) <= 1
      && Math.abs(acceleration - preset.acceleration) <= 1
    ) {
      return key;
    }
  }
  return "";
}

function stageSpeedDisplay(motion = {}) {
  const key = stageSpeedKeyFromMotion(motion);
  if (key && STAGE_SPEED_PRESETS[key]) return STAGE_SPEED_PRESETS[key].label;
  return "Custom";
}

function renderImagingCard(settings, title) {
  const exposure = firstDefined(settings?.exposure_time, settings?.ExposureTime, settings?.exposure);
  const gain = firstDefined(settings?.gain, settings?.analog_gain, settings?.AnalogGain);
  const channel = firstDefined(settings?.current_channel, settings?.channel);
  const kind = title === "Camera" ? "camera" : "microscope";
  const canEdit = title === "Microscope" || title === "Camera";
  const items = [
    canEdit
      ? editableMetric("Exp", exposure, {
        kind,
        field: "exposure_time",
        input: "number",
        min: 1,
        step: 1000,
        display: formatExposure(exposure),
      })
      : { label: "Exp", value: exposure, display: formatExposure(exposure) },
    canEdit
      ? editableMetric("Gain", gain, {
        kind,
        field: "gain",
        input: "number",
        min: 0,
        step: 1,
      })
      : ["Gain", gain],
  ];
  if (channel !== undefined) {
    items.push(canEdit && kind === "microscope"
      ? editableMetric("Ch", channel, { kind: "microscope", field: "channel", input: "text" })
      : ["Ch", channel]);
  }
  return metricGrid(items, "compact");
}

function renderLightCard(settings) {
  return metricGrid([
    editableMetric("Coax", settings?.coaxial_intensity, {
      kind: "light",
      field: "coaxial_intensity",
      input: "number",
      min: 0,
      max: 99,
      step: 1,
    }),
    editableMetric("Ring", settings?.ring_intensity, {
      kind: "light",
      field: "ring_intensity",
      input: "number",
      min: 0,
      max: 99,
      step: 1,
    }),
    editableMetric("On", settings?.light_on, {
      kind: "light",
      field: "light_on",
      input: "select",
      options: [
        { value: "on", label: "on" },
        { value: "off", label: "off" },
      ],
    }),
  ], "compact");
}

function renderMatrixCard(matrix) {
  const matrixSummary = matrix?.matrix && typeof matrix.matrix === "object" ? matrix.matrix : {};
  const shape = matrixShapeDisplay(matrix, matrixSummary);
  const active = firstDefined(matrixSummary.active_count, matrixSummary.active_electrode_count, matrix?.active_count);
  const wrapper = document.createElement("div");
  wrapper.className = "instrument-block matrix-block";
  wrapper.appendChild(metricGrid([
    ["Active", active],
    ["Shape", shape],
  ], "matrix-summary"));
  wrapper.appendChild(renderMatrixVoltageGrid(matrix));
  return wrapper;
}

function matrixShapeDisplay(matrix, matrixSummary = {}) {
  const shape = firstDefined(
    matrixSummary.shape,
    matrix?.shape,
    matrix?.rows !== undefined && matrix?.columns !== undefined ? [matrix.rows, matrix.columns] : undefined,
  );
  return Array.isArray(shape) ? shape.join("x") : shape;
}

function matrixVoltageDisplay(matrix = {}) {
  const status = matrix?.voltage_status && typeof matrix.voltage_status === "object"
    ? matrix.voltage_status
    : {};
  if (status.display) return status.display;
  const values = normalizeVoltageValues(firstDefined(status.values, matrix.initial_voltages, matrix.voltages, matrix.voltage));
  if (!values.length) return formatValue(firstDefined(status.voltage, matrix.voltage));
  const allEqual = values.every((value) => value === values[0]);
  if (allEqual) return `${values[0]} V x${values.length}`;
  return `${values.join("/")} V`;
}

function renderMatrixVoltageGrid(matrix = {}) {
  const values = matrixVoltageBoxValues(matrix, 9);
  const items = values.map((value, index) => ({
    label: `V${index + 1}`,
    value,
    display: Number.isFinite(value) ? `${value}V` : "-",
  }));
  const grid = metricGrid(items, "matrix-voltage-boxes");
  grid.title = matrixVoltageDisplay(matrix);
  return grid;
}

function matrixVoltageBoxValues(matrix = {}, count = 9) {
  const status = matrix?.voltage_status && typeof matrix.voltage_status === "object"
    ? matrix.voltage_status
    : {};
  let values = normalizeVoltageValues(firstDefined(status.values, matrix.initial_voltages, matrix.voltages));
  if (!values.length) values = normalizeVoltageValues(firstDefined(status.voltage, matrix.voltage));
  if (values.length === 1 && count > 1) values = Array(count).fill(values[0]);
  const result = values.slice(0, count);
  while (result.length < count) result.push(null);
  return result;
}

function normalizeVoltageValues(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
      .map((item) => Math.round(item));
  }
  const number = Number(value);
  return Number.isFinite(number) ? [Math.round(number)] : [];
}

function editableMetric(label, value, editor) {
  return {
    label,
    value,
    display: editor?.display,
    editor: {
      ...editor,
      label,
      value,
    },
  };
}

function metricGrid(items, variant = "") {
  const grid = document.createElement("div");
  grid.className = `metric-grid ${variant}`.trim();
  for (const rawItem of items) {
    const spec = normalizeMetricItem(rawItem);
    const item = document.createElement("div");
    item.className = "metric";
    const pending = pendingMetricEdit && pendingMetricEdit.key === metricEditorKey(spec.editor);
    if (spec.editor) {
      item.classList.add("editable-metric");
      if (pendingMetricEdit) {
        item.classList.add(pending ? "pending" : "disabled");
        item.title = pending ? "Updating" : "Waiting for previous update";
      } else {
        item.tabIndex = 0;
        item.title = "Edit";
      }
    }

    const labelEl = document.createElement("span");
    labelEl.className = "metric-label";
    labelEl.textContent = spec.label;
    const valueEl = document.createElement("strong");
    valueEl.className = "metric-value";
    if (pending) {
      valueEl.replaceChildren(metricSpinnerNode());
    } else {
      valueEl.textContent = metricValueText(spec);
    }
    item.append(labelEl, valueEl);

    if (spec.editor && !pendingMetricEdit) {
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        beginMetricEdit(spec, item, valueEl);
      });
      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        beginMetricEdit(spec, item, valueEl);
      });
    }

    grid.appendChild(item);
  }
  return grid;
}

function normalizeMetricItem(item) {
  if (Array.isArray(item)) return { label: item[0], value: item[1] };
  return item || { label: "", value: "" };
}

function metricValueText(spec) {
  if (spec.display !== undefined && spec.display !== null) return String(spec.display);
  return formatValue(spec.value);
}

function beginMetricEdit(spec, item, valueEl) {
  if (pendingMetricEdit) return;
  if (!spec.editor || item.classList.contains("editing")) return;
  if (activeMetricEdit) activeMetricEdit.close(false);
  item.classList.add("editing");
  const editor = spec.editor;
  const control = createMetricEditor(editor);
  const shell = document.createElement("span");
  shell.className = "metric-edit-shell";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "metric-edit-button apply";
  apply.textContent = "OK";
  apply.title = "Apply";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "metric-edit-button cancel";
  cancel.textContent = "x";
  cancel.title = "Cancel";
  shell.append(control, apply, cancel);
  valueEl.replaceChildren(shell);

  let closed = false;
  const close = (commit) => {
    if (closed) return;
    closed = true;
    item.classList.remove("editing");
    if (activeMetricEdit?.item === item) activeMetricEdit = null;
    if (commit) {
      const result = commitMetricEdit(editor, control.value);
      if (result?.ok && result.pending) {
        pendingMetricEdit = {
          ...result.pending,
          display: result.display,
          startedAt: Date.now(),
        };
        valueEl.replaceChildren(metricSpinnerNode());
        renderStateGrid(state.live || {});
      } else {
        valueEl.textContent = result?.ok ? result.display : metricValueText(spec);
      }
    } else {
      valueEl.textContent = metricValueText(spec);
    }
  };
  activeMetricEdit = { item, close };

  shell.addEventListener("click", (event) => event.stopPropagation());
  shell.addEventListener("pointerdown", (event) => event.stopPropagation());
  control.addEventListener("click", (event) => event.stopPropagation());
  control.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(false);
    }
  });
  apply.addEventListener("click", (event) => {
    event.stopPropagation();
    close(true);
  });
  cancel.addEventListener("click", (event) => {
    event.stopPropagation();
    close(false);
  });
  requestAnimationFrame(() => {
    control.focus();
    if (typeof control.select === "function") control.select();
  });
}

function metricSpinnerNode() {
  const spinner = document.createElement("span");
  spinner.className = "metric-spinner";
  spinner.setAttribute("aria-label", "Updating");
  return spinner;
}

function createMetricEditor(editor) {
  if (editor.input === "select") {
    const select = document.createElement("select");
    select.className = "metric-editor";
    const current = editor.field === "light_on" ? (editor.value === false ? "off" : "on") : String(editor.value ?? "");
    for (const option of editor.options || []) {
      const node = document.createElement("option");
      node.value = String(option.value);
      node.textContent = option.label ?? option.value;
      select.appendChild(node);
    }
    select.value = current;
    return select;
  }

  const input = document.createElement("input");
  input.className = "metric-editor";
  input.type = editor.input === "number" ? "number" : "text";
  if (editor.step !== undefined) input.step = String(editor.step);
  if (editor.min !== undefined) input.min = String(editor.min);
  if (editor.max !== undefined) input.max = String(editor.max);
  input.value = editor.value ?? "";
  return input;
}

function commitMetricEdit(editor, rawValue) {
  if (editor.kind === "stage") return commitStageMetric(editor, rawValue);
  if (editor.kind === "stage_speed") return commitStageSpeedMetric(editor, rawValue);
  if (editor.kind === "light") return commitLightMetric(editor, rawValue);
  if (editor.kind === "microscope") return commitMicroscopeMetric(editor, rawValue);
  if (editor.kind === "camera") return commitCameraMetric(editor, rawValue);
  if (editor.kind === "temperature") return commitTemperatureMetric(editor, rawValue);
  return { ok: false };
}

function commitStageMetric(editor, rawValue) {
  const value = parseMetricNumber(rawValue, editor.label);
  if (value === null) return { ok: false };
  const current = currentStagePosition() || {};
  const next = {
    X: editor.axis === "X" ? value : Number(current.X),
    Y: editor.axis === "Y" ? value : Number(current.Y),
  };
  const currentZ = Number(current.Z);
  if (editor.axis === "Z") next.Z = value;
  else if (Number.isFinite(currentZ)) next.Z = Math.trunc(currentZ);
  if (!Number.isFinite(next.X) || !Number.isFinite(next.Y)) {
    appendStateEditError("Stage needs current X and Y before editing one axis.");
    return { ok: false };
  }
  if (typeof beginStageMotionFromCommand === "function") {
    beginStageMotionFromCommand({
      position: {
        X: Math.trunc(next.X),
        Y: Math.trunc(next.Y),
        ...(Number.isFinite(next.Z) ? { Z: Math.trunc(next.Z) } : {}),
      },
      source: "state_edit",
      wait_timeout_seconds: 20,
    });
  }
  send({
    type: "mcp_tool",
    tool: "move_stage",
    arguments: {
      position: {
        X: Math.trunc(next.X),
        Y: Math.trunc(next.Y),
        ...(Number.isFinite(next.Z) ? { Z: Math.trunc(next.Z) } : {}),
      },
      wait_timeout_seconds: 20,
      poll_interval: 0.1,
      wait_for_queue: false,
      wait_for_completion: false,
    },
  });
  return {
    ok: true,
    display: String(Math.trunc(value)),
    pending: {
      key: metricEditorKey(editor),
      expected: { kind: "stage", axis: editor.axis, value: Math.trunc(value) },
    },
  };
}

function commitStageSpeedMetric(editor, rawValue) {
  const key = String(rawValue || "").trim().toLowerCase();
  if (key === "custom") return { ok: true, display: "Custom" };
  const preset = STAGE_SPEED_PRESETS[key];
  if (!preset) {
    appendStateEditError("Stage speed needs Slow, Medium, or Fast.");
    return { ok: false };
  }
  send({
    type: "mcp_tool",
    tool: "set_stage_motion_speed",
    arguments: {
      speed_key: key,
    },
  });
  return {
    ok: true,
    display: preset.label,
    pending: {
      key: metricEditorKey(editor),
      expected: {
        kind: "stage_speed",
        velocity: preset.velocity,
        acceleration: preset.acceleration,
      },
    },
  };
}

function commitLightMetric(editor, rawValue) {
  const settings = getPath(currentLiveState(), "light_settings") || {};
  let coaxial = boundedInteger(settings.coaxial_intensity ?? 0, 0, 99);
  let ring = boundedInteger(settings.ring_intensity ?? 0, 0, 99);
  let lightOn = settings.light_on !== false;

  if (editor.field === "light_on") {
    const parsed = parseMetricBoolean(rawValue);
    if (parsed === null) {
      appendStateEditError("Light on/off needs on or off.");
      return { ok: false };
    }
    lightOn = parsed;
  } else {
    const value = parseMetricNumber(rawValue, editor.label, editor);
    if (value === null) return { ok: false };
    if (editor.field === "coaxial_intensity") coaxial = value;
    if (editor.field === "ring_intensity") ring = value;
    lightOn = coaxial > 0 || ring > 0;
  }

  send({
    type: "mcp_tool",
    tool: "set_light_state",
    arguments: {
      light_on: lightOn,
      coaxial_intensity: coaxial,
      ring_intensity: ring,
      wait_for_queue: true,
      queue_timeout_seconds: 10,
    },
  });
  return {
    ok: true,
    display: editor.field === "light_on" ? formatValue(lightOn) : String(editor.field === "coaxial_intensity" ? coaxial : ring),
    pending: {
      key: metricEditorKey(editor),
      expected: {
        kind: "light",
        field: editor.field,
        light_on: lightOn,
        coaxial_intensity: coaxial,
        ring_intensity: ring,
      },
    },
  };
}

function commitMicroscopeMetric(editor, rawValue) {
  const root = currentLiveState();
  const settings = getPath(root, "microscope_settings") || {};
  const light = getPath(root, "light_settings") || {};
  const next = {
    channel: String(firstDefined(settings.current_channel, settings.channel, "Brightfield")),
    exposure_time: boundedInteger(firstDefined(settings.exposure_time, settings.ExposureTime, settings.exposure, 72000), 1, Number.MAX_SAFE_INTEGER),
    gain: boundedInteger(firstDefined(settings.gain, settings.analog_gain, settings.AnalogGain, 0), 0, Number.MAX_SAFE_INTEGER),
    coaxial_intensity: boundedInteger(light.coaxial_intensity ?? 4, 0, 99),
    ring_intensity: boundedInteger(light.ring_intensity ?? 0, 0, 99),
    auto_exposure: Boolean(settings.auto_exposure),
  };

  if (editor.field === "channel") {
    const channel = String(rawValue || "").trim();
    if (!channel) {
      appendStateEditError("Channel cannot be empty.");
      return { ok: false };
    }
    next.channel = channel;
  } else {
    const value = parseMetricNumber(rawValue, editor.label, editor);
    if (value === null) return { ok: false };
    next[editor.field] = value;
  }

  send({
    type: "mcp_tool",
    tool: "configure_microscope_imaging",
    arguments: {
      channel: next.channel,
      exposure_time: next.exposure_time,
      gain: next.gain,
      coaxial_intensity: next.coaxial_intensity,
      ring_intensity: next.ring_intensity,
      auto_exposure: next.auto_exposure,
      restart_streamer: true,
      bring_to_front: false,
      stabilization_wait: 0.5,
      queue_timeout_seconds: 10,
    },
  });
  const display = editor.field === "exposure_time" ? formatExposure(next.exposure_time) : String(next[editor.field]);
  return {
    ok: true,
    display,
    pending: {
      key: metricEditorKey(editor),
      expected: { kind: "microscope", field: editor.field, ...next },
    },
  };
}

function commitCameraMetric(editor, rawValue) {
  const settings = getPath(currentLiveState(), "camera_settings") || {};
  const next = {
    exposure_time: boundedInteger(firstDefined(settings.exposure_time, settings.ExposureTime, settings.exposure, 72000), 1, Number.MAX_SAFE_INTEGER),
    gain: boundedInteger(firstDefined(settings.gain, settings.analog_gain, settings.AnalogGain, 0), 0, Number.MAX_SAFE_INTEGER),
    auto_exposure: Boolean(settings.auto_exposure),
  };

  const value = parseMetricNumber(rawValue, editor.label, editor);
  if (value === null) return { ok: false };
  next[editor.field] = value;

  send({
    type: "mcp_tool",
    tool: "configure_camera_imaging",
    arguments: {
      exposure_time: next.exposure_time,
      gain: next.gain,
      auto_exposure: next.auto_exposure,
      queue_timeout_seconds: 10,
    },
  });
  const display = editor.field === "exposure_time" ? formatExposure(next.exposure_time) : String(next[editor.field]);
  return {
    ok: true,
    display,
    pending: {
      key: metricEditorKey(editor),
      expected: { kind: "camera", field: editor.field, ...next },
    },
  };
}

function commitTemperatureMetric(editor, rawValue) {
  const value = parseMetricFloat(rawValue, editor.label, editor);
  if (value === null) return { ok: false };
  send({
    type: "mcp_tool",
    tool: "temperature_hold",
    arguments: {
      target_c: value,
      hold_seconds: 0,
      tolerance_c: 0.5,
      settle_timeout_seconds: 0,
      sample_interval_seconds: 1,
      require_settle: false,
      max_samples: 1,
    },
  });
  return {
    ok: true,
    display: `target ${value.toFixed(1)} C`,
    pending: {
      key: metricEditorKey(editor),
      expected: { kind: "temperature", target: value },
    },
  };
}

function beginTemperatureTargetEdit() {
  const item = document.querySelector(".temperature-readout");
  const valueEl = $("temperatureTarget");
  if (!item || !valueEl) return;
  const target = extractTemperatureTarget(currentLiveState());
  const value = Number.isFinite(target) ? target : "";
  const spec = editableMetric("Target", value, {
    kind: "temperature",
    field: "target",
    input: "number",
    step: 0.5,
    min: 0,
    max: 99,
    display: Number.isFinite(target) ? `target ${target.toFixed(1)} C` : "target -",
  });
  beginMetricEdit(spec, item, valueEl);
}

function metricEditorKey(editor) {
  if (!editor) return "";
  if (editor.kind === "stage") return `stage.${editor.axis}`;
  if (editor.kind === "stage_speed") return "stage.speed";
  return `${editor.kind || "metric"}.${editor.field || editor.label || ""}`;
}

function resolvePendingMetricEditFromLive(live) {
  if (!pendingMetricEdit) return;
  if (pendingMetricEditMatchesLive(pendingMetricEdit, live)) {
    pendingMetricEdit = null;
    return;
  }
  if (Date.now() - Number(pendingMetricEdit.startedAt || 0) > 12000) {
    pendingMetricEdit = null;
  }
}

function pendingMetricEditMatchesLive(pending, live) {
  const expected = pending?.expected || {};
  const root = live?.state?.value || live?.state?.result?.value || live?.state || currentLiveState();
  if (!root || !expected.kind) return false;
  if (expected.kind === "stage") {
    const value = Number(getPath(root, `xy_stage.position.${expected.axis}`));
    return Number.isFinite(value) && Math.abs(value - Number(expected.value)) <= 2;
  }
  if (expected.kind === "stage_speed") {
    const velocity = Number(getPath(root, "xy_stage.motion_params.dMaxV"));
    const acceleration = Number(getPath(root, "xy_stage.motion_params.dMaxA"));
    return (
      Number.isFinite(velocity)
      && Number.isFinite(acceleration)
      && Math.abs(velocity - Number(expected.velocity)) <= 1
      && Math.abs(acceleration - Number(expected.acceleration)) <= 1
    );
  }
  if (expected.kind === "light") {
    const value = getPath(root, `light_settings.${expected.field}`);
    return valuesClose(value, expected[expected.field]);
  }
  if (expected.kind === "microscope") {
    if (expected.field === "channel") {
      const channel = firstDefined(
        getPath(root, "microscope_settings.current_channel"),
        getPath(root, "microscope_settings.channel"),
      );
      return String(channel || "") === String(expected.channel || "");
    }
    const value = getPath(root, `microscope_settings.${expected.field}`);
    return valuesClose(value, expected[expected.field]);
  }
  if (expected.kind === "camera") {
    const value = getPath(root, `camera_settings.${expected.field}`);
    return valuesClose(value, expected[expected.field]);
  }
  if (expected.kind === "temperature") {
    const target = typeof extractTemperatureTarget === "function"
      ? extractTemperatureTarget(root)
      : getPath(root, "temperature.target");
    return Number.isFinite(Number(target)) && Math.abs(Number(target) - Number(expected.target)) <= 0.05;
  }
  return false;
}

function valuesClose(actual, expected) {
  if (typeof expected === "boolean") return Boolean(actual) === expected;
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
    return Math.abs(actualNumber - expectedNumber) <= 1;
  }
  return String(actual ?? "") === String(expected ?? "");
}

function clearPendingMetricEdit(options = {}) {
  if (!pendingMetricEdit) return;
  pendingMetricEdit = null;
  if (options.render !== false) renderStateGrid(state.live || {});
}

window.clearPendingMetricEdit = clearPendingMetricEdit;

function parseMetricNumber(rawValue, label, editor = {}) {
  const number = Number(String(rawValue ?? "").trim());
  if (!Number.isFinite(number)) {
    appendStateEditError(`${label || "Value"} needs a valid number.`);
    return null;
  }
  const min = editor.min ?? -Number.MAX_SAFE_INTEGER;
  const max = editor.max ?? Number.MAX_SAFE_INTEGER;
  return boundedInteger(number, min, max);
}

function parseMetricFloat(rawValue, label, editor = {}) {
  const number = Number(String(rawValue ?? "").trim());
  if (!Number.isFinite(number)) {
    appendStateEditError(`${label || "Value"} needs a valid number.`);
    return null;
  }
  const min = editor.min ?? -Number.MAX_SAFE_INTEGER;
  const max = editor.max ?? Number.MAX_SAFE_INTEGER;
  return clamp(number, min, max);
}

function parseMetricBoolean(rawValue) {
  const value = String(rawValue ?? "").trim().toLowerCase();
  if (["on", "true", "1", "yes"].includes(value)) return true;
  if (["off", "false", "0", "no"].includes(value)) return false;
  return null;
}

function boundedInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.trunc(min);
  return Math.trunc(clamp(number, min, max));
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

function currentLiveState() {
  const live = state.live || {};
  return live?.state?.value || live?.state?.result?.value || live?.state || {};
}

function currentStagePosition() {
  if (typeof stageMotionPosition === "function") {
    const animated = stageMotionPosition();
    if (animated) return animated;
  }
  return getPath(currentLiveState(), "xy_stage.position") || {};
}

function appendStateEditError(message) {
  appendEvent({
    ts: new Date().toISOString(),
    type: "ui_error",
    level: "warning",
    message,
  });
}
