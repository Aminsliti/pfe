# PFE Platform - Authentication & Role-Based Access Control

A full-stack application implementing user authentication and role-based access control (RBAC) for enterprise platforms.

## Features

### FR-01 – User Authentication
- Secure login with username/password
- Backend API authentication using bcrypt for password hashing
- Session persistence using localStorage
- Async login handling with proper error management

### FR-02 – Role-Based Access Control
- 5 predefined roles:
  - **Administrator**: Full system access
  - **Business Analyst**: Can view reports and manage processes
  - **Process Owner**: Can manage processes
  - **Risk Manager**: Can manage risks and view reports
  - **Viewer**: Can only view dashboard
- Permission-based route protection

### FR-03 – User Management
- Create new user accounts
- Modify existing user accounts
- Delete user accounts
- Administrator-only access

### FR-04 – Role & Permission Management
- View all roles and their permissions
- Administrator-only access

## Tech Stack

- **Frontend**: React 19 + Vite + React Router
- **Backend**: Express.js + PostgreSQL
- **Authentication**: Session-based with bcrypt

## Project Structure

```
pfeproject/
├── server/                    # Backend server
│   ├── db.js                 # Database connection
│   ├── index.js              # Express server setup
│   ├── init-db.js            # Database initialization
│   └── routes/
│       └── auth.js           # Authentication routes
├── src/                      # Frontend source
│   ├── components/
│   │   ├── Layout.jsx       # Main layout component
│   │   ├── ProtectedRoute.jsx # Route protection
│   ├── contexts/
│   │   └── AuthContext.jsx  # Authentication context
│   ├── pages/
│   │   ├── Dashboard.jsx     # Dashboard page
│   │   ├── Login.jsx         # Login page
│   │   ├── RoleManagement.jsx # Role management
│   │   ├── Unauthorized.jsx  # Unauthorized page
│   │   └── UserManagement.jsx # User management
│   ├── App.jsx               # Main app component
│   └── main.jsx              # Entry point
├── package.json
└── vite.config.js
```

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Aminsliti/pfe.git
cd pfe
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file in the root directory:
```env
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pfe
PORT=3001
```

4. Initialize the database:
```bash
npm run init-db
```

5. Start the development servers:

Start the backend server:
```bash
npm run dev:server
```

Start the frontend (in a new terminal):
```bash
npm run dev
```

The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001

## Demo Accounts

| Username | Password    | Role              |
|----------|-------------|-------------------|
| admin    | admin123    | Administrator     |
| analyst  | analyst123  | Business Analyst |
| owner    | owner123    | Process Owner     |
| risk     | risk123     | Risk Manager      |
| viewer   | viewer123   | Viewer            |

## API Endpoints

### Authentication
- `POST /api/login` - User login

### Users
- `GET /api/users` - Get all users
- `POST /api/users` - Create user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Roles & Permissions
- `GET /api/roles` - Get all roles
- `GET /api/permissions` - Get all permissions
- `GET /api/roles-with-permissions` - Get roles with their permissions
- `GET /api/roles/:roleId/permissions` - Get permissions for a role

## Available Scripts

- `npm run dev` - Start frontend development server
- `npm run dev:server` - Start backend server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build
- `npm run init-db` - Initialize database schema

## License

MIT

