#!/bin/sh
set -e

if [ -n "$CINNY_PROXY" ]; then
    echo "Updating proxy configuration to: $CINNY_PROXY"
    
    tmp=$(mktemp)
    jq --arg proxy "$CINNY_PROXY" '.proxy = $proxy' /app/config.json > "$tmp" && mv "$tmp" /app/config.json
fi

exec "$@"
