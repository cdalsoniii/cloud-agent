/**
 * LinkML YAML Validator
 * Provides validation for LinkML ontology schemas
 */

import * as yaml from 'js-yaml';

export interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

// Required LinkML top-level keys
const REQUIRED_LINKML_KEYS = ['id', 'name', 'prefixes'];

// Valid LinkML top-level keys
const VALID_LINKML_KEYS = [
  'id',
  'name',
  'description',
  'prefixes',
  'default_range',
  'imports',
  'classes',
  'slots',
  'types',
  'enums',
  'subsets',
  'rules',
  'default_namespace',
  'default_curi_maps',
  'emit_prefixes',
  'annotations',
  'extensions',
  'title',
  'license',
  'see_also',
  'comments',
  'from_schema',
  'generation_date',
  'source',
];

// Valid class attributes
const VALID_CLASS_KEYS = [
  'is_a',
  'mixins',
  'attributes',
  'slots',
  'slot_usage',
  'description',
  'comments',
  'notes',
  'see_also',
  'in_subset',
  'status',
  'deprecated',
  'abstract',
  'mixin',
  'tree_root',
  'class_uri',
  'annotations',
  'extensions',
  'examples',
  'alt_descriptions',
  'identifier',
  'aliases',
  'structured_aliases',
  'local_names',
  'exact_mappings',
  'close_mappings',
  'related_mappings',
  'narrow_mappings',
  'broad_mappings',
  'created_by',
  'created_on',
  'last_updated_on',
  'modified_by',
  'mappings',
  'rank',
];

// Valid slot/attribute keys
const VALID_SLOT_KEYS = [
  'range',
  'required',
  'multivalued',
  'description',
  'comments',
  'notes',
  'see_also',
  'in_subset',
  'status',
  'deprecated',
  'identifier',
  'key',
  'alias',
  'owner',
  'domain',
  'slot_uri',
  'inverse',
  'is_a',
  'mixins',
  'abstract',
  'mixin',
  'examples',
  'minimum_value',
  'maximum_value',
  'pattern',
  'structured_pattern',
  'equals_expression',
  'equals_number_in',
  'equals_string_in',
  'name',
  'from_schema',
  'is_usage_slot',
  'usage_slot_name',
  'rank',
  'range_expression',
  'minimum_cardinality',
  'maximum_cardinality',
  'has_member',
  'all_members',
  'list_elements_ordered',
  'list_elements_unique',
  'annotations',
  'extensions',
  'alt_descriptions',
  'aliases',
  'structured_aliases',
  'local_names',
  'exact_mappings',
  'close_mappings',
  'related_mappings',
  'narrow_mappings',
  'broad_mappings',
  'created_by',
  'created_on',
  'last_updated_on',
  'modified_by',
  'mappings',
];

/**
 * Validate LinkML YAML content
 */
export function validateLinkML(yamlContent: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Parse YAML
  let parsed: any;
  try {
    parsed = yaml.load(yamlContent, { json: true });
  } catch (e) {
    if (e instanceof yaml.YAMLException) {
      errors.push({
        line: (e.mark?.line ?? 0) + 1,
        column: (e.mark?.column ?? 0) + 1,
        message: e.reason,
        severity: 'error',
        code: 'YAML_PARSE_ERROR',
      });
    } else {
      errors.push({
        line: 1,
        column: 1,
        message: e instanceof Error ? e.message : 'Unknown YAML parse error',
        severity: 'error',
        code: 'YAML_PARSE_ERROR',
      });
    }
    return { valid: false, errors, warnings };
  }

  if (!parsed || typeof parsed !== 'object') {
    errors.push({
      line: 1,
      column: 1,
      message: 'YAML content must be an object (mapping)',
      severity: 'error',
      code: 'INVALID_STRUCTURE',
    });
    return { valid: false, errors, warnings };
  }

  // Check required keys
  for (const key of REQUIRED_LINKML_KEYS) {
    if (!(key in parsed)) {
      errors.push({
        line: 1,
        column: 1,
        message: `Missing required LinkML key: "${key}"`,
        severity: 'error',
        code: 'MISSING_REQUIRED_KEY',
      });
    }
  }

  // Check for unknown top-level keys
  for (const key of Object.keys(parsed)) {
    if (!VALID_LINKML_KEYS.includes(key)) {
      warnings.push({
        line: 1,
        column: 1,
        message: `Unknown top-level key: "${key}". Valid keys are: ${VALID_LINKML_KEYS.join(', ')}`,
        severity: 'warning',
        code: 'UNKNOWN_KEY',
      });
    }
  }

  // Validate prefixes
  if (parsed.prefixes && typeof parsed.prefixes === 'object') {
    for (const [prefix, uri] of Object.entries(parsed.prefixes)) {
      if (typeof uri !== 'string') {
        errors.push({
          line: 1,
          column: 1,
          message: `Prefix "${prefix}" must have a string URI value`,
          severity: 'error',
          code: 'INVALID_PREFIX',
        });
      }
    }
  }

  // Validate classes
  if (parsed.classes && typeof parsed.classes === 'object') {
    for (const [className, classDef] of Object.entries(parsed.classes)) {
      if (!classDef || typeof classDef !== 'object') {
        errors.push({
          line: 1,
          column: 1,
          message: `Class "${className}" must be an object`,
          severity: 'error',
          code: 'INVALID_CLASS',
        });
        continue;
      }

      for (const key of Object.keys(classDef as object)) {
        if (!VALID_CLASS_KEYS.includes(key)) {
          warnings.push({
            line: 1,
            column: 1,
            message: `Unknown key "${key}" in class "${className}"`,
            severity: 'warning',
            code: 'UNKNOWN_CLASS_KEY',
          });
        }
      }

      // Validate attributes
      const classDefObj = classDef as Record<string, any>;
      if (classDefObj.attributes && typeof classDefObj.attributes === 'object') {
        for (const [attrName, attrDef] of Object.entries(classDefObj.attributes)) {
          if (!attrDef || typeof attrDef !== 'object') {
            errors.push({
              line: 1,
              column: 1,
              message: `Attribute "${attrName}" in class "${className}" must be an object`,
              severity: 'error',
              code: 'INVALID_ATTRIBUTE',
            });
            continue;
          }

          for (const key of Object.keys(attrDef as object)) {
            if (!VALID_SLOT_KEYS.includes(key)) {
              warnings.push({
                line: 1,
                column: 1,
                message: `Unknown key "${key}" in attribute "${attrName}" of class "${className}"`,
                severity: 'warning',
                code: 'UNKNOWN_SLOT_KEY',
              });
            }
          }
        }
      }
    }
  }

  // Validate slots
  if (parsed.slots && typeof parsed.slots === 'object') {
    for (const [slotName, slotDef] of Object.entries(parsed.slots)) {
      if (!slotDef || typeof slotDef !== 'object') {
        errors.push({
          line: 1,
          column: 1,
          message: `Slot "${slotName}" must be an object`,
          severity: 'error',
          code: 'INVALID_SLOT',
        });
        continue;
      }

      for (const key of Object.keys(slotDef as object)) {
        if (!VALID_SLOT_KEYS.includes(key)) {
          warnings.push({
            line: 1,
            column: 1,
            message: `Unknown key "${key}" in slot "${slotName}"`,
            severity: 'warning',
            code: 'UNKNOWN_SLOT_KEY',
          });
        }
      }
    }
  }

  // Validate types
  if (parsed.types && typeof parsed.types === 'object') {
    const validTypeKeys = [
      'typeof',
      'uri',
      'description',
      'base',
      'pattern',
      'minimum_value',
      'maximum_value',
      'comments',
      'notes',
      'see_also',
      'in_subset',
      'status',
      'deprecated',
      'examples',
      'annotations',
      'extensions',
      'alt_descriptions',
      'aliases',
      'structured_aliases',
      'local_names',
      'exact_mappings',
      'close_mappings',
      'related_mappings',
      'narrow_mappings',
      'broad_mappings',
      'created_by',
      'created_on',
      'last_updated_on',
      'modified_by',
      'mappings',
      'rank',
    ];

    for (const [typeName, typeDef] of Object.entries(parsed.types)) {
      if (!typeDef || typeof typeDef !== 'object') {
        errors.push({
          line: 1,
          column: 1,
          message: `Type "${typeName}" must be an object`,
          severity: 'error',
          code: 'INVALID_TYPE',
        });
        continue;
      }

      for (const key of Object.keys(typeDef as object)) {
        if (!validTypeKeys.includes(key)) {
          warnings.push({
            line: 1,
            column: 1,
            message: `Unknown key "${key}" in type "${typeName}"`,
            severity: 'warning',
            code: 'UNKNOWN_TYPE_KEY',
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Convert validation errors to Monaco editor markers
 */
export function toMonacoMarkers(result: ValidationResult): any[] {
  const markers = [];
  
  for (const error of result.errors) {
    markers.push({
      startLineNumber: error.line,
      startColumn: error.column,
      endLineNumber: error.line,
      endColumn: error.column + 1,
      message: error.message,
      severity: 8, // Error = 8 in Monaco
      code: error.code,
    });
  }

  for (const warning of result.warnings) {
    markers.push({
      startLineNumber: warning.line,
      startColumn: warning.column,
      endLineNumber: warning.line,
      endColumn: warning.column + 1,
      message: warning.message,
      severity: 4, // Warning = 4 in Monaco
      code: warning.code,
    });
  }

  return markers;
}

export default { validateLinkML, toMonacoMarkers };
