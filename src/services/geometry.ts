import type { EditParams } from "../types";

type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;
type CanvasFactory = (width: number, height: number) => RenderCanvas;

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const cropAspectOptions: Array<{ value: EditParams["cropAspect"]; label: string }> = [
  { value: "free", label: "自由" },
  { value: "original", label: "原比例" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "3:4", label: "3:4" },
  { value: "4:3", label: "4:3" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" }
];

export const normalizeRotationDegrees = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  let rotation = Math.round(value);
  while (rotation > 180) rotation -= 360;
  while (rotation <= -180) rotation += 360;
  return rotation;
};

const getAspectRatio = (aspect: EditParams["cropAspect"], canvasWidth: number, canvasHeight: number) => {
  if (aspect === "free") return undefined;
  if (aspect === "original") return canvasWidth / Math.max(1, canvasHeight);
  const [width, height] = aspect.split(":").map(Number);
  return width > 0 && height > 0 ? width / height : undefined;
};

const clampCropRect = (rect: CropRect, canvasWidth: number, canvasHeight: number): CropRect => {
  const width = Math.max(1, Math.min(canvasWidth, Math.round(rect.width)));
  const height = Math.max(1, Math.min(canvasHeight, Math.round(rect.height)));
  const x = Math.round(clamp(rect.x, 0, canvasWidth - width));
  const y = Math.round(clamp(rect.y, 0, canvasHeight - height));
  return { x, y, width, height };
};

export const resolveCropRect = (edits: EditParams, canvasWidth: number, canvasHeight: number): CropRect => {
  const cropX = clamp(Number.isFinite(edits.cropX) ? edits.cropX : 0, 0, 99);
  const cropY = clamp(Number.isFinite(edits.cropY) ? edits.cropY : 0, 0, 99);
  const cropWidth = clamp(Number.isFinite(edits.cropWidth) ? edits.cropWidth : 100, 1, 100);
  const cropHeight = clamp(Number.isFinite(edits.cropHeight) ? edits.cropHeight : 100, 1, 100);
  const baseRect = clampCropRect(
    {
      x: (cropX / 100) * canvasWidth,
      y: (cropY / 100) * canvasHeight,
      width: (Math.min(cropWidth, 100 - cropX) / 100) * canvasWidth,
      height: (Math.min(cropHeight, 100 - cropY) / 100) * canvasHeight
    },
    canvasWidth,
    canvasHeight
  );

  const aspectRatio = getAspectRatio(edits.cropAspect, canvasWidth, canvasHeight);
  if (!aspectRatio) return baseRect;

  const centerX = baseRect.x + baseRect.width / 2;
  const centerY = baseRect.y + baseRect.height / 2;
  let width = baseRect.width;
  let height = width / aspectRatio;
  if (height > baseRect.height) {
    height = baseRect.height;
    width = height * aspectRatio;
  }

  return clampCropRect(
    {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height
    },
    canvasWidth,
    canvasHeight
  );
};

const hasRotation = (edits: EditParams) => normalizeRotationDegrees(edits.rotation) !== 0;

const hasCrop = (edits: EditParams) =>
  edits.cropAspect !== "free" ||
  Math.abs(edits.cropX) >= 0.1 ||
  Math.abs(edits.cropY) >= 0.1 ||
  Math.abs(edits.cropWidth - 100) >= 0.1 ||
  Math.abs(edits.cropHeight - 100) >= 0.1;

export const hasGeometryEdits = (edits: EditParams) => hasRotation(edits) || hasCrop(edits);

const drawRotatedCanvas = (source: RenderCanvas, edits: EditParams, createCanvas: CanvasFactory): RenderCanvas => {
  const rotation = normalizeRotationDegrees(edits.rotation);
  if (rotation === 0) return source;

  const radians = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = source.width;
  const height = source.height;
  const rotatedWidth = Math.max(1, Math.ceil(width * cos + height * sin));
  const rotatedHeight = Math.max(1, Math.ceil(width * sin + height * cos));
  const canvas = createCanvas(rotatedWidth, rotatedHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建旋转画布");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(rotatedWidth / 2, rotatedHeight / 2);
  ctx.rotate(radians);
  ctx.drawImage(source, -width / 2, -height / 2);
  return canvas;
};

const drawCroppedCanvas = (source: RenderCanvas, edits: EditParams, createCanvas: CanvasFactory): RenderCanvas => {
  if (!hasCrop(edits)) return source;

  const rect = resolveCropRect(edits, source.width, source.height);
  if (rect.x === 0 && rect.y === 0 && rect.width === source.width && rect.height === source.height) return source;

  const canvas = createCanvas(rect.width, rect.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建裁切画布");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return canvas;
};

export const applyCanvasGeometry = (source: RenderCanvas, edits: EditParams, createCanvas: CanvasFactory): RenderCanvas => {
  const rotated = drawRotatedCanvas(source, edits, createCanvas);
  return drawCroppedCanvas(rotated, edits, createCanvas);
};
