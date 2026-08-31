/**
 * Resolve local .px root (LinkML + generated SHACL) and list files to upload.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SHAPE_GLOBS = [
  'generated/verifier-fleet.shacl.ttl',
  'generated/skydio.shacl.ttl',
  'generated/verifier-fleet.schema.json',
  'generated/skydio.schema.json',
];

const LINKML_GLOBS = [
  'linkml/verifiers',
  'linkml/skydio',
];

export function resolvePxRoot(explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env.PX_ROOT,
    process.env.VERIFIER_PX_ROOT,
    // assistant-ui product pack
    path.resolve(
      process.env.HOME || '',
      'Documents/Personal/employment/partners/experiments/02-products/assistant-ui/.px',
    ),
    path.resolve(__dirname, '../../../02-products/assistant-ui/.px'),
    path.resolve(process.cwd(), '../02-products/assistant-ui/.px'),
    path.resolve(process.cwd(), '../../02-products/assistant-ui/.px'),
    path.resolve(process.cwd(), '.px'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        const gen = path.join(c, 'generated');
        if (fs.existsSync(gen) || fs.existsSync(path.join(c, 'linkml'))) {
          return path.resolve(c);
        }
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, out);
    else if (ent.isFile()) out.push(full);
  }
  return out;
}

/**
 * Collect relative paths (posix) under px root for sandbox upload.
 */
export function collectPxUploadFiles(pxRoot: string): Array<{ local: string; remoteRel: string }> {
  const root = path.resolve(pxRoot);
  const files: Array<{ local: string; remoteRel: string }> = [];
  const seen = new Set<string>();

  const add = (local: string, remoteRel: string) => {
    const key = remoteRel.replace(/\\/g, '/');
    if (seen.has(key)) return;
    if (!fs.existsSync(local) || !fs.statSync(local).isFile()) return;
    seen.add(key);
    files.push({ local, remoteRel: key });
  };

  for (const rel of SHAPE_GLOBS) {
    add(path.join(root, rel), rel);
  }

  // any other generated *.shacl.ttl
  const genDir = path.join(root, 'generated');
  if (fs.existsSync(genDir)) {
    for (const name of fs.readdirSync(genDir)) {
      if (name.endsWith('.shacl.ttl') || name.endsWith('.schema.json')) {
        add(path.join(genDir, name), path.posix.join('generated', name));
      }
    }
  }

  for (const sub of LINKML_GLOBS) {
    const dir = path.join(root, sub);
    for (const local of walkFiles(dir)) {
      const rel = path.relative(root, local).split(path.sep).join('/');
      // skip huge caches / errors
      if (rel.includes('node_modules') || rel.endsWith('.err')) continue;
      if (/\.(yaml|yml|md|json)$/i.test(rel)) {
        add(local, rel);
      }
    }
  }

  return files;
}

export function readShaclServerScript(): { local: string; content: Buffer } | null {
  const candidates = [
    path.join(__dirname, 'templates/shacl-server.py'),
    path.resolve(process.cwd(), 'src/verification-sandbox/templates/shacl-server.py'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return { local: c, content: fs.readFileSync(c) };
    }
  }
  return null;
}

export function readMultiServiceServerScript(): { local: string; content: Buffer } | null {
  const candidates = [
    path.join(__dirname, 'templates/multi-service-server.py'),
    path.resolve(process.cwd(), 'src/verification-sandbox/templates/multi-service-server.py'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return { local: c, content: fs.readFileSync(c) };
    }
  }
  return null;
}

export function readFleetUiServerScript(): { local: string; content: Buffer } | null {
  const candidates = [
    path.join(__dirname, 'templates/fleet-ui-server.py'),
    path.resolve(process.cwd(), 'src/verification-sandbox/templates/fleet-ui-server.py'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return { local: c, content: fs.readFileSync(c) };
    }
  }
  return null;
}

export function readOntologyUiAssets(): Array<{ local: string; remoteRel: string; content: Buffer }> {
  const baseCandidates = [
    path.join(__dirname, 'templates/ontology-ui'),
    path.resolve(process.cwd(), 'src/verification-sandbox/templates/ontology-ui'),
  ];
  const out: Array<{ local: string; remoteRel: string; content: Buffer }> = [];
  for (const base of baseCandidates) {
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const local = path.join(base, name);
      if (fs.statSync(local).isFile()) {
        out.push({ local, remoteRel: name, content: fs.readFileSync(local) });
      }
    }
    break;
  }
  const serverCandidates = [
    path.join(__dirname, 'templates/ontology-ui-server.py'),
    path.resolve(process.cwd(), 'src/verification-sandbox/templates/ontology-ui-server.py'),
  ];
  for (const c of serverCandidates) {
    if (fs.existsSync(c)) {
      out.push({
        local: c,
        remoteRel: '../ontology-ui-server.py',
        content: fs.readFileSync(c),
      });
      break;
    }
  }
  return out;
}
