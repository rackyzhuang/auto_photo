import type { EditParams, ExportSettings, PhotoMetadata } from "../types";
import { applyCanvasGeometry } from "../services/geometry";
import { applyEditPipeline } from "../services/renderPipeline";
import { drawWatermark } from "../services/watermark";

const normalizeOrientation = (orientation?: number | string) => {
  if (typeof orientation === "number") return orientation;
  if (typeof orientation === "string") {
    const match = orientation.match(/\d+/);
    if (match) return Number(match[0]);
    const lower = orientation.toLowerCase();
    if (lower.includes("90") && lower.includes("cw")) return 6;
    if (lower.includes("90") && lower.includes("ccw")) return 8;
    if (lower.includes("180")) return 3;
  }
  return 1;
};

const drawToCanvas = (image: ImageBitmap, maxEdge: number, orientation?: number | string): OffscreenCanvas => {
  const normalizedOrientation = normalizeOrientation(orientation);
  const rotated = normalizedOrientation === 6 || normalizedOrientation === 8;
  const naturalWidth = rotated ? image.height : image.width;
  const naturalHeight = rotated ? image.width : image.height;
  const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(naturalWidth * scale)), Math.max(1, Math.round(naturalHeight * scale)));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Worker 无法创建图像画布");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (normalizedOrientation === 3) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  } else if (normalizedOrientation === 6) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(image, 0, 0, canvas.height, canvas.width);
  } else if (normalizedOrientation === 8) {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(image, 0, 0, canvas.height, canvas.width);
  } else {
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }

  return canvas;
};

const blobToDataUrl = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return `data:${blob.type};base64,${btoa(chunks.join(""))}`;
};

const createRenderCanvas = (width: number, height: number) => new OffscreenCanvas(width, height);

interface RenderRequest {
  id: number;
  file: File;
  metadata: PhotoMetadata;
  edits: EditParams;
  maxEdge: number;
  quality: number;
  exportSettings?: ExportSettings;
}

const renderPreview = async (request: RenderRequest) => {
  const image = await createImageBitmap(request.file);
  try {
    const orientedCanvas = drawToCanvas(image, request.maxEdge, request.metadata.orientation);
    const canvas = applyCanvasGeometry(orientedCanvas, request.edits, createRenderCanvas) as OffscreenCanvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Worker 无法渲染预览");

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyEditPipeline(imageData, request.edits);

    ctx.putImageData(imageData, 0, 0);
    drawWatermark(canvas, request.exportSettings);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: request.quality });
    return blobToDataUrl(blob);
  } finally {
    image.close();
  }
};

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  void renderPreview(event.data)
    .then((dataUrl) => {
      self.postMessage({ id: event.data.id, dataUrl });
    })
    .catch((error) => {
      self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : "Worker 预览失败" });
    });
};
