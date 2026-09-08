'use client';
import { useRef, useState } from 'react';
import { Cloud, Upload, Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { parseGkeSnapshot, observedReplicas } from '@/lib/gke-snapshot';
import type { GkeSnapshot } from '@/lib/gke-snapshot';
const REPO = 'https://github.com/newtonjain/inference-autopilot';
export default function GcpConnection() {
  const [snapshot, setSnapshot] = useState<GkeSnapshot | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    revision = useRef(0);
  const observed = snapshot ? observedReplicas(snapshot) : null;
  async function loadFile(file: File | undefined) {
    if (!file) return;
    const op = ++revision.current;
    setBusy(true);
    setError('');
    try {
      if (file.size > 2_000_000)
        throw Error('Choose an observer JSON file smaller than 2 MB.');
      const next = parseGkeSnapshot(await file.text());
      if (op === revision.current) setSnapshot(next);
    } catch (e) {
      if (op === revision.current) setError((e as Error).message);
    } finally {
      if (op === revision.current) setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function example() {
    const op = ++revision.current;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/gcp-example-snapshot.json');
      if (!res.ok) throw Error('Example snapshot could not be loaded.');
      const next = parseGkeSnapshot(await res.text());
      if (op === revision.current) setSnapshot(next);
    } catch (e) {
      if (op === revision.current) setError((e as Error).message);
    } finally {
      if (op === revision.current) setBusy(false);
    }
  }
  return (
    <section className="panel gcp-connection">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">SIMULATION → OBSERVATION → CONTROL</div>
          <h2>
            <Cloud size={20} />
            Connect the evidence to GKE
          </h2>
          <p>
            A read-only Helm observer is included in the repository. No cloud
            account is connected to this dashboard.
          </p>
        </div>
        <span className="small-badge">Observe-only scaffold</span>
      </div>
      <div className="gcp-path">
        <article>
          <b>01</b>
          <strong>Attach to existing GKE</strong>
          <p>
            Install the CPU observer in your cluster. A namespaced Role can list
            serving pods; it cannot resize or modify them.
          </p>
        </article>
        <ArrowRight />
        <article>
          <b>02</b>
          <strong>Collect the right signals</strong>
          <p>
            Pod/rank inventory plus vLLM latency, queues, prefix reuse and
            tokens. GPU/TPU telemetry, router spans and billing complete the
            evidence.
          </p>
        </article>
        <ArrowRight />
        <article>
          <b>03</b>
          <strong>Gate future deployment changes</strong>
          <p>
            A separately authorized controller must reserve complete rank
            groups, canary traffic, verify real SLOs and support rollback.
          </p>
        </article>
      </div>
      <div className="gcp-actions">
        <a
          href={`${REPO}/blob/main/docs/GCP.md`}
          target="_blank"
          rel="noreferrer"
        >
          GCP setup guide ↗
        </a>
        <a
          href={`${REPO}/tree/main/deploy/gcp/chart`}
          target="_blank"
          rel="noreferrer"
        >
          Helm chart ↗
        </a>
        <a
          href={`${REPO}/blob/main/deploy/gcp/examples/serving-intents.json`}
          target="_blank"
          rel="noreferrer"
        >
          Serving architecture intents ↗
        </a>
      </div>
      <div className="gcp-import">
        <div>
          <h3>Inspect an observer snapshot</h3>
          <p>
            Import inventory exported through kubectl port-forward. Files stay
            in this browser session; simulated traffic and costs stay separate.
          </p>
        </div>
        <div>
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Import GKE inventory snapshot"
            onChange={(e) => void loadFile(e.target.files?.[0])}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={14} />
            Import snapshot
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void example()}
          >
            Load synthetic example
          </Button>
        </div>
      </div>
      {error && (
        <p className="gcp-error" role="alert">
          {error}
        </p>
      )}
      {snapshot && observed && (
        <div className="gcp-evidence">
          <div className="gcp-evidence-heading">
            <span className="small-badge">
              {snapshot.source === 'example'
                ? 'Synthetic example'
                : 'Imported observation · not live'}
            </span>
            <span>
              {snapshot.pods.length} pods · {observed.replicas.length} declared
              serving copies · {observed.unlabeledPods} unlabeled pods
            </span>
            <time>
              Observed {new Date(snapshot.observedAt * 1000).toLocaleString()}
            </time>
            <Button
              variant="ghost"
              onClick={() => {
                revision.current++;
                setSnapshot(null);
                setError('');
                setBusy(false);
              }}
            >
              Clear
            </Button>
          </div>
          <p>
            Readiness below means all declared member pods are ready and
            reserved chips match TP × PP. Labels do not verify actual rank
            formation or model support. Snapshot timestamps are historical,
            never a live health guarantee.
          </p>
          <div className="replica-matrix">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model / serving copy</TableHead>
                  <TableHead>Hardware / role</TableHead>
                  <TableHead>Declared parallelism</TableHead>
                  <TableHead>Physical footprint</TableHead>
                  <TableHead>Inventory check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {observed.replicas.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <strong>{r.model}</strong>
                      <small>
                        {r.namespace}/{r.replica}
                      </small>
                    </TableCell>
                    <TableCell>
                      {r.hardware}
                      <small>{r.role}</small>
                    </TableCell>
                    <TableCell>
                      TP{r.tp} · PP{r.pp} · EP{r.ep}
                      <small>EP shares ranks</small>
                    </TableCell>
                    <TableCell>
                      {r.pods} pods · {r.hosts.length} hosts
                      <small>
                        {r.chips} reserved chips / {r.expectedChips} expected
                      </small>
                    </TableCell>
                    <TableCell>
                      {r.readyCandidate ? (
                        <span className="gcp-ready">
                          <Check size={13} />
                          Declared group ready
                        </span>
                      ) : (
                        <span className="gcp-error">Needs verification</span>
                      )}
                      <small>{r.issues.join('; ')}</small>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {snapshot.errors.length > 0 && (
            <p className="gcp-error">
              Observer errors: {snapshot.errors.join(', ')}
            </p>
          )}
        </div>
      )}
      <details className="gcp-hooks">
        <summary>What connects where?</summary>
        <div>
          <article>
            <strong>Existing endpoints</strong>
            <p>
              Apply model/replica/rank labels to the serving workload. Helm
              attaches the observer to its namespace. External VMs and Vertex
              endpoints need separate adapters; this does not migrate them into
              GKE.
            </p>
          </article>
          <article>
            <strong>Prometheus and identity</strong>
            <p>
              The chart optionally enables a scoped PodMonitoring for existing
              vLLM exporters. Metrics remain in your monitoring system. A future
              query adapter uses Workload Identity, not downloaded
              service-account keys.
            </p>
          </article>
          <article>
            <strong>Heterogeneous hardware</strong>
            <p>
              Use supported GPU node pools and separate TPU slice
              configurations. Group scheduling must reserve every rank together.
              A Google Cloud fleet groups clusters; it is not a GPU scheduler.
            </p>
          </article>
          <article>
            <strong>Next production boundary</strong>
            <p>
              Add authenticated ingestion, durable time-series storage, runtime
              config discovery and billing calibration before enabling any cloud
              writes. This observer never changes deployments.
            </p>
          </article>
        </div>
      </details>
    </section>
  );
}
