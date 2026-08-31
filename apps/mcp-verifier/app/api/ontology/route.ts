/**
 * API Route: /api/ontology
 * GET: Returns latest ontology, specific version, list of versions, or diff
 * POST: Saves a new ontology version
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getLatestOntology,
  getOntologyVersions,
  getOntologyDiff,
  getOntologyVersion,
  saveOntologyVersion,
} from '../../../lib/ontology-db';
import { auth } from '@clerk/nextjs/server';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);

    // Handle /api/ontology?version=N
    const version = searchParams.get('version');
    if (version) {
      const v = await getOntologyVersion(parseInt(version, 10));
      if (!v) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 });
      }
      return NextResponse.json(v);
    }

    // Handle /api/ontology?versions=true
    if (searchParams.get('versions') === 'true') {
      const versions = await getOntologyVersions(50);
      return NextResponse.json({ versions });
    }

    // Handle /api/ontology?diffFrom=A&diffTo=B
    const diffFrom = searchParams.get('diffFrom');
    const diffTo = searchParams.get('diffTo');
    if (diffFrom && diffTo) {
      const diff = await getOntologyDiff(parseInt(diffFrom, 10), parseInt(diffTo, 10));
      return NextResponse.json(diff);
    }

    // Default: get latest
    const latest = await getLatestOntology();
    if (!latest) {
      return NextResponse.json({ error: 'No ontology found' }, { status: 404 });
    }
    return NextResponse.json(latest);
  } catch (error) {
    console.error('Error fetching ontology:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ontology' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { content, commitMessage } = body;

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content is required and must be a string' },
        { status: 400 }
      );
    }

    const version = await saveOntologyVersion(content, userId, commitMessage);
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    console.error('Error saving ontology:', error);
    return NextResponse.json(
      { error: 'Failed to save ontology' },
      { status: 500 }
    );
  }
}
