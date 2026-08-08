export type StateBackend = "memory" | "redis";

export function resolveStateBackend(
  value: string | undefined = process.env.FREELLM_STATE_BACKEND,
): StateBackend {
  const normalized = (value ?? "memory").trim().toLowerCase();
  if (normalized === "redis") return "redis";
  if (normalized === "memory" || normalized === "") return "memory";
  throw new Error(
    `Unknown FREELLM_STATE_BACKEND="${value}". Expected "memory" or "redis".`,
  );
}
