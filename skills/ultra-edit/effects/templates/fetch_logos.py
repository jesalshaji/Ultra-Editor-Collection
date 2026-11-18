"""Download official app logos (SVG) from Wikimedia Commons into templates/logos/.

Logos are trademarks of their owners, so the repo does not ship them; this fetches them on your
machine for use in your own videos (nominative use: showing the app you are talking about).

usage: python fetch_logos.py                 # all known logos
       python fetch_logos.py premiere davinci # just these
Add any other logo by saving its official SVG as templates/logos/<name>.svg.
"""
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "logos")

# name -> Wikimedia Commons file name
LOGOS = {
    "premiere": "Adobe_Premiere_Pro_CC_icon.svg",
    "aftereffects": "Adobe_After_Effects_CC_icon.svg",
    "photoshop": "Adobe_Photoshop_CC_icon.svg",
    "illustrator": "Adobe_Illustrator_CC_icon.svg",
    "davinci": "DaVinci_Resolve_17_logo.svg",
}


def fetch(name, file):
    url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(file)
    req = urllib.request.Request(url, headers={"User-Agent": "ultra-edit-logo-fetch/1.0"})
    for attempt in range(5):  # Wikimedia rate-limits bursts (HTTP 429): back off and retry
        try:
            data = urllib.request.urlopen(req, timeout=30).read()
            break
        except urllib.error.HTTPError as ex:
            if ex.code != 429 or attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))
    text = data.decode("utf-8", "replace")
    if "<svg" not in text:
        raise ValueError("not an SVG")
    if re.search(r"<script|\son\w+\s*=|javascript:", text, re.I):
        raise ValueError("SVG contains script - skipped")
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name + ".svg"), "wb") as f:
        f.write(data)
    return len(data)


if __name__ == "__main__":
    names = sys.argv[1:] or list(LOGOS)
    for n in names:
        if n not in LOGOS:
            print(f"{n}: unknown - save its SVG as logos/{n}.svg yourself")
            continue
        if os.path.isfile(os.path.join(OUT, n + ".svg")) and "--force" not in sys.argv:
            print(f"{n}: already there")
            continue
        try:
            print(f"{n}: {fetch(n, LOGOS[n])} bytes")
            time.sleep(1)
        except Exception as ex:
            print(f"{n}: FAILED ({ex})")
