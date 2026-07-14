import type { EditParams } from "../types";
import { applyMakeup } from "./makeupRenderer";
import {
  PORTRAIT_SEGMENTATION_CATEGORY,
  type PortraitAnalysis,
  type PortraitLandmark,
  type PortraitSegmentation
} from "./portraitBeautify";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const softClipChannel = (value: number) => {
  if (value < 0) return 255 * (value / (255 + Math.abs(value)));
  if (value > 255) return 255 + (value - 255) * (255 / (255 + value - 255));
  return value;
};

const compressRgbToDisplayGamut = (red: number, green: number, blue: number): [number, number, number] => {
  let nextRed = softClipChannel(red);
  let nextGreen = softClipChannel(green);
  let nextBlue = softClipChannel(blue);
  const maxChannel = Math.max(nextRed, nextGreen, nextBlue);
  const minChannel = Math.min(nextRed, nextGreen, nextBlue);

  if (maxChannel > 252 || minChannel < 3) {
    const luma = clamp(0.2126 * nextRed + 0.7152 * nextGreen + 0.0722 * nextBlue, 0, 255);
    const compression = maxChannel > 252 && minChannel < 3 ? 0.76 : 0.86;
    nextRed = luma + (nextRed - luma) * compression;
    nextGreen = luma + (nextGreen - luma) * compression;
    nextBlue = luma + (nextBlue - luma) * compression;
  }

  return [clamp(nextRed, 0, 255), clamp(nextGreen, 0, 255), clamp(nextBlue, 0, 255)];
};

const rgbToHsl = (red: number, green: number, blue: number): [number, number, number] => {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  if (max === g) hue = (b - r) / delta + 2;
  if (max === b) hue = (r - g) / delta + 4;

  return [hue * 60, saturation, lightness];
};

const hueToRgb = (p: number, q: number, tValue: number) => {
  let t = tValue;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
};

const hslToRgb = (hue: number, saturation: number, lightness: number): [number, number, number] => {
  const h = ((hue % 360) + 360) % 360;
  if (saturation === 0) {
    const value = lightness * 255;
    return [value, value, value];
  }

  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const hk = h / 360;
  return [hueToRgb(p, q, hk + 1 / 3) * 255, hueToRgb(p, q, hk) * 255, hueToRgb(p, q, hk - 1 / 3) * 255];
};

const getHslChannel = (hue: number) => {
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 45) return "orange";
  if (hue < 75) return "yellow";
  if (hue < 165) return "green";
  if (hue < 195) return "aqua";
  if (hue < 255) return "blue";
  if (hue < 285) return "purple";
  if (hue < 345) return "magenta";
  return "red";
};

const applyNoiseReduction = (imageData: ImageData, strength: number) => {
  if (strength <= 0) return imageData;

  const { data, width, height } = imageData;
  const source = new Uint8ClampedArray(data);
  const amount = clamp(strength / 100, 0, 1);
  const radius = amount > 0.42 ? 2 : 1;
  const threshold = 10 + amount * 46;
  const colorThreshold = 18 + amount * 52;

  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      const index = (y * width + x) * 4;
      const luma = 0.2126 * source[index] + 0.7152 * source[index + 1] + 0.0722 * source[index + 2];
      let totalWeight = 0;
      let red = 0;
      let green = 0;
      let blue = 0;

      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const neighborIndex = ((y + offsetY) * width + x + offsetX) * 4;
          const neighborLuma =
            0.2126 * source[neighborIndex] + 0.7152 * source[neighborIndex + 1] + 0.0722 * source[neighborIndex + 2];
          const lumaDifference = Math.abs(luma - neighborLuma);
          const colorDifference =
            Math.abs(source[index] - source[neighborIndex]) +
            Math.abs(source[index + 1] - source[neighborIndex + 1]) +
            Math.abs(source[index + 2] - source[neighborIndex + 2]);
          const spatialWeight = offsetX === 0 && offsetY === 0 ? 1 : 1 / (1 + Math.abs(offsetX) + Math.abs(offsetY));
          const lumaWeight = Math.max(0, 1 - lumaDifference / threshold);
          const colorWeight = Math.max(0, 1 - colorDifference / (colorThreshold * 3));
          const weight = spatialWeight * (0.22 + amount * 0.78) * lumaWeight * colorWeight;
          red += source[neighborIndex] * weight;
          green += source[neighborIndex + 1] * weight;
          blue += source[neighborIndex + 2] * weight;
          totalWeight += weight;
        }
      }

      const blend = amount * 0.92;
      data[index] = source[index] * (1 - blend) + (red / (totalWeight || 1)) * blend;
      data[index + 1] = source[index + 1] * (1 - blend) + (green / (totalWeight || 1)) * blend;
      data[index + 2] = source[index + 2] * (1 - blend) + (blue / (totalWeight || 1)) * blend;
    }
  }

  return imageData;
};

const applyQualityEnhancement = (imageData: ImageData, strength: number, skinProtection: number) => {
  const amount = clamp(strength / 100, 0, 1);
  if (amount <= 0) return imageData;

  const { data, width, height } = imageData;
  const source = new Uint8ClampedArray(data);
  const skinGuard = clamp(skinProtection / 100, 0, 1);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      const red = source[index];
      const green = source[index + 1];
      const blue = source[index + 2];
      const luma = getLuma(red, green, blue);
      const normalizedLuma = luma / 255;
      const midtoneWeight = clamp(1 - Math.abs(normalizedLuma - 0.5) * 1.65, 0, 1);
      const highlightGuard = clamp((238 - luma) / 46, 0, 1);
      const shadowGuard = clamp((luma - 18) / 44, 0, 1);
      const skinWeight = isSkinLikePixel(red, green, blue) ? 1 - skinGuard * 0.58 : 1;
      const localLuma =
        (getLuma(source[((y - 1) * width + x) * 4], source[((y - 1) * width + x) * 4 + 1], source[((y - 1) * width + x) * 4 + 2]) +
          getLuma(source[((y + 1) * width + x) * 4], source[((y + 1) * width + x) * 4 + 1], source[((y + 1) * width + x) * 4 + 2]) +
          getLuma(source[(y * width + x - 1) * 4], source[(y * width + x - 1) * 4 + 1], source[(y * width + x - 1) * 4 + 2]) +
          getLuma(source[(y * width + x + 1) * 4], source[(y * width + x + 1) * 4 + 1], source[(y * width + x + 1) * 4 + 2])) /
        4;
      const detail = luma - localLuma;
      const detailAmount = amount * 0.46 * midtoneWeight * highlightGuard * shadowGuard * skinWeight;
      const cleanLift = amount * 2.8 * midtoneWeight * highlightGuard * skinWeight;
      data[index] = clamp(data[index] + detail * detailAmount + cleanLift, 0, 255);
      data[index + 1] = clamp(data[index + 1] + detail * detailAmount + cleanLift, 0, 255);
      data[index + 2] = clamp(data[index + 2] + detail * detailAmount + cleanLift, 0, 255);
    }
  }

  return imageData;
};

const applySharpening = (imageData: ImageData, strength: number) => {
  if (strength <= 0) return imageData;

  const { data, width, height } = imageData;
  const source = new Uint8ClampedArray(data);
  const amount = clamp(strength / 40, 0, 1) * 0.72;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const center = source[index + channel];
        const blur =
          (source[((y - 1) * width + x) * 4 + channel] +
            source[((y + 1) * width + x) * 4 + channel] +
            source[(y * width + x - 1) * 4 + channel] +
            source[(y * width + x + 1) * 4 + channel]) /
          4;
        data[index + channel] = clamp(center + (center - blur) * amount, 0, 255);
      }
    }
  }

  return imageData;
};

const applyLocalDetail = (imageData: ImageData, clarity: number, texture: number) => {
  if (clarity === 0 && texture === 0) return imageData;

  const { data, width, height } = imageData;
  const source = new Uint8ClampedArray(data);
  const clarityAmount = clamp(clarity / 100, -0.5, 0.5) * 0.82;
  const textureAmount = clamp(texture / 100, -0.5, 0.5) * 0.62;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      const luma = 0.2126 * source[index] + 0.7152 * source[index + 1] + 0.0722 * source[index + 2];
      const midtoneWeight = clamp(1 - Math.abs(luma / 255 - 0.5) * 1.85, 0, 1);
      const amount = clarityAmount * midtoneWeight + textureAmount;

      if (amount === 0) continue;

      for (let channel = 0; channel < 3; channel += 1) {
        const center = source[index + channel];
        const blur =
          (source[((y - 1) * width + x) * 4 + channel] +
            source[((y + 1) * width + x) * 4 + channel] +
            source[(y * width + x - 1) * 4 + channel] +
            source[(y * width + x + 1) * 4 + channel]) /
          4;
        data[index + channel] = clamp(center + (center - blur) * amount, 0, 255);
      }
    }
  }

  return imageData;
};

const applyTransparencyDetail = (imageData: ImageData, strength: number, skinProtection: number) => {
  const amount = clamp(strength / 100, 0, 1);
  if (amount <= 0) return imageData;

  const { data, width, height } = imageData;
  const source = new Uint8ClampedArray(data);
  const skinGuard = clamp(skinProtection / 100, 0, 1);
  const offsets = [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ];

  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const index = (y * width + x) * 4;
      const red = source[index];
      const green = source[index + 1];
      const blue = source[index + 2];
      const luma = getLuma(red, green, blue);
      const normalizedLuma = luma / 255;
      const midtoneWeight = clamp(1 - Math.abs(normalizedLuma - 0.52) * 1.75, 0, 1);
      if (midtoneWeight <= 0) continue;

      let localLuma = 0;
      for (const [offsetX, offsetY] of offsets) {
        const neighborIndex = ((y + offsetY) * width + x + offsetX) * 4;
        localLuma += getLuma(source[neighborIndex], source[neighborIndex + 1], source[neighborIndex + 2]);
      }
      localLuma /= offsets.length;

      const skinWeight = isSkinLikePixel(red, green, blue) ? 1 - skinGuard * 0.68 : 1;
      const detail = luma - localLuma;
      const detailAmount = amount * 0.38 * midtoneWeight * skinWeight;
      const lift = amount * 5.5 * midtoneWeight * skinWeight;
      data[index] = clamp(data[index] + detail * detailAmount + lift, 0, 255);
      data[index + 1] = clamp(data[index + 1] + detail * detailAmount + lift, 0, 255);
      data[index + 2] = clamp(data[index + 2] + detail * detailAmount + lift, 0, 255);
    }
  }

  return imageData;
};

const stableNoise = (x: number, y: number) => {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const getLuma = (red: number, green: number, blue: number) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;

const isSkinLikePixel = (red: number, green: number, blue: number) => {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return red > 72 && green > 42 && blue > 28 && red > green && green >= blue && max - min > 16;
};

const isTeethLikePixel = (red: number, green: number, blue: number) => {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const luma = getLuma(red, green, blue);
  return luma > 118 && max - min < 72 && red >= blue - 10 && green >= blue - 18;
};

const getCb = (red: number, green: number, blue: number) => 128 - 0.114572 * red - 0.385428 * green + 0.5 * blue;

const getCr = (red: number, green: number, blue: number) => 128 + 0.5 * red - 0.454153 * green - 0.045847 * blue;

const rgbToYCbCr = (red: number, green: number, blue: number): [number, number, number] => [
  getLuma(red, green, blue),
  getCb(red, green, blue),
  getCr(red, green, blue)
];

const yCbCrToRgb = (luma: number, cb: number, cr: number): [number, number, number] => {
  const blueDifference = cb - 128;
  const redDifference = cr - 128;
  return [
    luma + 1.5748 * redDifference,
    luma - 0.187324 * blueDifference - 0.468124 * redDifference,
    luma + 1.8556 * blueDifference
  ];
};

const rangeWeight = (value: number, min: number, max: number, feather: number) =>
  clamp((value - min + feather) / feather, 0, 1) * clamp((max + feather - value) / feather, 0, 1);

const getSkinColorWeight = (red: number, green: number, blue: number) => {
  const luma = getLuma(red, green, blue);
  const cb = getCb(red, green, blue);
  const cr = getCr(red, green, blue);
  const chromaWeight = rangeWeight(cb, 77, 135, 18) * rangeWeight(cr, 125, 190, 20);
  return chromaWeight * clamp((luma - 7) / 24, 0, 1) * clamp((252 - luma) / 18, 0, 1);
};

interface EllipseRegion {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
}

interface FaceRetouchRegion extends EllipseRegion {
  featureRegions: EllipseRegion[];
  mouthRegion?: EllipseRegion;
}

const getLandmarkPixel = (landmarks: PortraitLandmark[], index: number, width: number, height: number) => {
  const point = landmarks[index];
  return point ? { x: point.x * width, y: point.y * height } : undefined;
};

const getEllipseWeight = (region: EllipseRegion, x: number, y: number) => {
  const dx = (x - region.centerX) / region.radiusX;
  const dy = (y - region.centerY) / region.radiusY;
  const distanceSquared = dx * dx + dy * dy;
  return distanceSquared < 1 ? (1 - distanceSquared) * (1 - distanceSquared) : 0;
};

const createFeatureEllipse = (
  landmarks: PortraitLandmark[],
  indices: number[],
  width: number,
  height: number,
  paddingX: number,
  paddingY: number
) => {
  const points = indices
    .map((index) => getLandmarkPixel(landmarks, index, width, height))
    .filter((point): point is NonNullable<typeof point> => Boolean(point));
  if (points.length === 0) return undefined;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    radiusX: Math.max(2, (maxX - minX) * paddingX),
    radiusY: Math.max(2, (maxY - minY) * paddingY)
  };
};

const weightedMedian = (histogram: Float64Array) => {
  let total = 0;
  for (let index = 0; index < histogram.length; index += 1) total += histogram[index];
  if (total <= 0) return undefined;
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= total / 2) return index;
  }
  return histogram.length - 1;
};

interface SegmentationSoftMasks {
  faceSkin: Uint8Array;
  bodySkin: Uint8Array;
  clothes: Uint8Array;
}

const segmentationSoftMaskCache = new WeakMap<PortraitSegmentation, SegmentationSoftMasks>();

const createSegmentationSoftMask = (segmentation: PortraitSegmentation, category: number) => {
  const output = new Uint8Array(segmentation.categories.length);
  for (let y = 0; y < segmentation.height; y += 1) {
    for (let x = 0; x < segmentation.width; x += 1) {
      let matched = 0;
      let total = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = clamp(x + offsetX, 0, segmentation.width - 1);
          const sampleY = clamp(y + offsetY, 0, segmentation.height - 1);
          const weight = offsetX === 0 && offsetY === 0 ? 4 : Math.abs(offsetX) + Math.abs(offsetY) === 1 ? 2 : 1;
          if (segmentation.categories[sampleY * segmentation.width + sampleX] === category) matched += weight;
          total += weight;
        }
      }
      output[y * segmentation.width + x] = Math.round((matched / total) * 255);
    }
  }
  return output;
};

const getSegmentationSoftMasks = (segmentation: PortraitSegmentation) => {
  const cached = segmentationSoftMaskCache.get(segmentation);
  if (cached) return cached;
  const masks = {
    faceSkin: createSegmentationSoftMask(segmentation, PORTRAIT_SEGMENTATION_CATEGORY.faceSkin),
    bodySkin: createSegmentationSoftMask(segmentation, PORTRAIT_SEGMENTATION_CATEGORY.bodySkin),
    clothes: createSegmentationSoftMask(segmentation, PORTRAIT_SEGMENTATION_CATEGORY.clothes)
  };
  segmentationSoftMaskCache.set(segmentation, masks);
  return masks;
};

const applyPortraitRetouch = (imageData: ImageData, edits: EditParams, portraitAnalysis?: PortraitAnalysis) => {
  const skinSmoothing = clamp(edits.skinSmoothing / 100, 0, 1);
  const skinTone = clamp(edits.skinTone / 100, -1, 1);
  const wrinkleReduction = clamp(edits.wrinkleReduction / 100, 0, 1);
  const skinToneUniformity = clamp(edits.skinToneUniformity / 100, 0, 1);
  const teethWhitening = clamp(edits.teethWhitening / 100, 0, 1);
  const clothingWrinkleReduction = clamp(edits.clothingWrinkleReduction / 100, 0, 1);
  if (
    skinSmoothing <= 0 &&
    skinTone === 0 &&
    wrinkleReduction <= 0 &&
    skinToneUniformity <= 0 &&
    teethWhitening <= 0 &&
    clothingWrinkleReduction <= 0
  ) return imageData;

  const { data, width, height } = imageData;
  const source = new Uint8ClampedArray(data);
  const segmentation = portraitAnalysis?.segmentation;
  const segmentationMasks = segmentation ? getSegmentationSoftMasks(segmentation) : undefined;
  const faceRegions: FaceRetouchRegion[] = (portraitAnalysis?.faces ?? [])
    .map((face) => {
      const xs = face.map((landmark) => landmark.x * width);
      const ys = face.map((landmark) => landmark.y * height);
      if (xs.length === 0 || ys.length === 0) return undefined;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const leftEye = createFeatureEllipse(face, [33, 133, 159, 145], width, height, 0.82, 1.2);
      const rightEye = createFeatureEllipse(face, [362, 263, 386, 374], width, height, 0.82, 1.2);
      const mouthRegion = createFeatureEllipse(face, [61, 291, 13, 14, 78, 308], width, height, 0.7, 1.05);
      return {
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
        radiusX: Math.max(1, (maxX - minX) * 0.54),
        radiusY: Math.max(1, (maxY - minY) * 0.53),
        featureRegions: [leftEye, rightEye, mouthRegion].filter(
          (region): region is NonNullable<typeof region> => Boolean(region)
        ),
        mouthRegion
      };
    })
    .filter((region): region is NonNullable<typeof region> => Boolean(region));

  const getFaceWeight = (x: number, y: number) => {
    let weight = 0;
    faceRegions.forEach((region) => { weight = Math.max(weight, getEllipseWeight(region, x, y)); });
    return weight;
  };

  const getFeatureProtection = (x: number, y: number) => {
    let weight = 0;
    faceRegions.forEach((region) => {
      region.featureRegions.forEach((feature) => { weight = Math.max(weight, getEllipseWeight(feature, x, y)); });
    });
    return weight;
  };

  const getMouthWeight = (x: number, y: number) => {
    let weight = 0;
    faceRegions.forEach((region) => {
      if (region.mouthRegion) weight = Math.max(weight, getEllipseWeight(region.mouthRegion, x, y));
    });
    return weight;
  };

  const torsoRegions = (portraitAnalysis?.poses ?? [])
    .map((pose) => {
      const leftShoulder = getLandmarkPixel(pose, 11, width, height);
      const rightShoulder = getLandmarkPixel(pose, 12, width, height);
      const leftHip = getLandmarkPixel(pose, 23, width, height);
      const rightHip = getLandmarkPixel(pose, 24, width, height);
      if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return undefined;
      const top = (leftShoulder.y + rightShoulder.y) / 2;
      const bottom = (leftHip.y + rightHip.y) / 2;
      if (bottom - top < 12) return undefined;
      return { leftShoulder, rightShoulder, leftHip, rightHip, top, bottom };
    })
    .filter((region): region is NonNullable<typeof region> => Boolean(region));

  const getTorsoWeight = (x: number, y: number) => {
    let weight = 0;
    torsoRegions.forEach((region) => {
      const vertical = clamp((y - region.top) / (region.bottom - region.top), 0, 1);
      if (y < region.top || y > region.bottom + (region.bottom - region.top) * 0.12) return;
      const left = region.leftShoulder.x + (region.leftHip.x - region.leftShoulder.x) * vertical;
      const right = region.rightShoulder.x + (region.rightHip.x - region.rightShoulder.x) * vertical;
      const minX = Math.min(left, right);
      const maxX = Math.max(left, right);
      const feather = Math.max(4, (maxX - minX) * 0.12);
      const horizontalWeight = clamp((x - minX) / feather, 0, 1) * clamp((maxX - x) / feather, 0, 1);
      const verticalWeight = clamp((y - region.top) / feather, 0, 1) * clamp((region.bottom + feather - y) / feather, 0, 1);
      weight = Math.max(weight, horizontalWeight * verticalWeight);
    });
    return weight;
  };

  const getSegmentationCategoryAt = (x: number, y: number) => {
    if (!segmentation) return -1;
    const maskX = clamp(Math.floor(((x + 0.5) / width) * segmentation.width), 0, segmentation.width - 1);
    const maskY = clamp(Math.floor(((y + 0.5) / height) * segmentation.height), 0, segmentation.height - 1);
    return segmentation.categories[maskY * segmentation.width + maskX] ?? -1;
  };

  const getSegmentationWeight = (x: number, y: number, mask: Uint8Array) => {
    if (!segmentation) return 0;
    const maskX = clamp(((x + 0.5) / width) * segmentation.width - 0.5, 0, segmentation.width - 1);
    const maskY = clamp(((y + 0.5) / height) * segmentation.height - 0.5, 0, segmentation.height - 1);
    const x0 = Math.floor(maskX);
    const y0 = Math.floor(maskY);
    const x1 = Math.min(segmentation.width - 1, x0 + 1);
    const y1 = Math.min(segmentation.height - 1, y0 + 1);
    const tx = maskX - x0;
    const ty = maskY - y0;
    const top = mask[y0 * segmentation.width + x0] * (1 - tx) + mask[y0 * segmentation.width + x1] * tx;
    const bottom = mask[y1 * segmentation.width + x0] * (1 - tx) + mask[y1 * segmentation.width + x1] * tx;
    return (top * (1 - ty) + bottom * ty) / 255;
  };

  const getSkinWeights = (x: number, y: number, red: number, green: number, blue: number) => {
    const colorWeight = getSkinColorWeight(red, green, blue);
    const faceWeight = getFaceWeight(x, y);
    const featureGuard = faceWeight > 0 ? 1 - getFeatureProtection(x, y) * 0.96 : 1;
    if (!segmentation) {
      const fallback = colorWeight * faceWeight * featureGuard;
      return { all: fallback, face: fallback, faceRegion: faceWeight };
    }
    const faceSkin = getSegmentationWeight(x, y, segmentationMasks!.faceSkin) * featureGuard;
    const bodySkin = getSegmentationWeight(x, y, segmentationMasks!.bodySkin) * 0.72;
    const segmentationWeight = Math.max(faceSkin, bodySkin);
    const reliableColorWeight = 0.38 + colorWeight * 0.62;
    return {
      all: segmentationWeight * reliableColorWeight,
      face: faceSkin * reliableColorWeight,
      faceRegion: Math.max(faceWeight, faceSkin)
    };
  };

  const getClothingWeight = (x: number, y: number) =>
    segmentation
      ? getSegmentationWeight(x, y, segmentationMasks!.clothes)
      : getTorsoWeight(x, y);

  const getFilteredColor = (x: number, y: number, radius: number, mode: "skin" | "clothes") => {
    const index = (y * width + x) * 4;
    const centerRed = source[index];
    const centerGreen = source[index + 1];
    const centerBlue = source[index + 2];
    const centerLuma = getLuma(centerRed, centerGreen, centerBlue);
    const centerCb = getCb(centerRed, centerGreen, centerBlue);
    const centerCr = getCr(centerRed, centerGreen, centerBlue);
    let red = 0;
    let green = 0;
    let blue = 0;
    let totalWeight = 0;
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      const sampleY = y + offsetY;
      if (sampleY < 0 || sampleY >= height) continue;
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        const sampleX = x + offsetX;
        if (sampleX < 0 || sampleX >= width) continue;
        const category = getSegmentationCategoryAt(sampleX, sampleY);
        if (
          segmentation &&
          mode === "skin" &&
          category !== PORTRAIT_SEGMENTATION_CATEGORY.faceSkin &&
          category !== PORTRAIT_SEGMENTATION_CATEGORY.bodySkin
        ) continue;
        if (segmentation && mode === "clothes" && category !== PORTRAIT_SEGMENTATION_CATEGORY.clothes) continue;
        const sampleIndex = (sampleY * width + sampleX) * 4;
        const sampleRed = source[sampleIndex];
        const sampleGreen = source[sampleIndex + 1];
        const sampleBlue = source[sampleIndex + 2];
        const sampleLuma = getLuma(sampleRed, sampleGreen, sampleBlue);
        const sampleCb = getCb(sampleRed, sampleGreen, sampleBlue);
        const sampleCr = getCr(sampleRed, sampleGreen, sampleBlue);
        const spatialDistance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
        const spatialWeight = 1 - spatialDistance / (radius * 1.45 + 0.01);
        const lumaTolerance = mode === "skin" ? 38 : 54;
        const chromaTolerance = mode === "skin" ? 38 : 26;
        const lumaWeight = clamp(1 - Math.abs(sampleLuma - centerLuma) / lumaTolerance, 0, 1);
        const chromaWeight = clamp(1 - (Math.abs(sampleCb - centerCb) + Math.abs(sampleCr - centerCr)) / chromaTolerance, 0, 1);
        const weight = Math.max(0.02, spatialWeight) * (0.12 + lumaWeight * 0.88) * (0.08 + chromaWeight * 0.92);
        red += sampleRed * weight;
        green += sampleGreen * weight;
        blue += sampleBlue * weight;
        totalWeight += weight;
      }
    }
    const divisor = totalWeight || 1;
    const filteredRed = red / divisor;
    const filteredGreen = green / divisor;
    const filteredBlue = blue / divisor;
    return { red: filteredRed, green: filteredGreen, blue: filteredBlue, luma: getLuma(filteredRed, filteredGreen, filteredBlue) };
  };

  let skinTargetCb: number | undefined;
  let skinTargetCr: number | undefined;
  if (skinToneUniformity > 0 && (faceRegions.length > 0 || segmentation)) {
    const cbHistogram = new Float64Array(256);
    const crHistogram = new Float64Array(256);
    const sampleStep = Math.max(1, Math.floor(Math.max(width, height) / 900));
    for (let y = 0; y < height; y += sampleStep) {
      for (let x = 0; x < width; x += sampleStep) {
        const index = (y * width + x) * 4;
        const red = source[index];
        const green = source[index + 1];
        const blue = source[index + 2];
        const [luma, cb, cr] = rgbToYCbCr(red, green, blue);
        if (luma < 20 || luma > 242) continue;
        const skinWeights = getSkinWeights(x, y, red, green, blue);
        if (skinWeights.all <= 0.08) continue;
        const weight = skinWeights.all * (0.45 + clamp((luma - 20) / 80, 0, 1) * 0.55);
        cbHistogram[clamp(Math.round(cb), 0, 255)] += weight;
        crHistogram[clamp(Math.round(cr), 0, 255)] += weight;
      }
    }
    skinTargetCb = weightedMedian(cbHistogram);
    skinTargetCr = weightedMedian(crHistogram);
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      const red = source[index];
      const green = source[index + 1];
      const blue = source[index + 2];
      const luma = getLuma(red, green, blue);
      const skinWeights = getSkinWeights(x, y, red, green, blue);
      const mouthWeight = teethWhitening > 0 ? getMouthWeight(x, y) : 0;
      const teethMask = mouthWeight * (isTeethLikePixel(red, green, blue) ? 1 : 0);

      let nextRed = data[index];
      let nextGreen = data[index + 1];
      let nextBlue = data[index + 2];

      if (teethMask > 0) {
        const amount = teethWhitening * 0.68;
        const target = Math.min(245, luma + 28 * amount);
        const blend = amount * teethMask;
        nextRed = nextRed * (1 - blend) + target * blend;
        nextGreen = nextGreen * (1 - blend) + target * blend;
        nextBlue = nextBlue * (1 - blend) + (target + 6 * amount) * blend;
      } else if (skinWeights.all > 0.025) {
        if (skinSmoothing > 0 || (wrinkleReduction > 0 && skinWeights.face > 0)) {
          const fine = getFilteredColor(x, y, 1, "skin");
          const coarse = getFilteredColor(x, y, 2, "skin");
          const mediumDetail = Math.abs(luma - coarse.luma);
          const wrinkleMask = clamp((mediumDetail - 1.2) / 14, 0, 1);
          const wrinkleAmount = wrinkleReduction * skinWeights.face * skinWeights.faceRegion * (0.12 + wrinkleMask * 0.42);
          const edgeGuard = clamp(1 - mediumDetail / 38, 0.18, 1);
          const smoothAmount = clamp(
            (skinSmoothing * 0.48 * skinWeights.all + wrinkleAmount) * edgeGuard,
            0,
            0.68
          );
          const detailRetention = clamp(0.78 - skinSmoothing * 0.3 - wrinkleReduction * 0.16, 0.3, 0.78);
          const targetRed = coarse.red + (red - fine.red) * detailRetention;
          const targetGreen = coarse.green + (green - fine.green) * detailRetention;
          const targetBlue = coarse.blue + (blue - fine.blue) * detailRetention;
          nextRed = nextRed * (1 - smoothAmount) + targetRed * smoothAmount;
          nextGreen = nextGreen * (1 - smoothAmount) + targetGreen * smoothAmount;
          nextBlue = nextBlue * (1 - smoothAmount) + targetBlue * smoothAmount;
        }

        let [adjustedLuma, adjustedCb, adjustedCr] = rgbToYCbCr(nextRed, nextGreen, nextBlue);
        if (skinToneUniformity > 0 && skinTargetCb !== undefined && skinTargetCr !== undefined) {
          const uniformAmount = skinToneUniformity * skinWeights.all * 0.68;
          const cbCorrection = clamp(skinTargetCb - adjustedCb, -14, 14) * uniformAmount;
          const crCorrection = clamp(skinTargetCr - adjustedCr, -14, 14) * uniformAmount;
          adjustedCb += cbCorrection;
          adjustedCr += crCorrection;
        }
        if (skinTone !== 0) {
          adjustedLuma += Math.max(0, skinTone) * 2.2 * skinWeights.all;
          adjustedCb -= skinTone * 3.2 * skinWeights.all;
          adjustedCr += skinTone * 5.2 * skinWeights.all;
        }
        [nextRed, nextGreen, nextBlue] = yCbCrToRgb(adjustedLuma, adjustedCb, adjustedCr);
      } else if (clothingWrinkleReduction > 0) {
        const clothingWeight = getClothingWeight(x, y);
        if (clothingWeight > 0.025) {
          const fine = getFilteredColor(x, y, 1, "clothes");
          const coarse = getFilteredColor(x, y, 3, "clothes");
          const [, cb, cr] = rgbToYCbCr(red, green, blue);
          const [, coarseCb, coarseCr] = rgbToYCbCr(coarse.red, coarse.green, coarse.blue);
          const chromaDifference = Math.abs(cb - coarseCb) + Math.abs(cr - coarseCr);
          const patternGuard = clamp(1 - chromaDifference / 24, 0, 1);
          const wrinkleSignal = clamp((Math.abs(luma - coarse.luma) - 1.4) / 18, 0, 1);
          const lumaGuard = clamp((luma - 14) / 38, 0, 1) * clamp((248 - luma) / 34, 0, 1);
          const amount =
            clothingWrinkleReduction * clothingWeight * patternGuard * lumaGuard * (0.16 + wrinkleSignal * 0.58);
          const preservedDetail = (luma - fine.luma) * (0.52 - clothingWrinkleReduction * 0.18);
          const targetLuma = luma + clamp(coarse.luma + preservedDetail - luma, -22, 22) * amount;
          [nextRed, nextGreen, nextBlue] = yCbCrToRgb(targetLuma, cb, cr);
        }
      }

      data[index] = clamp(nextRed, 0, 255);
      data[index + 1] = clamp(nextGreen, 0, 255);
      data[index + 2] = clamp(nextBlue, 0, 255);
    }
  }

  return imageData;
};

const applyVignetteAndGrain = (imageData: ImageData, vignette: number, grain: number) => {
  if (vignette === 0 && grain <= 0) return imageData;

  const { data, width, height } = imageData;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY) || 1;
  const vignetteAmount = clamp(vignette / 100, -0.5, 0.5) * 0.82;
  const grainAmount = clamp(grain, 0, 50) * 1.35;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;

      if (vignetteAmount !== 0) {
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2) / maxDistance;
        const edge = Math.pow(clamp((distance - 0.32) / 0.68, 0, 1), 1.6);
        const factor = 1 - vignetteAmount * edge;
        data[index] = clamp(data[index] * factor, 0, 255);
        data[index + 1] = clamp(data[index + 1] * factor, 0, 255);
        data[index + 2] = clamp(data[index + 2] * factor, 0, 255);
      }

      if (grainAmount > 0) {
        const noise = (stableNoise(x, y) - 0.5) * grainAmount;
        data[index] = clamp(data[index] + noise, 0, 255);
        data[index + 1] = clamp(data[index + 1] + noise, 0, 255);
        data[index + 2] = clamp(data[index + 2] + noise, 0, 255);
      }
    }
  }

  return imageData;
};

export const applyEditPipeline = (imageData: ImageData, edits: EditParams, portraitAnalysis?: PortraitAnalysis) => {
  const data = imageData.data;
  const exposureGain = 1 + edits.exposure / 100;
  const contrast = 1 + edits.contrast / 100;
  const dehaze = edits.dehaze / 100;
  const transparency = clamp(edits.transparency / 100, 0, 1);
  const saturation = 1 + (edits.saturation + edits.vibrance * 0.65 + edits.dehaze * 0.12 + edits.transparency * 0.08) / 100;
  const warmthR = edits.temperature * 0.9;
  const warmthB = -edits.temperature * 0.9;
  const tintG = -edits.tint * 0.5;
  const shadowLift = Math.max(0, edits.shadows) / 100;
  const highlightPull = Math.min(0, edits.highlights) / 100;
  const blackPoint = edits.blacks / 180;
  const whitePoint = edits.whites / 180;
  const skinGuard = edits.skinProtection / 100;

  for (let i = 0; i < data.length; i += 4) {
    let red = data[i];
    let green = data[i + 1];
    let blue = data[i + 2];
    const originalRed = red;
    const originalGreen = green;
    const originalBlue = blue;
    const luma = getLuma(red, green, blue);
    const normalizedLuma = luma / 255;
    const isSkinLike = isSkinLikePixel(originalRed, originalGreen, originalBlue);

    const midtoneWeight = clamp(1 - Math.abs(normalizedLuma - 0.52) * 1.85, 0, 1);
    const dehazeContrast = 1 + dehaze * 0.32 * Math.max(0.15, Math.abs(normalizedLuma - 0.5) * 1.8);
    const transparencyContrast = 1 + transparency * 0.22 * Math.max(0.22, midtoneWeight);
    red = (red - 128) * contrast * dehazeContrast * transparencyContrast + 128;
    green = (green - 128) * contrast * dehazeContrast * transparencyContrast + 128;
    blue = (blue - 128) * contrast * dehazeContrast * transparencyContrast + 128;

    const shadowFactor = Math.max(0, 1 - normalizedLuma * 1.4) * shadowLift * 42;
    const highlightFactor = Math.max(0, normalizedLuma - 0.62) * highlightPull * 58;
    red += shadowFactor + highlightFactor;
    green += shadowFactor + highlightFactor;
    blue += shadowFactor + highlightFactor;

    const dehazeOffset = dehaze * 10 * (normalizedLuma - 0.42);
    const transparencyOffset =
      transparency *
      (midtoneWeight * 7.5 +
        Math.max(0, normalizedLuma - 0.58) * 9 -
        Math.max(0, normalizedLuma - 0.86) * 32 -
        Math.max(0, 0.16 - normalizedLuma) * 18);
    red = red * exposureGain + warmthR + whitePoint * 255 + blackPoint * 255 + dehazeOffset;
    green = green * exposureGain + tintG + whitePoint * 255 + blackPoint * 255 + dehazeOffset;
    blue = blue * exposureGain + warmthB + whitePoint * 255 + blackPoint * 255 + dehazeOffset;
    red += transparencyOffset;
    green += transparencyOffset;
    blue += transparencyOffset;

    const gray = 0.299 * red + 0.587 * green + 0.114 * blue;
    const localSaturation = isSkinLike ? 1 + (saturation - 1) * (1 - skinGuard * 0.74) : saturation;
    red = gray + (red - gray) * localSaturation;
    green = gray + (green - gray) * localSaturation;
    blue = gray + (blue - gray) * localSaturation;

    const [hue, hslSaturation, hslLightness] = rgbToHsl(clamp(red, 0, 255), clamp(green, 0, 255), clamp(blue, 0, 255));
    const channel = getHslChannel(hue);
    const hslEdit = edits.hsl[channel];
    if (hslEdit.hue !== 0 || hslEdit.saturation !== 0 || hslEdit.luminance !== 0) {
      const protectedStrength = isSkinLike && (channel === "red" || channel === "orange") ? 1 - skinGuard * 0.68 : 1;
      const adjustedHue = hue + hslEdit.hue * 0.7 * protectedStrength;
      const adjustedSaturation = clamp(hslSaturation * (1 + (hslEdit.saturation / 100) * protectedStrength), 0, 1);
      const adjustedLightness = clamp(hslLightness + (hslEdit.luminance / 100) * 0.45 * protectedStrength, 0, 1);
      [red, green, blue] = hslToRgb(adjustedHue, adjustedSaturation, adjustedLightness);
    }

    [data[i], data[i + 1], data[i + 2]] = compressRgbToDisplayGamut(red, green, blue);
  }

  applyNoiseReduction(imageData, Math.max(edits.noiseReduction, edits.qualityEnhancement * 0.22));
  applyTransparencyDetail(imageData, edits.transparency, edits.skinProtection);
  applyLocalDetail(imageData, edits.clarity, edits.texture);
  applyPortraitRetouch(imageData, edits, portraitAnalysis);
  applyMakeup(imageData, edits, portraitAnalysis);
  applyQualityEnhancement(imageData, edits.qualityEnhancement, edits.skinProtection);
  applySharpening(imageData, edits.sharpness);
  applyVignetteAndGrain(imageData, edits.vignette, edits.grain);

  return imageData;
};
