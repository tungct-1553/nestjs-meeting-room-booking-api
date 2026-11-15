export function validateEnvironment(input: Record<string, unknown>) {
  const value = { ...input };
  const databaseUrl = String(value.DATABASE_URL ?? '');
  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error();
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL with host and database');
  }
  for (const [key, fallback, max] of [['PORT', 3000, 65535], ['DB_POOL_MAX', 10, 1000]] as const) {
    const number = Number(value[key] ?? fallback);
    if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`${key} must be an integer between 1 and ${max}`);
    value[key] = number;
  }
  const origins = String(value.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error();
    } catch { throw new Error('CORS_ORIGINS must contain comma-separated HTTP origins'); }
  }
  value.CORS_ORIGINS = origins;
  return value;
}
