import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The voice guide as a test (UX.6, UX.8, `docs/voice.md`). Every sentence-like
 * string in the app's screens, components and coach copy is checked for the
 * system words rule 3 bans and the shaming phrases rules 6 and Rho's section
 * ban. A string counts as copy when it holds a space and a word; identifiers,
 * keys and routes never do. Errors thrown for developers and log lines are
 * skipped, since a runner never sees them.
 */
const SRC = join(__dirname);

const SYSTEM_WORDS =
  /\b(server|servers|deployment|configured|configuration|validated|validation|derivation|derived|provenance|canonical|policy version|payload|eligible)\b/i;
const SHAMING =
  /\b(you failed|too slow|you missed|push harder|don't be lazy|you're behind|beat them|slowest)\b/i;

const SCANNED = ['screens', 'components', 'navigation', 'maps'];
const SCANNED_FILES = ['loop-guidance.ts', 'crew.ts'];

const sourceFiles = (): string[] => {
  const files: string[] = SCANNED_FILES.map((file) => join(SRC, file));
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(path);
    }
  };
  for (const dir of SCANNED) walk(join(SRC, dir));
  return files;
};

const isDeveloperOnly = (node: ts.Node): boolean => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isNewExpression(parent) && parent.expression.getText() === 'Error') return true;
    if (ts.isThrowStatement(parent)) return true;
    if (ts.isCallExpression(parent) && /^(console|logger)\./.test(parent.expression.getText()))
      return true;
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
    if (ts.isStatement(parent)) return false;
  }
  return false;
};

const copyIn = (file: string): { text: string; line: number }[] => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const found: { text: string; line: number }[] = [];
  const add = (node: ts.Node, text: string) => {
    if (!/\s/.test(text.trim()) || !/[A-Za-z]{2}/.test(text) || isDeveloperOnly(node)) return;
    found.push({ text, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node))
      add(
        node,
        [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' … ')
      );
    else if (ts.isJsxText(node)) add(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const violations = (pattern: RegExp) =>
  sourceFiles().flatMap((file) =>
    copyIn(file)
      .filter(({ text }) => pattern.test(text))
      .map(({ text, line }) => `${relative(SRC, file)}:${line}  ${text.trim()}`)
  );

describe('app copy follows docs/voice.md', () => {
  it('actually reads the app (guards against a scan that finds nothing)', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(40);
    expect(files.flatMap(copyIn).length).toBeGreaterThan(300);
  });

  it('uses runner words, not system words (rule 3)', () => {
    expect(violations(SYSTEM_WORDS)).toEqual([]);
  });

  it('never shames pace or effort (rule 6, Rho)', () => {
    expect(violations(SHAMING)).toEqual([]);
  });
});
