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
  transparency: 0,
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
      transparency: 18,
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
      transparency: 36,
      clarity: 12,
      dehaze: 20,
      sharpness: 14,
      hsl: {
        ...createDefaultEditParams().hsl,
        blue: { hue: -4, saturation: 14, luminance: -4 },
        aqua: { hue: -3, saturation: 8, luminance: 2 }
      }
    }
  },
  {
    id: "landscape-air-clear",
    series: "风光",
    name: "空气通透",
    description: "去灰提层次，让远景和天空更干净。",
    params: {
      exposure: 4,
      contrast: 12,
      highlights: -24,
      shadows: 18,
      whites: 14,
      blacks: -12,
      vibrance: 16,
      transparency: 44,
      clarity: 14,
      texture: 8,
      dehaze: 24,
      sharpness: 16
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
    params: { exposure: 5, temperature: -12, tint: 2, contrast: 6, highlights: -24, shadows: 12, whites: 12, saturation: -4, transparency: 20, clarity: 8, dehaze: 6 }
  },
  {
    id: "landscape-mountain-contrast",
    series: "风光",
    name: "山野高对比",
    description: "加强岩石、云层和远山结构。",
    params: { exposure: -1, contrast: 18, highlights: -20, shadows: 8, blacks: -14, vibrance: 12, transparency: 30, clarity: 16, texture: 10, dehaze: 16, sharpness: 16 }
  },
  {
    id: "architecture-interior",
    series: "建筑",
    name: "室内建筑",
    description: "控制高光，保留空间明暗层次。",
    params: { exposure: 3, temperature: -3, contrast: 6, highlights: -28, shadows: 20, whites: 6, blacks: -8, transparency: 22, clarity: 10, dehaze: 6, sharpness: 12 }
  },
  {
    id: "architecture-airy-space",
    series: "建筑",
    name: "空间通透",
    description: "白场干净、暗部有层次，适合室内和展厅。",
    params: {
      exposure: 5,
      temperature: -4,
      contrast: 8,
      highlights: -30,
      shadows: 22,
      whites: 12,
      blacks: -10,
      saturation: -4,
      vibrance: 8,
      transparency: 32,
      clarity: 12,
      texture: 6,
      dehaze: 10,
      sharpness: 14
    }
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
    params: { exposure: 4, contrast: 10, highlights: -18, shadows: 10, whites: 8, blacks: -8, saturation: -4, transparency: 24, clarity: 12, texture: 8, sharpness: 18 }
  },
  {
    id: "architecture-cool-modern",
    series: "建筑",
    name: "冷调建筑",
    description: "冷静线条与现代感。",
    params: { exposure: 1, temperature: -10, contrast: 14, highlights: -16, shadows: 8, saturation: -10, transparency: 28, clarity: 14, dehaze: 10, sharpness: 16 }
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
    params: { exposure: -4, temperature: -4, tint: 4, contrast: 12, highlights: -32, shadows: 18, blacks: -12, vibrance: 20, transparency: 24, clarity: 8, dehaze: 12 }
  },
  {
    id: "city-clean-air",
    series: "城市",
    name: "城市通透",
    description: "压住灰雾和杂光，让街景更清晰利落。",
    params: {
      exposure: 2,
      temperature: -4,
      contrast: 16,
      highlights: -24,
      shadows: 14,
      whites: 10,
      blacks: -14,
      saturation: -2,
      vibrance: 14,
      transparency: 38,
      clarity: 14,
      texture: 8,
      dehaze: 20,
      sharpness: 16
    }
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
    id: "creative-teal-orange",
    series: "个性",
    name: "青橙电影",
    description: "青色阴影与暖色高光，适合电影感街拍。",
    params: {
      exposure: -2,
      temperature: 4,
      tint: -2,
      contrast: 18,
      highlights: -22,
      shadows: 8,
      blacks: -18,
      saturation: -4,
      vibrance: 18,
      clarity: 10,
      dehaze: 8,
      vignette: 12,
      grain: 8,
      hsl: {
        ...createDefaultEditParams().hsl,
        orange: { hue: -4, saturation: 10, luminance: 4 },
        yellow: { hue: -18, saturation: -10, luminance: -2 },
        aqua: { hue: -12, saturation: 14, luminance: -4 },
        blue: { hue: -10, saturation: 18, luminance: -8 }
      }
    }
  },
  {
    id: "creative-cyber-neon",
    series: "个性",
    name: "赛博霓虹",
    description: "高对比霓虹色，适合夜景和灯牌。",
    params: {
      exposure: -6,
      temperature: -8,
      tint: 8,
      contrast: 24,
      highlights: -30,
      shadows: 18,
      blacks: -24,
      saturation: 8,
      vibrance: 28,
      clarity: 12,
      dehaze: 10,
      vignette: 16,
      hsl: {
        ...createDefaultEditParams().hsl,
        red: { hue: -8, saturation: 16, luminance: -2 },
        magenta: { hue: 8, saturation: 24, luminance: 2 },
        purple: { hue: 10, saturation: 18, luminance: -4 },
        blue: { hue: -12, saturation: 20, luminance: -8 }
      }
    }
  },
  {
    id: "creative-faded-film",
    series: "个性",
    name: "褪色胶片",
    description: "低黑位、柔对比和淡彩旧照片氛围。",
    params: {
      exposure: 4,
      temperature: 8,
      tint: 3,
      contrast: -16,
      highlights: -18,
      shadows: 22,
      whites: -4,
      blacks: 16,
      saturation: -16,
      vibrance: 6,
      clarity: -8,
      grain: 24,
      vignette: 8,
      hsl: {
        ...createDefaultEditParams().hsl,
        yellow: { hue: -10, saturation: -14, luminance: 4 },
        green: { hue: -18, saturation: -22, luminance: 2 },
        blue: { hue: -16, saturation: -26, luminance: 6 }
      }
    }
  },
  {
    id: "creative-hk-flash",
    series: "个性",
    name: "港风闪光",
    description: "硬朗闪光质感，高反差与浓郁红橙。",
    params: {
      exposure: 3,
      temperature: 6,
      tint: 5,
      contrast: 22,
      highlights: -10,
      shadows: -6,
      whites: 10,
      blacks: -22,
      saturation: 4,
      vibrance: 18,
      clarity: 16,
      texture: 8,
      sharpness: 18,
      grain: 10,
      hsl: {
        ...createDefaultEditParams().hsl,
        red: { hue: -4, saturation: 14, luminance: 2 },
        orange: { hue: -6, saturation: 10, luminance: 6 },
        green: { hue: -16, saturation: -12, luminance: -4 }
      }
    }
  },
  {
    id: "creative-cold-blue-gray",
    series: "个性",
    name: "冷蓝灰调",
    description: "低饱和蓝灰阴影，适合冷静情绪片。",
    params: {
      exposure: -3,
      temperature: -16,
      tint: -2,
      contrast: 10,
      highlights: -20,
      shadows: 14,
      blacks: -10,
      saturation: -22,
      vibrance: 6,
      clarity: 8,
      dehaze: 5,
      vignette: 10,
      hsl: {
        ...createDefaultEditParams().hsl,
        aqua: { hue: -8, saturation: 8, luminance: -2 },
        blue: { hue: -6, saturation: 10, luminance: -6 },
        orange: { hue: 4, saturation: -8, luminance: 4 }
      }
    }
  },
  {
    id: "creative-matte-pink-cyan",
    series: "个性",
    name: "粉青雾面",
    description: "浅粉肤色与青色暗部，整体柔和雾面。",
    params: {
      exposure: 6,
      temperature: 2,
      tint: 8,
      contrast: -10,
      highlights: -18,
      shadows: 20,
      blacks: 10,
      saturation: -6,
      vibrance: 14,
      clarity: -10,
      texture: -8,
      grain: 10,
      skinProtection: 88,
      hsl: {
        ...createDefaultEditParams().hsl,
        red: { hue: 4, saturation: -6, luminance: 6 },
        orange: { hue: -2, saturation: -4, luminance: 8 },
        aqua: { hue: -10, saturation: 10, luminance: 4 },
        blue: { hue: -12, saturation: -8, luminance: 8 }
      }
    }
  },
  {
    id: "creative-premium-gray",
    series: "个性",
    name: "高级灰",
    description: "压低杂色，保留质感和克制对比。",
    params: {
      exposure: 1,
      temperature: -2,
      contrast: 12,
      highlights: -20,
      shadows: 10,
      whites: 4,
      blacks: -12,
      saturation: -26,
      vibrance: -4,
      clarity: 12,
      texture: 6,
      sharpness: 12,
      hsl: {
        ...createDefaultEditParams().hsl,
        red: { hue: 0, saturation: -12, luminance: 2 },
        orange: { hue: 0, saturation: -10, luminance: 4 },
        yellow: { hue: -8, saturation: -26, luminance: 0 },
        green: { hue: -10, saturation: -32, luminance: -2 },
        blue: { hue: -6, saturation: -24, luminance: -4 }
      }
    }
  },
  {
    id: "creative-cross-process",
    series: "个性",
    name: "交叉冲洗",
    description: "偏绿高光和偏蓝阴影，带实验胶片感。",
    params: {
      exposure: 2,
      temperature: -4,
      tint: -10,
      contrast: 18,
      highlights: -12,
      shadows: 8,
      blacks: -16,
      saturation: 2,
      vibrance: 20,
      clarity: 8,
      grain: 18,
      vignette: 8,
      hsl: {
        ...createDefaultEditParams().hsl,
        yellow: { hue: -20, saturation: 8, luminance: 2 },
        green: { hue: -18, saturation: 16, luminance: -2 },
        blue: { hue: 12, saturation: 18, luminance: -8 },
        purple: { hue: 10, saturation: 12, luminance: -4 }
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
