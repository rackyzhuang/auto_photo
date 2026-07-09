import type { ExportSettings } from "../types";

type DrawableCanvas = HTMLCanvasElement | OffscreenCanvas;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const drawWatermark = (canvas: DrawableCanvas, settings?: ExportSettings) => {
  if (!settings) return;
  const text = settings.watermarkText.trim();
  if (!text) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const shortestEdge = Math.min(canvas.width, canvas.height);
  const fontSize = Math.max(14, Math.round((shortestEdge * settings.watermarkSize) / 100));
  const padding = Math.max(18, Math.round(shortestEdge * 0.035));

  ctx.save();
  ctx.font = `600 ${fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.globalAlpha = clamp(settings.watermarkOpacity / 100, 0.08, 1);

  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = fontSize * 1.25;
  let x = canvas.width - padding - textWidth;
  let y = canvas.height - padding - textHeight / 2;
  let align: CanvasTextAlign = "left";

  if (settings.watermarkPosition === "bottom-left") {
    x = padding;
    y = canvas.height - padding - textHeight / 2;
  }
  if (settings.watermarkPosition === "top-right") {
    x = canvas.width - padding - textWidth;
    y = padding + textHeight / 2;
  }
  if (settings.watermarkPosition === "top-left") {
    x = padding;
    y = padding + textHeight / 2;
  }
  if (settings.watermarkPosition === "center") {
    x = canvas.width / 2;
    y = canvas.height / 2;
    align = "center";
  }

  ctx.textAlign = align;
  ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.11));
  ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
};
