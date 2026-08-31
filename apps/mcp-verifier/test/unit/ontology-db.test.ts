/// <reference types="jest" />
/**
 * Unit tests for Ontology Database Service
 */

const mockSurrealQueryResults = jest.fn();

jest.mock('../../lib/surreal-client', () => ({
  surrealQueryResults: (...args: any[]) => mockSurrealQueryResults(...args),
}));

import {
  initOntologyTable,
  getLatestOntology,
  getOntologyVersion,
  getOntologyVersions,
  saveOntologyVersion,
  getOntologyDiff,
  getNextVersionNumber,
} from '../../lib/ontology-db';
import type { OntologyVersion } from '../../lib/ontology-db';

const mockedSurrealQueryResults = mockSurrealQueryResults;

describe('Ontology Database Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initOntologyTable', () => {
    it('initializes the ontology table successfully', async () => {
      mockedSurrealQueryResults.mockResolvedValueOnce([]);

      await initOntologyTable();

      expect(mockedSurrealQueryResults).toHaveBeenCalledWith(
        expect.stringContaining('DEFINE TABLE IF NOT EXISTS ontology_version')
      );
    });

    it('throws error when initialization fails', async () => {
      mockedSurrealQueryResults.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(initOntologyTable()).rejects.toThrow('Connection failed');
    });
  });

  describe('getLatestOntology', () => {
    it('returns the latest ontology version', async () => {
      const mockVersion: OntologyVersion = {
        id: 'ontology_version:1',
        content: 'test content',
        version: 5,
        created_at: '2024-01-01T00:00:00Z',
        created_by: 'user123',
        commit_message: 'Test commit',
      };

      mockedSurrealQueryResults.mockResolvedValueOnce([mockVersion]);

      const result = await getLatestOntology();

      expect(result).toEqual(mockVersion);
      expect(mockedSurrealQueryResults).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM ontology_version ORDER BY version DESC LIMIT 1')
      );
    });

    it('returns null when no versions exist', async () => {
      mockedSurrealQueryResults.mockResolvedValueOnce([]);

      const result = await getLatestOntology();

      expect(result).toBeNull();
    });

    it('throws error on database failure', async () => {
      mockedSurrealQueryResults.mockRejectedValueOnce(new Error('Query failed'));

      await expect(getLatestOntology()).rejects.toThrow('Query failed');
    });
  });

  describe('getOntologyVersion', () => {
    it('returns a specific version by version number', async () => {
      const mockVersion: OntologyVersion = {
        id: 'ontology_version:3',
        content: 'version 3 content',
        version: 3,
        created_at: '2024-01-01T00:00:00Z',
      };

      mockedSurrealQueryResults.mockResolvedValueOnce([mockVersion]);

      const result = await getOntologyVersion(3);

      expect(result).toEqual(mockVersion);
      expect(mockedSurrealQueryResults).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM ontology_version WHERE version = 3')
      );
    });

    it('returns null when version not found', async () => {
      mockedSurrealQueryResults.mockResolvedValueOnce([]);

      const result = await getOntologyVersion(999);

      expect(result).toBeNull();
    });
  });

  describe('getOntologyVersions', () => {
    it('returns all versions with default limit', async () => {
      const mockVersions: OntologyVersion[] = [
        {
          id: 'ontology_version:1',
          content: 'content 1',
          version: 1,
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'ontology_version:2',
          content: 'content 2',
          version: 2,
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      mockedSurrealQueryResults.mockResolvedValueOnce(mockVersions);

      const result = await getOntologyVersions();

      expect(result).toHaveLength(2);
      expect(result).toEqual(mockVersions);
      expect(mockedSurrealQueryResults).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM ontology_version ORDER BY version DESC LIMIT 50')
      );
    });

    it('returns versions with custom limit', async () => {
      mockedSurrealQueryResults.mockResolvedValueOnce([]);

      await getOntologyVersions(10);

      expect(mockedSurrealQueryResults).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 10')
      );
    });
  });

  describe('saveOntologyVersion', () => {
    it('saves first version with version number 1', async () => {
      mockedSurrealQueryResults.mockResolvedValueOnce([]); // No existing versions
      
      const newVersion: OntologyVersion = {
        id: 'ontology_version:1',
        content: 'new content',
        version: 1,
        created_at: '2024-01-01T00:00:00Z',
        created_by: 'user123',
      };
      
      mockedSurrealQueryResults.mockResolvedValueOnce([newVersion]);

      const result = await saveOntologyVersion('new content', 'user123');

      expect(result.version).toBe(1);
      expect(result.parent_version).toBeUndefined();
      expect(mockedSurrealQueryResults).toHaveBeenLastCalledWith(
        expect.stringContaining('CREATE ontology_version CONTENT')
      );
    });

    it('increments version number from latest', async () => {
      const latestVersion: OntologyVersion = {
        id: 'ontology_version:5',
        content: 'latest content',
        version: 5,
        created_at: '2024-01-01T00:00:00Z',
      };

      mockedSurrealQueryResults.mockResolvedValueOnce([latestVersion]); // getLatestOntology
      
      const newVersion: OntologyVersion = {
        id: 'ontology_version:6',
        content: 'new content',
        version: 6,
        created_at: '2024-01-02T00:00:00Z',
        created_by: 'user123',
        parent_version: 5,
      };
      
      mockedSurrealQueryResults.mockResolvedValueOnce([newVersion]);

      const result = await saveOntologyVersion('new content', 'user123');

      expect(result.version).toBe(6);
      expect(result.parent_version).toBe(5);
    });

    it('includes commit message when provided', async () => {
      mockedSurrealQueryResults.mockResolvedValueOnce([]); // No existing versions
      
      const newVersion: OntologyVersion = {
        id: 'ontology_version:1',
        content: 'content',
        version: 1,
        created_at: '2024-01-01T00:00:00Z',
        commit_message: 'Initial commit',
      };
      
      mockedSurrealQueryResults.mockResolvedValueOnce([newVersion]);

      const result = await saveOntologyVersion('content', 'user123', 'Initial commit');

      expect(result.commit_message).toBe('Initial commit');
    });

    it('throws error when save fails', async () => {
      mockedSurrealQueryResults.mockResolvedValueOnce([]); // getLatestOntology
      mockedSurrealQueryResults.mockResolvedValueOnce([]); // Create returns empty

      await expect(saveOntologyVersion('content')).rejects.toThrow('Failed to save ontology version');
    });
  });

  describe('getOntologyDiff', () => {
    it('returns diff between two versions', async () => {
      const version1: OntologyVersion = {
        id: 'ontology_version:1',
        content: 'content A',
        version: 1,
        created_at: '2024-01-01T00:00:00Z',
      };

      const version2: OntologyVersion = {
        id: 'ontology_version:2',
        content: 'content B',
        version: 2,
        created_at: '2024-01-02T00:00:00Z',
      };

      mockedSurrealQueryResults.mockResolvedValueOnce([version1]);
      mockedSurrealQueryResults.mockResolvedValueOnce([version2]);

      const result = await getOntologyDiff(1, 2);

      expect(result.original).toBe('content A');
      expect(result.modified).toBe('content B');
      expect(result.version_from).toBe(1);
      expect(result.version_to).toBe(2);
    });

    it('throws error when version not found', async () => {
      mockedSurrealQueryResults.mockResolvedValueOnce([]); // Version 1 not found
      mockedSurrealQueryResults.mockResolvedValueOnce([]); // Version 2 not found

      await expect(getOntologyDiff(1, 2)).rejects.toThrow('One or both versions not found');
    });
  });

  describe('getNextVersionNumber', () => {
    it('returns 1 when no versions exist', async () => {
      mockedSurrealQueryResults.mockResolvedValueOnce([]);

      const result = await getNextVersionNumber();

      expect(result).toBe(1);
    });

    it('returns next version number from latest', async () => {
      const latestVersion: OntologyVersion = {
        id: 'ontology_version:10',
        content: 'content',
        version: 10,
        created_at: '2024-01-01T00:00:00Z',
      };

      mockedSurrealQueryResults.mockResolvedValueOnce([latestVersion]);

      const result = await getNextVersionNumber();

      expect(result).toBe(11);
    });

    it('returns 1 on error as fallback', async () => {
      mockedSurrealQueryResults.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await getNextVersionNumber();

      expect(result).toBe(1);
    });
  });
});
