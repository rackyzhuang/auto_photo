import type { EditParams, HslAdjustment, HslChannel, Preset } from "../types";

export const hslChannels: HslChannel[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "purple",
  "magenta"
];

const neutralHsl = (): HslAdjustment => ({
  hue: 0,
  saturation: 0,
  luminance: 0
});

export const createDefaultEditParams = (): EditParams => ({
  schemaVersion: 1,
  rotation: 0,
  cropAspect: "free",
  cropX: 0,
  cropY: 0,
  cropWidth: 100,
  cropHeight: 100,
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
  skinProtection: 65,
  skinSmoothing: 0,
  skinTone: 0,
  teethWhitening: 0,
  clothingWrinkleReduction: 0,
  hsl: Object.fromEntries(hslChannels.map((channel) => [channel, neutralHsl()])) as EditParams["hsl"]
});

export const normalizeEditParams = (params?: Partial<EditParams>): EditParams => {
  const defaults = createDefaultEditParams();
  const inputHsl: Partial<Record<HslChannel, Partial<HslAdjustment>>> = params?.hsl ?? {};
  return {
    ...defaults,
    ...(params ?? {}),
    hsl: Object.fromEntries(
      hslChannels.map((channel) => [
        channel,
        {
          ...defaults.hsl[channel],
          ...(inputHsl[channel] ?? {})
        }
      ])
    ) as EditParams["hsl"],
    schemaVersion: 1
  };
};

export const mergeEditParams = (base: EditParams, patch: Partial<EditParams>): EditParams => {
  const normalizedBase = normalizeEditParams(base);
  return normalizeEditParams({
    ...normalizedBase,
    ...patch,
    hsl: {
      ...normalizedBase.hsl,
      ...(patch.hsl ?? {})
    }
  });
};

export const builtInPresets: Preset[] = [
  {
    id: "portrait-natural",
    series: "人像",
    name: "自然人像",
    description: "轻微提亮肤色，保留自然对比。",
    params: { exposure: 6, contrast: 4, highlights: -10, shadows: 12, vibrance: 8, skinProtection: 82 }
  },
  {
    id: "portrait-cream-skin",
    series: "人像",
    name: "奶油肤色",
    description: "柔和肤色并降低纹理，适合近景人像。",
    params: {
      exposure: 8,
      temperature: 4,
      contrast: -8,
      highlights: -16,
      shadows: 14,
      vibrance: 8,
      clarity: -8,
      texture: -12,
      skinProtection: 90,
      hsl: {
        ...createDefaultEditParams().hsl,
        orange: { hue: -3, saturation: -4, luminance: 8 },
        red: { hue: 2, saturation: -6, luminance: 4 }
      }
    }
  },
  {
    id: "wedding-clear",
    series: "人像",
    name: "婚礼清透",
    description: "明亮、干净、低压迫感。",
    params: {
      exposure: 10,
      temperature: -3,
      contrast: -4,
      highlights: -18,
      shadows: 18,
      whites: 8,
      vibrance: 10,
      clarity: -4,
      texture: -6,
      skinProtection: 86
    }
  },
  {
    id: "portrait-studio-clean",
    series: "人像",
    name: "棚拍干净",
    description: "中性白、清晰轮廓和干净肤色。",
    params: {
      exposure: 4,
      temperature: -2,
      tint: 2,
      contrast: 8,
      highlights: -8,
      shadows: 6,
      whites: 8,
      blacks: -6,
      clarity: 6,
      texture: -4,
      sharpness: 12,
      skinProtection: 86
    }
  },
  {
    id: "portrait-low-sat-film",
    series: "人像",
    name: "低饱和胶片人像",
    description: "低饱和与轻颗粒，保留柔和肤色。",
    params: {
      exposure: 3,
      temperature: 5,
      contrast: -6,
      highlights: -12,
      shadows: 10,
      saturation: -10,
      vibrance: 4,
      grain: 12,
      texture: -6,
      skinProtection: 88
    }
  },
  {
    id: "landscape-blue-sky",
    series: "风光",
    name: "蓝天通透",
    description: "提升蓝天和远景通透度。",
    params: {
      exposure: 2,
      contrast: 10,
      highlights: -18,
      shadows: 10,
      whites: 10,
      blacks: -8,
      vibrance: 18,
      clarity: 12,
      dehaze: 14,
      sharpness: 14,
      hsl: {
        ...createDefaultEditParams().hsl,
        blue: { hue: -4, saturation: 14, luminance: -4 },
        aqua: { hue: -3, saturation: 8, luminance: 2 }
      }
    }
  },
  {
    id: "landscape-sunset-warm",
    series: "风光",
    name: "日落暖调",
    description: "加强金色高光和晚霞氛围。",
    params: {
      exposure: 2,
      temperature: 12,
      tint: 2,
      contrast: 10,
      highlights: -22,
      shadows: 10,
      vibrance: 16,
      dehaze: 6,
      hsl: {
        ...createDefaultEditParams().hsl,
        orange: { hue: -5, saturation: 12, luminance: 4 },
        yellow: { hue: -8, saturation: 8, luminance: 2 }
      }
    }
  },
  {
    id: "landscape-forest-green",
    series: "风光",
    name: "森林绿调",
    description: "压住杂色，让绿色更沉稳。",
    params: {
      exposure: -2,
      temperature: -3,
      contrast: 12,
      highlights: -16,
      shadows: 12,
      blacks: -10,
      vibrance: 10,
      clarity: 10,
      hsl: {
        ...createDefaultEditParams().hsl,
        green: { hue: -8, saturation: -6, luminance: -4 },
        yellow: { hue: -12, saturation: -8, luminance: -2 }
      }
    }
  },
  {
    id: "landscape-snow-cool",
    series: "风光",
    name: "雪景冷净",
    description: "冷净白场，保留雪地层次。",
    params: { exposure: 5, temperature: -12, tint: 2, contrast: 6, highlights: -24, shadows: 12, whites: 12, saturation: -4, clarity: 8, dehaze: 6 }
  },
  {
    id: "landscape-mountain-contrast",
    series: "风光",
    name: "山野高对比",
    description: "加强岩石、云层和远山结构。",
    params: { exposure: -1, contrast: 18, highlights: -20, shadows: 8, blacks: -14, vibrance: 12, clarity: 16, texture: 10, dehaze: 12, sharpness: 16 }
  },
  {
    id: "architecture-interior",
    series: "建筑",
    name: "室内建筑",
    description: "控制高光，保留空间明暗层次。",
    params: { exposure: 3, temperature: -3, contrast: 6, highlights: -28, shadows: 20, whites: 6, blacks: -8, clarity: 10, sharpness: 12 }
  },
  {
    id: "architecture-white-wall",
    series: "建筑",
    name: "中性白墙",
    description: "降低偏色，适合白墙和展厅。",
    params: { exposure: 4, temperature: -5, tint: 0, contrast: 2, highlights: -18, shadows: 12, saturation: -8, vibrance: 2, clarity: 6, skinProtection: 60 }
  },
  {
    id: "architecture-commercial",
    series: "建筑",
    name: "商业空间",
    description: "干净锐利，适合空间与产品陈列。",
    params: { exposure: 4, contrast: 10, highlights: -18, shadows: 10, whites: 8, blacks: -8, saturation: -4, clarity: 12, texture: 8, sharpness: 18 }
  },
  {
    id: "architecture-cool-modern",
    series: "建筑",
    name: "冷调建筑",
    description: "冷静线条与现代感。",
    params: { exposure: 1, temperature: -10, contrast: 14, highlights: -16, shadows: 8, saturation: -10, clarity: 14, dehaze: 5, sharpness: 16 }
  },
  {
    id: "architecture-warm-hotel",
    series: "建筑",
    name: "暖光酒店",
    description: "保留灯光温度，压住高光。",
    params: { exposure: 2, temperature: 8, tint: 2, contrast: 4, highlights: -28, shadows: 16, saturation: -2, vibrance: 6, clarity: 6 }
  },
  {
    id: "city-street-documentary",
    series: "城市",
    name: "街拍纪实",
    description: "自然对比和轻微颗粒。",
    params: { exposure: 0, contrast: 12, highlights: -16, shadows: 8, blacks: -10, saturation: -6, vibrance: 8, clarity: 10, grain: 10 }
  },
  {
    id: "city-night-neon",
    series: "城市",
    name: "夜景霓虹",
    description: "保留霓虹色彩，压住过亮招牌。",
    params: { exposure: -4, temperature: -4, tint: 4, contrast: 12, highlights: -32, shadows: 18, blacks: -12, vibrance: 20, clarity: 8, dehaze: 8 }
  },
  {
    id: "city-rain",
    series: "城市",
    name: "雨天城市",
    description: "蓝灰氛围和低饱和街景。",
    params: { exposure: -2, temperature: -8, contrast: 6, highlights: -20, shadows: 12, saturation: -14, vibrance: 4, clarity: 6, dehaze: 4 }
  },
  {
    id: "city-cool-urban",
    series: "城市",
    name: "都市冷调",
    description: "冷色阴影与清晰建筑边缘。",
    params: { exposure: 0, temperature: -12, contrast: 14, highlights: -18, shadows: 10, saturation: -8, clarity: 12, sharpness: 14 }
  },
  {
    id: "city-black-gold",
    series: "城市",
    name: "高反差黑金",
    description: "压暗阴影，突出暖色灯光。",
    params: { exposure: -5, temperature: 6, contrast: 22, highlights: -24, shadows: -8, blacks: -24, saturation: -6, vibrance: 12, clarity: 14, vignette: 10 }
  },
  {
    id: "creative-cinematic-dark",
    series: "个性",
    name: "电影暗调",
    description: "压低曝光，保留高光情绪。",
    params: { exposure: -8, temperature: -3, contrast: 16, highlights: -20, shadows: -8, blacks: -18, saturation: -8, vibrance: 8, clarity: 8, vignette: 16, grain: 8 }
  },
  {
    id: "creative-japanese-soft",
    series: "个性",
    name: "日系柔和",
    description: "低对比、浅阴影和柔和色彩。",
    params: { exposure: 8, temperature: 6, contrast: -14, highlights: -12, shadows: 20, saturation: -6, vibrance: 12, clarity: -8, grain: 8 }
  },
  {
    id: "creative-vintage-grain",
    series: "个性",
    name: "复古颗粒",
    description: "暖色偏移和明显胶片颗粒。",
    params: {
      exposure: 2,
      temperature: 10,
      tint: 4,
      contrast: -2,
      highlights: -14,
      shadows: 8,
      saturation: -8,
      grain: 22,
      vignette: 10,
      hsl: {
        ...createDefaultEditParams().hsl,
        yellow: { hue: -8, saturation: -6, luminance: 2 },
        blue: { hue: -8, saturation: -18, luminance: -4 }
      }
    }
  },
  {
    id: "creative-high-color",
    series: "个性",
    name: "高饱和色彩",
    description: "强化颜色和活跃对比。",
    params: {
      exposure: 2,
      contrast: 14,
      highlights: -12,
      shadows: 8,
      saturation: 12,
      vibrance: 24,
      clarity: 8,
      dehaze: 6,
      hsl: {
        ...createDefaultEditParams().hsl,
        red: { hue: -2, saturation: 10, luminance: 0 },
        green: { hue: -4, saturation: 12, luminance: -2 },
        blue: { hue: -4, saturation: 14, luminance: -4 }
      }
    }
  },
  {
    id: "creative-bw-documentary",
    series: "个性",
    name: "黑白纪实",
    description: "去除色彩，强化明暗结构。",
    params: { contrast: 18, highlights: -14, shadows: 10, whites: 8, blacks: -18, saturation: -50, vibrance: -50, clarity: 14, texture: 8, grain: 14 }
  }
];
