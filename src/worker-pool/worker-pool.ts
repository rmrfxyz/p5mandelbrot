import {
  BatchContext,
  CalcIterationJob,
  CalcReferencePointJob,
  JobType,
  MandelbrotJob,
  MandelbrotRenderingUnit,
  MandelbrotWorkerType,
  WorkerIntermediateResult,
  mandelbrotWorkerTypes,
} from "@/types";
import {
  WorkerProgressCallback,
  WorkerResultCallback,
  CalcIterationWorker,
  MandelbrotFacadeLike,
  CalcReferencePointWorker,
  RefPointResultCallback,
} from "./worker-facade";
import { upsertIterationCache } from "@/aggregator";
import { renderToResultBuffer } from "@/camera";
import { getStore, updateStore } from "@/store/store";
import {
  findFreeWorkerIndex,
  getWorkerPool,
  resetWorkerPool,
} from "./pool-instance";

let waitingList: MandelbrotJob[] = [];
let runningList: MandelbrotJob[] = [];

const getWaitingList = (jobType: JobType) =>
  waitingList.filter((job) => job.type === jobType);
const getWaitingListFiltered = (
  jobType: JobType,
  predicate: (job: CalcIterationJob) => boolean,
) =>
  waitingList.filter(
    (job) => job.type === jobType && predicate(job as CalcIterationJob),
  );
const getRunningList = (jobType: JobType) =>
  runningList.filter((job) => job.type === jobType);
const popWaitingList = (jobType: JobType) => {
  const job = waitingList.find((job) => job.type === jobType);
  if (job) {
    waitingList = waitingList.filter((j) => j.id !== job.id);
  }
  return job;
};
const popWaitingListFiltered = (
  jobType: JobType,
  predicate: (job: CalcIterationJob) => boolean,
) => {
  const job = waitingList.find(
    (job) => job.type === jobType && predicate(job as CalcIterationJob),
  );
  if (job) {
    waitingList = waitingList.filter((j) => j.id !== job.id);
  }
  return job;
};

type JobId = string;
type BatchId = string;

const runningWorkerFacadeMap = new Map<JobId, MandelbrotFacadeLike>();
const batchContextMap = new Map<BatchId, BatchContext>();
const acceptingBatchIds = new Set<BatchId>();

const getLatestBatchContext = () => {
  if (batchContextMap.size === 0) return null;

  const batchIds = Array.from(batchContextMap.keys());
  let batchContext = batchContextMap.get(batchIds[0])!;

  for (const batchId of batchIds) {
    const next = batchContextMap.get(batchId)!;
    if (batchContext.startedAt < next.startedAt) {
      batchContext = next;
    }
  }

  return batchContext;
};

export const getProgressString = () => {
  const batchContext = getLatestBatchContext();

  if (!batchContext) {
    if (acceptingBatchIds.size > 0) {
      // FIXME: 超手抜き、Reference Orbitの計算もbatchの中に入れるべき
      return "Calculating Reference Orbit...";
    }
    return "";
  }

  if (batchContext.finishedAt) {
    return `Done! (${Math.floor(
      batchContext.finishedAt - batchContext.startedAt,
    )}ms)`;
  }

  const { progressMap } = batchContext;
  const progressList = Array.from(progressMap.values());
  const progress =
    progressList.reduce((a, b) => a + b, 0) / progressList.length;

  return `Generating... ${Math.floor(progress * 100)}%`;
};

const onCalcIterationWorkerProgress: WorkerProgressCallback = (result, job) => {
  const { progress } = result;
  const batchContext = batchContextMap.get(job.batchId);

  // 停止が間に合わなかったケースや既にcancelされているケース。何もしない
  if (batchContext == null) {
    return;
  }

  batchContext.progressMap.set(job.id, progress);
};

const onCalcReferencePointWorkerTerminated = (job: CalcReferencePointJob) => {
  // ここで何をする予定だったんだっけ...
  // terminateされているということは外部からcancelされており、後始末はそっちで行われるはず
};

const onCalcReferencePointWorkerResult: RefPointResultCallback = (
  result,
  job,
) => {
  const { xn, blaTable } = result;
  const batchContext = batchContextMap.get(job.batchId);

  // 停止が間に合わなかったケースや既にcancelされているケース。何もしない
  if (batchContext == null) {
    return;
  }

  batchContext.xn = xn;
  batchContext.blaTable = blaTable;

  runningList = runningList.filter((j) => j.id !== job.id);
  runningWorkerFacadeMap.delete(job.id);

  tick(job.id);
};

const onCalcIterationWorkerResult: WorkerResultCallback = (result, job) => {
  const { iterations } = result;
  const { rect } = job;
  const batchContext = batchContextMap.get(job.batchId);

  // 停止が間に合わなかったケースや既にcancelされているケース。何もしない
  if (batchContext == null) {
    return;
  }

  const iterationsResult = new Uint32Array(iterations);
  upsertIterationCache(rect, iterationsResult, {
    width: rect.width,
    height: rect.height,
  });

  // jobを完了させる
  batchContext.progressMap.set(job.id, 1.0);

  runningList = runningList.filter((j) => j.id !== job.id);
  runningWorkerFacadeMap.delete(job.id);

  renderToResultBuffer(rect);

  // バッチが完了していたらcallbackを呼び、BatchContextを削除する
  const waitingJobInSameBatch = waitingList.find(
    (j) => j.batchId === job.batchId,
  );

  if (runningList.length === 0 && waitingJobInSameBatch == null) {
    const finishedAt = performance.now();
    batchContext.finishedAt = finishedAt;
    const elapsed = finishedAt - batchContext.startedAt;

    batchContext.onComplete(elapsed);
  }

  tick();
};

const onCalcIterationWorkerIntermediateResult = (
  result: WorkerIntermediateResult,
  job: CalcIterationJob,
) => {
  const { iterations, resolution } = result;
  const { rect } = job;

  // 停止が間に合わなかったケース。何もしない
  if (!batchContextMap.has(job.batchId)) {
    return;
  }

  upsertIterationCache(rect, new Uint32Array(iterations), resolution);
  renderToResultBuffer(rect);
};

export const getWorkerCount = (jobType: JobType): number => {
  return getWorkerPool(jobType).length;
};

export const cycleWorkerType = (): MandelbrotWorkerType => {
  const currentMode = getStore("mode");

  const currentIndex = mandelbrotWorkerTypes.findIndex(
    (v) => v === currentMode,
  );

  const nextMode =
    mandelbrotWorkerTypes[(currentIndex + 1) % mandelbrotWorkerTypes.length];

  return nextMode;
};

/**
 * 指定した数になるまでWorkerPoolを埋める
 */
function fillCalcIterationWorkerPool(
  upTo: number = getStore("workerCount"),
  workerType: MandelbrotWorkerType = getStore("mode"),
) {
  let fillCount = 0;
  const pool = getWorkerPool("calc-iteration");

  for (let i = 0; pool.length < upTo && i < upTo; i++) {
    const workerFacade = new CalcIterationWorker(workerType);

    workerFacade.onResult(onCalcIterationWorkerResult);
    workerFacade.onIntermediateResult(onCalcIterationWorkerIntermediateResult);
    workerFacade.onProgress(onCalcIterationWorkerProgress);

    pool.push(workerFacade);

    fillCount++;
  }

  if (fillCount > 0) {
    console.info(
      `Iteration Worker filled: fill count = ${fillCount}, pool size = ${pool.length}`,
    );
  }
}

function fillCalcReferencePointWorkerPool(
  upTo: number = 1,
  workerType: MandelbrotWorkerType = getStore("mode"),
) {
  if (workerType !== "perturbation") return;

  let fillCount = 0;
  const pool = getWorkerPool("calc-reference-point");

  for (let i = 0; pool.length < upTo && i < upTo; i++) {
    const worker = new CalcReferencePointWorker();

    worker.init();
    worker.onResult(onCalcReferencePointWorkerResult);
    worker.onTerminate(onCalcReferencePointWorkerTerminated);
    // workerFacade.onProgress(onWorkerProgress);

    pool.push(worker);

    fillCount++;
  }

  if (fillCount > 0) {
    console.info(
      `RefPoint Worker filled: fill count = ${fillCount}, pool size = ${pool.length}`,
    );
  }
}

/**
 * WorkerPoolを再構築する
 * countやworkerTypeが変わった場合に呼ばれる
 */
export function prepareWorkerPool(
  count: number = getStore("workerCount"),
  workerType: MandelbrotWorkerType = getStore("mode"),
) {
  console.log(`prepareWorkerPool: ${count}, ${workerType}`);

  updateStore("mode", workerType);

  resetWorkers();

  fillCalcIterationWorkerPool(count, workerType);
  fillCalcReferencePointWorkerPool(1 /* 仮 */, workerType);
}

/**
 * WorkerPoolを溜まっていたJobごと全部リセットする
 */
export function resetWorkers() {
  getWorkerPool("calc-iteration").forEach((workerFacade) => {
    workerFacade.clearCallbacks();
    workerFacade.terminate();
  });
  resetWorkerPool("calc-iteration");

  // どうしてこうなった
  getWorkerPool("calc-reference-point").forEach((workerFacade) => {
    workerFacade.clearCallbacks();
    workerFacade.terminate();
  });
  resetWorkerPool("calc-reference-point");

  // queueに溜まってるJobも全部消す
  runningList = [];
  waitingList = [];

  runningWorkerFacadeMap.clear();
  batchContextMap.clear();
}

export function registerBatch(
  batchId: BatchId,
  units: MandelbrotRenderingUnit[],
  batchContext: Omit<BatchContext, "progressMap" | "startedAt">,
) {
  console.log("registerBatch", batchId, units.length);

  if (!acceptingBatchIds.has(batchId)) {
    console.log("Denied: already cancelled. batchId =", batchId);
    return;
  }

  const progressMap = new Map<string, number>();

  const refPointJobId = crypto.randomUUID();
  waitingList.push({
    type: "calc-reference-point",
    id: refPointJobId,
    batchId,
    // FIXME: どのunitsも同じなので先頭を取っている、これbatchContextが持つべきものなのでは...？
    mandelbrotParams: units[0].mandelbrotParams,
  } satisfies CalcReferencePointJob);

  for (const unit of units) {
    const job = {
      type: "calc-iteration",
      ...unit,
      id: crypto.randomUUID(),
      requiredJobIds: [refPointJobId],
      batchId,
    } satisfies CalcIterationJob;

    waitingList.push(job);
    progressMap.set(job.id, 0);
  }

  batchContextMap.set(batchId, {
    ...batchContext,
    progressMap,
    startedAt: performance.now(),
  });

  tick();
}

function tick(doneJobId: JobId | null = null) {
  const hasWaitingJob = waitingList.length > 0;

  const refPool = getWorkerPool("calc-reference-point");
  if (refPool.some((worker) => !worker.isReady() || worker.isRunning())) {
    // まだ準備ができていないworkerがいる場合は待つ
    setTimeout(tick, 100);
    return;
  }

  // reference point jobがある場合はpoolに空きがある限り処理を開始する
  while (
    getRunningList("calc-reference-point").length < refPool.length &&
    getWaitingList("calc-reference-point").length > 0
  ) {
    const job = popWaitingList("calc-reference-point")!;
    const workerIdx = findFreeWorkerIndex("calc-reference-point");

    if (!refPool[workerIdx]) break;

    start(workerIdx, job);
  }

  // 空のときはperturbationではないのでwaitingListから取り出し、doneJobIdに上書き
  // FIXME: なんかもうちょっとどうにかしてね
  if (refPool.length === 0) {
    const refJob = popWaitingList("calc-reference-point");
    if (!refJob) return;
    doneJobId = refJob.id;
  }

  // doneJobIdが渡された場合は、それをrequiresとするjobをwaitingListから取り出して処理を開始
  if (doneJobId) {
    const iterPool = getWorkerPool("calc-iteration");
    const filter = (job: CalcIterationJob) =>
      job.requiredJobIds.includes(doneJobId);

    while (
      getRunningList("calc-iteration").length < iterPool.length &&
      getWaitingListFiltered("calc-iteration", filter).length > 0
    ) {
      const job = popWaitingListFiltered("calc-iteration", filter)!;
      const workerIdx = findFreeWorkerIndex("calc-iteration");

      if (!iterPool[workerIdx]) break;

      start(workerIdx, job);
    }
  }

  if (hasWaitingJob || runningList.length === 0) {
    console.debug(
      `running: ${runningList.length}, waiting: ${waitingList.length}`,
    );
  }
}

function start(workerIdx: number, job: MandelbrotJob) {
  const batchContext = batchContextMap.get(job.batchId)!;

  switch (job.type) {
    // どうしてこうなった
    case "calc-iteration": {
      const workerFacade = getWorkerPool(job.type)[workerIdx];
      workerFacade.startCalculate(job, batchContext, workerIdx);

      runningList.push({ ...job, workerIdx });
      runningWorkerFacadeMap.set(job.id, workerFacade);
      break;
    }
    case "calc-reference-point": {
      const workerFacade = getWorkerPool(job.type)[workerIdx];
      // calc-iterationのworkerIdxと被らないように
      const refWorkerIdx = getWorkerPool("calc-iteration").length + workerIdx;
      workerFacade.startCalculate(job, batchContext, refWorkerIdx);

      runningList.push({ ...job, workerIdx: refWorkerIdx });
      runningWorkerFacadeMap.set(job.id, workerFacade);
      break;
    }
  }
}

export function startBatch(batchId: BatchId) {
  acceptingBatchIds.add(batchId);
}

/**
 * 指定したバッチIDのジョブをキャンセルする
 */
export function cancelBatch(batchId: string) {
  acceptingBatchIds.delete(batchId);

  // 待ちリストからは単純に削除
  waitingList = waitingList.filter((job) => job.batchId !== batchId);

  const runningJobs = runningList.filter((job) => job.batchId === batchId);

  console.log("cancelBatch", { batchId, runningJobs, runningList });

  const batchContext = batchContextMap.get(batchId)!;

  runningJobs.forEach((job) => {
    const facade = runningWorkerFacadeMap.get(job.id);
    runningWorkerFacadeMap.delete(job.id);

    if (facade == null) return;

    facade.cancel(batchContext, job);
  });

  batchContext?.onComplete(0);

  runningList = runningList.filter((job) => job.batchId !== batchId);
  batchContextMap.delete(batchId);

  tick();
}
