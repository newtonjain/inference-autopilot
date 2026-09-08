'use client';

import { useId, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import {
  HARDWARE,
  INITIAL_NODES,
  MODELS,
  MODEL_IDS,
  type FleetState,
  type FleetModelId,
  type HardwareId,
  type Replica,
} from '@/lib/fleet-engine';

type Props = {
  state: FleetState;
  green?: FleetState | null;
  greenTraffic?: number;
  playing: boolean;
  onSurge: (model: FleetModelId) => void;
  locked?: boolean;
};
const hardwareIds: HardwareId[] = ['h200', 'gb200', 'gb300', 'tpuv7'];
const hardwareNames: Record<HardwareId, string> = {
  h200: 'H200',
  gb200: 'GB200',
  gb300: 'GB300',
  tpuv7: 'TPU v7',
};
const identity: Record<FleetModelId, string> = {
  gemma: '#6ea8ff',
  qwen: '#bd98ff',
  kimi: '#f7a668',
};
const percent = (n: number) =>
  `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%`;
const health = (util: number, ttft: number, target: number) =>
  ttft > target || util >= 0.85
    ? 'critical'
    : util >= 0.65
      ? 'pressure'
      : 'healthy';

function ReplicaTile({
  replica,
  fleet,
}: {
  replica: Replica;
  fleet: FleetState;
}) {
  const status = health(
    replica.utilization,
    replica.ttftMs,
    fleet.workload.ttftTargetMs,
  );
  return (
    <div className={`fleet-map-replica fleet-map-${status}`}>
      <div className="fleet-map-replica-top">
        <span
          className="fleet-map-model-tag"
          style={{ '--model-color': identity[replica.model] } as CSSProperties}
        >
          {MODELS[replica.model].shortName}
        </span>
        <span className={`fleet-map-status fleet-map-status-${replica.status}`}>
          <i />
          {replica.status === 'warming'
            ? `warming · ${Math.max(0, Math.ceil(replica.readyAt - fleet.time))}s`
            : replica.status}
        </span>
      </div>
      <div className="fleet-map-replica-metrics">
        <span>{MODELS[replica.model].requiredChips} chips</span>
        <span>
          {replica.status === 'ready'
            ? `${percent(replica.utilization)} utilization`
            : 'reserving capacity'}
        </span>
      </div>
      <div
        className="fleet-map-meter"
        aria-label={`${MODELS[replica.model].shortName} replica utilization`}
      >
        <span style={{ width: percent(replica.utilization) }} />
      </div>
      <div className="fleet-map-replica-bottom">
        <span>
          Queue <b>{replica.queue.toFixed(1)}</b>
        </span>
        <span className="fleet-map-health-text">
          {replica.status !== 'ready'
            ? 'Not serving'
            : status === 'critical'
              ? replica.ttftMs > fleet.workload.ttftTargetMs
                ? 'TTFT breach'
                : 'High pressure'
              : status === 'pressure'
                ? 'Elevated'
                : 'Healthy'}
        </span>
      </div>
    </div>
  );
}

export default function FleetMap({
  state,
  green,
  greenTraffic = 0,
  playing,
  onSurge,
  locked = false,
}: Props) {
  const uniqueId = useId().replace(/:/g, '');
  const greenShare = green ? Math.max(0, Math.min(1, greenTraffic)) : 0;
  const pools = [
    {
      id: 'blue',
      name: green ? 'Blue · current' : 'Current pool',
      fleet: state,
      share: 1 - greenShare,
    },
    ...(green
      ? [
          {
            id: 'green',
            name: 'Green · candidate',
            fleet: green,
            share: greenShare,
          },
        ]
      : []),
  ];
  const hasRoute = (
    fleet: FleetState,
    model: FleetModelId,
    hardware?: HardwareId,
  ) =>
    fleet.replicas.some(
      (r) =>
        r.model === model &&
        r.status === 'ready' &&
        (!hardware ||
          INITIAL_NODES.some(
            (n) => n.id === r.nodeId && n.hardware === hardware,
          )),
    );
  const totalIncoming = (model: FleetModelId) =>
    state.modelMetrics[model].incomingRps +
    (green?.modelMetrics[model].incomingRps ?? 0);
  return (
    <section
      className={`fleet-map ${playing ? 'fleet-map-playing' : 'fleet-map-paused'}`}
      aria-label="Inference fleet topology"
    >
      <div className="fleet-map-heading">
        <div>
          <span className="fleet-map-eyebrow">LIVE TOPOLOGY</span>
          <h2>Follow the request.</h2>
        </div>
        <span className="fleet-map-live">
          <i />
          {playing ? 'Simulation running' : 'Simulation paused'}
        </span>
      </div>
      <div className="fleet-map-inputs">
        {MODEL_IDS.map((model, index) => {
          const mm = state.modelMetrics[model],
            gm = green?.modelMetrics[model];
          const rps = totalIncoming(model);
          const util =
            gm && greenShare > 0
              ? Math.max(greenShare < 1 ? mm.utilization : 0, gm.utilization)
              : mm.utilization;
          const ttft =
            gm && greenShare > 0
              ? Math.max(greenShare < 1 ? mm.ttftMs : 0, gm.ttftMs)
              : mm.ttftMs;
          const status = health(util, ttft, state.workload.ttftTargetMs);
          return (
            <article
              key={model}
              className={`fleet-map-input fleet-map-${status}`}
              style={{ '--model-color': identity[model] } as CSSProperties}
            >
              <div className="fleet-map-input-top">
                <span className="fleet-map-model-icon">0{index + 1}</span>
                <div>
                  <span className="fleet-map-micro">INCOMING WORKLOAD</span>
                  <h3>{MODELS[model].name}</h3>
                </div>
                <span className="fleet-map-health-dot" title={status} />
              </div>
              <div className="fleet-map-demand">
                <strong>{rps.toFixed(1)}</strong>
                <span>req / sec</span>
                <Button
                  className="fleet-map-surge"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => onSurge(model)}
                  aria-label={`Inject a traffic surge for ${MODELS[model].name}`}
                >
                  <span aria-hidden="true">↗</span> Surge
                </Button>
              </div>
              <div className="fleet-map-input-stats">
                <span>
                  TTFT <b>{Math.round(ttft)} ms</b>
                </span>
                <span>
                  Pressure <b>{percent(util)}</b>
                </span>
              </div>
              <div className="fleet-map-meter">
                <span style={{ width: percent(util) }} />
              </div>
            </article>
          );
        })}
      </div>
      <div className="fleet-map-routing">
        <svg
          className="fleet-map-flow"
          viewBox="0 0 1000 190"
          aria-label="Model-aware requests flow through the router into compatible hardware pools"
        >
          {MODEL_IDS.map((model, i) => {
            const d = `M ${166.7 + i * 333.3} 0 C ${166.7 + i * 333.3} 36 500 16 500 57`;
            const active =
              totalIncoming(model) > 0 &&
              pools.some((p) => p.share > 0 && hasRoute(p.fleet, model));
            return (
              <g key={model}>
                <path d={d} className="fleet-map-wire" />
                {active && playing && (
                  <circle
                    r="3.5"
                    fill={identity[model]}
                    className="fleet-map-particle"
                  >
                    <animateMotion
                      dur={`${2 + i * 0.25}s`}
                      repeatCount="indefinite"
                      path={d}
                    />
                  </circle>
                )}
              </g>
            );
          })}
          {hardwareIds.map((hardware, i) =>
            pools.map((pool, poolIndex) =>
              MODEL_IDS.map((model, m) => {
                const x =
                  125 + i * 250 + (green ? (poolIndex === 0 ? -12 : 12) : 0);
                const d = `M 500 122 C 500 157 ${x} 140 ${x} 190`;
                const active =
                  pool.share > 0 &&
                  pool.fleet.modelMetrics[model].incomingRps > 0 &&
                  hasRoute(pool.fleet, model, hardware);
                return (
                  <g key={`${hardware}-${pool.id}-${model}`}>
                    <path
                      d={d}
                      className={`fleet-map-wire ${pool.id === 'green' ? 'fleet-map-green-wire' : ''}`}
                    />
                    {active && playing && (
                      <circle
                        r={pool.id === 'green' ? 4 : 3}
                        fill={identity[model]}
                        stroke={pool.id === 'green' ? '#55dfa5' : 'none'}
                        strokeWidth="1.5"
                        className="fleet-map-particle"
                      >
                        <animateMotion
                          dur={`${2.2 + m * 0.35 + i * 0.15}s`}
                          begin={`${-m * 0.6}s`}
                          repeatCount="indefinite"
                          path={d}
                        />
                      </circle>
                    )}
                  </g>
                );
              }),
            ),
          )}
          <rect
            x="360"
            y="54"
            width="280"
            height="71"
            rx="13"
            className="fleet-map-router-box"
          />
          <text
            x="500"
            y="78"
            textAnchor="middle"
            className="fleet-map-router-title"
          >
            MODEL-AWARE ROUTER
          </text>
          <text
            x="500"
            y="97"
            textAnchor="middle"
            className="fleet-map-router-subtitle"
          >
            Compatibility · cache affinity · admission
          </text>
          <text
            x="500"
            y="114"
            textAnchor="middle"
            className="fleet-map-router-split"
          >
            {green
              ? `BLUE ${percent(1 - greenShare)}  /  GREEN ${percent(greenShare)}`
              : `${state.profile.prefixCache ? 'PREFIX CACHE ON' : 'PREFIX CACHE OFF'}  ·  ${state.profile.cacheAffinity ? 'AFFINITY ON' : 'AFFINITY OFF'}`}
          </text>
        </svg>
      </div>
      <div className="fleet-map-hardware">
        {hardwareIds.map((hardware) => {
          const nodes = INITIAL_NODES.filter((n) => n.hardware === hardware);
          const replicas = pools.flatMap((p) =>
            p.fleet.replicas.filter((r) =>
              nodes.some((n) => n.id === r.nodeId),
            ),
          );
          return (
            <section
              key={hardware}
              className="fleet-map-cluster"
              aria-label={HARDWARE[hardware].name}
            >
              <header className="fleet-map-cluster-heading">
                <span className="fleet-map-chip-icon" aria-hidden="true">
                  ▦
                </span>
                <div>
                  <h3>{hardwareNames[hardware]}</h3>
                  <span>
                    {hardware === 'tpuv7'
                      ? 'Ironwood · TPU'
                      : hardware === 'h200'
                        ? 'Hopper · GPU'
                        : 'Blackwell · GPU'}
                  </span>
                </div>
                <b>
                  {replicas.filter((r) => r.status === 'ready').length}
                  <small> ready</small>
                </b>
              </header>
              {pools.map((pool) => (
                <div
                  key={pool.id}
                  className={`fleet-map-pool fleet-map-pool-${pool.id}`}
                >
                  <div className="fleet-map-pool-label">
                    <span>
                      <i />
                      {pool.name}
                    </span>
                    {green && <b>{percent(pool.share)} traffic</b>}
                  </div>
                  {nodes.map((node) => {
                    const rs = pool.fleet.replicas.filter(
                      (r) => r.nodeId === node.id,
                    );
                    const used = rs.reduce(
                      (sum, r) => sum + MODELS[r.model].requiredChips,
                      0,
                    );
                    return (
                      <article
                        key={`${pool.id}-${node.id}`}
                        className={`fleet-map-node ${rs.length ? '' : 'fleet-map-node-idle'}`}
                        aria-label={`${pool.name}, ${node.label}, ${used} of ${node.chips} chips allocated`}
                      >
                        <div className="fleet-map-node-heading">
                          <strong>{node.label}</strong>
                          <span>
                            {used}
                            <em> / {node.chips} chips</em>
                          </span>
                        </div>
                        <div
                          className="fleet-map-chip-slots"
                          aria-hidden="true"
                        >
                          {Array.from({ length: node.chips }, (_, i) => (
                            <span
                              key={i}
                              className={i < used ? 'fleet-map-slot-used' : ''}
                            />
                          ))}
                        </div>
                        {rs.length ? (
                          <div className="fleet-map-replicas">
                            {rs.map((replica) => (
                              <ReplicaTile
                                key={replica.id}
                                replica={replica}
                                fleet={pool.fleet}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="fleet-map-idle">
                            Available capacity
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ))}
            </section>
          );
        })}
      </div>
      <footer className="fleet-map-legend">
        <span>
          <i className="fleet-map-key-healthy" />
          Healthy &lt;65%
        </span>
        <span>
          <i className="fleet-map-key-pressure" />
          Elevated 65–85%
        </span>
        <span>
          <i className="fleet-map-key-critical" />
          High ≥85% / TTFT breach
        </span>
        <p>
          Particles are representative samples, not one per request.
          {green ? ' Blue and green use separate cloned capacity.' : ''}
        </p>
      </footer>
      <span id={`${uniqueId}-note`} className="fleet-map-note">
        Model colors identify routes. Health colors indicate capacity pressure.
        Hardware allocations and performance are simulated.
      </span>
    </section>
  );
}
