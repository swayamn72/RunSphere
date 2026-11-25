import type { ReactNode } from 'react';
import { Button } from './Button.js';

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
  emptyMessage,
  onRowOpen,
  rowLabel
}: {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  emptyMessage: string;
  /** Adds a Details button to every row, for the screen to open a drawer. */
  onRowOpen?: (row: Row) => void;
  /** Names a row for that button, for example the submission id. */
  rowLabel?: (row: Row) => string;
}) {
  const span = columns.length + (onRowOpen ? 1 : 0);
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
            {onRowOpen ? (
              <th scope="col">
                <span className="rs-visually-hidden">Details</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={span} className="rs-table__empty">
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
                {onRowOpen ? (
                  <td>
                    <Button
                      variant="ghost"
                      aria-label={rowLabel ? `Details for ${rowLabel(row)}` : 'Details'}
                      onClick={() => onRowOpen(row)}
                    >
                      Details
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
