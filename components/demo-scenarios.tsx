'use client';
import { useState } from 'react';
import { Play, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { demoScenarios } from '@/lib/fleet-scenarios';
import type { DemoScenario } from '@/lib/fleet-scenarios';
export default function DemoScenarios({
  onLoad,
  disabled,
}: {
  onLoad: (scenario: DemoScenario) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="panel demo-scenarios">
      <div className="panel-heading">
        <div>
          <h2>Demo the decision, then the rollout</h2>
          <p>
            Three repeatable workloads. Loading one resets the simulated fleet
            and pauses it for review.
          </p>
        </div>
        <Button
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={16} />
          {open ? 'Collapse' : 'Scenarios'}
        </Button>
      </div>
      {open && (
        <div className="scenario-grid">
          {demoScenarios().map((s, i) => (
            <article key={s.id}>
              <span className="eyebrow">SCENARIO 0{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.thesis}</p>
              <div className="scenario-stats">
                <span>{s.workload.rps} req/s</span>
                <span>
                  {s.workload.inputTokens.toLocaleString()} input tokens
                </span>
                <span>{Math.round(s.workload.sharedPrefix * 100)}% prefix</span>
              </div>
              <small>{s.steps}</small>
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => onLoad(s)}
              >
                <Play size={14} />
                Load scenario
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
