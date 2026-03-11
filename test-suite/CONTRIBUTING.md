# Contributing Test Fixtures

This guide covers the style and structure rules for test fixtures in the `@dtcg/test-suite` package. All fixtures must follow these rules to keep the suite consistent and easy to navigate.

## `$schema`

Every fixture **must** include a `$schema` property as the first key, set to the canonical schema URL for the specification it belongs to. This is the same URL used as the `schemaId` in the corresponding manifest file.

## `$description`

Every fixture **must** include a root-level `$description` (or `description` for resolver fixtures) with a prefix indicating the test type:

- **PositiveEvaluationTest:** Prefix with `POSITIVE:` followed by a short, factual statement of what the fixture demonstrates.

  ```
  "POSITIVE: sRGB color with alpha transparency"
  ```

- **NegativeEvaluationTest:** Prefix with `NEGATIVE:` followed by a concise statement of the violation.

  ```
  "NEGATIVE: Alpha value exceeds maximum of 1"
  ```

Keep descriptions to a single sentence. Don't repeat constraint ranges unless they are non-obvious.

## Token and group naming

### Positive fixtures

Use the **token type name** as the root key, not a semantic name:

| ✅ Do           | ❌ Don't                          |
| --------------- | --------------------------------- |
| `"color"`       | `"brand-primary"`, `"text-color"` |
| `"dimension"`   | `"spacing"`, `"size"`             |
| `"number"`      | `"lineHeight"`, `"value"`         |
| `"fontFamily"`  | `"font"`, `"typeface"`            |
| `"fontWeight"`  | `"weight"`, `"boldness"`          |
| `"cubicBezier"` | `"easing"`, `"curve"`             |
| `"duration"`    | `"timing"`, `"speed"`             |
| `"border"`      | `"outline"`, `"divider"`          |
| `"shadow"`      | `"elevation"`, `"drop"`           |
| `"gradient"`    | `"background"`, `"fill"`          |
| `"strokeStyle"` | `"stroke"`, `"line"`              |
| `"transition"`  | `"animation"`, `"motion"`         |
| `"typography"`  | `"type"`, `"heading"`             |

When a fixture contains **multiple tokens of the same type**, use the pluralized type name as a wrapper group (e.g., `"dimensions"`, `"fontWeights"`).

**Exception:** Reference, group, and metadata tests that inherently need multiple groups or specific names for the test scenario to work may use descriptive names (e.g., `"colors"` and `"semantic"` in a reference test, or `"base-button"` and `"primary-button"` in an `$extends` test).

### Negative fixtures

Use `"invalid-{type}"` as the root key for the token or group that contains the violation:

```
"invalid-color", "invalid-dimension", "invalid-border", etc.
```

**Exceptions:** use a different name only when the name itself is part of what's being tested:

- Self-reference tests (the token name must match the reference target)
- Token-name violation tests (the invalid name is the point of the test)
- Circular reference tests (multiple tokens need distinct, descriptive names)

## One concern per fixture

Each fixture should test **exactly one thing**. Don't combine multiple edge cases or unrelated features in a single file. The manifest `id`, `name`, and `purpose` should all clearly reflect that single concern.

## Minimal fixtures

Keep fixtures as small as possible so the reader can instantly see what is being tested.

- Don't include optional properties unless they are the subject of the test. For example, don't add `"hex"` to a color unless the test is specifically about the `"hex"` property.
- Don't add `$description`, `$deprecated`, or `$extensions` to inner tokens unless they are the subject of the test.

### Standard filler values

When a fixture needs valid sub-values just to satisfy a composite type's requirements, use these consistent minimal values:

| Type         | Filler value                                      |
| ------------ | ------------------------------------------------- |
| Color        | `{"colorSpace": "srgb", "components": [0, 0, 0]}` |
| Dimension    | `{"value": 0, "unit": "px"}`                      |
| Duration     | `{"value": 0, "unit": "ms"}`                      |
| Number       | `0`                                               |
| Font family  | `"sans-serif"`                                    |
| Font weight  | `400`                                             |
| Cubic Bézier | `[0, 0, 1, 1]`                                    |
| Stroke style | `"solid"`                                         |

This makes the interesting part of the fixture, the thing actually being tested, stand out immediately.

## File naming

- **Positive fixtures:** `{what}.json` within the type folder (e.g., `positive/colors/srgb-basic.json`)
- **Negative fixtures:** `{type}-{what}.json` within the type folder (e.g., `negative/colors/color-alpha-out-of-range.json`)

## Manifest entry

Every fixture must have a corresponding entry in the relevant `manifest.json`. See the [test-suite README](./README.md) for the manifest format and required properties.
