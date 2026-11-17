/** Time held back from research for final ranking; at most one third of a small budget. */
export const RANKING_RESERVE_MS = 12_000;

export type ResearchBudget = {
  allocate(cap: number): number;
  remaining(): number;
  run<T>(cap: number, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /** Child scope that ends early, leaving up to ms (at most one third) for final ranking. */
  reserve(ms: number): ResearchBudget;
  close(): void;
};

export class ResearchTimeoutError extends Error {
  constructor() {
    super("research timeout");
    this.name = "ResearchTimeoutError";
  }
}

/** Owns the deadline, cancellation and cleanup for a run (including retries). */
export function createResearchBudget(totalMs: number): ResearchBudget {
  return deadlineBudget(Date.now() + Math.max(0, totalMs));
}

function deadlineBudget(deadline: number): ResearchBudget {
  const active = new Set<AbortController>();
  const children: ResearchBudget[] = [];
  let closed = false;
  const remaining = () => closed ? 0 : Math.max(0, deadline - Date.now());
  return {
    remaining,
    allocate: (cap) => Math.min(cap, remaining()),
    // Small configured budgets still need time to gather evidence.
    reserve(ms) {
      const child = deadlineBudget(Math.floor(deadline - Math.min(ms, remaining() / 3)));
      children.push(child);
      return child;
    },
    async run(cap, work) {
      const available = Math.min(cap, remaining());
      if (available <= 0) throw new ResearchTimeoutError();
      const controller = new AbortController();
      active.add(controller);
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
        timer = setTimeout(() => controller.abort(new ResearchTimeoutError()), available);
      });
      try {
        return await Promise.race([
          Promise.resolve().then(() => {
            controller.signal.throwIfAborted();
            return work(controller.signal);
          }),
          timeout,
        ]);
      } finally {
        clearTimeout(timer!);
        controller.abort();
        active.delete(controller);
      }
    },
    close() {
      closed = true;
      for (const child of children) child.close();
      for (const controller of active) controller.abort(new ResearchTimeoutError());
    },
  };
}
