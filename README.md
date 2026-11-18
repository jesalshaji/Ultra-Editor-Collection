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

## Install (5–10 minutes)

1. Clone or download this repo
2. Open your AI coding assistant in any folder
3. Paste the contents of `setup/SETUP-PROMPT.txt` and press Enter
4. Answer which software you use (and whether you want the After Effects / Remotion add-ons)
5. Restart the assistant, then test: *"ultra edit this video"* with any short recording

### Requirements
- An AI assistant with MCP support (Claude Code / Claude Desktop are the reference implementations)
- One of: DaVinci Resolve (free is fine) or Premiere Pro
- Node.js 18+, Python 3.10–3.12, ffmpeg
- Your own music track and footage (nothing bundled)

## Licence

MIT — use it, fork it, share it.
