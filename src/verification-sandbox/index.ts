/**
 * Verification sandbox pack — Daytona (default) + E2B (optional).
 *
 * Co-locates formal verification microservices in one ephemeral sandbox per
 * fleet run. Retries reuse the same sandbox.
 */

export * from './types.js';
export * from './packing.js';
export {
  createPackedSandbox,
  multiServiceBootstrapScript,
  REMOTE_PX_ROOT,
  REMOTE_SHAPES_DIR,
} from './provider.js';
// SHACL_PORT / ONTOLOGY_UI_PORT re-exported once from types.js (provider also defines aliases)
export { verifyUntilPass } from './retry-loop.js';
export {
  resolvePxRoot,
  collectPxUploadFiles,
  readShaclServerScript,
} from './px-pack.js';
export {
  verificationMcpManifest,
  callVerificationMcpTool,
  VERIFICATION_MCP_TOOLS,
  VERIFICATION_MCP_SCHEMAS,
} from './mcp-tools.js';
// re-export already present above — ensure callVerificationMcpTool available to smokes
export {
  handlePxSandboxCreate,
  handlePxUploadLinkml,
  handlePxShaclValidate,
  handlePxShaclPreview,
  handlePxSandboxDestroy,
  handleFleetRun,
  handleToolIoGuard,
  handlePxValidateCascade,
  handlePxOntologyScope,
  handlePxPackResolve,
  handlePxPipelineReady,
  handlePxOntologySuggest,
  handleOntologyMode,
  handlePxOntologyUiPreview,
  handlePxFormalPreview,
  handlePxFormalCreate,
  handlePxFormalIngest,
  handlePxFormalFleetPreview,
  getActiveShaclSandbox,
} from './handlers.js';
export {
  buildOntologyState,
  writeOntologyStateFile,
  buildAllCustomerStates,
  listExampleCustomers,
  getExampleCustomer,
  schemaFieldId,
  isClassRange,
  layoutSchemaGraph,
} from './ontology-state.js';
export { EXAMPLE_CUSTOMERS, customerPaths } from './example-customers.js';
export {
  SANDBOX_TYPES_VERSION,
  SANDBOX_TYPE_REGISTRY,
  getSandboxType,
  listSandboxRoles,
  mintPreviewUrl,
  registrySyncSnapshot,
  assertNoPublicEditorDomains,
  assertFormalOwnsDiagramAndFleet,
} from './types-registry.js';
export { mintSandboxAppUrl, describeDomainMatrix } from './preview-urls.js';
export {
  startFormalStack,
  formalSurfaceOwnership,
  formalCreate,
  formalIngest,
  formalDestroy,
  getActiveFormalStack,
  type FormalStackHandle,
} from './formal-stack.js';
export {
  resolveAssistantUiRoot,
  buildAssistantUiWebTarball,
  assistantUiPackIncludeList,
  ensureAssistantUiWebRunning,
  mintAssistantUiWebPreview,
} from './assistant-ui-web.js';
export {
  PREVIEW_TOKEN_PORTS,
  buildPreviewTokenSet,
  mintAllPreviewPorts,
  refreshPreviewTokenSet,
  didTokensRotate,
  writePreviewTokenArtifacts,
  formatOpenUrlsText,
  hostFetchPreviewTargets,
  extractTokenFromPreviewUrl,
} from './preview-tokens.js';
export {
  liveMintPreviewTokens,
  liveRefreshPreviewTokens,
  runPreviewTokenRefreshLoop,
  resolveStartedSandbox,
} from './preview-token-live.js';
export {
  FLEET_UI_PORT,
  ONTOLOGY_UI_PORT,
  SHACL_PORT,
  ASSISTANT_UI_WEB_PORT,
  OPENCODE_SERVE_PORT,
  REMOTE_ASSISTANT_UI,
  DAYTONA_AUTO_STOP_MAX_MINUTES,
  daytonaAutoStopMinutes,
} from './types.js';
export {
  buildOpenCodeConfigFromEnv,
  formalProcessSpecs,
  boardAllRequiredOk,
  ensureOpenCodeServeRunning,
  probeSandboxProcesses,
  hostFetchOpenCodeHealth,
} from './opencode-serve.js';
export { hostRegenerateLinkmlArtifacts, findGenerateScript } from './host-rebuild.js';
export {
  runValidationCascade,
  invokeLeanValidate,
  invokeGraphqlValidate,
  lakeBuildGeneratedOteemo,
  type CascadeResult,
  type ValidationLayerName,
} from './validation-cascade.js';
export {
  buildOntologyHookContext,
  formatOntologyHookContextScope,
  type OntologyHookContext,
} from './ontology-hook-context.js';
export {
  resolvePack,
  isGatedMcpTool,
  GATED_MCP_TOOLS,
  UNGATED_MCP_TOOLS,
  type PackResolveResult,
} from './pack-resolve.js';
export {
  enforceToolIo,
  extractToolPayload,
  extractToolResult,
  bareToolName,
  isValidationSurfaceTool,
  type IoEnforcementDecision,
  type IoEnforcementInput,
} from './io-enforcement.js';
export {
  buildLinkmlReasoning,
  parseGraphqlMutations,
  type LinkmlReasoning,
} from './linkml-reasoning.js';
export {
  appendLinkmlUsageLog,
  readLinkmlUsageLog,
  usageFromReasoning,
  type LinkmlUsageEntry,
} from './linkml-usage-log.js';
export {
  recordValidationCall,
  queryValidationCalls,
  queryEndpointIo,
  endpointIosFromCascade,
  ensureValidationIoTables,
  type ValidationCallRecord,
  type EndpointIoRecord,
} from './validation-io-store.js';
export {
  readPxOntologyConfig,
  writePxOntologyConfig,
  isOntologyEnforcementEnabled,
  isOntologyEditingEnabled,
} from './px-config.js';
export {
  formatShaclCot,
  buildOntologySuggestions,
  enforcementSkipPayload,
} from './shacl-cot.js';
