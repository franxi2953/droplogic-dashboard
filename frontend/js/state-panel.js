let activeMetricEdit = null;

document.addEventListener("pointerdown", (event) => {
  if (!activeMetricEdit) return;
  if (activeMetricEdit.item?.contains?.(event.target)) return;
  activeMetricEdit.close(true);
});

function renderStateGrid(live) {
  const container = $("stateGrid");
  if (!container) return;
  if (container.querySelector(".metric.editing")) return;
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
    if (spec.editor) {
      item.classList.add("editable-metric");
      item.tabIndex = 0;
      item.title = "Edit";
    }

    const labelEl = document.createElement("span");
    labelEl.className = "metric-label";
    labelEl.textContent = spec.label;
    const valueEl = document.createElement("strong");
    valueEl.className = "metric-value";
    valueEl.textContent = metricValueText(spec);
    item.append(labelEl, valueEl);

    if (spec.editor) {
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
  if (!spec.editor || item.classList.contains("editing")) return;
  if (activeMetricEdit) activeMetricEdit.close(true);
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
      valueEl.textContent = result?.ok ? result.display : metricValueText(spec);
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
    },
  });
  return { ok: true, display: String(Math.trunc(value)) };
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
  return { ok: true, display };
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
  return { ok: true, display };
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
  return { ok: true, display: `target ${value.toFixed(1)} C` };
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
