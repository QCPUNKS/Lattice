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
| `/voice voices` | Voices for the current voice model |
| `/voice voice <name>` | Choose a voice (e.g. `af_bella`, `am_adam`) |
| `/voice models` | Voice models with privacy and price |
| `/voice model <id>` | Choose a voice model (resets the voice if it doesn't exist there) |
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
- **Private models only by default.** The defaults (`openai/whisper-large-v3`
  for transcription, `tts-kokoro` for speech) run on Venice's own
  infrastructure. Models Venice forwards to third parties are refused unless
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

At the time of writing: Kokoro speech is about $3.50 per million characters
(a long reply costs a fraction of a cent), and Whisper transcription is
$0.0001 per second of audio (about $0.36 per hour of talking).
