import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const VERSION = '2025.10';
const BASE_ID = `https://www.designtokens.org/schemas/${VERSION}`;
const FORMAT_ID = `${BASE_ID}/format.json`;
const TOKEN_ID = `${BASE_ID}/format/token.json`;
const TOKEN_TYPE_PATH = join(
  ROOT_DIR,
  'src',
  VERSION,
  'format',
  'tokenType.json',
);
const OUTPUT_PATH = join(
  ROOT_DIR,
  'src',
  VERSION,
  'format',
  'typedScopes.json',
);

type JsonSchema = Record<string, unknown>;

interface TokenTypeSchema {
  enum: string[];
}

function definitionRef(name: string): JsonSchema {
  return {
    $ref: `${BASE_ID}/format/typedScopes.json#/definitions/${name}`,
  };
}

function hasProperty(name: string): JsonSchema {
  return {
    type: 'object',
    properties: { [name]: true },
    required: [name],
  };
}

function isToken(): JsonSchema {
  return {
    anyOf: [hasProperty('$value'), hasProperty('$ref')],
  };
}

function typeDispatcher(tokenTypes: string[], suffix: string): JsonSchema {
  let branch: JsonSchema = { not: {} };

  for (const type of [...tokenTypes].reverse()) {
    branch = {
      if: {
        type: 'object',
        properties: { $type: { const: type } },
        required: ['$type'],
      },
      then: definitionRef(`${type}${suffix}`),
      else: branch,
    };
  }

  return {
    type: 'object',
    properties: {
      $type: {
        $ref: `${BASE_ID}/format/tokenType.json`,
      },
    },
    required: ['$type'],
    ...branch,
  };
}

function valueRef(type: string): JsonSchema {
  return { $ref: `${BASE_ID}/format/values/${type}.json` };
}

function referenceOrValue(type: string): JsonSchema {
  return {
    oneOf: [
      valueRef(type),
      { $ref: `${FORMAT_ID}#/definitions/tokenValueReference` },
    ],
  };
}

function deprecatedProperty(): JsonSchema {
  return {
    oneOf: [{ type: 'boolean' }, { type: 'string' }],
    description: 'Whether this token or group is deprecated',
  };
}

function referenceExclusivity(): JsonSchema {
  return {
    description:
      'Tokens cannot define both $value and $ref; they must choose exactly one form of reference or direct value.',
    if: {
      required: ['$value'],
      properties: { $value: true },
    },
    then: {
      not: {
        required: ['$ref'],
        properties: { $ref: true },
      },
    },
    else: {
      required: ['$ref'],
      properties: { $ref: true },
    },
  };
}

function inheritedToken(type: string): JsonSchema {
  return {
    title: `Token inheriting ${type}`,
    description: `A token whose ${type} type is inherited from its nearest typed parent group.`,
    type: 'object',
    properties: {
      $value: {
        ...referenceOrValue(type),
        description: `A ${type} value or token value reference.`,
      },
      $ref: {
        $ref: `${FORMAT_ID}#/definitions/jsonPointerReference`,
        description:
          'JSON Pointer reference used instead of $value for property-level references.',
      },
      $description: {
        type: 'string',
        description: 'A plain text description of the token',
      },
      $extensions: {
        type: 'object',
        description: 'Vendor-specific extensions',
      },
      $deprecated: deprecatedProperty(),
    },
    additionalProperties: false,
    allOf: [referenceExclusivity()],
  };
}

function groupProperties(
  type: string,
  includeSchema: boolean,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    $type: {
      const: type,
      description: `Sets the inherited token type to ${type}.`,
    },
    $description: {
      type: 'string',
      description: "A plain text description of the group's purpose",
    },
    $extensions: {
      type: 'object',
      description: 'Vendor-specific extensions',
    },
    $extends: {
      oneOf: [
        { $ref: `${FORMAT_ID}#/definitions/curlyBraceReference` },
        { $ref: `${FORMAT_ID}#/definitions/jsonPointerReference` },
      ],
      description: 'Reference to another group to inherit from',
    },
    $deprecated: deprecatedProperty(),
    $root: {
      description: `Root token inheriting ${type}, unless overridden by its own $type.`,
      $ref: `${BASE_ID}/format/typedScopes.json#/definitions/${type}Token`,
    },
  };

  if (includeSchema) {
    properties.$schema = {
      type: 'string',
      format: 'uri-reference',
      description: 'URI reference to this JSON schema.',
    };
  }

  return properties;
}

function typedGroup(
  type: string,
  explicit: boolean,
  root: boolean,
): JsonSchema {
  const suffix = root
    ? 'ExplicitRootGroup'
    : explicit
      ? 'ExplicitGroup'
      : 'InheritedGroup';
  const childDefinition = `${type}Child`;
  const schema: JsonSchema = {
    title: `${type} ${root ? 'root ' : ''}${explicit ? 'explicit ' : 'inherited '}group`,
    description: explicit
      ? `A group that establishes a ${type} type scope.`
      : `A group that inherits the ${type} type scope from its parent.`,
    type: 'object',
    properties: groupProperties(type, root),
    patternProperties: {
      '^[^${}.][^{}.]*$': definitionRef(childDefinition),
    },
    additionalProperties: false,
  };

  if (explicit) {
    schema.required = ['$type'];
  } else {
    const properties = schema.properties as Record<string, unknown>;
    delete properties.$type;
  }

  schema.title = `${type}${suffix}`;
  return schema;
}

async function main(): Promise<void> {
  const tokenTypeSchema = JSON.parse(
    readFileSync(TOKEN_TYPE_PATH, 'utf-8'),
  ) as TokenTypeSchema;
  const tokenTypes = tokenTypeSchema.enum;
  const definitions: Record<string, unknown> = {
    explicitToken: {
      title: 'Explicitly typed token',
      description:
        "A token with its own $type. Its explicit type overrides the parent group's inherited type.",
      allOf: [
        { $ref: TOKEN_ID },
        {
          type: 'object',
          properties: { $type: true },
          required: ['$type'],
        },
      ],
    },
    explicitGroup: {
      title: 'Explicitly typed group',
      description:
        'A nested group whose own $type starts a new recursive type scope.',
      ...typeDispatcher(tokenTypes, 'ExplicitGroup'),
    },
    explicitRootGroup: {
      title: 'Explicitly typed root group',
      description: 'A token file whose root group establishes a type scope.',
      ...typeDispatcher(tokenTypes, 'ExplicitRootGroup'),
    },
  };

  for (const type of tokenTypes) {
    definitions[`${type}InheritedToken`] = inheritedToken(type);
    definitions[`${type}InheritedGroup`] = typedGroup(type, false, false);
    definitions[`${type}ExplicitGroup`] = typedGroup(type, true, false);
    definitions[`${type}ExplicitRootGroup`] = typedGroup(type, true, true);
    definitions[`${type}Token`] = {
      title: `Token in a ${type} type scope`,
      type: 'object',
      if: hasProperty('$type'),
      then: definitionRef('explicitToken'),
      else: definitionRef(`${type}InheritedToken`),
    };
    definitions[`${type}Child`] = {
      title: `Child in a ${type} type scope`,
      description:
        'An inherited group or token, or a group or token that overrides the inherited type.',
      type: 'object',
      if: hasProperty('$type'),
      then: {
        if: isToken(),
        then: definitionRef('explicitToken'),
        else: definitionRef('explicitGroup'),
      },
      else: {
        if: isToken(),
        then: definitionRef(`${type}InheritedToken`),
        else: definitionRef(`${type}InheritedGroup`),
      },
    };
  }

  const schema: JsonSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `${BASE_ID}/format/typedScopes.json`,
    title: 'Generated DTCG typed scopes',
    description:
      'Generated recursive schemas that carry group $type inheritance through arbitrarily nested groups.',
    $comment:
      'Generated by schemas/scripts/generate-typed-scopes.ts. Do not edit directly.',
    definitions,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const output = await prettier.format(JSON.stringify(schema, null, 2), {
    parser: 'json',
    filepath: OUTPUT_PATH,
  });
  writeFileSync(OUTPUT_PATH, output);
  console.log(`Generated: ${OUTPUT_PATH}`);
}

main().catch((error: unknown) => {
  console.error('Typed scope generation failed:', error);
  process.exit(1);
});
