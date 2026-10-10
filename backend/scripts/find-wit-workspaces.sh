#!/usr/bin/env bash
set -uo pipefail

# Read-only discovery for WIT workspace identity state. The script prints paths
# and file-presence checks only; it never reads credential or private-key data.

if [[ $# -gt 0 ]]; then
  search_roots=("$@")
else
  search_roots=(
    "/opt/agent-attack-lab"
    "/home/deployer"
    "/var/lib/docker/volumes"
  )
fi

existing_roots=()
for root in "${search_roots[@]}"; do
  if [[ -d "$root" ]]; then
    existing_roots+=("$root")
  else
    printf 'SKIP  missing search root: %s\n' "$root"
  fi
done

if [[ ${#existing_roots[@]} -eq 0 ]]; then
  printf 'FAIL  no readable search roots\n' >&2
  exit 2
fi

mapfile -d '' enrollment_files < <(
  find "${existing_roots[@]}" -type f -name enrollment.json -print0 2>/dev/null
)

if [[ ${#enrollment_files[@]} -eq 0 ]]; then
  printf 'NOT_FOUND  no WIT enrollment.json under the searched roots\n'
  printf 'NEXT  inspect stopped containers, detached volumes, snapshots, and backups\n'
  exit 1
fi

required_relative_paths=(
  "acs.final.json"
  "secrets/eab.json"
  "secrets/registry-token.json"
)

complete_count=0
for enrollment in "${enrollment_files[@]}"; do
  acps_dir=$(dirname "$enrollment")
  printf 'CANDIDATE  %s\n' "$acps_dir"

  complete=1
  for relative_path in "${required_relative_paths[@]}"; do
    if [[ -f "$acps_dir/$relative_path" ]]; then
      printf '  PRESENT  %s\n' "$relative_path"
    else
      printf '  MISSING  %s\n' "$relative_path"
      complete=0
    fi
  done

  for identity_dir in client server; do
    if find "$acps_dir/$identity_dir" -maxdepth 2 -type f -iname '*cert*.pem' -print -quit 2>/dev/null | grep -q .; then
      printf '  PRESENT  %s certificate\n' "$identity_dir"
    else
      printf '  MISSING  %s certificate\n' "$identity_dir"
      complete=0
    fi
    if find "$acps_dir/$identity_dir" -maxdepth 2 -type f \( -iname '*key*.pem' -o -iname '*.key' \) -print -quit 2>/dev/null | grep -q .; then
      printf '  PRESENT  %s private key\n' "$identity_dir"
    else
      printf '  MISSING  %s private key\n' "$identity_dir"
      complete=0
    fi
  done

  if find "$acps_dir" -maxdepth 3 -type f -iname '*trust*bundle*.pem' -print -quit 2>/dev/null | grep -q .; then
    printf '  PRESENT  trust bundle\n'
  else
    printf '  MISSING  trust bundle\n'
    complete=0
  fi

  if [[ $complete -eq 1 ]]; then
    printf '  RESULT   complete-looking workspace; preserve the entire acps directory\n'
    complete_count=$((complete_count + 1))
  else
    printf '  RESULT   incomplete workspace; do not treat it as recoverable yet\n'
  fi
done

printf 'SUMMARY  candidates=%d complete-looking=%d\n' "${#enrollment_files[@]}" "$complete_count"
if [[ $complete_count -eq 0 ]]; then
  exit 1
fi
