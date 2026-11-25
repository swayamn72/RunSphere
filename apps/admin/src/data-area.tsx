import { useState } from 'react';
import { RULES_READ_ONLY_NOTE } from './areas.js';
import { getRuleVersions, type RuleVersion } from './api.js';
import type { AreaContext } from './area-types.js';
import { useAreaLoad } from './use-area-load.js';
import { Button, type Column, Notice, SearchableTable, Section, StatusTag } from './ui/index.js';

const columns: readonly Column<RuleVersion>[] = [
  {
    key: 'kind',
    header: 'Kind',
    render: (rule) => (
      <>
        {rule.kind} {rule.live ? <StatusTag tone="success">live</StatusTag> : null}
      </>
    )
  },
  { key: 'version', header: 'Version', numeric: true, render: (rule) => `v${rule.version}` },
  {
    key: 'effective',
    header: 'Effective',
    render: (rule) => new Date(rule.effectiveAt).toLocaleDateString()
  },
  {
    key: 'definition',
    header: 'Definition',
    render: (rule) => <code>{JSON.stringify(rule.definition)}</code>
  }
];

export const filterRules = (rules: readonly RuleVersion[], text: string) => {
  const needle = text.trim().toLowerCase();
  return needle ? rules.filter((rule) => rule.kind.toLowerCase().includes(needle)) : rules;
};

/** Read-only: rules are published by migration, so what is live is what review put there. */
export function RulesView({
  rules,
  loading,
  onRefresh
}: {
  rules: readonly RuleVersion[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [text, setText] = useState('');
  const shown = filterRules(rules, text);
  return (
    <>
      <Notice tone="readonly">{RULES_READ_ONLY_NOTE}</Notice>
      <Section
        title="What is live, and since when"
        actions={
          <>
            <label className="rs-inline-filter">
              <span>Kind</span>
              <input
                type="search"
                value={text}
                placeholder="Filter by kind"
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <Button variant="secondary" busy={loading} onClick={onRefresh}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </>
        }
      >
        <SearchableTable
          searchLabel="Search rules"
          searchText={(rule) => `${rule.kind} v${rule.version}`}
          caption="Published rules"
          columns={columns}
          rows={shown}
          rowKey={(rule) => `${rule.kind}-${rule.version}`}
          emptyMessage={
            loading
              ? 'Loading…'
              : rules.length > 0
                ? 'No rule matches that kind.'
                : 'No rule has been published on this deployment.'
          }
        />
      </Section>
    </>
  );
}

export function DataArea({ accessToken, loading, run }: AreaContext) {
  const [rules, setRules] = useState<RuleVersion[]>([]);
  const reload = () => run(async () => setRules((await getRuleVersions(accessToken)).data));
  useAreaLoad(reload);
  return <RulesView rules={rules} loading={loading} onRefresh={() => void reload()} />;
}
