// All Rights Reserved: Jevante Boxley
// QCPUNKS SECTOR

import type { ActivityState } from "../activity.js";

/**
 * What the mascot does for each activity: which atlas animation, which of
 * its frames, how fast, and whether it loops. Pure data: retuning the
 * mascot's personality never means touching the renderer.
 */
export interface Pose {
  animation: string;
  /** Subset of frames to play, by label or index (default: all). */
  frames?: (string | number)[];
  /** Overrides the atlas fps. */
  fps?: number;
  playback: "loop" | "once" | "still";
}

export const POSES: Record<ActivityState, Pose> = {
  idle: { animation: "idle", playback: "loop" },
  thinking: {
    animation: "expr_thinking",
    frames: ["thinking", "hmm", "look_up", "side_look", "processing", "curious"],
    fps: 2,
    playback: "loop",
  },
  reading: { animation: "program", fps: 3, playback: "loop" },
  typing: { animation: "type", playback: "loop" },
  running: { animation: "build", playback: "loop" },
  waiting: { animation: "wave", playback: "still" },
  listening: { animation: "expr_neutral", frames: ["listening", "focused"], fps: 1.5, playback: "loop" },
  transcribing: { animation: "think_bubble", playback: "still" },
  speaking: { animation: "faces", frames: ["normal", "smile", "normal", "blush"], fps: 4, playback: "loop" },
  painting: { animation: "build_finish", fps: 4, playback: "loop" },
  celebrate: { animation: "cheer_arms", playback: "still" },
  oops: { animation: "shocked", playback: "still" },
};

/** Intro when Lattice starts: climb the terminal, pull over, wave. */
export const INTRO_SEQUENCE = ["climb", "climb_top"] as const;

/**
 * Which activity a tool call represents. Unknown tools (including MCP tools)
 * count as "running" — something is happening, but not a file edit.
 */
const TOOL_ACTIVITY: Record<string, ActivityState> = {
  read_file: "reading",
  read_many_files: "reading",
  list_directory: "reading",
  file_exists: "reading",
  directory_exists: "reading",
  stat_file: "reading",
  search_files: "reading",
  search_content: "reading",
  git_status: "reading",
  git_diff: "reading",
  git_log: "reading",
  git_branch: "reading",
  detect_project_type: "reading",
  inspect_project: "reading",
  write_file: "typing",
  edit_file: "typing",
  create_file: "typing",
  create_directory: "typing",
  delete_file: "typing",
  copy_file: "typing",
  move_file: "typing",
  git_commit: "typing",
  run_command: "running",
  start_process: "running",
  stop_process: "running",
  get_process_status: "reading",
  generate_image: "painting",
};

export function activityForTool(toolName: string): ActivityState {
  return TOOL_ACTIVITY[toolName] ?? "running";
}

/** Short present-tense label shown beside the mascot while a tool runs. */
export function labelForTool(toolName: string, args: string): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(args || "{}");
  } catch {
    // partial or non-JSON args: fall back to the bare tool name
  }
  const target = [parsed.path, parsed.command, parsed.pattern, parsed.query]
    .find((v): v is string => typeof v === "string" && v.length > 0);
  const verb: Record<ActivityState, string> = {
    idle: "",
    thinking: "thinking",
    reading: "reading",
    typing: "writing",
    running: "running",
    waiting: "waiting for you",
    listening: "listening",
    transcribing: "transcribing",
    speaking: "speaking",
    painting: "painting",
    celebrate: "done",
    oops: "hit a snag",
  };
  const state = activityForTool(toolName);
  const detail = target ? truncateMiddle(target, 48) : toolName;
  return `${verb[state]} ${detail}…`;
}

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(-half)}`;
}
