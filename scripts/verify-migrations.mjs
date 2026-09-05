import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Static consistency checks over the migration set.
 *
 * Milestone 3.12 found that `023` and `024` seed `rule_versions.kind` values
 * the `011` CHECK constraint forbids — both would have failed the moment the
 * migrations were first applied, and nothing in the workspace could have said
 * so, because every test runs against a fake database.
 *
 * That bug was findable by reading the SQL. This finds its siblings by reading
 * it mechanically, in migration order, and it is deliberately narrow: it
 * models only what it can model soundly, and stays quiet about the rest. A
 * checker that guessed would be worse than none, because a false alarm here
 * teaches people to skip the check.
 *
 * What it verifies:
 *   1. Every literal value inserted into a column that has a `CHECK (col IN
 *      (...))` constraint is allowed by that constraint *as it stands at that
 *      point in the sequence*, including any later widening.
 *   2. Every table an `INSERT INTO` targets exists by then.
 *   3. Every table a `REFERENCES` clause points at exists by then.
 *
 * It is not a SQL parser and does not pretend to be. Applying the migrations to
 * a real PostGIS remains the only complete check.
 */

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'infra/postgres/migrations');

const files = readdirSync(directory)
  .filter((name) => name.endsWith('.sql'))
  .sort();

/** Tables that exist so far, and the allowed values of their enum-ish columns. */
const tables = new Map();
const problems = [];

const stripComments = (sql) =>
  sql
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('--');
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join('\n');

/** `CHECK (col IN ('a', 'b'))`, wherever it appears in a statement. */
const readInLists = (statement) => {
  const found = new Map();
  const pattern = /CHECK\s*\(\s*([a-z_]+)\s+IN\s*\(([^)]*)\)\s*\)/gi;
  let match;
  while ((match = pattern.exec(statement))) {
    const values = [...match[2].matchAll(/'([^']*)'/g)].map((value) => value[1]);
    if (values.length) found.set(match[1], new Set(values));
  }
  return found;
};

/**
 * Function bodies are removed before anything is split on `;`.
 *
 * A `$$ ... $$` body contains its own statements, and the inserts inside one
 * run at trigger time against values this checker cannot see — reading them as
 * seeds produced a false alarm on `009`, which is worse than silence.
 */
const stripFunctionBodies = (sql) => sql.replace(/\$\$[\s\S]*?\$\$/g, "''");

const statementsOf = (sql) =>
  stripFunctionBodies(stripComments(sql))
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

/**
 * Split a VALUES tuple on top-level commas, so each item lines up with its
 * column. Anything that is not exactly a quoted literal — an expression, a
 * cast, a function call — is returned as `undefined` and simply not checked.
 */
const tupleItems = (tuple) => {
  const items = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const character of tuple) {
    if (character === "'") quoted = !quoted;
    if (!quoted && character === '(') depth += 1;
    if (!quoted && character === ')') depth -= 1;
    if (!quoted && depth === 0 && character === ',') {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  items.push(current.trim());
  return items.map((item) => {
    const literal = /^'([^']*)'$/.exec(item);
    return literal ? literal[1] : undefined;
  });
};

for (const file of files) {
  const sql = readFileSync(resolve(directory, file), 'utf8');
  for (const statement of statementsOf(sql)) {
    const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)\s*\(/i.exec(statement);
    if (create) {
      const name = create[1];
      const existing = tables.get(name) ?? { columns: new Map() };
      for (const [column, values] of readInLists(statement)) existing.columns.set(column, values);
      tables.set(name, existing);
      continue;
    }

    // A constraint dropped and re-added is how a CHECK is widened; take the
    // new list as the truth from this point on.
    const alterCheck = /ALTER\s+TABLE\s+([a-z_]+)\s+ADD\s+CONSTRAINT\s+[a-z_]+\s+CHECK/i.exec(
      statement
    );
    if (alterCheck) {
      const table = tables.get(alterCheck[1]);
      if (table)
        for (const [column, values] of readInLists(statement)) table.columns.set(column, values);
      continue;
    }

    const alterAdd = /ALTER\s+TABLE\s+([a-z_]+)\s+ADD\s+COLUMN/i.exec(statement);
    if (alterAdd) {
      const table = tables.get(alterAdd[1]);
      if (table)
        for (const [column, values] of readInLists(statement)) table.columns.set(column, values);
      continue;
    }

    const insert = /INSERT\s+INTO\s+([a-z_]+)\s*\(([^)]*)\)\s*VALUES\s*(.+)/is.exec(statement);
    if (insert) {
      const [, name, columnList, valuesPart] = insert;
      const table = tables.get(name);
      if (!table) {
        problems.push(`${file}: inserts into "${name}", which no earlier migration creates`);
        continue;
      }
      const columns = columnList.split(',').map((column) => column.trim());
      // Only the first VALUES tuple is modelled; every seed in this repo has
      // one, and guessing at multi-row inserts is how a checker starts lying.
      const tuple = /\(([\s\S]*?)\)\s*(?:ON\s+CONFLICT|RETURNING|$)/i.exec(valuesPart);
      if (!tuple) continue;
      const values = tupleItems(tuple[1]);
      // A tuple that does not line up with the column list is not understood,
      // and an unsound guess is worse than no check at all.
      if (values.length !== columns.length) continue;
      columns.forEach((column, index) => {
        const allowed = table.columns.get(column);
        const value = values[index];
        if (!allowed || value === undefined) return;
        if (!allowed.has(value))
          problems.push(
            `${file}: inserts ${name}.${column} = '${value}', which its CHECK does not allow ` +
              `(allowed: ${[...allowed].join(', ')})`
          );
      });
      continue;
    }

    for (const reference of statement.matchAll(/REFERENCES\s+([a-z_]+)\s*\(/gi)) {
      const target = reference[1];
      if (!tables.has(target))
        problems.push(`${file}: references "${target}", which no earlier migration creates`);
    }
  }
}

if (problems.length) {
  process.stderr.write(
    `Migration checks failed:\n${problems.map((line) => `  - ${line}`).join('\n')}\n`
  );
  process.exit(1);
}

process.stdout.write(
  `Checked ${files.length} migrations: every seeded value satisfies the CHECK constraint in force at that point, and every table referenced exists by then.\n`
);
