#!/bin/sh
set -eu
plugin_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${PET_DEVICE_USER_DATA:-}" ]; then
  profile_dir=$PET_DEVICE_USER_DATA
elif [ "$(uname -s)" = Darwin ]; then
  profile_dir="$HOME/Library/Application Support/Control Device"
else
  profile_dir="${XDG_CONFIG_HOME:-$HOME/.config}/Control Device"
fi
runtime_file="$profile_dir/desktop-launch-runtime"
if [ ! -f "$runtime_file" ]; then
  echo 'Open AIBanlv once or register the source checkout before enabling host launch.' >&2
  exit 1
fi
runtime_executable=$(cat "$runtime_file")
case "$runtime_executable" in /*/Electron|/*/AIBanlv|/*/electron) ;; *) echo 'Invalid AIBanlv runtime.' >&2; exit 1 ;; esac
case "$runtime_executable" in
  */Electron|*/electron) runtime_executable=$(command -v node) ;;
esac
if [ ! -x "$runtime_executable" ]; then echo 'AIBanlv runtime moved or is missing.' >&2; exit 1; fi
unset NODE_OPTIONS ELECTRON_NO_ASAR
export ELECTRON_RUN_AS_NODE=1
if [ "${1:-}" = --mcp ]; then
  exec "$runtime_executable" "$plugin_dir/desktop-mcp.mjs"
fi
exec "$runtime_executable" "$plugin_dir/desktop-launch.mjs" "$@"
