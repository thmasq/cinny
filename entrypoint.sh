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
    echo "Updating proxy configuration to: $CINNY_PROXY"
    tmp=$(mktemp)
    jq --arg proxy "$CINNY_PROXY" '.proxy = $proxy' "$CONFIG_PATH" > "$tmp" && mv "$tmp" "$CONFIG_PATH"
fi

if [ -n "$MATRIX_SERVER" ]; then
    echo "Updating homeserver list to: $MATRIX_SERVER"
    
    tmp=$(mktemp)
    jq --arg servers "$MATRIX_SERVER" \
       '.homeserverList = ($servers | split(",")) | .defaultHomeserver = 0' \
       "$CONFIG_PATH" > "$tmp" && mv "$tmp" "$CONFIG_PATH"
fi

chmod 644 "$CONFIG_PATH"

exec "$@"
