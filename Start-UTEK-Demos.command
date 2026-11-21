#!/bin/zsh
# san vo, nov 21 2026
# starts the demo server and opens the page
cd "${0:A:h}/mac_demos" || exit 1
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false HF_HUB_DISABLE_PROGRESS_BARS=1
exec /opt/anaconda3/bin/python app.py
