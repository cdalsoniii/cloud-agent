import { describe, it, expect, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react';
import { useAuth } from '../../hooks/useAuth';

jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    user: {
      id: 'user_123',
      firstName: 'Test',
      publicMetadata: { role: 'developer' },
    },
    isLoaded: true,
    isSignedIn: true,
  }),
}));

describe('useAuth hook', () => {
  it('returns developer role for developer user', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isDeveloper).toBe(true);
    expect(result.current.isSignedIn).toBe(true);
    expect(result.current.isLoaded).toBe(true);
  });

  it('returns non-developer for standard user', () => {
    jest.resetModules();
    jest.doMock('@clerk/nextjs', () => ({
      useUser: () => ({
        user: {
          id: 'user_456',
          publicMetadata: { role: 'user' },
        },
        isLoaded: true,
        isSignedIn: true,
      }),
    }));

    const { useAuth: useAuthStandard } = require('../../hooks/useAuth');
    const { result } = renderHook(() => useAuthStandard());
    expect(result.current.isDeveloper).toBe(false);
  });

  it('returns not signed in when user is null', () => {
    jest.resetModules();
    jest.doMock('@clerk/nextjs', () => ({
      useUser: () => ({
        user: null,
        isLoaded: true,
        isSignedIn: false,
      }),
    }));

    const { useAuth: useAuthNull } = require('../../hooks/useAuth');
    const { result } = renderHook(() => useAuthNull());
    expect(result.current.isSignedIn).toBe(false);
    expect(result.current.isDeveloper).toBe(false);
  });
});
