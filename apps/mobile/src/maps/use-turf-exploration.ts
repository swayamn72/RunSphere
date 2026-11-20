import { useEffect, useState } from 'react';
import { activityRecorder } from '../activity-recorder.native';
import { addExploredSamples, explorationCell } from './turf-exploration';

const previewCells = new Set(
  Array.from({ length: 15 }, (_, index) =>
    explorationCell(72.873 + index * 0.00085, 19.073 + index * 0.00048)
  )
);

/** Compute from retained local runs, so deleting a run also removes its exploration. */
export function useTurfExploration(accountId: string | undefined, preview: boolean) {
  const [loaded, setLoaded] = useState<{ accountId: string; cells: ReadonlySet<string> }>();
  useEffect(() => {
    if (preview || !accountId) return;
    let cancelled = false;
    void (async () => {
      const sessions = await activityRecorder.list(accountId);
      const cells = new Set<string>();
      for (const session of sessions
        .filter((run) => run.completedAt && run.state !== 'discarded')
        .slice(0, 50)) {
        if (cancelled) return;
        addExploredSamples(cells, await activityRecorder.liveSamples(session.id, accountId));
      }
      if (!cancelled) setLoaded({ accountId, cells });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountId, preview]);
  return preview ? previewCells : loaded?.accountId === accountId ? loaded?.cells : undefined;
}
