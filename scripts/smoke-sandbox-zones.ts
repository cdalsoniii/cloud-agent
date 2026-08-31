/**
 * Smoke: sandbox type registry + domain minting + editor public deny.
 */
import {
  SANDBOX_TYPES_VERSION,
  assertNoPublicEditorDomains,
  getSandboxType,
  mintPreviewUrl,
  registrySyncSnapshot,
} from '../src/verification-sandbox/types-registry.js';
import { mintSandboxAppUrl, describeDomainMatrix } from '../src/verification-sandbox/preview-urls.js';
import {
  handlePxSandboxCreate,
  handlePxOntologyUiPreview,
  handlePxFormalPreview,
  handlePxSandboxDestroy,
  callVerificationMcpTool,
} from '../src/verification-sandbox/index.js';

async function main() {
  assertNoPublicEditorDomains();
  const snap = registrySyncSnapshot();
  console.log('VERSION', SANDBOX_TYPES_VERSION);
  console.log('SNAPSHOT', JSON.stringify(snap, null, 2));
  console.log(describeDomainMatrix());

  const formal = getSandboxType('formal');
  if (!formal.ports.includes(7004) || !formal.ports.includes(7005)) {
    throw new Error('formal must include 7004 and 7005');
  }

  // localhost mint
  const localUi = mintPreviewUrl({
    role: 'formal',
    app: 'ontology',
    localhostFallback: true,
  });
  console.log('LOCAL_UI', localUi);

  // friendly mint
  process.env.SANDBOX_ENV = 'dev';
  process.env.SANDBOX_DOMAIN_BASE = 'px.example.com';
  process.env.PREVIEW_MODE = 'friendly';
  const friendly = mintSandboxAppUrl({
    role: 'formal',
    app: 'ontology',
    raw: { url: 'https://7005-token.proxy.daytona.work', port: 7005 },
    sessionId: 'sess-test',
  });
  console.log('FRIENDLY', friendly);
  if (!friendly.host.includes('ontology.dev.px.example.com')) {
    throw new Error(`unexpected host ${friendly.host}`);
  }

  // editor must fail public mint
  let editorDenied = false;
  try {
    mintSandboxAppUrl({
      role: 'editor',
      app: 'edit',
      localhostFallback: true,
    });
  } catch {
    editorDenied = true;
  }
  // editor has no template for edit — either no template or policy deny
  try {
    mintPreviewUrl({ role: 'editor', app: 'ontology', localhostFallback: true });
  } catch {
    editorDenied = true;
  }
  console.log('EDITOR_DENY', editorDenied);

  await handlePxSandboxCreate({ forceMock: true });
  const uiPrev = await handlePxOntologyUiPreview({ expiresInSeconds: 120 });
  const valPrev = await handlePxFormalPreview({ app: 'validate' });
  const types = await callVerificationMcpTool('px_sandbox_types', {});
  console.log('MCP_UI', JSON.stringify(uiPrev).slice(0, 300));
  console.log('MCP_VAL', JSON.stringify(valPrev).slice(0, 300));
  console.log('TYPES_OK', (types as { ok?: boolean }).ok === true);
  await handlePxSandboxDestroy();

  const pass =
    localUi.mode === 'localhost' &&
    friendly.mode === 'friendly' &&
    editorDenied &&
    (uiPrev as { ok?: boolean }).ok === true &&
    (valPrev as { ok?: boolean }).ok === true;

  console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
