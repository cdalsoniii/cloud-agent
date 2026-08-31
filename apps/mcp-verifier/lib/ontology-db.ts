/**
 * Versioned Ontology Database Service for SurrealDB
 * Stores ontology YAML with versioning support
 */

import { surrealQueryResults } from './surreal-client';

export interface OntologyVersion {
  id?: string;
  content: string;
  version: number;
  created_at: string;
  created_by?: string;
  parent_version?: number;
  commit_message?: string;
}

export interface OntologyDiff {
  original: string;
  modified: string;
  version_from: number;
  version_to: number;
}

const ONTOLOGY_TABLE = 'ontology_version';
const ONTOLOGY_NS = 'ontology';
const ONTOLOGY_DB = 'ontology';

/**
 * Initialize the ontology table in SurrealDB
 */
export async function initOntologyTable(): Promise<void> {
  try {
    await surrealQueryResults(`
      DEFINE TABLE IF NOT EXISTS ${ONTOLOGY_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS content ON ${ONTOLOGY_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS version ON ${ONTOLOGY_TABLE} TYPE int;
      DEFINE FIELD IF NOT EXISTS created_at ON ${ONTOLOGY_TABLE} TYPE datetime;
      DEFINE FIELD IF NOT EXISTS created_by ON ${ONTOLOGY_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS parent_version ON ${ONTOLOGY_TABLE} TYPE option<int>;
      DEFINE FIELD IF NOT EXISTS commit_message ON ${ONTOLOGY_TABLE} TYPE option<string>;
    `);
    console.log('Ontology table initialized');
  } catch (error) {
    console.error('Failed to initialize ontology table:', error);
    throw error;
  }
}

/**
 * Get the latest ontology version
 */
export async function getLatestOntology(): Promise<OntologyVersion | null> {
  try {
    const results = await surrealQueryResults(`
      SELECT * FROM ${ONTOLOGY_TABLE} ORDER BY version DESC LIMIT 1
    `);
    
    if (results.length === 0) {
      return null;
    }
    
    return results[0] as OntologyVersion;
  } catch (error) {
    console.error('Failed to get latest ontology:', error);
    throw error;
  }
}

/**
 * Get a specific ontology version by version number
 */
export async function getOntologyVersion(version: number): Promise<OntologyVersion | null> {
  try {
    const results = await surrealQueryResults(`
      SELECT * FROM ${ONTOLOGY_TABLE} WHERE version = ${version}
    `);
    
    if (results.length === 0) {
      return null;
    }
    
    return results[0] as OntologyVersion;
  } catch (error) {
    console.error(`Failed to get ontology version ${version}:`, error);
    throw error;
  }
}

/**
 * Get all ontology versions (for history/diff)
 */
export async function getOntologyVersions(limit: number = 50): Promise<OntologyVersion[]> {
  try {
    const results = await surrealQueryResults(`
      SELECT * FROM ${ONTOLOGY_TABLE} ORDER BY version DESC LIMIT ${limit}
    `);
    
    return results as OntologyVersion[];
  } catch (error) {
    console.error('Failed to get ontology versions:', error);
    throw error;
  }
}

/**
 * Save a new ontology version
 * Automatically increments version number
 */
export async function saveOntologyVersion(
  content: string,
  createdBy?: string,
  commitMessage?: string
): Promise<OntologyVersion> {
  try {
    // Get latest version to determine next version number
    const latest = await getLatestOntology();
    const nextVersion = latest ? latest.version + 1 : 1;
    const parentVersion = latest ? latest.version : undefined;
    
    const version: OntologyVersion = {
      content,
      version: nextVersion,
      created_at: new Date().toISOString(),
      created_by: createdBy,
      parent_version: parentVersion,
      commit_message: commitMessage,
    };
    
    const results = await surrealQueryResults(`
      CREATE ${ONTOLOGY_TABLE} CONTENT ${JSON.stringify(version)}
    `);
    
    if (results.length === 0) {
      throw new Error('Failed to save ontology version');
    }
    
    return results[0] as OntologyVersion;
  } catch (error) {
    console.error('Failed to save ontology version:', error);
    throw error;
  }
}

/**
 * Get diff between two versions
 */
export async function getOntologyDiff(
  versionFrom: number,
  versionTo: number
): Promise<OntologyDiff> {
  try {
    const [fromVersion, toVersion] = await Promise.all([
      getOntologyVersion(versionFrom),
      getOntologyVersion(versionTo),
    ]);
    
    if (!fromVersion || !toVersion) {
      throw new Error('One or both versions not found');
    }
    
    return {
      original: fromVersion.content,
      modified: toVersion.content,
      version_from: versionFrom,
      version_to: versionTo,
    };
  } catch (error) {
    console.error('Failed to get ontology diff:', error);
    throw error;
  }
}

/**
 * Get the next version number (for optimistic UI)
 */
export async function getNextVersionNumber(): Promise<number> {
  try {
    const latest = await getLatestOntology();
    return latest ? latest.version + 1 : 1;
  } catch (error) {
    console.error('Failed to get next version number:', error);
    return 1;
  }
}

export default {
  initOntologyTable,
  getLatestOntology,
  getOntologyVersion,
  getOntologyVersions,
  saveOntologyVersion,
  getOntologyDiff,
  getNextVersionNumber,
};
