#!/bin/sh
set -eu
. /app/worker/gateway/firewall.sh
exec setpriv --reuid=node --regid=node --init-groups --bounding-set=-all --inh-caps=-all node --import tsx tests/integration/gateway-transport.ts
