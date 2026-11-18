# Ultra Resolve MCP

Drives **DaVinci Resolve** - timelines, media pool, clips, markers, Text+ titles, render/export - over the official
Resolve scripting API. Use it when you have **Resolve Studio** (direct external scripting). On the **free** edition,
use the `davinci-resolve-mcp` route in `setup/SETUP-PROMPT.txt` instead (it adds an in-app bridge).

## Install (Windows, step by step)

1. **Python 3.10-3.12** installed (`python --version`).
2. Install the one package it needs:
   ```
   python -m pip install "mcp<2"
   ```
3. In DaVinci Resolve: **Preferences > System > General > External scripting using = Local**. Restart Resolve.
4. Open Resolve with a project open, then test the connection (from this folder):
   ```
   python scripts/test-connection.py
   ```
5. Register it with Claude Code (use the full path to this folder):
   ```
   claude mcp add --scope user ultra-resolve-mcp -- python "<full path>/connectors/ultra-resolve-mcp/server/index.py"
   ```
6. Start a **new** Claude session and say: *"check my DaVinci Resolve status"*.

Resolve installed somewhere else, or on macOS? Set these before step 4:
```
RESOLVE_SCRIPT_API = <Resolve>/Support/Developer/Scripting   (macOS: /Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting)
RESOLVE_SCRIPT_LIB = <Resolve>/fusionscript.dll               (macOS: /Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so)
```

## Tools
| Tool | What it does |
|---|---|
| `resolve_status` | Connection, project, timeline, resolution, FPS, tracks |
| `list_projects` / `open_project` / `create_project` | Project manager |
| `import_media` / `list_media_pool` | Media pool |
| `create_timeline` / `list_timelines` / `set_current_timeline` | Timelines |
| `add_clips` / `get_timeline_clips` / `delete_clip` / `set_clip_name` | Editing |
| `add_marker` / `add_text` | Markers and Text+ titles at the playhead |
| `list_render_formats` / `render_export` | Render to MP4/MOV/MKV (H264/H265/ProRes) |

## Notes
- Resolve must be running - the API talks to a live instance, there is no headless mode.
- Rendering is queued in Resolve's Render page; watch progress there.
- Connection error? Check Resolve is open and External scripting = Local.
