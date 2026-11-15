---
name: ultra-edit
description: Edit a talking-head video (plus screen recordings) end to end in Premiere Pro OR DaVinci Resolve - the user names their editor, the skill routes to the right tools. Silence removal, hooks and best parts, b-roll, captions, voice sync from separate voice files, sound effects, music, review, export. Generic version - ships with no personal editing styles, follows the user's own references instead. Use when the user says "ultra edit".
---

# Ultra Edit: the multi-agent edit, any editor

You are the orchestrator. Do not do the agents' work yourself; keep your own context small.

## Step 0 - which software (always first)

Ask: "Which software should I connect? Premiere, DaVinci Resolve, After Effects - any combination." (Accept whatever the user names, in any role; auto-detect if they are unsure: check for running Resolve, then Premiere, then AE processes. Remotion is always available as the motion helper and needs no connection.)

Connect and verify EVERY software the user names, one by one, using the table below. Failures block only that software - report it and continue with the ones that connected.

| Software | Role it can take | Tools | Connection check |
|---|---|---|---|
| Premiere Pro | Main edit | ultra-premiere-mcp (or any Premiere MCP): `premiere_status`, `transcribe_media`, `setup_layers`, `add_voice`, `add_styled_captions`, `find_broll`/`use_broll`, `make_broll`, `apply_preset`, `export_video` | `premiere_status` |
| DaVinci Resolve | Main edit | davinci-resolve-mcp (resolve_status, import_media, add_clips, add_text, add_marker, render_export, subtitle/audio tools) | `resolve_status` - free edition needs the in-app bridge running: Workspace > Scripts > resolve_bridge, Resolve open with the project open |
| After Effects | Motion graphics (or main target for pure-motion jobs) | AfterEffectsMCP: `create-composition`, `run-script`, `setLayerKeyframe`, `setLayerExpression`, `apply-effect`, `get-results` | "Get my After Effects project info" - needs AE open, scripting enabled (Preferences > Scripting & Expressions > Allow Scripts to Write Files and Access Network) and the connector's bridge panel open with auto-run on |
| Remotion | Templated motion (always available) | renders MP4/WebM with alpha via a small React project; import the render into whichever editor is in use | `npx remotion versions` in the job folder |

Combos work naturally - "cut it in Resolve, do the intro in After Effects" or "everything in Premiere" or "just make me an AE comp". One software acts as the main edit target; the others feed it renders (AE comps / Remotion MP4s imported into the main editor's timeline).

## Motion routing (After Effects vs Remotion)

Ask once if the user has After Effects installed and wants it used.

- **Advanced / hero motion** (custom animated titles, branded intros, complex comps) -> After Effects via AfterEffectsMCP, or render headless with `aerender -project "<file.aep>" -comp "<comp>" -output "<out>"`. Import the render into the editor timeline.
- **Basic / templated motion** (kinetic text, stat cards, simple background animation, b-roll cards) -> Remotion: scaffold in the job folder (`motion/`), render MP4 (with alpha only when needed), import into the editor. Faster and cheap - this is the default when AE is not installed or the shot is simple.
- Editor-native motion first where the editor MCP provides it (Premiere `make_broll`, Resolve Text+) - only escalate to AE/Remotion when the editor tools are not enough.

If the connection check fails: Premiere - ask the user to open Premiere with the project; Resolve free - ask them to start the bridge (Workspace > Scripts > resolve_bridge) and keep Resolve open. Never proceed on a dead connection.

## Token rules (always)

- Pass file paths between agents, never file contents or transcripts.
- One job folder per video: `~/Videos/ultra-edit/<name>/` with `plan.json`, `b-roll/raw`, `b-roll/gen`.
- Each agent returns a few lines + paths. Do not re-read what an agent already summarised.
- Spawn agents in parallel when they don't depend on each other (research + motion + sound prep).

## Who does what

| Step | Agent | Model / effort |
|---|---|---|
| 1. Connection check, transcribe, find silences | you, with the editor's status + transcription tools | - |
| 2. Hooks, best parts, story order, beat list -> plan.json | `ue-hook-writer` | Sonnet, medium |
| 3. Find real b-roll / sources for the beats | `ue-researcher` | Haiku, low |
| 4. Generate motion graphics / kinetic titles if needed | `ue-motion-designer` | Opus, medium |
| 5. Build the edit in the user's editor | `ue-editor` | Sonnet, medium |
| 6. SFX, voice lines, music bed + ducking | `ue-sound` | Haiku, low |
| 7. Look at the result, fix list | `ue-reviewer` | Sonnet, low |
| 8. Apply fixes (max 2 rounds), export | `ue-editor` | Sonnet, medium |

## Flow

1. Ask only what you can't infer: the recording path(s), separate voice/mic file if any, screen recordings, music track (needs rights), target (YouTube 16:9 or short 9:16), length. Ask for reference videos only if the user cares about style.
2. Transcribe the recording (editor MCP transcription tool if available; otherwise ffmpeg + whisper CLI). Then spawn `ue-hook-writer` with the transcriptPath + goal.
3. Show the user the plan summary (hooks + selects + beats) and wait for OK before building.
4. In parallel: `ue-researcher` (b-roll beats), `ue-motion-designer` (generated beats), music prep.
5. `ue-editor` with plan.json + the b-roll paths. Then `ue-sound`. Then `ue-reviewer`.
6. Fix round(s), then export and tell the user where the file is. Never upload or post anything.

## Voice (critical, every edit)

The EXACT clean voice file goes on its own track:
- Premiere: `add_voice` measures sync from the sound and cuts the main track with it; it refuses weak matches.
- Resolve: align by waveform/transcript markers, then cut the main track at the same points.
Then transcribe the aligned voice and build captions that follow it. Check the voice sync marker before export. Captions always follow the voice, not the recording.

## Layers/tracks (always)

Build in named layers so the user can test and fix each part:
- Premiere: V1 MAIN / V2 BACKDROP / V3 ZOOM / V4 B-ROLL / V5 FOCUS / V6 GRAPHICS / V7 CAPTIONS; A1 VOICE / A2 MUSIC / A3 SFX (`setup_layers`).
- Resolve: one video track per role (MAIN, B-ROLL, GRAPHICS, CAPTIONS via Text+) and audio tracks VOICE / MUSIC / SFX. Name every clip.

## Style (neutral - this skill ships with NO house style)

Use clean defaults: white sans-serif word-by-word captions, simple slow-zoom accents, restrained graphics. Do NOT impose any personal theme. If the user shares their own reference videos, presets, or a style description, follow THOSE instead and apply them consistently.

## Sound and music

SFX on every visual change where it helps. Music bed from a track the user has rights to, ducked under the voice. Voice levels above music always.
