#!/bin/sh
set -eu
iptables -F OUTPUT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -P OUTPUT DROP
ip6tables -F OUTPUT
ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -P OUTPUT DROP
if [ "${PUBLIC_ISOLATION_PROBE:-0}" = "1" ]; then
 exec setpriv --reuid=pwuser --regid=pwuser --init-groups --bounding-set=-all --inh-caps=-all node worker/public-isolation-probe.mjs
fi
exec setpriv --reuid=pwuser --regid=pwuser --init-groups --bounding-set=-all --inh-caps=-all node worker/browser-public.mjs
