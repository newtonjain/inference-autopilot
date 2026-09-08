'use client';
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FleetProfile, WorkloadConfig } from '@/lib/fleet-engine';
export default function SavedWorkloads({
  profile,
  workload,
  disabled,
  onLoad,
}: {
  profile: FleetProfile;
  workload: WorkloadConfig;
  disabled: boolean;
  onLoad: (p: FleetProfile, w: WorkloadConfig) => void;
}) {
  const [saved, setSaved] = useState<
      {
        id: string;
        name: string;
        payload: { profile: FleetProfile; workload: WorkloadConfig };
      }[]
    >([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const r = await fetch('/api/workloads');
    const d = (await r.json()) as {
      error?: string;
      workloads: {
        id: string;
        name: string;
        payload: { profile: FleetProfile; workload: WorkloadConfig };
      }[];
    };
    if (!r.ok) throw Error(d.error);
    setSaved(d.workloads);
  }
  useEffect(() => {
    void fetch('/api/workloads')
      .then(async (r) => {
        const d = (await r.json()) as {
          error?: string;
          workloads: typeof saved;
        };
        if (!r.ok) throw Error(d.error);
        return d.workloads;
      })
      .then(setSaved)
      .catch((e) => setMessage(e.message));
  }, []);
  async function save() {
    setBusy(true);
    try {
      const r = await fetch('/api/workloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${workload.rps.toFixed(0)} req/s · ${new Date().toLocaleString()}`,
          profile,
          workload,
        }),
      });
      const d = (await r.json()) as {
        error?: string;
        workloads: {
          id: string;
          name: string;
          payload: { profile: FleetProfile; workload: WorkloadConfig };
        }[];
      };
      if (!r.ok) throw Error(d.error);
      await refresh();
      setMessage('Workload saved to your account.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="saved-workloads">
      <Button
        variant="outline"
        disabled={busy || disabled}
        onClick={() => void save()}
      >
        <Save size={14} />
        {busy ? 'Saving…' : 'Save workload'}
      </Button>
      <select
        aria-label="Load saved workload"
        value=""
        disabled={busy || disabled}
        onChange={(e) => {
          const item = saved.find((x) => x.id === e.target.value);
          if (item) onLoad(item.payload.profile, item.payload.workload);
        }}
      >
        <option value="">Load saved workload…</option>
        {saved.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <output>{message}</output>
    </div>
  );
}
