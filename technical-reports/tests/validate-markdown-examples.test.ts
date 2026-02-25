import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse, ParseError, printParseErrorCode } from 'jsonc-parser';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

const paths = {
  trDir: join(__dirname, '..'),
  schemaDir: join(__dirname, '../../www/public/schemas/2025.10'),
} as const;

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

function loadSchemas(ajv: Ajv, dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      loadSchemas(ajv, full);
    } else if (entry.endsWith('.json')) {
      const schema = JSON.parse(readFileSync(full, 'utf-8'));
      ajv.addSchema(schema);
    }
  }
}

const FORMAT_SCHEMA_ID =
  'https://www.designtokens.org/schemas/2025.10/format.json';
const RESOLVER_SCHEMA_ID =
  'https://www.designtokens.org/schemas/2025.10/resolver.json';

// ---------------------------------------------------------------------------
// Markdown extraction
// ---------------------------------------------------------------------------

interface CodeBlock {
  /** The markdown file this block was extracted from */
  file: string;
  /** 1-indexed line number where the opening fence is */
  line: number;
  /** The raw code inside the fences */
  code: string;
  /** The language tag on the fence (json or jsonc) */
  lang: 'json' | 'jsonc';
}

/**
 * Collects all ```json / ```jsonc fenced code blocks from markdown files
 * found recursively under `dir`.
 */
function extractCodeBlocks(dir: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];

  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (entry === 'tests' || entry === 'node_modules') continue;
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        extractFromFile(full, blocks);
      }
    }
  }

  walk(dir);
  return blocks;
}

function extractFromFile(filePath: string, out: CodeBlock[]): void {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const openMatch = lines[i].match(/^```(jsonc?)\s*$/);
    if (openMatch) {
      const lang = openMatch[1] as 'json' | 'jsonc';
      const startLine = i + 1; // 1-indexed line of the fence
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      out.push({
        file: relative(paths.trDir, filePath),
        line: startLine,
        code: codeLines.join('\n'),
        lang,
      });
    }
    i++;
  }
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/**
 * Recursively checks whether an object (at any depth) contains a property
 * named `$type` or `$value`.
 */
function hasTokenProperties(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj))
    return false;
  const record = obj as Record<string, unknown>;
  if ('$type' in record || '$value' in record) return true;
  return Object.values(record).some((v) => hasTokenProperties(v));
}

/**
 * Returns true when the parsed JSON looks like a complete design-token file
 * or resolver file (i.e. not a fragment).
 *
 * - `$schema` at the top level  → not a fragment
 * - `$type` or `$value` anywhere → not a fragment
 */
function isFragment(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj))
    return true;
  const record = obj as Record<string, unknown>;
  if ('$schema' in record) return false;
  return !hasTokenProperties(record);
}

/**
 * Determines which schema to validate against based on the `$schema` field.
 */
function schemaIdFor(obj: Record<string, unknown>): string {
  const s = obj['$schema'];
  if (typeof s === 'string' && s.includes('resolver')) {
    return RESOLVER_SCHEMA_ID;
  }
  return FORMAT_SCHEMA_ID;
}

function formatErrors(errors: Ajv['errors']): string {
  if (!errors?.length) return '  (no errors)';
  return errors
    .map(
      (e) =>
        `  ${e.instancePath || '(root)'}: ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`,
    )
    .join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const blocks = extractCodeBlocks(paths.trDir);

let ajv: Ajv;

beforeAll(() => {
  ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  loadSchemas(ajv, paths.schemaDir);
});

describe('Markdown JSON examples', () => {
  describe('JSON parsing', () => {
    const jsonBlocks = blocks.filter((b) => b.lang === 'json');

    it.each(jsonBlocks)('$file:$line — must be valid JSON', (block) => {
      expect(
        () => JSON.parse(block.code),
        `Invalid JSON at ${block.file}:${block.line}`,
      ).not.toThrow();
    });
  });

  describe('JSONC parsing', () => {
    const jsoncBlocks = blocks.filter((b) => b.lang === 'jsonc');

    it.each(jsoncBlocks)('$file:$line — must be valid JSONC', (block) => {
      const errors: ParseError[] = [];
      parse(block.code, errors);
      const messages = errors.map(
        (e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`,
      );
      expect(
        errors,
        `Invalid JSONC at ${block.file}:${block.line}\n${messages.join('\n')}`,
      ).toHaveLength(0);
    });
  });

  describe('Schema validation', () => {
    // Parse all blocks (json via JSON.parse, jsonc via jsonc-parser) and keep
    // only those that parsed successfully and aren't fragments.
    const validatable = blocks
      .map((block) => {
        let parsed: unknown;
        try {
          if (block.lang === 'jsonc') {
            const errors: ParseError[] = [];
            parsed = parse(block.code, errors);
            if (errors.length > 0) return null;
          } else {
            parsed = JSON.parse(block.code);
          }
        } catch {
          return null; // parsing failures are caught by the tests above
        }
        if (isFragment(parsed)) return null;
        return { ...block, parsed };
      })
      .filter(
        (b): b is CodeBlock & { parsed: Record<string, unknown> } => b !== null,
      );

    it.each(validatable)(
      '$file:$line — must match design token schema',
      (block) => {
        const id = schemaIdFor(block.parsed);
        const validate = ajv.getSchema(id);
        if (!validate) throw new Error(`Schema not found: ${id}`);

        const valid = validate(block.parsed);
        expect(
          valid,
          [
            `Schema validation failed at ${block.file}:${block.line}`,
            `Schema: ${id}`,
            '',
            'Errors:',
            formatErrors(validate.errors),
            '',
            'Input:',
            JSON.stringify(block.parsed, null, 2),
          ].join('\n'),
        ).toBe(true);
      },
    );
  });
});
