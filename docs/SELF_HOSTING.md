# Local deployment

Copy `.env.example` to `.env` and replace the PostgreSQL password with `openssl rand -hex 24`. Run `docker compose up --build -d --wait`. Open http://127.0.0.1:8088 and connect to that same origin.

Database and application backend are private to the Compose network. Only the web origin is exposed on localhost. For Internet hosting put a TLS reverse proxy in front of this origin, supporting HTTP/1.1 WebSocket upgrades. Do not expose PostgreSQL. Use HTTPS outside localhost; media later also needs public UDP and TURN configuration.

`docker compose down` retains data. Never use `down -v` against an instance whose data must survive. Check `docker compose ps` and `docker compose logs server` for readiness and lifecycle signals. At F01 the database is deployed but application persistence starts in F02.

These are source-build instructions, not a claim that Docker Hub releases already exist.
