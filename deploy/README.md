# Misty environments

Misty uses one shared stack for PostgreSQL, migrations, database permissions,
and the API. Development and production are thin overlays around that stack.
The API always listens on port 8080 inside its container.

## Development

Docker Compose automatically combines `docker-compose.yml` with
`docker-compose.override.yml`, so the existing command remains:

```sh
docker compose up --build
```

Development adds the local image build, `.env`, Stripe CLI forwarding,
the temporary Cloudflare tunnel, the development Worker deployment, and these
loopback-only host ports:

- API: `127.0.0.1:8081`
- PostgreSQL: `127.0.0.1:5435` by default

Use `MISTY_HOST_PORT` to change the API host port. `DB_PORT` changes the
development PostgreSQL host port.

## Production

Copy `deploy/production.env.example` to
`/etc/misty-server/production.env`, fill every placeholder, make it readable
only by root, and set `MISTY_API_IMAGE` to the exact tested image digest.

```sh
sudo install -d -m 0700 /etc/misty-server
sudo install -m 0600 production.env /etc/misty-server/production.env

docker compose \
  --env-file /etc/misty-server/production.env \
  -f docker-compose.yml \
  -f deploy/compose.production.yml \
  config --quiet

docker compose \
  --env-file /etc/misty-server/production.env \
  -f docker-compose.yml \
  -f deploy/compose.production.yml \
  up -d
```

Production runs the same PostgreSQL image, migrations, permission job, and API
image. It does not run the Stripe CLI, temporary tunnel, or development Worker
deployment. The API is available only at `127.0.0.1:8081`; Nginx publishes it
as `https://mistysys.com/api`.

The production Stripe Dashboard webhook must be:

```text
https://mistysys.com/api/stripe/webhook
```

The production Journal Worker is deployed separately and points directly to:

```text
https://mistysys.com/api
```

Run a PostgreSQL backup before migrations. A named Docker volume is persistent,
but it is not a backup.
