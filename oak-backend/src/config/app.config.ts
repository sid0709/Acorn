export type AppConfig = {
  port: number;
  corsOrigins: string[];
};

/** Single env read path for process bootstrap (secrets stay in .env). */
export function loadAppConfig(): AppConfig {
  const port = Number(process.env.PORT) || 8980;
  const corsOrigins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { port, corsOrigins };
}
