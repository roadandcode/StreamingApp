/** True when `error` (or its cause, as wrapped by Drizzle) is a Postgres unique violation. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (typeof current === 'object' && current !== null && 'code' in current) {
      const pgError = current as { code?: unknown; constraint?: unknown };
      if (pgError.code === '23505') {
        return constraint === undefined || pgError.constraint === constraint;
      }
    }
    current = typeof current === 'object' && current !== null && 'cause' in current ? current.cause : undefined;
  }
  return false;
}
