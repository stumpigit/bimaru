# Docker-based Bimaru puzzle game

## Local development

```bash
docker build -t bimaru:local .
docker run --rm -p 8080:80 bimaru:local
```

Main game file: `bimaru.html` (copied to `index.html` in container)

## Harbor scripts (puzzle generation/testing)

The `harbor_*.js` and `harbor_*.py` scripts generate and test puzzle libraries. They contain hardcoded paths (`/root/workspace/bimaru/`) and require running from that specific location or path modification. These scripts are excluded from Docker builds via `.dockerignore`.

## Deployment

### GHCR publishing

Pushing to `main` triggers `.github/workflows/publish-ghcr.yml` which publishes to:
- `ghcr.io/stumpigit/bimaru:latest`
- `ghcr.io/stumpigit/bimaru:sha-...`

### Traefik deployment

Use `docker-compose.portainer.yml` (recommended) or `docker-compose.traefik.yml`.

Requirements:
- External Docker network named `traefik`
- Traefik with ACME resolver named `letsencrypt`
- DNS for `bimari.suter.email` pointing to Traefik host

Container exposes port 80 internally with healthcheck at `/health`.
