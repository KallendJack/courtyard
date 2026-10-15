/**
 * A queue for changes that mustn't cross, such as two requests each reading a file before the other
 * writes it: each change given to it starts once the one before has finished, however that ended.
 */
export const createOneAtATime = () => {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(change: () => Promise<T>): Promise<T> => {
    const run = queue.then(change, change);
    queue = run.catch(() => undefined);
    return run;
  };
};
