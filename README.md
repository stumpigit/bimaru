# Bimaru

Single-file Bimaru puzzle game packaged for Docker, Portainer and GHCR.

## Local build

```bash
docker build -t bimaru:local .
docker run --rm -p 8080:80 bimaru:local
```

Open: http://localhost:8080

## Portainer + Traefik deployment

Use `docker-compose.traefik.yml` as stack file in Portainer.

Requirements:
- existing external Docker network named `traefik`
- Traefik configured with an ACME resolver named `letsencrypt`
- DNS for `bimari.suter.email` pointing to the Traefik host

The container listens internally on port `80`.
Traefik hostname:
- `bimari.suter.email`

## Let's Encrypt contact

Set this in your Traefik static config / ACME resolver:
- `letsencrypt@stumpi.ch`

Example Traefik static snippet:

```yaml
certificatesResolvers:
  letsencrypt:
    acme:
      email: letsencrypt@stumpi.ch
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web
```

## GitHub Container Registry

The workflow `.github/workflows/publish-ghcr.yml` publishes:
- `ghcr.io/stumpigit/bimaru:latest`
- `ghcr.io/stumpigit/bimaru:sha-...`

After the first push to `main`, GitHub Actions should publish automatically.
