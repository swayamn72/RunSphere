import { useState } from 'react';
import { PRIVACY_READ_ONLY_NOTE, privacyNeedsAttention } from './areas.js';
import { getPrivacyQueue, type PrivacyRequest } from './api.js';
import type { AreaContext } from './area-types.js';
import { useAreaLoad } from './use-area-load.js';
import { Button, type Column, Notice, SearchableTable, Section, StatusTag } from './ui/index.js';

const columns: readonly Column<PrivacyRequest>[] = [
  { key: 'account', header: 'Account', render: (request) => <code>{request.accountId}</code> },
  { key: 'kind', header: 'Request', render: (request) => <StatusTag>{request.kind}</StatusTag> },
  {
    key: 'open',
    header: 'Open for',
    numeric: true,
    render: (request) => (
      <>
        {privacyNeedsAttention(request) ? <StatusTag tone="warning">needs a look</StatusTag> : null}{' '}
        {request.openForHours} h
      </>
    )
  }
];

/** Read-only by design: the worker performs erasure, never this console. */
export function PrivacyView({
  requests,
  completedDeletions,
  loading,
  onRefresh
}: {
  requests: readonly PrivacyRequest[];
  completedDeletions: number;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [attentionOnly, setAttentionOnly] = useState(false);
  const shown = attentionOnly ? requests.filter(privacyNeedsAttention) : requests;
  return (
    <>
      <Notice tone="readonly">{PRIVACY_READ_ONLY_NOTE}</Notice>
      <Section
        title="Exports and erasures"
        description={`${completedDeletions} erasures have converged. Who they were is not recorded here — that is what erasure means.`}
        actions={
          <>
            <label className="rs-inline-filter">
              <input
                type="checkbox"
                checked={attentionOnly}
                onChange={(event) => setAttentionOnly(event.target.checked)}
              />
              <span>Needs a look only</span>
            </label>
            <Button variant="secondary" busy={loading} onClick={onRefresh}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </>
        }
      >
        <SearchableTable
          searchLabel="Search requests"
          searchText={(request) => `${request.accountId} ${request.kind}`}
          caption="Open privacy requests"
          columns={columns}
          rows={shown}
          rowKey={(request) => `${request.accountId}-${request.kind}`}
          emptyMessage={
            loading
              ? 'Loading…'
              : requests.length > 0
                ? 'Nothing needs a look.'
                : 'Nothing is waiting.'
          }
        />
      </Section>
    </>
  );
}

export function PrivacyArea({ accessToken, loading, run }: AreaContext) {
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [completedDeletions, setCompletedDeletions] = useState(0);
  const reload = () =>
    run(async () => {
      const queue = await getPrivacyQueue(accessToken);
      setRequests(queue.data);
      setCompletedDeletions(queue.completedDeletions);
    });
  useAreaLoad(reload);
  return (
    <PrivacyView
      requests={requests}
      completedDeletions={completedDeletions}
      loading={loading}
      onRefresh={() => void reload()}
    />
  );
}
