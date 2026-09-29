#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/fix_github_ip.c"
SO="$SCRIPT_DIR/fix_github_ip.so"
[ -f "$SO" ] && [ "$SO" -nt "$SRC" ] || gcc -shared -fPIC -O2 -o "$SO" "$SRC" -ldl
exec env GODEBUG=netdns=cgo LD_PRELOAD="$SO" gh "$@"
