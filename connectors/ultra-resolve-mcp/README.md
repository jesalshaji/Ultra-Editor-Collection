# Ultra Resolve MCP

Drives **DaVinci Resolve** — timelines, media pool, clips, markers, Text+ titles, render/export — over the official Resolve scripting API. Built the same way as `ultra-premiere-mcp` so a DaVinci version of the edit flow can be added to your skills.

## Requirements
- DaVinci Resolve (any free/studio version) **open**, with:
  `Preferences > System > General > "External scripting using"` = **Local**
- Python 3.10+ with `pip install "mcp<2"` (already done on this machine)

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

## Test the connection
With Resolve open:
```
python "C:\VOICE AI generator\premier-mcp-setup\ultra-resolve-mcp\scripts\test-connection.py"
```

## Register with your MCP client
```
claude mcp add ultra-resolve-mcp -- python "C:\VOICE AI generator\premier-mcp-setup\ultra-resolve-mcp\server\index.py"
```

## Notes
- Resolve must be running — the API talks to a live instance, there is no headless mode.
- Rendering is queued in Resolve's Render page; keep an eye on it there for progress.
- If a tool returns a connection error, check that Resolve is open and External scripting = Local.
