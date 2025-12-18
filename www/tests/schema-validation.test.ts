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
 * Extracts the schema ID from a full schema URL.
 *
 * @param schemaUrl - The full schema URL (e.g., "https://designtokens.org/schemas/2025.10/format.json")
 * @returns The extracted schema ID (e.g., "schemas/2025.10/format.json")
 * @throws Error if the URL format is invalid
 *
 * @example
 * extractSchemaId("https://designtokens.org/schemas/2025.10/format.json")
 * // Returns: "schemas/2025.10/format.json"
 */
function extractSchemaId(schemaUrl: string): string {
  const match = schemaUrl.match(/schemas\/[\d.]+\/[\w-]+\.json$/);
  if (!match) {
    throw new Error(`Invalid schema URL format: ${schemaUrl}`);
  }
  return match[0];
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
 * Formats a validation error into a human-readable message.
 *
 * @param testCase - The test case that failed validation
 * @param errors - The AJV validation errors
 * @returns A formatted error message string
 */
function formatValidationError(
  testCase: TestCase,
  errors: Ajv['errors']
): string {
  return [
    `Expected ${testCase.name} to pass validation but it failed.`,
    `Purpose: ${testCase.purpose}`,
    `Errors: ${JSON.stringify(errors, null, 2)}`,
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
  const schemaId = extractSchemaId(subManifest.schema);

  describe(subManifest.name, () => {
    it.each(testCases)('$name: $purpose', (testCase) => {
      const validate = ajv.getSchema(schemaId);
      if (!validate) {
        throw new Error(`Schema not found: ${schemaId}`);
      }

      const fixturePath = join(paths.testsDir, id, testCase.input);
      const fixture = loadJsonFile(fixturePath, `fixture ${testCase.input}`);

      const isValid = validate(fixture);

      if (testCase.type === 'PositiveEvaluationTest') {
        expect(isValid, formatValidationError(testCase, validate.errors)).toBe(true);
      } else if (testCase.type === 'NegativeEvaluationTest') {
        expect(isValid, `Expected ${testCase.name} to fail validation but it passed`).toBe(false);
        expect(validate.errors).toBeDefined();
        expect(validate.errors?.length).toBeGreaterThan(0);
      } else {
        const _exhaustive: never = testCase.type;
        throw new Error(`Unknown test type: ${_exhaustive}`);
      }
    });
  });
}