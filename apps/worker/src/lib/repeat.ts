/** Runs a job now and every `everyMs`, never overlapping itself. */
export type Repeat = (everyMs: number, job: () => Promise<void>) => void;

/** The worker's own `Repeat`: a job's failure is logged, and the next run goes on as usual. */
export const repeatForever: Repeat = (everyMs, job) => {
  let busy = false;
  const once = async () => {
    if (busy) return;
    busy = true;
    try {
      await job();
    } catch (error) {
      console.error(error);
    } finally {
      busy = false;
    }
  };
  void once();
  // Never keeps the process alive on its own.
  setInterval(() => void once(), everyMs).unref();
};
