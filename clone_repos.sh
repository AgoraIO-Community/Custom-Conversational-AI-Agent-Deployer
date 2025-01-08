#!/usr/bin/env bash

set -euo pipefail

# Clone the conversational-ai-agent-router repo
if [ -d "./conversational-ai-agent-router" ]; then
  echo "Directory 'conversational-ai-agent-router' already exists. Skipping clone."
else
  echo "Cloning conversational-ai-agent-router..."
  git clone --branch main https://github.com/AgoraIO-Community/conversational-ai-agent-router.git ./conversational-ai-agent-router
fi

# Clone the openai-realtime-python repo
if [ -d "./openai-realtime-python" ]; then
  echo "Directory 'openai-realtime-python' already exists. Skipping clone."
else
  echo "Cloning openai-realtime-python..."
  git clone --branch main https://github.com/AgoraIO/openai-realtime-python.git ./openai-realtime-python
fi

echo "All repos are cloned!"