import type { EditParams } from "../types";
import { getMakeupLook, type MakeupColorLayer } from "./makeupLooks";
import { PORTRAIT_SEGMENTATION_CATEGORY, type PortraitAnalysis, type PortraitLandmark } from "./portraitBeautify";

interface Point {
  x: number;
  y: number;
}

interface EllipseRegion extends Point {
  radiusX: number;
  radiusY: number;
}

interface FaceMakeupRegions {
  face: EllipseRegion;
  leftEye: EllipseRegion;
  rightEye: EllipseRegion;
  leftShadow: EllipseRegion;
  rightShadow: EllipseRegion;
  leftBrow: EllipseRegion;
  rightBrow: EllipseRegion;
  leftBlush: EllipseRegion;
  rightBlush: EllipseRegion;
  forehead: EllipseRegion;
  nose: EllipseRegion;
  outerLips: Point[];
  innerMouth: Point[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const OUTER_LIP_INDICES = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const INNER_MOUTH_INDICES = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];
const LEFT_BROW_INDICES = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107];
const RIGHT_BROW_INDICES = [276, 283, 282, 295, 285, 300, 293, 334, 296, 336];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const getLuma = (red: number, green: number, blue: number) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;
const getCb = (red: number, green: number, blue: number) => 128 - 0.114572 * red - 0.385428 * green + 0.5 * blue;
const getCr = (red: number, green: number, blue: number) => 128 + 0.5 * red - 0.454153 * green - 0.045847 * blue;

const yCbCrToRgb = (luma: number, cb: number, cr: number): [number, number, number] => {
  const blueDifference = cb - 128;
  const redDifference = cr - 128;
  return [
    luma + 1.5748 * redDifference,
    luma - 0.187324 * blueDifference - 0.468124 * redDifference,
    luma + 1.8556 * blueDifference
  ];
};

const landmarkPoint = (landmarks: PortraitLandmark[], index: number, width: number, height: number) => {
  const point = landmarks[index];
  return point ? { x: point.x * width, y: point.y * height } : undefined;
};

const pointsForIndices = (landmarks: PortraitLandmark[], indices: number[], width: number, height: number) =>
  indices
    .map((index) => landmarkPoint(landmarks, index, width, height))
    .filter((point): point is Point => Boolean(point));

const ellipseFromPoints = (points: Point[], paddingX: number, paddingY: number): EllipseRegion | undefined => {
  if (points.length === 0) return undefined;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    radiusX: Math.max(2, (maxX - minX) * paddingX),
    radiusY: Math.max(2, (maxY - minY) * paddingY)
  };
};

const shiftedEllipse = (region: EllipseRegion, shiftY: number, scaleX: number, scaleY: number): EllipseRegion => ({
  x: region.x,
  y: region.y + region.radiusY * shiftY,
  radiusX: region.radiusX * scaleX,
  radiusY: region.radiusY * scaleY
});

const createFaceRegions = (landmarks: PortraitLandmark[], width: number, height: number): FaceMakeupRegions | undefined => {
  const allPoints = landmarks.map((landmark) => ({ x: landmark.x * width, y: landmark.y * height }));
  const leftEye = ellipseFromPoints(pointsForIndices(landmarks, LEFT_EYE_INDICES, width, height), 0.7, 1.05);
  const rightEye = ellipseFromPoints(pointsForIndices(landmarks, RIGHT_EYE_INDICES, width, height), 0.7, 1.05);
  const leftBrow = ellipseFromPoints(pointsForIndices(landmarks, LEFT_BROW_INDICES, width, height), 0.62, 0.78);
  const rightBrow = ellipseFromPoints(pointsForIndices(landmarks, RIGHT_BROW_INDICES, width, height), 0.62, 0.78);
  const outerLips = pointsForIndices(landmarks, OUTER_LIP_INDICES, width, height);
  const innerMouth = pointsForIndices(landmarks, INNER_MOUTH_INDICES, width, height);
  if (!leftEye || !rightEye || !leftBrow || !rightBrow || outerLips.length < 12 || innerMouth.length < 12) return undefined;

  const minFaceX = Math.min(...allPoints.map((point) => point.x));
  const maxFaceX = Math.max(...allPoints.map((point) => point.x));
  const minFaceY = Math.min(...allPoints.map((point) => point.y));
  const maxFaceY = Math.max(...allPoints.map((point) => point.y));
  const faceWidth = maxFaceX - minFaceX;
  const faceHeight = maxFaceY - minFaceY;
  if (faceWidth < 18 || faceHeight < 18) return undefined;
  const face: EllipseRegion = {
    x: (minFaceX + maxFaceX) / 2,
    y: (minFaceY + maxFaceY) / 2,
    radiusX: faceWidth * 0.51,
    radiusY: faceHeight * 0.53
  };
  const leftCheek = landmarkPoint(landmarks, 50, width, height) ?? { x: face.x - faceWidth * 0.22, y: face.y + faceHeight * 0.08 };
  const rightCheek = landmarkPoint(landmarks, 280, width, height) ?? { x: face.x + faceWidth * 0.22, y: face.y + faceHeight * 0.08 };
  const foreheadPoint = landmarkPoint(landmarks, 10, width, height) ?? { x: face.x, y: face.y - faceHeight * 0.3 };
  const nosePoint = landmarkPoint(landmarks, 1, width, height) ?? { x: face.x, y: face.y };

  return {
    face,
    leftEye,
    rightEye,
    leftShadow: shiftedEllipse(leftEye, -0.72, 1.32, 1.45),
    rightShadow: shiftedEllipse(rightEye, -0.72, 1.32, 1.45),
    leftBrow,
    rightBrow,
    leftBlush: { x: leftCheek.x, y: leftCheek.y, radiusX: faceWidth * 0.16, radiusY: faceHeight * 0.105 },
    rightBlush: { x: rightCheek.x, y: rightCheek.y, radiusX: faceWidth * 0.16, radiusY: faceHeight * 0.105 },
    forehead: { x: foreheadPoint.x, y: foreheadPoint.y + faceHeight * 0.06, radiusX: faceWidth * 0.13, radiusY: faceHeight * 0.12 },
    nose: { x: nosePoint.x, y: nosePoint.y - faceHeight * 0.03, radiusX: faceWidth * 0.055, radiusY: faceHeight * 0.19 },
    outerLips,
    innerMouth,
    minX: Math.max(0, Math.floor(minFaceX - faceWidth * 0.06)),
    maxX: Math.min(width - 1, Math.ceil(maxFaceX + faceWidth * 0.06)),
    minY: Math.max(0, Math.floor(minFaceY - faceHeight * 0.08)),
    maxY: Math.min(height - 1, Math.ceil(maxFaceY + faceHeight * 0.05))
  };
};

const ellipseWeight = (region: EllipseRegion, x: number, y: number) => {
  const dx = (x - region.x) / region.radiusX;
  const dy = (y - region.y) / region.radiusY;
  const distanceSquared = dx * dx + dy * dy;
  return distanceSquared < 1 ? (1 - distanceSquared) * (1 - distanceSquared) : 0;
};

const isPointInPolygon = (polygon: Point[], x: number, y: number) => {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 0.0001) + a.x) inside = !inside;
  }
  return inside;
};

const distanceToSegment = (pointX: number, pointY: number, start: Point, end: Point) => {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const t = lengthSquared > 0 ? clamp(((pointX - start.x) * deltaX + (pointY - start.y) * deltaY) / lengthSquared, 0, 1) : 0;
  return Math.hypot(pointX - (start.x + deltaX * t), pointY - (start.y + deltaY * t));
};

const polygonWeight = (polygon: Point[], x: number, y: number, feather: number) => {
  if (!isPointInPolygon(polygon, x, y)) return 0;
  let edgeDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    edgeDistance = Math.min(edgeDistance, distanceToSegment(x, y, polygon[index], polygon[(index + 1) % polygon.length]));
  }
  return clamp(edgeDistance / feather, 0, 1);
};

const eyelinerWeight = (eye: EllipseRegion, x: number, y: number) => {
  const dx = (x - eye.x) / eye.radiusX;
  const dy = (y - eye.y) / eye.radiusY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const ring = clamp(1 - Math.abs(distance - 1) / 0.24, 0, 1);
  const upperGuard = clamp((0.55 - dy) / 0.48, 0, 1);
  return ring * upperGuard;
};

const blendColorLayer = (
  data: Uint8ClampedArray,
  index: number,
  layer: MakeupColorLayer,
  mask: number,
  strength: number,
  lumaInfluence: number
) => {
  const amount = clamp(layer.amount * mask * strength, 0, 0.82);
  if (amount <= 0) return;
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const luma = getLuma(red, green, blue);
  const cb = getCb(red, green, blue);
  const cr = getCr(red, green, blue);
  const targetLuma = getLuma(layer.color[0], layer.color[1], layer.color[2]);
  const targetCb = getCb(layer.color[0], layer.color[1], layer.color[2]);
  const targetCr = getCr(layer.color[0], layer.color[1], layer.color[2]);
  const adjustedLuma = luma + clamp(targetLuma - luma, -28, 28) * amount * lumaInfluence;
  const adjustedCb = cb + (targetCb - cb) * amount;
  const adjustedCr = cr + (targetCr - cr) * amount;
  const [nextRed, nextGreen, nextBlue] = yCbCrToRgb(adjustedLuma, adjustedCb, adjustedCr);
  data[index] = clamp(nextRed, 0, 255);
  data[index + 1] = clamp(nextGreen, 0, 255);
  data[index + 2] = clamp(nextBlue, 0, 255);
};

const adjustLuma = (data: Uint8ClampedArray, index: number, delta: number) => {
  if (Math.abs(delta) < 0.01) return;
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const [nextRed, nextGreen, nextBlue] = yCbCrToRgb(getLuma(red, green, blue) + delta, getCb(red, green, blue), getCr(red, green, blue));
  data[index] = clamp(nextRed, 0, 255);
  data[index + 1] = clamp(nextGreen, 0, 255);
  data[index + 2] = clamp(nextBlue, 0, 255);
};

export const applyMakeup = (imageData: ImageData, edits: EditParams, portraitAnalysis?: PortraitAnalysis) => {
  const look = getMakeupLook(edits.makeupStyle);
  const strength = clamp(edits.makeupStrength / 100, 0, 1);
  if (!look || strength <= 0 || !portraitAnalysis || portraitAnalysis.faces.length === 0) return imageData;

  const { data, width, height } = imageData;
  const segmentation = portraitAnalysis.segmentation;
  const getFaceSkinWeight = (x: number, y: number) => {
    if (!segmentation) return 1;
    const maskX = clamp(Math.floor(((x + 0.5) / width) * segmentation.width), 0, segmentation.width - 1);
    const maskY = clamp(Math.floor(((y + 0.5) / height) * segmentation.height), 0, segmentation.height - 1);
    let matched = 0;
    let total = 0;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const sampleX = clamp(maskX + offsetX, 0, segmentation.width - 1);
        const sampleY = clamp(maskY + offsetY, 0, segmentation.height - 1);
        const weight = offsetX === 0 && offsetY === 0 ? 4 : Math.abs(offsetX) + Math.abs(offsetY) === 1 ? 2 : 1;
        if (segmentation.categories[sampleY * segmentation.width + sampleX] === PORTRAIT_SEGMENTATION_CATEGORY.faceSkin) matched += weight;
        total += weight;
      }
    }
    return matched / total;
  };

  portraitAnalysis.faces.forEach((landmarks) => {
    const regions = createFaceRegions(landmarks, width, height);
    if (!regions) return;
    const lipFeather = Math.max(1, regions.face.radiusX * 0.012);

    for (let y = regions.minY; y <= regions.maxY; y += 1) {
      for (let x = regions.minX; x <= regions.maxX; x += 1) {
        const index = (y * width + x) * 4;
        const faceWeight = ellipseWeight(regions.face, x, y);
        if (faceWeight <= 0) continue;
        const leftEye = ellipseWeight(regions.leftEye, x, y);
        const rightEye = ellipseWeight(regions.rightEye, x, y);
        const leftBrow = ellipseWeight(regions.leftBrow, x, y);
        const rightBrow = ellipseWeight(regions.rightBrow, x, y);
        const outerLipWeight = polygonWeight(regions.outerLips, x, y, lipFeather);
        const innerMouth = outerLipWeight > 0 && isPointInPolygon(regions.innerMouth, x, y) ? 1 : 0;
        const lipWeight = outerLipWeight * (1 - innerMouth);
        const featureGuard = 1 - Math.max(leftEye, rightEye, leftBrow, rightBrow, outerLipWeight) * 0.98;
        const skinWeight = faceWeight * featureGuard * getFaceSkinWeight(x, y);

        if (look.palette.foundation && skinWeight > 0) {
          blendColorLayer(data, index, look.palette.foundation, skinWeight, strength, 0.16);
        }

        if (look.palette.contour) {
          const normalizedX = Math.abs((x - regions.face.x) / regions.face.radiusX);
          const normalizedY = Math.abs((y - regions.face.y) / regions.face.radiusY);
          const contourMask = skinWeight * clamp((normalizedX - 0.42) / 0.36, 0, 1) * clamp((0.9 - normalizedY) / 0.32, 0, 1);
          adjustLuma(data, index, -14 * look.palette.contour * strength * contourMask);
        }

        if (look.palette.highlight) {
          const highlightMask = skinWeight * Math.max(ellipseWeight(regions.forehead, x, y), ellipseWeight(regions.nose, x, y));
          adjustLuma(data, index, 12 * look.palette.highlight * strength * highlightMask);
        }

        if (look.palette.blush) {
          const blushMask = getFaceSkinWeight(x, y) * Math.max(ellipseWeight(regions.leftBlush, x, y), ellipseWeight(regions.rightBlush, x, y));
          blendColorLayer(data, index, look.palette.blush, blushMask, strength, 0.08);
        }

        if (look.palette.eyeshadow) {
          const shadowMask = Math.max(
            ellipseWeight(regions.leftShadow, x, y) * (1 - leftEye),
            ellipseWeight(regions.rightShadow, x, y) * (1 - rightEye)
          );
          blendColorLayer(data, index, look.palette.eyeshadow, shadowMask, strength, 0.3);
        }

        if (look.palette.brow) {
          blendColorLayer(data, index, look.palette.brow, Math.max(leftBrow, rightBrow), strength, 0.42);
        }

        if (look.palette.eyeliner) {
          const lineMask = Math.max(eyelinerWeight(regions.leftEye, x, y), eyelinerWeight(regions.rightEye, x, y));
          adjustLuma(data, index, -42 * look.palette.eyeliner * strength * lineMask);
        }

        if (look.palette.lips && lipWeight > 0) {
          blendColorLayer(data, index, look.palette.lips, lipWeight, strength, 0.38);
        }
      }
    }
  });

  return imageData;
};
