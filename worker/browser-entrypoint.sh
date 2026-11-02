#!/bin/sh
set -eu
# Fail closed. No DNS, internet, host gateway, loopback connects, or worker API access.
iptables -F OUTPUT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -d 172.30.77.10 -p tcp --dport 8080 -j ACCEPT
iptables -P OUTPUT DROP
ip6tables -F OUTPUT
ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -P OUTPUT DROP
# Root is used for firewall installation only; Chromium receives no capabilities.
if [ "${SCAN_EGRESS_TEST_ONLY:-0}" = "1" ]; then
  exec setpriv --reuid=pwuser --regid=pwuser --init-groups --bounding-set=-all --inh-caps=-all node worker/egress-test.mjs
fi
exec setpriv --reuid=pwuser --regid=pwuser --init-groups --bounding-set=-all --inh-caps=-all node worker/browser-server.mjs
