import {
  database,
  user,
  body,
  json,
  handled,
  sameOrigin,
  hash,
} from '@/lib/server/store';
import { parseTelemetry } from '@/lib/analysis-contract';
export async function GET(request: Request) {
  return handled(async () => {
    const row = await database()
      .prepare(
        'SELECT id,payload FROM telemetry WHERE owner=? ORDER BY observed_at DESC LIMIT 1',
      )
      .bind(user(request))
      .first<{ id: string; payload: string }>();
    return json({
      telemetry: row ? { id: row.id, ...JSON.parse(row.payload) } : null,
    });
  });
}
export async function POST(request: Request) {
  return handled(async () => {
    sameOrigin(request);
    const owner = user(request),
      window = parseTelemetry(await body(request));
    const id = await hash({ owner, window });
    await database()
      .prepare(
        'INSERT OR IGNORE INTO telemetry(id,owner,payload,observed_at,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(id, owner, JSON.stringify(window), window.endTime, Date.now())
      .run();
    return json({ id });
  });
}
