import { BigNumber } from "bignumber.js";
import { Rect } from "./rect";
import { Complex } from "./math";

export interface WorkerResult {
  type: "result";
  iterations: ArrayBuffer;
}

export interface WorkerProgress {
  type: "progress";
  progress: number;
}

export interface ReferencePointResult {
  type: "result";
  xn: Complex[];
  xn2: Complex[];
  glitchChecker: number[];
}

export interface OffsetParams {
  x: number;
  y: number;
}

export interface MandelbrotParams {
  x: BigNumber;
  y: BigNumber;
  r: BigNumber;
  N: number;
  mode: MandelbrotWorkerType;
}

export interface MandelbrotCalculationWorkerParams {
  pixelHeight: number;
  pixelWidth: number;
  cx: string;
  cy: string;
  r: string;
  N: number;
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  xn: Complex[];
  xn2: Complex[];
  glitchChecker: number[];
}

export interface ReferencePointCalculationWorkerParams {
  complexCenterX: string;
  complexCenterY: string;
  pixelWidth: number;
  pixelHeight: number;
  complexRadius: string;
  maxIteration: number;
}

export const mandelbrotWorkerTypes = [
  "normal",
  "doublejs",
  "perturbation",
] as const;
export type MandelbrotWorkerType = (typeof mandelbrotWorkerTypes)[number];

export interface IterationBuffer {
  rect: Rect;
  buffer: Uint32Array;
}
