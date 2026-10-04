# ObjectIO all-in-one (objectio-aio) for local DealForge development.
#
# `objectio-aio` runs meta + OSD + gateway in a single process and is the
# documented laptop/demo path. The published multi-arch image ships the
# separate services but NOT the aio binary, so we fetch the signed release
# asset here. Pin OBJECTIO_VERSION for reproducibility.
#
# Upstream: https://github.com/object-io/objectio  (Apache-2.0 core)
#
# Build multi-arch:  docker buildx build --platform linux/amd64,linux/arm64 ...
FROM debian:bookworm-slim

ARG OBJECTIO_VERSION=v0.1.0
ARG TARGETARCH=amd64

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/objectio-aio \
      "https://github.com/object-io/objectio/releases/download/${OBJECTIO_VERSION}/objectio-aio-${OBJECTIO_VERSION}-linux-${TARGETARCH}" \
 && chmod +x /usr/local/bin/objectio-aio \
 && useradd -r -u 10001 objectio \
 && mkdir -p /data \
 && chown -R objectio:objectio /data

USER objectio
EXPOSE 9000
VOLUME ["/data"]

# --auth enables SigV4 so DealForge's S3 SDK must sign with the admin keys
# printed on first start (also persisted at /data/meta/admin-creds.env).
ENTRYPOINT ["objectio-aio"]
CMD ["--data", "/data", "--listen-addr", "0.0.0.0", "--port", "9000", "--auth"]
