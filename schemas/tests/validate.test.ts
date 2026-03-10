/**
 * Schema validation tests.
 *
 * Loads the bundled schemas from `dist/` and validates them against
 * the test fixtures in the `test-suite` package. Test discovery is
 * driven by the manifest files in `test-suite/tests/`.
 *
 * Each sub-manifest gets its own AJV instance with only the relevant
 * bundled schema loaded, since the bundled files are self-contained.
 *
 * Requires `pnpm run build` to have been run first so that
 * `dist/` contains the bundled schemas.
 */
import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Manifest types (mirrors the structure in test-suite)
// ---------------------------------------------------------------------------

/** A single test case entry in a sub-manifest. */
interface TestCase {
  /** Unique identifier for the test. */
  id: string;
  /** Whether the fixture should pass or fail validation. */
  type: 'PositiveEvaluationTest' | 'NegativeEvaluationTest';
  /** Human-readable test name. */
  name: string;
  /** Explanation of what the test verifies. */
  purpose: string;
  /** Path to the fixture file, relative to the sub-manifest directory. */
  input: string;
  /** Optional list of features exercised by this test. */
  features?: string[];
}

/** A sub-manifest for a single schema (format or resolver). */
interface SubManifest {
  name: string;
  version: string;
  /** The `$id` of the schema to validate against. */
  schemaId: string;
  tests: TestCase[];
}

/** The root manifest that references all sub-manifests. */
interface RootManifest {
  name: string;
  version: string;
  manifests: Array<{
    id: string;
    file: string;
  }>;
}

// ---------------------------------------------------------------------------
// Config type (mirrors schemas.config.json)
// ---------------------------------------------------------------------------

interface SchemasConfig {
  versions: Array<{
    version: string;
    entrySchemas: Array<{
      id: string;
      filename: string;
    }>;
  }>;
  /** Directory containing bundled schema output, relative to the package root. */
  distDir: string;
  /** Directory containing test-suite fixtures, relative to the package root. */
  testSuiteDir: string;
  outputDirs: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JSON file with a clear error on failure.
 *
 * @param filePath - Absolute path to the JSON file.
 * @param label - Human-readable label used in error messages.
 */
function loadJson<T>(filePath: string, label: string): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load ${label} at ${filePath}: ${message}`);
  }
}

/**
 * Create an AJV instance and load a single bundled schema into it.
 * Each bundled file is self-contained with all embedded sub-schemas,
 * so one call to `addSchema` registers everything needed.
 *
 * @param schemaPath - Absolute path to the bundled schema file.
 */
function createValidator(schemaPath: string): Ajv {
  const ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  const schema = loadJson(schemaPath, `bundled schema ${schemaPath}`);
  ajv.addSchema(schema);
  return ajv;
}

/**
 * Find the bundled schema file that contains the given `$id`.
 *
 * @param schemaId - The `$id` URI to look up.
 * @param version - The spec version to search in.
 * @param entrySchemas - The entry schemas declared in config.
 */
function findBundledSchemaPath(
  schemaId: string,
  version: string,
  entrySchemas: SchemasConfig['versions'][number]['entrySchemas'],
): string {
  const entry = entrySchemas.find((e) => e.id === schemaId);
  if (!entry) {
    throw new Error(
      `No bundled schema found for $id "${schemaId}". ` +
        `Known ids: ${entrySchemas.map((e) => e.id).join(', ')}`,
    );
  }
  return join(DIST_DIR, version, entry.filename);
}

/**
 * Format AJV errors into a readable string for test failure messages.
 *
 * @param errors - The error array from `validate.errors`.
 */
function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return '  (no errors)';

  return errors
    .map((err) =>
      [
        `  Path: ${err.instancePath || '(root)'}`,
        `  Message: ${err.message}`,
        err.params ? `  Params: ${JSON.stringify(err.params)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

/**
 * Build a descriptive failure message for a test case.
 *
 * @param testCase - The test case that failed.
 * @param fixture - The parsed fixture data.
 * @param schemaId - The `$id` of the schema used.
 * @param errors - AJV validation errors, if any.
 */
function failureMessage(
  testCase: TestCase,
  fixture: unknown,
  schemaId: string,
  errors: ErrorObject[] | null | undefined,
): string {
  const expected =
    testCase.type === 'PositiveEvaluationTest' ? 'Valid' : 'Invalid';
  const actual =
    testCase.type === 'PositiveEvaluationTest' ? 'Invalid' : 'Valid';

  return [
    '',
    `Test: ${testCase.name}`,
    `Purpose: ${testCase.purpose}`,
    `Schema: ${schemaId}`,
    '',
    `Expected: ${expected}`,
    `Actual: ${actual}`,
    '',
    'Fixture:',
    JSON.stringify(fixture, null, 2),
    '',
    'Validation errors:',
    formatErrors(errors),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Test generation from manifests
// ---------------------------------------------------------------------------

const config = loadJson<SchemasConfig>(
  join(ROOT_DIR, 'schemas.config.json'),
  'schemas config',
);

const DIST_DIR = join(ROOT_DIR, config.distDir);
const TEST_SUITE_DIR = join(ROOT_DIR, config.testSuiteDir);

for (const { version, entrySchemas } of config.versions) {
  const versionDir = join(TEST_SUITE_DIR, version);
  const rootManifest = loadJson<RootManifest>(
    join(versionDir, 'manifest.json'),
    `root manifest for ${version}`,
  );

  describe(`v${version}`, () => {
    for (const { id, file } of rootManifest.manifests) {
      const manifestPath = join(versionDir, file);
      const manifestDir = dirname(manifestPath);
      const subManifest = loadJson<SubManifest>(manifestPath, `${id} manifest`);

      const schemaPath = findBundledSchemaPath(
        subManifest.schemaId,
        version,
        entrySchemas,
      );

      // Skip tests that require preprocessing (reference resolution,
      // type inheritance, $extends) since schema validation alone
      // cannot verify those.
      const testCases = subManifest.tests.filter(
        (t) => !t.features?.includes('preprocessing-required'),
      );

      describe(subManifest.name, () => {
        let ajv: Ajv;

        it.each(testCases)('$name', (testCase) => {
          // Lazily create the validator on first test so the describe
          // block itself does not throw if dist/ is missing.
          if (!ajv) {
            ajv = createValidator(schemaPath);
          }

          const validate = ajv.getSchema(subManifest.schemaId);
          if (!validate) {
            throw new Error(`Schema not found: ${subManifest.schemaId}`);
          }

          const fixturePath = join(manifestDir, testCase.input);
          const fixture = loadJson(fixturePath, `fixture ${testCase.input}`);

          const isValid = validate(fixture);
          const shouldBeValid = testCase.type === 'PositiveEvaluationTest';

          expect(
            isValid,
            failureMessage(
              testCase,
              fixture,
              subManifest.schemaId,
              validate.errors,
            ),
          ).toBe(shouldBeValid);
        });
      });
    }
  });
}
