export type CameraBrand = "Sony" | "Nikon" | "Unknown";
export type SourceFormat = "jpg" | "raw";
export type PreviewKind = "jpg" | "raw_embedded" | "raw_placeholder";

export type HslChannel =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "aqua"
  | "blue"
  | "purple"
  | "magenta";

export interface HslAdjustment {
  hue: number;
  saturation: number;
  luminance: number;
}

export interface EditParams {
  schemaVersion: 1;
  rotation: number;
  cropAspect: "free" | "original" | "1:1" | "4:5" | "3:4" | "4:3" | "16:9" | "9:16";
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  exposure: number;
  temperature: number;
  tint: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  saturation: number;
  vibrance: number;
  transparency: number;
  clarity: number;
  texture: number;
  dehaze: number;
  vignette: number;
  grain: number;
  sharpness: number;
  noiseReduction: number;
  qualityEnhancement: number;
  skinProtection: number;
  skinSmoothing: number;
  skinTone: number;
  teethWhitening: number;
  clothingWrinkleReduction: number;
  hsl: Record<HslChannel, HslAdjustment>;
}

export interface PhotoMetadata {
  make?: string;
  model?: string;
  lens?: string;
  iso?: number;
  exposureTime?: string;
  fNumber?: number;
  focalLength?: number;
  whiteBalance?: string;
  dateTimeOriginal?: string;
  orientation?: number | string;
}

export interface PhotoAsset {
  id: string;
  file: File;
  fileHash: string;
  name: string;
  size: number;
  type: string;
  sourceFormat: SourceFormat;
  isEditable: boolean;
  objectUrl: string;
  previewUrl: string;
  previewKind: PreviewKind;
  cameraBrand: CameraBrand;
  metadata: PhotoMetadata;
  edits: EditParams;
  autoSummary?: string[];
}

export interface AutoAnalysis {
  averageLuma: number;
  lumaStdDev: number;
  shadowRatio: number;
  highlightRatio: number;
  redBalance: number;
  greenBalance: number;
  blueBalance: number;
  warmBias: number;
  skinLikeRatio: number;
}

export interface ReferenceColorSignature {
  averageLuma: number;
  warmBias: number;
  greenBias: number;
  skinLikeRatio: number;
  styledLuma: number;
  styledWarmBias: number;
  styledGreenBias: number;
}

export type PresetSeries = "人像" | "风光" | "建筑" | "城市" | "个性";

export interface Preset {
  id: string;
  series?: PresetSeries;
  name: string;
  description: string;
  params: Partial<EditParams>;
}

export type WatermarkPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "center";
export type ExportConflictStrategy = "rename" | "skip" | "overwrite";

export interface ExportSettings {
  quality: number;
  maxEdge: number;
  filenamePrefix: string;
  filenameSuffix: string;
  includeSequence: boolean;
  conflictStrategy: ExportConflictStrategy;
  preserveExif: boolean;
  watermarkText: string;
  watermarkPosition: WatermarkPosition;
  watermarkOpacity: number;
  watermarkSize: number;
}

export interface ExportProgress {
  running: boolean;
  total: number;
  completed: number;
  currentName?: string;
  failed: Array<{ assetId: string; name: string; reason: string }>;
}

export interface WorkflowSettings {
  referenceStrength: number;
  consistencyStrength: number;
}

export interface ProjectSnapshotAsset {
  name: string;
  size: number;
  type: string;
  fileHash?: string;
  sourceFormat?: SourceFormat;
  isEditable?: boolean;
  previewKind?: PreviewKind;
  cameraBrand: CameraBrand;
  metadata: PhotoMetadata;
  edits: EditParams;
  autoSummary?: string[];
}

export interface ProjectSnapshot {
  schemaVersion: 1;
  appName: "AutoPhoto" | "Auto Photo";
  savedAt: string;
  assets: ProjectSnapshotAsset[];
  exportSettings: ExportSettings;
  customPresets?: Preset[];
  workflowSettings?: WorkflowSettings;
  referenceStyle?: {
    name: string;
    edits: EditParams;
    signature?: ReferenceColorSignature;
  };
}

export interface ProjectStoreSummary {
  path: string;
  asset_count: number;
  jpg_count: number;
  raw_count: number;
  editable_count: number;
  metadata_count: number;
  edit_count: number;
  preset_count: number;
  export_job_count: number;
  named_project_count: number;
  snapshot_updated_at?: string;
}

export interface NamedProjectInfo {
  projectId: string;
  name: string;
  assetCount: number;
  jpgCount: number;
  rawCount: number;
  updatedAt: string;
}

export interface ExportJobRecord {
  mode: "single" | "batch" | "retry";
  status: "completed" | "completed_with_failures" | "failed" | "cancelled";
  totalCount: number;
  completedCount: number;
  failedCount: number;
  outputDir?: string;
  items?: Array<{
    assetId: string;
    name: string;
    status: "written" | "skipped" | "failed";
    requestedName?: string;
    outputName?: string;
    outputPath?: string;
    reason?: string;
  }>;
  failed?: Array<{ assetId: string; name: string; reason: string }>;
}

export interface ExportJobHistory extends ExportJobRecord {
  jobId: string;
  createdAt: string;
}

export interface AiSettingsState {
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  availableModels: string[];
}

export interface AiConnectionDiagnostic {
  status: "passed" | "failed";
  hasApiKey: boolean;
  model: string;
  modelAvailable: boolean;
  modelCount: number;
  message: string;
}

export type AiTuningMode = "autoColor" | "styleMatch";

export interface AiTuningResult {
  model: string;
  summary: string;
  params: Partial<EditParams>;
}
