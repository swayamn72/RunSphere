import { useState } from 'react';
import { getStaffReviewQueue, type StaffReviewItem } from './api.js';
import type { AreaContext } from './area-types.js';
import { useAreaLoad } from './use-area-load.js';
import { Button, Dialog, SearchableTable, Section, StatusTag, type Column } from './ui/index.js';

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
  const [open, setOpen] = useState<StaffReviewItem>();
  const shown = status === 'all' ? items : items.filter((item) => item.status === status);
  return (
    <>
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
        <SearchableTable
          searchLabel="Search submissions"
          searchText={(item) => `${item.id} ${readableStatus(item.status)} ${reviewNote(item)}`}
          onRowOpen={setOpen}
          rowLabel={(item) => item.id}
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
      <Dialog
        variant="drawer"
        open={open !== undefined}
        title="Submission"
        onClose={() => setOpen(undefined)}
        footer={
          <Button variant="secondary" onClick={() => setOpen(undefined)}>
            Close
          </Button>
        }
      >
        {open ? (
          <dl className="rs-detail">
            <div>
              <dt>Submission</dt>
              <dd>
                <code>{open.id}</code>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusTag tone={statusTone(open.status)}>{readableStatus(open.status)}</StatusTag>
              </dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{new Date(open.submittedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Why it is here</dt>
              <dd>{open.rejectionReason ?? 'Awaiting validation'}</dd>
            </div>
            {open.validationErrors.length ? (
              <div>
                <dt>Validation notes</dt>
                <dd>
                  <ul>
                    {open.validationErrors.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Dialog>
    </>
  );
}

export function ReviewArea({ accessToken, loading, run }: AreaContext) {
  const [items, setItems] = useState<StaffReviewItem[]>([]);
  const reload = () => run(async () => setItems((await getStaffReviewQueue(accessToken)).data));
  useAreaLoad(reload);
  return <ReviewView items={items} loading={loading} onRefresh={() => void reload()} />;
}
