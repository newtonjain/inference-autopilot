import {
  database,
  runtime,
  body,
  json,
  handled,
  hash,
  ApiError,
} from '@/lib/server/store';
import { parseTelemetry } from '@/lib/analysis-contract';
export async function POST(request: Request) {
  return handled(async () => {
    const env = runtime();
    const provided = request.headers.get('authorization') || '';
    const raw = provided.startsWith('Bearer ') ? provided.slice(7) : '';
    if (!raw || raw.length > 300)
      throw new ApiError(401, 'Invalid ingestion credential.');
    const credential = await database()
      .prepare('SELECT owner FROM collector_tokens WHERE token_hash=?')
      .bind(await hash(raw))
      .first<{ owner: string }>();
    let owner = credential?.owner;
    if (
      !owner &&
      env.TELEMETRY_INGEST_TOKEN &&
      env.TELEMETRY_INGEST_OWNER &&
      (await hash(raw)) === (await hash(env.TELEMETRY_INGEST_TOKEN))
    )
      owner = env.TELEMETRY_INGEST_OWNER;
    if (!owner) throw new ApiError(401, 'Invalid ingestion credential.');
    const window = parseTelemetry(await body(request));
    const id = await hash({ owner: owner, window });
    await database()
      .prepare(
        'INSERT OR IGNORE INTO telemetry(id,owner,payload,observed_at,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(id, owner, JSON.stringify(window), window.endTime, Date.now())
      .run();
    return json({ id });
  });
}
