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
 * Recursively loads all JSON schema files from a directory into the AJV instance.
 *
 * @param ajv - The AJV instance to add schemas to
 * @param dir - The directory path to scan for schema files
 */
function loadSchemas(ajv: Ajv, dir: string): void {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      loadSchemas(ajv, filePath);
    } else if (file.endsWith('.json')) {
      const schema = JSON.parse(readFileSync(filePath, 'utf-8'));
      ajv.addSchema(schema);
    }
  }
}

/**
 * Normalizes a schema URL to match the format used in schema $id properties.
 *
 * @param schemaUrl - The schema URL from the manifest (e.g., "https://designtokens.org/schemas/2025.10/format.json")
 * @returns The normalized schema ID matching the $id format (e.g., "https://www.designtokens.org/schemas/2025.10/format.json")
 * @throws Error if the URL format is invalid
 *
 * @example
 * normalizeSchemaId("https://designtokens.org/schemas/2025.10/format.json")
 * // Returns: "https://www.designtokens.org/schemas/2025.10/format.json"
 */
function normalizeSchemaId(schemaUrl: string): string {
  // Validate the URL format
  if (!schemaUrl.includes('designtokens.org/schemas/')) {
    throw new Error(`Invalid schema URL format: ${schemaUrl}`);
  }
  // Normalize to match schema $id format (ensure www. prefix)
  return schemaUrl.replace(
    'https://designtokens.org/',
    'https://www.designtokens.org/'
  );
}

/**
 * Loads and parses a JSON file with descriptive error handling.
 *
 * @param filePath - The path to the JSON file
 * @param description - A human-readable description of the file for error messages
 * @returns The parsed JSON content
 * @throws Error if the file cannot be read or parsed
 *
 * @example
 * const manifest = loadJsonFile<RootManifest>('./manifest.json', 'root manifest');
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

let ajv: Ajv;

beforeAll(() => {
  ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  loadSchemas(ajv, paths.schemaDir);
});

for (const { id, file } of rootManifest.manifests) {
  const manifestPath = join(paths.testsDir, file);
  const subManifest = loadJsonFile<SubManifest>(manifestPath, `sub-manifest ${id}`);
  const testCases = subManifest.tests.filter((t) => !requiresPreprocessing(t));
  const schemaId = normalizeSchemaId(subManifest.schema);

  describe(subManifest.name, () => {
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