FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS development
WORKDIR /opt/workspace
COPY --chown=node:node package.json package-lock.json ./
RUN chown node:node /opt/workspace
USER node
RUN test "$(node --version)" = v24.22.3 && test "$(npm --version)" = 11.19.1 && npm ci --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM development AS browser-tests
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/chromium
RUN ./node_modules/.bin/playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
USER node
CMD ["npm", "run", "test:browser"]
