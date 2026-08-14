# Runs the MCP server in a container, which is how registries that verify a
# server (Glama, and anything else that boots it) check that it starts and
# answers introspection.
#
# No vault is baked in on purpose: the server starts anywhere and the tools
# report a missing vault themselves, so the image is useful both for a probe
# and for mounting a real vault at /vault.
#
#   docker build -t vulcanus .
#   docker run --rm -i vulcanus                      # probe: starts, lists tools
#   docker run --rm -i -v "$PWD:/vault" vulcanus     # serve a real vault

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Only what the CLI needs at runtime; the TypeScript toolchain stays in build.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist

# The vault the server serves. Empty unless one is mounted, which the tools
# report rather than the process failing to start.
WORKDIR /vault
ENV VULCANUS_NO_UPDATE_CHECK=1
ENTRYPOINT ["node", "/app/dist/cli.js", "serve"]
