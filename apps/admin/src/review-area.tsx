import { useState } from 'react';
import { getStaffReviewQueue, type StaffReviewItem } from './api.js';
import type { AreaContext } from './area-types.js';
import { useAreaLoad } from './use-area-load.js';
import { Button, DataTable, Section, StatusTag, type Column } from './ui/index.js';

const readableStatus = (status: StaffReviewItem['status']) => status.replace('_', ' ');

/** A rejection is the one state staff must act on; the others are still moving. */
const statusTone = (status: StaffReviewItem['status']) =>
  status === 'rejected' ? 'danger' : status === 'validating' ? 'info' : 'neutral';

export const reviewNote = (item: StaffReviewItem): string =>
  item.rejectionReason ?? (item.validationErrors.join(', ') || 'Awaiting validation');

const columns: readonly Column<StaffReviewItem>[] = [
  { key: 'id', header: 'Submission', render: (item) => <code>{item.id}</code> },
  {
    key: 'status',
    header: 'Status',
    render: (item) => (
      <StatusTag tone={statusTone(item.status)}>{readableStatus(item.status)}</StatusTag>
    )
  },
  {
    key: 'submitted',
    header: 'Submitted',
    render: (item) => (
      <span className="rs-nowrap">{new Date(item.submittedAt).toLocaleString()}</span>
    )
  },
  { key: 'notes', header: 'Validation notes', render: reviewNote }
];

/**
 * Submissions that failed or are waiting. Never raw GPS: the queue carries ids,
 * states and reasons only.
 */
export function ReviewView({
  items,
  loading,
  onRefresh
}: {
  items: readonly StaffReviewItem[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [status, setStatus] = useState<'all' | StaffReviewItem['status']>('all');
  const shown = status === 'all' ? items : items.filter((item) => item.status === status);
  return (
    <Section
      title="Activities requiring attention"
      actions={
        <>
          <label className="rs-inline-filter">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
            >
              <option value="all">All</option>
              <option value="rejected">Rejected</option>
              <option value="validating">Validating</option>
              <option value="received">Received</option>
            </select>
          </label>
          <Button variant="secondary" busy={loading} onClick={onRefresh}>
            {loading ? 'Refreshing…' : 'Refresh queue'}
          </Button>
        </>
      }
    >
      <DataTable
        caption="Activities requiring attention"
        columns={columns}
        rows={shown}
        rowKey={(item) => item.id}
        emptyMessage={
          loading
            ? 'Loading…'
            : items.length > 0
              ? 'Nothing matches that status.'
              : 'No activities currently require review.'
        }
      />
    </Section>
  );
}

export function ReviewArea({ accessToken, loading, run }: AreaContext) {
  const [items, setItems] = useState<StaffReviewItem[]>([]);
  const reload = () => run(async () => setItems((await getStaffReviewQueue(accessToken)).data));
  useAreaLoad(reload);
  return <ReviewView items={items} loading={loading} onRefresh={() => void reload()} />;
}
