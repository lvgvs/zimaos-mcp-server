#!/usr/bin/env bash
# Registry operations only. Never rebuild during promotion. Caller serializes all writers.
set -euo pipefail
inspect() {
  local ref="$1" err result
  err="$(mktemp)"
  if result="$(docker buildx imagetools inspect "$ref" --format '{{.Manifest.Digest}}' 2>"$err")"; then
    rm -f "$err"
    [[ "$result" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid registry digest.' >&2; return 1; }
    printf '%s\n' "$result"
  elif grep -Fxq "ERROR: $ref: not found" "$err"; then
    rm -f "$err"
    # Only this exact CLI response is absence; auth/network/other errors fail closed.
  else
    rm -f "$err"
    echo 'Registry inspection failed; absence was not established.' >&2
    return 1
  fi
}
case "${1:-}" in
  inspect)
    [[ $# = 2 ]] || exit 1
    inspect "$2"
    ;;
  promote)
    [[ $# = 5 ]] || exit 1
    image="$2"; digest="$3"; tag="$4"; policy="$5"
    [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ && "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || exit 1
    [[ "$policy" = immutable || "$policy" = mutable ]] || exit 1
    existing="$(inspect "$image:$tag")"
    if [[ "$existing" = "$digest" ]]; then exit 0; fi
    if [[ "$policy" = immutable && -n "$existing" ]]; then
      echo 'Refusing to overwrite an existing immutable artifact tag.' >&2
      exit 1
    fi
    docker buildx imagetools create --prefer-index=false --tag "$image:$tag" "$image@$digest"
    [[ "$(inspect "$image:$tag")" = "$digest" ]] || { echo 'Promoted digest differs.' >&2; exit 1; }
    ;;
  *) echo 'Expected inspect or promote.' >&2; exit 1 ;;
esac
