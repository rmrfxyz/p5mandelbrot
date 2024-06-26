import { setRefOrbitCache } from "../ref-orbit-cache";
import { completeJob } from "../task-queue";
import {
  RefOrbitTerminatedCallback,
  RefOrbitProgressCallback,
  RefOrbitResultCallback,
} from "../worker-facade";
import { getBatchContext } from "../worker-pool";
import { removeWorkerReference } from "../worker-reference";

export const onRefOrbitWorkerTerminated: RefOrbitTerminatedCallback = (job) => {
  // ここで何をする予定だったんだっけ...
  // What was I going to do here...
  // terminateされているということは外部からcancelされており、後始末はそっちで行われるはず
  // Being terminated means that it has been canceled from the outside, and the cleanup should be done there
};

export const onRefOrbitWorkerProgress: RefOrbitProgressCallback = (
  { progress },
  job,
) => {
  const batchContext = getBatchContext(job.batchId);

  // 停止が間に合わなかったケースや既にcancelされているケース。何もしない
  // Cases where the stop was not in time or already canceled. Do nothing
  if (batchContext == null) {
    return;
  }

  batchContext.refProgress = progress;
};

export const onRefOrbitWorkerResult: RefOrbitResultCallback = (result, job) => {
  const { xn, blaTable, elapsed } = result;
  const batchContext = getBatchContext(job.batchId);

  // 停止が間に合わなかったケースや既にcancelされているケース。何もしない
  // Cases where the stop was not in time or already canceled. Do nothing
  if (batchContext == null) {
    return;
  }

  batchContext.refProgress = batchContext.mandelbrotParams.N;

  batchContext.xn = xn;
  batchContext.blaTable = blaTable;
  batchContext.spans.push({
    name: "reference_orbit",
    elapsed: Math.floor(elapsed),
  });

  // cacheに登録
  // Register in cache
  setRefOrbitCache({
    x: batchContext.mandelbrotParams.x,
    y: batchContext.mandelbrotParams.y,
    r: batchContext.mandelbrotParams.r,
    N: batchContext.mandelbrotParams.N,
    xn,
    blaTable,
  });

  completeJob(job);
  removeWorkerReference(job.id);
};
