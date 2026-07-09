import { ChangeEvent, DragEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
  CheckSquare,
  Crop,
  Database,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Import,
  Loader2,
  FolderOpen,
  Palette,
  Plus,
  Save,
  Redo2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Wand2,
  X
} from "lucide-react";
import type {
  AiConnectionDiagnostic,
  AiSettingsState,
  AiTuningMode,
  AiTuningResult,
  AutoAnalysis,
  EditParams,
  ExportConflictStrategy,
  ExportJobHistory,
  ExportJobRecord,
  ExportProgress,
  ExportSettings,
  NamedProjectInfo,
  PhotoAsset,
  Preset,
  ProjectSnapshot,
  ProjectStoreSummary,
  ReferenceColorSignature,
  WatermarkPosition,
  WorkflowSettings
} from "./types";
import { builtInPresets, createDefaultEditParams, hslChannels, mergeEditParams, normalizeEditParams } from "./services/editParams";
import { cropAspectOptions, normalizeRotationDegrees } from "./services/geometry";
import {
  analyzeImage,
  analyzeImageSource,
  calculateFileHash,
  createAutoEdit,
  createRawEmbeddedSourceUrl,
  formatFileSize,
  importPhotoFile,
  isSupportedPhotoFile,
  renderImageSourceWithEdits
} from "./services/imageProcessing";
import { preserveSafeExif } from "./services/jpegMetadata";
import { runExportQueue as runExportQueueService, type ExportQueueItem, type ExportQueueResult, type ExportWriteResult } from "./services/exportQueue";
import { explainAiFailureReason, sanitizeAiFailureReason } from "./services/aiSafety";
import { desktopPhotoPayloadToFile } from "./services/desktopImportPayload";
import { disposePreviewWorker, renderPreviewWithWorkerFallback } from "./services/previewWorkerClient";
import { loadStoredState, saveStoredState } from "./services/storage";
import {
  chooseExportDirectory,
  choosePhotoFilePaths,
  diagnoseAiConnection,
  getAiSettings,
  getProjectStoreSummary,
  getProjectStorePath,
  isTauriRuntime,
  listExportJobs,
  listNamedProjectSnapshots,
  loadNamedProjectSnapshot,
  loadProjectSnapshotFromDb,
  recordExportJob,
  readPhotoFiles,
  onDesktopPhotoDragDrop,
  saveAiSettings,
  saveNamedProjectSnapshot,
  saveExportFile,
  saveProjectSnapshotToDb,
  tunePhotoWithAi
} from "./services/desktopBridge";

type NumericEditParamKey = {
  [Key in keyof EditParams]: EditParams[Key] extends number ? Key : never;
}[keyof EditParams] & Exclude<keyof EditParams, "schemaVersion">;

interface EditControl {
  key: NumericEditParamKey;
  label: string;
  min: number;
  max: number;
  step?: number;
}

const basicControls: EditControl[] = [
  { key: "exposure", label: "曝光", min: -50, max: 50 },
  { key: "temperature", label: "色温", min: -50, max: 50 },
  { key: "tint", label: "色调", min: -50, max: 50 },
  { key: "contrast", label: "对比度", min: -50, max: 50 },
  { key: "highlights", label: "高光", min: -60, max: 40 },
  { key: "shadows", label: "阴影", min: -40, max: 60 },
  { key: "whites", label: "白色", min: -40, max: 40 },
  { key: "blacks", label: "黑色", min: -40, max: 40 },
  { key: "saturation", label: "饱和度", min: -50, max: 50 },
  { key: "vibrance", label: "自然饱和度", min: -50, max: 50 }
];

const enhancementControls: EditControl[] = [
  { key: "clarity", label: "清晰度", min: -50, max: 50 },
  { key: "texture", label: "纹理", min: -50, max: 50 },
  { key: "dehaze", label: "去雾", min: -50, max: 50 },
  { key: "vignette", label: "暗角", min: -50, max: 50 },
  { key: "grain", label: "颗粒", min: 0, max: 50 },
  { key: "sharpness", label: "锐化", min: 0, max: 40 },
  { key: "noiseReduction", label: "降噪", min: 0, max: 40 },
  { key: "skinProtection", label: "肤色保护", min: 0, max: 100 }
];

const portraitControls: EditControl[] = [
  { key: "skinSmoothing", label: "磨皮", min: 0, max: 100 },
  { key: "skinTone", label: "润色", min: -50, max: 50 },
  { key: "teethWhitening", label: "美齿", min: 0, max: 100 },
  { key: "clothingWrinkleReduction", label: "衣物去褶皱", min: 0, max: 100 }
];

const rotationControls: EditControl[] = [{ key: "rotation", label: "旋转角度", min: -180, max: 180 }];

const watermarkPositions: Array<{ value: WatermarkPosition; label: string }> = [
  { value: "bottom-right", label: "右下" },
  { value: "bottom-left", label: "左下" },
  { value: "top-right", label: "右上" },
  { value: "top-left", label: "左上" },
  { value: "center", label: "居中" }
];
const exportConflictStrategies: Array<{ value: ExportConflictStrategy; label: string }> = [
  { value: "rename", label: "自动重命名" },
  { value: "skip", label: "跳过同名" },
  { value: "overwrite", label: "覆盖同名" }
];
const BROWSER_DEFAULT_DOWNLOAD_TARGET = "浏览器默认下载位置";

const MAX_DESKTOP_IMPORT_PATHS = 24;
const supportedDesktopPhotoExtensions = new Set(["jpg", "jpeg", "arw", "nef"]);

const desktopPathName = (filePath: string) => filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;

const isSupportedDesktopPhotoPath = (filePath: string) => {
  const extension = desktopPathName(filePath).split(".").pop()?.toLowerCase();
  return Boolean(extension && supportedDesktopPhotoExtensions.has(extension));
};

const createDefaultExportSettings = (): ExportSettings => ({
  quality: 94,
  maxEdge: 4096,
  filenamePrefix: "",
  filenameSuffix: "_auto_color",
  includeSequence: false,
  conflictStrategy: "rename",
  preserveExif: true,
  watermarkText: "",
  watermarkPosition: "bottom-right",
  watermarkOpacity: 55,
  watermarkSize: 3
});

const normalizeExportSettings = (settings?: Partial<ExportSettings>): ExportSettings => ({
  ...createDefaultExportSettings(),
  ...settings
});

const createIdleExportProgress = (): ExportProgress => ({
  running: false,
  total: 0,
  completed: 0,
  failed: []
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const roundToStep = (value: number, step = 1) => Math.round(value / step) * step;

const sanitizeAiBaseUrlForDisplay = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    url.search = "";
    url.hash = "";
    const segments = url.pathname.split("/").filter(Boolean);
    while (segments.length > 0) {
      const last = segments[segments.length - 1].toLowerCase();
      if (last === "responses" || last === "models") {
        segments.pop();
        continue;
      }
      if (last === "completions" && segments[segments.length - 2]?.toLowerCase() === "chat") {
        segments.pop();
        segments.pop();
        continue;
      }
      break;
    }
    url.pathname = segments.length > 0 ? `/${segments.join("/")}` : "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed.split(/[?#]/)[0].replace(/\/(responses|models)$/i, "").replace(/\/chat\/completions$/i, "").replace(/\/$/, "");
  }
};

const valuesAreEqual = (left: EditParams, right: EditParams) => JSON.stringify(left) === JSON.stringify(right);

const releaseAssetObjectUrls = (items: PhotoAsset[]) => {
  items.forEach((asset) => {
    if (asset.objectUrl.startsWith("blob:")) URL.revokeObjectURL(asset.objectUrl);
  });
};

const normalizeWorkflowSettings = (settings?: Partial<WorkflowSettings>): WorkflowSettings => ({
  referenceStrength: Math.round(clamp(settings?.referenceStrength ?? 65, 20, 100)),
  consistencyStrength: Math.round(clamp(settings?.consistencyStrength ?? 65, 25, 100))
});

const average = (values: number[]) => {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
};

const getGreenBias = (analysis: AutoAnalysis) => analysis.greenBalance - (analysis.redBalance + analysis.blueBalance) / 2;

const createReferenceColorSignature = (analysis: AutoAnalysis, edits: EditParams): ReferenceColorSignature => ({
  averageLuma: analysis.averageLuma,
  warmBias: analysis.warmBias,
  greenBias: getGreenBias(analysis),
  skinLikeRatio: analysis.skinLikeRatio,
  styledLuma: clamp(analysis.averageLuma + edits.exposure * 2.1 + edits.shadows * 0.25 + edits.whites * 0.18, 0, 255),
  styledWarmBias: clamp(analysis.warmBias + edits.temperature / 90, -1, 1),
  styledGreenBias: clamp(getGreenBias(analysis) - edits.tint / 130, -1, 1)
});

const normalizeCropRect = (rect: CropRectPercent): CropRectPercent => {
  const x = clamp(Number.isFinite(rect.x) ? rect.x : 0, 0, 95);
  const y = clamp(Number.isFinite(rect.y) ? rect.y : 0, 0, 95);
  const width = clamp(Number.isFinite(rect.width) ? rect.width : 100, 5, 100 - x);
  const height = clamp(Number.isFinite(rect.height) ? rect.height : 100, 5, 100 - y);
  return { x, y, width, height };
};

const cropRectFromEdits = (edits: EditParams): CropRectPercent =>
  normalizeCropRect({
    x: edits.cropX,
    y: edits.cropY,
    width: edits.cropWidth,
    height: edits.cropHeight
  });

const getCropAspectRatio = (aspect: CropAspect, imageWidth: number, imageHeight: number) => {
  if (aspect === "free") return undefined;
  if (aspect === "original") return imageWidth / Math.max(1, imageHeight);
  const [width, height] = aspect.split(":").map(Number);
  return width > 0 && height > 0 ? width / height : undefined;
};

const fitRectToAspect = (
  rect: CropRectPercent,
  aspect: CropAspect,
  imageWidth: number,
  imageHeight: number
): CropRectPercent => {
  const normalized = normalizeCropRect(rect);
  const ratio = getCropAspectRatio(aspect, imageWidth, imageHeight);
  if (!ratio) return normalized;

  const centerX = normalized.x + normalized.width / 2;
  const centerY = normalized.y + normalized.height / 2;
  let width = normalized.width;
  let height = (width * imageWidth) / (ratio * Math.max(1, imageHeight));
  if (height > normalized.height) {
    height = normalized.height;
    width = (height * ratio * imageHeight) / Math.max(1, imageWidth);
  }

  width = clamp(width, 5, 100);
  height = clamp(height, 5, 100);
  return normalizeCropRect({
    x: clamp(centerX - width / 2, 0, 100 - width),
    y: clamp(centerY - height / 2, 0, 100 - height),
    width,
    height
  });
};

const createCropRectFromDrag = (
  start: { x: number; y: number },
  current: { x: number; y: number },
  aspect: CropAspect,
  imageWidth: number,
  imageHeight: number
): CropRectPercent => {
  const ratio = getCropAspectRatio(aspect, imageWidth, imageHeight);
  const directionX = current.x >= start.x ? 1 : -1;
  const directionY = current.y >= start.y ? 1 : -1;
  let width = Math.abs(current.x - start.x);
  let height = Math.abs(current.y - start.y);

  if (ratio) {
    if (width >= height) {
      height = (width * imageWidth) / (ratio * Math.max(1, imageHeight));
    } else {
      width = (height * ratio * imageHeight) / Math.max(1, imageWidth);
    }
  }

  width = clamp(width, 5, 100);
  height = clamp(height, 5, 100);
  return normalizeCropRect({
    x: directionX >= 0 ? start.x : start.x - width,
    y: directionY >= 0 ? start.y : start.y - height,
    width,
    height
  });
};

const createCropRectFromResize = (
  initial: CropRectPercent,
  corner: CropResizeCorner,
  current: { x: number; y: number },
  aspect: CropAspect,
  imageWidth: number,
  imageHeight: number
): CropRectPercent => {
  const left = initial.x;
  const top = initial.y;
  const right = initial.x + initial.width;
  const bottom = initial.y + initial.height;
  const anchor =
    corner === "nw"
      ? { x: right, y: bottom }
      : corner === "ne"
        ? { x: left, y: bottom }
        : corner === "se"
          ? { x: left, y: top }
          : { x: right, y: top };
  const maxWidth = corner === "nw" || corner === "sw" ? anchor.x : 100 - anchor.x;
  const maxHeight = corner === "nw" || corner === "ne" ? anchor.y : 100 - anchor.y;

  let width =
    corner === "nw" || corner === "sw"
      ? clamp(anchor.x - current.x, 5, maxWidth)
      : clamp(current.x - anchor.x, 5, maxWidth);
  let height =
    corner === "nw" || corner === "ne"
      ? clamp(anchor.y - current.y, 5, maxHeight)
      : clamp(current.y - anchor.y, 5, maxHeight);

  const ratio = getCropAspectRatio(aspect, imageWidth, imageHeight);
  if (ratio) {
    const heightFromWidth = (width * imageWidth) / (ratio * Math.max(1, imageHeight));
    if (heightFromWidth <= height) {
      height = heightFromWidth;
    } else {
      width = (height * ratio * imageHeight) / Math.max(1, imageWidth);
    }
    if (width > maxWidth) {
      width = maxWidth;
      height = (width * imageWidth) / (ratio * Math.max(1, imageHeight));
    }
    if (height > maxHeight) {
      height = maxHeight;
      width = (height * ratio * imageHeight) / Math.max(1, imageWidth);
    }
  }

  width = clamp(width, 5, maxWidth);
  height = clamp(height, 5, maxHeight);

  return normalizeCropRect({
    x: corner === "nw" || corner === "sw" ? anchor.x - width : anchor.x,
    y: corner === "nw" || corner === "ne" ? anchor.y - height : anchor.y,
    width,
    height
  });
};

const createCropNeutralEdits = (edits: EditParams) =>
  mergeEditParams(edits, {
    cropAspect: "free",
    cropX: 0,
    cropY: 0,
    cropWidth: 100,
    cropHeight: 100
  });

interface EditHistory {
  past: EditParams[];
  future: EditParams[];
}

interface ReferenceStyle {
  assetId: string;
  name: string;
  edits: EditParams;
  signature?: ReferenceColorSignature;
}

interface LocalAiIntent {
  warmth: number;
  contrast: number;
  saturation: number;
  highlightProtection: number;
  airy: number;
  film: number;
  portrait: number;
}

interface BatchConsistencySummary {
  groupCount: number;
  assetCount: number;
  skippedRaw: number;
  strength: number;
  hasCustomStrengths?: boolean;
  labels: string[];
}

interface BatchConsistencyGroupPreview {
  key: string;
  label: string;
  assetIds: string[];
  strength: number;
  anchor: Partial<EditParams>;
  autoEditsByAssetId: Record<string, EditParams>;
}

interface BatchConsistencyPreview extends BatchConsistencySummary {
  editsByAssetId: Record<string, EditParams>;
  groups: BatchConsistencyGroupPreview[];
  failedCount: number;
}

interface ConsistencyAnalysisItem {
  asset: PhotoAsset;
  autoEdit: EditParams;
  groupKey: string;
  groupLabel: string;
}

interface AiPendingSuggestion {
  mode: AiTuningMode;
  assetId: string;
  assetName: string;
  model: string;
  summary: string;
  fallbackHint?: string;
  params: EditParams;
  previewUrl: string;
}

declare global {
  interface Window {
    __AUTO_PHOTO_INJECT_AI_SETTINGS__?: (settings: AiSettingsState, editing?: boolean) => void;
    __AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__?: (diagnostic: AiConnectionDiagnostic) => void;
    __AUTO_PHOTO_INJECT_AI_SUGGESTION__?: (result: Partial<AiTuningResult>) => Promise<AiTuningResult | undefined>;
    __AUTO_PHOTO_INJECT_EXPORT_HISTORY__?: (history: ExportJobHistory[]) => void;
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

const numericAiControls = [...basicControls, ...enhancementControls, ...portraitControls];

const normalizeAiSuggestionParams = (baseline: EditParams, result: AiTuningResult): EditParams => {
  const incoming = result.params ?? {};
  const patch: Partial<EditParams> = {};

  numericAiControls.forEach((control) => {
    const value = incoming[control.key];
    if (typeof value === "number" && Number.isFinite(value)) {
      patch[control.key] = clamp(roundToStep(value, control.step ?? 1), control.min, control.max);
    }
  });

  const incomingHsl = incoming.hsl;
  if (incomingHsl && typeof incomingHsl === "object") {
    const nextHsl = { ...baseline.hsl };
    hslChannels.forEach((channel) => {
      const channelValue = incomingHsl[channel];
      if (!channelValue || typeof channelValue !== "object") return;
      nextHsl[channel] = {
        ...nextHsl[channel],
        hue:
          typeof channelValue.hue === "number" && Number.isFinite(channelValue.hue)
            ? clamp(roundToStep(channelValue.hue), -50, 50)
            : nextHsl[channel].hue,
        saturation:
          typeof channelValue.saturation === "number" && Number.isFinite(channelValue.saturation)
            ? clamp(roundToStep(channelValue.saturation), -50, 50)
            : nextHsl[channel].saturation,
        luminance:
          typeof channelValue.luminance === "number" && Number.isFinite(channelValue.luminance)
            ? clamp(roundToStep(channelValue.luminance), -50, 50)
            : nextHsl[channel].luminance
      };
    });
    patch.hsl = nextHsl;
  }

  return normalizeEditParams({
    ...baseline,
    ...patch,
    hsl: patch.hsl ?? baseline.hsl
  });
};

const defaultOpenGroups = {
  basic: true,
  enhancement: true,
  geometry: true,
  portrait: false,
  hsl: false,
  presets: false,
  reference: false,
  ai: false,
  batch: false,
  export: false
};

type EditGroupKey = keyof typeof defaultOpenGroups;

function AccordionSection({
  title,
  subtitle,
  isOpen,
  onToggle,
  children,
  testId
}: {
  title: string;
  subtitle?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="accordion-section">
      <button className="accordion-trigger" type="button" onClick={onToggle} aria-expanded={isOpen} data-testid={testId}>
        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>
          <strong>{title}</strong>
          {subtitle && <em>{subtitle}</em>}
        </span>
      </button>
      {isOpen && <div className="accordion-body">{children}</div>}
    </section>
  );
}

type CompareMode = "edited" | "original" | "split";
type CropAspect = EditParams["cropAspect"];
type CropResizeCorner = "nw" | "ne" | "se" | "sw";

interface CropRectPercent {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropDraft {
  assetId: string;
  aspect: CropAspect;
  rect: CropRectPercent;
}

interface CropInteraction {
  mode: "draw" | "move" | "resize";
  pointerId: number;
  start: { x: number; y: number };
  initialRect?: CropRectPercent;
  corner?: CropResizeCorner;
}

interface BatchProcessProgress {
  running: boolean;
  mode: "auto" | "consistency" | "reference" | "aiAuto" | "aiStyle";
  total: number;
  completed: number;
  currentName?: string;
  failed: Array<{ assetId: string; name: string; reason: string }>;
}

interface ImportReport {
  total: number;
  jpgCount: number;
  rawCount: number;
  duplicateCount: number;
  failed: Array<{ name: string; reason: string }>;
}

export function App() {
  const [initialStoredState] = useState(() => loadStoredState());
  const [assets, setAssets] = useState<PhotoAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [editedPreview, setEditedPreview] = useState<string>();
  const [originalPreview, setOriginalPreview] = useState<string>();
  const [compareMode, setCompareMode] = useState<CompareMode>("edited");
  const [compareSplit, setCompareSplit] = useState(50);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [lastImportReport, setLastImportReport] = useState<ImportReport>();
  const [isRendering, setIsRendering] = useState(false);
  const [status, setStatus] = useState("准备导入 Sony/Nikon JPG");
  const [copiedParams, setCopiedParams] = useState<EditParams>();
  const [historyByAsset, setHistoryByAsset] = useState<Record<string, EditHistory>>({});
  const [openGroups, setOpenGroups] = useState<Record<EditGroupKey, boolean>>(defaultOpenGroups);
  const [batchSelection, setBatchSelection] = useState<Set<string>>(() => new Set());
  const [exportSettings, setExportSettings] = useState<ExportSettings>(() => createDefaultExportSettings());
  const [exportProgress, setExportProgress] = useState<ExportProgress>(() => createIdleExportProgress());
  const [referenceStyle, setReferenceStyle] = useState<ReferenceStyle | undefined>(() =>
    initialStoredState.referenceStyle
      ? {
          assetId: "stored-reference",
          name: initialStoredState.referenceStyle.name,
          edits: normalizeEditParams(initialStoredState.referenceStyle.edits),
          signature: initialStoredState.referenceStyle.signature
        }
      : undefined
  );
  const [customPresets, setCustomPresets] = useState<Preset[]>(() => initialStoredState.customPresets ?? []);
  const [presetName, setPresetName] = useState("");
  const [exportDirectory, setExportDirectory] = useState<string>();
  const [browserExportDirectoryName, setBrowserExportDirectoryName] = useState<string>();
  const [projectStoreSummary, setProjectStoreSummary] = useState<ProjectStoreSummary>();
  const [exportHistory, setExportHistory] = useState<ExportJobHistory[]>([]);
  const [namedProjects, setNamedProjects] = useState<NamedProjectInfo[]>([]);
  const [projectName, setProjectName] = useState("");
  const [batchConsistencySummary, setBatchConsistencySummary] = useState<BatchConsistencySummary>();
  const [batchConsistencyPreview, setBatchConsistencyPreview] = useState<BatchConsistencyPreview>();
  const [consistencyStrength, setConsistencyStrength] = useState(
    () => initialStoredState.workflowSettings.consistencyStrength
  );
  const [referenceStrength, setReferenceStrength] = useState(
    () => initialStoredState.workflowSettings.referenceStrength
  );
  const [aiSettings, setAiSettings] = useState<AiSettingsState>({
    model: "gpt-5.5",
    baseUrl: "https://api.openai.com/v1",
    hasApiKey: false,
    availableModels: []
  });
  const [aiApiKeyDraft, setAiApiKeyDraft] = useState("");
  const [aiModelDraft, setAiModelDraft] = useState("gpt-5.5");
  const [aiBaseUrlDraft, setAiBaseUrlDraft] = useState("https://api.openai.com/v1");
  const [isAiConfigEditing, setIsAiConfigEditing] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [isSavingAiSettings, setIsSavingAiSettings] = useState(false);
  const [isDiagnosingAi, setIsDiagnosingAi] = useState(false);
  const [aiConnectionDiagnostic, setAiConnectionDiagnostic] = useState<AiConnectionDiagnostic>();
  const [isAiTuning, setIsAiTuning] = useState(false);
  const [aiPendingSuggestion, setAiPendingSuggestion] = useState<AiPendingSuggestion>();
  const [aiPanelMessage, setAiPanelMessage] = useState("");
  const [batchProcessProgress, setBatchProcessProgress] = useState<BatchProcessProgress>();
  const [cropDraft, setCropDraft] = useState<CropDraft>();
  const [cropBasePreview, setCropBasePreview] = useState<string>();
  const photoImportInputRef = useRef<HTMLInputElement>(null);
  const cropBaseImageRef = useRef<HTMLImageElement>(null);
  const exportCancelRef = useRef(false);
  const exportAbortControllerRef = useRef<AbortController>();
  const browserExportDirectoryRef = useRef<FileSystemDirectoryHandle>();
  const importDesktopPhotoPathsRef = useRef<(filePaths: string[]) => Promise<void>>(async () => undefined);
  const editDraftRef = useRef<{ assetId: string; before: EditParams; after: EditParams }>();
  const batchProcessCancelRef = useRef(false);
  const assetsRef = useRef<PhotoAsset[]>([]);
  const previewRenderJobRef = useRef(0);
  const originalPreviewCacheRef = useRef<Map<string, string>>(new Map());
  const cropInteractionRef = useRef<CropInteraction>();

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedId) ?? assets[0],
    [assets, selectedId]
  );
  const batchTargets = useMemo(
    () => (batchSelection.size > 0 ? assets.filter((asset) => batchSelection.has(asset.id)) : assets),
    [assets, batchSelection]
  );
  const editableBatchTargets = useMemo(() => batchTargets.filter((asset) => asset.isEditable), [batchTargets]);
  const previewEditableBatchTargets = useMemo(
    () => batchTargets.filter((asset) => asset.isEditable || asset.previewKind === "raw_embedded"),
    [batchTargets]
  );
  const selectedAssetEditable = selectedAsset?.isEditable ?? false;
  const selectedAssetRawAiCapable = selectedAsset?.sourceFormat === "raw" && selectedAsset.previewKind === "raw_embedded";
  const selectedAssetAiCapable = Boolean(selectedAssetEditable || selectedAssetRawAiCapable);
  const selectedAssetReferenceCapable = selectedAssetAiCapable;
  const selectedAssetPreviewEditable = selectedAssetAiCapable;
  const selectedAssetPreviewExportable = Boolean(selectedAssetEditable || selectedAssetRawAiCapable);
  const isCropEditing = Boolean(selectedAsset && cropDraft?.assetId === selectedAsset.id);
  const rawBatchSkipCount = batchTargets.length - editableBatchTargets.length;
  const previewBatchSkipCount = batchTargets.length - previewEditableBatchTargets.length;
  const isBatchProcessing = batchProcessProgress?.running ?? false;
  const rawDisabledReason = "RAW 已进入项目模型；当前阶段可查看内嵌预览、运行 AI 候选、做预览级手动调色并导出预览级 JPG；完整 RAW 显影和 RAW 输出仍在最后阶段。";
  const rawAiDisabledReason = selectedAssetRawAiCapable
    ? "将使用 RAW 内嵌 JPEG 预览运行 AI，结果可作为候选参数保存；这还不是完整 RAW 显影。"
    : "该 RAW 暂无可用内嵌 JPEG 预览，AI 需要可见预览图后才能运行。";
  const rawExportDisabledReason = selectedAssetRawAiCapable
    ? "将从 RAW 内嵌 JPEG 预览导出 JPG；这不是完整 RAW 显影导出。"
    : "该 RAW 暂无可用内嵌 JPEG 预览，不能导出预览级 JPG。";
  const rawActionTitle = selectedAsset && !selectedAssetEditable ? rawDisabledReason : undefined;
  const aiActionTitle =
    selectedAsset && !selectedAssetEditable ? (selectedAssetAiCapable ? rawAiDisabledReason : rawAiDisabledReason) : undefined;
  const referenceActionTitle =
    selectedAsset && !selectedAssetEditable ? (selectedAssetReferenceCapable ? rawAiDisabledReason : rawDisabledReason) : undefined;
  const exportActionTitle =
    selectedAsset && !selectedAssetEditable
      ? selectedAssetPreviewExportable
        ? rawExportDisabledReason
        : rawDisabledReason
      : "导出当前图片";
  const toggleGroup = (group: EditGroupKey) => {
    setOpenGroups((current) => ({ ...current, [group]: !current[group] }));
  };

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(
    () => () => {
      releaseAssetObjectUrls(assetsRef.current);
      disposePreviewWorker();
    },
    []
  );

  useEffect(() => {
    if (!isTauriRuntime()) {
      setAiPanelMessage("AI 调色仅在桌面端可用");
      return;
    }

    let cancelled = false;
    getAiSettings()
      .then((settings) => {
        if (cancelled) return;
        setAiSettings(settings);
        setAiModelDraft(settings.model);
        setAiBaseUrlDraft(sanitizeAiBaseUrlForDisplay(settings.baseUrl));
        setIsAiConfigEditing(!settings.hasApiKey || settings.availableModels.length === 0);
        setAiPanelMessage(
          settings.hasApiKey && settings.availableModels.length > 0
            ? `AI 设置已就绪，可用模型 ${settings.availableModels.length} 个`
            : "请先保存 API key 和 Base URL"
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setAiPanelMessage(error instanceof Error ? error.message : "AI 设置读取失败");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setAiPendingSuggestion(undefined);
  }, [selectedId]);

  const getControlValue = (control: EditControl) => {
    if (!selectedAsset) return 0;
    const value = selectedAsset.edits[control.key];
    return typeof value === "number" ? value : createDefaultEditParams()[control.key];
  };

  const normalizeControlValue = (control: EditControl, value: number) => {
    const fallback = getControlValue(control);
    const nextValue = Number.isFinite(value) ? value : fallback;
    return clamp(roundToStep(nextValue, control.step ?? 1), control.min, control.max);
  };

  useEffect(() => {
    if (!selectedAsset) {
      setEditedPreview(undefined);
      setOriginalPreview(undefined);
      return;
    }
    if (!selectedAsset.isEditable) {
      setOriginalPreview(selectedAsset.previewUrl);
      if (selectedAsset.previewKind !== "raw_embedded" || valuesAreEqual(selectedAsset.edits, createDefaultEditParams())) {
        setEditedPreview(undefined);
        setIsRendering(false);
        return;
      }

      let cancelled = false;
      const abortController = new AbortController();
      const renderJobId = previewRenderJobRef.current + 1;
      previewRenderJobRef.current = renderJobId;
      const timer = window.setTimeout(() => {
        if (cancelled || previewRenderJobRef.current !== renderJobId) return;
        setIsRendering(true);
        renderImageSourceWithEdits(selectedAsset.previewUrl, selectedAsset.edits, {
          maxEdge: 1200,
          quality: 0.86,
          signal: abortController.signal
        })
          .then((preview) => {
            if (!cancelled && previewRenderJobRef.current === renderJobId) setEditedPreview(preview);
          })
          .catch((error) => {
            if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
              setStatus(error instanceof Error ? error.message : "RAW AI 候选预览渲染失败");
            }
          })
          .finally(() => {
            if (!cancelled && previewRenderJobRef.current === renderJobId) setIsRendering(false);
          });
      }, 70);
      return () => {
        cancelled = true;
        abortController.abort();
        window.clearTimeout(timer);
      };
    }

    let cancelled = false;
    const abortController = new AbortController();
    const renderJobId = previewRenderJobRef.current + 1;
    previewRenderJobRef.current = renderJobId;
    const timer = window.setTimeout(() => {
      if (cancelled || previewRenderJobRef.current !== renderJobId) return;
      setIsRendering(true);
      const cachedOriginalPreview = originalPreviewCacheRef.current.get(selectedAsset.id);
      const originalPreviewPromise = cachedOriginalPreview
        ? Promise.resolve(cachedOriginalPreview)
        : renderPreviewWithWorkerFallback(selectedAsset, createDefaultEditParams(), {
            signal: abortController.signal
          }).then((original) => {
            originalPreviewCacheRef.current.set(selectedAsset.id, original);
            return original;
          });
      Promise.all([
        renderPreviewWithWorkerFallback(selectedAsset, selectedAsset.edits, {
          signal: abortController.signal
        }),
        originalPreviewPromise
      ])
        .then(([edited, original]) => {
          if (!cancelled && previewRenderJobRef.current === renderJobId) {
            setEditedPreview(edited);
            setOriginalPreview(original);
          }
        })
        .catch((error) => {
          if (!cancelled && previewRenderJobRef.current === renderJobId) {
            setStatus(error instanceof Error ? error.message : "预览渲染失败");
          }
        })
        .finally(() => {
          if (!cancelled && previewRenderJobRef.current === renderJobId) setIsRendering(false);
        });
    }, 70);

    return () => {
      cancelled = true;
      abortController.abort();
      window.clearTimeout(timer);
    };
  }, [selectedAsset]);

  useEffect(() => {
    setAiPendingSuggestion(undefined);
    editDraftRef.current = undefined;
    cropInteractionRef.current = undefined;
    setCropDraft(undefined);
    setCropBasePreview(undefined);
  }, [selectedAsset?.id]);

  useEffect(() => {
    if (!selectedAsset || !isCropEditing) {
      setCropBasePreview(undefined);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    const neutralEdits = createCropNeutralEdits(selectedAsset.edits);
    const render = selectedAsset.isEditable
      ? renderPreviewWithWorkerFallback(selectedAsset, neutralEdits, {
          maxEdge: 1800,
          quality: 0.9,
          signal: abortController.signal
        })
      : selectedAsset.previewKind === "raw_embedded"
        ? renderImageSourceWithEdits(selectedAsset.previewUrl, neutralEdits, {
            maxEdge: 1200,
            quality: 0.86,
            signal: abortController.signal
          })
        : Promise.resolve(selectedAsset.previewUrl);

    render
      .then((preview) => {
        if (!cancelled) setCropBasePreview(preview);
      })
      .catch((error) => {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          setStatus(error instanceof Error ? error.message : "裁切预览渲染失败");
        }
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [selectedAsset, isCropEditing]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__AUTO_PHOTO_INJECT_AI_SETTINGS__ = (settings: AiSettingsState, editing?: boolean) => {
      const nextSettings = {
        ...settings,
        baseUrl: sanitizeAiBaseUrlForDisplay(settings.baseUrl)
      };
      setAiSettings(nextSettings);
      setAiModelDraft(nextSettings.model);
      setAiBaseUrlDraft(nextSettings.baseUrl);
      setAiApiKeyDraft("");
      setIsAiConfigEditing(editing ?? !(nextSettings.hasApiKey && nextSettings.availableModels.length > 0));
      setAiPanelMessage(
        nextSettings.hasApiKey && nextSettings.availableModels.length > 0
          ? `AI 设置已就绪，可用模型 ${nextSettings.availableModels.length} 个`
          : "请先保存 API key 和 Base URL"
      );
    };
    return () => {
      if (window.__AUTO_PHOTO_INJECT_AI_SETTINGS__) {
        delete window.__AUTO_PHOTO_INJECT_AI_SETTINGS__;
      }
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__AUTO_PHOTO_INJECT_AI_SUGGESTION__ = async (result: Partial<AiTuningResult>) => {
      if (!selectedAsset || !selectedAssetAiCapable) return undefined;
      const suggestion: AiTuningResult = {
        model: result.model ?? "diagnostic-local",
        summary: result.summary ?? "Local diagnostic AI candidate",
        params: result.params ?? {
          exposure: 12,
          temperature: -6,
          contrast: 8,
          vibrance: 10
        }
      };
      const params = normalizeAiSuggestionParams(selectedAsset.edits, suggestion);
      const previewUrl = await renderAssetAiCandidatePreview(selectedAsset, params);
      setAiPendingSuggestion({
        mode: "autoColor",
        assetId: selectedAsset.id,
        assetName: selectedAsset.name,
        model: suggestion.model,
        summary: suggestion.summary,
        params,
        previewUrl
      });
      setAiPanelMessage("AI diagnostic candidate generated; current photo is not changed yet");
      setStatus("AI diagnostic candidate generated; current photo is not changed yet");
      return {
        ...suggestion,
        params
      };
    };
    return () => {
      if (window.__AUTO_PHOTO_INJECT_AI_SUGGESTION__) {
        delete window.__AUTO_PHOTO_INJECT_AI_SUGGESTION__;
      }
    };
  }, [selectedAsset]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__ = (diagnostic: AiConnectionDiagnostic) => {
      setAiConnectionDiagnostic(diagnostic);
      setAiPanelMessage(diagnostic.message);
    };
    return () => {
      if (window.__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__) {
        delete window.__AUTO_PHOTO_INJECT_AI_CONNECTION_DIAGNOSTIC__;
      }
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__AUTO_PHOTO_INJECT_EXPORT_HISTORY__ = (history: ExportJobHistory[]) => {
      setExportHistory(history);
    };
    return () => {
      if (window.__AUTO_PHOTO_INJECT_EXPORT_HISTORY__) {
        delete window.__AUTO_PHOTO_INJECT_EXPORT_HISTORY__;
      }
    };
  }, []);

  useEffect(() => {
    if (isTauriRuntime()) {
      void refreshNamedProjects();
      void refreshExportHistory();
    }
  }, []);

  useEffect(() => {
    if (selectedId || Object.keys(initialStoredState.editsByAssetName).length === 0) return;
    setSelectedId(initialStoredState.selectedAssetId);
  }, [initialStoredState, selectedId]);

  useEffect(() => {
    saveStoredState({
      selectedAssetId: selectedId,
      editsByAssetName: Object.fromEntries(assets.map((asset) => [asset.name, asset.edits])),
      customPresets,
      workflowSettings: {
        referenceStrength,
        consistencyStrength
      },
      referenceStyle: referenceStyle
        ? {
            name: referenceStyle.name,
            edits: referenceStyle.edits,
            signature: referenceStyle.signature
          }
        : undefined
    });
  }, [assets, selectedId, customPresets, referenceStrength, consistencyStrength, referenceStyle]);

  const importFiles = async (fileList: FileList | File[], presetFailed: ImportReport["failed"] = [], totalOverride?: number) => {
    const candidates = Array.from(fileList);
    const unsupported = candidates
      .filter((file) => !isSupportedPhotoFile(file))
      .map((file) => ({ name: file.name, reason: "不支持的格式，仅支持 JPG/JPEG、Sony ARW、Nikon NEF" }));
    const files = candidates.filter(isSupportedPhotoFile);
    if (files.length === 0) {
      setLastImportReport({
        total: totalOverride ?? candidates.length,
        jpgCount: 0,
        rawCount: 0,
        duplicateCount: 0,
        failed: [...presetFailed, ...unsupported]
      });
      const failed = [...presetFailed, ...unsupported];
      setStatus(
        failed.length > 0
          ? `导入失败：${failed.slice(0, 2).map((item) => `${item.name} ${item.reason}`).join("；")}`
          : "请选择 JPG/JPEG 或 Sony/Nikon RAW 文件"
      );
      return;
    }

    setIsImporting(true);
    setLastImportReport(undefined);
    setStatus(`正在导入 ${files.length} 个受支持文件`);

    try {
      const imported: PhotoAsset[] = [];
      let duplicateCount = 0;
      const failed: ImportReport["failed"] = [...presetFailed, ...unsupported];
      const knownHashes = new Set(assets.map((asset) => asset.fileHash));
      for (const file of files) {
        try {
          const fileHash = await calculateFileHash(file);
          if (knownHashes.has(fileHash)) {
            duplicateCount += 1;
            continue;
          }
          const asset = await importPhotoFile(file, fileHash);
          knownHashes.add(fileHash);
          imported.push(asset);
        } catch (error) {
          failed.push({ name: file.name, reason: error instanceof Error ? error.message : "读取失败" });
        }
      }

      if (imported.length > 0) {
        setAssets((current) => {
          const next = [...current, ...imported];
          if (!selectedId && next[0]) setSelectedId(next[0].id);
          return next;
        });
      }
      const jpgCount = imported.filter((asset) => asset.sourceFormat === "jpg").length;
      const rawCount = imported.filter((asset) => asset.sourceFormat === "raw").length;
      setLastImportReport({
        total: totalOverride ?? candidates.length,
        jpgCount,
        rawCount,
        duplicateCount,
        failed
      });
      const duplicateText = duplicateCount > 0 ? `, skipped duplicates ${duplicateCount}` : "";
      const failedText = failed.length > 0 ? `, failed ${failed.length}` : "";
      setStatus(`Imported JPG ${jpgCount}, RAW ${rawCount}${duplicateText}${failedText}; originals unchanged`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      setIsImporting(false);
      setIsDragActive(false);
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void importFiles(event.target.files);
    event.target.value = "";
  };

  const importDesktopPhotoPaths = async (filePaths: string[]) => {
    if (filePaths.length === 0) return;
    const supportedPaths = filePaths.filter(isSupportedDesktopPhotoPath);
    const unsupportedPathFailures: ImportReport["failed"] = filePaths
      .filter((filePath) => !isSupportedDesktopPhotoPath(filePath))
      .map((filePath) => ({
        name: desktopPathName(filePath),
        reason: "不支持的格式，仅支持 JPG/JPEG、Sony ARW、Nikon NEF"
      }));
    const limitedPaths = supportedPaths.slice(0, MAX_DESKTOP_IMPORT_PATHS);
    const overflowFailures: ImportReport["failed"] = supportedPaths.slice(MAX_DESKTOP_IMPORT_PATHS).map((filePath) => ({
      name: desktopPathName(filePath),
      reason: `一次最多导入 ${MAX_DESKTOP_IMPORT_PATHS} 个文件，请分批导入`
    }));
    const presetFailed = [...unsupportedPathFailures, ...overflowFailures];
    if (limitedPaths.length === 0) {
      await importFiles([], presetFailed, filePaths.length);
      return;
    }

    try {
      setIsImporting(true);
      setIsDragActive(false);
      setStatus(`正在读取 ${limitedPaths.length} 个桌面文件`);
      const selectedFiles: Awaited<ReturnType<typeof readPhotoFiles>> = [];
      const desktopReadFailures: ImportReport["failed"] = [];
      for (const filePath of limitedPaths) {
        try {
          selectedFiles.push(...(await readPhotoFiles([filePath])));
        } catch (error) {
          desktopReadFailures.push({
            name: desktopPathName(filePath),
            reason: error instanceof Error ? error.message : "读取桌面照片文件失败"
          });
        }
      }
      const files: File[] = [];
      const desktopPayloadFailures: ImportReport["failed"] = [];
      for (const photo of selectedFiles) {
        try {
          files.push(desktopPhotoPayloadToFile(photo));
        } catch (error) {
          desktopPayloadFailures.push({
            name: photo.name,
            reason: error instanceof Error ? error.message : "桌面照片数据转换失败"
          });
        }
      }
      setIsImporting(false);
      await importFiles(files, [...presetFailed, ...desktopReadFailures, ...desktopPayloadFailures], filePaths.length);
    } catch (error) {
      setIsImporting(false);
      setIsDragActive(false);
      setStatus(error instanceof Error ? error.message : "读取桌面照片文件失败");
    }
  };
  importDesktopPhotoPathsRef.current = importDesktopPhotoPaths;

  const choosePhotoFiles = async () => {
    if (isImporting) return;
    if (!isTauriRuntime()) {
      photoImportInputRef.current?.click();
      return;
    }

    try {
      const filePaths = await choosePhotoFilePaths();
      if (filePaths.length === 0) {
        setStatus("未选择照片文件");
        return;
      }

      await importDesktopPhotoPaths(filePaths);
    } catch (error) {
      setIsImporting(false);
      setIsDragActive(false);
      setStatus(error instanceof Error ? error.message : "选择照片文件失败");
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void onDesktopPhotoDragDrop((event) => {
      if (event.type === "enter" || event.type === "over") {
        setIsDragActive(true);
        return;
      }
      if (event.type === "drop") {
        setIsDragActive(false);
        void importDesktopPhotoPathsRef.current(event.paths);
        return;
      }
      setIsDragActive(false);
    })
      .then((cleanup) => {
        if (disposed) cleanup?.();
        else unlisten = cleanup;
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : "监听桌面拖放失败");
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.types.includes("Files")) {
      event.dataTransfer.dropEffect = "copy";
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    void importFiles(event.dataTransfer.files);
  };

  const toggleBatchSelection = (assetId: string) => {
    setBatchSelection((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setBatchSelection((current) => {
      if (current.size === assets.length) return new Set();
      return new Set(assets.map((asset) => asset.id));
    });
  };

  const removeAsset = (assetId: string) => {
    const removed = assets.find((asset) => asset.id === assetId);
    if (!removed) return;
    releaseAssetObjectUrls([removed]);
    originalPreviewCacheRef.current.delete(assetId);
    const nextAssets = assets.filter((asset) => asset.id !== assetId);
    setAssets(nextAssets);
    setBatchSelection((current) => {
      const next = new Set(current);
      next.delete(assetId);
      return next;
    });
    setHistoryByAsset((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
    if (selectedId === assetId) setSelectedId(nextAssets[0]?.id);
    if (referenceStyle?.assetId === assetId) setReferenceStyle(undefined);
    if (aiPendingSuggestion?.assetId === assetId) setAiPendingSuggestion(undefined);
    setStatus(`已移除图片：${removed.name}`);
  };

  const clearAssets = () => {
    if (assets.length === 0) return;
    releaseAssetObjectUrls(assets);
    originalPreviewCacheRef.current.clear();
    setAssets([]);
    setSelectedId(undefined);
    setBatchSelection(new Set());
    setHistoryByAsset({});
    setReferenceStyle(undefined);
    setBatchConsistencySummary(undefined);
    setBatchConsistencyPreview(undefined);
    setAiPendingSuggestion(undefined);
    setStatus("已清空当前项目图片，原图文件未被修改");
  };

  const updateSelectedAsset = (updater: (asset: PhotoAsset) => PhotoAsset) => {
    if (!selectedAsset) return;
    setAssets((current) => current.map((asset) => (asset.id === selectedAsset.id ? updater(asset) : asset)));
  };

  const startBatchProcess = (mode: BatchProcessProgress["mode"], total: number) => {
    batchProcessCancelRef.current = false;
    setBatchProcessProgress({ running: true, mode, total, completed: 0, failed: [] });
  };

  const updateBatchProcess = (completed: number, currentName?: string) => {
    setBatchProcessProgress((current) => (current ? { ...current, completed, currentName } : current));
  };

  const recordBatchFailure = (asset: PhotoAsset, reason: string) => {
    setBatchProcessProgress((current) =>
      current
        ? {
            ...current,
            failed: [...current.failed, { assetId: asset.id, name: asset.name, reason }]
          }
        : current
    );
  };

  const finishBatchProcess = () => {
    setBatchProcessProgress((current) => (current ? { ...current, running: false, currentName: undefined } : current));
  };

  const cancelBatchProcess = () => {
    batchProcessCancelRef.current = true;
    setStatus("正在取消批量处理");
  };

  const yieldToUi = () => new Promise((resolve) => window.setTimeout(resolve, 0));

  const retryBatchFailures = async () => {
    const previous = batchProcessProgress;
    if (!previous || previous.running || previous.failed.length === 0) return;
    if (previous.mode === "consistency") {
      setStatus("统一色彩失败项依赖整组锚点，请重新运行统一色彩");
      return;
    }
    if (previous.mode === "reference" && !referenceStyle) {
      setStatus("参考风格已不存在，无法重试失败项");
      return;
    }

    const failedIds = new Set(previous.failed.map((item) => item.assetId));
    const retryTargets = assets.filter((asset) => failedIds.has(asset.id) && (asset.isEditable || asset.previewKind === "raw_embedded"));
    if (retryTargets.length === 0) {
      setStatus("没有可重试的失败项");
      return;
    }

    startBatchProcess(previous.mode, retryTargets.length);
    setStatus(`正在重试 ${retryTargets.length} 个失败项`);

    const next: PhotoAsset[] = [];
    let completed = 0;
    let failedCount = 0;
    for (const asset of assets) {
      if (!failedIds.has(asset.id)) {
        next.push(asset);
        continue;
      }
      if (batchProcessCancelRef.current) {
        next.push(asset);
        continue;
      }

      updateBatchProcess(completed, asset.name);
      try {
        if (previous.mode === "auto") {
          const analysis = await analyzeAssetForAi(asset);
          const result = createAutoEdit(asset, analysis);
          next.push({ ...asset, edits: result.edits, autoSummary: result.summary });
        } else if (previous.mode === "aiAuto" || previous.mode === "aiStyle") {
          if (previous.mode === "aiStyle" && !referenceStyle) throw new Error("参考风格已不存在");
          const mode: AiTuningMode = previous.mode === "aiStyle" ? "styleMatch" : "autoColor";
          const result = await createLocalAiCandidate(asset, mode, aiInstruction, mode === "styleMatch" ? referenceStyle : undefined);
          const edits = normalizeAiSuggestionParams(asset.edits, result);
          next.push({
            ...asset,
            edits,
            autoSummary: [
              previous.mode === "aiStyle" ? "已重试批量 AI 追色" : "已重试批量 AI 调色",
              result.summary
            ]
          });
        } else {
          const edits = await createReferenceEdit(asset, referenceStyle as ReferenceStyle);
          next.push({
            ...asset,
            edits,
            autoSummary: [
              `重试应用参考风格：${(referenceStyle as ReferenceStyle).name}`,
              `参考强度：${referenceStrength}%`,
              (referenceStyle as ReferenceStyle).signature ? "已匹配参考图色彩签名" : "使用旧版参考参数"
            ]
          });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "重试失败";
        failedCount += 1;
        recordBatchFailure(asset, reason);
        next.push({ ...asset, autoSummary: [`重试失败：${reason}`] });
      }
      completed += 1;
      updateBatchProcess(completed, asset.name);
      await yieldToUi();
    }

    setAssets(next);
    finishBatchProcess();
    setStatus(
      batchProcessCancelRef.current
        ? `Retry cancelled, completed ${completed}/${retryTargets.length}`
        : `Retry completed ${retryTargets.length - failedCount}/${retryTargets.length}${failedCount > 0 ? `, failed ${failedCount}` : ""}`
    );
  };

  const commitSelectedEdits = (edits: EditParams, autoSummary?: string[]) => {
    if (!selectedAsset) return;
    const before = normalizeEditParams(selectedAsset.edits);
    const normalizedEdits = normalizeEditParams(edits);
    if (valuesAreEqual(before, normalizedEdits)) return;
    setHistoryByAsset((current) => ({
      ...current,
      [selectedAsset.id]: {
        past: [...(current[selectedAsset.id]?.past ?? []), before].slice(-40),
        future: []
      }
    }));
    updateSelectedAsset((asset) => ({
      ...asset,
      edits: normalizedEdits,
      autoSummary: autoSummary ?? asset.autoSummary
    }));
  };

  const previewSelectedEdits = (edits: EditParams) => {
    if (!selectedAsset) return;
    const normalizedEdits = normalizeEditParams(edits);
    if (editDraftRef.current?.assetId === selectedAsset.id) {
      editDraftRef.current.after = normalizedEdits;
    }
    updateSelectedAsset((asset) => ({
      ...asset,
      edits: normalizedEdits
    }));
  };

  const beginEditDraft = () => {
    if (!selectedAsset || !selectedAssetPreviewEditable) return;
    if (editDraftRef.current?.assetId === selectedAsset.id) return;
    editDraftRef.current = {
      assetId: selectedAsset.id,
      before: normalizeEditParams(selectedAsset.edits),
      after: normalizeEditParams(selectedAsset.edits)
    };
  };

  const commitEditDraft = (autoSummary?: string[]) => {
    if (!selectedAsset || !editDraftRef.current || editDraftRef.current.assetId !== selectedAsset.id) {
      editDraftRef.current = undefined;
      return;
    }

    const before = normalizeEditParams(editDraftRef.current.before);
    const after = normalizeEditParams(editDraftRef.current.after);
    editDraftRef.current = undefined;
    if (valuesAreEqual(before, after)) return;

    setHistoryByAsset((current) => ({
      ...current,
      [selectedAsset.id]: {
        past: [...(current[selectedAsset.id]?.past ?? []), before].slice(-40),
        future: []
      }
    }));
    updateSelectedAsset((asset) => ({
      ...asset,
      edits: after,
      autoSummary: autoSummary ?? asset.autoSummary
    }));
  };

  const undoSelected = () => {
    if (!selectedAsset) return;
    if (editDraftRef.current?.assetId === selectedAsset.id) {
      const beforeDraft = normalizeEditParams(editDraftRef.current.before);
      const afterDraft = normalizeEditParams(editDraftRef.current.after);
      editDraftRef.current = undefined;
      if (!valuesAreEqual(beforeDraft, afterDraft)) {
        setHistoryByAsset((current) => ({
          ...current,
          [selectedAsset.id]: {
            past: current[selectedAsset.id]?.past ?? [],
            future: [afterDraft, ...(current[selectedAsset.id]?.future ?? [])].slice(0, 40)
          }
        }));
        updateSelectedAsset((asset) => ({ ...asset, edits: beforeDraft, autoSummary: ["已撤销上一步调色"] }));
        setStatus("已撤销上一步调色");
        return;
      }
    }

    const history = historyByAsset[selectedAsset.id];
    const previous = history?.past[history.past.length - 1];
    if (!previous) return;

    setHistoryByAsset((current) => ({
      ...current,
      [selectedAsset.id]: {
        past: current[selectedAsset.id].past.slice(0, -1),
        future: [selectedAsset.edits, ...(current[selectedAsset.id].future ?? [])].slice(0, 40)
      }
    }));
    updateSelectedAsset((asset) => ({ ...asset, edits: previous, autoSummary: ["已撤销上一步调色"] }));
    setStatus("已撤销上一步调色");
  };

  const redoSelected = () => {
    if (!selectedAsset) return;
    const history = historyByAsset[selectedAsset.id];
    const nextEdit = history?.future[0];
    if (!nextEdit) return;

    setHistoryByAsset((current) => ({
      ...current,
      [selectedAsset.id]: {
        past: [...(current[selectedAsset.id]?.past ?? []), selectedAsset.edits].slice(-40),
        future: current[selectedAsset.id].future.slice(1)
      }
    }));
    updateSelectedAsset((asset) => ({ ...asset, edits: nextEdit, autoSummary: ["已重做调色"] }));
    setStatus("已重做调色");
  };

  const runAutoColor = async () => {
    if (!selectedAsset) return;
    if (!selectedAssetPreviewEditable) {
      setStatus(rawDisabledReason);
      return;
    }
    setStatus(`正在分析 ${selectedAsset.name}`);
    const analysis = await analyzeAssetForAi(selectedAsset);
    const result = createAutoEdit(selectedAsset, analysis);
    commitSelectedEdits(result.edits, result.summary);
    setStatus(selectedAsset.isEditable ? "已生成本地自动调色参数" : "已基于 RAW 内嵌预览生成本地自动调色参数");
  };

  const runBatchAutoColor = async () => {
    if (previewEditableBatchTargets.length === 0) return;
    const targetIds = new Set(previewEditableBatchTargets.map((asset) => asset.id));
    startBatchProcess("auto", previewEditableBatchTargets.length);
    setStatus(`正在批量分析 ${previewEditableBatchTargets.length} 张 JPG/RAW 预览`);
    const next: PhotoAsset[] = [];
    let completed = 0;
    let failedCount = 0;
    for (const asset of assets) {
      if (!targetIds.has(asset.id)) {
        next.push(asset);
        continue;
      }
      if (batchProcessCancelRef.current) {
        next.push(asset);
        continue;
      }
      updateBatchProcess(completed, asset.name);
      try {
        const analysis = await analyzeAssetForAi(asset);
        const result = createAutoEdit(asset, analysis);
        next.push({ ...asset, edits: result.edits, autoSummary: result.summary });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "批量自动失败";
        failedCount += 1;
        recordBatchFailure(asset, reason);
        next.push({ ...asset, autoSummary: [`批量自动失败：${reason}`] });
      }
      completed += 1;
      updateBatchProcess(completed, asset.name);
      await yieldToUi();
    }
    setAssets(next);
    finishBatchProcess();
    setStatus(
      batchProcessCancelRef.current
        ? `Batch auto cancelled, completed ${completed}/${previewEditableBatchTargets.length}`
        : `Batch auto completed ${previewEditableBatchTargets.length - failedCount}/${previewEditableBatchTargets.length} JPG/RAW preview${failedCount > 0 ? `, failed ${failedCount}` : ""}${previewBatchSkipCount > 0 ? `, skipped unavailable RAW ${previewBatchSkipCount}` : ""}`
    );
  };

  const getCaptureHourBucket = (asset: PhotoAsset) => {
    const value = asset.metadata.dateTimeOriginal;
    if (!value) return "未知时间";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知时间";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(
      date.getHours()
    ).padStart(2, "0")}:00`;
  };

  const getConsistencyGroupKey = (asset: PhotoAsset) => {
    const model = asset.metadata.model ?? "未知机身";
    return `${asset.cameraBrand}|${model}|${getCaptureHourBucket(asset)}`;
  };

  const getConsistencyGroupLabel = (asset: PhotoAsset) => {
    const model = asset.metadata.model ?? "未知机身";
    return `${asset.cameraBrand} · ${model} · ${getCaptureHourBucket(asset)}`;
  };

  const blendWithGroupAnchor = (autoEdit: EditParams, anchor: Partial<EditParams>, strengthPercent = consistencyStrength) => {
    const strength = clamp(strengthPercent / 100, 0.25, 1);
    const exposureWeight = 0.08 + strength * 0.18;
    const toneWeight = 0.16 + strength * 0.26;
    const colorWeight = 0.34 + strength * 0.56;
    const saturationWeight = 0.2 + strength * 0.38;

    return mergeEditParams(autoEdit, {
      exposure: clamp(autoEdit.exposure * (1 - exposureWeight) + (anchor.exposure ?? autoEdit.exposure) * exposureWeight, -50, 50),
      temperature: clamp(autoEdit.temperature * (1 - colorWeight) + (anchor.temperature ?? autoEdit.temperature) * colorWeight, -50, 50),
      tint: clamp(autoEdit.tint * (1 - colorWeight) + (anchor.tint ?? autoEdit.tint) * colorWeight, -50, 50),
      contrast: clamp(autoEdit.contrast * (1 - toneWeight) + (anchor.contrast ?? autoEdit.contrast) * toneWeight, -50, 50),
      highlights: clamp(autoEdit.highlights * (1 - toneWeight) + (anchor.highlights ?? autoEdit.highlights) * toneWeight, -60, 40),
      shadows: clamp(autoEdit.shadows * (1 - toneWeight) + (anchor.shadows ?? autoEdit.shadows) * toneWeight, -40, 60),
      saturation: clamp(autoEdit.saturation * (1 - saturationWeight) + (anchor.saturation ?? autoEdit.saturation) * saturationWeight, -50, 50),
      vibrance: clamp(autoEdit.vibrance * (1 - saturationWeight) + (anchor.vibrance ?? autoEdit.vibrance) * saturationWeight, -50, 50),
      skinProtection: Math.max(autoEdit.skinProtection, anchor.skinProtection ?? autoEdit.skinProtection)
    });
  };

  const buildConsistencyEdits = (groups: BatchConsistencyGroupPreview[]) => {
    const editsByAssetId: Record<string, EditParams> = {};
    for (const group of groups) {
      for (const assetId of group.assetIds) {
        const autoEdit = group.autoEditsByAssetId[assetId];
        if (autoEdit) editsByAssetId[assetId] = blendWithGroupAnchor(autoEdit, group.anchor, group.strength);
      }
    }
    return editsByAssetId;
  };

  const formatConsistencyLabels = (groups: BatchConsistencyGroupPreview[]) =>
    groups.slice(0, 4).map((group) => `${group.label}: ${group.assetIds.length} - ${group.strength}%`);

  const runBatchConsistency = async () => {
    if (editableBatchTargets.length === 0) return;
    setBatchConsistencyPreview(undefined);
    startBatchProcess("consistency", editableBatchTargets.length);
    setStatus(`Generating consistency preview for ${editableBatchTargets.length} JPG files`);

    const analyzed: ConsistencyAnalysisItem[] = [];
    let completed = 0;
    let failedCount = 0;
    for (const asset of editableBatchTargets) {
      if (batchProcessCancelRef.current) {
        finishBatchProcess();
        setStatus(`已取消统一色彩，已分析 ${completed}/${editableBatchTargets.length} 张，未应用新参数`);
        return;
      }
      updateBatchProcess(completed, asset.name);
      try {
        const analysis = await analyzeImage(asset);
        const auto = createAutoEdit(asset, analysis);
        analyzed.push({
          asset,
          autoEdit: auto.edits,
          groupKey: getConsistencyGroupKey(asset),
          groupLabel: getConsistencyGroupLabel(asset)
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "统一色彩分析失败";
        failedCount += 1;
        recordBatchFailure(asset, reason);
      }
      completed += 1;
      updateBatchProcess(completed, asset.name);
      await yieldToUi();
    }

    if (analyzed.length === 0) {
      finishBatchProcess();
      setStatus(`Consistency failed: ${failedCount} images could not be analyzed`);
      return;
    }

    const groups = new Map<string, typeof analyzed>();
    for (const item of analyzed) {
      groups.set(item.groupKey, [...(groups.get(item.groupKey) ?? []), item]);
    }

    const groupPreviews: BatchConsistencyGroupPreview[] = [];
    for (const [groupKey, groupItems] of groups.entries()) {
      const anchor: Partial<EditParams> = {
        exposure: average(groupItems.map((item) => item.autoEdit.exposure)),
        temperature: average(groupItems.map((item) => item.autoEdit.temperature)),
        tint: average(groupItems.map((item) => item.autoEdit.tint)),
        contrast: average(groupItems.map((item) => item.autoEdit.contrast)),
        highlights: average(groupItems.map((item) => item.autoEdit.highlights)),
        shadows: average(groupItems.map((item) => item.autoEdit.shadows)),
        saturation: average(groupItems.map((item) => item.autoEdit.saturation)),
        vibrance: average(groupItems.map((item) => item.autoEdit.vibrance)),
        skinProtection: Math.max(...groupItems.map((item) => item.autoEdit.skinProtection))
      };
      groupPreviews.push({
        key: groupKey,
        label: groupItems[0].groupLabel,
        assetIds: groupItems.map((item) => item.asset.id),
        strength: consistencyStrength,
        anchor,
        autoEditsByAssetId: Object.fromEntries(groupItems.map((item) => [item.asset.id, item.autoEdit]))
      });
    }

    const preview: BatchConsistencyPreview = {
      editsByAssetId: buildConsistencyEdits(groupPreviews),
      groups: groupPreviews,
      groupCount: groups.size,
      assetCount: analyzed.length,
      skippedRaw: rawBatchSkipCount,
      strength: consistencyStrength,
      labels: formatConsistencyLabels(groupPreviews),
      failedCount
    };
    setBatchConsistencyPreview(preview);
    setStatus(`Generated consistency preview: ${groups.size} groups, ${analyzed.length} JPG${failedCount > 0 ? `, failed ${failedCount}` : ""}${rawBatchSkipCount > 0 ? `, skipped RAW ${rawBatchSkipCount}` : ""}; confirm to apply`);
    finishBatchProcess();
  };

  const applyBatchConsistencyPreview = () => {
    if (!batchConsistencyPreview) return;
    const preview = batchConsistencyPreview;
    setAssets((current) =>
      current.map((asset) =>
        preview.editsByAssetId[asset.id]
          ? {
              ...asset,
              edits: preview.editsByAssetId[asset.id],
              autoSummary: ["已应用批量一致性色彩锚点", `分组：${getConsistencyGroupLabel(asset)}`]
            }
          : asset
      )
    );
    setBatchConsistencySummary({
      groupCount: preview.groupCount,
      assetCount: preview.assetCount,
      skippedRaw: preview.skippedRaw,
      strength: preview.strength,
      hasCustomStrengths: preview.hasCustomStrengths,
      labels: preview.labels
    });
    setStatus(`Applied consistency: ${preview.groupCount} groups, ${preview.assetCount} JPG${preview.failedCount > 0 ? `, failed ${preview.failedCount}` : ""}${preview.skippedRaw > 0 ? `, skipped RAW ${preview.skippedRaw}` : ""}`);
    setBatchConsistencyPreview(undefined);
  };

  const updateBatchConsistencyGroupStrength = (groupKey: string, strength: number) => {
    setBatchConsistencyPreview((current) => {
      if (!current) return current;
      const groups = current.groups.map((group) =>
        group.key === groupKey ? { ...group, strength: Math.round(clamp(strength, 25, 100)) } : group
      );
      const hasCustomStrengths = groups.some((group) => group.strength !== current.strength);
      return {
        ...current,
        groups,
        hasCustomStrengths,
        labels: formatConsistencyLabels(groups),
        editsByAssetId: buildConsistencyEdits(groups)
      };
    });
  };

  const cancelBatchConsistencyPreview = () => {
    if (!batchConsistencyPreview) return;
    setStatus(`Cancelled consistency preview; ${batchConsistencyPreview.assetCount} JPG unchanged${batchConsistencyPreview.skippedRaw > 0 ? `, skipped RAW ${batchConsistencyPreview.skippedRaw}` : ""}`);
    setBatchConsistencyPreview(undefined);
  };

  const applyPreset = (params: Partial<EditParams>) => {
    if (!selectedAsset || !selectedAssetPreviewEditable) return;
    commitSelectedEdits(mergeEditParams(selectedAsset.edits, params), ["应用预设参数"]);
  };

  const saveCustomPreset = () => {
    if (!selectedAsset || !selectedAssetPreviewEditable) return;
    const name = presetName.trim() || `自定义 ${customPresets.length + 1}`;
    const preset: Preset = {
      id: `custom-${Date.now()}`,
      name,
      description: `来自 ${selectedAsset.name}`,
      params: selectedAsset.edits
    };
    setCustomPresets((current) => [preset, ...current].slice(0, 30));
    setPresetName("");
    setStatus(`已保存自定义预设：${name}`);
  };

  const deleteCustomPreset = (presetId: string) => {
    setCustomPresets((current) => current.filter((preset) => preset.id !== presetId));
    setStatus("已删除自定义预设");
  };

  const setCurrentAsReference = async () => {
    if (!selectedAsset || !selectedAssetReferenceCapable) return;
    try {
      setStatus(`正在分析参考风格：${selectedAsset.name}`);
      const analysis = await analyzeAssetForAi(selectedAsset);
      setReferenceStyle({
        assetId: selectedAsset.id,
        name: selectedAsset.name,
        edits: selectedAsset.edits,
        signature: createReferenceColorSignature(analysis, selectedAsset.edits)
      });
      setStatus(`Reference style set from ${selectedAsset.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "参考风格分析失败");
    }
  };

  const analyzeAssetForAi = async (asset: PhotoAsset) => {
    if (asset.isEditable) return analyzeImage(asset);
    if (asset.previewKind === "raw_embedded") return analyzeImageSource(asset.previewUrl);
    throw new Error("该 RAW 暂无可用内嵌预览，无法运行 AI");
  };

  const renderAssetForAiRequest = async (asset: PhotoAsset, edits: EditParams) => {
    if (asset.isEditable) {
      return renderPreviewWithWorkerFallback(asset, edits, {
        maxEdge: 960,
        quality: 0.82
      });
    }
    if (asset.previewKind === "raw_embedded") {
      return renderImageSourceWithEdits(asset.previewUrl, edits, {
        maxEdge: 960,
        quality: 0.82
      });
    }
    throw new Error("该 RAW 暂无可用内嵌预览，无法生成 AI 请求图");
  };

  const renderAssetAiCandidatePreview = async (asset: PhotoAsset, edits: EditParams) => {
    if (asset.isEditable) {
      return renderPreviewWithWorkerFallback(asset, edits, {
        maxEdge: 1200,
        quality: 0.86
      });
    }
    if (asset.previewKind === "raw_embedded") {
      return renderImageSourceWithEdits(asset.previewUrl, edits, {
        maxEdge: 1200,
        quality: 0.86
      });
    }
    throw new Error("该 RAW 暂无可用内嵌预览，无法渲染 AI 候选预览");
  };

  const createReferenceEdit = async (asset: PhotoAsset, reference: ReferenceStyle) => {
    if (!asset.isEditable && asset.previewKind !== "raw_embedded") return asset.edits;
    const analysis = await analyzeAssetForAi(asset);
    const auto = createAutoEdit(asset, analysis).edits;
    const strength = clamp(referenceStrength / 100, 0.2, 1);
    const exposureWeight = 0.28 + strength * 0.32;
    const colorWeight = 0.42 + strength * 0.42;
    const toneWeight = 0.34 + strength * 0.4;
    const signatureWeight = reference.signature ? 0.22 + strength * 0.44 : 0;
    const lumaSignatureCorrection = reference.signature
      ? clamp((reference.signature.styledLuma - analysis.averageLuma) / 18, -12, 12) * signatureWeight
      : 0;
    const warmthSignatureCorrection = reference.signature
      ? clamp((reference.signature.styledWarmBias - analysis.warmBias) * 34, -14, 14) * signatureWeight
      : 0;
    const tintSignatureCorrection = reference.signature
      ? clamp((getGreenBias(analysis) - reference.signature.styledGreenBias) * 42, -12, 12) * signatureWeight
      : 0;
    const skinGuard = reference.signature?.skinLikeRatio && reference.signature.skinLikeRatio > 0.04 ? 6 * signatureWeight : 0;
    return mergeEditParams(reference.edits, {
      exposure: clamp(reference.edits.exposure * exposureWeight + auto.exposure * (1 - exposureWeight) + lumaSignatureCorrection, -50, 50),
      temperature: clamp(
        reference.edits.temperature * colorWeight + auto.temperature * (1 - colorWeight) + warmthSignatureCorrection,
        -50,
        50
      ),
      tint: clamp(reference.edits.tint * colorWeight + auto.tint * (1 - colorWeight) + tintSignatureCorrection, -50, 50),
      highlights: Math.min(reference.edits.highlights, auto.highlights),
      shadows: reference.edits.shadows * toneWeight + auto.shadows * (1 - toneWeight),
      skinProtection: clamp(Math.max(reference.edits.skinProtection, auto.skinProtection) + skinGuard, 0, 100)
    });
  };

  const parseLocalAiIntent = (instruction: string, mode: AiTuningMode): LocalAiIntent => {
    const text = instruction.toLowerCase();
    const hasAny = (words: string[]) => words.some((word) => text.includes(word));
    return {
      warmth:
        (hasAny(["暖", "warm", "金色", "夕阳"]) ? 1 : 0) -
        (hasAny(["冷", "cool", "蓝调", "清冷"]) ? 1 : 0),
      contrast:
        (hasAny(["通透", "清晰", "立体", "contrast", "对比"]) ? 1 : 0) -
        (hasAny(["柔和", "soft", "奶油", "低对比"]) ? 1 : 0),
      saturation:
        (hasAny(["鲜艳", "高饱和", "colorful", "浓郁"]) ? 1 : 0) -
        (hasAny(["低饱和", "淡", "清淡", "muted", "film"]) ? 1 : 0),
      highlightProtection: hasAny(["压高光", "高光", "不过曝", "highlight", "天空", "白纱"]) ? 1 : 0,
      airy: hasAny(["通透", "明亮", "干净", "清新", "airy"]) ? 1 : 0,
      film: hasAny(["胶片", "film", "复古", "颗粒", "cinematic", "电影"]) ? 1 : 0,
      portrait: mode === "autoColor" && hasAny(["人像", "肤色", "皮肤", "磨皮", "美齿", "portrait", "skin"]) ? 1 : 0
    };
  };

  const applyLocalAiIntent = (base: EditParams, analysis: AutoAnalysis, intent: LocalAiIntent, mode: AiTuningMode) => {
    const hasPortrait = intent.portrait > 0 || analysis.skinLikeRatio > 0.04;
    return mergeEditParams(base, {
      exposure: clamp(base.exposure + intent.airy * 3 - intent.film * 1.5, -50, 50),
      temperature: clamp(base.temperature + intent.warmth * 7, -50, 50),
      contrast: clamp(base.contrast + intent.contrast * 5 - intent.film * 3, -50, 50),
      highlights: clamp(base.highlights - intent.highlightProtection * 10 - intent.airy * 3, -60, 40),
      shadows: clamp(base.shadows + intent.airy * 5 + intent.film * 2, -40, 60),
      saturation: clamp(base.saturation + intent.saturation * 6 - intent.film * 4, -50, 50),
      vibrance: clamp(base.vibrance + intent.saturation * 5 + intent.airy * 3 + (hasPortrait ? 3 : 0), -50, 50),
      clarity: clamp(base.clarity + intent.contrast * 2 - (hasPortrait ? 2 : 0), -50, 50),
      texture: clamp(base.texture - (hasPortrait ? 4 : 0) - intent.film * 2, -50, 50),
      grain: clamp(base.grain + intent.film * 10, 0, 50),
      skinProtection: clamp(Math.max(base.skinProtection, hasPortrait ? 84 : base.skinProtection), 0, 100),
      skinSmoothing: clamp(base.skinSmoothing + (hasPortrait ? 14 + intent.portrait * 10 : 0), 0, 100),
      skinTone: clamp(base.skinTone + (hasPortrait ? 6 + intent.warmth * 2 : 0), -50, 50),
      teethWhitening: clamp(base.teethWhitening + (hasPortrait ? 10 : 0), 0, 100),
      clothingWrinkleReduction: clamp(base.clothingWrinkleReduction + (hasPortrait ? 8 : 0), 0, 100),
      vignette: clamp(base.vignette + intent.film * 4, -50, 50)
    });
  };

  const createLocalAiCandidate = async (
    asset: PhotoAsset,
    mode: AiTuningMode,
    instruction: string,
    reference?: ReferenceStyle
  ): Promise<AiTuningResult> => {
    const analysis = await analyzeAssetForAi(asset);
    const intent = parseLocalAiIntent(instruction, mode);
    const base =
      mode === "styleMatch" && reference
        ? await createReferenceEdit(asset, reference)
        : createAutoEdit(asset, analysis).edits;
    const params = applyLocalAiIntent(base, analysis, intent, mode);
    const modeLabel = mode === "styleMatch" ? "本地追色候选" : "本地调色候选";
    const rawNote = asset.previewKind === "raw_embedded" ? "RAW 内嵌预览级，" : "";
    return {
      model: "local-color-science",
      summary: `${modeLabel}：${rawNote}基于图像统计、相机信息、参考风格和调色想法生成，可批量应用。`,
      params
    };
  };

  const applyReferenceToSelected = async () => {
    if (!selectedAsset || !selectedAssetReferenceCapable || !referenceStyle) return;
    setStatus(`正在应用参考风格：${referenceStyle.name}`);
    const edits = await createReferenceEdit(selectedAsset, referenceStyle);
    commitSelectedEdits(edits, [
      `应用参考风格：${referenceStyle.name}`,
      `参考强度：${referenceStrength}%`,
      referenceStyle.signature ? "已匹配参考图色彩签名" : "使用旧版参考参数"
    ]);
    setStatus("已应用参考风格到当前图片");
  };

  const applyReferenceToBatch = async () => {
    if (!referenceStyle || previewEditableBatchTargets.length === 0) return;
    const targetIds = new Set(previewEditableBatchTargets.map((asset) => asset.id));
    const next: PhotoAsset[] = [];
    let completed = 0;
    let failedCount = 0;
    startBatchProcess("reference", previewEditableBatchTargets.length);
    setStatus(`正在应用参考风格到 ${previewEditableBatchTargets.length} 张 JPG/RAW 预览`);

    for (const asset of assets) {
      if (!targetIds.has(asset.id)) {
        next.push(asset);
        continue;
      }
      if (batchProcessCancelRef.current) {
        next.push(asset);
        continue;
      }
      updateBatchProcess(completed, asset.name);
      try {
        const edits = await createReferenceEdit(asset, referenceStyle);
        next.push({
          ...asset,
          edits,
          autoSummary: [
            `应用参考风格：${referenceStyle.name}`,
            `参考强度：${referenceStrength}%`,
            referenceStyle.signature ? "已匹配参考图色彩签名" : "使用旧版参考参数"
          ]
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "参考风格应用失败";
        failedCount += 1;
        recordBatchFailure(asset, reason);
        next.push({ ...asset, autoSummary: [`参考风格应用失败：${reason}`] });
      }
      completed += 1;
      updateBatchProcess(completed, asset.name);
      await yieldToUi();
    }

    setAssets(next);
    finishBatchProcess();
    setStatus(
      batchProcessCancelRef.current
        ? `Reference batch cancelled, completed ${completed}/${previewEditableBatchTargets.length}`
        : `Reference style applied ${previewEditableBatchTargets.length - failedCount}/${previewEditableBatchTargets.length}${failedCount > 0 ? `, failed ${failedCount}` : ""}${previewBatchSkipCount > 0 ? `, skipped unavailable RAW ${previewBatchSkipCount}` : ""}`
    );
  };

  const formatAiNumber = (value: number, digits = 2) => {
    if (!Number.isFinite(value)) return "0";
    return value.toFixed(digits);
  };

  const getCameraSummary = (
    asset: PhotoAsset,
    analysis?: AutoAnalysis,
    localAuto?: { edits: EditParams; summary: string[] },
    reference?: ReferenceStyle
  ) => {
    const cameraLine = [
      asset.cameraBrand,
      asset.metadata.model,
      asset.metadata.lens,
      asset.metadata.iso ? `ISO ${asset.metadata.iso}` : undefined,
      asset.metadata.fNumber ? `f/${asset.metadata.fNumber}` : undefined,
      asset.metadata.exposureTime,
      asset.metadata.focalLength ? `${asset.metadata.focalLength}mm` : undefined
    ]
      .filter(Boolean)
      .join(" · ");
    const greenBias = analysis ? analysis.greenBalance - (analysis.redBalance + analysis.blueBalance) / 2 : 0;
    const analysisLine = analysis
      ? [
          `平均亮度 ${formatAiNumber(analysis.averageLuma, 1)}/255`,
          `红/绿/蓝均衡 ${formatAiNumber(analysis.redBalance)} / ${formatAiNumber(analysis.greenBalance)} / ${formatAiNumber(analysis.blueBalance)}`,
          `暖色偏 ${formatAiNumber(analysis.warmBias)}`,
          `绿偏 ${formatAiNumber(greenBias)}`,
          `肤色候选 ${(analysis.skinLikeRatio * 100).toFixed(1)}%`
        ].join("；")
      : undefined;
    const localAutoLine = localAuto
      ? [
          `本地自动判断：${localAuto.summary.join("、")}`,
          `本地建议 exp ${Math.round(localAuto.edits.exposure)}, temp ${Math.round(localAuto.edits.temperature)}, tint ${Math.round(localAuto.edits.tint)}, contrast ${Math.round(localAuto.edits.contrast)}, skin ${Math.round(localAuto.edits.skinProtection)}`
        ].join("；")
      : undefined;
    const referenceLine = reference
      ? [
          `参考风格 ${reference.name}`,
          `参考参数 exp ${Math.round(reference.edits.exposure)}, temp ${Math.round(reference.edits.temperature)}, tint ${Math.round(reference.edits.tint)}, contrast ${Math.round(reference.edits.contrast)}, saturation ${Math.round(reference.edits.saturation)}, vibrance ${Math.round(reference.edits.vibrance)}`,
          reference.signature
            ? [
                `目标亮度 ${formatAiNumber(reference.signature.styledLuma, 1)}`,
                `目标暖色偏 ${formatAiNumber(reference.signature.styledWarmBias)}`,
                `目标绿偏 ${formatAiNumber(reference.signature.styledGreenBias)}`,
                `参考肤色候选 ${(reference.signature.skinLikeRatio * 100).toFixed(1)}%`
              ].join("，")
            : "参考图没有保存色彩签名"
        ].join("；")
      : undefined;

    return [
      cameraLine ? `相机信息：${cameraLine}` : undefined,
      analysisLine ? `本地图像分析：${analysisLine}` : undefined,
      localAutoLine,
      referenceLine
    ]
      .filter(Boolean)
      .join("\n");
  };

  const saveCurrentAiSettings = async () => {
    if (!isTauriRuntime()) {
      setAiPanelMessage("AI 设置仅在桌面端可保存");
      return;
    }
    if (!aiSettings.hasApiKey && !aiApiKeyDraft.trim()) {
      setAiPanelMessage("请填写 API key，保存后会自动获取模型列表");
      return;
    }
    setIsSavingAiSettings(true);
    setAiPanelMessage("正在保存 AI 设置并获取模型列表");
    try {
      const settings = await saveAiSettings({
        apiKey: aiApiKeyDraft.trim() ? aiApiKeyDraft : undefined,
        model: aiModelDraft,
        baseUrl: sanitizeAiBaseUrlForDisplay(aiBaseUrlDraft)
      });
      setAiSettings(settings);
      setAiModelDraft(settings.model);
      setAiBaseUrlDraft(sanitizeAiBaseUrlForDisplay(settings.baseUrl));
      setAiApiKeyDraft("");
      setAiConnectionDiagnostic(undefined);
      setIsAiConfigEditing(!(settings.hasApiKey && settings.availableModels.length > 0));
      setAiPanelMessage(
        settings.hasApiKey && settings.availableModels.length > 0
          ? `AI 设置已保存，已获取 ${settings.availableModels.length} 个模型`
          : "AI 设置已保存，请继续填写 API key"
      );
      setStatus("AI 设置已保存");
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 设置保存失败";
      setAiPanelMessage(message);
      setStatus(message);
    } finally {
      setIsSavingAiSettings(false);
    }
  };

  const updateAiModelSelection = async (model: string) => {
    setAiModelDraft(model);
    if (!isTauriRuntime() || !aiSettings.hasApiKey || !model) return;
    setIsSavingAiSettings(true);
    setAiPanelMessage("正在切换 AI 模型");
    try {
      const settings = await saveAiSettings({
        model,
        baseUrl: aiSettings.baseUrl
      });
      setAiSettings(settings);
      setAiModelDraft(settings.model);
      setAiBaseUrlDraft(sanitizeAiBaseUrlForDisplay(settings.baseUrl));
      setAiConnectionDiagnostic(undefined);
      setAiPanelMessage(`已切换模型：${settings.model}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 模型切换失败";
      setAiPanelMessage(message);
      setAiModelDraft(aiSettings.model);
    } finally {
      setIsSavingAiSettings(false);
    }
  };

  const runAiConnectionDiagnostic = async () => {
    if (!isTauriRuntime()) {
      setAiPanelMessage("AI 连接诊断仅在桌面端可用");
      return;
    }
    setIsDiagnosingAi(true);
    setAiPanelMessage("正在诊断 AI 连接，不会显示 API key 或私有地址");
    try {
      const diagnostic = await diagnoseAiConnection();
      setAiConnectionDiagnostic(diagnostic);
      setAiPanelMessage(diagnostic.message);
    } catch (error) {
      const explanation = explainAiFailureReason(error instanceof Error ? error.message : "AI 连接诊断失败");
      const diagnostic: AiConnectionDiagnostic = {
        status: "failed",
        hasApiKey: aiSettings.hasApiKey,
        model: aiSettings.model,
        modelAvailable: false,
        modelCount: 0,
        message: `AI 连接诊断失败：${explanation.message}`
      };
      setAiConnectionDiagnostic(diagnostic);
      setAiPanelMessage(diagnostic.message);
    } finally {
      setIsDiagnosingAi(false);
    }
  };

  const runAiTuning = async (mode: AiTuningMode) => {
    if (!selectedAsset || !selectedAssetAiCapable) {
      setAiPanelMessage(selectedAsset ? rawAiDisabledReason : "请先导入可用图片");
      return;
    }
    if (mode === "styleMatch" && !referenceStyle) {
      setAiPanelMessage("请先在参考风格中设置参考图，再运行 AI 追色");
      return;
    }
    const referenceAsset =
      mode === "styleMatch" && referenceStyle
        ? assets.find((asset) => asset.id === referenceStyle.assetId && (asset.isEditable || asset.previewKind === "raw_embedded"))
        : undefined;
    const isReferenceImageAvailable = Boolean(referenceAsset);

    setIsAiTuning(true);
    setAiPendingSuggestion(undefined);
    const modeText = mode === "styleMatch" ? "AI 追色" : "AI 调色";
    setAiPanelMessage(
      mode === "styleMatch" && !isReferenceImageAvailable
        ? "正在生成 AI 追色候选；参考原图不在当前项目中，将使用已保存的参考参数和色彩签名"
        : `正在生成${modeText}候选`
    );
    setStatus(`正在运行${modeText}：${selectedAsset.name}`);
    try {
      const localResult = await createLocalAiCandidate(
        selectedAsset,
        mode,
        aiInstruction,
        mode === "styleMatch" ? referenceStyle : undefined
      );
      let result: AiTuningResult = localResult;
      let fallbackReason = "";
      let fallbackHint = "";

      if (isTauriRuntime() && aiSettings.hasApiKey) {
        try {
          const analysis = await analyzeAssetForAi(selectedAsset);
          const localAuto = createAutoEdit(selectedAsset, analysis);
          const imageDataUrl = await renderAssetForAiRequest(selectedAsset, createDefaultEditParams());
          const referenceDataUrl =
            referenceAsset && referenceStyle
              ? await renderAssetForAiRequest(referenceAsset, referenceStyle.edits)
              : undefined;
          const remoteResult = await tunePhotoWithAi({
            mode,
            assetName: selectedAsset.name,
            cameraSummary: [
              getCameraSummary(selectedAsset, analysis, localAuto, mode === "styleMatch" ? referenceStyle : undefined),
              "请把本地色彩科学候选作为基线，只返回需要调整的安全增量；不要重写为极端风格。",
              mode === "styleMatch" && !isReferenceImageAvailable
                ? "参考图原始文件当前不可用：请基于已保存的参考风格参数、色彩签名和用户调色想法给出保守追色建议。"
                : undefined
            ]
              .filter(Boolean)
              .join("\n"),
            imageDataUrl,
            referenceDataUrl,
            userInstruction: aiInstruction.trim() || undefined,
            currentParams: normalizeAiSuggestionParams(selectedAsset.edits, localResult)
          });
          result = {
            model: remoteResult.model,
            summary: `${remoteResult.summary}；已叠加本地色彩科学基线，远端失败时不影响核心功能。`,
            params: normalizeAiSuggestionParams(normalizeAiSuggestionParams(selectedAsset.edits, localResult), remoteResult)
          };
        } catch (error) {
          const explanation = explainAiFailureReason(error instanceof Error ? error.message : "远端 AI 请求失败");
          fallbackReason = explanation.message;
          fallbackHint =
            "下一步：点击“诊断 AI 连接”，重点检查模型列表、当前模型是否可用、图片输入通道和 JSON 参数返回。本次已保留本地候选，原图未改变。";
          result = {
            ...localResult,
            summary: `${localResult.summary} 远端 AI 暂不可用（${fallbackReason}），已使用本地色彩科学候选。`
          };
        }
      } else {
        fallbackReason = isTauriRuntime() ? "AI key 尚未保存" : "当前不是桌面运行时";
        fallbackHint = isTauriRuntime()
          ? "下一步：保存 API key 和 Base URL 后点击“诊断 AI 连接”，确认模型列表和当前模型可用。"
          : "下一步：请在 Windows/macOS 桌面版中配置 AI；浏览器预览不会发送远端 AI 请求。";
      }

      const params = normalizeAiSuggestionParams(selectedAsset.edits, result);
      const previewUrl = await renderAssetAiCandidatePreview(selectedAsset, params);
      setAiPendingSuggestion({
        mode,
        assetId: selectedAsset.id,
        assetName: selectedAsset.name,
        model: result.model,
        summary: result.summary,
        fallbackHint,
        params,
        previewUrl
      });
      setAiPanelMessage(
        fallbackReason
          ? `${modeText}已生成本地候选：${fallbackReason}，请预览后确认`
          : selectedAsset.isEditable
            ? `${modeText}已生成候选结果，请预览后确认`
            : `${modeText}已基于 RAW 内嵌预览生成候选结果，请预览后确认`
      );
      setStatus(`${modeText} candidate generated; current photo is not changed yet`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 调色失败，核心功能不受影响";
      setAiPanelMessage(message);
      setStatus(message);
    } finally {
      setIsAiTuning(false);
    }
  };

  const runBatchAiTuning = async (mode: AiTuningMode) => {
    if (previewEditableBatchTargets.length === 0) {
      setAiPanelMessage("没有可批量处理的 JPG 或 RAW 内嵌预览");
      return;
    }
    if (mode === "styleMatch" && !referenceStyle) {
      setAiPanelMessage("请先在参考风格中设置参考图，再运行批量 AI 追色");
      return;
    }

    const modeText = mode === "styleMatch" ? "批量 AI 追色" : "批量 AI 调色";
    const batchMode: BatchProcessProgress["mode"] = mode === "styleMatch" ? "aiStyle" : "aiAuto";
    const targetIds = new Set(previewEditableBatchTargets.map((asset) => asset.id));
    const next: PhotoAsset[] = [];
    let completed = 0;
    let failedCount = 0;

    setAiPendingSuggestion(undefined);
    startBatchProcess(batchMode, previewEditableBatchTargets.length);
    setAiPanelMessage(`${modeText}使用本地色彩科学候选批量应用，不会逐张请求远端 AI`);
    setStatus(`正在运行${modeText}：${previewEditableBatchTargets.length} 张 JPG/RAW 预览`);

    for (const asset of assets) {
      if (!targetIds.has(asset.id)) {
        next.push(asset);
        continue;
      }
      if (batchProcessCancelRef.current) {
        next.push(asset);
        continue;
      }

      updateBatchProcess(completed, asset.name);
      try {
        const result = await createLocalAiCandidate(
          asset,
          mode,
          aiInstruction,
          mode === "styleMatch" ? referenceStyle : undefined
        );
        const edits = normalizeAiSuggestionParams(asset.edits, result);
        next.push({
          ...asset,
          edits,
          autoSummary: [
            mode === "styleMatch" ? "已应用批量 AI 追色" : "已应用批量 AI 调色",
            result.summary,
            aiInstruction.trim() ? `调色想法：${aiInstruction.trim()}` : "调色想法：本地自动判断"
          ]
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : `${modeText}失败`;
        failedCount += 1;
        recordBatchFailure(asset, reason);
        next.push({ ...asset, autoSummary: [`${modeText}失败：${reason}`] });
      }

      completed += 1;
      updateBatchProcess(completed, asset.name);
      await yieldToUi();
    }

    setAssets(next);
    finishBatchProcess();
    setAiPanelMessage(
      `${modeText}完成 ${previewEditableBatchTargets.length - failedCount}/${previewEditableBatchTargets.length}${failedCount > 0 ? `，失败 ${failedCount}` : ""}`
    );
    setStatus(
      batchProcessCancelRef.current
        ? `${modeText} cancelled, completed ${completed}/${previewEditableBatchTargets.length}`
        : `${modeText} completed ${previewEditableBatchTargets.length - failedCount}/${previewEditableBatchTargets.length} JPG/RAW preview${failedCount > 0 ? `, failed ${failedCount}` : ""}${previewBatchSkipCount > 0 ? `, skipped unavailable RAW ${previewBatchSkipCount}` : ""}`
    );
  };

  const applyAiSuggestion = () => {
    if (!selectedAsset || !aiPendingSuggestion || aiPendingSuggestion.assetId !== selectedAsset.id) return;
    commitSelectedEdits(aiPendingSuggestion.params);
    setAiPanelMessage("AI 候选参数已应用");
    setStatus(`已应用 AI 候选参数：${selectedAsset.name}`);
    setAiPendingSuggestion(undefined);
  };

  const cancelAiSuggestion = () => {
    if (aiPendingSuggestion) {
      setAiPanelMessage("已取消 AI 候选结果，当前参数未改变");
      setStatus("已取消 AI 候选结果");
      setAiPendingSuggestion(undefined);
    }
  };

  const updateControl = (control: EditControl, value: number, mode: "draft" | "commit" = "commit") => {
    if (!selectedAsset || !selectedAssetPreviewEditable) return;
    const nextEdits = mergeEditParams(selectedAsset.edits, {
      [control.key]: normalizeControlValue(control, value)
    });
    if (mode === "draft") {
      beginEditDraft();
      previewSelectedEdits(nextEdits);
      return;
    }
    commitSelectedEdits(nextEdits);
  };

  const normalizeHslValue = (value: number) => clamp(roundToStep(Number.isFinite(value) ? value : 0), -50, 50);

  const updateHslControl = (
    channel: (typeof hslChannels)[number],
    key: "hue" | "saturation" | "luminance",
    value: number,
    mode: "draft" | "commit" = "commit"
  ) => {
    if (!selectedAsset || !selectedAssetPreviewEditable) return;
    const currentEdits = normalizeEditParams(selectedAsset.edits);
    const nextEdits = normalizeEditParams({
      ...currentEdits,
      hsl: {
        ...currentEdits.hsl,
        [channel]: {
          ...currentEdits.hsl[channel],
          [key]: normalizeHslValue(value)
        }
      }
    });
    if (mode === "draft") {
      beginEditDraft();
      previewSelectedEdits(nextEdits);
      return;
    }
    commitSelectedEdits(nextEdits);
  };

  const getCropAspectLabel = (value: EditParams["cropAspect"]) =>
    cropAspectOptions.find((option) => option.value === value)?.label ?? value;

  const getCropImageSize = () => {
    const rect = cropBaseImageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { width: 1, height: 1 };
    return { width: rect.width, height: rect.height };
  };

  const getCropPointerPoint = (event: React.PointerEvent): { x: number; y: number } | undefined => {
    const rect = cropBaseImageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100)
    };
  };

  const startCropSession = (aspect: CropAspect = selectedAsset?.edits.cropAspect ?? "free") => {
    if (!selectedAsset || !selectedAssetPreviewEditable) return;
    const size = getCropImageSize();
    const rect = fitRectToAspect(cropRectFromEdits(selectedAsset.edits), aspect, size.width, size.height);
    setCompareMode("edited");
    setCropDraft({
      assetId: selectedAsset.id,
      aspect,
      rect
    });
    setStatus(`正在裁切：${getCropAspectLabel(aspect)}`);
  };

  const updateCropAspect = (aspect: EditParams["cropAspect"]) => {
    if (!selectedAsset || !selectedAssetPreviewEditable) return;
    if (!isCropEditing) {
      startCropSession(aspect);
      return;
    }
    const size = getCropImageSize();
    setCropDraft((current) =>
      current && current.assetId === selectedAsset.id
        ? {
            ...current,
            aspect,
            rect: fitRectToAspect(current.rect, aspect, size.width, size.height)
          }
        : current
    );
    setStatus(`裁切比例：${getCropAspectLabel(aspect)}，移动裁切框后确认`);
  };

  const confirmCrop = () => {
    if (!selectedAsset || !isCropEditing || !cropDraft) return;
    const rect = normalizeCropRect(cropDraft.rect);
    commitSelectedEdits(
      mergeEditParams(selectedAsset.edits, {
        cropAspect: cropDraft.aspect,
        cropX: rect.x,
        cropY: rect.y,
        cropWidth: rect.width,
        cropHeight: rect.height
      }),
      [`已确认裁切：${getCropAspectLabel(cropDraft.aspect)}`]
    );
    setCropDraft(undefined);
    setCropBasePreview(undefined);
    cropInteractionRef.current = undefined;
    setStatus(`已确认裁切：${getCropAspectLabel(cropDraft.aspect)}`);
  };

  const cancelCrop = () => {
    if (!isCropEditing) return;
    setCropDraft(undefined);
    setCropBasePreview(undefined);
    cropInteractionRef.current = undefined;
    setStatus("已取消裁切，图片参数未改变");
  };

  const beginCropDraw = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedAsset || !isCropEditing || !cropDraft) return;
    const point = getCropPointerPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    cropInteractionRef.current = {
      mode: "draw",
      pointerId: event.pointerId,
      start: point
    };
    setCropDraft((current) =>
      current && current.assetId === selectedAsset.id
        ? {
            ...current,
            rect: normalizeCropRect({ x: point.x, y: point.y, width: 5, height: 5 })
          }
        : current
    );
  };

  const beginCropMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedAsset || !isCropEditing || !cropDraft) return;
    const point = getCropPointerPoint(event);
    if (!point) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropInteractionRef.current = {
      mode: "move",
      pointerId: event.pointerId,
      start: point,
      initialRect: cropDraft.rect
    };
  };

  const beginCropResize = (corner: CropResizeCorner, event: React.PointerEvent<HTMLButtonElement>) => {
    if (!selectedAsset || !isCropEditing || !cropDraft) return;
    const point = getCropPointerPoint(event);
    if (!point) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropInteractionRef.current = {
      mode: "resize",
      pointerId: event.pointerId,
      start: point,
      initialRect: cropDraft.rect,
      corner
    };
  };

  const updateCropPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = cropInteractionRef.current;
    if (!selectedAsset || !cropDraft || !interaction || interaction.pointerId !== event.pointerId) return;
    const point = getCropPointerPoint(event);
    if (!point) return;
    const size = getCropImageSize();
    if (interaction.mode === "draw") {
      setCropDraft((current) =>
        current && current.assetId === selectedAsset.id
          ? {
              ...current,
              rect: createCropRectFromDrag(interaction.start, point, current.aspect, size.width, size.height)
            }
          : current
      );
      return;
    }

    const initial = interaction.initialRect;
    if (!initial) return;
    if (interaction.mode === "resize" && interaction.corner) {
      setCropDraft((current) =>
        current && current.assetId === selectedAsset.id
          ? {
              ...current,
              rect: createCropRectFromResize(initial, interaction.corner as CropResizeCorner, point, current.aspect, size.width, size.height)
            }
          : current
      );
      return;
    }

    const deltaX = point.x - interaction.start.x;
    const deltaY = point.y - interaction.start.y;
    setCropDraft((current) =>
      current && current.assetId === selectedAsset.id
        ? {
            ...current,
            rect: normalizeCropRect({
              ...initial,
              x: clamp(initial.x + deltaX, 0, 100 - initial.width),
              y: clamp(initial.y + deltaY, 0, 100 - initial.height)
            })
          }
        : current
    );
  };

  const endCropPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (cropInteractionRef.current?.pointerId !== event.pointerId) return;
    cropInteractionRef.current = undefined;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  };

  const rotateSelectedBy = (degrees: number) => {
    if (!selectedAsset || !selectedAssetPreviewEditable) return;
    const nextRotation = normalizeRotationDegrees((selectedAsset.edits.rotation ?? 0) + degrees);
    commitSelectedEdits(mergeEditParams(selectedAsset.edits, { rotation: nextRotation }), [
      `已旋转照片：${nextRotation}°`
    ]);
    setStatus(`已旋转照片：${nextRotation}°`);
  };

  const resetGeometry = () => {
    if (!selectedAsset || !selectedAssetPreviewEditable) return;
    commitSelectedEdits(
      mergeEditParams(selectedAsset.edits, {
        rotation: 0,
        cropAspect: "free",
        cropX: 0,
        cropY: 0,
        cropWidth: 100,
        cropHeight: 100
      }),
      ["已重置旋转和裁切"]
    );
    setStatus("已重置旋转和裁切");
  };

  const resetSelected = () => {
    if (!selectedAsset || !selectedAssetPreviewEditable) return;
    commitSelectedEdits(
      mergeEditParams(selectedAsset.edits, {
        exposure: 0,
        temperature: 0,
        tint: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        saturation: 0,
        vibrance: 0,
        clarity: 0,
        texture: 0,
        dehaze: 0,
        vignette: 0,
        grain: 0,
        sharpness: 0,
        noiseReduction: 0,
        skinProtection: 65
      }),
      ["已重置基础调色参数"]
    );
  };

  const copyParams = () => {
    if (!selectedAsset || !selectedAssetPreviewEditable) return;
    setCopiedParams(normalizeEditParams(selectedAsset.edits));
    setStatus("已复制当前调色参数");
  };

  const pasteParams = () => {
    if (!selectedAsset || !selectedAssetPreviewEditable || !copiedParams) return;
    commitSelectedEdits(copiedParams, ["已粘贴调色参数"]);
    setStatus("已粘贴调色参数到当前图片");
  };

  const pasteParamsToBatch = () => {
    if (!copiedParams || editableBatchTargets.length === 0) return;
    const targetIds = new Set(editableBatchTargets.map((asset) => asset.id));
    setAssets((current) =>
      current.map((asset) =>
        targetIds.has(asset.id)
          ? {
              ...asset,
              edits: normalizeEditParams(copiedParams),
              autoSummary: ["已批量粘贴调色参数"]
            }
          : asset
      )
    );
    setStatus(
      `Pasted settings to ${editableBatchTargets.length} JPG${rawBatchSkipCount > 0 ? `, skipped RAW ${rawBatchSkipCount}` : ""}`
    );
  };

  const createExportName = (asset: PhotoAsset, index: number) => {
    const stem = asset.name.replace(/\.[^.]+$/, "");
    const sequence = exportSettings.includeSequence ? `${String(index + 1).padStart(4, "0")}_` : "";
    const cleanPrefix = exportSettings.filenamePrefix.trim();
    const cleanSuffix = exportSettings.filenameSuffix.trim();
    return `${cleanPrefix}${sequence}${stem}${cleanSuffix}.jpg`;
  };

  const dataUrlToBlob = (dataUrl: string) => {
    const [header, payload] = dataUrl.split(",");
    if (!header || !payload || !header.startsWith("data:")) return undefined;
    const mimeType = header.match(/^data:([^;]+)/)?.[1] ?? "application/octet-stream";
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  };

  const dataUrlToBlobUrl = (dataUrl: string) => {
    const blob = dataUrlToBlob(dataUrl);
    return blob ? URL.createObjectURL(blob) : undefined;
  };

  const downloadDataUrl = (url: string, outputName: string) => {
    const blobUrl = url.startsWith("data:") ? dataUrlToBlobUrl(url) : undefined;
    const href = blobUrl ?? url;
    const link = document.createElement("a");
    link.href = href;
    link.download = outputName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (blobUrl) window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
  };

  const isBrowserDirectoryPickerSupported = () =>
    !isTauriRuntime() && typeof window.showDirectoryPicker === "function";

  const sanitizeBrowserExportFileName = (fileName: string) => {
    let sanitized = fileName
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+|\.+$/g, "");

    if (!sanitized) sanitized = "auto-photo-export.jpg";
    if (!/\.(jpe?g)$/i.test(sanitized)) sanitized = `${sanitized}.jpg`;
    return sanitized;
  };

  const browserExportFileExists = async (directory: FileSystemDirectoryHandle, fileName: string) => {
    try {
      await directory.getFileHandle(fileName);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return false;
      throw error;
    }
  };

  const resolveBrowserExportFile = async (
    directory: FileSystemDirectoryHandle,
    fileName: string,
    conflictStrategy: ExportConflictStrategy
  ) => {
    const safeName = sanitizeBrowserExportFileName(fileName);
    const exists = await browserExportFileExists(directory, safeName);

    if (conflictStrategy === "overwrite" || !exists) {
      return { fileName: safeName, skipped: false };
    }
    if (conflictStrategy === "skip") {
      return { fileName: safeName, skipped: true };
    }

    const dotIndex = safeName.lastIndexOf(".");
    const stem = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
    const extension = dotIndex > 0 ? safeName.slice(dotIndex + 1) : "jpg";
    for (let index = 1; index < 10_000; index += 1) {
      const candidate = `${stem} (${index}).${extension}`;
      if (!(await browserExportFileExists(directory, candidate))) {
        return { fileName: candidate, skipped: false };
      }
    }

    throw new Error("无法生成不重名的导出文件名");
  };

  const saveExportFileToBrowserDirectory = async (
    directory: FileSystemDirectoryHandle,
    fileName: string,
    dataUrl: string,
    conflictStrategy: ExportConflictStrategy
  ): Promise<ExportWriteResult> => {
    const resolved = await resolveBrowserExportFile(directory, fileName, conflictStrategy);
    const outputPath = `${directory.name}/${resolved.fileName}`;
    if (resolved.skipped) {
      return { skipped: true, requestedName: fileName, outputName: resolved.fileName, outputPath };
    }

    const fileHandle = await directory.getFileHandle(resolved.fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(dataUrl.startsWith("data:") ? dataUrlToBlob(dataUrl) ?? dataUrl : dataUrl);
    } finally {
      await writable.close();
    }

    return { skipped: false, requestedName: fileName, outputName: resolved.fileName, outputPath };
  };

  const chooseDirectory = async () => {
    try {
      if (isTauriRuntime()) {
        const selected = await chooseExportDirectory();
        if (selected) {
          setExportDirectory(selected);
          setStatus(`已选择导出目录：${selected}`);
        } else {
          setStatus("已取消选择导出目录，导出未开始");
        }
        return selected;
      }

      if (isBrowserDirectoryPickerSupported()) {
        const selected = await window.showDirectoryPicker?.({ mode: "readwrite" });
        if (selected) {
          browserExportDirectoryRef.current = selected;
          setBrowserExportDirectoryName(selected.name);
          setStatus(`已选择浏览器导出文件夹：${selected.name}`);
          return selected.name;
        }
        setStatus("已取消选择下载文件夹，导出未开始");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "选择导出文件夹失败");
    }
    return undefined;
  };

  const ensureExportDirectory = async () => {
    if (!isTauriRuntime()) {
      if (browserExportDirectoryRef.current) return browserExportDirectoryRef.current.name;
      if (isBrowserDirectoryPickerSupported()) {
        setStatus("请选择下载文件夹");
        return chooseDirectory();
      }
      setStatus(`浏览器不支持选择文件夹，将使用${BROWSER_DEFAULT_DOWNLOAD_TARGET}`);
      return BROWSER_DEFAULT_DOWNLOAD_TARGET;
    }
    if (exportDirectory) return exportDirectory;
    setStatus("请先选择导出目录");
    const selected = await chooseDirectory();
    return selected;
  };

  const createExportAbortError = () => new DOMException("导出任务已取消", "AbortError");

  const throwIfExportAborted = (signal?: AbortSignal) => {
    if (exportCancelRef.current || signal?.aborted) throw createExportAbortError();
  };

  const isExportAbortError = (error: unknown) =>
    exportCancelRef.current || (error instanceof DOMException && error.name === "AbortError");

  const beginExportAbortScope = () => {
    exportAbortControllerRef.current?.abort();
    const controller = new AbortController();
    exportAbortControllerRef.current = controller;
    return controller;
  };

  const endExportAbortScope = (controller: AbortController) => {
    if (exportAbortControllerRef.current === controller) exportAbortControllerRef.current = undefined;
  };

  const writeExport = async (
    asset: PhotoAsset,
    index: number,
    outputDir = exportDirectory,
    signal?: AbortSignal
  ): Promise<ExportWriteResult> => {
    if (!asset.isEditable && asset.previewKind !== "raw_embedded") {
      throw new Error("该 RAW 暂无可用内嵌 JPEG 预览，不能导出预览级 JPG");
    }
    throwIfExportAborted(signal);
    const renderedUrl = await renderForExport(asset, signal);
    throwIfExportAborted(signal);
    const exifResult = exportSettings.preserveExif && asset.isEditable
      ? await preserveSafeExif(asset, renderedUrl)
      : { dataUrl: renderedUrl, preserved: false };
    throwIfExportAborted(signal);
    const url = exifResult.dataUrl;
    const outputName = createExportName(asset, index);
    if (isTauriRuntime() && outputDir) {
      const saved = await saveExportFile(outputDir, outputName, url, exportSettings.conflictStrategy);
      return { skipped: saved.skipped, requestedName: outputName, outputName: saved.fileName, outputPath: saved.path };
    }
    if (!isTauriRuntime() && browserExportDirectoryRef.current) {
      return saveExportFileToBrowserDirectory(
        browserExportDirectoryRef.current,
        outputName,
        url,
        exportSettings.conflictStrategy
      );
    }
    downloadDataUrl(url, outputName);
    return { skipped: false, requestedName: outputName, outputName };
  };

  const refreshExportHistory = async () => {
    if (!isTauriRuntime()) return;
    try {
      setExportHistory(await listExportJobs(6));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取导出记录失败");
    }
  };

  const recordExportHistory = async (job: ExportJobRecord) => {
    if (!isTauriRuntime()) return;
    try {
      await recordExportJob(job);
      setProjectStoreSummary(await getProjectStoreSummary());
      setExportHistory(await listExportJobs(6));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "记录导出任务失败");
    }
  };

  const renderForExport = async (asset: PhotoAsset, signal?: AbortSignal) => {
    if (asset.isEditable) {
      return renderPreviewWithWorkerFallback(asset, asset.edits, {
        maxEdge: exportSettings.maxEdge,
        quality: exportSettings.quality / 100,
        exportSettings,
        signal
      });
    }
    if (asset.previewKind === "raw_embedded") {
      const sourceUrl = await createRawEmbeddedSourceUrl(asset.file);
      throwIfExportAborted(signal);
      if (!sourceUrl) throw new Error("该 RAW 暂无可用内嵌 JPEG 预览，不能导出预览级 JPG");
      return renderImageSourceWithEdits(sourceUrl, asset.edits, {
      maxEdge: exportSettings.maxEdge,
      quality: exportSettings.quality / 100,
      exportSettings,
        signal,
        orientation: asset.metadata.orientation
      });
    }
    throw new Error("该 RAW 暂无可用内嵌 JPEG 预览，不能导出预览级 JPG");
  };

  const executeExportQueue = async (
    mode: ExportJobRecord["mode"],
    queueItems: ExportQueueItem[],
    outputDir: string | undefined,
    labels: {
      start: string;
      item: (item: ExportQueueItem, position: number, total: number) => string;
      cancelled: (completedCount: number, total: number) => string;
      completed: (result: ExportQueueResult) => string;
    }
  ): Promise<ExportQueueResult> => {
    exportCancelRef.current = false;
    const exportController = beginExportAbortScope();

    try {
      return await runExportQueueService({
        mode,
        outputDir,
        queueItems,
        signal: exportController.signal,
        labels,
        writeItem: ({ asset, index }, signal) => writeExport(asset, index, outputDir, signal),
        getRequestedName: ({ asset, index }) => createExportName(asset, index),
        recordHistory: recordExportHistory,
        isCancelled: () => exportCancelRef.current,
        isAbortError: isExportAbortError,
        setStatus,
        onProgressStart: (total) => setExportProgress({ running: true, total, completed: 0, failed: [] }),
        onProgressCurrent: (assetName) => setExportProgress((current) => ({ ...current, currentName: assetName })),
        onProgressCompleted: () => setExportProgress((current) => ({ ...current, completed: current.completed + 1 })),
        onProgressFailed: (failed) => setExportProgress((current) => ({ ...current, failed })),
        onProgressStop: (failed) => setExportProgress((current) => ({ ...current, running: false, currentName: undefined, failed }))
      });
    } finally {
      endExportAbortScope(exportController);
    }
  };

  const exportCurrent = async () => {
    if (!selectedAsset) return;
    if (!selectedAssetPreviewExportable) {
      setStatus(selectedAsset.sourceFormat === "raw" ? rawExportDisabledReason : "当前图片不能导出");
      return;
    }
    const outputDir = await ensureExportDirectory();
    if (isTauriRuntime() && !outputDir) return;
    await executeExportQueue("single", [{ asset: selectedAsset, index: 0 }], outputDir, {
      start: selectedAsset.isEditable
        ? `正在导出 ${selectedAsset.name}${outputDir ? ` 到 ${outputDir}` : ""}`
        : `正在导出 RAW 内嵌预览级 JPG：${selectedAsset.name}${outputDir ? ` 到 ${outputDir}` : ""}`,
      item: ({ asset }) => `正在导出 ${asset.name}`,
      cancelled: () => "Export cancelled",
      completed: (result) => {
        if (result.failed.length > 0) return result.failed[0].reason;
        const item = result.items[0];
        if (item?.status === "skipped") return `同名文件已跳过：${item.outputName}`;
        return selectedAsset.isEditable
          ? `已生成当前图片导出文件：${item?.outputName ?? createExportName(selectedAsset, 0)}`
          : `已生成 RAW 内嵌预览级 JPG：${item?.outputName ?? createExportName(selectedAsset, 0)}`;
      }
    });
  };

  const exportBatch = async () => {
    if (previewEditableBatchTargets.length === 0) return;
    const outputDir = await ensureExportDirectory();
    if (isTauriRuntime() && !outputDir) return;
    const queueItems = previewEditableBatchTargets.map((asset, index) => ({ asset, index }));
    await executeExportQueue("batch", queueItems, outputDir, {
      start: `正在以队列导出 ${queueItems.length} 张 JPG/RAW 预览${outputDir ? ` 到 ${outputDir}` : ""}`,
      item: ({ asset }, position, total) => `队列导出 ${position}/${total}: ${asset.name}`,
      cancelled: (completedCount, total) => `Export cancelled, completed ${completedCount}/${total}`,
      completed: (result) =>
        result.failed.length > 0
          ? `Export completed, failed ${result.failed.length}`
          : `Queued export completed ${result.completedCount} JPG/RAW preview${result.skippedCount > 0 ? `, skipped same-name ${result.skippedCount}` : ""}${previewBatchSkipCount > 0 ? `, skipped unavailable RAW ${previewBatchSkipCount}` : ""}`
    });
  };

  const retryFailedExports = async () => {
    const failedIds = new Set(exportProgress.failed.map((item) => item.assetId));
    const failedTargets = assets.filter((asset) => failedIds.has(asset.id) && (asset.isEditable || asset.previewKind === "raw_embedded"));
    if (failedTargets.length === 0) return;
    const outputDir = await ensureExportDirectory();
    if (isTauriRuntime() && !outputDir) return;
    const queueItems = failedTargets.map((asset, index) => ({ asset, index }));
    await executeExportQueue("retry", queueItems, outputDir, {
      start: `Retrying ${queueItems.length} failed exports`,
      item: ({ asset }, position, total) => `Retrying export ${position}/${total}: ${asset.name}`,
      cancelled: (completedCount, total) => `Retry export cancelled, completed ${completedCount}/${total}`,
      completed: (result) =>
        result.failed.length > 0
          ? `Retry completed, still failed ${result.failed.length}`
          : `Failed exports retried${result.skippedCount > 0 ? `, skipped same-name ${result.skippedCount}` : ""}`
    });
  };

  const cancelExport = () => {
    exportCancelRef.current = true;
    exportAbortControllerRef.current?.abort();
    setStatus("正在取消导出任务");
  };

  const formatExportJobMode = (mode: ExportJobHistory["mode"]) => {
    if (mode === "single") return "单张";
    if (mode === "batch") return "批量";
    return "重试";
  };

  const formatExportJobStatus = (status: ExportJobHistory["status"]) => {
    if (status === "completed") return "完成";
    if (status === "completed_with_failures") return "部分失败";
    if (status === "cancelled") return "已取消";
    return "失败";
  };

  const formatExportJobTime = (createdAt: string) => {
    const normalized = createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T");
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return createdAt;
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  const formatExportJobDetail = (job: ExportJobHistory) => {
    const failed = job.failed?.[0] ?? job.items?.find((item) => item.status === "failed");
    if (failed) {
      const reason = "reason" in failed && failed.reason ? sanitizeAiFailureReason(failed.reason) : "未记录原因";
      return `失败：${failed.name} · ${reason}`;
    }
    const skipped = job.items?.find((item) => item.status === "skipped");
    if (skipped) {
      return `跳过：${skipped.outputName ?? skipped.requestedName ?? skipped.name}`;
    }
    const latestWritten = [...(job.items ?? [])].reverse().find((item) => item.status === "written");
    if (latestWritten) {
      return `输出：${latestWritten.outputName ?? latestWritten.requestedName ?? latestWritten.name}`;
    }
    return "";
  };
  const formatPreviewKind = (asset: PhotoAsset) => {
    if (asset.previewKind === "raw_embedded") return "RAW 内嵌预览";
    if (asset.previewKind === "raw_placeholder") return "RAW 占位预览";
    return "JPG 预览";
  };
  const shouldShowExportHistory = isTauriRuntime() || (import.meta.env.DEV && exportHistory.length > 0);
  const exportTargetLabel = isTauriRuntime()
    ? "桌面导出目录"
    : isBrowserDirectoryPickerSupported()
      ? "浏览器写入文件夹"
      : "浏览器下载位置";
  const exportTargetValue = isTauriRuntime()
    ? exportDirectory ?? "导出前会先选择文件夹"
    : browserExportDirectoryName ?? (isBrowserDirectoryPickerSupported() ? "导出前会先选择下载文件夹" : `使用${BROWSER_DEFAULT_DOWNLOAD_TARGET}`);
  const exportTargetSelected = isTauriRuntime()
    ? Boolean(exportDirectory)
    : Boolean(browserExportDirectoryName) || !isBrowserDirectoryPickerSupported();

  const createProjectSnapshot = (): ProjectSnapshot => ({
      schemaVersion: 1,
      appName: "AutoPhoto",
      savedAt: new Date().toISOString(),
      assets: assets.map((asset) => ({
        name: asset.name,
        size: asset.size,
        type: asset.type,
        fileHash: asset.fileHash,
        sourceFormat: asset.sourceFormat,
        isEditable: asset.isEditable,
        previewKind: asset.previewKind,
        cameraBrand: asset.cameraBrand,
        metadata: asset.metadata,
        edits: normalizeEditParams(asset.edits),
        autoSummary: asset.autoSummary
      })),
      exportSettings,
      customPresets,
      workflowSettings: {
        referenceStrength,
        consistencyStrength
      },
      referenceStyle: referenceStyle
        ? {
            name: referenceStyle.name,
            edits: normalizeEditParams(referenceStyle.edits),
            signature: referenceStyle.signature
          }
        : undefined
    });

  const applyProjectSnapshot = (snapshot: ProjectSnapshot) => {
    if (snapshot.schemaVersion !== 1 || !["AutoPhoto", "Auto Photo"].includes(snapshot.appName)) {
      setStatus("项目文件格式不匹配");
      return;
    }

    const editsByHash = new Map(snapshot.assets.filter((asset) => asset.fileHash).map((asset) => [asset.fileHash, asset]));
    const editsByKey = new Map(snapshot.assets.map((asset) => [`${asset.name}:${asset.size}`, asset]));
    setAssets((current) =>
      current.map((asset) => {
        const restored =
          editsByHash.get(asset.fileHash) ?? editsByKey.get(`${asset.name}:${asset.size}`) ?? editsByKey.get(`${asset.name}:0`);
        return restored
          ? {
              ...asset,
              previewKind: restored.previewKind ?? asset.previewKind,
              edits: normalizeEditParams(restored.edits),
              autoSummary: restored.autoSummary ?? ["已从项目库恢复参数"]
            }
          : asset;
      })
    );
    setExportSettings(normalizeExportSettings(snapshot.exportSettings));
    setCustomPresets(snapshot.customPresets ?? []);
    const workflowSettings = normalizeWorkflowSettings(snapshot.workflowSettings);
    setReferenceStrength(workflowSettings.referenceStrength);
    setConsistencyStrength(workflowSettings.consistencyStrength);
    setReferenceStyle(
      snapshot.referenceStyle
        ? {
            assetId: "project-reference",
            name: snapshot.referenceStyle.name,
            edits: normalizeEditParams(snapshot.referenceStyle.edits),
            signature: snapshot.referenceStyle.signature
          }
        : undefined
    );
    setStatus(`Loaded project params: ${snapshot.assets.length} records`);
  };

  const exportProject = () => {
    const snapshot = createProjectSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, `auto-photo-project-${new Date().toISOString().slice(0, 10)}.json`);
    URL.revokeObjectURL(url);
    setStatus("已导出项目参数 JSON");
  };

  const importProject = async (file: File) => {
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text) as ProjectSnapshot;
      applyProjectSnapshot(snapshot);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "项目文件导入失败");
    }
  };

  const saveProjectToDatabase = async () => {
    if (!isTauriRuntime()) {
      setStatus("项目库保存仅在桌面模式可用");
      return;
    }
    try {
      const path = await saveProjectSnapshotToDb(createProjectSnapshot());
      const [summary, projects] = await Promise.all([getProjectStoreSummary(), listNamedProjectSnapshots()]);
      setProjectStoreSummary(summary);
      setNamedProjects(projects);
      setStatus(`已保存到项目库：${path}，JPG ${summary.jpg_count}，RAW ${summary.raw_count}，编辑 ${summary.edit_count}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存项目库失败");
    }
  };

  const loadProjectFromDatabase = async () => {
    if (!isTauriRuntime()) {
      setStatus("项目库载入仅在桌面模式可用");
      return;
    }
    try {
      const snapshot = await loadProjectSnapshotFromDb();
      if (!snapshot) {
        const path = await getProjectStorePath();
        setStatus(`项目库暂无快照：${path}`);
        return;
      }
      applyProjectSnapshot(snapshot);
      const [summary, projects] = await Promise.all([getProjectStoreSummary(), listNamedProjectSnapshots()]);
      setProjectStoreSummary(summary);
      setNamedProjects(projects);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "载入项目库失败");
    }
  };

  const refreshNamedProjects = async () => {
    if (!isTauriRuntime()) return;
    try {
      setNamedProjects(await listNamedProjectSnapshots());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取项目列表失败");
    }
  };

  const buildDefaultProjectName = () => {
    const date = new Date().toISOString().slice(0, 10);
    const firstName = assets[0]?.name?.replace(/\.[^.]+$/, "") ?? "未命名";
    return `${date} ${firstName}`.trim();
  };

  const saveNamedProjectToDatabase = async () => {
    if (!isTauriRuntime()) {
      setStatus("命名项目仅在桌面模式可用");
      return;
    }
    if (assets.length === 0) return;
    try {
      const name = projectName.trim() || buildDefaultProjectName();
      const project = await saveNamedProjectSnapshot(name, createProjectSnapshot());
      const [summary, projects] = await Promise.all([getProjectStoreSummary(), listNamedProjectSnapshots()]);
      setProjectStoreSummary(summary);
      setNamedProjects(projects);
      setProjectName("");
      setStatus(`已保存命名项目：${project.name}，JPG ${project.jpgCount}，RAW ${project.rawCount}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存命名项目失败");
    }
  };

  const loadNamedProjectFromDatabase = async (project: NamedProjectInfo) => {
    if (!isTauriRuntime()) return;
    try {
      const snapshot = await loadNamedProjectSnapshot(project.projectId);
      if (!snapshot) {
        setStatus(`未找到项目：${project.name}`);
        return;
      }
      applyProjectSnapshot(snapshot);
      const [summary, projects] = await Promise.all([getProjectStoreSummary(), listNamedProjectSnapshots()]);
      setProjectStoreSummary(summary);
      setNamedProjects(projects);
      setStatus(`Loaded named project: ${project.name}; confirm originals are imported before restoring params`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "载入命名项目失败");
    }
  };

  const refreshProjectStoreSummary = async () => {
    if (!isTauriRuntime()) return;
    try {
      const [summary, projects] = await Promise.all([getProjectStoreSummary(), listNamedProjectSnapshots()]);
      setProjectStoreSummary(summary);
      setNamedProjects(projects);
      setStatus(
        `项目库：资产 ${summary.asset_count}，JPG ${summary.jpg_count}，RAW ${summary.raw_count}，命名项目 ${summary.named_project_count}`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取项目库统计失败");
    }
  };

  const editedPreviewSource = selectedAsset ? editedPreview ?? selectedAsset.previewUrl : undefined;
  const originalPreviewSource = selectedAssetPreviewEditable ? originalPreview : selectedAsset?.previewUrl;
  const cropEditorSource = isCropEditing ? cropBasePreview ?? editedPreviewSource : undefined;
  const previewSource =
    selectedAsset && compareMode === "original" && selectedAssetPreviewEditable ? originalPreviewSource : editedPreviewSource;
  const canCompare = Boolean(!isCropEditing && selectedAssetPreviewEditable && editedPreviewSource && originalPreviewSource);
  const builtInPresetGroups = useMemo(() => {
    const seriesOrder: NonNullable<Preset["series"]>[] = ["人像", "风光", "建筑", "城市", "个性"];
    return seriesOrder
      .map((series) => ({
        series,
        presets: builtInPresets.filter((preset) => preset.series === series)
      }))
      .filter((group) => group.presets.length > 0);
  }, []);

  const renderEditControl = (control: EditControl, summary = "已调整调色参数") => {
    const value = getControlValue(control);
    const roundedValue = Number.isInteger(control.step ?? 1) ? Math.round(value) : value;

    return (
      <label className="slider-row" key={control.key}>
        <span>
          {control.label}
          <strong>{roundedValue}</strong>
        </span>
        <div className="slider-input-row">
          <input
            data-testid={`edit-range-${control.key}`}
            type="range"
            min={control.min}
            max={control.max}
            step={control.step ?? 1}
            value={value}
            disabled={!selectedAssetPreviewEditable}
            onPointerDown={beginEditDraft}
            onChange={(event) => updateControl(control, Number(event.target.value), "draft")}
            onPointerUp={() => commitEditDraft([summary])}
            onBlur={() => commitEditDraft([summary])}
          />
          <input
            data-testid={`edit-number-${control.key}`}
            className="control-number"
            type="number"
            min={control.min}
            max={control.max}
            step={control.step ?? 1}
            value={roundedValue}
            disabled={!selectedAssetPreviewEditable}
            onFocus={beginEditDraft}
            onChange={(event) => updateControl(control, Number(event.target.value), "draft")}
            onBlur={() => commitEditDraft([summary])}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </div>
      </label>
    );
  };

  return (
    <main
      className={`app-shell${isDragActive ? " drag-active" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <aside className="library-panel">
        <div className="brand-block">
          <div>
            <p className="eyebrow">AutoPhoto</p>
            <h1>自动调色工作台</h1>
          </div>
          <label className="icon-button import-button" title="导入 JPG / RAW">
            {isImporting ? <Loader2 className="spin" size={20} /> : <ImagePlus size={20} />}
            <input
              ref={photoImportInputRef}
              data-testid="photo-import-input"
              type="file"
              accept=".jpg,.jpeg,.arw,.nef,image/jpeg"
              multiple
              onChange={handleFileInput}
            />
          </label>
        </div>

        <div className={`drop-zone${isDragActive ? " active" : ""}`}>
          {isImporting ? <Loader2 size={28} className="spin" /> : <ImagePlus size={28} />}
          <div className="drop-copy">
            <span>{isDragActive ? "松开鼠标开始导入" : "拖入 Sony/Nikon JPG 或 RAW"}</span>
            <button type="button" onClick={choosePhotoFiles} disabled={isImporting}>
              <Import size={15} />
              选择照片文件
            </button>
          </div>
        </div>

        {lastImportReport && (
          <div className="import-report">
            <strong>
              最近导入：JPG {lastImportReport.jpgCount} · RAW {lastImportReport.rawCount}
              {lastImportReport.duplicateCount > 0 ? ` · 重复 ${lastImportReport.duplicateCount}` : ""}
              {lastImportReport.failed.length > 0 ? ` · 失败 ${lastImportReport.failed.length}` : ""}
            </strong>
            {lastImportReport.failed.slice(0, 3).map((item) => (
              <span key={`${item.name}-${item.reason}`}>
                {item.name}: {item.reason}
              </span>
            ))}
            {lastImportReport.failed.length > 3 && <span>还有 {lastImportReport.failed.length - 3} 个失败文件</span>}
          </div>
        )}

        <div className="batch-bar">
          <label className="project-button" title="导入项目参数">
            <Import size={16} />
            项目
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importProject(file);
                event.target.value = "";
              }}
            />
          </label>
          <button onClick={exportProject} disabled={assets.length === 0}>
            <Save size={16} />
            保存
          </button>
          {isTauriRuntime() && (
            <>
              <button onClick={saveProjectToDatabase} disabled={assets.length === 0}>
                <Database size={16} />
                入库
              </button>
              <button onClick={loadProjectFromDatabase}>
                <Import size={16} />
                载入
              </button>
              <button onClick={refreshProjectStoreSummary}>
                <Database size={16} />
                统计
              </button>
            </>
          )}
          <button onClick={toggleSelectAll} disabled={assets.length === 0}>
            {batchSelection.size === assets.length && assets.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
            {batchSelection.size > 0 ? `已选 ${batchSelection.size}` : "选择全部"}
          </button>
          <button data-testid="clear-assets-button" onClick={clearAssets} disabled={assets.length === 0 || isBatchProcessing || exportProgress.running}>
            <Trash2 size={16} />
            清空
          </button>
          <button onClick={pasteParamsToBatch} disabled={!copiedParams || editableBatchTargets.length === 0 || isBatchProcessing}>
            <ClipboardCheck size={16} />
            批量粘贴
          </button>
          <button onClick={runBatchConsistency} disabled={editableBatchTargets.length === 0 || isImporting || isBatchProcessing}>
            <Sparkles size={16} />
            统一色彩
          </button>
          <button onClick={exportBatch} disabled={previewEditableBatchTargets.length === 0 || isRendering || exportProgress.running || isBatchProcessing}>
            <Download size={16} />
            批量导出
          </button>
        </div>

        {isTauriRuntime() && (
          <section className="project-manager">
            <div className="project-manager-title">
              <strong>项目库</strong>
              <span>{namedProjects.length > 0 ? `${namedProjects.length} projects` : "Save multiple jobs"}</span>
            </div>
            <div className="project-save-row">
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder={assets.length > 0 ? buildDefaultProjectName() : "项目名称"}
                disabled={assets.length === 0}
              />
              <button onClick={saveNamedProjectToDatabase} disabled={assets.length === 0}>
                <Save size={15} />
              </button>
              <button onClick={refreshNamedProjects} title="刷新项目列表">
                <Database size={15} />
              </button>
            </div>
            {namedProjects.length > 0 && (
              <div className="project-list">
                {namedProjects.slice(0, 5).map((project) => (
                  <button key={project.projectId} onClick={() => loadNamedProjectFromDatabase(project)}>
                    <strong>{project.name}</strong>
                    <span>
                      JPG {project.jpgCount} · RAW {project.rawCount} · {project.updatedAt}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="asset-list">
          {assets.map((asset, assetIndex) => (
            <div
              className={`asset-row ${asset.id === selectedAsset?.id ? "active" : ""}`}
              key={asset.id}
            >
              <button
                className="asset-check"
                title={batchSelection.has(asset.id) ? "取消选择" : "选择图片"}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleBatchSelection(asset.id);
                }}
              >
                {batchSelection.has(asset.id) ? <CheckSquare size={17} /> : <Square size={17} />}
              </button>
              <button className="asset-main" data-testid={`asset-main-${assetIndex}`} onClick={() => setSelectedId(asset.id)}>
                <img src={asset.previewUrl} alt={asset.name} />
                <span>
                  <strong>{asset.name}</strong>
                  <small>
                    {asset.sourceFormat.toUpperCase()} · {asset.cameraBrand} · {formatPreviewKind(asset)} · {formatFileSize(asset.size)}
                  </small>
                </span>
              </button>
              <button className="asset-delete" title="移除图片" onClick={() => removeAsset(asset.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="preview-panel">
        <div className="toolbar">
          <div className="status-line">{status}</div>
          <div className="toolbar-actions">
            <button className="tool-button" title={rawActionTitle} onClick={runAutoColor} disabled={!selectedAssetPreviewEditable || isRendering || isBatchProcessing}>
              <Wand2 size={18} />
              一键自动
            </button>
            <button className="tool-button" onClick={runBatchAutoColor} disabled={previewEditableBatchTargets.length === 0 || isImporting || isBatchProcessing}>
              <Sparkles size={18} />
              批量自动
            </button>
            <button className="tool-button" onClick={runBatchConsistency} disabled={editableBatchTargets.length === 0 || isImporting || isBatchProcessing}>
              <Palette size={18} />
              统一色彩
            </button>
            <button className="icon-button" title="取消批量处理" onClick={cancelBatchProcess} disabled={!isBatchProcessing}>
              <Ban size={19} />
            </button>
            <button
              className="icon-button"
              data-testid="compare-mode-button"
              onClick={() => setCompareMode((mode) => (mode === "edited" ? "split" : mode === "split" ? "original" : "edited"))}
              disabled={!canCompare}
              title={rawActionTitle ?? (compareMode === "edited" ? "分屏对比" : compareMode === "split" ? "查看原图" : "查看效果")}
            >
              {compareMode === "original" ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
            <button className="icon-button" title="重置调色" onClick={resetSelected} disabled={!selectedAssetPreviewEditable}>
              <RotateCcw size={19} />
            </button>
            <button
              className="icon-button"
              data-testid="undo-button"
              title="撤销"
              onClick={undoSelected}
              disabled={!selectedAssetPreviewEditable || !(historyByAsset[selectedAsset?.id ?? ""]?.past.length > 0)}
            >
              <Undo2 size={19} />
            </button>
            <button
              className="icon-button"
              data-testid="redo-button"
              title="重做"
              onClick={redoSelected}
              disabled={!selectedAssetPreviewEditable || !(historyByAsset[selectedAsset?.id ?? ""]?.future.length > 0)}
            >
              <Redo2 size={19} />
            </button>
            <button className="icon-button" title="复制参数" onClick={copyParams} disabled={!selectedAssetPreviewEditable}>
              <Clipboard size={19} />
            </button>
            <button className="icon-button" title="粘贴参数" onClick={pasteParams} disabled={!selectedAssetPreviewEditable || !copiedParams}>
              <ClipboardCheck size={19} />
            </button>
            <button
              className="icon-button"
              title={exportActionTitle}
              onClick={exportCurrent}
              disabled={!selectedAssetPreviewExportable || isRendering || exportProgress.running || isBatchProcessing}
            >
              <Download size={19} />
            </button>
          </div>
        </div>

        <div className="image-stage" data-testid="image-stage" onDoubleClick={(event) => event.preventDefault()}>
          {batchProcessProgress && (
            <div className="batch-process-badge">
              <progress value={batchProcessProgress.completed} max={Math.max(1, batchProcessProgress.total)} />
              <span>
                {batchProcessProgress.mode === "auto"
                  ? "批量自动"
                  : batchProcessProgress.mode === "consistency"
                    ? "统一色彩"
                    : batchProcessProgress.mode === "aiAuto"
                      ? "批量 AI 调色"
                      : batchProcessProgress.mode === "aiStyle"
                        ? "批量 AI 追色"
                        : "参考风格"} ·{" "}
                {batchProcessProgress.completed}/{batchProcessProgress.total}
                {batchProcessProgress.currentName ? ` · ${batchProcessProgress.currentName}` : ""}
              </span>
              {batchProcessProgress.failed.length > 0 && <em>失败 {batchProcessProgress.failed.length} 张</em>}
              {batchProcessProgress.running && (
                <button onClick={cancelBatchProcess}>
                  <Ban size={14} />
                  取消
                </button>
              )}
              {!batchProcessProgress.running && batchProcessProgress.failed.length > 0 && (
                <button onClick={batchProcessProgress.mode === "consistency" ? runBatchConsistency : retryBatchFailures}>
                  <RotateCcw size={14} />
                  {batchProcessProgress.mode === "consistency" ? "重新统一" : "重试失败"}
                </button>
              )}
              {batchProcessProgress.failed.length > 0 && (
                <div className="batch-failed-list">
                  {batchProcessProgress.failed.slice(0, 3).map((item) => (
                    <span key={item.assetId} title={item.reason}>
                      {item.name} · {item.reason}
                    </span>
                  ))}
                  {batchProcessProgress.failed.length > 3 && <span>还有 {batchProcessProgress.failed.length - 3} 张失败</span>}
                </div>
              )}
            </div>
          )}
          {previewSource ? (
            <>
              {isRendering && (
                <div className="render-badge">
                  <Loader2 className="spin" size={16} />
                  渲染中
                </div>
              )}
              {isCropEditing && cropEditorSource && cropDraft ? (
                <div
                  className="crop-editor"
                  data-testid="crop-editor"
                  onPointerDown={beginCropDraw}
                  onPointerMove={updateCropPointer}
                  onPointerUp={endCropPointer}
                  onPointerCancel={endCropPointer}
                >
                  <img ref={cropBaseImageRef} className="crop-editor-image" src={cropEditorSource} alt={`${selectedAsset?.name ?? "preview"} crop`} />
                  <div className="crop-mask" />
                  <div
                    className="crop-box"
                    data-testid="crop-box"
                    style={{
                      left: `${cropDraft.rect.x}%`,
                      top: `${cropDraft.rect.y}%`,
                      width: `${cropDraft.rect.width}%`,
                      height: `${cropDraft.rect.height}%`
                    }}
                    onPointerDown={beginCropMove}
                  >
                    <button
                      type="button"
                      className="crop-resize-handle crop-resize-nw"
                      aria-label="调整左上裁切角"
                      onPointerDown={(event) => beginCropResize("nw", event)}
                    />
                    <button
                      type="button"
                      className="crop-resize-handle crop-resize-ne"
                      aria-label="调整右上裁切角"
                      onPointerDown={(event) => beginCropResize("ne", event)}
                    />
                    <button
                      type="button"
                      className="crop-resize-handle crop-resize-se"
                      aria-label="调整右下裁切角"
                      onPointerDown={(event) => beginCropResize("se", event)}
                    />
                    <button
                      type="button"
                      className="crop-resize-handle crop-resize-sw"
                      aria-label="调整左下裁切角"
                      onPointerDown={(event) => beginCropResize("sw", event)}
                    />
                  </div>
                  <div className="crop-editor-actions" onPointerDown={(event) => event.stopPropagation()}>
                    <button type="button" onClick={confirmCrop}>
                      <Check size={15} />
                      确认裁切
                    </button>
                    <button type="button" onClick={cancelCrop}>
                      <X size={15} />
                      取消
                    </button>
                  </div>
                </div>
              ) : compareMode === "split" && canCompare ? (
                <div className="compare-view" data-testid="compare-view">
                  <img className="compare-image compare-original" src={originalPreviewSource} alt={`${selectedAsset?.name ?? "preview"} original`} />
                  <div className="compare-edited-layer" style={{ clipPath: `inset(0 ${100 - compareSplit}% 0 0)` }}>
                    <img className="compare-image" src={editedPreviewSource} alt={`${selectedAsset?.name ?? "preview"} edited`} />
                  </div>
                  <div className="compare-divider" style={{ left: `${compareSplit}%` }} />
                  <span className="compare-label original-label">原图</span>
                  <span className="compare-label edited-label">效果</span>
                  <input
                    className="compare-slider"
                    data-testid="compare-slider"
                    type="range"
                    min={5}
                    max={95}
                    value={compareSplit}
                    onChange={(event) => setCompareSplit(Number(event.target.value))}
                  />
                </div>
              ) : (
                <img src={previewSource} alt={selectedAsset?.name ?? "preview"} />
              )}
            </>
          ) : (
            <div className="empty-state">
              <ImagePlus size={42} />
              <h2>导入 JPG 后开始调色</h2>
              <p>RAW 可先记录到项目库并显示内嵌/占位预览，JPG 支持本地 EXIF 读取、相机识别、自动调色和预览渲染。</p>
            </div>
          )}
        </div>

        <div className="film-strip">
          {assets.map((asset) => (
            <button
              key={asset.id}
              className={`film-frame ${asset.id === selectedAsset?.id ? "active" : ""}`}
              onClick={() => setSelectedId(asset.id)}
            >
              <img src={asset.previewUrl} alt={asset.name} />
            </button>
          ))}
        </div>
      </section>

      <aside className="edit-panel">
        <div className="panel-heading">
          <SlidersHorizontal size={20} />
          <h2>编辑参数</h2>
        </div>

        {selectedAsset ? (
          <>
            <section className="meta-box">
              <strong>{selectedAsset.name}</strong>
              <span>
                {selectedAsset.sourceFormat.toUpperCase()} · {selectedAsset.cameraBrand} · {formatPreviewKind(selectedAsset)} · SHA-256{" "}
                {selectedAsset.fileHash.slice(0, 10)}
              </span>
              <span>
                {selectedAsset.metadata.model ?? "未知机身"} · {selectedAsset.metadata.lens ?? "未知镜头"}
              </span>
              <span>
                ISO {selectedAsset.metadata.iso ?? "-"} · f/{selectedAsset.metadata.fNumber ?? "-"} ·{" "}
                {selectedAsset.metadata.exposureTime ?? "-"}
              </span>
              {projectStoreSummary && (
                <span>
                  项目库：JPG {projectStoreSummary.jpg_count} · RAW {projectStoreSummary.raw_count} · 编辑{" "}
                  {projectStoreSummary.edit_count} · 导出 {projectStoreSummary.export_job_count}
                </span>
              )}
            </section>

            {selectedAsset.autoSummary && (
              <section className="summary-box">
                {selectedAsset.autoSummary.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </section>
            )}
            {!selectedAsset.isEditable && (
              <section className="raw-notice">
                <strong>RAW 已进入项目模型</strong>
                <span>{rawDisabledReason}</span>
                <span>
                  {selectedAssetRawAiCapable
                    ? "AI 调色/追色、基础滑杆、HSL 和单张导出会使用 RAW 内嵌 JPEG 预览；完整 RAW 显影和 RAW 输出仍按最后阶段接入。"
                    : "请继续使用 JPG 完成自动调色、参考风格、AI 和导出流程。"}
                </span>
              </section>
            )}

            <AccordionSection
              title="基础调色"
              subtitle="曝光、白平衡、明暗和色彩"
              isOpen={openGroups.basic}
              onToggle={() => toggleGroup("basic")}
            >
              <div className="controls">{basicControls.map((control) => renderEditControl(control))}</div>
            </AccordionSection>

            <AccordionSection
              title="增强参数"
              subtitle="清晰度、纹理、去雾、暗角和颗粒"
              isOpen={openGroups.enhancement}
              onToggle={() => toggleGroup("enhancement")}
            >
              <div className="controls">{enhancementControls.map((control) => renderEditControl(control))}</div>
            </AccordionSection>

            <AccordionSection
              title="构图"
              subtitle={`旋转 ${Math.round(selectedAsset.edits.rotation)}° · ${getCropAspectLabel(selectedAsset.edits.cropAspect)}`}
              isOpen={openGroups.geometry}
              onToggle={() => toggleGroup("geometry")}
              testId="accordion-geometry-trigger"
            >
              <section className="geometry-panel" data-testid="geometry-panel">
                <div className="geometry-actions">
                  <button type="button" onClick={() => rotateSelectedBy(-90)} disabled={!selectedAssetPreviewEditable || isCropEditing}>
                    <RotateCcw size={16} />
                    左转
                  </button>
                  <button type="button" onClick={() => rotateSelectedBy(90)} disabled={!selectedAssetPreviewEditable || isCropEditing}>
                    <RotateCw size={16} />
                    右转
                  </button>
                  <button type="button" onClick={resetGeometry} disabled={!selectedAssetPreviewEditable || isCropEditing}>
                    <Crop size={16} />
                    重置
                  </button>
                </div>
                <div className="crop-ratio-grid" role="group" aria-label="裁切比例">
                  {cropAspectOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={(isCropEditing ? cropDraft?.aspect : selectedAsset.edits.cropAspect) === option.value ? "active" : ""}
                      data-testid={`crop-aspect-${option.value}`}
                      onClick={() => updateCropAspect(option.value)}
                      disabled={!selectedAssetPreviewEditable}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="crop-command-row">
                  <button type="button" onClick={() => startCropSession(selectedAsset.edits.cropAspect)} disabled={!selectedAssetPreviewEditable || isCropEditing}>
                    <Crop size={16} />
                    开始裁切
                  </button>
                  <button type="button" onClick={confirmCrop} disabled={!isCropEditing}>
                    <Check size={16} />
                    确认
                  </button>
                  <button type="button" onClick={cancelCrop} disabled={!isCropEditing}>
                    <X size={16} />
                    取消
                  </button>
                </div>
                <div className="controls">{rotationControls.map((control) => renderEditControl(control, "已调整旋转"))}</div>
              </section>
            </AccordionSection>

            <AccordionSection
              title="人像增强"
              subtitle="磨皮、润色、美齿和衣物纹理"
              isOpen={openGroups.portrait}
              onToggle={() => toggleGroup("portrait")}
              testId="accordion-portrait-trigger"
            >
              <div className="controls">{portraitControls.map((control) => renderEditControl(control))}</div>
            </AccordionSection>

            <AccordionSection
              title="HSL 分色"
              subtitle="肤色保护会限制红/橙过度偏移"
              isOpen={openGroups.hsl}
              onToggle={() => toggleGroup("hsl")}
              testId="accordion-hsl-trigger"
            >
              <div className="hsl-panel">
                {hslChannels.map((channel) => {
                  const values = selectedAsset.edits.hsl[channel];
                  return (
                    <div className="hsl-card" key={channel}>
                      <div className="hsl-head">
                        <span className={`color-swatch swatch-${channel}`} />
                        <strong>{channel}</strong>
                      </div>
                      <label className="mini-slider">
                        <span>H</span>
                        <input
                          data-testid={`hsl-range-${channel}-hue`}
                          type="range"
                          min={-50}
                          max={50}
                          value={values.hue}
                          disabled={!selectedAssetPreviewEditable}
                          onPointerDown={beginEditDraft}
                          onChange={(event) => updateHslControl(channel, "hue", Number(event.target.value), "draft")}
                          onPointerUp={() => commitEditDraft(["已调整 HSL 分色"])}
                          onBlur={() => commitEditDraft(["已调整 HSL 分色"])}
                        />
                        <input
                          data-testid={`hsl-number-${channel}-hue`}
                          className="control-number mini-number"
                          type="number"
                          min={-50}
                          max={50}
                          value={Math.round(values.hue)}
                          disabled={!selectedAssetPreviewEditable}
                          onFocus={beginEditDraft}
                          onChange={(event) => updateHslControl(channel, "hue", Number(event.target.value), "draft")}
                          onBlur={() => commitEditDraft(["已调整 HSL 分色"])}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                        />
                      </label>
                      <label className="mini-slider">
                        <span>S</span>
                        <input
                          data-testid={`hsl-range-${channel}-saturation`}
                          type="range"
                          min={-50}
                          max={50}
                          value={values.saturation}
                          disabled={!selectedAssetPreviewEditable}
                          onPointerDown={beginEditDraft}
                          onChange={(event) => updateHslControl(channel, "saturation", Number(event.target.value), "draft")}
                          onPointerUp={() => commitEditDraft(["已调整 HSL 分色"])}
                          onBlur={() => commitEditDraft(["已调整 HSL 分色"])}
                        />
                        <input
                          data-testid={`hsl-number-${channel}-saturation`}
                          className="control-number mini-number"
                          type="number"
                          min={-50}
                          max={50}
                          value={Math.round(values.saturation)}
                          disabled={!selectedAssetPreviewEditable}
                          onFocus={beginEditDraft}
                          onChange={(event) => updateHslControl(channel, "saturation", Number(event.target.value), "draft")}
                          onBlur={() => commitEditDraft(["已调整 HSL 分色"])}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                        />
                      </label>
                      <label className="mini-slider">
                        <span>L</span>
                        <input
                          data-testid={`hsl-range-${channel}-luminance`}
                          type="range"
                          min={-50}
                          max={50}
                          value={values.luminance}
                          disabled={!selectedAssetPreviewEditable}
                          onPointerDown={beginEditDraft}
                          onChange={(event) => updateHslControl(channel, "luminance", Number(event.target.value), "draft")}
                          onPointerUp={() => commitEditDraft(["已调整 HSL 分色"])}
                          onBlur={() => commitEditDraft(["已调整 HSL 分色"])}
                        />
                        <input
                          data-testid={`hsl-number-${channel}-luminance`}
                          className="control-number mini-number"
                          type="number"
                          min={-50}
                          max={50}
                          value={Math.round(values.luminance)}
                          disabled={!selectedAssetPreviewEditable}
                          onFocus={beginEditDraft}
                          onChange={(event) => updateHslControl(channel, "luminance", Number(event.target.value), "draft")}
                          onBlur={() => commitEditDraft(["已调整 HSL 分色"])}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </AccordionSection>

            <AccordionSection
              title="预设"
              subtitle={`${builtInPresets.length} 个内置 · ${customPresets.length} 个自定义`}
              isOpen={openGroups.presets}
              onToggle={() => toggleGroup("presets")}
              testId="accordion-presets-trigger"
            >
              <section className="preset-series-list">
                {builtInPresetGroups.map((group) => (
                  <div className="preset-series" key={group.series}>
                    <div className="preset-series-title">
                      <strong>{group.series}</strong>
                      <span>{group.presets.length} 个</span>
                    </div>
                    <div className="preset-grid">
                      {group.presets.map((preset) => (
                        <button
                          key={preset.id}
                          data-testid={`preset-button-${preset.id}`}
                          onClick={() => applyPreset(preset.params)}
                          disabled={!selectedAssetPreviewEditable}
                        >
                          <em>{preset.series}</em>
                          <strong>{preset.name}</strong>
                          <span>{preset.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>

              <section className="custom-preset-panel">
                <div className="section-title">
                  <strong>我的预设</strong>
                  <span>保存当前调色参数，后续可直接套用</span>
                </div>
                <div className="preset-save-row">
                  <input
                    type="text"
                    placeholder="预设名称"
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                  />
                  <button onClick={saveCustomPreset} disabled={!selectedAssetPreviewEditable}>
                    <Plus size={16} />
                    保存
                  </button>
                </div>
                {customPresets.length > 0 && (
                  <div className="custom-preset-list">
                    {customPresets.map((preset) => (
                      <div className="custom-preset-row" key={preset.id}>
                        <button onClick={() => applyPreset(preset.params)} disabled={!selectedAssetPreviewEditable}>
                          <strong>{preset.name}</strong>
                          <span>{preset.description}</span>
                        </button>
                        <button className="delete-preset" title="删除预设" onClick={() => deleteCustomPreset(preset.id)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </AccordionSection>

            <AccordionSection
              title="参考风格"
              subtitle={
                referenceStyle
                  ? `${referenceStyle.name} · ${referenceStyle.signature ? "含色彩签名" : "旧版参数"}`
                  : "先把一张已调好的图片设为参考"
              }
              isOpen={openGroups.reference}
              onToggle={() => toggleGroup("reference")}
              testId="accordion-reference-trigger"
            >
              <section
                className="reference-panel"
                data-testid="reference-current-state"
                data-reference-name={referenceStyle?.name ?? ""}
                data-reference-has-signature={String(Boolean(referenceStyle?.signature))}
              >
              <div className="reference-actions">
                <button
                  data-testid="reference-set-current-button"
                  title={referenceActionTitle}
                  onClick={setCurrentAsReference}
                  disabled={!selectedAssetReferenceCapable}
                >
                  <Palette size={16} />
                  设为参考
                </button>
                <button
                  data-testid="reference-apply-current-button"
                  title={referenceActionTitle}
                  onClick={applyReferenceToSelected}
                  disabled={!selectedAssetReferenceCapable || !referenceStyle}
                >
                  <Wand2 size={16} />
                  应用当前
                </button>
                <button onClick={applyReferenceToBatch} disabled={previewEditableBatchTargets.length === 0 || !referenceStyle || isBatchProcessing}>
                  <Sparkles size={16} />
                  应用批量
                </button>
              </div>
              <label className="strength-control">
                <span>
                  参考强度
                  <strong>{referenceStrength}%</strong>
                </span>
                <input
                  data-testid="reference-strength-range"
                  type="range"
                  min={20}
                  max={100}
                  step={5}
                  value={referenceStrength}
                  onChange={(event) => setReferenceStrength(Number(event.target.value))}
                  disabled={isBatchProcessing}
                />
              </label>
              </section>
            </AccordionSection>

            <AccordionSection
              title="AI"
              subtitle={aiSettings.hasApiKey ? `已配置 · ${aiSettings.model}` : "设置后可调色/追色"}
              isOpen={openGroups.ai}
              onToggle={() => toggleGroup("ai")}
              testId="accordion-ai-trigger"
            >
              <section className="ai-panel">
                {aiSettings.hasApiKey && aiSettings.availableModels.length > 0 && !isAiConfigEditing ? (
                  <div className="ai-config-summary">
                    <label>
                      <span>模型</span>
                      <select
                        data-testid="ai-model-select"
                        value={aiModelDraft}
                        onChange={(event) => updateAiModelSelection(event.target.value)}
                        disabled={isSavingAiSettings || isAiTuning}
                      >
                        {aiSettings.availableModels.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      data-testid="ai-edit-config-button"
                      onClick={() => setIsAiConfigEditing(true)}
                      disabled={isSavingAiSettings || isDiagnosingAi || isAiTuning}
                    >
                      <SlidersHorizontal size={16} />
                      修改 AI 配置
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="ai-settings-grid">
                      <label>
                        <span>API key</span>
                        <input
                          data-testid="ai-api-key-input"
                          type="password"
                          value={aiApiKeyDraft}
                          placeholder={aiSettings.hasApiKey ? "已保存，留空则保留" : "保存到系统钥匙串"}
                          autoComplete="new-password"
                          onChange={(event) => setAiApiKeyDraft(event.target.value)}
                        />
                      </label>
                      <label className="ai-settings-wide">
                        <span>Base URL</span>
                        <input
                          data-testid="ai-base-url-input"
                          value={aiBaseUrlDraft}
                          placeholder="https://api.openai.com/v1"
                          autoComplete="off"
                          onChange={(event) => setAiBaseUrlDraft(sanitizeAiBaseUrlForDisplay(event.target.value))}
                          onBlur={() => setAiBaseUrlDraft((current) => sanitizeAiBaseUrlForDisplay(current))}
                        />
                      </label>
                    </div>
                    <button data-testid="ai-save-settings-button" onClick={saveCurrentAiSettings} disabled={!isTauriRuntime() || isSavingAiSettings}>
                      {isSavingAiSettings ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                      {isSavingAiSettings ? "保存并获取模型中" : "保存 AI 设置并获取模型"}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  data-testid="ai-diagnose-connection-button"
                  onClick={runAiConnectionDiagnostic}
                  disabled={!isTauriRuntime() || isSavingAiSettings || isDiagnosingAi || isAiTuning}
                >
                  {isDiagnosingAi ? <Loader2 size={16} className="spin" /> : <ClipboardCheck size={16} />}
                  {isDiagnosingAi ? "诊断 AI 连接中" : "诊断 AI 连接"}
                </button>
                {aiConnectionDiagnostic && (
                  <div className={`ai-connection-diagnostic ${aiConnectionDiagnostic.status}`} data-testid="ai-connection-diagnostic">
                    <strong>{aiConnectionDiagnostic.status === "passed" ? "连接正常" : "需要处理"}</strong>
                    <span>
                      模型 {aiConnectionDiagnostic.model} · {aiConnectionDiagnostic.modelAvailable ? "当前模型可用" : "当前模型待确认"} · 已获取{" "}
                      {aiConnectionDiagnostic.modelCount} 个模型
                    </span>
                    <p>{aiConnectionDiagnostic.message}</p>
                  </div>
                )}
                <label className="ai-instruction-field">
                  <span>调色想法</span>
                  <textarea
                    data-testid="ai-instruction-input"
                    value={aiInstruction}
                    maxLength={500}
                    placeholder="例如：胶片感、肤色自然、压高光、让背景更通透；追色时会结合参考图一起判断。"
                    onChange={(event) => setAiInstruction(event.target.value)}
                    disabled={isAiTuning}
                  />
                </label>
                <div className="ai-actions">
                  <button
                    data-testid="ai-auto-color-button"
                    title={aiActionTitle}
                    onClick={() => runAiTuning("autoColor")}
                    disabled={!selectedAssetAiCapable || isAiTuning || isRendering || isBatchProcessing}
                  >
                    {isAiTuning ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                    AI 调色
                  </button>
                  <button
                    data-testid="ai-style-match-button"
                    title={aiActionTitle}
                    onClick={() => runAiTuning("styleMatch")}
                    disabled={!selectedAssetAiCapable || !referenceStyle || isAiTuning || isRendering || isBatchProcessing}
                  >
                    {isAiTuning ? <Loader2 size={16} className="spin" /> : <Palette size={16} />}
                    AI 追色
                  </button>
                  <button
                    data-testid="ai-batch-auto-color-button"
                    onClick={() => runBatchAiTuning("autoColor")}
                    disabled={previewEditableBatchTargets.length === 0 || isAiTuning || isRendering || isBatchProcessing}
                  >
                    <Sparkles size={16} />
                    批量 AI 调色
                  </button>
                  <button
                    data-testid="ai-batch-style-match-button"
                    onClick={() => runBatchAiTuning("styleMatch")}
                    disabled={previewEditableBatchTargets.length === 0 || !referenceStyle || isAiTuning || isRendering || isBatchProcessing}
                  >
                    <Palette size={16} />
                    批量 AI 追色
                  </button>
                </div>
                <div className="ai-panel-message">
                  <span>{aiPanelMessage || "AI 只在用户点击时发送压缩预览图"}</span>
                </div>
                {aiPendingSuggestion && aiPendingSuggestion.assetId === selectedAsset?.id && (
                  <div className="ai-suggestion-card" data-testid="ai-suggestion-card">
                    <img src={aiPendingSuggestion.previewUrl} alt="AI candidate preview" />
                    <div>
                      <strong>{aiPendingSuggestion.mode === "styleMatch" ? "AI style candidate" : "AI color candidate"}</strong>
                      <span>{aiPendingSuggestion.model}</span>
                      <p>{aiPendingSuggestion.summary}</p>
                      {aiPendingSuggestion.fallbackHint && (
                        <p className="ai-suggestion-fallback" data-testid="ai-suggestion-fallback">
                          {aiPendingSuggestion.fallbackHint}
                        </p>
                      )}
                    </div>
                    <div className="ai-suggestion-actions">
                      <button data-testid="ai-apply-suggestion-button" onClick={applyAiSuggestion}>
                        <CheckSquare size={16} />
                        应用
                      </button>
                      <button data-testid="ai-cancel-suggestion-button" onClick={cancelAiSuggestion}>
                        <Ban size={16} />
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </AccordionSection>

            <AccordionSection
              title="批量一致性"
              subtitle={
                batchConsistencyPreview
                  ? `Pending ${batchConsistencyPreview.groupCount} groups - ${batchConsistencyPreview.assetCount} JPG`
                  : batchConsistencySummary
                    ? `${batchConsistencySummary.groupCount} groups - ${batchConsistencySummary.assetCount} JPG`
                    : "Group by camera, model and capture hour"
              }
              isOpen={openGroups.batch}
              onToggle={() => toggleGroup("batch")}
            >
              <section className="batch-consistency-panel">
              <button onClick={runBatchConsistency} disabled={editableBatchTargets.length === 0 || isImporting || isBatchProcessing}>
                <Palette size={16} />
                {batchConsistencyPreview ? "重新生成预览" : "生成统一预览"}
              </button>
              <label className="strength-control">
                <span>
                  统一强度
                  <strong>{consistencyStrength}%</strong>
                </span>
                <input
                  type="range"
                  min={25}
                  max={100}
                  step={5}
                  value={consistencyStrength}
                  onChange={(event) => {
                    setConsistencyStrength(Number(event.target.value));
                    setBatchConsistencyPreview(undefined);
                  }}
                  disabled={isBatchProcessing}
                />
              </label>
              {batchConsistencyPreview && (
                <div className="batch-consistency-result">
                  <span>
                    待应用 {batchConsistencyPreview.groupCount} 组 · {batchConsistencyPreview.assetCount} 张 JPG ·{" "}
                    {batchConsistencyPreview.hasCustomStrengths ? "自定义强度" : `${batchConsistencyPreview.strength}%`}
                  </span>
                  {batchConsistencyPreview.failedCount > 0 && <em>分析失败 {batchConsistencyPreview.failedCount} 张</em>}
                  <div className="batch-group-strengths">
                    {batchConsistencyPreview.groups.map((group) => (
                      <label className="batch-group-strength" key={group.key}>
                        <span>
                          <strong>{group.label}</strong>
                          <em>
                            {group.assetIds.length} 张 · {group.strength}%
                          </em>
                        </span>
                        <input
                          type="range"
                          min={25}
                          max={100}
                          step={5}
                          value={group.strength}
                          onChange={(event) => updateBatchConsistencyGroupStrength(group.key, Number(event.target.value))}
                          disabled={isBatchProcessing}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="reference-actions">
                    <button onClick={applyBatchConsistencyPreview} disabled={isBatchProcessing}>
                      <CheckSquare size={16} />
                      应用预览
                    </button>
                    <button onClick={cancelBatchConsistencyPreview} disabled={isBatchProcessing}>
                      <Ban size={16} />
                      取消
                    </button>
                  </div>
                </div>
              )}
              {!batchConsistencyPreview && batchConsistencySummary && (
                <div className="batch-consistency-result">
                  {batchConsistencySummary.labels.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                  {batchConsistencySummary.skippedRaw > 0 && <em>已跳过 RAW {batchConsistencySummary.skippedRaw} 张</em>}
                </div>
              )}
              </section>
            </AccordionSection>

            <AccordionSection
              title="导出"
              subtitle={
                isTauriRuntime()
                  ? exportDirectory
                    ? `桌面导出到：${exportDirectory}`
                    : "桌面模式可选择目录写入文件"
                  : browserExportDirectoryName
                    ? `浏览器写入：${browserExportDirectoryName}`
                    : isBrowserDirectoryPickerSupported()
                      ? "可选择文件夹或使用浏览器下载"
                      : batchSelection.size > 0
                        ? `Will process ${batchSelection.size} selected`
                        : "浏览器模式会触发下载"
              }
              isOpen={openGroups.export}
              onToggle={() => toggleGroup("export")}
              testId="accordion-export-trigger"
            >
              <section className="export-panel">
              {(isTauriRuntime() || isBrowserDirectoryPickerSupported()) && (
                <button className="directory-button" data-testid="export-directory-button" onClick={chooseDirectory}>
                  <FolderOpen size={16} />
                  {isTauriRuntime() ? "选择导出目录" : "选择下载文件夹"}
                </button>
              )}
              <div className={`export-target ${exportTargetSelected ? "selected" : ""}`} data-testid="export-target">
                <span>{exportTargetLabel}</span>
                <strong title={exportTargetValue}>{exportTargetValue}</strong>
              </div>
              <div className="export-grid">
                <label>
                  <span>质量</span>
                  <input
                    type="number"
                    min={60}
                    max={100}
                    value={exportSettings.quality}
                    onChange={(event) =>
                      setExportSettings((current) => ({ ...current, quality: Math.min(100, Math.max(60, Number(event.target.value) || 94)) }))
                    }
                  />
                </label>
                <label>
                  <span>最长边</span>
                  <input
                    type="number"
                    min={1200}
                    max={9000}
                    step={100}
                    value={exportSettings.maxEdge}
                    onChange={(event) =>
                      setExportSettings((current) => ({ ...current, maxEdge: Math.min(9000, Math.max(1200, Number(event.target.value) || 4096)) }))
                    }
                  />
                </label>
                <label>
                  <span>前缀</span>
                  <input
                    type="text"
                    value={exportSettings.filenamePrefix}
                    onChange={(event) => setExportSettings((current) => ({ ...current, filenamePrefix: event.target.value }))}
                  />
                </label>
                <label>
                  <span>后缀</span>
                  <input
                    type="text"
                    value={exportSettings.filenameSuffix}
                    onChange={(event) => setExportSettings((current) => ({ ...current, filenameSuffix: event.target.value }))}
                  />
                </label>
                <label>
                  <span>同名文件</span>
                  <select
                    value={exportSettings.conflictStrategy}
                    onChange={(event) =>
                      setExportSettings((current) => ({
                        ...current,
                        conflictStrategy: event.target.value as ExportConflictStrategy
                      }))
                    }
                  >
                    {exportConflictStrategies.map((strategy) => (
                      <option key={strategy.value} value={strategy.value}>
                        {strategy.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={exportSettings.includeSequence}
                  onChange={(event) => setExportSettings((current) => ({ ...current, includeSequence: event.target.checked }))}
                />
                <span>文件名加入四位序号</span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={exportSettings.preserveExif}
                  onChange={(event) => setExportSettings((current) => ({ ...current, preserveExif: event.target.checked }))}
                />
                <span>保留安全 EXIF 拍摄信息</span>
              </label>
              <label className="full-input">
                <span>文字水印</span>
                <input
                  type="text"
                  placeholder="留空则不添加水印"
                  value={exportSettings.watermarkText}
                  onChange={(event) => setExportSettings((current) => ({ ...current, watermarkText: event.target.value }))}
                />
              </label>
              <div className="export-grid">
                <label>
                  <span>位置</span>
                  <select
                    value={exportSettings.watermarkPosition}
                    onChange={(event) => setExportSettings((current) => ({ ...current, watermarkPosition: event.target.value as WatermarkPosition }))}
                  >
                    {watermarkPositions.map((position) => (
                      <option key={position.value} value={position.value}>
                        {position.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>透明度</span>
                  <input
                    type="number"
                    min={10}
                    max={100}
                    value={exportSettings.watermarkOpacity}
                    onChange={(event) =>
                      setExportSettings((current) => ({
                        ...current,
                        watermarkOpacity: Math.min(100, Math.max(10, Number(event.target.value) || 55))
                      }))
                    }
                  />
                </label>
                <label>
                  <span>字号比例</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    step={0.5}
                    value={exportSettings.watermarkSize}
                    onChange={(event) =>
                      setExportSettings((current) => ({
                        ...current,
                        watermarkSize: Math.min(8, Math.max(1, Number(event.target.value) || 3))
                      }))
                    }
                  />
                </label>
              </div>
              <div className="export-actions">
                <button
                  data-testid="export-current-button"
                  title={exportActionTitle}
                  onClick={exportCurrent}
                  disabled={!selectedAssetPreviewExportable || exportProgress.running || isRendering || isBatchProcessing}
                >
                  <Download size={16} />
                  导出当前
                </button>
                <button
                  data-testid="export-batch-button"
                  onClick={exportBatch}
                  disabled={previewEditableBatchTargets.length === 0 || exportProgress.running || isRendering || isBatchProcessing}
                >
                  <Download size={16} />
                  批量导出
                </button>
                <button onClick={cancelExport} disabled={!exportProgress.running}>
                  <Ban size={16} />
                  取消
                </button>
              </div>
              {(exportProgress.running || exportProgress.total > 0) && (
                <div className="export-progress">
                  <progress value={exportProgress.completed} max={Math.max(1, exportProgress.total)} />
                  <span>
                    {exportProgress.completed}/{exportProgress.total}
                    {exportProgress.currentName ? ` · ${exportProgress.currentName}` : ""}
                  </span>
                  {exportProgress.failed.length > 0 && <em>失败 {exportProgress.failed.length} 张</em>}
                  {exportProgress.failed.length > 0 && !exportProgress.running && (
                    <button className="retry-button" onClick={retryFailedExports}>
                      Retry failed items
                    </button>
                  )}
                </div>
              )}
              {shouldShowExportHistory && (
                <div className="export-history" data-testid="export-history">
                  <div className="panel-subhead">
                    <strong>最近导出</strong>
                    <button className="text-button" onClick={refreshExportHistory} disabled={exportProgress.running}>
                      刷新
                    </button>
                  </div>
                  {exportHistory.length === 0 ? (
                    <p>还没有桌面导出记录</p>
                  ) : (
                    <ul>
                      {exportHistory.map((job, index) => (
                        <li key={job.jobId} data-testid={`export-history-row-${index}`}>
                          {(() => {
                            const detail = formatExportJobDetail(job);
                            return detail ? (
                              <small className="export-history-detail" data-testid={`export-history-detail-${index}`} title={detail}>
                                {detail}
                              </small>
                            ) : null;
                          })()}
                          <div>
                            <strong>{formatExportJobStatus(job.status)}</strong>
                            <span>
                              {formatExportJobMode(job.mode)} · {job.completedCount}/{job.totalCount}
                              {job.failedCount > 0 ? ` · 失败 ${job.failedCount}` : ""}
                            </span>
                          </div>
                          <em>{formatExportJobTime(job.createdAt)}</em>
                          {job.outputDir && (
                            <small className="export-history-path" title={job.outputDir}>
                              {job.outputDir}
                            </small>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              </section>
            </AccordionSection>

          </>
        ) : (
          <div className="side-empty">等待导入图片</div>
        )}
      </aside>
    </main>
  );
}
