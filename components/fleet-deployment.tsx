'use client';
import { useState } from 'react';
import { ArrowRight, Cpu, Network, Layers3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  deriveFleetTopology,
  PARALLELISM_GUIDE,
  DISTRIBUTED_BLUEPRINTS,
  TOPOLOGY_SOURCES,
} from '@/lib/fleet-topology';
import { MODEL_IDS, MODELS } from '@/lib/fleet-engine';
import type { FleetState, FleetModelId, HardwareId } from '@/lib/fleet-engine';
const hardware: [HardwareId, string][] = [
  ['h200', 'H200'],
  ['gb200', 'GB200'],
  ['gb300', 'GB300'],
  ['tpuv7', 'TPU v7'],
];
export default function FleetDeployment({
  state,
  green,
}: {
  state: FleetState;
  green: FleetState | null;
}) {
  const topology = deriveFleetTopology(state, green);
  const [model, setModel] = useState<FleetModelId>('kimi');
  const [replicaId, setReplicaId] = useState('');
  const [blueprintId, setBlueprintId] = useState('qwen-pd');
  const replicas = topology.replicas.filter((r) => r.model === model);
  const selected = replicas.find((r) => r.id === replicaId) || replicas[0];
  const hosts = selected
    ? [...new Set(selected.ranks.map((r) => r.physicalNodeId))]
    : [];
  const blueprint = DISTRIBUTED_BLUEPRINTS.find((b) => b.id === blueprintId)!;
  return (
    <section className="panel distributed-panel">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">REPLICAS → HOSTS → ACCELERATOR RANKS</div>
          <h2>What actually scales out</h2>
          <p>
            One replica is a complete serving group. Shards cooperate inside it;
            independent requests scale across replicas.
          </p>
        </div>
        <span className="small-badge">
          {topology.totals.ready} ready · {topology.totals.warming} warming ·{' '}
          {topology.totals.chips} reserved chips
        </span>
      </div>
      <div className="replica-matrix">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Complete serving replicas</TableHead>
              {hardware.map(([id, label]) => (
                <TableHead key={id}>{label}</TableHead>
              ))}
              <TableHead>All hardware</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MODEL_IDS.map((m) => (
              <TableRow key={m}>
                <TableCell>
                  <span className="model-name">
                    <i style={{ background: `var(--model-${m})` }} />
                    {MODELS[m].name}
                  </span>
                </TableCell>
                {hardware.map(([h]) => {
                  const c = topology.counts.find(
                    (x) => x.model === m && x.hardware === h,
                  )!;
                  return (
                    <TableCell key={h}>
                      <strong>{c.ready}</strong>
                      <small>
                        {c.warming ? `${c.warming} warming · ` : ''}
                        {c.total ? `${c.chips} chips` : 'No allocation'}
                        {green && c.total ? ` · B${c.blue} / G${c.green}` : ''}
                      </small>
                    </TableCell>
                  );
                })}
                <TableCell>
                  <strong>
                    {topology.counts
                      .filter((c) => c.model === m)
                      .reduce((n, c) => n + c.total, 0)}
                  </strong>
                  <small>allocated, including warmups</small>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="topology-note">
        Counts update on every scaling tick. During rollout, blue and green
        reserve separate hardware; B / G includes both pools. Eight-chip
        GB200/GB300 groups map to two four-chip hosts in this architecture view.
      </p>
      <details className="rank-inspector-details">
        <summary>
          Inspect replicas, physical hosts, and tensor / pipeline ranks
        </summary>
        <div className="topology-inspector">
          <div className="topology-tabs">
            {MODEL_IDS.map((m) => (
              <Button
                key={m}
                variant={m === model ? 'secondary' : 'ghost'}
                onClick={() => {
                  setModel(m);
                  setReplicaId('');
                }}
                aria-pressed={m === model}
              >
                {MODELS[m].shortName}
              </Button>
            ))}
          </div>
          <div className="replica-selector">
            {replicas.map((r, i) => (
              <Button
                variant={r.id === selected?.id ? 'outline' : 'ghost'}
                key={r.id}
                onClick={() => setReplicaId(r.id)}
                aria-pressed={r.id === selected?.id}
              >
                {green ? `${r.pool} · ` : ''}Replica {i + 1}
                <span className={`replica-status ${r.status}`}>{r.status}</span>
              </Button>
            ))}
          </div>
          {selected ? (
            <>
              <div className="topology-summary">
                <strong>
                  <Network size={16} />
                  {selected.strategy}
                </strong>
                <span>
                  {hosts.length} modeled host{hosts.length === 1 ? '' : 's'} ·{' '}
                  {selected.ranks.length} chips · {selected.interNodeHops}{' '}
                  pipeline stage boundar
                  {selected.interNodeHops === 1 ? 'y' : 'ies'}
                </span>
                <span>
                  Request-level DP: {selected.dpGroupSize} ready{' '}
                  {MODELS[model].shortName} replica
                  {selected.dpGroupSize === 1 ? '' : 's'} in this pool
                </span>
              </div>
              <div className="rank-flow">
                <div className="rank-ingress">
                  <ArrowRight size={19} />
                  <span>Routed request</span>
                </div>
                {hosts.map((host, i) => (
                  <div className="rank-hop" key={host}>
                    {i > 0 && (
                      <div className="rank-link">
                        <ArrowRight />
                        <small>activations</small>
                      </div>
                    )}
                    <article className="rank-host">
                      <span className="eyebrow">
                        {selected.pool.toUpperCase()} · PIPELINE STAGE {i + 1}
                      </span>
                      <strong>
                        <Cpu size={15} />
                        {host}
                      </strong>
                      <div className="rank-chips">
                        {selected.ranks
                          .filter((r) => r.physicalNodeId === host)
                          .map((r) => (
                            <div key={r.rank}>
                              <Cpu size={17} />
                              <b>Rank {r.rank}</b>
                              <small>
                                chip {r.chipIndex} · TP {r.tpRank}
                              </small>
                              {r.expertRank !== null && (
                                <small>expert partition {r.expertRank}</small>
                              )}
                            </div>
                          ))}
                      </div>
                      <small>
                        TP collective
                        {selected.ep > 1
                          ? ' + expert dispatch on these same ranks'
                          : ''}
                      </small>
                    </article>
                  </div>
                ))}
                <div className="rank-ingress">
                  <ArrowRight size={19} />
                  <span>Token stream</span>
                </div>
              </div>
              <p className="topology-note">
                {selected.caveat} EP reuses ranks: accelerator count is TP × PP
                per replica, not TP × PP × EP. These diagrams add placement
                detail; the fluid engine does not benchmark collective
                communication.
              </p>
            </>
          ) : (
            <p>No allocated replicas for this model.</p>
          )}
        </div>
      </details>
      <details className="architecture-study">
        <summary>
          <Layers3 size={16} />
          Explore a multi-node or prefill/decode deployment{' '}
          <span>Design study</span>
        </summary>
        <div className="architecture-body">
          <div className="blueprint-choices">
            {DISTRIBUTED_BLUEPRINTS.map((b) => (
              <Button
                key={b.id}
                variant={b.id === blueprintId ? 'secondary' : 'outline'}
                onClick={() => setBlueprintId(b.id)}
              >
                {b.name}
              </Button>
            ))}
          </div>
          <div className="blueprint-heading">
            <h3>{blueprint.name}</h3>
            <strong>{blueprint.totalChips} total chips · not deployed</strong>
          </div>
          <div className="blueprint-flow">
            {blueprint.stages.map((s, i) => (
              <div className="blueprint-hop" key={s.id}>
                {i > 0 && (
                  <div className="blueprint-link">
                    <ArrowRight />
                    <span>{blueprint.links[i - 1]?.label}</span>
                  </div>
                )}
                <article>
                  <span className={`blueprint-role ${s.role}`}>
                    {s.role === 'pipeline'
                      ? blueprint.pp === 1
                        ? 'Tensor rank block'
                        : 'Layer stage'
                      : s.role}
                  </span>
                  <strong>{s.label}</strong>
                  <p>
                    {s.chips} reserved chips · ranks {s.rankStart}–{s.rankEnd}
                  </p>
                </article>
              </div>
            ))}
          </div>
          <p>{blueprint.explanation}</p>
          <ul>
            {blueprint.requirements.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="topology-note">
            This proposal does not change live replica counts, billing, or
            measured evidence. PD needs complete prefill and decode workers plus
            a compatible KV connector; moving KV is not the same as moving
            pipeline activations.
          </p>
        </div>
      </details>
      <details className="parallelism-guide">
        <summary>TP, PP, EP, DP, and PD explained</summary>
        <div>
          {PARALLELISM_GUIDE.map((p) => (
            <article key={p.key}>
              <strong>
                {p.key} · {p.name}
              </strong>
              <p>{p.description}</p>
            </article>
          ))}
        </div>
        <footer>
          {TOPOLOGY_SOURCES.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
              {s.title} ↗
            </a>
          ))}
        </footer>
      </details>
    </section>
  );
}
