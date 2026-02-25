import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerSchema } from "@hyperjump/json-schema/draft-07";
import { bundle } from "@hyperjump/json-schema/bundle";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCE_DIR = join(__dirname, "2025.10");
const OUTPUT_DIR = join(__dirname, "..", "www", "public", "schemas", "2025.10");

interface JsonSchema {
  $id?: string;
  [key: string]: unknown;
}

/**
 * Recursively find all .json files in a directory.
 */
function findJsonFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...findJsonFiles(fullPath));
    } else if (entry.endsWith(".json")) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Register all source schemas with hyperjump so the bundler can resolve references.
 */
function registerAllSchemas(): number {
  const files = findJsonFiles(SOURCE_DIR);
  for (const file of files) {
    const schema: JsonSchema = JSON.parse(readFileSync(file, "utf-8"));
    if (schema.$id) {
      registerSchema(schema, schema.$id);
      console.log(`  Registered: ${schema.$id}`);
    }
  }
  return files.length;
}

/**
 * Bundle a schema and write the result to the output directory.
 */
async function bundleSchema(
  schemaId: string,
  outputFilename: string
): Promise<void> {
  console.log(`\nBundling ${schemaId}...`);
  const bundled = await bundle(schemaId, {
    alwaysIncludeDialect: true,
    definitionNamingStrategy: "uri",
  });
  const outputPath = join(OUTPUT_DIR, outputFilename);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(bundled, null, 2) + "\n");
  console.log(`  Written to: ${outputPath}`);
}

/**
 * Clean the output directory of old unbundled schema subdirectories.
 */
function cleanOutput(): void {
  for (const entry of readdirSync(OUTPUT_DIR)) {
    const dirPath = join(OUTPUT_DIR, entry);
    if (statSync(dirPath).isDirectory()) {
      console.log(`  Removing: ${dirPath}`);
      rmSync(dirPath, { recursive: true });
    }
  }
}

async function main(): Promise<void> {
  console.log("Cleaning output directory...");
  mkdirSync(OUTPUT_DIR, { recursive: true });
  cleanOutput();

  console.log("\nRegistering source schemas...");
  const count = registerAllSchemas();
  console.log(`Registered ${count} schemas.`);

  await bundleSchema(
    "https://www.designtokens.org/schemas/2025.10/format.json",
    "format.json"
  );

  await bundleSchema(
    "https://www.designtokens.org/schemas/2025.10/resolver.json",
    "resolver.json"
  );

  console.log("\nDone! Bundled schemas written to:", OUTPUT_DIR);
}

main().catch((err: unknown) => {
  console.error("Bundle failed:", err);
  process.exit(1);
});
