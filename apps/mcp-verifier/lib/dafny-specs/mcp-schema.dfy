// Dafny specification for MCP schema verification
// Defines the structure of an MCP schema and validation predicates.

datatype MCPSchema = MCPSchema(name: string, description: string, inputSchema: JSONSchema, outputSchema: JSONSchema)

datatype JSONSchema = JSONSchema(schemaType: string, properties: map<string, JSONSchema>, required: seq<string>)

// Predicate to ensure that required fields exist in the properties map for both input and output schemas.
predicate ValidSchema(s: MCPSchema) {
  (forall r :: r in s.inputSchema.required ==> r in s.inputSchema.properties.Keys) &&
  (forall r :: r in s.outputSchema.required ==> r in s.outputSchema.properties.Keys)
}

// Predicate that checks if a schema type string is one of the allowed JSON schema types.
predicate ValidType(t: string) {
  t in {"object", "array", "string", "number", "integer", "boolean", "null"}
}

// Method that verifies an MCPSchema and returns a boolean indicating validity.
method VerifyMCPSchema(s: MCPSchema) returns (valid: bool)
  ensures valid ==> ValidSchema(s)
{
  valid := ValidSchema(s);
}
