function drawTimelineCursor(ctx, layout, frame, color, primary = true, label = "") {
  const numeric = Number(frame);
  if (!Number.isFinite(numeric)) return;
  if (numeric < layout.startFrame || numeric > layout.endFrame) return;
  const x = timelineXForFrame(layout, numeric);
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
