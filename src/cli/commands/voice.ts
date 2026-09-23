// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import { VOICE_MODES, isVoiceMode, type LatticeConfig } from "../../config/index.js";
import { listAudioSources, pickMicrophone } from "../../media/audio-io.js";
import { VOICE_MODE_DESCRIPTIONS, type VoiceController } from "../../voice/controller.js";
import { theme } from "../../ui/theme.js";

export const VOICE_USAGE = `Usage:
  /voice                      show voice settings
  /voice <off|chat|dictate|listen>
  /talk                       speak one message now (any mode)
  /voice voices               list voices for the current voice model
  /voice voice <name>         choose a voice
  /voice models               list voice (TTS) models with privacy and price
  /voice model <id>           choose a voice model
  /voice speed <0.25-4>       speaking speed
  /voice mic [number|name]    list microphones, or choose one
  /voice test                 hear the current voice`;

export async function runVoiceCommand(voice: VoiceController, cfg: LatticeConfig, arg: string): Promise<void> {
  const [sub, ...rest] = arg.trim().split(/\s+/);
  const value = rest.join(" ");

  try {
    if (!sub) {
      printVoiceStatus(cfg);
      return;
    }
    if (isVoiceMode(sub)) {
      await voice.setMode(sub);
      console.log(theme.success(`Voice: ${sub}`) + theme.dim(`  (${VOICE_MODE_DESCRIPTIONS[sub]})`));
      if (voice.inputEnabled) console.log(theme.dim("  Press Enter on an empty line to talk; Enter again to send."));
      if (voice.outputEnabled) console.log(theme.dim("  Press Enter on an empty line while Lattice is speaking to stop it."));
      return;
    }

    switch (sub) {
      case "voices": {
        const model = (await voice.models("tts")).find((m) => m.id === cfg.voice.ttsModel);
        if (!model || model.voices.length === 0) {
          console.log(theme.dim(`No voice list reported for ${cfg.voice.ttsModel}.`));
          return;
        }
        console.log(
          model.voices.map((v) => (v === cfg.voice.voice ? theme.success(`● ${v}`) : `  ${v}`)).join("\n"),
        );
        return;
      }
      case "voice":
        if (!value) return void console.log(theme.error("Usage: /voice voice <name>"));
        await voice.setVoice(value);
        console.log(theme.success(`Voice set to ${value}.`));
        return;
      case "models": {
        for (const m of await voice.models("tts")) {
          const marker = m.id === cfg.voice.ttsModel ? theme.success("●") : " ";
          const privacy = m.privacy === "private" ? theme.success("private   ") : theme.warning(m.privacy.padEnd(10));
          const price = m.usdPerMillionChars !== null ? `$${m.usdPerMillionChars}/M chars` : "";
          console.log(`${marker} ${theme.bold(m.id.padEnd(28))} ${privacy} ${theme.dim(price)}`);
        }
        return;
      }
      case "model":
        if (!value) return void console.log(theme.error("Usage: /voice model <id>"));
        await voice.setTtsModel(value);
        console.log(theme.success(`Voice model set to ${value}.`));
        return;
      case "speed": {
        await voice.setSpeed(Number(value));
        console.log(theme.success(`Speaking speed ${value}×.`));
        return;
      }
      case "mic": {
        const { defaultSource, sources } = await listAudioSources();
        const inputs = sources.filter((s) => !s.isMonitor);
        if (!value) {
          const active = cfg.voice.inputDevice ?? pickMicrophone(defaultSource, sources);
          inputs.forEach((s, i) => {
            const marker = s.name === active ? theme.success("●") : " ";
            console.log(`${marker} ${theme.dim(String(i + 1))}. ${s.name}`);
          });
          if (inputs.length === 0) console.log(theme.warning("No microphones found."));
          console.log(theme.dim(`\n${cfg.voice.inputDevice ? "Pinned in config." : "Auto-selected (monitor sources are never used)."} Choose with /voice mic <number>.`));
          return;
        }
        const chosen = /^\d+$/.test(value) ? inputs[Number(value) - 1]?.name : value;
        if (!chosen) return void console.log(theme.error(`No microphone numbered ${value}.`));
        await voice.setMicrophone(chosen);
        console.log(theme.success(`Microphone: ${chosen}`));
        return;
      }
      case "help":
        console.log(VOICE_USAGE);
        return;
      case "test":
        voice.say(`Hi, I'm Lattice. This is the ${cfg.voice.voice} voice at ${cfg.voice.speed} times speed.`);
        await voice.idle();
        return;
      default:
        console.log(theme.error(`Unknown /voice option "${sub}".`));
        console.log(theme.dim(VOICE_USAGE));
    }
  } catch (err) {
    console.log(theme.error((err as Error).message));
  }
}

function printVoiceStatus(cfg: LatticeConfig): void {
  for (const mode of VOICE_MODES) {
    const marker = mode === cfg.voice.mode ? theme.success("●") : " ";
    console.log(`${marker} ${theme.bold(mode.padEnd(8))} ${theme.dim(VOICE_MODE_DESCRIPTIONS[mode])}`);
  }
  console.log();
  console.log(`voice:        ${cfg.voice.voice} (${cfg.voice.ttsModel}, ${cfg.voice.speed}×)`);
  console.log(`transcriber:  ${cfg.voice.sttModel}${cfg.voice.language ? ` [${cfg.voice.language}]` : ""}`);
  console.log(`microphone:   ${cfg.voice.inputDevice ?? theme.dim("auto")}`);
  console.log(theme.dim("\n/voice <mode> to switch · /voice help for everything"));
}
