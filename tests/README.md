# Design Tokens Test Suite

Test fixtures for the [Design Tokens Community Group (DTCG)](https://designtokens.org) specifications. These fixtures serve two purposes:

1. **Schema validation** - Test the JSON schemas located in `/www/public/schemas/`
2. **Implementation testing** - Provide standardized test cases for third-party tools implementing the DTCG specifications

## Structure

```
tests/
├── manifest.json              # Root manifest referencing all sub-manifests
├── format/                    # Format specification tests
│   ├── manifest.json         # Format test manifest
│   ├── positive/             # Valid token files (PositiveEvaluationTest)
│   └── negative/             # Invalid token files (NegativeEvaluationTest)
├── resolver/                  # Resolver specification tests
│   ├── manifest.json         # Resolver test manifest
│   ├── positive/             # Valid resolver files (PositiveEvaluationTest)
│   └── negative/             # Invalid resolver files (NegativeEvaluationTest)
└── README.md                  # This file
```

## Manifest Format

### Root Manifest (`manifest.json`)

The root manifest references all sub-manifests:

```json
{
  "name": "Design Tokens Test Suite",
  "description": "Test fixtures for DTCG specifications",
  "version": "2025.10",
  "manifests": [
    {
      "id": "format",
      "file": "format/manifest.json",
      "description": "Tests for the Format specification"
    }
  ]
}
```

### Sub-Manifests (`format/manifest.json`, `resolver/manifest.json`)

Each sub-manifest contains individual test cases:

```json
{
  "name": "Format Specification Tests",
  "version": "2025.10",
  "schema": "https://designtokens.org/schemas/2025.10/format.json",
  "tests": [
    {
      "id": "color-srgb-basic",
      "type": "PositiveEvaluationTest",
      "name": "Basic sRGB color token",
      "purpose": "Verifies that a simple color token with sRGB color space is valid",
      "input": "positive/color-srgb-basic.json",
      "features": ["color", "srgb"]
    }
  ]
}
```

### Test Entry Properties

| Property   | Required | Description                                                 |
| ---------- | -------- | ----------------------------------------------------------- |
| `id`       | Yes      | Unique identifier for the test (e.g., "color-srgb-basic")   |
| `type`     | Yes      | Either "PositiveEvaluationTest" or "NegativeEvaluationTest" |
| `name`     | Yes      | Human-readable test name                                    |
| `purpose`  | Yes      | Explanation of what the test verifies                       |
| `input`    | Yes      | Path to test fixture file (relative to manifest)            |
| `features` | No       | Array of features being tested (e.g., ["color", "srgb"])    |

## Test Organization

Tests are organized into folders by their **primary feature**. Each test goes into the folder of the main feature being tested. Not all folders need to exist in both `positive/` and `negative/`.

### Format Tests

**Token type folders:**
`colors`, `dimensions`, `fontFamily`, `fontWeight`, `durations`, `cubicBezier`, `numbers`, `strokeStyles`, `borders`, `transitions`, `shadows`, `gradients`, `typography`

**Cross-cutting concern folders:**

- `references` - Reference resolution (`{token}` and `#/json/pointer`)
- `groups` - Group behavior, nesting, `$extends`
- `metadata` - Token-level `$description`, `$deprecated`, `$extensions`
- `token-name` - Token naming rules

**Allowed features:**

- Token types: `color`, `dimension`, `fontFamily`, `fontWeight`, `duration`, `cubicBezier`, `number`, `strokeStyle`, `border`, `transition`, `shadow`, `gradient`, `typography`
- Color spaces: `srgb`, `srgb-linear`, `hsl`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `display-p3`, `rec2020`, `prophoto-rgb`, `a98-rgb`, `xyz-d50`, `xyz-d65`
- Cross-cutting: `references`, `json-pointer`, `groups`, `type-inheritance`, `extends`, `metadata`, `token-name`, `composite`, `preprocessing-required`

Use `preprocessing-required` for tests that need reference resolution, type inheritance, or `$extends` processing before validation.

### Resolver Tests

**Resolver component folders:**

- `sets` - Token set definition and usage
- `modifiers` - Modifier definition and usage
- `resolution-order` - Resolution order rules
- `metadata` - Document-level properties (`version`, `name`, `description`, `$defs`)

**Allowed features:**
`sets`, `modifiers`, `resolution-order`, `metadata`, `contexts`, `inline`, `reference`

## Test Types

### PositiveEvaluationTest

Tests that **should pass** validation. These are examples of valid design tokens or resolver files according to the specification.

**Example**: A properly formatted color token with all required properties and valid values.

### NegativeEvaluationTest

Tests that **should fail** validation. These demonstrate invalid structures, missing required properties, or constraint violations.

**Example**: A color token with a component value outside the valid range.
