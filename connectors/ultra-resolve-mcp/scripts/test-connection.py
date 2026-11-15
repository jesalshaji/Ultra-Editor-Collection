"""Quick test: can this machine reach the running DaVinci Resolve? Run with Resolve OPEN."""

import os
import sys

RESOLVE_API_PATH = os.environ.get(
    "RESOLVE_SCRIPT_API",
    r"C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting",
)
RESOLVE_LIB_PATH = os.environ.get(
    "RESOLVE_SCRIPT_LIB",
    r"C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll",
)
os.environ["RESOLVE_SCRIPT_API"] = RESOLVE_API_PATH
os.environ["RESOLVE_SCRIPT_LIB"] = RESOLVE_LIB_PATH
sys.path.append(os.path.join(RESOLVE_API_PATH, "Modules"))

import DaVinciResolveScript as dvs

resolve = dvs.scriptapp("Resolve")
if resolve is None:
    print("FAIL: could not reach Resolve.")
    print("1. Is DaVinci Resolve open?")
    print("2. Preferences > System > General > 'External scripting using' = 'Local'")
    sys.exit(1)

print(f"OK: connected to Resolve {resolve.GetVersionString()}")
pm = resolve.GetProjectManager()
project = pm.GetCurrentProject()
if project is None:
    print("Connected, but no project is open (open one in Resolve).")
else:
    tl = project.GetCurrentTimeline()
    print(f"Project: {project.GetName()}")
    print(f"Timeline: {tl.GetName() if tl else '(none)'}")
