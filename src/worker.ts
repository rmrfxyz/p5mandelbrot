/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

export {};

type Parameter = {
  row: number;
  col: number;
  xmin: number;
  ymax: number;
  dpp: number;
  R2: number;
  N: number;
  start: number;
  end: number;
};

self.addEventListener("message", (event) => {
  const { col, xmin, ymax, dpp, R2, N, start, end } = event.data as Parameter;

  const iterations = new Uint32Array((end - start) * col);
  const pixels = new Uint8ClampedArray((end - start) * col * 4);

  for (let i = start; i < end; i++) {
    for (let j = 0; j < col; j++) {
      let zr = 0.0;
      let zi = 0.0;
      const cr = xmin + dpp * j;
      const ci = ymax - dpp * i;

      let n = 0;
      let zr2 = 0.0;
      let zi2 = 0.0;
      while (zr2 + zi2 <= R2 && n < N) {
        zi = (zr + zr) * zi + ci;
        zr = zr2 - zi2 + cr;
        zr2 = zr * zr;
        zi2 = zi * zi;

        n++;
      }

      const index = j + (i - start) * col;
      iterations[index] = n;

      const indexForPixels = index * 4;
      // FIXME: add color
      const a = (n / N) * 255;
      pixels[indexForPixels + 0] = a;
      pixels[indexForPixels + 1] = a;
      pixels[indexForPixels + 2] = a;
      pixels[indexForPixels + 3] = 255;
    }
  }

  self.postMessage([pixels, iterations], [pixels.buffer, iterations.buffer]);
});
