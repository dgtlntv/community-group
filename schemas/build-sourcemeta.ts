import { execSync } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCE_DIR = join(__dirname, "2025.10");
const OUTPUT_DIR = join(__dirname, "..", "www", "public", "schemas", "2025.10");

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

/**
 * Bundle a schema using the @sourcemeta/jsonschema CLI `bundle` command.
 */
function bundleSchema(entrySchema: string, outputFilename: string): void {
  const outputPath = join(OUTPUT_DIR, outputFilename);
  mkdirSync(dirname(outputPath), { recursive: true });

  console.log(`\nBundling ${entrySchema}...`);

  const result = execSync(
    `npx jsonschema bundle ${entrySchema} --resolve ${SOURCE_DIR}`,
    { cwd: __dirname, encoding: "utf-8" }
  );

  // Pretty-print the output
  const bundled = JSON.parse(result);
  writeFileSync(outputPath, JSON.stringify(bundled, null, 2) + "\n");
  console.log(`  Written to: ${outputPath}`);
}

function main(): void {
  console.log("Cleaning output directory...");
  mkdirSync(OUTPUT_DIR, { recursive: true });
  cleanOutput();

  const formatSchema = join(SOURCE_DIR, "format.json");
  const resolverSchema = join(SOURCE_DIR, "resolver.json");

  bundleSchema(formatSchema, "format.json");
  bundleSchema(resolverSchema, "resolver.json");

  console.log("\nDone! Bundled schemas written to:", OUTPUT_DIR);
}

main();
