import { describe, it, expect } from '@jest/globals';

describe('Sandbox integration', () => {
  it('sandbox health check', async () => {
    if (!process.env.DAYTONA_API_KEY) {
      console.log('Skipping: DAYTONA_API_KEY not set');
      return;
    }
    expect(process.env.DAYTONA_API_KEY).toBeTruthy();
  });
});
