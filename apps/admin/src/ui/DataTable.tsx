import type { ReactNode } from 'react';

export interface Column<Row> {
  key: string;
  header: string;
  /** Numbers read right-aligned in equal-width digits. */
  numeric?: boolean;
  render: (row: Row) => ReactNode;
}

/**
 * A real table: a caption for assistive tech, a sticky header, numeric columns
 * aligned, and one row that says so when there is nothing to show. The wrapper
 * is focusable so a wide table can be scrolled from the keyboard.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  emptyMessage
}: {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  emptyMessage: string;
}) {
  return (
    <div className="rs-table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className="rs-table">
        <caption className="rs-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.numeric ? 'rs-table__num' : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="rs-table__empty">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.numeric ? 'rs-table__num' : undefined}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
