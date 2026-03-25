export function generateId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

