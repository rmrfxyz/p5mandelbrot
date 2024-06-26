import { JobType, MandelbrotWorkerType } from "@/types";
import {
  CalcIterationWorker,
  RefOrbitWorker,
  MandelbrotFacadeLike,
} from "./worker-facade";
import { getStore, updateStore } from "@/store/store";
import { clearTaskQueue } from "./task-queue";
import { clearWorkerReference } from "./worker-reference";
import {
  onIterationWorkerResult,
  onIterationWorkerIntermediateResult,
  onIterationWorkerProgress,
} from "./callbacks/iteration-worker";
import {
  onRefOrbitWorkerResult,
  onRefOrbitWorkerTerminated,
  onRefOrbitWorkerProgress,
} from "./callbacks/ref-orbit-worker";
import { clearBatchContext, tickWorkerPool } from "./worker-pool";

type WorkerPool = MandelbrotFacadeLike[];

const pool: Map<JobType, WorkerPool> = new Map([
  ["calc-iteration", []],
  ["calc-ref-orbit", []],
]);

export const getWorkerPool = <T extends JobType>(jobType: T): WorkerPool =>
  pool.get(jobType)! as WorkerPool;
export const resetWorkerPool = (jobType: JobType) => pool.set(jobType, []);

/**
 * workerの数を返す
 * jobTypeが指定されていない場合は全workerが対象
 * Returns the number of workers
 * If jobType is not specified, all workers are targeted
*/
export const getWorkerCount = (jobType?: JobType) =>
  jobType == null
    ? [...pool.values()].reduce((acc, workers) => acc + workers.length, 0)
    : getWorkerPool(jobType).length;

/**
 * 全workerに対して処理を行う
 * Perform processing on all workers
 */
export const iterateAllWorker = <T>(f: (worker: MandelbrotFacadeLike) => T) => {
  for (const workers of pool.values()) {
    workers.forEach(f);
  }
};

/**
 * 全workerをリセットする
  * Reset all workers
 */
export const resetAllWorker = () => {
  [...pool.keys()].forEach(resetWorkerPool);
};

/**
 * 空いてるworkerがあればそのindexを返す
 * Returns the index of the worker if there is a free worker
 */
export function findFreeWorkerIndex(jobType: JobType) {
  return getWorkerPool(jobType).findIndex(
    (worker) => worker.isReady() && !worker.isRunning(),
  );
}

/**
 * terminate判定用のworker indexを返す
 * Returns the worker index for the terminate judgment
 * 返り値は0 ~ 各workerの合計数 - 1の範囲になる
 * The return value will be in the range of 0 to the total number of each worker
 */
export const calcNormalizedWorkerIndex = (
  jobType: JobType,
  workerIdx: number,
) => {
  // FIXME: jobTypeが増えたときに対応できていない
  // FIXME: Not compatible with the increase in jobType
  if (jobType === "calc-ref-orbit") {
    const pool = getWorkerPool("calc-iteration");
    return pool.length + workerIdx;
  }

  return workerIdx;
};

/**
 * WorkerPoolを再構築する
 * Rebuild WorkerPool
 * countやworkerTypeが変わった場合に呼ばれる
 * Called when count or workerType changes
 */
export function prepareWorkerPool(
  count: number = getStore("workerCount"),
  workerType: MandelbrotWorkerType = getStore("mode"),
) {
  console.debug(`prepareWorkerPool: ${count}, ${workerType}`);

  updateStore("mode", workerType);
  if (workerType === "normal") {
    updateStore("shouldReuseRefOrbit", false);
  }

  resetWorkers();

  fillIterationWorkerPool(count, workerType);
  fillRefOrbitWorkerPool(1 /* 仮 tentative */, workerType);
}

/**
 * WorkerPoolを溜まっていたJobごと全部リセットする
 * Reset all jobs that have accumulated in the WorkerPool
 */
export function resetWorkers() {
  iterateAllWorker((workerFacade) => {
    workerFacade.clearCallbacks();
    workerFacade.terminate();
  });
  resetAllWorker();

  clearTaskQueue();
  clearWorkerReference();
  clearBatchContext();
}

/**
 * 指定した数になるまでWorkerPoolを埋める
 * Fill the WorkerPool until the specified number is reached
 */
function fillIterationWorkerPool(
  upTo: number = getStore("workerCount"),
  workerType: MandelbrotWorkerType = getStore("mode"),
) {
  let fillCount = 0;
  const pool = getWorkerPool("calc-iteration");

  for (let i = 0; pool.length < upTo && i < upTo; i++) {
    const workerFacade = new CalcIterationWorker(workerType);

    workerFacade.onResult((...args) => {
      onIterationWorkerResult(...args);
      tickWorkerPool();
    });
    workerFacade.onIntermediateResult(onIterationWorkerIntermediateResult);
    workerFacade.onProgress(onIterationWorkerProgress);

    pool.push(workerFacade);

    fillCount++;
  }

  if (fillCount > 0) {
    console.info(
      `Iteration Worker filled: fill count = ${fillCount}, pool size = ${pool.length}`,
    );
  }
}

function fillRefOrbitWorkerPool(
  upTo: number = 1,
  workerType: MandelbrotWorkerType = getStore("mode"),
) {
  if (workerType !== "perturbation") return;

  let fillCount = 0;
  const pool = getWorkerPool("calc-ref-orbit");

  for (let i = 0; pool.length < upTo && i < upTo; i++) {
    const worker = new RefOrbitWorker();

    worker.init();

    worker.onResult((...args) => {
      onRefOrbitWorkerResult(...args);
      tickWorkerPool();
    });
    worker.onTerminate(onRefOrbitWorkerTerminated);
    worker.onProgress(onRefOrbitWorkerProgress);

    pool.push(worker);

    fillCount++;
  }

  if (fillCount > 0) {
    console.info(
      `RefOrbit Worker filled: fill count = ${fillCount}, pool size = ${pool.length}`,
    );
  }
}
