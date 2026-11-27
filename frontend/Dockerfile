FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS development
WORKDIR /opt/workspace
COPY --chown=node:node package.json package-lock.json ./
RUN chown node:node /opt/workspace
USER node
RUN test "$(node --version)" = v24.22.3 && test "$(npm --version)" = 11.19.1 && npm ci --ignore-scripts --no-audit --no-fund
COPY --chown=node:node index.html tsconfig.json playwright.config.ts playwright.integration.config.ts vite.config.ts ./
COPY --chown=node:node src ./src
COPY --chown=node:node tests ./tests
COPY --chown=node:node e2e ./e2e
COPY --chown=node:node integration ./integration
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM development AS browser-tests
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/chromium
ENV PLAYWRIGHT_OUTPUT_DIR=/tmp/focuspocus-browser-results
RUN ./node_modules/.bin/playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
USER node
CMD ["npm", "run", "test:browser"]

FROM development AS accessibility-tests
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
ENV PLAYWRIGHT_OUTPUT_DIR=/tmp/focuspocus-accessibility-results
RUN ./node_modules/.bin/playwright install --with-deps chromium firefox webkit && rm -rf /var/lib/apt/lists/*
USER node
ENTRYPOINT ["./node_modules/.bin/playwright", "test", "--config", "integration/accessibility/config.ts"]
