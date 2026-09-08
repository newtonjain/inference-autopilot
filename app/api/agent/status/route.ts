import { database, runtime, user, json, handled } from '@/lib/server/store';
export async function GET(request: Request) {
  return handled(async () => {
    const owner = user(request);
    await database()
      .prepare('SELECT count(*) AS n FROM workloads WHERE owner=?')
      .bind(owner)
      .first();
    const collector = await database()
      .prepare('SELECT owner FROM collector_tokens WHERE owner=?')
      .bind(owner)
      .first();
    return json({
      model: 'gpt-6-astra',
      configured: !!runtime().OPENAI_API_KEY,
      persistence: true,
      telemetryIngestionConfigured:
        !!collector ||
        (!!runtime().TELEMETRY_INGEST_TOKEN &&
          !!runtime().TELEMETRY_INGEST_OWNER),
      automaticLimit:
        '20 analyses per hour per user; at least 60 seconds apart',
    });
  });
}
