import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  Check,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Minus,
  Palette,
  RotateCcw,
  RotateCw,
  ScanFace,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
  Crop,
  Undo2,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AiSettingsState, AiTuningResult, AutoAnalysis, EditParams, HslChannel, PhotoAsset } from "../types";
import type { PlatformCapabilities } from "../platform";
import { builtInPresets, createDefaultEditParams, hslChannels, mergeEditParams, normalizeEditParams, portraitBeautyQuickEdits } from "../services/editParams";
import { analyzeImage, createAutoEdit, formatFileSize, importPhotoFile, renderImageSourceWithEdits } from "../services/imageProcessing";
import { clearAiSettings, diagnoseAiConnection, getAiSettings, isAiRuntimeAvailable, saveAiSettings, tunePhotoWithAi } from "../services/desktopBridge";

interface MobileAppProps {
  capabilities: PlatformCapabilities;
}

type MobileTool = "ai" | "presets" | "tuning" | "beauty" | "hsl" | "crop" | "enhance";
type MobileAiConnectionState = "idle" | "checking" | "available" | "unavailable";
type NumericEditParamKey = {
  [Key in keyof EditParams]: EditParams[Key] extends number ? Key : never;
}[keyof EditParams] & Exclude<keyof EditParams, "schemaVersion">;
type MobileIcon = LucideIcon;

interface MobileEditControl {
  key: NumericEditParamKey;
  label: string;
  min: number;
  max: number;
  step?: number;
}

interface MobileAiCandidate {
  id: string;
  label: string;
  summary: string;
  model: string;
  params: EditParams;
  previewUrl: string;
}

const MOBILE_PREVIEW_MAX_EDGE = 1500;
const MOBILE_PREVIEW_QUALITY = 0.9;

const mobileTools: Array<{ id: MobileTool; label: string; icon: MobileIcon }> = [
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "presets", label: "预设", icon: Palette },
  { id: "tuning", label: "调色", icon: SlidersHorizontal },
  { id: "beauty", label: "美化", icon: ScanFace },
  { id: "hsl", label: "HSL", icon: Wand2 },
  { id: "crop", label: "裁切", icon: Crop },
  { id: "enhance", label: "增强", icon: ZoomIn }
];

const basicControls: MobileEditControl[] = [
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

const enhanceControls: MobileEditControl[] = [
  { key: "transparency", label: "通透", min: 0, max: 100 },
  { key: "clarity", label: "清晰度", min: -50, max: 50 },
  { key: "texture", label: "纹理", min: -50, max: 50 },
  { key: "dehaze", label: "去雾", min: -50, max: 50 },
  { key: "vignette", label: "暗角", min: -50, max: 50 },
  { key: "grain", label: "颗粒", min: 0, max: 50 },
  { key: "sharpness", label: "锐化", min: 0, max: 40 },
  { key: "noiseReduction", label: "降噪", min: 0, max: 100 },
  { key: "qualityEnhancement", label: "画质增强", min: 0, max: 100 },
];

const beautyControls: MobileEditControl[] = [
  { key: "skinProtection", label: "肤色保护", min: 0, max: 100 },
  { key: "faceSlimming", label: "瘦脸", min: 0, max: 100 },
  { key: "bodySlimming", label: "瘦身", min: 0, max: 100 },
  { key: "eyeEnlargement", label: "大眼", min: 0, max: 100 },
  { key: "wrinkleReduction", label: "面部去皱", min: 0, max: 100 },
  { key: "skinToneUniformity", label: "统一肤色", min: 0, max: 100 },
  { key: "skinSmoothing", label: "磨皮", min: 0, max: 100 },
  { key: "skinTone", label: "润色", min: -50, max: 50 },
  { key: "teethWhitening", label: "美齿", min: 0, max: 100 },
  { key: "clothingWrinkleReduction", label: "衣物去褶皱", min: 0, max: 100 }
];

const aiControls = [...basicControls, ...enhanceControls, ...beautyControls];

const hslChannelLabels: Record<HslChannel, string> = {
  red: "红色",
  orange: "橙色",
  yellow: "黄色",
  green: "绿色",
  aqua: "青色",
  blue: "蓝色",
  purple: "紫色",
  magenta: "洋红"
};

const cropAspectLabels: Record<EditParams["cropAspect"], string> = {
  free: "自由",
  original: "原比例",
  "1:1": "1:1",
  "4:5": "4:5",
  "3:4": "3:4",
  "4:3": "4:3",
  "16:9": "16:9",
  "9:16": "9:16"
};

const cropAspectValues: EditParams["cropAspect"][] = ["free", "original", "1:1", "4:5", "3:4", "4:3", "16:9", "9:16"];

const defaultAiSettings: AiSettingsState = {
  model: "gpt-5.5",
  baseUrl: "https://api.openai.com/v1",
  hasApiKey: false,
  availableModels: []
};

const aiSafeLimits: Partial<Record<NumericEditParamKey, { min: number; max: number; delta: number }>> = {
  exposure: { min: -24, max: 24, delta: 16 },
  temperature: { min: -26, max: 26, delta: 20 },
  tint: { min: -22, max: 22, delta: 18 },
  contrast: { min: -22, max: 26, delta: 18 },
  highlights: { min: -44, max: 22, delta: 24 },
  shadows: { min: -24, max: 42, delta: 24 },
  whites: { min: -24, max: 24, delta: 18 },
  blacks: { min: -28, max: 18, delta: 18 },
  saturation: { min: -24, max: 24, delta: 16 },
  vibrance: { min: -24, max: 30, delta: 18 },
  transparency: { min: 0, max: 58, delta: 34 },
  clarity: { min: -22, max: 26, delta: 18 },
  texture: { min: -22, max: 24, delta: 18 },
  dehaze: { min: -18, max: 18, delta: 14 },
  vignette: { min: -20, max: 24, delta: 18 },
  grain: { min: 0, max: 28, delta: 14 },
  sharpness: { min: 0, max: 24, delta: 12 },
  noiseReduction: { min: 0, max: 64, delta: 36 },
  qualityEnhancement: { min: 0, max: 58, delta: 34 },
  skinProtection: { min: 60, max: 96, delta: 28 },
  faceSlimming: { min: 0, max: 38, delta: 24 },
  bodySlimming: { min: 0, max: 34, delta: 22 },
  eyeEnlargement: { min: 0, max: 30, delta: 20 },
  wrinkleReduction: { min: 0, max: 52, delta: 32 },
  skinToneUniformity: { min: 0, max: 68, delta: 42 },
  skinSmoothing: { min: 0, max: 45, delta: 24 },
  skinTone: { min: -18, max: 18, delta: 14 },
  teethWhitening: { min: 0, max: 42, delta: 22 },
  clothingWrinkleReduction: { min: 0, max: 55, delta: 28 }
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const roundToStep = (value: number, step = 1) => Math.round(value / step) * step;

const sanitizeExportName = (name: string) => {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_") || "autophoto";
  return `${stem}-autophoto.jpg`;
};

const releaseAsset = (asset?: PhotoAsset) => {
  if (asset?.objectUrl) URL.revokeObjectURL(asset.objectUrl);
};

const clampAiValueAroundBaseline = (key: NumericEditParamKey, baseline: EditParams, value: number) => {
  const control = aiControls.find((item) => item.key === key);
  const safe = aiSafeLimits[key];
  if (!control || !safe) return value;
  const baseValue = baseline[key];
  const limited = clamp(value, Math.max(control.min, safe.min), Math.min(control.max, safe.max));
  return clamp(limited, baseValue - safe.delta, baseValue + safe.delta);
};

const makeAiParamsSafe = (baseline: EditParams, params: EditParams): EditParams => {
  const safePatch: Partial<EditParams> = {};
  aiControls.forEach((control) => {
    safePatch[control.key] = clampAiValueAroundBaseline(control.key, baseline, params[control.key]);
  });

  const colorLoad =
    Math.max(0, safePatch.saturation ?? params.saturation) +
    Math.max(0, safePatch.vibrance ?? params.vibrance) * 0.72 +
    Math.max(0, safePatch.dehaze ?? params.dehaze) * 0.32 +
    Math.max(0, safePatch.transparency ?? params.transparency) * 0.12 +
    Math.max(0, safePatch.contrast ?? params.contrast) * 0.18;
  if (colorLoad > 42) {
    const reduction = 42 / colorLoad;
    safePatch.saturation = Math.round((safePatch.saturation ?? params.saturation) * reduction);
    safePatch.vibrance = Math.round((safePatch.vibrance ?? params.vibrance) * (0.82 + reduction * 0.18));
    safePatch.dehaze = Math.round((safePatch.dehaze ?? params.dehaze) * (0.76 + reduction * 0.24));
  }

  const detailLoad =
    Math.max(0, safePatch.transparency ?? params.transparency) * 0.24 +
    Math.max(0, safePatch.clarity ?? params.clarity) * 0.42 +
    Math.max(0, safePatch.texture ?? params.texture) * 0.32 +
    Math.max(0, safePatch.dehaze ?? params.dehaze) * 0.34 +
    Math.max(0, safePatch.sharpness ?? params.sharpness) * 0.48 +
    Math.max(0, safePatch.qualityEnhancement ?? params.qualityEnhancement) * 0.28;
  if (detailLoad > 14) {
    safePatch.noiseReduction = Math.max(
      safePatch.noiseReduction ?? params.noiseReduction,
      Math.round(clamp(8 + detailLoad * 0.42, 0, 48))
    );
  }

  safePatch.hsl = Object.fromEntries(
    hslChannels.map((channel) => {
      const baseChannel = baseline.hsl[channel];
      const targetChannel = params.hsl[channel];
      return [
        channel,
        {
          hue: clamp(targetChannel.hue, baseChannel.hue - 16, baseChannel.hue + 16),
          saturation: clamp(targetChannel.saturation, baseChannel.saturation - 14, baseChannel.saturation + 14),
          luminance: clamp(targetChannel.luminance, baseChannel.luminance - 14, baseChannel.luminance + 14)
        }
      ];
    })
  ) as EditParams["hsl"];

  return normalizeEditParams({ ...baseline, ...safePatch });
};

const normalizeAiResultParams = (baseline: EditParams, result: AiTuningResult): EditParams => {
  const incoming = result.params ?? {};
  const patch: Partial<EditParams> = {};
  aiControls.forEach((control) => {
    const value = incoming[control.key];
    if (typeof value === "number" && Number.isFinite(value)) {
      patch[control.key] = clamp(roundToStep(value, control.step ?? 1), control.min, control.max);
    }
  });

  if (incoming.hsl && typeof incoming.hsl === "object") {
    patch.hsl = Object.fromEntries(
      hslChannels.map((channel) => {
        const current = baseline.hsl[channel];
        const value = incoming.hsl?.[channel];
        return [
          channel,
          {
            hue: typeof value?.hue === "number" ? clamp(roundToStep(value.hue), -50, 50) : current.hue,
            saturation: typeof value?.saturation === "number" ? clamp(roundToStep(value.saturation), -50, 50) : current.saturation,
            luminance: typeof value?.luminance === "number" ? clamp(roundToStep(value.luminance), -50, 50) : current.luminance
          }
        ];
      })
    ) as EditParams["hsl"];
  }

  return makeAiParamsSafe(baseline, normalizeEditParams({ ...baseline, ...patch, hsl: patch.hsl ?? baseline.hsl }));
};

const blendAiEditParams = (baseline: EditParams, target: EditParams, strength: number): EditParams => {
  const amount = clamp(strength / 100, 0, 1);
  const patch: Partial<EditParams> = {};
  aiControls.forEach((control) => {
    const value = baseline[control.key] + (target[control.key] - baseline[control.key]) * amount;
    patch[control.key] = clamp(roundToStep(value, control.step ?? 1), control.min, control.max);
  });
  patch.hsl = Object.fromEntries(
    hslChannels.map((channel) => [
      channel,
      {
        hue: clamp(roundToStep(baseline.hsl[channel].hue + (target.hsl[channel].hue - baseline.hsl[channel].hue) * amount), -50, 50),
        saturation: clamp(
          roundToStep(baseline.hsl[channel].saturation + (target.hsl[channel].saturation - baseline.hsl[channel].saturation) * amount),
          -50,
          50
        ),
        luminance: clamp(roundToStep(baseline.hsl[channel].luminance + (target.hsl[channel].luminance - baseline.hsl[channel].luminance) * amount), -50, 50)
      }
    ])
  ) as EditParams["hsl"];
  return makeAiParamsSafe(baseline, normalizeEditParams({ ...baseline, ...patch }));
};

const scaleAiEditParams = (baseline: EditParams, target: EditParams, scale: number, extra: Partial<EditParams> = {}) => {
  const scaled: Partial<EditParams> = {};
  aiControls.forEach((control) => {
    const value = baseline[control.key] + (target[control.key] - baseline[control.key]) * scale;
    scaled[control.key] = clamp(roundToStep(value, control.step ?? 1), control.min, control.max);
  });
  return makeAiParamsSafe(baseline, mergeEditParams(normalizeEditParams({ ...baseline, ...scaled }), extra));
};

const createAiVariants = (baseline: EditParams, primary: EditParams, summary: string) => [
  {
    idSuffix: "subtle-intent",
    label: "方案 A · 轻量表达",
    summary: `${summary}（保留同一创作意图，以较轻强度呈现。）`,
    params: scaleAiEditParams(baseline, primary, 0.78)
  },
  {
    idSuffix: "faithful-intent",
    label: "方案 B · 忠实表达",
    summary: `${summary}（完整执行用户描述的色彩、影调和氛围方向。）`,
    params: makeAiParamsSafe(baseline, primary)
  },
  {
    idSuffix: "bold-intent",
    label: "方案 C · 强化表达",
    summary: `${summary}（不改变创作方向，仅强化用户要求的个性化特征。）`,
    params: scaleAiEditParams(baseline, primary, 1.16)
  }
];

const enhanceAiInstruction = (instruction: string, analysis?: AutoAnalysis) => {
  const raw = instruction.trim();
  const observations: string[] = [];
  if (analysis) {
    if (analysis.averageLuma < 86) observations.push("原片整体偏暗");
    if (analysis.averageLuma > 178) observations.push("原片整体偏亮且需要留意高光容量");
    if (analysis.shadowRatio > 0.18) observations.push("暗部占比较高，强行拉升时需兼顾噪点");
    if (analysis.highlightRatio > 0.08) observations.push("高光占比较高，需避免剪切");
    if (analysis.skinLikeRatio > 0.04) observations.push("画面可能包含肤色区域");
  }
  return [
    `用户原始指令（最高优先级，必须逐项落实）：${raw || "未提供具体指令，请依据画面内容做基础校正"}`,
    "执行规则：先识别用户要求的色彩、影调、氛围、年代感、材质感和主体关系，再映射为参数；不得擅自把个性化描述替换成“自然、风格、通透”等泛化模板。",
    observations.length ? `客观画面信息（只用于避免技术缺陷，不能覆盖用户审美）：${observations.join("；")}` : undefined,
    "质量底线：保持可用的明暗层次和画面通透度，但通透只是技术质量约束，不是固定审美方向；允许冷峻、低饱和、暗调、复古、电影感、高反差等明确风格。summary 必须说明具体执行了用户指令中的哪些特征。"
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1200);
};

const createLocalAiResult = (asset: PhotoAsset, analysis: AutoAnalysis, instruction: string): AiTuningResult => {
  const auto = createAutoEdit(asset, analysis).edits;
  const text = instruction.toLowerCase();
  const portrait = /人像|肤色|皮肤|磨皮|美齿|portrait|skin/.test(text) || analysis.skinLikeRatio > 0.04;
  const warm = /暖|夕阳|金色|橙黄|warm|golden/.test(text) ? 1 : /冷|蓝调|青色|清冷|cool|cyan/.test(text) ? -1 : 0;
  const muted = /低饱和|去饱和|灰调|克制|褪色|muted|desaturat/.test(text);
  const vivid = /鲜艳|浓郁|高饱和|多彩|vivid|colorful/.test(text);
  const moody = /暗调|阴郁|情绪|冷峻|黑金|夜景|moody|dark/.test(text);
  const bright = /明亮|高调|轻盈|清新|bright|high key/.test(text);
  const film = /胶片|复古|怀旧|电影|港风|日系|film|vintage|cinematic/.test(text);
  const soft = /柔和|柔焦|朦胧|奶油|低对比|soft|dreamy/.test(text);
  const crisp = /硬朗|高反差|清晰|锐利|质感|crisp|dramatic/.test(text);
  return {
    model: "local-color-science",
    summary: `本地回退已按用户指令生成${film ? "胶片/电影质感" : "个性化"}候选，并保留基础画质约束。`,
    params: mergeEditParams(auto, {
      exposure: clamp(auto.exposure + (bright ? 7 : 0) - (moody ? 7 : 0), -50, 50),
      temperature: clamp(auto.temperature + warm * 12, -50, 50),
      contrast: clamp(auto.contrast + (crisp || moody ? 10 : 0) - (soft ? 10 : 0), -50, 50),
      highlights: clamp(auto.highlights - (film || moody ? 8 : 2), -60, 40),
      shadows: clamp(auto.shadows + (bright ? 8 : 0) - (moody ? 6 : 0), -40, 60),
      blacks: clamp(auto.blacks - (moody ? 10 : 0) + (film ? 5 : 0), -40, 40),
      saturation: clamp(auto.saturation + (vivid ? 12 : 0) - (muted || film ? 10 : 0), -50, 50),
      vibrance: clamp(auto.vibrance + (vivid ? 10 : 0) - (muted ? 6 : 0), -50, 50),
      transparency: clamp(auto.transparency + 5, 0, 100),
      clarity: clamp(auto.clarity + (crisp ? 7 : 0) - (soft || portrait ? 4 : 0), -50, 50),
      texture: clamp(auto.texture + (crisp ? 5 : 0) - (soft || portrait ? 5 : 0), -50, 50),
      dehaze: clamp(auto.dehaze + (moody || crisp ? 5 : 2), -50, 50),
      vignette: clamp(auto.vignette + (film || moody ? 9 : 0), -50, 50),
      grain: clamp(auto.grain + (film ? 12 : 0), 0, 50),
      noiseReduction: clamp(auto.noiseReduction + 8, 0, 100),
      qualityEnhancement: clamp(auto.qualityEnhancement + 10, 0, 100),
      skinProtection: clamp(Math.max(auto.skinProtection, portrait ? 84 : auto.skinProtection), 0, 100)
    })
  };
};

const getCameraSummary = (asset: PhotoAsset, analysis: AutoAnalysis) =>
  [
    `文件 ${asset.name}`,
    `相机 ${asset.cameraBrand}`,
    asset.metadata.model ? `型号 ${asset.metadata.model}` : undefined,
    asset.metadata.iso ? `ISO ${asset.metadata.iso}` : undefined,
    `亮度 ${analysis.averageLuma.toFixed(1)}`,
    `高光 ${(analysis.highlightRatio * 100).toFixed(1)}%`,
    `阴影 ${(analysis.shadowRatio * 100).toFixed(1)}%`,
    `肤色候选 ${(analysis.skinLikeRatio * 100).toFixed(1)}%`
  ]
    .filter(Boolean)
    .join("；");

const editParamsSignature = (params: EditParams) => JSON.stringify(normalizeEditParams(params));

const areEditParamsEqual = (left: EditParams, right: EditParams) =>
  editParamsSignature(left) === editParamsSignature(right);

const createOriginalCompareParams = (edits: EditParams) =>
  mergeEditParams(createDefaultEditParams(), {
    rotation: edits.rotation,
    cropAspect: edits.cropAspect,
    cropX: edits.cropX,
    cropY: edits.cropY,
    cropWidth: edits.cropWidth,
    cropHeight: edits.cropHeight
  });

export function MobileApp({ capabilities }: MobileAppProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const assetRef = useRef<PhotoAsset>();
  const aiBaselineRef = useRef<EditParams>();
  const editsRef = useRef<EditParams>(createDefaultEditParams());
  const historyGestureRef = useRef<{ snapshot: EditParams; pushed: boolean }>();
  const aiSettingsRequestRef = useRef(0);
  const [asset, setAsset] = useState<PhotoAsset>();
  const [edits, setEdits] = useState<EditParams>(() => createDefaultEditParams());
  const [undoStack, setUndoStack] = useState<EditParams[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [originalCompareUrl, setOriginalCompareUrl] = useState<string>();
  const [isPreparingCompare, setIsPreparingCompare] = useState(false);
  const [isCompareActive, setIsCompareActive] = useState(false);
  const [comparePosition, setComparePosition] = useState(50);
  const [activeTool, setActiveTool] = useState<MobileTool>("tuning");
  const [status, setStatus] = useState(`${capabilities.label} 版当前仅支持 JPG/JPEG`);
  const [isImporting, setIsImporting] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [aiSettings, setAiSettings] = useState<AiSettingsState>(defaultAiSettings);
  const [aiApiKeyDraft, setAiApiKeyDraft] = useState("");
  const [aiBaseUrlDraft, setAiBaseUrlDraft] = useState(defaultAiSettings.baseUrl);
  const [aiModelDraft, setAiModelDraft] = useState(defaultAiSettings.model);
  const [aiInstruction, setAiInstruction] = useState("");
  const [isSavingAiSettings, setIsSavingAiSettings] = useState(false);
  const [isClearingAiSettings, setIsClearingAiSettings] = useState(false);
  const [isAiSettingsHydrated, setIsAiSettingsHydrated] = useState(false);
  const [aiConnectionState, setAiConnectionState] = useState<MobileAiConnectionState>("idle");
  const [aiPanelVisitToken, setAiPanelVisitToken] = useState(0);
  const [isAiRunning, setIsAiRunning] = useState(false);
  const [aiCandidates, setAiCandidates] = useState<MobileAiCandidate[]>([]);
  const [selectedAiCandidateId, setSelectedAiCandidateId] = useState<string>();
  const [aiStrength, setAiStrength] = useState(100);
  const [aiStrengthPreviewUrl, setAiStrengthPreviewUrl] = useState<string>();

  const selectedAiCandidate = useMemo(
    () => aiCandidates.find((candidate) => candidate.id === selectedAiCandidateId) ?? aiCandidates[0],
    [aiCandidates, selectedAiCandidateId]
  );
  const displayPreviewUrl = aiStrengthPreviewUrl ?? selectedAiCandidate?.previewUrl ?? previewUrl;
  const canComparePreview = Boolean(asset && displayPreviewUrl && originalCompareUrl);
  const isAiConfigurationAvailable = aiConnectionState === "available";

  useEffect(() => {
    assetRef.current = asset;
  }, [asset]);

  useEffect(() => {
    editsRef.current = edits;
  }, [edits]);

  useEffect(() => {
    return () => {
      releaseAsset(assetRef.current);
      aiSettingsRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!isAiRuntimeAvailable()) return;
    void getAiSettings()
      .then((settings) => {
        setAiSettings(settings);
        setAiBaseUrlDraft(settings.baseUrl);
        setAiModelDraft(settings.model);
        setIsAiSettingsHydrated(true);
      })
      .catch(() => {
        setIsAiSettingsHydrated(true);
        setStatus("移动端 AI 设置读取失败，可稍后重试");
      });
  }, []);

  useEffect(() => {
    if (!asset) {
      setPreviewUrl(undefined);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsRendering(true);
      try {
        const rendered = await renderImageSourceWithEdits(asset.objectUrl, edits, {
          maxEdge: MOBILE_PREVIEW_MAX_EDGE,
          quality: MOBILE_PREVIEW_QUALITY,
          orientation: asset.metadata.orientation,
          signal: controller.signal
        });
        if (!controller.signal.aborted) setPreviewUrl(rendered);
      } catch (error) {
        if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "预览渲染失败");
      } finally {
        if (!controller.signal.aborted) setIsRendering(false);
      }
    }, 90);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [asset, edits]);

  useEffect(() => {
    setOriginalCompareUrl(undefined);
    if (!asset || !isCompareActive) {
      setIsPreparingCompare(false);
      return;
    }

    const controller = new AbortController();
    setIsPreparingCompare(true);
    void renderImageSourceWithEdits(asset.objectUrl, createOriginalCompareParams(edits), {
      maxEdge: MOBILE_PREVIEW_MAX_EDGE,
      quality: MOBILE_PREVIEW_QUALITY,
      orientation: asset.metadata.orientation,
      signal: controller.signal
    })
      .then((rendered) => {
        if (!controller.signal.aborted) setOriginalCompareUrl(rendered);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "原图比较预览生成失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsPreparingCompare(false);
      });

    return () => controller.abort();
  }, [asset, isCompareActive, edits.rotation, edits.cropAspect, edits.cropX, edits.cropY, edits.cropWidth, edits.cropHeight]);

  useEffect(() => {
    if (!asset || !selectedAiCandidate || !aiBaselineRef.current) {
      setAiStrengthPreviewUrl(undefined);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const blended = blendAiEditParams(aiBaselineRef.current ?? edits, selectedAiCandidate.params, aiStrength);
        const rendered = await renderImageSourceWithEdits(asset.objectUrl, blended, {
          maxEdge: MOBILE_PREVIEW_MAX_EDGE,
          quality: MOBILE_PREVIEW_QUALITY,
          orientation: asset.metadata.orientation,
          signal: controller.signal
        });
        if (!controller.signal.aborted) setAiStrengthPreviewUrl(rendered);
      } catch {
        if (!controller.signal.aborted) setAiStrengthPreviewUrl(selectedAiCandidate.previewUrl);
      }
    }, 80);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [asset, selectedAiCandidate, aiStrength, edits]);

  const exportTargetText = useMemo(() => capabilities.exportTargets.join(" / "), [capabilities.exportTargets]);

  const clearAiCandidates = () => {
    setAiCandidates([]);
    setSelectedAiCandidateId(undefined);
    setAiStrengthPreviewUrl(undefined);
    setAiStrength(100);
  };

  const pushUndoSnapshot = (snapshot: EditParams) => {
    const normalized = normalizeEditParams(snapshot);
    setUndoStack((current) => {
      const last = current[current.length - 1];
      if (last && areEditParamsEqual(last, normalized)) return current;
      return [...current, normalized].slice(-30);
    });
  };

  const beginHistoryGesture = () => {
    if (!assetRef.current || historyGestureRef.current) return;
    historyGestureRef.current = {
      snapshot: normalizeEditParams(editsRef.current),
      pushed: false
    };
  };

  const finishHistoryGesture = () => {
    historyGestureRef.current = undefined;
  };

  const ensureUndoForEdit = (current: EditParams) => {
    if (!assetRef.current) return;
    if (!historyGestureRef.current) {
      historyGestureRef.current = {
        snapshot: normalizeEditParams(current),
        pushed: false
      };
    }
    if (!historyGestureRef.current.pushed) {
      pushUndoSnapshot(historyGestureRef.current.snapshot);
      historyGestureRef.current.pushed = true;
    }
  };

  const applyEditsWithHistory = (
    nextEditsOrUpdater: EditParams | ((current: EditParams) => EditParams),
    nextStatus?: string,
    presetId?: string
  ) => {
    const current = normalizeEditParams(editsRef.current);
    const next = normalizeEditParams(
      typeof nextEditsOrUpdater === "function" ? nextEditsOrUpdater(current) : nextEditsOrUpdater
    );
    if (areEditParamsEqual(current, next)) {
      if (nextStatus) setStatus(nextStatus);
      return;
    }
    historyGestureRef.current = undefined;
    pushUndoSnapshot(current);
    clearAiCandidates();
    setSelectedPresetId(presetId);
    editsRef.current = next;
    setEdits(next);
    if (nextStatus) setStatus(nextStatus);
  };

  const undoLastEdit = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!asset || !previous) return;
    historyGestureRef.current = undefined;
    setUndoStack((current) => current.slice(0, -1));
    clearAiCandidates();
    setSelectedPresetId(undefined);
    const normalized = normalizeEditParams(previous);
    editsRef.current = normalized;
    setEdits(normalized);
    setStatus("已返回上一步");
  };

  const toggleComparePreview = () => {
    if (!asset || !displayPreviewUrl) return;
    setIsCompareActive((current) => {
      if (!current) setComparePosition(50);
      return !current;
    });
  };

  const updateEdit = (key: NumericEditParamKey, value: number, min: number, max: number) => {
    const nextValue = clamp(Number.isFinite(value) ? value : 0, min, max);
    const current = normalizeEditParams(editsRef.current);
    const next = mergeEditParams(current, { [key]: nextValue } as Partial<EditParams>);
    if (areEditParamsEqual(current, next)) return;
    ensureUndoForEdit(current);
    clearAiCandidates();
    setSelectedPresetId(undefined);
    editsRef.current = next;
    setEdits(next);
  };

  const updateHsl = (channel: HslChannel, key: keyof EditParams["hsl"][HslChannel], value: number) => {
    const nextValue = clamp(Number.isFinite(value) ? value : 0, -50, 50);
    const current = normalizeEditParams(editsRef.current);
    const next = mergeEditParams(current, {
      hsl: {
        ...current.hsl,
        [channel]: {
          ...current.hsl[channel],
          [key]: nextValue
        }
      }
    });
    if (areEditParamsEqual(current, next)) return;
    ensureUndoForEdit(current);
    clearAiCandidates();
    setSelectedPresetId(undefined);
    editsRef.current = next;
    setEdits(next);
  };

  const resetEdits = () => {
    applyEditsWithHistory(createDefaultEditParams(), "已重置移动端 JPG 调色参数");
    setPreviewZoom(100);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";

    if (!/^image\/jpe?g$/i.test(file.type) && !/\.(jpe?g)$/i.test(file.name)) {
      setStatus("移动端当前只支持 JPG/JPEG 图片");
      return;
    }

    setIsImporting(true);
    try {
      const imported = await importPhotoFile(file);
      if (imported.sourceFormat !== "jpg") {
        releaseAsset(imported);
        setStatus("移动端当前只支持 JPG/JPEG 图片");
        return;
      }
      releaseAsset(assetRef.current);
      clearAiCandidates();
      historyGestureRef.current = undefined;
      setUndoStack([]);
      setSelectedPresetId(undefined);
      setIsCompareActive(false);
      setComparePosition(50);
      setOriginalCompareUrl(undefined);
      setAsset(imported);
      editsRef.current = imported.edits;
      setEdits(imported.edits);
      setPreviewUrl(imported.previewUrl);
      setPreviewZoom(100);
      setActiveTool("tuning");
      setStatus(`已载入 ${imported.name} · ${formatFileSize(imported.size)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "JPG 导入失败");
    } finally {
      setIsImporting(false);
    }
  };

  const applyPreset = (presetId: string, presetParams: Partial<EditParams>, presetName: string) => {
    applyEditsWithHistory((current) => mergeEditParams(current, presetParams), `已应用预设：${presetName}`, presetId);
  };

  const applyPortraitQuickEdit = (mode: keyof typeof portraitBeautyQuickEdits) => {
    const label = mode === "evenSkin" ? "一键统一肤色" : "一键美颜";
    applyEditsWithHistory((current) => mergeEditParams(current, portraitBeautyQuickEdits[mode]), `${label}已应用，可继续调整强度`);
  };

  const applyLocalAutoEdit = async () => {
    if (!asset) return;
    clearAiCandidates();
    setIsRendering(true);
    try {
      const analysis = await analyzeImage(asset);
      const result = createAutoEdit(asset, analysis);
      applyEditsWithHistory(result.edits, result.summary.join("；"));
      setActiveTool("tuning");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "本地自动校正失败");
    } finally {
      setIsRendering(false);
    }
  };

  const rotateBy = (delta: number) => {
    applyEditsWithHistory((current) => mergeEditParams(current, { rotation: clamp(current.rotation + delta, -180, 180) }));
  };

  const exportJpg = async () => {
    if (!asset) return;
    setIsExporting(true);
    setStatus(`正在导出 JPG 到 ${exportTargetText}`);
    try {
      const dataUrl = await renderImageSourceWithEdits(asset.objectUrl, edits, {
        maxEdge: 4096,
        quality: 0.92,
        orientation: asset.metadata.orientation
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = sanitizeExportName(asset.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setStatus("已生成 JPG 导出文件；Android/iPhone 原生相册保存将在原生适配阶段接入");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "JPG 导出失败");
    } finally {
      setIsExporting(false);
    }
  };

  const finishMobileAiDiagnostic = async (initialSettings: AiSettingsState, requestId: number) => {
    const diagnostic = await diagnoseAiConnection();
    if (requestId !== aiSettingsRequestRef.current) return;

    const diagnosedModels = diagnostic.availableModels.length > 0
      ? diagnostic.availableModels
      : diagnostic.status === "passed"
        ? [diagnostic.model]
        : [];
    const connectionAvailable = diagnostic.hasApiKey && (diagnostic.status === "passed" || diagnosedModels.length > 0);
    if (!connectionAvailable) {
      setAiSettings({ ...initialSettings, availableModels: diagnosedModels });
      setAiConnectionState("unavailable");
      setStatus(`AI 配置检测未通过：${diagnostic.message}`);
      return;
    }

    let settings = initialSettings;
    let selectedModel = diagnostic.model;
    if (diagnosedModels.length > 0 && !diagnosedModels.includes(selectedModel)) {
      selectedModel = diagnosedModels[0];
      settings = await saveAiSettings({ baseUrl: initialSettings.baseUrl, model: selectedModel });
      if (requestId !== aiSettingsRequestRef.current) return;
    }

    setAiSettings({
      ...settings,
      model: selectedModel,
      availableModels: diagnosedModels.length > 0 ? diagnosedModels : [selectedModel]
    });
    setAiModelDraft(selectedModel);
    setAiApiKeyDraft("");
    setAiConnectionState("available");
    setStatus("AI 配置检测完成，连接正常，可以使用");
  };

  const diagnoseSavedMobileAiSettings = async (settings = aiSettings) => {
    if (!isAiRuntimeAvailable() || !settings.hasApiKey || aiConnectionState === "checking") return;
    const requestId = ++aiSettingsRequestRef.current;
    setIsSavingAiSettings(true);
    setAiConnectionState("checking");
    setStatus("正在检测 AI 配置，请稍候");
    try {
      await finishMobileAiDiagnostic(settings, requestId);
    } catch (error) {
      if (requestId !== aiSettingsRequestRef.current) return;
      setAiConnectionState("unavailable");
      setStatus(error instanceof Error ? `AI 配置检测失败：${error.message}` : "AI 配置检测失败，请检查 Key、URL 和网络");
    } finally {
      if (requestId === aiSettingsRequestRef.current) setIsSavingAiSettings(false);
    }
  };

  const confirmMobileAiSettings = async () => {
    if (!isAiRuntimeAvailable()) {
      setStatus("AI 设置需要 Tauri 真机环境或本地开发调试桥");
      return;
    }

    const apiKey = aiApiKeyDraft.trim();
    const baseUrl = aiBaseUrlDraft.trim();
    if (!apiKey && !aiSettings.hasApiKey) {
      setStatus("请先填写 API key");
      return;
    }
    if (!baseUrl) {
      setStatus("请先填写 Base URL");
      return;
    }

    const requestId = ++aiSettingsRequestRef.current;
    setIsSavingAiSettings(true);
    setAiConnectionState("checking");
    setStatus("设置已确认，正在检测 AI 配置，请稍候");
    try {
      const settings = await saveAiSettings({
        apiKey: apiKey || undefined,
        baseUrl,
        model: aiModelDraft
      });
      if (requestId !== aiSettingsRequestRef.current) return;

      setAiBaseUrlDraft(settings.baseUrl);
      setAiModelDraft(settings.model);
      setAiSettings(settings);
      await finishMobileAiDiagnostic(settings, requestId);
    } catch (error) {
      if (requestId !== aiSettingsRequestRef.current) return;
      setAiConnectionState("unavailable");
      setStatus(error instanceof Error ? `AI 配置检测失败：${error.message}` : "AI 配置检测失败，请检查 Key、URL 和网络");
    } finally {
      if (requestId === aiSettingsRequestRef.current) setIsSavingAiSettings(false);
    }
  };

  const updateMobileAiApiKeyDraft = (value: string) => {
    aiSettingsRequestRef.current += 1;
    setIsSavingAiSettings(false);
    setAiConnectionState("idle");
    setAiApiKeyDraft(value);
  };

  const updateMobileAiBaseUrlDraft = (value: string) => {
    aiSettingsRequestRef.current += 1;
    setIsSavingAiSettings(false);
    setAiConnectionState("idle");
    setAiBaseUrlDraft(value);
  };

  const updateMobileAiModel = async (model: string) => {
    if (!model || model === aiSettings.model || !isAiRuntimeAvailable()) return;
    const previousModel = aiSettings.model;
    const requestId = ++aiSettingsRequestRef.current;
    setAiModelDraft(model);
    setIsSavingAiSettings(true);
    try {
      const settings = await saveAiSettings({ baseUrl: aiSettings.baseUrl, model });
      if (requestId !== aiSettingsRequestRef.current) return;
      setAiSettings({ ...settings, availableModels: aiSettings.availableModels });
      setAiModelDraft(settings.model);
      setStatus(`已切换 AI 模型：${settings.model}`);
    } catch (error) {
      if (requestId !== aiSettingsRequestRef.current) return;
      setAiModelDraft(previousModel);
      setStatus(error instanceof Error ? error.message : "AI 模型保存失败");
    } finally {
      if (requestId === aiSettingsRequestRef.current) setIsSavingAiSettings(false);
    }
  };

  const clearMobileAiSettings = async () => {
    if (!isAiRuntimeAvailable()) {
      setStatus("AI 设置需要 Tauri 真机环境或本地开发调试桥");
      return;
    }
    aiSettingsRequestRef.current += 1;
    setIsClearingAiSettings(true);
    try {
      const settings = await clearAiSettings();
      setAiSettings(settings);
      setAiApiKeyDraft("");
      setAiBaseUrlDraft(settings.baseUrl);
      setAiModelDraft(settings.model);
      setAiConnectionState("idle");
      setStatus("AI 配置文件已清空");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI 配置清空失败");
    } finally {
      setIsClearingAiSettings(false);
    }
  };

  useEffect(() => {
    if (
      aiPanelVisitToken === 0 ||
      !isAiSettingsHydrated ||
      !aiSettings.hasApiKey ||
      isClearingAiSettings ||
      isAiConfigurationAvailable ||
      aiConnectionState === "checking"
    ) return;
    void diagnoseSavedMobileAiSettings(aiSettings);
  }, [aiPanelVisitToken, isAiSettingsHydrated, aiSettings.hasApiKey]);

  const selectMobileTool = (tool: MobileTool) => {
    setActiveTool(tool);
    if (tool === "ai") setAiPanelVisitToken((current) => current + 1);
  };

  const runMobileAiTuning = async () => {
    if (!asset) {
      setStatus("请先选择 JPG 图片");
      return;
    }
    clearAiCandidates();
    setIsAiRunning(true);
    setStatus("AI 正在生成 3 套调色方案，期间不会阻塞手动操作");
    try {
      const baseline = normalizeEditParams(edits);
      aiBaselineRef.current = baseline;
      const analysis = await analyzeImage(asset);
      const enhancedInstruction = enhanceAiInstruction(aiInstruction, analysis);
      const localResult = createLocalAiResult(asset, analysis, aiInstruction);
      let result: AiTuningResult = localResult;
      let fallbackReason = "";

      if (isAiRuntimeAvailable() && aiSettings.hasApiKey) {
        try {
          const imageDataUrl = await renderImageSourceWithEdits(asset.objectUrl, createDefaultEditParams(), {
            maxEdge: 1280,
            quality: 0.82,
            orientation: asset.metadata.orientation
          });
          const remoteResult = await tunePhotoWithAi({
            mode: "autoColor",
            assetName: asset.name,
            cameraSummary: [
              getCameraSummary(asset, analysis),
              "用户原始指令是审美决策的最高优先级；画面分析只用于避免高光剪切、噪点放大和色彩断层。"
            ].join("\n"),
            imageDataUrl,
            userInstruction: enhancedInstruction,
            currentParams: baseline
          });
          result = {
            model: remoteResult.model,
            summary: remoteResult.summary,
            params: normalizeAiResultParams(baseline, remoteResult)
          };
        } catch (error) {
          fallbackReason = error instanceof Error ? error.message : "远端 AI 请求失败";
          result = {
            ...localResult,
            summary: `${localResult.summary} 远端 AI 暂不可用，已使用本地色彩科学候选。`
          };
        }
      } else {
        fallbackReason = isAiRuntimeAvailable() ? "AI key 尚未保存" : "当前没有可用的 AI 运行时";
      }

      const primary = normalizeAiResultParams(baseline, result);
      const variants = createAiVariants(baseline, primary, result.summary);
      const createdAt = Date.now();
      const candidates: MobileAiCandidate[] = [];
      for (const variant of variants) {
        const preview = await renderImageSourceWithEdits(asset.objectUrl, variant.params, {
          maxEdge: MOBILE_PREVIEW_MAX_EDGE,
          quality: MOBILE_PREVIEW_QUALITY,
          orientation: asset.metadata.orientation
        });
        candidates.push({
          id: `${asset.id}-${createdAt}-${variant.idSuffix}`,
          label: variant.label,
          summary: variant.summary,
          model: result.model,
          params: variant.params,
          previewUrl: preview
        });
      }
      setAiCandidates(candidates);
      setSelectedAiCandidateId(candidates[0]?.id);
      setAiStrength(100);
      setStatus(fallbackReason ? `已生成 3 套本地 AI 方案：${fallbackReason}` : "AI 调色已生成 3 套方案，请预览后应用");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI 调色失败，核心编辑功能不受影响");
    } finally {
      setIsAiRunning(false);
    }
  };

  const applyAiCandidate = () => {
    if (!selectedAiCandidate) return;
    const baseline = aiBaselineRef.current ?? edits;
    const applied = blendAiEditParams(baseline, selectedAiCandidate.params, aiStrength);
    applyEditsWithHistory(applied, `已应用 ${selectedAiCandidate.label}，强度 ${aiStrength}%`);
    setActiveTool("tuning");
  };

  const renderControl = (control: MobileEditControl) => (
    <label className="mobile-control" key={control.key}>
      <span>{control.label}</span>
      <input
        type="range"
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        value={edits[control.key]}
        disabled={!asset}
        onPointerDown={beginHistoryGesture}
        onPointerUp={finishHistoryGesture}
        onPointerCancel={finishHistoryGesture}
        onBlur={finishHistoryGesture}
        onChange={(event) => updateEdit(control.key, Number(event.target.value), control.min, control.max)}
      />
      <input
        type="number"
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        value={Math.round(edits[control.key])}
        disabled={!asset}
        onFocus={beginHistoryGesture}
        onBlur={finishHistoryGesture}
        onChange={(event) => updateEdit(control.key, Number(event.target.value), control.min, control.max)}
      />
    </label>
  );

  const renderAiPanel = () => (
    <div className="mobile-ai-stack">
      <div className="mobile-ai-settings">
        {isAiConfigurationAvailable ? (
          <label>
            <span>Model</span>
            <select value={aiModelDraft} onChange={(event) => void updateMobileAiModel(event.target.value)} disabled={isSavingAiSettings || isClearingAiSettings}>
              {aiSettings.availableModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              <span>API key</span>
              <input
                type="password"
                value={aiApiKeyDraft}
                onChange={(event) => updateMobileAiApiKeyDraft(event.target.value)}
                placeholder={aiSettings.hasApiKey ? "已保存，重新填写可替换" : "请输入 API key"}
                autoComplete="off"
                disabled={isSavingAiSettings || isClearingAiSettings}
              />
            </label>
            <label>
              <span>Base URL</span>
              <input
                value={aiBaseUrlDraft}
                onChange={(event) => updateMobileAiBaseUrlDraft(event.target.value)}
                placeholder="https://api.openai.com/v1"
                inputMode="url"
                disabled={isSavingAiSettings || isClearingAiSettings}
              />
            </label>
          </>
        )}
        {aiConnectionState === "checking" && (
          <div className="mobile-ai-checking" role="status" aria-live="polite">
            <Loader2 className="spin" size={20} />
            <span>
              <strong>正在检测 AI 配置</strong>
              <small>正在验证连接并获取可用模型，请稍候</small>
            </span>
          </div>
        )}
        <div className="mobile-ai-actions">
          {!isAiConfigurationAvailable && (
            <button
              type="button"
              onClick={confirmMobileAiSettings}
              disabled={!isAiRuntimeAvailable() || isSavingAiSettings || isClearingAiSettings}
            >
              {aiConnectionState === "checking" ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
              {aiConnectionState === "checking" ? "正在检测" : "确认设置"}
            </button>
          )}
          {(isAiConfigurationAvailable || aiSettings.hasApiKey) && (
            <button type="button" className="mobile-ai-clear" onClick={clearMobileAiSettings} disabled={isClearingAiSettings || isSavingAiSettings}>
              {isClearingAiSettings ? <Loader2 className="spin" size={18} /> : <Trash2 size={18} />}
              清空配置
            </button>
          )}
        </div>
      </div>

      <label className="mobile-ai-prompt">
        <span>调色想法</span>
        <textarea value={aiInstruction} onChange={(event) => setAiInstruction(event.target.value)} placeholder="例如：更通透、肤色自然、压住高光、远景更清晰" />
      </label>

      <div className="mobile-ai-actions">
        <button type="button" onClick={runMobileAiTuning} disabled={!asset || isAiRunning}>
          {isAiRunning ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          AI 调色三方案
        </button>
        <button type="button" onClick={applyLocalAutoEdit} disabled={!asset || isRendering}>
          本地自动校正
        </button>
      </div>

      {aiCandidates.length > 0 && (
        <div className="mobile-ai-candidates">
          {aiCandidates.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              className={candidate.id === selectedAiCandidate?.id ? "active" : undefined}
              onClick={() => setSelectedAiCandidateId(candidate.id)}
            >
              <img src={candidate.previewUrl} alt={candidate.label} />
              <strong>{candidate.label}</strong>
              <span>{candidate.model}</span>
            </button>
          ))}
        </div>
      )}

      {selectedAiCandidate && (
        <div className="mobile-ai-apply">
          <p>{selectedAiCandidate.summary}</p>
          <label className="mobile-control">
            <span>强度</span>
            <input type="range" min={0} max={150} value={aiStrength} onChange={(event) => setAiStrength(Number(event.target.value))} />
            <input type="number" min={0} max={150} value={aiStrength} onChange={(event) => setAiStrength(clamp(Number(event.target.value), 0, 150))} />
          </label>
          <button type="button" onClick={applyAiCandidate}>
            应用当前方案
          </button>
        </div>
      )}
    </div>
  );

  const renderToolPanel = () => {
    if (!asset && activeTool !== "ai") {
      return null;
    }

    if (activeTool === "ai") return renderAiPanel();

    if (activeTool === "presets") {
      return (
        <div className="mobile-preset-grid">
          {builtInPresets.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={selectedPresetId === preset.id ? "active" : undefined}
              aria-pressed={selectedPresetId === preset.id}
              onClick={() => applyPreset(preset.id, preset.params, preset.name)}
            >
              {selectedPresetId === preset.id && (
                <span className="mobile-preset-selected">
                  <Check size={13} />
                  当前
                </span>
              )}
              <strong>{preset.name}</strong>
              <span>{preset.series ?? "预设"}</span>
            </button>
          ))}
        </div>
      );
    }

    if (activeTool === "hsl") {
      return (
        <div className="mobile-hsl-list">
          {hslChannels.map((channel) => {
            const values = edits.hsl[channel];
            return (
              <section className="mobile-hsl-card" key={channel}>
                <strong>{hslChannelLabels[channel]}</strong>
                {(["hue", "saturation", "luminance"] as const).map((key) => (
                  <label className="mobile-control" key={key}>
                    <span>{key === "hue" ? "色相" : key === "saturation" ? "饱和度" : "明度"}</span>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      value={values[key]}
                      onPointerDown={beginHistoryGesture}
                      onPointerUp={finishHistoryGesture}
                      onPointerCancel={finishHistoryGesture}
                      onBlur={finishHistoryGesture}
                      onChange={(event) => updateHsl(channel, key, Number(event.target.value))}
                    />
                    <input
                      type="number"
                      min={-50}
                      max={50}
                      value={Math.round(values[key])}
                      onFocus={beginHistoryGesture}
                      onBlur={finishHistoryGesture}
                      onChange={(event) => updateHsl(channel, key, Number(event.target.value))}
                    />
                  </label>
                ))}
              </section>
            );
          })}
        </div>
      );
    }

    if (activeTool === "crop") {
      return (
        <div className="mobile-control-list">
          <div className="mobile-segment-row">
            {cropAspectValues.map((aspect) => (
              <button
                type="button"
                key={aspect}
                className={edits.cropAspect === aspect ? "active" : undefined}
                onClick={() => {
                  applyEditsWithHistory((current) => mergeEditParams(current, { cropAspect: aspect }));
                }}
              >
                {cropAspectLabels[aspect]}
              </button>
            ))}
          </div>
          <div className="mobile-rotate-row">
            <button type="button" onClick={() => rotateBy(-90)}>
              <RotateCcw size={18} />
              左转 90°
            </button>
            <button type="button" onClick={() => rotateBy(90)}>
              <RotateCw size={18} />
              右转 90°
            </button>
            <button
              type="button"
              onClick={() => {
                applyEditsWithHistory((current) =>
                  mergeEditParams(current, { rotation: 0, cropAspect: "free", cropX: 0, cropY: 0, cropWidth: 100, cropHeight: 100 })
                );
              }}
            >
              重置几何
            </button>
          </div>
          {[
            { key: "rotation", label: "旋转", min: -180, max: 180 },
            { key: "cropX", label: "裁切 X", min: 0, max: 95 },
            { key: "cropY", label: "裁切 Y", min: 0, max: 95 },
            { key: "cropWidth", label: "裁切宽", min: 5, max: 100 },
            { key: "cropHeight", label: "裁切高", min: 5, max: 100 }
          ].map((control) => renderControl(control as MobileEditControl))}
        </div>
      );
    }

    if (activeTool === "beauty") {
      return (
        <div className="mobile-control-list">
          <div className="mobile-beauty-actions">
            <button type="button" onClick={() => applyPortraitQuickEdit("evenSkin")}>
              <Palette size={17} />
              统一肤色
            </button>
            <button type="button" onClick={() => applyPortraitQuickEdit("naturalBeauty")}>
              <Sparkles size={17} />
              一键美颜
            </button>
          </div>
          {beautyControls.map((control) => renderControl(control))}
        </div>
      );
    }

    if (activeTool === "enhance") {
      return <div className="mobile-control-list">{enhanceControls.map((control) => renderControl(control))}</div>;
    }

    return <div className="mobile-control-list">{basicControls.map((control) => renderControl(control))}</div>;
  };

  return (
    <main className="mobile-shell">
      <header className="mobile-topbar">
        <div className="mobile-title-block">
          <strong>AutoPhoto</strong>
          <span>{asset ? `${asset.name} · ${formatFileSize(asset.size)}` : "未选择照片"}</span>
        </div>
        <div className="mobile-topbar-actions">
          <button type="button" className="mobile-icon-button" title="返回上一步" disabled={!asset || undoStack.length === 0} onClick={undoLastEdit}>
            <Undo2 size={20} />
          </button>
          <button type="button" className="mobile-icon-button" title={`导出到 ${exportTargetText}`} disabled={!asset || isExporting} onClick={exportJpg}>
            {isExporting ? <Loader2 className="spin" size={20} /> : <Download size={20} />}
          </button>
        </div>
      </header>

      <section className="mobile-preview-stage" aria-label="照片预览">
        {asset && displayPreviewUrl ? (
          <>
            {isCompareActive && canComparePreview ? (
              <div className="mobile-compare-frame" style={{ transform: `scale(${previewZoom / 100})` }}>
                <img src={originalCompareUrl} alt={`${asset.name} 原图`} />
                <div className="mobile-compare-edited" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}>
                  <img src={displayPreviewUrl} alt={`${asset.name} 效果`} />
                </div>
                <div className="mobile-compare-divider" style={{ left: `${comparePosition}%` }}>
                  <span />
                </div>
                <span className="mobile-compare-label mobile-compare-label-edited">效果</span>
                <span className="mobile-compare-label mobile-compare-label-original">原图</span>
                <input
                  className="mobile-compare-range"
                  type="range"
                  min={0}
                  max={100}
                  value={comparePosition}
                  aria-label="前后对比分割线"
                  onChange={(event) => setComparePosition(Number(event.target.value))}
                />
              </div>
            ) : (
              <img className="mobile-preview-image" src={displayPreviewUrl} alt={asset.name} style={{ transform: `scale(${previewZoom / 100})` }} />
            )}
            {(isRendering || isImporting || isAiRunning || isPreparingCompare) && (
              <span className="mobile-render-badge">
                <Loader2 className="spin" size={15} />
                {isAiRunning ? "AI 调色中" : isImporting ? "导入中" : isPreparingCompare ? "准备原图比较" : "渲染中"}
              </span>
            )}
            <div className="mobile-zoom-controls" aria-label="预览缩放">
              <button type="button" onClick={() => setPreviewZoom((value) => clamp(value - 25, 50, 300))}>
                <ZoomOut size={16} />
              </button>
              <span>{previewZoom}%</span>
              <button type="button" onClick={() => setPreviewZoom((value) => clamp(value + 25, 50, 300))}>
                <ZoomIn size={16} />
              </button>
              <button type="button" onClick={() => setPreviewZoom(100)}>
                <Minus size={16} />
              </button>
              <button
                type="button"
                className={isCompareActive ? "active" : undefined}
                title="前后对比"
                disabled={!asset}
                onClick={toggleComparePreview}
              >
                {isCompareActive ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="mobile-import-empty" onClick={() => inputRef.current?.click()} disabled={isImporting}>
            {isImporting ? <Loader2 className="spin" size={36} /> : <ImagePlus size={36} />}
            <strong>{capabilities.photoHint}</strong>
            <span>Android 和 iPhone 版本隐藏 RAW，仅处理 JPG/JPEG。</span>
          </button>
        )}
        <input ref={inputRef} type="file" accept={capabilities.photoAccept} onChange={handleFileChange} hidden />
      </section>

      <nav className="mobile-toolbar" aria-label="移动端工具栏">
        {mobileTools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button type="button" key={tool.id} className={activeTool === tool.id ? "active" : undefined} onClick={() => selectMobileTool(tool.id)} disabled={!asset && tool.id !== "ai"}>
              <Icon size={19} />
              <span>{tool.label}</span>
            </button>
          );
        })}
      </nav>

      <section className="mobile-bottom-sheet" aria-live="polite">
        <div className="mobile-sheet-head">
          <p>{status}</p>
          <div>
            <button type="button" onClick={resetEdits} disabled={!asset}>
              重置
            </button>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={isImporting}>
              {isImporting ? <Loader2 className="spin" size={18} /> : <ImagePlus size={18} />}
              选择 JPG
            </button>
          </div>
        </div>
        {renderToolPanel()}
      </section>
    </main>
  );
}
