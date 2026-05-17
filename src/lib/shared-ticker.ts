// Module-level singleton: one setInterval for the whole app.
// All useTimeLeft() calls subscribe here instead of each creating their own.
const listeners = new Set<() => void>();
let handle: ReturnType<typeof setInterval> | null = null;

function tick() {
  listeners.forEach((fn) => fn());
}

export function subscribeTick(fn: () => void): () => void {
  listeners.add(fn);
  if (!handle) handle = setInterval(tick, 1_000);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && handle) {
      clearInterval(handle);
      handle = null;
    }
  };
}
