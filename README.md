# Plutus IDE

## Description

Plutus IDE is a web-based integrated development environment for creating, testing, and deploying Plutus smart contracts on the Cardano blockchain. It provides a user-friendly interface for writing Haskell code, compiling Plutus scripts, and interacting with Cardano wallets.

The project consists of a Node.js backend handling authentication, file management, compilation, and a frontend built with vanilla JavaScript, HTML, and CSS, featuring the Monaco editor for code editing.

## Key Features

- **User Authentication**: Secure registration, login, and session management.
- **File Management**: Isolated user workspaces with create, edit, delete operations.
- **Code Compilation**: Real-time Plutus compilation with Docker integration, caching, and SSE for live output.
- **Wallet Integration**: Support for Cardano wallets (Nami, Lace, Eternl) for contract deployment.
- **Templates**: Pre-built Plutus contract templates for quick start.
- **Terminal Interface**: Command-line style interface for compilation and status commands.
- **Real-time Feedback**: Live compilation logs, error highlighting, and status updates.
- **Artifact Downloads**: Download compiled .plutus files and access build logs.
- **Version Management**: Display of toolchain versions for debugging.
- **Responsive UI**: Clean, modern interface with sidebar navigation and panels.

## Prerequisites

- Node.js (version 16 or higher)
- Docker (for Plutus compilation containers)
- Redis (for sessions and caching)
- A configured `plutus-runner` Docker container

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up Docker and Redis:
   - Ensure Docker is running.
   - Start Redis: `redis-server`
   - Configure the `plutus-runner` container with Plutus toolchain.

## Configuration

Environment variables (in a `.env` file or system):
- `SESSION_SECRET`: Secret for session encryption
- `REDIS_URL`: Redis connection URL (default: `redis://localhost:6379`)
- `MAX_CONCURRENT_BUILDS`: Max concurrent jobs (default: 3)
- `JOB_TIMEOUT_MS`: Timeout for compilations (default: 300000ms)
- `RATE_LIMIT_MAX`: Builds per user per minute (default: 10)

## Running

Start the development server:
```bash
npm run dev
```

Access the IDE at `http://localhost:3000`.

## Project Structure

```
backend/
├── server/
│   ├── auth.js          # Authentication and user management
│   ├── cache.js         # Compilation caching
│   ├── jobQueue.js      # Build queue and rate limiting
│   ├── redis.js         # Redis utilities
│   ├── server.js        # Main Express server
│   ├── templates.js     # Plutus contract templates
│   └── utils.js         # Helper functions
├── frontend/
│   ├── index.html       # Main IDE page
│   ├── login.html       # Login page
│   ├── ide-core.js      # Core IDE functionality
│   ├── ide-compile.js   # Compilation handling
│   ├── ide-styles.css   # CSS styles
│   ├── ide-terminal.js  # Terminal interface
│   └── ide-workspace.js # File and workspace management
├── sessions/            # Session storage
├── tmp/                 # Temporary files
├── workspaces/          # User workspaces
├── package.json
├── README.md
└── README_FR.md
```

## API Endpoints

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - User login
- `POST /auth/logout` - Logout
- `GET /auth/me` - Current user info

### Workspace
- `GET /workspace/files` - List workspace files
- `GET /workspace/file` - Get file content
- `POST /workspace/create` - Create file
- `POST /workspace/save` - Save file
- `POST /workspace/mkdir` - Create directory
- `DELETE /workspace/delete` - Delete file/directory

### Compilation
- `POST /run` - Compile Plutus code

### Templates
- `GET /templates` - List templates
- `GET /templates/:id` - Get template

### Other
- `GET /health` - Health check
- `GET /version` - Toolchain versions
- `GET /job/:id/log` - Compilation logs
- `GET /job/:id/download` - Download artifacts

## Usage

1. Register or log in.
2. Create/edit Haskell files in the sidebar.
3. Use templates for quick start.
4. Compile via button or terminal commands.
5. Connect wallet for deployment.
6. Download compiled scripts.

## Development

- Add templates in `server/templates.js`
- Modify UI in `frontend/` files
- Backend logic in `server/` files

## Security

- Bcrypt password hashing
- Secure sessions
- Docker isolation for user code
- Rate limiting and queue management

## License

ISC