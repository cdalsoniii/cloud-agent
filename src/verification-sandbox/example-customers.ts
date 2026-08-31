/**
 * Example “customers” = named LinkML packs under product .px.
 * Used by ontology viewer, smoke, and demo launch.
 */
import path from 'path';
import { resolvePxRoot } from './px-pack.js';

export interface ExampleCustomer {
  /** Stable customer id for selection */
  id: string;
  /** Display name */
  name: string;
  /** Pack key used by ontology-state / SHACL */
  pack: string;
  /** Relative metamodel / root LinkML under .px/linkml */
  linkmlDir: string;
  metamodelFile: string;
  /** Optional instance YAML (fleet collated or fixture) */
  instanceFile?: string;
  /** Generated SHACL filename under .px/generated */
  shaclFile: string;
  description: string;
}

export const EXAMPLE_CUSTOMERS: ExampleCustomer[] = [
  {
    id: 'acme-fleet',
    name: 'Acme Validation Fleet',
    pack: 'verifier-fleet',
    linkmlDir: 'linkml/verifiers',
    metamodelFile: 'verifier-metamodel.linkml.yaml',
    instanceFile: 'verifier-fleet.collated.yaml',
    shaclFile: 'verifier-fleet.shacl.ttl',
    description: 'Enterprise verifier-fleet LinkML pack (safety/property/content checks).',
  },
  {
    id: 'skydio-ops',
    name: 'Skydio-style Ops Reports',
    pack: 'skydio',
    linkmlDir: 'linkml/skydio',
    metamodelFile: 'skydio-ops.linkml.yaml',
    instanceFile: 'fixtures/incident-postmortem.happy.yaml',
    shaclFile: 'skydio.shacl.ttl',
    description: 'Research/ops report ontology (IncidentPostmortemReport tree).',
  },
  {
    id: 'oteemo-devsecops',
    name: 'Oteemo Managed DevSecOps',
    pack: 'oteemo',
    linkmlDir: 'linkml/oteemo',
    metamodelFile: 'oteemo-devsecops.linkml.yaml',
    instanceFile: 'fixtures/engagement.happy.yaml',
    shaclFile: 'oteemo.shacl.ttl',
    description:
      'Oteemo-style Managed DevSecOps engagement (controls, pipeline gates, pre/post tool assumptions).',
  },
];

export function listExampleCustomers(): ExampleCustomer[] {
  return EXAMPLE_CUSTOMERS.slice();
}

export function getExampleCustomer(idOrPack: string): ExampleCustomer | null {
  const key = idOrPack.trim().toLowerCase();
  return (
    EXAMPLE_CUSTOMERS.find(
      (c) => c.id === key || c.pack === key || c.id.replace(/-/g, '') === key,
    ) || null
  );
}

export function customerPaths(customer: ExampleCustomer, pxRoot?: string | null) {
  const root = resolvePxRoot(pxRoot || undefined);
  if (!root) return null;
  return {
    root,
    linkmlDir: path.join(root, customer.linkmlDir),
    metamodel: path.join(root, customer.linkmlDir, customer.metamodelFile),
    instance: customer.instanceFile
      ? path.join(root, customer.linkmlDir, customer.instanceFile)
      : null,
    shacl: path.join(root, 'generated', customer.shaclFile),
    stateOut: path.join(root, 'generated', `ontology-state.${customer.id}.json`),
  };
}
