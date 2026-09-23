<!-- All Rights Reserved: Jevante Boxley -->
<!-- QCPUNKS SECTOR -->

# Voice

Talk to Lattice and have it talk back, in any combination. Speech input and
output are independent, so you can pick what fits the moment, your
environment, or your needs.

| Mode | You | Lattice | Good for |
|---|---|---|---|
| `off` | type | text | the default |
| `chat` | speak | speaks **and** shows text | hands-free work |
| `dictate` | speak | text | a quiet room, motor impairments, reading code |
| `listen` | type | speaks **and** shows text | low vision, reading fatigue |

Switch with `/voice chat`, `/voice dictate`, `/voice listen`, `/voice off`.
The mode is remembered between sessions.

## Engines: local (default) or Venice

| | `local` (default) | `venice` |
|---|---|---|
| Speech → text | faster-whisper on your GPU (CPU fallback) | Venice-hosted Whisper |
| Text → speech | Kokoro on your machine | Venice-hosted Kokoro and others |
| Cost | **free** | billed per second / per character |
| Privacy | audio never leaves your machine | sent to Venice (private models only by default) |
| Speed (RTX 5060) | ~0.16 s to transcribe a sentence | 4–8 s (network) |

Switch with `/voice engine local` or `/voice engine venice`. Voice names are
the same on both (`af_sky`, `af_bella`, `am_adam`…), so switching doesn't
change how Lattice sounds.

**How local works:** the first time voice is used (or at startup, if a
voice mode is already on), Lattice starts a small speech service
(`services/voice/lattice_voice_server.py`) that loads Whisper and Kokoro once
and keeps them warm, so there's about 3 seconds of loading up front and
instant responses after. The service:

- listens only on `127.0.0.1`, and every request must carry a random secret
  generated fresh at each launch;
- is started without any credentials: API keys, tokens and passwords are
  stripped from its environment;
- keeps audio in memory and logs nothing;
- stops when Lattice exits, and restarts itself if it crashes.

**Setting up local voice** on a new machine:

```bash
bash scripts/voice/install-local-voice.sh
```

This creates a private Python environment and downloads the models (about
1 GB total, checksum-verified), with no sudo. If you already have
faster-whisper and kokoro-onnx installed in another environment, point
Lattice at it instead:

```toml
[voice]
local_python = "~/ai-env/bin/python"
local_stt_model = "small.en"      # any faster-whisper model name, e.g. distil-small.en, large-v3
local_stt_device = "auto"         # auto | cuda | cpu
# local_tts_model  = "~/.local/share/lattice/voice-models/kokoro-v1.0.onnx"
# local_tts_voices = "~/.local/share/lattice/voice-models/voices-v1.0.bin"
```

These settings are read from the global config only, since `local_python`
names a program Lattice will run.

When Lattice speaks, the full text is still printed, like captions, so
nothing is ever audio-only.

## Push-to-talk

In `chat` and `dictate` the prompt shows a red `●`:

1. Press **Enter on an empty line** to start recording. A `● REC 0:03` timer shows
   the whole time the mic is open.
2. Press **Enter** again to send. The transcript is printed (`you said: …`) and
   sent as your message.
3. Press **Ctrl+C** to cancel. The audio is discarded and nothing is sent.

`/talk` records a single message in any mode, including `off` and `listen`.

**Interrupting:** press Enter on an empty line (or Ctrl+C) while Lattice is
speaking and it stops immediately. In `chat`, that same Enter starts your
recording, so you can simply talk over it.

It's push-to-talk rather than always-listening on purpose. With speakers,
an always-open mic hears Lattice's own voice and it ends up answering itself.
Push-to-talk works with speakers or headphones, and the mic is never on unless
you turned it on.

## What gets spoken

Spoken replies are the conversation, not the artifacts:

- Code blocks and tables are **not** read aloud. You hear "The code is on
  screen." once instead.
- Markdown syntax is stripped. Links are read by their label, and bare URLs as
  "a link".
- Speech starts after the first sentence, while the model is still writing,
  and anything held back is spoken before the agent starts a tool call, so you
  hear "Let me check the config." *before* it goes quiet to work.

## Settings

| Command | Does |
|---|---|
| `/voice` | Show mode, voice, transcriber, microphone |
| `/voice engine <local\|venice>` | Choose where speech runs |
| `/voice voices` | Voices available on the current engine |
| `/voice voice <name>` | Choose a voice (e.g. `af_bella`, `am_adam`) |
| `/voice models` | Venice engine: hosted voice models with privacy and price |
| `/voice model <id>` | Venice engine: choose a hosted voice model |
| `/voice speed <0.25-4>` | Speaking speed |
| `/voice mic` | List microphones; `/voice mic <n>` to pin one |
| `/voice test` | Hear the current voice |

### Microphone selection

Many Linux desktops set the default audio *source* to a **monitor**, which
captures what your speakers play rather than your microphone. Lattice never
records from a `.monitor` source. It uses the default source if that's a real
input, otherwise the first real input. Pin a specific one with `/voice mic`.

## Privacy

- **Audio never touches disk.** Recordings are streamed from ffmpeg into
  memory, uploaded, and zeroed. Spoken replies are piped straight into the
  player.
- **Local by default.** With the local engine, your voice never leaves your
  machine at all.
- **Private models only on Venice.** With the Venice engine, the defaults
  (`openai/whisper-large-v3`, `tts-kokoro`) run on Venice's own
  infrastructure; models Venice forwards to third parties are refused unless
  you set `[voice] private_only = false`.
- **Transcripts are never written to the audit log**, only durations.
  They *are* part of the conversation, so they're saved in the session like
  anything you type. `/forget` deletes the current session from disk.

## Requirements

`ffmpeg`, `ffplay`, and `pactl` (PulseAudio or PipeWire):

```bash
sudo apt install ffmpeg pulseaudio-utils
```

Lattice checks for these when you turn a voice mode on and tells you
exactly what's missing.

## Costs

**Local engine: free.** Venice engine, at the time of writing: Kokoro speech
is about $3.50 per million characters, and Whisper transcription is $0.0001
per second of audio (about $0.36 per hour of talking). Venice voice charges
show up in `/cost`.
