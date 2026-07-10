import exifr from "exifr";
import type { AutoAnalysis, CameraBrand, EditParams, ExportSettings, PhotoAsset, PhotoMetadata, SourceFormat } from "../types";
import { createDefaultEditParams, mergeEditParams } from "./editParams";
import { applyCanvasGeometry } from "./geometry";
import { findEmbeddedJpegCandidates, RAW_JPEG_SCAN_LIMIT } from "./rawEmbeddedJpeg";
import { applyEditPipeline } from "./renderPipeline";
import { drawWatermark } from "./watermark";

const MAX_PREVIEW_EDGE = 1800;
const MAX_THUMB_EDGE = 520;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const detectBrand = (make?: string, model?: string): CameraBrand => {
  const text = `${make ?? ""} ${model ?? ""}`.toLowerCase();
  if (text.includes("sony")) return "Sony";
  if (text.includes("nikon")) return "Nikon";
  return "Unknown";
};

const rawExtensions = new Set(["arw", "nef"]);

export const detectSourceFormat = (file: File): SourceFormat | undefined => {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (file.type === "image/jpeg" || extension === "jpg" || extension === "jpeg") return "jpg";
  if (extension && rawExtensions.has(extension)) return "raw";
  return undefined;
};

export const isSupportedPhotoFile = (file: File) => detectSourceFormat(file) !== undefined;

export const calculateFileHash = async (file: File) => {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const normalizeExposureTime = (value: unknown): string | undefined => {
  if (typeof value === "number" && value > 0) {
    if (value < 1) return `1/${Math.round(1 / value)}`;
    return `${value}s`;
  }
  if (typeof value === "string") return value;
  return undefined;
};

const normalizeMetadataString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
};

const normalizeMetadataNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
};

const normalizeLens = (lensModel: unknown, lensInfo: unknown): string | undefined => {
  const model = normalizeMetadataString(lensModel);
  if (model) return model;
  if (Array.isArray(lensInfo) && lensInfo.length > 0) return lensInfo.join("-");
  return normalizeMetadataString(lensInfo);
};

const readMetadata = async (file: File): Promise<PhotoMetadata> => {
  try {
    const data = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: false,
      interop: false,
      translateValues: true
    });

    return {
      make: normalizeMetadataString(data?.Make),
      model: normalizeMetadataString(data?.Model),
      lens: normalizeLens(data?.LensModel, data?.LensInfo),
      iso: normalizeMetadataNumber(data?.ISO),
      exposureTime: normalizeExposureTime(data?.ExposureTime),
      fNumber: normalizeMetadataNumber(data?.FNumber),
      focalLength: normalizeMetadataNumber(data?.FocalLength),
      whiteBalance: normalizeMetadataString(data?.WhiteBalance),
      dateTimeOriginal: data?.DateTimeOriginal?.toString?.(),
      orientation: data?.Orientation
    };
  } catch {
    return {};
  }
};

const createImageElement = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = url;
  });

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

const drawToCanvas = (image: HTMLImageElement, maxEdge: number, orientation?: number | string): HTMLCanvasElement => {
  const normalizedOrientation = normalizeOrientation(orientation);
  const rotated = normalizedOrientation === 6 || normalizedOrientation === 8;
  const naturalWidth = rotated ? image.naturalHeight : image.naturalWidth;
  const naturalHeight = rotated ? image.naturalWidth : image.naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建图像画布");
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

const canvasToUrl = (canvas: HTMLCanvasElement, quality = 0.88) => canvas.toDataURL("image/jpeg", quality);

const createRenderCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Preview request cancelled", "AbortError");
};

const bytesToDataUrl = (bytes: Uint8Array, mimeType = "image/jpeg") => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

const scanRawEmbeddedJpeg = async (file: File) => {
  const bytes = new Uint8Array(await file.slice(0, RAW_JPEG_SCAN_LIMIT).arrayBuffer());
  return findEmbeddedJpegCandidates(bytes)[0]?.bytes;
};

export const createRawEmbeddedSourceUrl = async (file: File) => {
  const thumbnail = await exifr.thumbnail(file);
  const exifrCandidate =
    thumbnail && thumbnail.length >= 4 && thumbnail[0] === 0xff && thumbnail[1] === 0xd8 ? thumbnail : undefined;
  const scannedCandidate = await scanRawEmbeddedJpeg(file);
  const previewBytes =
    scannedCandidate && (!exifrCandidate || scannedCandidate.length > exifrCandidate.length)
      ? scannedCandidate
      : exifrCandidate;
  if (!previewBytes) return undefined;
  return bytesToDataUrl(previewBytes);
};

const createRawEmbeddedPreviewUrl = async (file: File, orientation?: number | string) => {
  try {
    const sourceUrl = await createRawEmbeddedSourceUrl(file);
    if (!sourceUrl) return undefined;

    const image = await createImageElement(sourceUrl);
    const canvas = drawToCanvas(image, MAX_THUMB_EDGE, orientation);
    return canvasToUrl(canvas, 0.86);
  } catch {
    return undefined;
  }
};

const createRawPlaceholderUrl = (fileName: string, cameraBrand: CameraBrand) => {
  const canvas = document.createElement("canvas");
  canvas.width = 520;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = "#171a1f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#232830";
  ctx.fillRect(32, 32, canvas.width - 64, canvas.height - 64);
  ctx.strokeStyle = "rgba(143, 191, 232, 0.72)";
  ctx.lineWidth = 3;
  ctx.strokeRect(32, 32, canvas.width - 64, canvas.height - 64);
  ctx.fillStyle = "#eef2f5";
  ctx.font = '700 46px "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("RAW", canvas.width / 2, 155);
  ctx.fillStyle = "#aebbc7";
  ctx.font = '600 22px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillText(cameraBrand, canvas.width / 2, 196);
  ctx.font = '500 18px "Segoe UI", "Microsoft YaHei", sans-serif';
  const label = fileName.length > 36 ? `${fileName.slice(0, 18)}...${fileName.slice(-14)}` : fileName;
  ctx.fillText(label, canvas.width / 2, 238);
  ctx.fillStyle = "#8fbfe8";
  ctx.font = '600 16px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillText("待接入 LibRaw 显影", canvas.width / 2, 280);
  return canvasToUrl(canvas, 0.86);
};

const detectRawBrand = (fileName: string): CameraBrand => {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "arw") return "Sony";
  if (extension === "nef") return "Nikon";
  return "Unknown";
};

export const importPhotoFile = async (file: File, fileHash?: string): Promise<PhotoAsset> => {
  const sourceFormat = detectSourceFormat(file);
  if (!sourceFormat) throw new Error(`不支持的文件格式：${file.name}`);

  const objectUrl = URL.createObjectURL(file);

  try {
    const hash = fileHash ?? (await calculateFileHash(file));
    if (sourceFormat === "raw") {
      const extension = file.name.split(".").pop()?.toUpperCase() ?? "RAW";
      const metadata = await readMetadata(file);
      const metadataBrand = detectBrand(metadata.make, metadata.model);
      const cameraBrand = metadataBrand === "Unknown" ? detectRawBrand(file.name) : metadataBrand;
      const model = metadata.model ?? `${extension} RAW`;
      const lens = metadata.lens ?? "RAW 元数据待解析";
      const embeddedPreviewUrl = await createRawEmbeddedPreviewUrl(file, metadata.orientation);
      return {
        id: `${hash}-${crypto.randomUUID()}`,
        file,
        fileHash: hash,
        name: file.name,
        size: file.size,
        type: file.type || `image/x-${extension.toLowerCase()}`,
        sourceFormat,
        isEditable: false,
        objectUrl,
        previewUrl: embeddedPreviewUrl ?? createRawPlaceholderUrl(file.name, cameraBrand),
        previewKind: embeddedPreviewUrl ? "raw_embedded" : "raw_placeholder",
        cameraBrand,
        metadata: {
          ...metadata,
          make: metadata.make ?? (cameraBrand === "Unknown" ? undefined : cameraBrand),
          model,
          lens
        },
        edits: createDefaultEditParams()
      };
    }

    const metadata = await readMetadata(file);
    const image = await createImageElement(objectUrl);
    const thumbCanvas = drawToCanvas(image, MAX_THUMB_EDGE, metadata.orientation);
    const previewUrl = canvasToUrl(thumbCanvas, 0.82);
    const cameraBrand = detectBrand(metadata.make, metadata.model);

    return {
      id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      fileHash: hash,
      name: file.name,
      size: file.size,
      type: file.type,
      sourceFormat,
      isEditable: true,
      objectUrl,
      previewUrl,
      previewKind: "jpg",
      cameraBrand,
      metadata,
      edits: createDefaultEditParams()
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
};

export const analyzeImage = async (asset: PhotoAsset): Promise<AutoAnalysis> => {
  if (!asset.isEditable) throw new Error("RAW 显影尚未接入，暂不能自动调色");
  return analyzeImageSource(asset.objectUrl, asset.metadata.orientation);
};

export const analyzeImageSource = async (sourceUrl: string, orientation?: number | string): Promise<AutoAnalysis> => {
  const image = await createImageElement(sourceUrl);
  const canvas = drawToCanvas(image, 360, orientation);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法分析图像");
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  let r = 0;
  let g = 0;
  let b = 0;
  let luma = 0;
  let lumaSquares = 0;
  let skinLike = 0;
  let shadowCount = 0;
  let highlightCount = 0;
  const count = pixels.length / 4;

  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    const y = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    r += red;
    g += green;
    b += blue;
    luma += y;
    lumaSquares += y * y;
    if (y < 58) shadowCount += 1;
    if (y > 210) highlightCount += 1;

    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    if (red > 72 && green > 42 && blue > 28 && red > green && green >= blue && max - min > 16) {
      skinLike += 1;
    }
  }

  const averageR = r / count;
  const averageG = g / count;
  const averageB = b / count;
  const averageLuma = luma / count;
  const lumaVariance = Math.max(0, lumaSquares / count - averageLuma * averageLuma);

  return {
    averageLuma,
    lumaStdDev: Math.sqrt(lumaVariance),
    shadowRatio: shadowCount / count,
    highlightRatio: highlightCount / count,
    redBalance: averageR / 255,
    greenBalance: averageG / 255,
    blueBalance: averageB / 255,
    warmBias: (averageR - averageB) / 255,
    skinLikeRatio: skinLike / count
  };
};

export const createAutoEdit = (asset: PhotoAsset, analysis: AutoAnalysis): { edits: EditParams; summary: string[] } => {
  const summary: string[] = [];
  const brandWarmOffset = asset.cameraBrand === "Sony" ? -4 : asset.cameraBrand === "Nikon" ? 2 : 0;
  const brandTintOffset = asset.cameraBrand === "Sony" ? 4 : 0;
  const lumaTarget = 128;
  const lumaDelta = lumaTarget - analysis.averageLuma;

  const exposure = clamp(lumaDelta / 3.4, -28, 28);
  const temperature = clamp(-analysis.warmBias * 42 + brandWarmOffset, -28, 28);
  const tint = clamp((analysis.greenBalance - (analysis.redBalance + analysis.blueBalance) / 2) * -45 + brandTintOffset, -20, 20);
  const skinProtection = analysis.skinLikeRatio > 0.035 ? 84 : 62;
  const lowContrastBoost = clamp((54 - analysis.lumaStdDev) * 0.62, 0, 18);
  const hazeBoost = clamp(lowContrastBoost + Math.max(0, 0.1 - analysis.shadowRatio) * 42, 0, 20);
  const transparency = analysis.skinLikeRatio > 0.04 ? clamp(14 + lowContrastBoost * 0.55, 10, 24) : clamp(22 + hazeBoost, 16, 42);

  if (Math.abs(exposure) > 4) summary.push(exposure > 0 ? "提亮整体曝光" : "压低整体曝光");
  if (Math.abs(temperature) > 4) summary.push(temperature > 0 ? "修正偏冷色温" : "修正偏暖色温");
  if (Math.abs(tint) > 3) summary.push("修正绿/洋红色偏");
  if (skinProtection > 75) summary.push("启用高强度肤色保护");
  if (transparency >= 18) summary.push("提升画面通透度");
  if (asset.cameraBrand !== "Unknown") summary.push(`应用 ${asset.cameraBrand} JPG 默认校正`);

  const edits = mergeEditParams(createDefaultEditParams(), {
    exposure,
    temperature,
    tint,
    contrast: clamp(10 - Math.abs(exposure) * 0.18, 4, 13),
    highlights: clamp(-12 - Math.max(0, analysis.averageLuma - 140) * 0.28, -32, -8),
    shadows: clamp(10 + Math.max(0, 118 - analysis.averageLuma) * 0.2, 6, 26),
    whites: clamp(5 + exposure * 0.08, -4, 10),
    blacks: clamp(-8 - Math.max(0, analysis.averageLuma - 128) * 0.08, -16, -4),
    saturation: analysis.skinLikeRatio > 0.04 ? -1 : 2,
    vibrance: analysis.skinLikeRatio > 0.04 ? 10 : 14,
    sharpness: asset.metadata.iso && asset.metadata.iso >= 3200 ? 4 : 10,
    noiseReduction: asset.metadata.iso ? clamp((asset.metadata.iso - 800) / 180, 0, 22) : 4,
    transparency,
    clarity: analysis.skinLikeRatio > 0.04 ? 4 : clamp(10 + lowContrastBoost * 0.25, 8, 16),
    texture: analysis.skinLikeRatio > 0.04 ? -1 : clamp(6 + lowContrastBoost * 0.18, 5, 12),
    dehaze: analysis.skinLikeRatio > 0.04 ? clamp(5 + hazeBoost * 0.3, 4, 12) : clamp(10 + hazeBoost * 0.5, 8, 22),
    vignette: analysis.skinLikeRatio > 0.04 ? 4 : 0,
    grain: 0,
    skinProtection
  });

  return {
    edits,
    summary: summary.length > 0 ? summary : ["生成自然基础校正"]
  };
};

export const renderEditedPreview = async (
  asset: PhotoAsset,
  edits: EditParams,
  options: { maxEdge?: number; quality?: number; exportSettings?: ExportSettings; signal?: AbortSignal } = {}
): Promise<string> => {
  if (!asset.isEditable) throw new Error("RAW 显影尚未接入，暂不能渲染预览");
  throwIfAborted(options.signal);
  return renderImageSourceWithEdits(asset.objectUrl, edits, {
    ...options,
    orientation: asset.metadata.orientation
  });
};

export const renderImageSourceWithEdits = async (
  sourceUrl: string,
  edits: EditParams,
  options: {
    maxEdge?: number;
    quality?: number;
    exportSettings?: ExportSettings;
    signal?: AbortSignal;
    orientation?: number | string;
  } = {}
): Promise<string> => {
  throwIfAborted(options.signal);
  const image = await createImageElement(sourceUrl);
  throwIfAborted(options.signal);
  const orientedCanvas = drawToCanvas(image, options.maxEdge ?? MAX_PREVIEW_EDGE, options.orientation);
  const canvas = applyCanvasGeometry(orientedCanvas, edits, createRenderCanvas) as HTMLCanvasElement;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法渲染预览");

  throwIfAborted(options.signal);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyEditPipeline(imageData, edits);

  throwIfAborted(options.signal);
  ctx.putImageData(imageData, 0, 0);
  drawWatermark(canvas, options.exportSettings);
  throwIfAborted(options.signal);
  return canvasToUrl(canvas, options.quality ?? 0.9);
};

export const formatFileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
