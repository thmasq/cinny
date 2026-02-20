#!/bin/sh
set -e

if [ -f "/app/config.json" ]; then
    CONFIG_PATH="/app/config.json"
elif [ -f "./config.json" ]; then
    CONFIG_PATH="./config.json"
else
    echo "Error: config.json not found in /app or current directory"
    exit 1
fi

if [ -n "$CINNY_PROXY" ]; then
    echo "Updating proxy configuration to: $CINNY_PROXY in $CONFIG_PATH"
    
    tmp=$(mktemp)
    jq --arg proxy "$CINNY_PROXY" '.proxy = $proxy' "$CONFIG_PATH" > "$tmp" && mv "$tmp" "$CONFIG_PATH"
fi

exec "$@"
