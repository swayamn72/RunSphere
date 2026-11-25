import { useState, type ComponentProps } from 'react';
import { DataTable } from './DataTable.js';
import { TableToolbar } from './TableToolbar.js';

/**
 * A `DataTable` with a search box above it. The caller says which text a row
 * answers to (`searchText`), so a search for an id, a title or a status finds
 * the row without the table guessing from rendered markup.
 */
export function SearchableTable<Row>({
  searchLabel,
  searchText,
  rows,
  emptyMessage,
  ...table
}: ComponentProps<typeof DataTable<Row>> & {
  searchLabel: string;
  searchText: (row: Row) => string;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => searchText(row).toLowerCase().includes(needle))
    : rows;
  return (
    <>
      <TableToolbar
        label={searchLabel}
        query={query}
        onQueryChange={setQuery}
        shown={shown.length}
        total={rows.length}
      />
      <DataTable
        {...table}
        rows={shown}
        emptyMessage={needle && rows.length > 0 ? 'Nothing matches that search.' : emptyMessage}
      />
    </>
  );
}
