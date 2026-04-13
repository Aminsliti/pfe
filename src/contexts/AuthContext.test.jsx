import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  AuthProvider,
  createAuthedFetch,
  shouldAttachUserHeader,
  useAuth,
} from './AuthContext.jsx';

function mockJsonResponse(payload, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    headers: {
      get: (name) => (name === 'content-type' ? 'application/json' : null),
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('hydrates user state from localStorage', async () => {
    localStorage.setItem('currentUser', JSON.stringify({
      id: 5,
      username: 'viewer',
      fullName: 'Viewer User',
      role: 'Viewer',
    }));
    localStorage.setItem('permissions', JSON.stringify(['view_dashboard']));

    function Consumer() {
      const auth = useAuth();
      return (
        <div>
          <span>{auth.loading ? 'loading' : auth.user?.username}</span>
          <span>{auth.permissions.length}</span>
        </div>
      );
    }

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    expect(await screen.findByText('viewer')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('adds x-user-id to API requests for API endpoints', async () => {
    localStorage.setItem('currentUser', JSON.stringify({
      id: 12,
      username: 'analyst',
      fullName: 'Analyst',
      role: 'Business Analyst',
    }));

    const fetchMock = jest.fn(() => mockJsonResponse([]));
    const authedFetch = createAuthedFetch(fetchMock);

    await authedFetch('http://localhost:3001/api/users');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get('x-user-id')).toBe('12');
  });

  it('detects whether the user header should be attached', () => {
    expect(shouldAttachUserHeader('http://localhost:3001/api/users')).toBe(true);
    expect(shouldAttachUserHeader('/api/processes')).toBe(true);
    expect(shouldAttachUserHeader('https://example.com/health')).toBe(false);
  });

  it('logs out and clears persisted state', async () => {
    localStorage.setItem('currentUser', JSON.stringify({
      id: 5,
      username: 'viewer',
      fullName: 'Viewer User',
      role: 'Viewer',
    }));
    localStorage.setItem('permissions', JSON.stringify(['view_dashboard']));

    function Consumer() {
      const auth = useAuth();
      return (
        <button type="button" onClick={auth.logout}>
          Logout
        </button>
      );
    }

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /logout/i }));
    });

    await waitFor(() => {
      expect(localStorage.getItem('currentUser')).toBeNull();
      expect(localStorage.getItem('permissions')).toBeNull();
    });
  });
});
