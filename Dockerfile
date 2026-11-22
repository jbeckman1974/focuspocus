FROM scratch AS archive-amd64
ADD --checksum=sha256:f2d2199eb25880e07863b391cf7124e7ffa1338b0d65600dfcec117c4223a7fb https://github.com/astral-sh/python-build-standalone/releases/download/20261110/cpython-3.13.18%2B20261110-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz /python.tgz

FROM scratch AS archive-arm64
ADD --checksum=sha256:55c00325f7c1fddf325dfc621aabdfbbac4dc54adda224af88ec411dc12db239 https://github.com/astral-sh/python-build-standalone/releases/download/20261110/cpython-3.13.18%2B20261110-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz /python.tgz

FROM archive-${TARGETARCH} AS archive
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS extract
COPY --from=archive /python.tgz /tmp/python.tgz
RUN mkdir -p /opt/python && tar -xzf /tmp/python.tgz --strip-components=1 -C /opt/python

FROM docker.io/opensuse/tumbleweed@sha256:70c89a12765c1e6abf143097c86dde23bd3f7e9d248ae8abe249622d6a474e71 AS python-base
COPY --from=extract /opt/python /opt/python
ENV PATH=/opt/venv/bin:/opt/python/bin:/usr/bin:/bin \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONTZPATH=""

FROM python-base AS build
WORKDIR /build
COPY backend/requirements.txt .
RUN python3.13 -m venv /opt/venv && \
    python -m pip download --index-url https://pypi.org/simple --only-binary=:all: --require-hashes --dest /tmp/wheels -r requirements.txt && \
    python -m pip install --no-index --find-links=/tmp/wheels --only-binary=:all: --require-hashes -r requirements.txt && \
    python -m pip check

FROM extract AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/src ./src
RUN npm run build

FROM python-base AS application
COPY --from=build /opt/venv /opt/venv
COPY --from=frontend /src/dist /srv/frontend
WORKDIR /srv/app
COPY backend/manage.py ./
COPY backend/core ./core
COPY backend/config ./config
COPY ops/migrate.py ops/check-runtime.py /srv/ops/
ENV DJANGO_SETTINGS_MODULE=config.settings
USER 10001:10001
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "config.wsgi:application"]
