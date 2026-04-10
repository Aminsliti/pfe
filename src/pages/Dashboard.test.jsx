import { render, screen } from '@testing-library/react';
import Dashboard from './Dashboard';

jest.mock('../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
  getRoleDisplayName: jest.fn((role) => role),
}));

const { useAuth } = jest.requireMock('../contexts/AuthContext');

describe('Dashboard', () => {
  it('renders the current user profile and permissions', () => {
    useAuth.mockReturnValue({
      user: {
        id: 7,
        username: 'anas',
        fullName: 'Anas Ksiksi',
        email: 'anas@example.com',
        role: 'Company Administrator',
        company: { id: 2, name: 'Operations Division' },
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-02T10:00:00.000Z',
      },
      hasPermission: (permission) => ['user_management', 'manage_processes', 'view_dashboard'].includes(permission),
      ROLES: {
        ADMINISTRATOR: 'Administrator',
        COMPANY_ADMINISTRATOR: 'Company Administrator',
        BUSINESS_ANALYST: 'Business Analyst',
        PROCESS_OWNER: 'Process Owner',
        RISK_MANAGER: 'Risk Manager',
        VIEWER: 'Viewer',
      },
      PERMISSIONS: {
        USER_MANAGEMENT: 'user_management',
        ROLE_MANAGEMENT: 'role_management',
        VIEW_DASHBOARD: 'view_dashboard',
        VIEW_REPORTS: 'view_reports',
        MANAGE_PROCESSES: 'manage_processes',
        MANAGE_RISKS: 'manage_risks',
      },
    });

    render(<Dashboard />);

    expect(screen.getByText(/welcome, anas ksiksi/i)).toBeInTheDocument();
    expect(screen.getAllByText('Company Administrator')[0]).toBeInTheDocument();
    expect(screen.getByText(/operations division/i)).toBeInTheDocument();
    expect(screen.getByText(/manage user accounts \(crud operations\)/i)).toBeInTheDocument();
    expect(screen.getByText(/create and manage processes/i)).toBeInTheDocument();
  });
});
