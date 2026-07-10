# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 compiles a native binding.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

RUN corepack enable
# pnpm >= 11 reads build-script approvals from pnpm-workspace.yaml. Without it
# better-sqlite3's native binding is silently skipped and the app can't open
# its database at runtime.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build && pnpm prune --prod

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ARG TYPST_VERSION=0.15.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils tini \
	&& arch="$(dpkg --print-architecture)" \
	&& case "$arch" in \
		amd64) TARGET=x86_64-unknown-linux-musl ;; \
		arm64) TARGET=aarch64-unknown-linux-musl ;; \
		*) echo "unsupported arch: $arch" && exit 1 ;; \
	esac \
	&& curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${TARGET}.tar.xz" \
		| tar -xJ -C /tmp \
	&& mv "/tmp/typst-${TARGET}/typst" /usr/local/bin/typst \
	&& chmod +x /usr/local/bin/typst \
	&& apt-get purge -y curl xz-utils && apt-get autoremove -y \
	&& rm -rf /var/lib/apt/lists/* /tmp/typst-*

ENV NODE_ENV=production \
	PORT=3000 \
	DATA_ROOT=/data \
	DATABASE_PATH=/data/resume-studio.db \
	SEED_DIR=/seed \
	FONT_PATH=/app/fonts \
	TYPST_PACKAGE_PATH=/app/vendor/typst-packages

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
# Migrations must ship — they run at boot.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/fonts ./fonts
# Vendored Typst package: renders never touch the network.
COPY --from=build /app/vendor ./vendor

# Typst renders untrusted content. Don't do it as root.
RUN useradd --system --uid 10001 --home-dir /app app \
	&& mkdir -p /data /seed && chown -R app:app /data /seed /app
USER app

VOLUME ["/data", "/seed"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "build/index.js"]
