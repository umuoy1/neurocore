export async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return task;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`operation_timed_out:${timeoutMs}`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
