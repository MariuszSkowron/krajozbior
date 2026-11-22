# syntax=docker/dockerfile:1
#
# Obraz produkcyjny Krajozbioru (D-E11-3): trzy cele.
#   runtime  aplikacja (`next start`), użytkownik bez uprawnień roota, tylko zależności produkcyjne
#   ops      pełne zależności i skrypty operatora (`docker compose run --rm ops npm run db:migrate`);
#            uruchamiany tylko jednorazowo, nigdy jako usługa na stałe
#   build    etap pośredni (npm ci + npm run build)
#
# Obraz bazowy jest przypięty skrótem (digest), więc kolejne budowy dają te same warstwy.
# Odświeżenie skrótu: `docker pull node:22-bookworm-slim`, potem
# `docker inspect --format '{{index .RepoDigests 0}}' node:22-bookworm-slim`.
# Obraz nie zawiera sekretów ani plików `.env*` (`.dockerignore` to lista dozwolonych plików).
# Katalogu `public/` repozytorium dziś nie ma; gdy powstanie, dopisz go w etapie runtime.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

# ---------------------------------------------------------------- deps: pełne zależności
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------- build
FROM deps AS build
COPY next.config.ts tsconfig.json ./
COPY src ./src
# Cache kompilacji nie jest potrzebny do `next start`, a zajmuje sporą część obrazu.
RUN npm run build && rm -rf .next/cache

# ---------------------------------------------------------------- prod-deps: tylko zależności produkcyjne
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --chown=node:node package.json next.config.ts tsconfig.json ./
# next.config.ts importuje nagłówki bezpieczeństwa, więc ten plik musi być w obrazie.
COPY --chown=node:node src/lib/security-headers.ts ./src/lib/security-headers.ts
# Zdjęcia (E4): katalog wolumenu `krajozbior-media` i katalog stanu kopii. Nowy, pusty wolumen
# przejmuje przy pierwszym montowaniu właściciela katalogu z obrazu, więc musi to być `node`
# (nigdy `root`: pisze do nich proces bez uprawnień roota). `app` montuje media tylko do odczytu.
RUN mkdir -p /var/lib/krajozbior/media /var/lib/krajozbior/backup-state \
    && chown node:node /var/lib/krajozbior/media /var/lib/krajozbior/backup-state \
    && chmod 0700 /var/lib/krajozbior/media /var/lib/krajozbior/backup-state
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node_modules/.bin/next", "start"]

# ---------------------------------------------------------------- ops
FROM deps AS ops
# Bez NODE_ENV=production: polecenia operatora (catalog:import, seed demo) same decydują o odmowie.
COPY next.config.ts tsconfig.json mikro-orm.config.ts ./
COPY src ./src
COPY scripts ./scripts
# MikroORM zapisuje migawki schematu w src/lib/db/migrations, a catalog:import raport w .ai/tmp.
RUN mkdir -p .ai/tmp && chown -R node:node /app/src /app/.ai
# Katalogi zdjęć jak w celu runtime (ten sam `node`): `ops` pisze do wolumenu `krajozbior-media`.
RUN mkdir -p /var/lib/krajozbior/media /var/lib/krajozbior/backup-state \
    && chown node:node /var/lib/krajozbior/media /var/lib/krajozbior/backup-state \
    && chmod 0700 /var/lib/krajozbior/media /var/lib/krajozbior/backup-state
USER node
CMD ["node", "--version"]
