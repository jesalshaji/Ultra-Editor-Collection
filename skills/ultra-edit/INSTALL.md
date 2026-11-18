# Ultra Edit - install guide (used by the skill)

The skill reads this file when a software the user picked is **not connected yet**. Walk the user through
**one step at a time**: say what the step does, run the command yourself when you can (ask first), tell them
exactly what to click when it happens inside an app, then **check it worked before the next step**.
Only do the sections for the software the user picked.

`<REPO>` below = the folder where the user cloned or unzipped **Ultra-Editor-Collection**. If you don't know it,
ask: *"Where did you unzip / clone Ultra-Editor-Collection?"* (look in Downloads, Desktop, Documents first).

| The user uses | Sections |
|---|---|
| Premiere Pro | 1, 2, 3 |
| Premiere Pro + After Effects | 1, 2, 3, 4A |
| After Effects only | 1, 2, 4B |
| DaVinci Resolve (free) | 1, 2, 5 |
| DaVinci Resolve Studio | 1, 2, 5 or 6 |
| Remotion (motion add-on) | 1, 2, 7 |

---

## 1. Basics (everyone)

Check each one; install only what is missing.

| Check | Expect | Install if missing (Windows) | macOS |
|---|---|---|---|
| `node --version` | v18 or newer | `winget install OpenJS.NodeJS.LTS` | `brew install node` |
| `python --version` | 3.10 - 3.12 | `winget install Python.Python.3.12` | `brew install python@3.12` |
| `ffmpeg -version` | any | `winget install Gyan.FFmpeg` | `brew install ffmpeg` |

After a winget install, the user must **close and reopen the terminal** (and Claude) so the new command is found.

## 2. Install the skill

1. Copy the whole folder `<REPO>/skills/ultra-edit` (SKILL.md, INSTALL.md and `effects/`) to:
   - **Claude Code:** `~/.claude/skills/ultra-edit/` (Windows: `%USERPROFILE%\.claude\skills\ultra-edit\`)
   - **Claude Desktop / claude.ai:** zip the `ultra-edit` folder, then Settings > Capabilities > Skills > Upload.
2. Effects add-ons (only needed when the user asks for effects): `python -m pip install numpy pillow`.
   Real app logos: `python ~/.claude/skills/ultra-edit/effects/templates/fetch_logos.py` (downloads them once).
3. Check: the folder `~/.claude/skills/ultra-edit/SKILL.md` exists.

## 3. Premiere Pro (Windows) - `connectors/ultra-premiere-mcp`

1. **Packages.** In a terminal:
   ```
   cd "<REPO>/connectors/ultra-premiere-mcp"
   npm install
   ```
2. **Panel into Premiere.** Same folder:
   ```
   node scripts/install-panel.js
   ```
   It links the "Ultra Premiere" panel into Premiere and allows unsigned panels (current user only, no admin).
3. **Local transcription + tools (free, runs on the PC).**
   ```
   python -m venv "%USERPROFILE%\.ultra-premiere-mcp\venv"
   "%USERPROFILE%\.ultra-premiere-mcp\venv\Scripts\pip" install faster-whisper numpy pillow
   ```
4. **Register the connector with Claude Code:**
   ```
   claude mcp add --scope user ultra-premiere -- node "<REPO>/connectors/ultra-premiere-mcp/server/index.js"
   ```
   (Claude Desktop: add the same command under `mcpServers` in its config file, then restart it.)
5. **In Premiere** (the user does this): restart Premiere Pro, open any project, then
   **Window > Extensions > Ultra Premiere**. The panel's dot turns green and says *Connected*.
   Leave the panel open (it can be docked).
6. **New Claude session** (MCP servers load at start). Say: *"check my Premiere status"* -> `premiere_status`
   should show the project. Done.
7. Optional:
   - Rounded screen frames: create a Premiere effect preset named **round crop universal video** (any rounded
     crop effect). Without it, zooms still work with square corners.
   - Theme: set the env var `ULTRA_THEME` (`neutral` default, `dark-lavender`, or a path to your own tokens.json).
   - Sound effects: put your own licensed .wav files in `<REPO>/connectors/ultra-premiere-mcp/assets/sfx/<kit>/`
     (names with "click", "swish", "riser", "impact", "subboom").

Troubleshooting: panel missing -> run step 2 again and restart Premiere. "NOT CONNECTED" -> click
*Start / restart bridge* in the panel. Test from a terminal: `node scripts/test-bridge.js`.

## 4. After Effects

**4A - with Premiere (recommended): the same Ultra Premiere panel links After Effects.**
1. Section 3 done first.
2. After Effects: **Edit > Preferences > Scripting & Expressions >** tick
   *Allow Scripts to Write Files and Access Network*. Restart After Effects.
3. In After Effects: **Window > Extensions > Ultra Premiere** (titled *Ultra AE Link*, shows Connected).
4. Check: say *"check my After Effects link"* -> `ae_status`.

**4B - After Effects on its own:** install the open-source After Effects MCP.
1. Step 2 of 4A (the scripting preference).
2. ```
   git clone https://github.com/TheLlamainator/after-effects-mcp
   cd after-effects-mcp && npm install && npm run build
   claude mcp add --scope user AfterEffectsMCP -- node "<full path>/after-effects-mcp/build/index.js"
   ```
3. In After Effects open the connector's bridge panel from the **Window** menu and turn on auto-run.
4. New Claude session, say: *"Get my After Effects project info"*.

## 5. DaVinci Resolve (free or Studio) - davinci-resolve-mcp

1. ```
   npx -y davinci-resolve-mcp@latest setup --clients all
   ```
   (installs the server and its own Python, and registers it with Claude).
2. **Free edition only - the in-app bridge:**
   - Run the bridge installer it printed (`install_resolve_bridge.py`, with the venv Python it names).
   - Restart Resolve, open a project, then **Workspace > Scripts > resolve_bridge**. Keep Resolve open.
3. New Claude session, say: *"check my DaVinci Resolve status"*.

## 6. DaVinci Resolve Studio - `connectors/ultra-resolve-mcp` (alternative, no bridge)

1. `python -m pip install "mcp<2"`
2. Resolve: **Preferences > System > General > External scripting using = Local**, restart Resolve.
3. With a project open: `python "<REPO>/connectors/ultra-resolve-mcp/scripts/test-connection.py"`
4. ```
   claude mcp add --scope user ultra-resolve-mcp -- python "<REPO>/connectors/ultra-resolve-mcp/server/index.py"
   ```
5. New Claude session: *"check my DaVinci Resolve status"*.

## 7. Remotion (motion graphics add-on)

Nothing to install up front - only Node 18+ (section 1). The skill scaffolds a small Remotion project in the job
folder when a shot needs it. Check: `npx remotion versions`.

---

## Finish

Tell the user what is connected, then: *"Restart Claude (new session), give me a short recording and say
**ultra edit this video**."*
