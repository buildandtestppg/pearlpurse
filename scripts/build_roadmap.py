#!/usr/bin/env python3
"""Build public/roadmap.html from ROADMAP.md at release time — one source of truth, zero drift."""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
md = (ROOT / "ROADMAP.md").read_text()
md = md.split("# PearlPurse Roadmap", 1)[1]  # drop title
body = re.sub(r"^Last updated:.*$", "", md, flags=re.M).strip()

def fmt(m):
    m = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", m)
    m = re.sub(r"`([^`]+)`", r'<span class="mono">\1</span>', m)
    return m

# tables
def table(html):
    rows = []
    for line in html.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if all(set(c) <= set("-: ") for c in cells if c):
            continue
        rows.append(cells)
    out = ['<table>']
    for i, cells in enumerate(rows):
        tag = "th" if i == 0 else "td"
        out.append("<tr>" + "".join(f"<{tag}>{fmt(c)}</{tag}>" for c in cells) + "</tr>")
    out.append("</table>")
    return "\n".join(out)

body = re.sub(r"(\|.+\|\n)+", lambda m: table(m.group(0)), body)
body = re.sub(r"^###? (.+)$", lambda m: f"<h2>{fmt(m.group(1))}</h2>", body, flags=re.M)
body = re.sub(r"^[-•] (.+)$", lambda m: f"<li>{fmt(m.group(1))}</li>", body, flags=re.M)
body = re.sub(r"(<li>.*?</li>\n?)+", lambda m: f"<ul>{m.group(0)}</ul>", body)
body = re.sub(r"^<li>", "  <li>", body, flags=re.M)

html = f"""<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Roadmap — PearlPurse</title>
<meta name="description" content="PearlPurse public roadmap: shipped versions, what's in flight, what's next, and what we explicitly won't build." />
<link rel="icon" type="image/svg+xml" href="/pearl.svg" />
<style>
:root {{ --bg:#202727; --card:#2a3333; --border:#3c4444; --text:#f2f4ef; --muted:#a8b3ad; --green:#cde986; }}
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ font-family:"Space Grotesk", ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--text); line-height:1.55; }}
.wrap {{ max-width:680px; margin:0 auto; padding:48px 22px 64px; }}
h1 {{ font-size:26px; margin-bottom:4px; }} .sub {{ color:var(--muted); margin-bottom:24px; }}
h2 {{ font-size:19px; margin:30px 0 10px; }}
table {{ width:100%; border-collapse:collapse; font-size:13.5px; margin-bottom:8px; }}
td, th {{ text-align:left; padding:8px 6px; border-bottom:1px solid var(--border); vertical-align:top; }} th {{ color:var(--muted); font-weight:600; }}
ul {{ margin:4px 0 10px 18px; }} li {{ margin-bottom:7px; }}
.mono {{ font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:12.5px; }}
a {{ color:var(--green); }}
.foot {{ color:var(--muted); font-size:13.5px; margin-top:40px; border-top:1px solid var(--border); padding-top:16px; }}
</style></head><body><div class="wrap">
<h1>PearlPurse Roadmap</h1>
<div class="sub">Public and versioned — source of truth lives in <a href="https://github.com/buildandtestppg/pearlpurse/blob/main/ROADMAP.md">ROADMAP.md</a>. Last updated v0.4.10.</div>
{body}
<div class="foot"><a href="/">← Open the wallet</a> · <a href="/security">Security &amp; builds</a> · <a href="/get-started">Get started</a></div>
</div></body></html>"""
(ROOT / "public/roadmap.html").write_text(html)
print(f"public/roadmap.html written ({len(html)} bytes)")
