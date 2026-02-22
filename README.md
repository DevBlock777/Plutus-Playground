# Plutus Playground Backend

## Description

This project is the backend of the Plutus Playground, a web-based integrated development environment (IDE) for creating and testing Plutus smart contracts on the Cardano blockchain. The backend handles user authentication, session management, file system operations, compilation caching, and integration with Docker to run Plutus code.

## Key Features

- **Authentication**: User registration, login, and session management with bcrypt password hashing.
- **File Management**: User-specific workspaces isolated via Docker containers, with support for creating, editing, and deleting files.
- **Compilation and Execution**: Plutus code compilation using Docker, with caching of results to improve performance. Real-time output via Server-Sent Events (SSE).
- **Wallet Integration**: Connection to Cardano wallets (Nami, Lace, Eternl) for deploying and interacting with smart contracts.
- **Sessions and Cache**: Session storage in Redis, caching system for compilation results.
- **Templates**: Pre-built Plutus contract templates (Vesting, NFT Marketplace) for quick start.
- **Job Queue Management**: Concurrent build limits, queue management, and rate limiting to ensure fair resource usage.
- **Metrics and Monitoring**: Real-time metrics on builds, cache performance, and system health.
- **Artifact Management**: Download compiled Plutus scripts (.plutus files) and access build logs.
- **Version Information**: Display toolchain versions (GHC, Cabal, Nix) for debugging.

## Prerequisites

- Node.js (version 16 or higher)
- Docker (to run Plutus containers)
- Redis (for session and cache storage)
- A Docker container named `plutus-runner` configured for Plutus compilation

## Installation

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Ensure Docker is running and the `plutus-runner` container is available.

4. Set up Redis:
   - Install and start Redis on your system.
   - The backend uses Redis for sessions (DB 0) and cache (DB 1).

## Configuration

- **Port**: The server runs on port 3000 by default.
- **Environment Variables**:
  - `SESSION_SECRET`: Secret key for sessions (change it in production).
  - `REDIS_URL`: Redis connection URL (default `redis://localhost:6379`).
  - `MAX_CONCURRENT_BUILDS`: Maximum concurrent compilation jobs (default: 3).
  - `MAX_QUEUE_SIZE`: Maximum queued jobs (default: 20).
  - `JOB_TIMEOUT_MS`: Compilation timeout in milliseconds (default: 300000 = 5 minutes).
  - `MAX_OUTPUT_MB`: Maximum compilation output size in MB (default: 10).
  - `RATE_LIMIT_MAX`: Maximum builds per user per minute (default: 10).
- **Docker**: The `plutus-runner` container must be configured to mount user workspaces.

## Running

Start the server:
```bash
npm run dev
```

The server will be available at `http://localhost:3000`.

## API Endpoints

### Authentication
- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `POST /auth/logout` - User logout
- `GET /auth/me` - Get current user info

### Workspace
- `GET /workspace/files` - List files in workspace
- `GET /workspace/file` - Get file content
- `POST /workspace/create` - Create new file
- `POST /workspace/save` - Save file content

### Compilation
- `POST /run` - Compile Plutus code (supports both file and editor mode)

### Templates
- `GET /templates` - List available templates
- `GET /templates/:id` - Get template source code

### Monitoring
- `GET /health` - Health check
- `GET /version` - Toolchain versions
- `GET /admin/metrics` - System metrics (requires authentication)

### Artifacts
- `GET /job/:jobId/log` - Get compilation logs
- `GET /job/:jobId/artifact` - Get artifact metadata
- `GET /job/:jobId/download` - Download compiled .plutus file

## Architecture

The backend consists of several key components:

- **Server** (`server.js`): Main Express.js server handling HTTP requests and WebSocket connections.
- **Authentication** (`auth.js`): User management and session handling.
- **Cache** (`cache.js`): Compilation result caching using Redis.
- **Job Queue** (`jobQueue.js`): Build orchestration, rate limiting, and metrics.
- **Templates** (`templates.js`): Pre-defined Plutus contract templates.
- **Redis** (`redis.js`): Redis client configuration and utilities.
- **Utils** (`utils.js`): Helper functions for code analysis and processing.

## Development

### Adding New Templates

Templates are defined in `templates.js`. Each template should include:
- `name`: Display name
- `description`: Brief description
- `validatorFn`: Main validator function name
- `source`: Complete Haskell source code

### Monitoring and Metrics

Access metrics at `/admin/metrics` to view:
- Job statistics (total, success rate, cache hit rate)
- Queue status (active jobs, waiting jobs)
- System limits and configuration

### Logs and Debugging

- Compilation logs are retained for 24 hours per job ID
- Use `/job/:jobId/log` to retrieve logs for debugging
- Version information helps identify toolchain issues

1. Start Redis if not already running:
   ```bash
   redis-server
   ```

2. Start the server:
   ```bash
   node server.js
   ```

3. Open your browser to `http://localhost:3000`.

## Usage

- Access the login page to register or log in.
- Once authenticated, access the IDE to create and edit Haskell/Plutus files.
- Use the API endpoints to manage files, compile, and run code.

## Project Structure

- `server.js`: Main Express server.
- `auth.js`: Authentication module.
- `cache.js`: Caching system.
- `redis.js`: Redis connection.
- `utils.js`: Utility functions.
- `assets/`: Static assets (CSS, JS, images).
- `sessions/`: Persistent session storage.
- `tmp/`: Temporary files.
- `workspaces/`: User workspaces with Haskell files.

## API Endpoints

### Public Routes
- `GET /`: Redirects to login or IDE based on session.
- `GET /login`: Login page.
- `GET /register`: Registration page.
- `POST /auth/register`: User registration.
- `POST /auth/login`: User login.

### Protected Routes (authentication required)
- `GET /ide`: Main IDE interface.
- `GET /workspace/files`: List files in user workspace.
- `POST /workspace/files`: Create/update files.
- `DELETE /workspace/files`: Delete files.
- `POST /compile`: Compile Plutus code.
- `POST /run`: Execute compiled code.

## Security Considerations

- Passwords are hashed with bcrypt.
- Sessions are HTTP-only and secure in production.
- User workspaces are isolated in Docker containers.
- CORS is disabled for server-side rendering.

## Contributing

Contributions are welcome. Please follow coding best practices and add tests for new features.

## License

ISC