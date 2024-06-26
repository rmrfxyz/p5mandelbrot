import { MandelbrotJob, JobType } from "@/types";
import { MandelbrotFacadeLike } from "./worker-facade";

let waitingList: MandelbrotJob[] = [];
let runningList: MandelbrotJob[] = [];

const doneJobIds = new Set<string>();

const executableJobFilter = (job: MandelbrotJob) =>
  job.requiredJobIds.length === 0 ||
  job.requiredJobIds.every((id) => doneJobIds.has(id));

/**
 * jobTypeに対応する実行待ちのJobを返す
 * Returns a pending Job that corresponds to the jobType.
 * 追加の条件も与えられる
 * Additional conditions may also be given
 */
export const getWaitingJobs = (
  jobType?: JobType,
  predicate: (job: MandelbrotJob) => boolean = () => true,
) =>
  jobType == null
    ? waitingList
    : waitingList.filter((job) => job.type === jobType && predicate(job));

/**
 * jobTypeに対応する実行中のJobを返す
 * Returns the running Job corresponding to the jobType.
 * 追加の条件も与えられる
 * Additional conditions may also be given
 */
export const getRunningJobs = (
  jobType?: JobType,
  predicate: (job: MandelbrotJob) => boolean = () => true,
) =>
  jobType == null
    ? runningList
    : runningList.filter((job) => job.type === jobType && predicate(job));

/**
 * 指定したbatchIdを持つ実行待ちのJobを返す
 * Returns the Job waiting for the specified batchId.
 */
export const getWaitingJobsInBatch = (batchId: string) => {
  return waitingList.filter((job) => job.batchId === batchId);
};

/**
 * 指定したbatchIdを持つ実行中のJobを返す
 * Returns the Job in progress with the specified batchId.
 */
export const getRunningJobsInBatch = (batchId: string) => {
  return runningList.filter((job) => job.batchId === batchId);
};

/**
 * 指定したbatchIdを持つ実行待ちのJobが存在するかどうかを返す
 * Returns whether there is a Job waiting with the specified batchId.
 */
export const isWaitingJobExists = (batchId: string) => {
  return waitingList.some((job) => job.batchId === batchId);
};

/**
 * 指定したbatchIdのJobが全て実行完了しているかどうかを返す
 * Returns whether all Jobs with the specified batchId have been completed.
 *
 * runningListが空で、実行待ちがいなければ完了している
 * If runningList is empty and there are no jobs waiting, it is complete.
 * FIXME: runningListもbatchIdを見なければならないのでは？
 * FIXME: Shouldn't the runningList also look at the batchId?
 */
export const isBatchCompleted = (batchId: string) =>
  isRunningListEmpty() && !isWaitingJobExists(batchId);

export const isRunningListEmpty = () => runningList.length === 0;

export const countRunningJobs = () => runningList.length;
export const countWaitingJobs = () => waitingList.length;

export const hasWaitingJob = () => waitingList.length > 0;
export const hasRunningJob = () => runningList.length > 0;

/**
 * 指定したjobTypeのJobをqueueに積める余地があるかどうかを返す
 * Returns whether there is room in the queue to stack Jobs of the specified jobType.
 */
export const canQueueJob = <T>(jobType: JobType, pool: T[]) => {
  const hasFreeWorker = getRunningJobs(jobType).length < pool.length;

  const waitingJobs = getWaitingJobs(jobType, executableJobFilter);
  return hasFreeWorker && waitingJobs.length > 0;
};

/**
 * 待ちリストにJobを追加する
 * Add a Job to the waiting list.
 */
export const addJob = (job: MandelbrotJob) => {
  waitingList.push(job);
};

/**
 * 実行中リストにJobを追加する
 * Add a Job to the running list.
 */
export const startJob = (job: MandelbrotJob) => {
  runningList.push(job);
};

/**
 * jobTypeに対応する実行可能なJobを取り出す
 * Get an executable Job corresponding to jobType.
 *
 * 実行可能とは、requiredJobIdsが空か、全て完了していることを指す
 * Executable means that requiredJobIds is empty or all are complete.
 */
export const popWaitingExecutableJob = (jobType: JobType) => {
  const job = waitingList.find(
    (job) => job.type === jobType && executableJobFilter(job),
  );
  if (job) {
    waitingList = waitingList.filter((j) => j.id !== job.id);
  }
  return job;
};

/**
 * jobをdoneとしてマークし、実行中リストから削除する
 * Mark the job as done and remove it from the running list.
 */
export const completeJob = (job: MandelbrotJob) => {
  markDoneJob(job.id);
  runningList = runningList.filter((j) => j.id !== job.id);
};

/**
 * jobをdoneとしてマークする
 * Mark the job as done.
 * マークされると、このjobIdがrequiredJobIdsに含まれているjobが実行可能になる
 * When marked, the job with this jobId in requiredJobIds becomes executable.
 */
export const markDoneJob = (jobId: string) => {
  doneJobIds.add(jobId);
};

/**
 * 役目を終えたdoneJobIdを削除する
 * Delete the doneJobId that has served its purpose.
 */
export const deleteCompletedDoneJobs = () => {
  const remainingRequiredJobIds = new Set(
    ...getWaitingJobs().map((job) => job.requiredJobIds ?? []),
  );
  Array.from(doneJobIds.values()).forEach((id) => {
    if (remainingRequiredJobIds.has(id)) return;

    doneJobIds.delete(id);
  });
};

/**
 * 実行待ちリストから指定したbatchIdのJobを削除する
 * Remove the Job with the specified batchId from the waiting list.
 */
export const removeBatchFromWaitingJobs = (batchId: string) => {
  waitingList = waitingList.filter((job) => job.batchId !== batchId);
};

/**
 * 実行中リストから指定したbatchIdのJobを削除する
 * Remove the Job with the specified batchId from the running list.
 */
export const removeBatchFromRunningJobs = (batchId: string) => {
  runningList = runningList.filter((job) => job.batchId !== batchId);
};

/**
 * 実行待ちリストをクリアする
 * Clear the waiting list.
 */
export const clearTaskQueue = () => {
  waitingList = [];
  runningList = [];
};
