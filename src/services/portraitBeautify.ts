import type { EditParams } from "../types";

export interface PortraitLandmark {
  x: number;
  y: number;
  visibility?: number;
}

export interface PortraitAnalysis {
  faces: PortraitLandmark[][];
  poses: PortraitLandmark[][];
  segmentation?: PortraitSegmentation;
}

export interface PortraitSegmentation {
  width: number;
  height: number;
  categories: Uint8Array;
}

export const PORTRAIT_SEGMENTATION_CATEGORY = {
  background: 0,
  hair: 1,
  bodySkin: 2,
  faceSkin: 3,
  clothes: 4,
  others: 5
} as const;

interface WarpControl {
  kind: "translate" | "magnify" | "pinch-x";
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  amount?: number;
  moveX?: number;
  moveY?: number;
}

interface VisionWasmFileset {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
}

const MAX_CACHE_ENTRIES = 12;
const faceCache = new Map<string, Promise<PortraitLandmark[][]>>();
const poseCache = new Map<string, Promise<PortraitLandmark[][]>>();
const segmentationCache = new Map<string, Promise<PortraitSegmentation | undefined>>();
let faceLandmarkerPromise: Promise<import("@mediapipe/tasks-vision").FaceLandmarker> | undefined;
let poseLandmarkerPromise: Promise<import("@mediapipe/tasks-vision").PoseLandmarker> | undefined;
let imageSegmenterPromise: Promise<import("@mediapipe/tasks-vision").ImageSegmenter | undefined> | undefined;
let visionFilesetPromise: Promise<VisionWasmFileset> | undefined;
let imageSegmenterUnavailable = false;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const publicAssetUrl = (path: string) => {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}${path.replace(/^\/+/, "")}`;
};

const getVisionFileset = async () => {
  if (!visionFilesetPromise) {
    visionFilesetPromise = Promise.resolve({
      wasmLoaderPath: publicAssetUrl("mediapipe/wasm/vision_wasm_internal.js"),
      wasmBinaryPath: publicAssetUrl("mediapipe/wasm/vision_wasm_internal.wasm")
    });
  }
  return visionFilesetPromise;
};

const getFaceLandmarker = async () => {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = Promise.all([import("@mediapipe/tasks-vision"), getVisionFileset()])
      .then(([{ FaceLandmarker }, fileset]) =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: publicAssetUrl("mediapipe/models/face_landmarker.task") },
          runningMode: "IMAGE",
          numFaces: 4,
          minFaceDetectionConfidence: 0.3,
          minFacePresenceConfidence: 0.35,
          minTrackingConfidence: 0.35,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false
        })
      )
      .catch((error) => {
        faceLandmarkerPromise = undefined;
        throw error;
      });
  }
  return faceLandmarkerPromise;
};

const getPoseLandmarker = async () => {
  if (!poseLandmarkerPromise) {
    poseLandmarkerPromise = Promise.all([import("@mediapipe/tasks-vision"), getVisionFileset()])
      .then(([{ PoseLandmarker }, fileset]) =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: publicAssetUrl("mediapipe/models/pose_landmarker_lite.task") },
          runningMode: "IMAGE",
          numPoses: 3,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
          outputSegmentationMasks: false
        })
      )
      .catch((error) => {
        poseLandmarkerPromise = undefined;
        throw error;
      });
  }
  return poseLandmarkerPromise;
};

const getImageSegmenter = async () => {
  if (imageSegmenterUnavailable) return undefined;
  if (!imageSegmenterPromise) {
    imageSegmenterPromise = Promise.all([import("@mediapipe/tasks-vision"), getVisionFileset()])
      .then(([{ ImageSegmenter }, fileset]) =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: publicAssetUrl("mediapipe/models/selfie_multiclass_256x256.tflite") },
          runningMode: "IMAGE",
          outputCategoryMask: true,
          outputConfidenceMasks: false
        })
      )
      .catch(() => {
        imageSegmenterPromise = undefined;
        imageSegmenterUnavailable = true;
        return undefined;
      });
  }
  return imageSegmenterPromise;
};

const trimCache = <Value>(cache: Map<string, Value>) => {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") return;
    cache.delete(oldestKey);
  }
};

const normalizeLandmarks = (landmarks: Array<{ x: number; y: number; visibility?: number }>) =>
  landmarks.map((landmark) => ({
    x: clamp(landmark.x, -0.25, 1.25),
    y: clamp(landmark.y, -0.25, 1.25),
    visibility: landmark.visibility
  }));

const detectFaces = (canvas: HTMLCanvasElement, cacheKey: string) => {
  const cached = faceCache.get(cacheKey);
  if (cached) return cached;
  const pending = getFaceLandmarker()
    .then((landmarker) => landmarker.detect(canvas).faceLandmarks.map(normalizeLandmarks))
    .catch((error) => {
      faceCache.delete(cacheKey);
      throw error;
    });
  faceCache.set(cacheKey, pending);
  trimCache(faceCache);
  return pending;
};

const detectPoses = (canvas: HTMLCanvasElement, cacheKey: string) => {
  const cached = poseCache.get(cacheKey);
  if (cached) return cached;
  const pending = getPoseLandmarker()
    .then((landmarker) => landmarker.detect(canvas).landmarks.map(normalizeLandmarks))
    .catch((error) => {
      poseCache.delete(cacheKey);
      throw error;
    });
  poseCache.set(cacheKey, pending);
  trimCache(poseCache);
  return pending;
};

const detectSegmentation = (canvas: HTMLCanvasElement, cacheKey: string) => {
  const cached = segmentationCache.get(cacheKey);
  if (cached) return cached;
  const pending = getImageSegmenter()
    .then((segmenter) => {
      if (!segmenter) return undefined;
      const result = segmenter.segment(canvas);
      try {
        const mask = result.categoryMask;
        if (!mask) return undefined;
        return {
          width: mask.width,
          height: mask.height,
          categories: new Uint8Array(mask.getAsUint8Array())
        };
      } finally {
        result.close();
      }
    })
    .catch(() => undefined);
  segmentationCache.set(cacheKey, pending);
  trimCache(segmentationCache);
  return pending;
};

export const hasPortraitGeometry = (edits: EditParams) =>
  edits.faceSlimming > 0 || edits.bodySlimming > 0 || edits.eyeEnlargement > 0;

const hasPortraitRetouch = (edits: EditParams) =>
  edits.wrinkleReduction > 0 ||
  edits.skinToneUniformity > 0 ||
  edits.skinSmoothing > 0 ||
  edits.skinTone !== 0 ||
  edits.teethWhitening > 0 ||
  edits.clothingWrinkleReduction > 0 ||
  (edits.makeupStyle !== "none" && edits.makeupStrength > 0);

export const needsPortraitAnalysis = (edits: EditParams) =>
  hasPortraitGeometry(edits) || hasPortraitRetouch(edits);

export const analyzePortrait = async (
  canvas: HTMLCanvasElement,
  edits: EditParams,
  cacheKey: string
): Promise<PortraitAnalysis> => {
  const needsFaces =
    edits.faceSlimming > 0 ||
    edits.eyeEnlargement > 0 ||
    edits.wrinkleReduction > 0 ||
    edits.skinToneUniformity > 0 ||
    edits.skinSmoothing > 0 ||
    edits.skinTone !== 0 ||
    edits.teethWhitening > 0 ||
    (edits.makeupStyle !== "none" && edits.makeupStrength > 0);
  const needsPoses = edits.bodySlimming > 0 || edits.clothingWrinkleReduction > 0;
  const needsSegmentation = hasPortraitRetouch(edits);
  const sizedCacheKey = `${cacheKey}|${canvas.width}x${canvas.height}`;
  const [faces, poses, segmentation] = await Promise.all([
    needsFaces ? detectFaces(canvas, `face:${sizedCacheKey}`) : Promise.resolve([]),
    needsPoses ? detectPoses(canvas, `pose:${sizedCacheKey}`) : Promise.resolve([]),
    needsSegmentation ? detectSegmentation(canvas, `segment:${sizedCacheKey}`) : Promise.resolve(undefined)
  ]);
  return { faces, poses, segmentation };
};

const landmarkPoint = (landmarks: PortraitLandmark[], index: number, width: number, height: number) => {
  const landmark = landmarks[index];
  if (!landmark) return undefined;
  return { x: landmark.x * width, y: landmark.y * height, visibility: landmark.visibility ?? 1 };
};

const distance = (left: { x: number; y: number }, right: { x: number; y: number }) =>
  Math.hypot(left.x - right.x, left.y - right.y);

const buildFaceWarpControls = (analysis: PortraitAnalysis, edits: EditParams, width: number, height: number) => {
  const controls: WarpControl[] = [];
  const slimAmount = clamp(edits.faceSlimming / 100, 0, 1);
  const eyeAmount = clamp(edits.eyeEnlargement / 100, 0, 1);

  analysis.faces.forEach((face) => {
    const leftCheek = landmarkPoint(face, 234, width, height);
    const rightCheek = landmarkPoint(face, 454, width, height);
    if (!leftCheek || !rightCheek) return;
    const faceWidth = distance(leftCheek, rightCheek);
    if (faceWidth < 20) return;
    const nose = landmarkPoint(face, 1, width, height);
    const centerX = nose?.x ?? (leftCheek.x + rightCheek.x) / 2;

    if (slimAmount > 0) {
      [
        { left: 234, right: 454, factor: 0.13 },
        { left: 172, right: 397, factor: 0.17 }
      ].forEach(({ left, right, factor }) => {
        [left, right].forEach((index) => {
          const point = landmarkPoint(face, index, width, height);
          if (!point) return;
          controls.push({
            kind: "translate",
            x: point.x,
            y: point.y,
            radiusX: faceWidth * 0.28,
            radiusY: faceWidth * 0.24,
            moveX: (centerX - point.x) * factor * slimAmount,
            moveY: 0
          });
        });
      });
    }

    if (eyeAmount > 0) {
      [
        [33, 133, 159, 145],
        [362, 263, 386, 374]
      ].forEach(([outer, inner, top, bottom]) => {
        const points = [outer, inner, top, bottom]
          .map((index) => landmarkPoint(face, index, width, height))
          .filter((point): point is NonNullable<typeof point> => Boolean(point));
        if (points.length !== 4) return;
        const center = points.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
        const eyeWidth = distance(points[0], points[1]);
        controls.push({
          kind: "magnify",
          x: center.x,
          y: center.y,
          radiusX: Math.max(faceWidth * 0.105, eyeWidth * 1.28),
          radiusY: Math.max(faceWidth * 0.078, eyeWidth * 0.92),
          amount: eyeAmount * 0.18
        });
      });
    }
  });

  return controls;
};

const buildBodyWarpControls = (analysis: PortraitAnalysis, edits: EditParams, width: number, height: number) => {
  const amount = clamp(edits.bodySlimming / 100, 0, 1);
  if (amount <= 0) return [];
  const controls: WarpControl[] = [];

  analysis.poses.forEach((pose) => {
    const leftShoulder = landmarkPoint(pose, 11, width, height);
    const rightShoulder = landmarkPoint(pose, 12, width, height);
    const leftHip = landmarkPoint(pose, 23, width, height);
    const rightHip = landmarkPoint(pose, 24, width, height);
    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return;
    if ([leftShoulder, rightShoulder, leftHip, rightHip].some((point) => point.visibility < 0.35)) return;

    const shoulderWidth = distance(leftShoulder, rightShoulder);
    const hipWidth = distance(leftHip, rightHip);
    const torsoWidth = Math.max(shoulderWidth, hipWidth);
    const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const hipY = (leftHip.y + rightHip.y) / 2;
    const torsoHeight = Math.abs(hipY - shoulderY);
    if (torsoWidth < 24 || torsoHeight < 24) return;
    const centerX = (leftShoulder.x + rightShoulder.x + leftHip.x + rightHip.x) / 4;
    const top = Math.min(shoulderY, hipY);

    controls.push({
      kind: "pinch-x",
      x: centerX,
      y: top + torsoHeight * 0.46,
      radiusX: torsoWidth * 0.78,
      radiusY: torsoHeight * 0.72,
      amount: amount * 0.14
    });
    controls.push({
      kind: "pinch-x",
      x: centerX,
      y: top + torsoHeight * 0.82,
      radiusX: torsoWidth * 0.68,
      radiusY: torsoHeight * 0.58,
      amount: amount * 0.12
    });
  });

  return controls;
};

const sampleBilinear = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  sourceX: number,
  sourceY: number,
  target: Uint8ClampedArray,
  targetIndex: number
) => {
  const x = clamp(sourceX, 0, width - 1);
  const y = clamp(sourceY, 0, height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const topLeft = (y0 * width + x0) * 4;
  const topRight = (y0 * width + x1) * 4;
  const bottomLeft = (y1 * width + x0) * 4;
  const bottomRight = (y1 * width + x1) * 4;

  for (let channel = 0; channel < 4; channel += 1) {
    const top = source[topLeft + channel] * (1 - tx) + source[topRight + channel] * tx;
    const bottom = source[bottomLeft + channel] * (1 - tx) + source[bottomRight + channel] * tx;
    target[targetIndex + channel] = top * (1 - ty) + bottom * ty;
  }
};

export const applyPortraitGeometry = (imageData: ImageData, edits: EditParams, analysis: PortraitAnalysis) => {
  const { width, height, data } = imageData;
  const controls = [
    ...buildFaceWarpControls(analysis, edits, width, height),
    ...buildBodyWarpControls(analysis, edits, width, height)
  ];
  if (controls.length === 0) return imageData;

  const source = new Uint8ClampedArray(data);
  const output = new Uint8ClampedArray(source);
  const minX = Math.max(0, Math.floor(Math.min(...controls.map((control) => control.x - control.radiusX))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...controls.map((control) => control.x + control.radiusX))));
  const minY = Math.max(0, Math.floor(Math.min(...controls.map((control) => control.y - control.radiusY))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...controls.map((control) => control.y + control.radiusY))));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let sourceX = x;
      let sourceY = y;
      let affected = false;

      controls.forEach((control) => {
        const deltaX = x - control.x;
        const deltaY = y - control.y;
        const distanceSquared = (deltaX * deltaX) / (control.radiusX * control.radiusX) + (deltaY * deltaY) / (control.radiusY * control.radiusY);
        if (distanceSquared >= 1) return;
        const weight = (1 - distanceSquared) * (1 - distanceSquared);
        affected = true;
        if (control.kind === "translate") {
          sourceX -= (control.moveX ?? 0) * weight;
          sourceY -= (control.moveY ?? 0) * weight;
        } else if (control.kind === "magnify") {
          sourceX -= deltaX * (control.amount ?? 0) * weight;
          sourceY -= deltaY * (control.amount ?? 0) * weight;
        } else {
          sourceX += deltaX * (control.amount ?? 0) * weight;
        }
      });

      if (affected) sampleBilinear(source, width, height, sourceX, sourceY, output, (y * width + x) * 4);
    }
  }

  data.set(output);
  return imageData;
};

export const clearPortraitAnalysisCache = () => {
  faceCache.clear();
  poseCache.clear();
  segmentationCache.clear();
};
