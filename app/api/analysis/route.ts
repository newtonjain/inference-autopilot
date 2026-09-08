import {
  database,
  runtime,
  user,
  body,
  json,
  handled,
  sameOrigin,
  hash,
  ApiError,
} from '@/lib/server/store';
import {
  parseWorkload,
  parseProfile,
  record,
  parseTelemetry,
  telemetryWorkload,
} from '@/lib/analysis-contract';
import { sweepConfiguration } from '@/lib/config-sweep';
import { askAstra } from '@/lib/astra-client';
export async function GET(request: Request) {
  return handled(async () => {
    const rows = await database()
      .prepare(
        'SELECT id,status,payload,created_at FROM analyses WHERE owner=? ORDER BY created_at DESC LIMIT 5',
      )
      .bind(user(request))
      .all();
    return json({
      analyses: rows.results.map((r) => ({
        ...r,
        payload: JSON.parse(r.payload as string),
      })),
    });
  });
}
export async function POST(request: Request) {
  return handled(async () => {
    sameOrigin(request);
    const owner = user(request);
    const key = runtime().OPENAI_API_KEY;
    if (!key)
      throw new ApiError(
        503,
        'OPENAI_API_KEY is not configured on the server.',
      );
    const input = record(await body(request)),
      profile = parseProfile(input.profile);
    let workload = parseWorkload(input.workload);
    let telemetry;
    if (input.telemetryId !== undefined) {
      if (typeof input.telemetryId !== 'string')
        throw new ApiError(400, 'Invalid telemetry identity.');
      const row = await database()
        .prepare('SELECT payload FROM telemetry WHERE id=? AND owner=?')
        .bind(input.telemetryId, owner)
        .first<{ payload: string }>();
      if (!row) throw new ApiError(404, 'Telemetry window not found.');
      telemetry = parseTelemetry(JSON.parse(row.payload));
      workload = telemetryWorkload(telemetry, workload);
    }
    const now = Date.now(),
      db = database();
    const count = await db
      .prepare(
        'SELECT count(*) AS n FROM analyses WHERE owner=? AND created_at>?',
      )
      .bind(owner, now - 3600000)
      .first<{ n: number }>();
    if ((count?.n || 0) >= 20)
      throw new ApiError(429, 'Hourly analysis limit reached.');
    const lock = await db
      .prepare(
        'INSERT INTO analysis_locks(owner,expires_at) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET expires_at=excluded.expires_at WHERE analysis_locks.expires_at<=?',
      )
      .bind(owner, now + 120000, now)
      .run();
    if (!lock.meta.changes)
      throw new ApiError(
        429,
        'Another analysis is running or the cooldown is active.',
      );
    const id = crypto.randomUUID(),
      context = await hash({
        profile,
        workload,
        telemetryId: input.telemetryId || null,
      });
    await db
      .prepare(
        'INSERT INTO analyses(id,owner,context,status,payload,created_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(id, owner, context, 'running', '{}', now)
      .run();
    try {
      const sweep = sweepConfiguration(profile, workload);
      const decision = sweep.feasibleCount
        ? await askAstra(key, { workload, sweep, telemetry })
        : null;
      const result = {
        id,
        context,
        source: telemetry ? 'observed-proxy' : 'simulation',
        workload,
        profile,
        sweep,
        decision,
        telemetryId: input.telemetryId || null,
        limitations: telemetry
          ? [
              'Replay uses completed throughput as a lower bound proxy, not measured ingress.',
              'Serving rates and hardware costs remain synthetic; no production deployment is approved.',
            ]
          : [
              'Performance and costs are simulated; Astra ranks the supported configuration grid.',
            ],
      };
      await db
        .prepare(
          'UPDATE analyses SET status=?,payload=? WHERE id=? AND owner=?',
        )
        .bind('complete', JSON.stringify(result), id, owner)
        .run();
      return json(result);
    } catch (e) {
      await db
        .prepare(
          'UPDATE analyses SET status=?,payload=? WHERE id=? AND owner=?',
        )
        .bind(
          'failed',
          JSON.stringify({
            error:
              'Astra analysis could not complete. No changes were applied.',
          }),
          id,
          owner,
        )
        .run();
      throw new ApiError(
        502,
        e instanceof Error && e.message.startsWith('OpenAI')
          ? e.message
          : 'Astra analysis could not complete. No changes were applied.',
      );
    } finally {
      await db
        .prepare('UPDATE analysis_locks SET expires_at=? WHERE owner=?')
        .bind(Math.max(now + 60000, Date.now()), owner)
        .run();
    }
  });
}
