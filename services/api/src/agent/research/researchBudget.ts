export type ResearchBudget = {
  allocate(cap: number): number;
  remaining(): number;
};

export function createResearchBudget(totalMs: number): ResearchBudget {
  const deadline = Date.now() + totalMs;
  return {
    remaining: () => Math.max(0, deadline - Date.now()),
    allocate: (cap: number) => Math.min(cap, Math.max(0, deadline - Date.now())),
  };
}
