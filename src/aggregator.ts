import { bufferLocalLogicalIndex } from "./rendering";
import { Rect } from "./rect";
import { IterationBuffer, Resolution } from "./types";

// FIXME: たぶんIterationBufferは複素数平面座標に対するキャッシュを持つべき
// それならrがどうであれ使い回せるはず
// 一方でちゃんとピクセル座標と誤差なく対応させられるかわからない
// BigNumberだし比較重いかも
// FIXME: Maybe IterationBuffer should have a cache for complex plane coordinates
// In that case, it should be possible to reuse it regardless of r
// On the other hand, I don't know if it can properly correspond to pixel coordinates without error
// It's a BigNumber, so it might be comparatively heavy

// FIXME: もっと賢くデータを持つ
// FIXME: Be smarter with your data
let iterationCache: IterationBuffer[] = [];

export const upsertIterationCache = (
  rect: Rect,
  buffer: Uint32Array,
  resolution: Resolution,
): void => {
  const idx = iterationCache.findIndex(
    (i) => i.rect.x === rect.x && i.rect.y === rect.y,
  );

  if (idx !== -1) {
    const old = iterationCache[idx];
    if (
      old.resolution.width * old.resolution.height <
      resolution.width * resolution.height
    ) {
      // 解像度が大きい方を採用
      // Use the larger resolution
      iterationCache[idx] = { rect, buffer, resolution };
    }
  } else {
    iterationCache.push({ rect, buffer, resolution });
  }
};

export const getIterationCache = (): IterationBuffer[] => {
  return iterationCache;
};

export const clearIterationCache = (): void => {
  iterationCache = [];
};

/**
 * マウスXY座標の位置のiteration回数を取得する
 * Get the number of iterations for the mouse XY coordinate position
*/
export const getIterationTimeAt = (worldX: number, worldY: number) => {
  for (const iteration of iterationCache) {
    if (
      worldX < iteration.rect.x ||
      iteration.rect.x + iteration.rect.width < worldX
    )
      continue;
    if (
      worldY < iteration.rect.y ||
      iteration.rect.y + iteration.rect.height < worldY
    )
      continue;
    const idx = bufferLocalLogicalIndex(
      Math.floor(worldX),
      Math.floor(worldY),
      iteration.rect,
      iteration.resolution,
    );

    return iteration.buffer[idx];
  }
  return -1;
};

export const translateRectInIterationCache = (
  offsetX: number,
  offsetY: number,
): void => {
  iterationCache = iterationCache.map((iteration) => {
    return {
      rect: {
        x: iteration.rect.x - offsetX,
        y: iteration.rect.y - offsetY,
        width: iteration.rect.width,
        height: iteration.rect.height,
      },
      buffer: iteration.buffer,
      resolution: iteration.resolution,
    };
  });
};
