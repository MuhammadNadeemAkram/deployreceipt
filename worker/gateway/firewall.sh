#!/bin/sh
set -eu
iptables -F OUTPUT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -d 1.1.1.1 -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -d 1.1.1.1 -p tcp --dport 53 -j ACCEPT
for cidr in 168.63.129.16/32 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do iptables -A OUTPUT -d "$cidr" -j REJECT; done
iptables -A OUTPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
iptables -P OUTPUT DROP
ip6tables -F OUTPUT
ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -P OUTPUT DROP
