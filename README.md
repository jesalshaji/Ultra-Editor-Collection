# Ultra Editor Collection

AI-driven video editing that works in **your own editor**. Hand over a talking-head recording (plus a separate voice file if you have one) and get a finished, layered edit: hooks and best parts, cuts, b-roll, captions that follow the voice, sound effects, ducked music, review rounds, and an export.

Works with **Premiere Pro**, **DaVinci Resolve** (free or Studio) and **After Effects**, with **Remotion** for templated motion graphics — connected by MCP servers, routed by what you ask for.

- Never uploads or posts anything
- Ships with **no editing styles** — neutral defaults; give it your own reference videos and it follows those
- One question at setup: which software you use — anything can be combined ("cut it in Resolve, do the intro in After Effects")

## Repo layout

```
skills/
  ultra-edit/        Main orchestrator skill - asks which software to connect,
                     verifies each connection, runs the multi-agent edit flow
    effects/         On-request effects toolkit: EFFECTS.md recipes (follow-zooms,
                     editable spotlights, real logos, concept/article cards,
                     word-by-word captions, bloom/light-burst transitions, sound hits)
                     + templates/, captions/, transitions/ scripts
  video-factory/     Premiere + After Effects skill - full edits, reels,
                     learns your style from reference videos
connectors/
  ultra-premiere-mcp/ Premiere Pro MCP server + CEP panel (also links After
                     Effects): timeline, silence removal, captions, screen
                     follow-zooms, spotlights, b-roll, sound, export. Themes in
                     styles/ (neutral default, dark-lavender optional)
  ultra-resolve-mcp/ DaVinci Resolve MCP server (Resolve Studio - direct
                     external scripting API)
setup/
  SETUP-PROMPT.txt   Paste into your AI coding assistant to install everything
  READ ME FIRST.txt  Plain-language overview
```

## Editor support matrix

| Software | Role | Connection |
|---|---|---|
| Premiere Pro | Main edit | `connectors/ultra-premiere-mcp` (CEP panel bridge), or any Premiere MCP server |
| DaVinci Resolve free | Main edit | [`davinci-resolve-mcp`](https://github.com/samuelgursky/davinci-resolve-mcp) + in-app bridge (`Workspace ▸ Scripts ▸ resolve_bridge`) |
| DaVinci Resolve Studio | Main edit | Same, or `connectors/ultra-resolve-mcp` (direct API, no bridge) |
| After Effects | Motion graphics, hero titles | [`after-effects-mcp`](https://github.com/TheLlamainator/after-effects-mcp) |
| Remotion | Kinetic text, cards, background animation | Rendered MP4/alpha imports into any editor |

## Effects on request

The edit stays neutral unless you ask. Say *"zoom in on my screen when I click"*, *"highlight the API key"*,
*"show the real Premiere logo"*, *"word-by-word captions"* or *"light-burst transition into each chapter"* and
the skill uses the matching recipe from `skills/ultra-edit/effects/EFFECTS.md`.

One rule whenever effects are used: **real thing first** - if what you're talking about is already on your
screen recording, the edit zooms or spotlights it there instead of covering it with words or a made-up graphic;
otherwise it uses the real logo or real footage.

Logos are downloaded on your machine (`effects/templates/fetch_logos.py`), not shipped. No sound files are
shipped either - add your own licensed sounds to `connectors/ultra-premiere-mcp/assets/sfx/<kit>/`.

## How an edit runs

1. **Connect** — the skill asks which software you want and verifies each connection
2. **Transcribe** — the recording (and voice file) becomes a transcript
3. **Plan** — hooks, best parts, beat list; you approve before anything is built
4. **Build** — layered timeline in your editor: MAIN / B-ROLL / GRAPHICS / CAPTIONS + VOICE / MUSIC / SFX tracks, every clip named
5. **Voice** — the clean voice file is synced and the cut follows it; captions follow the voice
6. **Sound** — SFX on changes, music ducked under voice
7. **Review + fix** — up to two fix rounds, then export

## Install (10–15 minutes, guided step by step)

1. **Get the files:** download **[Ultra-Editor-Collection.zip](Ultra-Editor-Collection.zip)** (everything in this repo)
   and unzip it somewhere you'll keep it - or `git clone` this repo.
2. Open Claude Code (or any AI app with MCP support) in that folder.
3. Paste the contents of `setup/SETUP-PROMPT.txt` and press Enter.
4. It asks **which software you use** - Premiere Pro, DaVinci Resolve (free/Studio), After Effects, or a mix
   (+ Remotion) - then walks you through installing **only that software's connector and the skill, one step at a
   time**, checking each step before the next.
5. Start a new session and test: *"ultra edit this video"* with any short recording.

Already installed the skill? Just say *"ultra edit"* - if your editor isn't connected yet, the skill switches to the
same guided install (`skills/ultra-edit/INSTALL.md`).

| Software | What gets installed |
|---|---|
| Premiere Pro (Windows) | `connectors/ultra-premiere-mcp`: npm install, the Ultra Premiere panel, a local Whisper venv, `claude mcp add` |
| After Effects | the same panel (Window > Extensions > Ultra Premiere) - or the open-source After Effects MCP on its own |
| DaVinci Resolve | `npx davinci-resolve-mcp setup` (+ the resolve_bridge script on the free edition); Studio can use `connectors/ultra-resolve-mcp` |
| Remotion | nothing extra - Node 18+ |

### Requirements
- An AI assistant with MCP support (Claude Code / Claude Desktop are the reference implementations)
- One of: Premiere Pro (Windows), DaVinci Resolve (free is fine), After Effects
- Node.js 18+, Python 3.10–3.12, ffmpeg (the guided setup installs what's missing)
- Your own music track and footage (nothing bundled)

## Using other models

The connectors are standard MCP servers, so any MCP-capable app (Claude Code, OpenCode, Cursor, ...) and any model
with tool calling can drive them. Other apps don't load `SKILL.md` automatically - paste it in as instructions.

- **Basic edits work on most capable models** - silence cuts, layered timeline, captions, a click on every cut, export.
- **Weaker / free models struggle with** long multi-step plans, exact highlight placement (needs a model that can see
  rendered frames), and very long sessions with many tool calls.
- The cheap-model / strong-model agent split (search and sound on a small model, motion design on a large one) is a
  Claude Code feature; elsewhere one model does every step.

## Licence

MIT — use it, fork it, share it.
