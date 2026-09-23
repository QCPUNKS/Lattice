#!/usr/bin/env bash
# All Rights Reserved: Jevante Boxley
# QCPUNKS SECTOR
#
# Installs Lattice's local voice engine: free, offline speech-to-text
# (faster-whisper) and text-to-speech (Kokoro) on this machine.
#
#   bash scripts/voice/install-local-voice.sh
#
# Creates  ~/.local/share/lattice/voice-env      (Python venv, ~300 MB)
#          ~/.local/share/lattice/voice-models   (Kokoro model + voices, ~355 MB)
# Downloads the Whisper model into the Hugging Face cache (~480 MB for small.en).
# No sudo. Re-running is safe: finished steps are skipped.
set -euo pipefail

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/lattice"
VENV="$DATA/voice-env"
MODELS="$DATA/voice-models"
PYTHON="${PYTHON:-python3}"
STT_MODEL="${LATTICE_STT_MODEL:-small.en}"

KOKORO_BASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
declare -A SHA256=(
  [kokoro-v1.0.onnx]=7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5
  [voices-v1.0.bin]=bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d
)

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v "$PYTHON" >/dev/null || die "$PYTHON not found (Python 3.10+ required)"
"$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || die "Python 3.10+ required"
command -v ffmpeg >/dev/null || die "ffmpeg not found: sudo apt install ffmpeg pulseaudio-utils"
command -v curl >/dev/null || die "curl not found"

mkdir -p "$DATA" && chmod 700 "$DATA"

step "Python environment ($VENV)"
if [[ ! -x $VENV/bin/python ]]; then
  "$PYTHON" -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet "faster-whisper==1.2.1" "kokoro-onnx==0.5.0"

step "Kokoro voice model ($MODELS)"
mkdir -p "$MODELS" && chmod 700 "$MODELS"
for file in "${!SHA256[@]}"; do
  target="$MODELS/$file"
  if [[ -f $target ]] && echo "${SHA256[$file]}  $target" | sha256sum -c --quiet 2>/dev/null; then
    echo "   $file already present"
    continue
  fi
  echo "   downloading $file"
  curl -fL --progress-bar -o "$target.part" "$KOKORO_BASE/$file"
  echo "${SHA256[$file]}  $target.part" | sha256sum -c --quiet || { rm -f "$target.part"; die "$file failed its checksum; not installed"; }
  mv "$target.part" "$target"
  chmod 600 "$target"
done

step "Whisper speech recognition ($STT_MODEL)"
"$VENV/bin/python" - "$STT_MODEL" <<'PY'
import sys
from faster_whisper import WhisperModel
try:
    import ctranslate2
    device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
except Exception:
    device = "cpu"
WhisperModel(sys.argv[1], device="cpu", compute_type="int8")  # downloads into the HF cache
print(f"   ready; will run on {device}")
PY

step "Done"
echo "Local voice is installed. In Lattice:  /voice engine local   then   /voice chat"
