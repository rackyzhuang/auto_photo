import type { EditParams } from "../types";

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

const applyPortraitRetouch = (imageData: ImageData, edits: EditParams) => {
  const skinSmoothing = clamp(edits.skinSmoothing / 100, 0, 1);
  const skinTone = clamp(edits.skinTone / 100, -1, 1);
  const teethWhitening = clamp(edits.teethWhitening / 100, 0, 1);
  const clothingWrinkleReduction = clamp(edits.clothingWrinkleReduction / 100, 0, 1);
  if (skinSmoothing <= 0 && skinTone === 0 && teethWhitening <= 0 && clothingWrinkleReduction <= 0) return imageData;

  const { data, width, height } = imageData;
  const source = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      const red = source[index];
      const green = source[index + 1];
      const blue = source[index + 2];
      const luma = getLuma(red, green, blue);
      const skinMask = isSkinLikePixel(red, green, blue) ? 1 : 0;
      const teethMask = isTeethLikePixel(red, green, blue) && !skinMask ? 1 : 0;

      let blurRed = 0;
      let blurGreen = 0;
      let blurBlue = 0;
      let totalWeight = 0;

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const neighborIndex = ((y + offsetY) * width + x + offsetX) * 4;
          const neighborLuma = getLuma(source[neighborIndex], source[neighborIndex + 1], source[neighborIndex + 2]);
          const edgeWeight = clamp(1 - Math.abs(luma - neighborLuma) / 42, 0, 1);
          const weight = offsetX === 0 && offsetY === 0 ? 1 : edgeWeight;
          blurRed += source[neighborIndex] * weight;
          blurGreen += source[neighborIndex + 1] * weight;
          blurBlue += source[neighborIndex + 2] * weight;
          totalWeight += weight;
        }
      }

      blurRed /= totalWeight || 1;
      blurGreen /= totalWeight || 1;
      blurBlue /= totalWeight || 1;

      let nextRed = data[index];
      let nextGreen = data[index + 1];
      let nextBlue = data[index + 2];

      if (skinMask > 0) {
        const smoothAmount = skinSmoothing * 0.62;
        nextRed = nextRed * (1 - smoothAmount) + blurRed * smoothAmount;
        nextGreen = nextGreen * (1 - smoothAmount) + blurGreen * smoothAmount;
        nextBlue = nextBlue * (1 - smoothAmount) + blurBlue * smoothAmount;

        if (skinTone !== 0) {
          const toneAmount = skinTone * 9;
          nextRed = nextRed + toneAmount * 0.8;
          nextGreen = nextGreen + Math.abs(toneAmount) * 0.18;
          nextBlue = nextBlue - toneAmount * 0.16;
          const gray = getLuma(nextRed, nextGreen, nextBlue);
          const saturationFactor = 1 + Math.abs(skinTone) * 0.08;
          nextRed = gray + (nextRed - gray) * saturationFactor;
          nextGreen = gray + (nextGreen - gray) * saturationFactor;
          nextBlue = gray + (nextBlue - gray) * saturationFactor;
        }
      } else if (teethMask > 0) {
        const amount = teethWhitening * 0.68;
        const target = Math.min(245, luma + 28 * amount);
        nextRed = nextRed * (1 - amount) + target * amount;
        nextGreen = nextGreen * (1 - amount) + target * amount;
        nextBlue = nextBlue * (1 - amount) + (target + 8 * amount) * amount;
      } else if (clothingWrinkleReduction > 0) {
        let clothRed = red * 1.8;
        let clothGreen = green * 1.8;
        let clothBlue = blue * 1.8;
        let clothWeight = 1.8;

        for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
          for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
            if ((offsetX === 0 && offsetY === 0) || Math.abs(offsetX) + Math.abs(offsetY) > 3) continue;
            const sampleX = x + offsetX;
            const sampleY = y + offsetY;
            if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
            const neighborIndex = (sampleY * width + sampleX) * 4;
            const neighborRed = source[neighborIndex];
            const neighborGreen = source[neighborIndex + 1];
            const neighborBlue = source[neighborIndex + 2];
            const neighborLuma = getLuma(neighborRed, neighborGreen, neighborBlue);
            const edgeWeight = clamp(1 - Math.abs(luma - neighborLuma) / 58, 0, 1);
            const distanceWeight = Math.abs(offsetX) + Math.abs(offsetY) <= 1 ? 1 : 0.62;
            const weight = edgeWeight * distanceWeight;
            clothRed += neighborRed * weight;
            clothGreen += neighborGreen * weight;
            clothBlue += neighborBlue * weight;
            clothWeight += weight;
          }
        }

        clothRed /= clothWeight || 1;
        clothGreen /= clothWeight || 1;
        clothBlue /= clothWeight || 1;

        const localContrast =
          Math.abs(red - blurRed) +
          Math.abs(green - blurGreen) +
          Math.abs(blue - blurBlue) +
          Math.abs(red - clothRed) * 0.65 +
          Math.abs(green - clothGreen) * 0.65 +
          Math.abs(blue - clothBlue) * 0.65;
        const lumaMask = clamp((luma - 18) / 42, 0, 1) * clamp((246 - luma) / 48, 0, 1);
        const wrinkleMask = lumaMask * clamp((localContrast - 5) / 58, 0, 1);
        const amount = clothingWrinkleReduction * wrinkleMask * (0.68 + clothingWrinkleReduction * 0.24);
        nextRed = nextRed * (1 - amount) + clothRed * amount;
        nextGreen = nextGreen * (1 - amount) + clothGreen * amount;
        nextBlue = nextBlue * (1 - amount) + clothBlue * amount;
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

export const applyEditPipeline = (imageData: ImageData, edits: EditParams) => {
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
  applyPortraitRetouch(imageData, edits);
  applyQualityEnhancement(imageData, edits.qualityEnhancement, edits.skinProtection);
  applySharpening(imageData, edits.sharpness);
  applyVignetteAndGrain(imageData, edits.vignette, edits.grain);

  return imageData;
};
