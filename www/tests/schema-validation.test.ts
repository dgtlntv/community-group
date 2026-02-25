import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

const paths = {
  rootDir: join(__dirname, '../..'),
  testsDir: join(__dirname, '../../tests'),
  schemaDir: join(__dirname, '../public/schemas/2025.10'),
} as const;

interface TestCase {
  id: string;
  type: 'PositiveEvaluationTest' | 'NegativeEvaluationTest';
  name: string;
  purpose: string;
  input: string;
  features?: string[];
}

interface SubManifest {
  name: string;
  description: string;
  version: string;
  schema: string;
  tests: TestCase[];
}

interface RootManifest {
  name: string;
  description: string;
  version: string;
  manifests: Array<{
    id: string;
    file: string;
    description: string;
  }>;
}

/**
 * Maps a manifest schema URL to a bundled schema filename.
 * The manifests reference schemas by their published URL; this maps to the
 * corresponding local bundled file.
 *
 * @param schemaUrl - The schema URL from the manifest
 * @returns The local filename of the bundled schema
 */
function schemaUrlToFilename(schemaUrl: string): string {
  const match = schemaUrl.match(/([\w-]+\.json)$/);
  if (!match) {
    throw new Error(`Cannot extract filename from schema URL: ${schemaUrl}`);
  }
  return match[1];
}

/**
 * Resolves a schema URL from the manifest to the $id used in the bundled schema.
 * The manifests use "https://designtokens.org/..." while schemas use
 * "https://www.designtokens.org/..." - this normalizes to the schema $id format.
 *
 * @param schemaUrl - The schema URL from the manifest
 * @returns The schema $id URL
 */
function resolveSchemaId(schemaUrl: string): string {
  return schemaUrl.replace(
    'https://designtokens.org/',
    'https://www.designtokens.org/'
  );
}

/**
 * Creates a fresh AJV instance with a single bundled schema loaded.
 * Each bundled schema is self-contained, so only one needs to be loaded at a time.
 *
 * @param schemaFilename - The filename of the bundled schema to load
 * @returns A configured AJV instance
 */
function createAjvWithSchema(schemaFilename: string): Ajv {
  const ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  const schemaPath = join(paths.schemaDir, schemaFilename);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  ajv.addSchema(schema);
  return ajv;
}

/**
 * Loads and parses a JSON file with descriptive error handling.
 *
 * @param filePath - The path to the JSON file
 * @param description - A human-readable description of the file for error messages
 * @returns The parsed JSON content
 * @throws Error if the file cannot be read or parsed
 */
function loadJsonFile<T>(filePath: string, description: string): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    throw new Error(
      `Failed to load ${description} at ${filePath}: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Checks if a test case requires preprocessing before it can be run.
 *
 * @param test - The test case to check
 * @returns True if the test requires preprocessing, false otherwise
 */
function requiresPreprocessing(test: TestCase): boolean {
  return test.features?.includes('preprocessing-required') ?? false;
}

/**
 * Formats AJV validation errors into a readable string.
 *
 * @param errors - The AJV validation errors
 * @returns A formatted string of errors, or a message if no errors
 */
function formatValidationErrors(errors: Ajv['errors']): string {
  if (!errors || errors.length === 0) {
    return '  (no validation errors)';
  }

  return errors
    .map((err) => {
      return [
        `  Path: ${err.instancePath || '(root)'}`,
        `  Message: ${err.message}`,
        err.params ? `  Params: ${JSON.stringify(err.params)}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

/**
 * Formats a test error message for both positive and negative test failures.
 *
 * @param testCase - The test case that failed
 * @param fixture - The fixture data used in the test
 * @param schemaId - The schema ID used for validation
 * @param errors - The AJV validation errors (if any)
 * @returns A formatted error message string
 */
function formatTestError(
  testCase: TestCase,
  fixture: unknown,
  schemaId: string,
  errors: Ajv['errors']
): string {
  const isPositiveTest = testCase.type === 'PositiveEvaluationTest';

  return [
    '',
    `Test: ${testCase.name}`,
    `Purpose: ${testCase.purpose}`,
    `Schema: ${schemaId}`,
    '',
    `Expected: ${isPositiveTest ? 'Valid' : 'Invalid'}`,
    `Actual: ${isPositiveTest ? 'Invalid' : 'Valid'}`,
    '',
    'Fixture:',
    JSON.stringify(fixture, null, 2),
    '',
    'Validation Errors:',
    formatValidationErrors(errors),
    '',
  ].join('\n');
}

const rootManifestPath = join(paths.testsDir, 'manifest.json');
const rootManifest = loadJsonFile<RootManifest>(rootManifestPath, 'root manifest');

for (const { id, file } of rootManifest.manifests) {
  const manifestPath = join(paths.testsDir, file);
  const subManifest = loadJsonFile<SubManifest>(manifestPath, `sub-manifest ${id}`);
  const testCases = subManifest.tests.filter((t) => !requiresPreprocessing(t));
  const schemaId = resolveSchemaId(subManifest.schema);
  const schemaFilename = schemaUrlToFilename(subManifest.schema);

  describe(subManifest.name, () => {
    let ajv: Ajv;

    beforeAll(() => {
      ajv = createAjvWithSchema(schemaFilename);
    });

    it.each(testCases)('$name: $purpose', (testCase) => {
      const validate = ajv.getSchema(schemaId);
      if (!validate) {
        throw new Error(`Schema not found: ${schemaId}`);
      }

      const fixturePath = join(paths.testsDir, id, testCase.input);
      const fixture = loadJsonFile(fixturePath, `fixture ${testCase.input}`);

      const isValid = validate(fixture);
      const expectedValid = testCase.type === 'PositiveEvaluationTest';

      expect(
        isValid,
        formatTestError(testCase, fixture, schemaId, validate.errors)
      ).toBe(expectedValid);
    });
  });
}
