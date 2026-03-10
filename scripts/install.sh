#!/usr/bin/env bash
# Redirect to the main interactive installer
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/install.sh" "$@"
