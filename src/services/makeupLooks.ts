import type { MakeupStyleId } from "../types";

export type MakeupAudience = "men" | "women";

export interface MakeupColorLayer {
  color: readonly [number, number, number];
  amount: number;
}

export interface MakeupPalette {
  foundation?: MakeupColorLayer;
  lips?: MakeupColorLayer;
  blush?: MakeupColorLayer;
  eyeshadow?: MakeupColorLayer;
  brow?: MakeupColorLayer;
  eyeliner?: number;
  contour?: number;
  highlight?: number;
}

export interface MakeupLook {
  id: Exclude<MakeupStyleId, "none">;
  audience: MakeupAudience;
  name: string;
  description: string;
  swatch: string;
  palette: MakeupPalette;
}

export const makeupLooks: MakeupLook[] = [
  {
    id: "men-clean", audience: "men", name: "清透裸妆", description: "均匀肤色与自然眉形", swatch: "#b9846e",
    palette: { foundation: { color: [188, 139, 117], amount: 0.22 }, lips: { color: [142, 82, 76], amount: 0.12 }, brow: { color: [62, 47, 42], amount: 0.2 }, contour: 0.12, highlight: 0.08 }
  },
  {
    id: "men-business-matte", audience: "men", name: "商务哑光", description: "低光泽、轮廓清晰", swatch: "#84665c",
    palette: { foundation: { color: [171, 127, 109], amount: 0.28 }, lips: { color: [126, 78, 72], amount: 0.1 }, brow: { color: [50, 42, 39], amount: 0.28 }, contour: 0.22, highlight: 0.04 }
  },
  {
    id: "men-warm-commute", audience: "men", name: "暖调通勤", description: "温暖气色与柔和轮廓", swatch: "#bb775d",
    palette: { foundation: { color: [194, 139, 111], amount: 0.24 }, lips: { color: [151, 78, 65], amount: 0.14 }, blush: { color: [188, 91, 67], amount: 0.1 }, brow: { color: [68, 45, 36], amount: 0.22 }, contour: 0.14, highlight: 0.07 }
  },
  {
    id: "men-cool-clear", audience: "men", name: "冷调清俊", description: "冷净肤色与灰棕眉眼", swatch: "#8d7c7a",
    palette: { foundation: { color: [181, 139, 132], amount: 0.22 }, lips: { color: [128, 76, 79], amount: 0.1 }, eyeshadow: { color: [91, 79, 82], amount: 0.1 }, brow: { color: [54, 50, 51], amount: 0.24 }, eyeliner: 0.07, contour: 0.16 }
  },
  {
    id: "men-bronze", audience: "men", name: "古铜轮廓", description: "健康古铜与立体阴影", swatch: "#9f6442",
    palette: { foundation: { color: [174, 111, 76], amount: 0.3 }, lips: { color: [124, 69, 52], amount: 0.12 }, blush: { color: [159, 83, 50], amount: 0.09 }, brow: { color: [58, 39, 30], amount: 0.25 }, contour: 0.3, highlight: 0.07 }
  },
  {
    id: "men-camera", audience: "men", name: "镜头精修", description: "上镜提亮与五官聚焦", swatch: "#b88879",
    palette: { foundation: { color: [192, 147, 133], amount: 0.3 }, lips: { color: [145, 80, 78], amount: 0.13 }, blush: { color: [179, 100, 92], amount: 0.08 }, eyeshadow: { color: [91, 74, 72], amount: 0.08 }, brow: { color: [55, 45, 43], amount: 0.26 }, eyeliner: 0.06, contour: 0.2, highlight: 0.16 }
  },
  {
    id: "men-outdoor", audience: "men", name: "户外阳光", description: "自然暖肤与轻古铜感", swatch: "#b8754f",
    palette: { foundation: { color: [187, 126, 88], amount: 0.24 }, lips: { color: [139, 77, 58], amount: 0.1 }, blush: { color: [179, 91, 55], amount: 0.08 }, brow: { color: [66, 46, 35], amount: 0.2 }, contour: 0.19, highlight: 0.1 }
  },
  {
    id: "men-vintage-brown", audience: "men", name: "复古棕调", description: "低饱和棕色眉眼", swatch: "#795748",
    palette: { foundation: { color: [171, 124, 105], amount: 0.2 }, lips: { color: [119, 67, 61], amount: 0.13 }, eyeshadow: { color: [101, 67, 51], amount: 0.18 }, brow: { color: [55, 38, 31], amount: 0.27 }, eyeliner: 0.08, contour: 0.21 }
  },
  {
    id: "men-stage", audience: "men", name: "舞台立体", description: "强化眉眼与面部结构", swatch: "#70575d",
    palette: { foundation: { color: [181, 137, 126], amount: 0.28 }, lips: { color: [132, 67, 70], amount: 0.16 }, eyeshadow: { color: [78, 60, 66], amount: 0.22 }, brow: { color: [43, 36, 39], amount: 0.34 }, eyeliner: 0.16, contour: 0.32, highlight: 0.18 }
  },
  {
    id: "men-night-smoke", audience: "men", name: "夜色烟灰", description: "烟灰眼周与冷调轮廓", swatch: "#59545f",
    palette: { foundation: { color: [169, 133, 132], amount: 0.2 }, lips: { color: [113, 65, 72], amount: 0.12 }, eyeshadow: { color: [66, 64, 76], amount: 0.27 }, brow: { color: [41, 41, 46], amount: 0.3 }, eyeliner: 0.2, contour: 0.27, highlight: 0.08 }
  },
  {
    id: "women-nude", audience: "women", name: "自然裸妆", description: "柔雾底妆与豆沙唇", swatch: "#bd7f78",
    palette: { foundation: { color: [201, 153, 139], amount: 0.32 }, lips: { color: [167, 78, 83], amount: 0.34 }, blush: { color: [205, 111, 107], amount: 0.18 }, eyeshadow: { color: [139, 98, 91], amount: 0.14 }, brow: { color: [76, 52, 47], amount: 0.24 }, eyeliner: 0.1, contour: 0.13, highlight: 0.12 }
  },
  {
    id: "women-peach", audience: "women", name: "蜜桃元气", description: "蜜桃腮红与水润唇色", swatch: "#ef8f78",
    palette: { foundation: { color: [211, 161, 143], amount: 0.3 }, lips: { color: [225, 91, 87], amount: 0.42 }, blush: { color: [238, 122, 103], amount: 0.3 }, eyeshadow: { color: [210, 130, 108], amount: 0.18 }, brow: { color: [88, 59, 48], amount: 0.2 }, eyeliner: 0.1, contour: 0.1, highlight: 0.18 }
  },
  {
    id: "women-coral", audience: "women", name: "珊瑚日光", description: "明亮珊瑚与暖金眼周", swatch: "#df755e",
    palette: { foundation: { color: [207, 152, 126], amount: 0.28 }, lips: { color: [215, 73, 62], amount: 0.46 }, blush: { color: [222, 103, 76], amount: 0.26 }, eyeshadow: { color: [184, 116, 70], amount: 0.2 }, brow: { color: [79, 53, 39], amount: 0.23 }, eyeliner: 0.12, contour: 0.13, highlight: 0.19 }
  },
  {
    id: "women-rose", audience: "women", name: "玫瑰通勤", description: "干燥玫瑰与精致眉眼", swatch: "#b75d72",
    palette: { foundation: { color: [199, 151, 143], amount: 0.3 }, lips: { color: [174, 55, 82], amount: 0.48 }, blush: { color: [193, 91, 116], amount: 0.24 }, eyeshadow: { color: [143, 86, 101], amount: 0.2 }, brow: { color: [68, 48, 51], amount: 0.26 }, eyeliner: 0.14, contour: 0.15, highlight: 0.14 }
  },
  {
    id: "women-classic-red", audience: "women", name: "经典红唇", description: "正红唇色与利落眼线", swatch: "#b72432",
    palette: { foundation: { color: [205, 154, 140], amount: 0.32 }, lips: { color: [180, 22, 39], amount: 0.62 }, blush: { color: [181, 72, 79], amount: 0.18 }, eyeshadow: { color: [118, 80, 73], amount: 0.14 }, brow: { color: [57, 43, 41], amount: 0.28 }, eyeliner: 0.23, contour: 0.18, highlight: 0.16 }
  },
  {
    id: "women-plum", audience: "women", name: "梅子冷调", description: "冷梅唇颊与紫灰眼影", swatch: "#813d63",
    palette: { foundation: { color: [190, 146, 148], amount: 0.26 }, lips: { color: [119, 42, 82], amount: 0.55 }, blush: { color: [154, 76, 116], amount: 0.22 }, eyeshadow: { color: [105, 76, 108], amount: 0.25 }, brow: { color: [55, 46, 53], amount: 0.27 }, eyeliner: 0.17, contour: 0.18, highlight: 0.11 }
  },
  {
    id: "women-smoky", audience: "women", name: "烟熏夜妆", description: "深色眼影与裸棕唇", swatch: "#50464f",
    palette: { foundation: { color: [188, 145, 137], amount: 0.26 }, lips: { color: [132, 63, 67], amount: 0.38 }, blush: { color: [153, 82, 86], amount: 0.14 }, eyeshadow: { color: [58, 53, 61], amount: 0.46 }, brow: { color: [38, 35, 38], amount: 0.34 }, eyeliner: 0.35, contour: 0.28, highlight: 0.1 }
  },
  {
    id: "women-champagne", audience: "women", name: "香槟微光", description: "香槟眼周与细腻高光", swatch: "#d5a873",
    palette: { foundation: { color: [207, 159, 139], amount: 0.3 }, lips: { color: [187, 86, 85], amount: 0.4 }, blush: { color: [211, 115, 101], amount: 0.2 }, eyeshadow: { color: [201, 159, 101], amount: 0.28 }, brow: { color: [79, 55, 45], amount: 0.22 }, eyeliner: 0.13, contour: 0.14, highlight: 0.3 }
  },
  {
    id: "women-dewy", audience: "women", name: "清透水光", description: "清亮底妆与粉润唇颊", swatch: "#e49a9e",
    palette: { foundation: { color: [215, 169, 157], amount: 0.34 }, lips: { color: [211, 92, 116], amount: 0.4 }, blush: { color: [226, 129, 145], amount: 0.24 }, eyeshadow: { color: [187, 132, 133], amount: 0.12 }, brow: { color: [83, 60, 55], amount: 0.2 }, eyeliner: 0.09, contour: 0.09, highlight: 0.28 }
  },
  {
    id: "women-retro-hk", audience: "women", name: "复古港风", description: "砖红唇、暖棕眼与立体轮廓", swatch: "#9c3e35",
    palette: { foundation: { color: [196, 142, 119], amount: 0.28 }, lips: { color: [145, 43, 39], amount: 0.58 }, blush: { color: [174, 78, 60], amount: 0.2 }, eyeshadow: { color: [115, 70, 48], amount: 0.3 }, brow: { color: [59, 40, 31], amount: 0.3 }, eyeliner: 0.25, contour: 0.25, highlight: 0.16 }
  }
];

const makeupLookById = new Map<MakeupStyleId, MakeupLook>(makeupLooks.map((look) => [look.id, look]));

export const getMakeupLook = (style: MakeupStyleId) => makeupLookById.get(style);

export const isMakeupStyleId = (value: unknown): value is MakeupStyleId =>
  value === "none" || (typeof value === "string" && makeupLookById.has(value as MakeupStyleId));

export const getMakeupLooks = (audience: MakeupAudience) => makeupLooks.filter((look) => look.audience === audience);
