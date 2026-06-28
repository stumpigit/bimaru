# Bimaru

Single-file Bimaru puzzle game packaged for Docker, Portainer and GHCR.

## Local build

```bash
docker build -t bimaru:local .
docker run --rm -p 8080:80 bimaru:local
```

Open: http://localhost:8080

## Portainer + Traefik deployment

### Recommended stack file

Use `docker-compose.portainer.yml` as stack file in Portainer.

This variant includes:
- GHCR image reference
- Traefik host routing for `bimari.suter.email`
- TLS via the `letsencrypt` cert resolver
- basic security headers via Traefik middleware

### Simpler variant

If you do not want the extra security-header middleware, you can also use:
- `docker-compose.traefik.yml`

### Requirements

- existing external Docker network named `traefik`
- Traefik configured with an ACME resolver named `letsencrypt`
- DNS for `bimari.suter.email` pointing to the Traefik host
- the GHCR image must be published successfully

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

After a push to `main`, GitHub Actions should publish automatically.

## Portainer usage

In Portainer:
1. Stacks
2. Add stack
3. Paste `docker-compose.portainer.yml`
4. Deploy the stack

If your GHCR package is private, Portainer needs registry credentials for `ghcr.io`.
