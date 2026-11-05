#!/bin/sh
set -eu
. /app/worker/gateway/firewall.sh
exec setpriv --reuid=node --regid=node --init-groups --bounding-set=-all --inh-caps=-all node --max-old-space-size=128 --import tsx worker/gateway/server.ts
