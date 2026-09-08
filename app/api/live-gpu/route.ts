import { env } from 'cloudflare:workers';

export async function GET() {
  const config = env as unknown as { LIVE_GPU_URL?: string; LIVE_GPU_TOKEN?: string };
  if (!config.LIVE_GPU_URL || !config.LIVE_GPU_TOKEN) {
    return Response.json({ error: 'Live GPU connection is not configured.' }, { status: 503 });
  }
  try {
    const response = await fetch(`${config.LIVE_GPU_URL}/snapshot`, {
      headers: { Authorization: `Bearer ${config.LIVE_GPU_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('upstream unavailable');
    return Response.json(await response.json(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'The GPU telemetry connection is unavailable. Saved measurements remain below.' }, { status: 503 });
  }
}
