/// <reference types="jest" />
/**
 * Unit tests for LinkML YAML validator
 */

import { validateLinkML, toMonacoMarkers } from '../../lib/linkml-validator';
import type { ValidationResult } from '../../lib/linkml-validator';

describe('LinkML Validator', () => {
  describe('validateLinkML', () => {
    it('validates a minimal valid LinkML schema', () => {
      const yaml = `id: https://example.org/ontology
name: test_ontology
prefixes:
  linkml: https://w3id.org/linkml/
  ex: https://example.org/
default_range: string
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates a schema with classes and attributes', () => {
      const yaml = `id: https://example.org/ontology
name: test_ontology
prefixes:
  linkml: https://w3id.org/linkml/
  ex: https://example.org/
default_range: string

classes:
  Person:
    attributes:
      name:
        range: string
        required: true
      age:
        range: integer
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('detects missing required key "id"', () => {
      const yaml = `name: test_ontology
prefixes:
  linkml: https://w3id.org/linkml/
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: 'Missing required LinkML key: "id"',
          severity: 'error',
          code: 'MISSING_REQUIRED_KEY',
        })
      );
    });

    it('detects missing required key "name"', () => {
      const yaml = `id: https://example.org/ontology
prefixes:
  linkml: https://w3id.org/linkml/
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: 'Missing required LinkML key: "name"',
          severity: 'error',
          code: 'MISSING_REQUIRED_KEY',
        })
      );
    });

    it('detects missing required key "prefixes"', () => {
      const yaml = `id: https://example.org/ontology
name: test_ontology
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: 'Missing required LinkML key: "prefixes"',
          severity: 'error',
          code: 'MISSING_REQUIRED_KEY',
        })
      );
    });

    it('reports warnings for unknown top-level keys', () => {
      const yaml = `id: https://example.org/ontology
name: test_ontology
prefixes:
  linkml: https://w3id.org/linkml/
unknown_key: some_value
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('Unknown top-level key: "unknown_key"'),
          severity: 'warning',
          code: 'UNKNOWN_KEY',
        })
      );
    });

    it('handles invalid YAML syntax', () => {
      const yaml = `id: https://example.org/ontology
name: test_ontology
prefixes:
  - invalid: - nested: bad:
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].severity).toBe('error');
      expect(result.errors[0].code).toBe('YAML_PARSE_ERROR');
    });

    it('handles empty YAML', () => {
      const result = validateLinkML('');
      expect(result.valid).toBe(false);
    });

    it('validates prefix values are strings', () => {
      const yaml = `id: https://example.org/ontology
name: test_ontology
prefixes:
  linkml: 123
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('must have a string URI value'),
          severity: 'error',
          code: 'INVALID_PREFIX',
        })
      );
    });

    it('validates class attributes are objects', () => {
      const yaml = `id: https://example.org/ontology
name: test_ontology
prefixes:
  linkml: https://w3id.org/linkml/
classes:
  Person:
    attributes:
      name: just_a_string
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('must be an object'),
          severity: 'error',
          code: 'INVALID_ATTRIBUTE',
        })
      );
    });

    it('validates slots are objects', () => {
      const yaml = `id: https://example.org/ontology
name: test_ontology
prefixes:
  linkml: https://w3id.org/linkml/
slots:
  name: just_a_string
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('must be an object'),
          severity: 'error',
          code: 'INVALID_SLOT',
        })
      );
    });

    it('reports warnings for unknown class keys', () => {
      const yaml = `id: https://example.org/ontology
name: test_ontology
prefixes:
  linkml: https://w3id.org/linkml/
classes:
  Person:
    unknown_attr: true
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('Unknown key'),
          severity: 'warning',
          code: 'UNKNOWN_CLASS_KEY',
        })
      );
    });

    it('handles complex nested schema', () => {
      const yaml = `id: https://example.org/ontology
name: test_ontology
prefixes:
  linkml: https://w3id.org/linkml/
  ex: https://example.org/
default_range: string

classes:
  Person:
    is_a: NamedThing
    attributes:
      name:
        range: string
        required: true
      age:
        range: integer
        minimum_value: 0
        maximum_value: 150

  Organization:
    attributes:
      name:
        range: string
        required: true

slots:
  works_for:
    range: Organization
    multivalued: true

types:
  integer:
    typeof: number
    uri: xsd:integer
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(true);
    });

    it('handles schema with enums', () => {
      const yaml = `id: https://example.org/ontology
name: test_ontology
prefixes:
  linkml: https://w3id.org/linkml/

enums:
  StatusEnum:
    permissible_values:
      active:
      inactive:
`;
      const result = validateLinkML(yaml);
      expect(result.valid).toBe(true);
    });

    it('handles non-object YAML content', () => {
      const result = validateLinkML('just a string');
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: 'YAML content must be an object (mapping)',
          severity: 'error',
          code: 'INVALID_STRUCTURE',
        })
      );
    });
  });

  describe('toMonacoMarkers', () => {
    it('converts errors to Monaco markers', () => {
      const result: ValidationResult = {
        valid: false,
        errors: [
          {
            line: 1,
            column: 1,
            message: 'Missing required key',
            severity: 'error',
            code: 'MISSING_KEY',
          },
        ],
        warnings: [],
      };

      const markers = toMonacoMarkers(result);
      expect(markers).toHaveLength(1);
      expect(markers[0]).toEqual({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
        message: 'Missing required key',
        severity: 8,
        code: 'MISSING_KEY',
      });
    });

    it('converts warnings to Monaco markers', () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [
          {
            line: 5,
            column: 3,
            message: 'Unknown key',
            severity: 'warning',
            code: 'UNKNOWN_KEY',
          },
        ],
      };

      const markers = toMonacoMarkers(result);
      expect(markers).toHaveLength(1);
      expect(markers[0]).toEqual({
        startLineNumber: 5,
        startColumn: 3,
        endLineNumber: 5,
        endColumn: 4,
        message: 'Unknown key',
        severity: 4,
        code: 'UNKNOWN_KEY',
      });
    });

    it('handles empty result', () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
      };

      const markers = toMonacoMarkers(result);
      expect(markers).toHaveLength(0);
    });
  });
});
