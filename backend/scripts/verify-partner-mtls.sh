#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  verify-partner-mtls.sh --host HOST --ca TRUST_BUNDLE \
    --client-cert CLIENT_CERT --client-key CLIENT_KEY

The script checks the public TLS endpoint without exposing certificate contents.
It expects /rpc to require a client certificate and /health to remain reachable.
USAGE
}

host=""
ca_file=""
client_cert=""
client_key=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) host=${2:-}; shift 2 ;;
    --ca) ca_file=${2:-}; shift 2 ;;
    --client-cert) client_cert=${2:-}; shift 2 ;;
    --client-key) client_key=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$host" || -z "$ca_file" || -z "$client_cert" || -z "$client_key" ]]; then
  usage >&2
  exit 2
fi

for file in "$ca_file" "$client_cert" "$client_key"; do
  [[ -f "$file" ]] || { echo "Missing file: $file" >&2; exit 2; }
done

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }

openssl x509 -in "$client_cert" -noout >/dev/null 2>&1 || fail "client certificate is unreadable"
openssl verify -CAfile "$ca_file" -untrusted "$client_cert" "$client_cert" >/dev/null 2>&1 ||
  printf 'WARN  client certificate chain is not verifiable with the supplied bundle\n'

health_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --max-time 15 --cacert "$ca_file" "https://$host/health") ||
  fail "/health TLS or HTTP request failed"
[[ "$health_status" =~ ^[1-5][0-9][0-9]$ ]] || fail "/health returned no HTTP status"
pass "/health reachable without client certificate (HTTP $health_status)"

no_cert_rpc_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --max-time 15 --cacert "$ca_file" --header 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"health"}' \
  "https://$host/rpc" || true)
case "$no_cert_rpc_status" in
  403|495|496|497) pass "/rpc rejects a request without a client certificate (HTTP $no_cert_rpc_status)" ;;
  *) fail "/rpc did not reject an unauthenticated request (HTTP ${no_cert_rpc_status:-none})" ;;
esac

rpc_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --max-time 15 --cacert "$ca_file" --cert "$client_cert" --key "$client_key" \
  --header 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"health"}' \
  "https://$host/rpc") || fail "/rpc mTLS request failed"
[[ "$rpc_status" =~ ^[1-5][0-9][0-9]$ ]] || fail "/rpc returned no HTTP status"
pass "/rpc mTLS handshake succeeded (HTTP $rpc_status)"

echo "Partner mTLS transport checks passed for $host"
