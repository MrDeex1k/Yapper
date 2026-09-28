#!/bin/sh
set -eu
: "${DOCKERHUB_NAMESPACE:?Set Docker Hub namespace}"
version=$(cat VERSION)
sha=$(git rev-parse HEAD)
mkdir -p release
printf '{"version":"%s","commit":"%s","platform":"linux/amd64","images":{' "$version" "$sha" > release/manifest.json
separator=''
for component in server web; do
  image="$DOCKERHUB_NAMESPACE/yapper-$component"
  if docker manifest inspect "$image:$version" >/dev/null 2>&1; then
    echo "Refusing to overwrite $image:$version; inspect partial publication and resume manually." >&2
    exit 1
  fi
  dockerfile=server/Dockerfile
  if [ "$component" = web ]; then dockerfile=apps/web/Dockerfile; fi
  docker build --platform linux/amd64 --build-arg "VERSION=$version" --label "org.opencontainers.image.revision=$sha" --label "org.opencontainers.image.version=$version" -f "$dockerfile" -t "$image:$version" -t "$image:sha-$sha" .
  docker push "$image:$version"
  docker push "$image:sha-$sha"
  docker pull "$image:$version" >/dev/null
  digest=$(docker image inspect "$image:$version" --format '{{index .RepoDigests 0}}')
  printf '%s"%s":"%s"' "$separator" "$component" "$digest" >> release/manifest.json
  separator=','
done
printf '}}\n' >> release/manifest.json
cp .env.example release/env.example
cp docs/SELF_HOSTING.md release/INSTALL.md
cp deploy/livekit.local.yaml release/livekit.local.yaml
python3 scripts/release-compose.py > release/compose.yaml
(cd release && sha256sum manifest.json compose.yaml env.example INSTALL.md livekit.local.yaml > SHA256SUMS)
