"""Ultra Resolve MCP - drives DaVinci Resolve (timeline, media, text, export).

Connects to the RUNNING Resolve instance via the official scripting API.
DaVinci Resolve must be open, and in Preferences > System > General,
"External scripting using" must be set to "Local".
"""

import os
import sys

from mcp.server.fastmcp import FastMCP

RESOLVE_API_PATH = os.environ.get(
    "RESOLVE_SCRIPT_API",
    r"C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting",
)
RESOLVE_LIB_PATH = os.environ.get(
    "RESOLVE_SCRIPT_LIB",
    r"C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll",
)

os.environ.setdefault("RESOLVE_SCRIPT_API", RESOLVE_API_PATH)
os.environ.setdefault("RESOLVE_SCRIPT_LIB", RESOLVE_LIB_PATH)
sys.path.append(os.path.join(RESOLVE_API_PATH, "Modules"))

import DaVinciResolveScript as dvs  # noqa: E402

mcp = FastMCP("ultra-resolve-mcp")


class ResolveConnectionError(Exception):
    pass


def _resolve():
    resolve = dvs.scriptapp("Resolve")
    if resolve is None:
        raise ResolveConnectionError(
            "Cannot reach DaVinci Resolve. Open Resolve first, then in "
            "Preferences > System > General set 'External scripting using' to 'Local'."
        )
    return resolve


def _project():
    project = _resolve().GetProjectManager().GetCurrentProject()
    if project is None:
        raise ResolveConnectionError("No project is open in Resolve. Open or create one first.")
    return project


def _timeline():
    tl = _project().GetCurrentTimeline()
    if tl is None:
        raise ResolveConnectionError("No timeline is open. Create or open one first.")
    return tl


def _pool_clips():
    return _project().GetMediaPool().GetRootFolder().GetClipList() or []


# ---------------------------------------------------------------- status

@mcp.tool()
def resolve_status() -> str:
    """Check the connection to DaVinci Resolve and report the current project, timeline, resolution, FPS and tracks."""
    resolve = _resolve()
    project = resolve.GetProjectManager().GetCurrentProject()
    tl = project.GetCurrentTimeline() if project else None
    lines = [
        f"Resolve version: {resolve.GetVersionString()}",
        f"Project: {project.GetName() if project else '(none open)'}",
    ]
    if project:
        lines.append(f"Timeline: {tl.GetName() if tl else '(none)'}")
        if tl:
            lines.append(f"Resolution: {tl.GetSetting('timelineResolutionWidth')}x{tl.GetSetting('timelineResolutionHeight')}")
            lines.append(f"FPS: {tl.GetSetting('timelineFrameRate')}")
            lines.append(f"Duration (frames): {tl.GetSetting('timelineDuration')}")
            lines.append(
                f"Tracks: {tl.GetTrackCount('video')} video, {tl.GetTrackCount('audio')} audio"
            )
    return "\n".join(lines)


@mcp.tool()
def list_projects() -> str:
    """List all projects in the Resolve project manager."""
    projects = _resolve().GetProjectManager().ListProjects() or []
    if not projects:
        return "No projects found."
    names = []
    for p in projects:
        names.append(p["name"] if isinstance(p, dict) else p.GetName())
    return "\n".join(names)


@mcp.tool()
def open_project(name: str) -> str:
    """Open a project by name."""
    pm = _resolve().GetProjectManager()
    ok = pm.LoadProject(name)
    return f"Opened project: {name}" if ok else f"Failed to open '{name}' (not found or already open)."


@mcp.tool()
def create_project(name: str) -> str:
    """Create a new project and open it."""
    pm = _resolve().GetProjectManager()
    project = pm.CreateProject(name)
    if project is None:
        return f"Failed to create project '{name}' (maybe it already exists)."
    return f"Created and opened project: {name}"


# ---------------------------------------------------------------- media pool

@mcp.tool()
def import_media(paths: list[str]) -> str:
    """Import media files (video, audio, images) into the current media pool. Pass absolute file paths."""
    items = _project().GetMediaPool().ImportMedia([{"media": p} for p in paths])
    if not items:
        return "Import failed - check the paths and file formats."
    return "Imported:\n" + "\n".join(i.GetName() for i in items)


@mcp.tool()
def list_media_pool() -> str:
    """List all clips in the media pool root folder."""
    clips = _pool_clips()
    if not clips:
        return "Media pool is empty."
    return "\n".join(c.GetName() for c in clips)


# ---------------------------------------------------------------- timelines

@mcp.tool()
def create_timeline(name: str) -> str:
    """Create a new empty timeline in the current project."""
    tl = _project().GetMediaPool().CreateEmptyTimeline(name)
    if tl is None:
        return f"Failed to create timeline '{name}'."
    return f"Created timeline: {name}"


@mcp.tool()
def list_timelines() -> str:
    """List all timelines in the current project (the active one is marked with >)."""
    tls = _project().GetTimelineCount() and [
        _project().GetTimelineByIndex(i + 1) for i in range(_project().GetTimelineCount())
    ] or []
    current = _project().GetCurrentTimeline()
    current_name = current.GetName() if current else ""
    return "\n".join(("> " if t.GetName() == current_name else "") + t.GetName() for t in tls) or "No timelines."


@mcp.tool()
def set_current_timeline(name: str) -> str:
    """Switch to a timeline by name."""
    project = _project()
    for i in range(1, (project.GetTimelineCount() or 0) + 1):
        tl = project.GetTimelineByIndex(i)
        if tl and tl.GetName().lower() == name.lower():
            project.SetCurrentTimeline(tl)
            return f"Switched to timeline '{name}'."
    return f"Timeline '{name}' not found."


# ---------------------------------------------------------------- editing

@mcp.tool()
def add_clips(clips: list[str], track_index: int = 1, track_type: str = "video") -> str:
    """Append media-pool clips (by name) to the end of a track. track_type: 'video' (1) or 'audio' (2)."""
    media_type = 1 if track_type == "video" else 2
    by_name = {c.GetName().lower(): c for c in _pool_clips()}
    payload = []
    for name in clips:
        item = by_name.get(name.lower())
        if item is None:
            return f"Clip '{name}' is not in the media pool. Use list_media_pool first."
        payload.append({"mediaPoolItem": item, "trackIndex": track_index, "mediaType": media_type})
    result = _project().GetMediaPool().AppendToTimeline(payload)
    if not result:
        return "Failed to append clips."
    return f"Appended {len(result)} clip(s) to {track_type} track {track_index}."


@mcp.tool()
def get_timeline_clips() -> str:
    """List every clip in the current timeline with track, position and duration."""
    tl = _timeline()
    out = []
    for track in range(1, (tl.GetTrackCount("video") or 0) + 1):
        for it in tl.GetItemListInTrack("video", track) or []:
            out.append(f"V{track} [{it.GetStart()}-{it.GetEnd()}] {it.GetName()}")
    for track in range(1, (tl.GetTrackCount("audio") or 0) + 1):
        for it in tl.GetItemListInTrack("audio", track) or []:
            out.append(f"A{track} [{it.GetStart()}-{it.GetEnd()}] {it.GetName()}")
    return "\n".join(out) if out else "Timeline is empty."


@mcp.tool()
def delete_clip(track_type: str, track_index: int, clip_index: int, ripple: bool = False) -> str:
    """Delete a clip from the current timeline (1-based clip_index in that track). ripple=True closes the gap."""
    tl = _timeline()
    items = tl.GetItemListInTrack(track_type, track_index) or []
    if clip_index < 1 or clip_index > len(items):
        return f"Clip index {clip_index} out of range (1-{len(items)})."
    ok = tl.DeleteClips([items[clip_index - 1]], ripple)
    return "Deleted." if ok else "Delete failed."


@mcp.tool()
def set_clip_name(track_type: str, track_index: int, clip_index: int, name: str) -> str:
    """Rename a timeline clip. Helps the assistant reference specific clips later."""
    tl = _timeline()
    items = tl.GetItemListInTrack(track_type, track_index) or []
    if clip_index < 1 or clip_index > len(items):
        return f"Clip index {clip_index} out of range (1-{len(items)})."
    items[clip_index - 1].SetName(name)
    return f"Renamed clip {clip_index} on {track_type} track {track_index} to '{name}'."


@mcp.tool()
def add_marker(frame: int, name: str = "Marker", note: str = "", color: str = "Blue") -> str:
    """Add a marker to the current timeline at a frame number. Colors: Blue, Cyan, Green, Yellow, Red, Pink, Purple, Lavender, Sky, Mint, Rose, Orange, Tan, Peach."""
    ok = _timeline().AddMarker(frame, color, name, note, 1)
    return f"Marker '{name}' added at frame {frame}." if ok else f"Failed to add marker at frame {frame}."


@mcp.tool()
def add_text(text: str, track_index: int = 1) -> str:
    """Insert a Text+ title with the given text at the playhead position on a video track."""
    tl = _timeline()
    item = tl.InsertFusionTitleIntoTimeline("Text+")
    if item is None:
        return "Failed to insert Text+ (try on the Edit page)."
    try:
        comp = item.GetFusionCompByIndex(1)
        tool = comp and (comp.FindToolByID("TextPlus") or comp.FindTool("TextPlus"))
        if tool:
            tool.SetInput("Text", text)
    except Exception as exc:  # noqa: BLE001
        return f"Inserted Text+ but could not set the text automatically: {exc}"
    return f"Inserted Text+ with text '{text}' at the playhead on video track {track_index}."


# ---------------------------------------------------------------- export

@mcp.tool()
def list_render_formats() -> str:
    """List available render formats and codecs in this Resolve install."""
    project = _project()
    out = []
    for fmt in (project.GetRenderFormats() or {}):
        out.append(f"FORMAT {fmt} -> extensions: {project.GetRenderFormats()[fmt]}")
    return "\n".join(out) or "No render formats found."


@mcp.tool()
def render_export(
    output_dir: str,
    file_name: str,
    format: str = "mp4",
    codec: str = "h264",
    preset: str = "",
    wait: bool = False,
) -> str:
    """Render the current timeline. format: 'mp4'/'mov'/'mkv'. codec: 'h264'/'h265'/'prores'. If wait=True, blocks until rendering finishes."""
    project = _project()
    tl = _timeline()
    formats = project.GetRenderFormats() or {}
    fmt_key = next((f for f in formats if f.lower() == format.lower()), None)
    if fmt_key is None:
        return f"Format '{format}' not available. Use list_render_formats."
    codecs = project.GetRenderCodecs(fmt_key) or {}
    codec_key = next((c for c in codecs.values() if c.lower() == codec.lower()), None)
    if codec_key is None:
        return f"Codec '{codec}' not available for {fmt_key}. Available: {list(codecs.values())}"
    if preset:
        if not project.LoadRenderPreset(preset):
            return f"Preset '{preset}' not found. Use GetRenderPresetList in Resolve."
    settings = {
        "SelectAllFrames": 1,
        "TargetDir": output_dir,
        "CustomName": file_name,
    }
    if not project.SetRenderSettings(settings):
        return "Failed to set render settings (check output_dir exists)."
    if not project.SetCurrentRenderFormatAndCodec(fmt_key, codec_key):
        return "Failed to set format/codec."
    job_id = project.AddRenderJob()
    if not job_id:
        return "Failed to queue render job."
    project.StartRendering(job_id)
    if wait:
        while project.IsRenderingInProgress():
            pass
    status = project.GetRenderJobStatus(job_id)
    return f"Queued render '{file_name}' to {output_dir}. Job status: {status.get('JobStatus', status)}"


if __name__ == "__main__":
    mcp.run()
