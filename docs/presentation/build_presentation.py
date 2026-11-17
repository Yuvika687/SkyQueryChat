"""Build docs/presentation/SkyQueryChat.pptx (course project review, about 10 minutes).

    python docs/presentation/build_presentation.py

Every number comes from the repository: docs/project-overview.md, evals/scoreboard.json (first-pass runs) and the
test runs recorded in CHANGES.md. Screenshots are in docs/presentation/images (taken from the running site on
17 Nov 2026). One font (Calibri), dark navy title and closing slides, light content slides, teal accent.
"""
from __future__ import annotations

import json
from pathlib import Path

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
IMG = HERE / "images"
OUT = HERE / "SkyQueryChat.pptx"

FONT = "Calibri"
NAVY = RGBColor(0x0B, 0x13, 0x24)
NAVY_2 = RGBColor(0x13, 0x1F, 0x3A)
TEAL = RGBColor(0x14, 0xB8, 0xA6)
TEAL_DARK = RGBColor(0x0F, 0x76, 0x6E)      # teal text on white (contrast 5.5:1)
TEAL_SOFT = RGBColor(0xCC, 0xFB, 0xF1)
INK = RGBColor(0x0F, 0x17, 0x2A)
MUTED = RGBColor(0x47, 0x55, 0x69)
FAINT = RGBColor(0x94, 0xA3, 0xB8)
CARD = RGBColor(0xF1, 0xF5, 0xF9)
LINE = RGBColor(0xCB, 0xD5, 0xE1)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
ICE = RGBColor(0xCF, 0xFA, 0xF4)
AMBER = RGBColor(0xB4, 0x53, 0x09)
AMBER_SOFT = RGBColor(0xFE, 0xF3, 0xC7)
BLUE_SOFT = RGBColor(0xDB, 0xEA, 0xFE)
BLUE = RGBColor(0x1D, 0x4E, 0xD8)

LIVE = "sky-query-chat.vercel.app"
NAME = "Yuvika Malhotra"
COURSE = "Course project review"
DATE = "17 November 2026"

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
BLANK = prs.slide_layouts[6]
SW, SH = 13.333, 7.5


# ------------------------------------------------------------------ helpers
def _alpha(shape, pct: int):
    """Fill transparency (0 = solid, 100 = invisible) on a solid-filled shape."""
    clr = shape.fill._xPr.find(qn("a:solidFill")).find(qn("a:srgbClr"))
    a = etree.SubElement(clr, qn("a:alpha"))
    a.set("val", str(int((100 - pct) * 1000)))


def bg(slide, color):
    f = slide.background.fill
    f.solid()
    f.fore_color.rgb = color


def box(slide, x, y, w, h, fill=CARD, line=None, radius=0.12, shape=MSO_SHAPE.ROUNDED_RECTANGLE, alpha=None, name=None):
    s = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = radius
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid()
        s.fill.fore_color.rgb = fill
        if alpha is not None:
            _alpha(s, alpha)
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(1.25)
    s.shadow.inherit = False
    s.text_frame.text = ""
    if name:
        s.name = name
    return s


def text(slide, x, y, w, h, runs, size=18, color=INK, bold=False, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
         spacing=1.0, after=0, name=None):
    """runs: a string, or a list of paragraphs; each paragraph a string or a list of (text, {opts}) runs."""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    paras = runs if isinstance(runs, list) else [runs]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        p.space_after = Pt(after)
        for t, o in ([(para, {})] if isinstance(para, str) else para):
            r = p.add_run()
            r.text = t
            f = r.font
            f.name = FONT
            f.size = Pt(o.get("size", size))
            f.bold = o.get("bold", bold)
            f.italic = o.get("italic", False)
            f.color.rgb = o.get("color", color)
    if name:
        tb.name = name
    return tb


def bullets(slide, x, y, w, h, items, size=20, color=INK, gap=10, dot=TEAL):
    """Short bullets drawn with a teal dot shape (one idea each)."""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    for i, it in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(gap)
        pPr = p._p.get_or_add_pPr()
        pPr.set("marL", str(Inches(0.32)))
        pPr.set("indent", str(-Inches(0.32)))
        bu = etree.SubElement(pPr, qn("a:buClr"))
        c = etree.SubElement(bu, qn("a:srgbClr"))
        c.set("val", str(dot))
        bf = etree.SubElement(pPr, qn("a:buFont"))
        bf.set("typeface", "Arial")
        ch = etree.SubElement(pPr, qn("a:buChar"))
        ch.set("char", "•")
        for t, o in ([(it, {})] if isinstance(it, str) else it):
            r = p.add_run()
            r.text = t
            r.font.name = FONT
            r.font.size = Pt(o.get("size", size))
            r.font.bold = o.get("bold", False)
            r.font.color.rgb = o.get("color", color)
    return tb


def arrow(slide, x1, y1, x2, y2, color=TEAL, width=2.25, both=False, dash=False, head=True):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = color
    c.line.width = Pt(width)
    ln = c.line._get_or_add_ln()
    if dash:
        d = etree.SubElement(ln, qn("a:prstDash"))
        d.set("val", "dash")
    for tag in (["a:headEnd"] if both else []) + (["a:tailEnd"] if head else []):
        e = etree.SubElement(ln, qn(tag))
        e.set("type", "triangle")
        e.set("w", "med")
        e.set("len", "med")
    return c


def badge(slide, x, y, d, label, fill=TEAL, color=WHITE, size=16):
    """A number or symbol in a filled circle: the deck's repeated motif."""
    s = box(slide, x, y, d, d, fill=fill, shape=MSO_SHAPE.OVAL)
    tf = s.text_frame
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = label
    r.font.name, r.font.size, r.font.bold, r.font.color.rgb = FONT, Pt(size), True, color
    return s


def picture(slide, path, x, y, w, h, border=LINE):
    """Screenshot cropped to fill the box exactly (no distortion), with a thin frame."""
    iw, ih = Image.open(path).size
    box_r, img_r = w / h, iw / ih
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w), Inches(h))
    if img_r > box_r:                                  # too wide: crop the sides
        cut = (1 - box_r / img_r) / 2
        pic.crop_left = pic.crop_right = cut
    elif img_r < box_r:                                # too tall: crop the bottom
        pic.crop_bottom = 1 - img_r / box_r
    pic.line.color.rgb = border
    pic.line.width = Pt(1)
    return pic


def frame(slide, n, kicker, title, dark=False):
    """Content slide frame: kicker, title (same place on every content slide) and page number."""
    bg(slide, NAVY if dark else WHITE)
    text(slide, 0.6, 0.42, 9, 0.35, kicker.upper(), size=13, bold=True, color=TEAL if dark else TEAL_DARK)
    text(slide, 0.6, 0.72, 12.1, 0.8, title, size=34, bold=True, color=WHITE if dark else INK)
    text(slide, SW - 1.4, SH - 0.5, 0.8, 0.3, str(n), size=12, color=FAINT, align=PP_ALIGN.RIGHT)


def notes(slide, s):
    slide.notes_slide.notes_text_frame.text = s


def node(slide, x, y, w, h, title, sub="", fill=CARD, line=LINE, tcolor=INK, scolor=MUTED, tsize=18, ssize=14):
    b = box(slide, x, y, w, h, fill=fill, line=line)
    text(slide, x + 0.15, y + 0.12, w - 0.3, h - 0.24,
         [[(title, {"bold": True, "size": tsize, "color": tcolor})]] + ([[(sub, {"size": ssize, "color": scolor})]] if sub else []),
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, after=2)
    return b


def scores() -> list[tuple[str, int, int, float, float]]:
    sb = json.loads((ROOT / "evals" / "scoreboard.json").read_text(encoding="utf-8"))
    names = {"main": "Main set", "holdout2": "Holdout 2 (unseen)", "holdout": "Holdout 1", "diwali2026": "Diwali 2026",
             "analysis": "Statistics and comparisons", "conversation": "Conversation", "suggestions": "Suggested questions"}
    out = []
    for key, label in names.items():
        fp = (sb["sets"].get(key) or {}).get("main_first_pass")
        if fp:
            o = fp["summary"]["overall"]
            out.append((label, o["pass"], o["turns"], o["pass_pct"], o["numbers_traceable_pct"]))
    return out


# ================================================================== 1. title
s = prs.slides.add_slide(BLANK)
bg(s, NAVY)
for i, (d, a) in enumerate([(5.6, 88), (4.3, 80), (3.0, 70)]):             # the "sky orb" with rings
    o = box(s, 10.35 - d / 2, 3.55 - d / 2, d, d, fill=TEAL, shape=MSO_SHAPE.OVAL, alpha=a)
orb = box(s, 9.35, 2.55, 2.0, 2.0, fill=RGBColor(0x5E, 0xEA, 0xD4), shape=MSO_SHAPE.OVAL)
for cx, cy in [(8.0, 1.6), (12.4, 2.3), (8.4, 5.6), (12.0, 5.4), (7.6, 3.6), (12.8, 4.2)]:   # six cities
    box(s, cx, cy, 0.16, 0.16, fill=ICE, shape=MSO_SHAPE.OVAL)
text(s, 0.8, 1.55, 7.2, 0.4, "COURSE PROJECT REVIEW", size=14, bold=True, color=TEAL)
text(s, 0.8, 2.0, 7.4, 1.0, "SkyQueryChat", size=60, bold=True, color=WHITE)
text(s, 0.8, 3.05, 7.0, 1.3, "An agentic AI air-quality analyst for six Indian cities", size=28, color=ICE, spacing=1.05)
text(s, 0.8, 4.75, 7.0, 1.3, [[(NAME, {"bold": True, "size": 20, "color": WHITE})],
                              [(f"{COURSE} · {DATE}", {"size": 16, "color": FAINT})]], after=4)
pill = box(s, 0.8, 5.95, 4.3, 0.55, fill=NAVY_2, line=TEAL, radius=0.5)
text(s, 0.8, 5.95, 4.3, 0.55, f"Live:  {LIVE}", size=16, bold=True, color=TEAL, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
notes(s, "Hello, I am presenting SkyQueryChat, an agentic AI analyst for air quality in six Indian cities. "
         "You can ask it a question in plain English and it answers with real, checked numbers. "
         "The site is live at sky-query-chat.vercel.app, so you can try it during the talk.")

# ================================================================== 2. problem
s = prs.slides.add_slide(BLANK)
frame(s, 2, "The problem", "India's air data is public, but hard to use")
cards = [("1", "Scattered files", "Hourly readings from 87 reference stations, spread over several sources"),
         ("2", "PDF bulletins", "Official AQI comes as a daily CPCB bulletin covering 329 cities"),
         ("3", "Gaps", "About 30% of city-days have network-wide gaps in the archive"),
         ("4", "Faulty readings", "Impossible values, stuck sensors and lone spikes must be removed")]
for i, (n, t, d) in enumerate(cards):
    x = 0.6 + i * 3.08
    box(s, x, 2.05, 2.85, 4.1, fill=CARD)
    badge(s, x + 0.3, 2.35, 0.7, n, size=20)
    text(s, x + 0.3, 3.3, 2.3, 0.5, t, size=22, bold=True)
    text(s, x + 0.3, 3.95, 2.3, 2.0, d, size=17, color=MUTED, spacing=1.1)
text(s, 0.6, 6.45, 12, 0.45, "So a simple question like “Is Delhi worse than Mumbai this month?” takes hours to answer correctly.",
     size=17, color=TEAL_DARK, bold=True)
notes(s, "The data about India's air is public, but it is not easy to use. "
         "Readings come from 87 reference stations through different sources, and the official AQI is published as daily PDF bulletins. "
         "About 30 percent of city-days have network gaps, and some sensors report impossible or stuck values. "
         "So even a simple question takes hours of cleaning before you can trust the answer.")

# ================================================================== 3. solution
s = prs.slides.add_slide(BLANK)
frame(s, 3, "The solution", "Ask in plain English, get a checked answer")
bullets(s, 0.6, 2.1, 4.7, 3.6, [
    [("Type a question", {"bold": True}), (" in everyday words", {})],
    [("Get an answer", {"bold": True}), (" with a chart and its sources", {})],
    [("Click any number", {"bold": True}), (" to see where it came from", {})],
    [("Works for 6 cities", {"bold": True}), (" in depth, official AQI for 329", {})]], size=21, gap=18)
picture(s, IMG / "home.png", 5.75, 1.85, 7.0, 4.375)
text(s, 5.75, 6.35, 7.0, 0.35, "Home page: the live map of the six cities and the Ask box", size=13, color=MUTED)
notes(s, "SkyQueryChat solves this with a chat interface. "
         "You type a question in everyday words and get an answer with a chart and its sources. "
         "Every number in the answer can be clicked to show exactly where it came from. "
         "This is the Home page, with the live map of the six cities and the Ask box.")

# ================================================================== 4. key idea
s = prs.slides.add_slide(BLANK)
frame(s, 4, "The key idea", "Each part does only what it is good at")
steps = [("AI", "AI writes the words", "Gemini understands the question and writes the sentences"),
         ("Py", "Python calculates the numbers", "Every average, trend and comparison is computed from the data"),
         ("✓", "The checker verifies every number", "Any number not found in the results is rejected")]
for i, (b, t, d) in enumerate(steps):
    x = 0.6 + i * 4.2
    box(s, x, 2.1, 3.7, 3.25, fill=TEAL_SOFT if i == 2 else CARD)
    badge(s, x + 0.3, 2.4, 0.85, b, size=20, fill=TEAL if i != 1 else INK)
    text(s, x + 0.3, 3.45, 3.1, 0.9, t, size=23, bold=True, spacing=1.0)
    text(s, x + 0.3, 4.35, 3.1, 0.95, d, size=16, color=MUTED, spacing=1.1)
    if i < 2:
        arrow(s, x + 3.75, 3.72, x + 4.15, 3.72, width=3)
box(s, 0.6, 5.75, 12.1, 0.95, fill=NAVY)
text(s, 0.95, 5.75, 11.5, 0.95, [[("Why:  ", {"bold": True, "color": TEAL}),
                                  ("the AI cannot make up a number. If it writes one that is not in the data, the answer is rejected and rewritten.", {"color": WHITE})]],
     size=19, anchor=MSO_ANCHOR.MIDDLE)
notes(s, "This is the main idea of the project. "
         "The AI only writes the words, Python calculates every number, and a checker compares the two. "
         "If the AI writes any number that is not in Python's results, the answer is rejected and the AI must fix it. "
         "This stops the most common problem with chatbots, which is making up numbers.")

# ================================================================== 5. architecture
s = prs.slides.add_slide(BLANK)
frame(s, 5, "Architecture", "How the pieces connect")
W, H = 2.9, 1.15
node(s, 0.6, 2.0, W, H, "Browser", "the visitor")
node(s, 4.4, 2.0, W, H, "Website", "Next.js on Vercel")
node(s, 7.7, 2.0, W, H, "Backend", "FastAPI on Render")
node(s, 7.7, 3.75, W, H, "AI agent", "Pydantic AI, tools, checker", fill=TEAL_SOFT, line=TEAL)
node(s, 11.1, 3.75, 1.6, H, "Gemini", "Google AI", fill=BLUE_SOFT, line=RGBColor(0x93, 0xC5, 0xFD), tsize=18, ssize=13)
node(s, 7.7, 5.5, W, H, "Analysis engine", "Python, DuckDB")
node(s, 4.4, 5.5, W, H, "Data tables", "Parquet, about 3.3 MB")
arrow(s, 0.6 + W, 2.575, 4.4, 2.575)
arrow(s, 4.4 + W, 2.575, 7.7, 2.575)
arrow(s, 7.7 + W / 2, 2.0 + H, 7.7 + W / 2, 3.75)
arrow(s, 7.7 + W, 4.325, 11.1, 4.325, both=True, color=RGBColor(0x3B, 0x82, 0xF6))
arrow(s, 7.7 + W / 2, 3.75 + H, 7.7 + W / 2, 5.5, both=True)
arrow(s, 7.7, 6.075, 4.4 + W, 6.075, both=True)
text(s, 0.6, 3.75, 3.4, 2.6, [[("The website shows pages; the backend answers questions.", {"color": MUTED})],
                              [("Data pages never call the AI, so they keep working when the AI quota runs out.", {"color": MUTED})]],
     size=16, spacing=1.1, after=10)
notes(s, "Here is how the parts connect. "
         "The website is built with Next.js on Vercel, and the backend is FastAPI on Render. "
         "When you ask a question, the AI agent talks to Gemini and calls Python tools, which read compact Parquet tables through DuckDB. "
         "The data pages never call the AI, so they keep working even when the AI quota runs out.")

# ================================================================== 6. data
s = prs.slides.add_slide(BLANK)
frame(s, 6, "Data", "Four public sources")
src = [("OpenAQ", "Hourly PM2.5 and PM10 from CPCB stations", "Measured"),
       ("CPCB bulletins", "Official daily AQI, 329 cities", "Official"),
       ("Open-Meteo", "Daily rain, wind, temperature", "Modelled"),
       ("OpenCity", "Delhi PM around Diwali 2024 and 2025", "Supporting")]
for i, (t, d, tag) in enumerate(src):
    x, y = 0.6 + (i % 2) * 3.35, 2.0 + (i // 2) * 2.2
    box(s, x, y, 3.15, 1.95, fill=CARD)
    text(s, x + 0.25, y + 0.22, 2.7, 0.45, t, size=20, bold=True)
    text(s, x + 0.25, y + 0.72, 2.7, 0.8, d, size=15, color=MUTED, spacing=1.05)
    tg = box(s, x + 0.25, y + 1.45, 1.35, 0.33, fill=TEAL_SOFT, radius=0.5)
    text(s, x + 0.25, y + 1.45, 1.35, 0.33, tag, size=12, bold=True, color=TEAL_DARK, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
cd = CategoryChartData()
cities = [("Delhi", 37), ("Mumbai", 22), ("Hyderabad", 9), ("Kolkata", 7), ("Chennai", 6), ("Bengaluru", 6)]
cd.categories = [c for c, _ in reversed(cities)]
cd.add_series("Reference stations", [n for _, n in reversed(cities)])
gf = s.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, Inches(7.65), Inches(2.25), Inches(5.1), Inches(3.6), cd)
ch = gf.chart
ch.has_legend = False
ch.has_title = False
pl = ch.plots[0]
pl.gap_width = 55
pl.has_data_labels = True
dl = pl.data_labels
dl.position = XL_LABEL_POSITION.OUTSIDE_END
dl.font.size, dl.font.name, dl.font.bold, dl.font.color.rgb = Pt(14), FONT, True, INK
ser = pl.series[0]
ser.format.fill.solid()
ser.format.fill.fore_color.rgb = TEAL
va = ch.value_axis
va.visible = False
va.has_major_gridlines = False
ca = ch.category_axis
ca.tick_labels.font.size, ca.tick_labels.font.name, ca.tick_labels.font.color.rgb = Pt(14), FONT, INK
ca.format.line.fill.background()
text(s, 7.65, 1.95, 5.1, 0.35, "Reference stations per city (87 in total)", size=15, bold=True)
text(s, 7.65, 5.95, 5.1, 0.7, "Measured data: 18 Feb 2025 to 15 Nov 2026, updated every day", size=14, color=MUTED)
notes(s, "The app uses four public sources. "
         "OpenAQ gives hourly PM2.5 and PM10 from government stations, CPCB gives the official daily AQI for 329 cities, "
         "Open-Meteo gives modelled weather, and OpenCity gives extra Delhi data around Diwali. "
         "Across the six cities there are 87 reference stations, with data from 18 February 2025 to 15 November 2026.")

# ================================================================== 7. pipeline
s = prs.slides.add_slide(BLANK)
frame(s, 7, "Data pipeline", "From raw readings to trusted tables")
node(s, 0.6, 2.15, 2.5, 1.3, "Raw data", "hourly readings and bulletins")
box(s, 3.75, 1.85, 4.9, 3.9, fill=TEAL_SOFT, line=TEAL)
text(s, 4.05, 2.05, 4.3, 0.45, "Cleaning", size=22, bold=True)
rules = ["Remove faulty readings", "A day needs 16 valid hours", "A city needs enough stations", "Gaps are never filled in"]
for i, r_ in enumerate(rules):
    y = 2.7 + i * 0.72
    badge(s, 4.05, y, 0.5, "✓", size=15)
    text(s, 4.75, y, 3.7, 0.5, r_, size=18, anchor=MSO_ANCHOR.MIDDLE)
node(s, 9.3, 2.15, 3.4, 1.3, "Clean tables", "about 3.3 MB, served by the app")
arrow(s, 3.1, 2.8, 3.75, 2.8, width=3)
arrow(s, 8.65, 2.8, 9.3, 2.8, width=3)
up = box(s, 9.3, 4.25, 3.4, 1.5, fill=NAVY)
text(s, 9.5, 4.35, 3.0, 1.3, [[("Daily automatic update", {"bold": True, "color": WHITE, "size": 18})],
                              [("GitHub Actions, 7:30 AM IST", {"color": ICE, "size": 15})]],
     align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, after=4)
arrow(s, 11.0, 4.25, 11.0, 3.45, dash=True)
text(s, 0.6, 6.2, 12, 0.5, "Each update checks that old values never change and runs the tests before saving.", size=16, color=MUTED)
notes(s, "This is the data pipeline. "
         "Raw hourly readings are cleaned: faulty values are removed, a day needs at least 16 valid hours, and a city needs enough stations. "
         "Missing data is never filled in; gaps are labelled instead. "
         "A GitHub Actions job repeats this every morning, checks that old values did not change, runs the tests and saves the new tables.")

# ================================================================== 8. agent
s = prs.slides.add_slide(BLANK)
frame(s, 8, "How the AI agent works", "Plan, calculate, write, check")
flow = [("Question", ""), ("Gemini plans", "one-line plan"), ("Calls Python tools", "named results only"),
        ("Writes the answer", "words around the numbers"), ("Checker verifies", "numbers, units, dates")]
xs = [0.6 + i * 2.5 for i in range(5)]
for i, (t, d) in enumerate(flow):
    fill, line = (TEAL_SOFT, TEAL) if i == 4 else (CARD, LINE)
    node(s, xs[i], 2.0, 2.15, 1.3, t, d, fill=fill, line=line, tsize=17, ssize=13)
    if i < 4:
        arrow(s, xs[i] + 2.15, 2.65, xs[i + 1], 2.65)
# rewrite loop: checker back to "writes the answer"
arrow(s, xs[4] + 1.075, 3.3, xs[4] + 1.075, 3.75, color=AMBER, width=2, head=False)
arrow(s, xs[4] + 1.075, 3.75, xs[3] + 1.075, 3.75, color=AMBER, width=2, head=False)
arrow(s, xs[3] + 1.075, 3.75, xs[3] + 1.075, 3.3, color=AMBER, width=2)
text(s, xs[3] + 1.2, 3.82, 2.6, 0.4, "wrong? rewrite (up to 3 tries)", size=13, bold=True, color=AMBER)
box(s, 0.6, 4.55, 5.9, 2.15, fill=CARD)
text(s, 0.9, 4.72, 5.4, 0.4, "Three kinds of reply", size=18, bold=True)
bullets(s, 0.9, 5.2, 5.4, 1.5, [[("Greeting or facts: ", {"bold": True}), ("answered without tools", {})],
                                [("Data question: ", {"bold": True}), ("tools, then the checker", {})],
                                [("Off-topic: ", {"bold": True}), ("a polite fixed refusal", {})]], size=15, gap=4)
box(s, 6.8, 4.55, 5.9, 2.15, fill=NAVY)
text(s, 7.1, 4.72, 5.4, 0.4, "Model fallback chain", size=18, bold=True, color=WHITE)
text(s, 7.1, 5.2, 5.4, 1.4, [[("Gemini 3.5 Flash-Lite → 3.1 Flash-Lite → four smaller backups", {"color": ICE})],
                             [("If one model is busy or out of quota, the next one answers. Extra API keys add more quota.", {"color": FAINT})]],
     size=15, spacing=1.1, after=6)
notes(s, "Here is what happens when you ask a data question. "
         "Gemini writes a short plan, calls Python tools, and writes the answer around the numbers the tools return. "
         "The checker then verifies every number, unit and date; if anything is wrong, the AI rewrites it, up to three times. "
         "Greetings and off-topic messages need no tools, and if one Gemini model runs out of quota the next one in the chain takes over.")

# ================================================================== 9. example
s = prs.slides.add_slide(BLANK)
frame(s, 9, "Example", "One question, start to finish")
q = box(s, 0.6, 1.95, 5.5, 0.75, fill=TEAL_SOFT, radius=0.4)
text(s, 0.85, 1.95, 5.1, 0.75, "“Compare Delhi and Mumbai over the last 30 days”", size=17, bold=True, anchor=MSO_ANCHOR.MIDDLE)
steps9 = [("1", "Plan: compare PM2.5 in both cities"), ("2", "Tool: compare_cities (Python)"), ("3", "Checker: 9 numbers checked")]
for i, (n, t) in enumerate(steps9):
    y = 2.95 + i * 0.6
    badge(s, 0.6, y, 0.45, n, size=14)
    text(s, 1.25, y, 4.8, 0.45, t, size=16, anchor=MSO_ANCHOR.MIDDLE)
box(s, 0.6, 4.9, 5.5, 1.85, fill=CARD)
text(s, 0.85, 5.02, 5.0, 1.65, "“Delhi's air was significantly more polluted than Mumbai's, with its PM2.5 averaging 155 µg/m³, "
                               "which is 3.1 times Mumbai's 50 µg/m³ over the last 30 days (17 Oct – 15 Nov 2026).”",
     size=15, color=INK, spacing=1.08)
picture(s, IMG / "ask.png", 6.45, 1.95, 6.3, 3.94)
text(s, 6.45, 6.0, 6.3, 0.7, "Ask page: the answer, key numbers and the chart. Each underlined number opens its proof.",
     size=13, color=MUTED)
notes(s, "Here is a real example from the live site. "
         "I asked it to compare Delhi and Mumbai over the last 30 days. "
         "It made a plan, called the compare tool in Python, and the checker verified 9 numbers before showing the answer. "
         "Delhi's PM2.5 averaged 155 against Mumbai's 50 micrograms per cubic metre, 3.1 times higher.")

# ================================================================== 10. website
s = prs.slides.add_slide(BLANK)
frame(s, 10, "The website", "Five views of the same checked data")
grid = [("home", "Home", "Live map and city ranking"), ("explore", "Explore", "Every station, day by day"),
        ("ask", "Ask", "Chat with checked answers"), ("city", "City page", "One city in depth"),
        ("compare", "Compare", "Cities side by side")]
pw, ph = 3.85, 2.08
for i, (f, t, d) in enumerate(grid):
    if i < 3:
        x, y = 0.6 + i * 4.125, 1.75
    else:
        x, y = 0.6 + 2.06 + (i - 3) * 4.125, 4.55
    picture(s, IMG / f"{f}.png", x, y, pw, ph)
    text(s, x, y + ph + 0.08, pw, 0.5, [[(t + "  ", {"bold": True, "size": 15}), (d, {"size": 14, "color": MUTED})]])
notes(s, "The website has five main views. "
         "Home shows the live map and city ranking, and Explore shows every monitoring station day by day. "
         "Ask is the chat, each city has its own page, and Compare puts cities side by side. "
         "All of them read the same cleaned tables, so the numbers agree everywhere.")

# ================================================================== 11. accuracy
s = prs.slides.add_slide(BLANK)
frame(s, 11, "Accuracy and testing", "Measured on questions with known answers")
rows = scores()
tbl = s.shapes.add_table(len(rows) + 1, 3, Inches(0.6), Inches(1.9), Inches(6.9), Inches(0.42 * (len(rows) + 1))).table
tbl.columns[0].width, tbl.columns[1].width, tbl.columns[2].width = Inches(3.7), Inches(1.6), Inches(1.6)
hdr = ["Question set (first pass)", "Passed", "Score"]
for c, h in enumerate(hdr):
    cell = tbl.cell(0, c)
    cell.fill.solid()
    cell.fill.fore_color.rgb = NAVY
    cell.text_frame.paragraphs[0].text = ""
    r = cell.text_frame.paragraphs[0].add_run()
    r.text = h
    r.font.name, r.font.size, r.font.bold, r.font.color.rgb = FONT, Pt(14), True, WHITE
    cell.text_frame.paragraphs[0].alignment = PP_ALIGN.LEFT if c == 0 else PP_ALIGN.RIGHT
for i, (label, p_, n_, pct, _) in enumerate(rows, 1):
    for c, v in enumerate([label, f"{p_} / {n_}", f"{pct:.1f}%"]):
        cell = tbl.cell(i, c)
        cell.fill.solid()
        cell.fill.fore_color.rgb = CARD if i % 2 else WHITE
        para = cell.text_frame.paragraphs[0]
        para.alignment = PP_ALIGN.LEFT if c == 0 else PP_ALIGN.RIGHT
        r = para.add_run()
        r.text = v
        r.font.name, r.font.size, r.font.color.rgb = FONT, Pt(14), INK
        r.font.bold = c == 2
for row in tbl.rows:
    row.height = Inches(0.42)
for r_ in range(len(rows) + 1):
    for c in range(3):
        cl = tbl.cell(r_, c)
        cl.margin_left = cl.margin_right = Inches(0.12)
        cl.vertical_anchor = MSO_ANCHOR.MIDDLE
traced = all(t == 100.0 for *_, t in rows)
stats = [("100%", "of numbers in answers traced to the data" if traced else "numbers traced"),
         ("348 · 84 · 104", "backend, frontend and browser tests passing"),
         ("99 · 100 · 100 · 100", "Lighthouse: speed, accessibility, practices, SEO")]
for i, (big, small) in enumerate(stats):
    y = 1.9 + i * 1.55
    box(s, 7.9, y, 4.8, 1.35, fill=TEAL_SOFT if i == 0 else CARD)
    text(s, 8.15, y + 0.13, 4.4, 0.65, big, size=30, bold=True, color=TEAL_DARK if i == 0 else INK)
    text(s, 8.15, y + 0.8, 4.4, 0.45, small, size=14, color=MUTED)
text(s, 0.6, 6.55, 7.0, 0.4, "First-pass runs only (no retries), scored against values computed separately.", size=12, color=MUTED)
notes(s, "To measure accuracy, I wrote sets of questions whose answers I computed separately in plain pandas. "
         "These are first-pass scores, with no reruns, from 91.7 to 100 percent across the sets. "
         "In every set, 100 percent of the numbers in the answers were traced back to the data. "
         "The project also has 348 backend tests, 84 frontend unit tests and 104 passing browser tests, and scores 99 or 100 on Lighthouse.")

# ================================================================== 12. tech stack
s = prs.slides.add_slide(BLANK)
frame(s, 12, "Tech stack", "Free and open tools throughout")
stack = [("Frontend", "Next.js 16, React 19, TypeScript, Tailwind CSS 4, ECharts, MapLibre, Framer Motion"),
         ("Backend", "Python 3.13, FastAPI, pandas, DuckDB, Parquet"),
         ("AI", "Pydantic AI agent with Google Gemini (free tier), typed tools and a number checker"),
         ("Data", "OpenAQ, CPCB bulletins, Open-Meteo, OpenCity; daily refresh with GitHub Actions"),
         ("Hosting", "Vercel (website), Render (backend), GitHub (code and data)")]
for i, (k, v) in enumerate(stack):
    y = 1.95 + i * 0.95
    box(s, 0.6, y, 12.1, 0.8, fill=CARD if i % 2 == 0 else WHITE, line=None if i % 2 == 0 else LINE)
    badge(s, 0.8, y + 0.14, 0.52, k[0], size=16)
    text(s, 1.55, y, 2.2, 0.8, k, size=19, bold=True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 3.75, y, 8.75, 0.8, v, size=17, color=MUTED, anchor=MSO_ANCHOR.MIDDLE)
notes(s, "Here is the technology used. "
         "The frontend is Next.js with React and TypeScript, and the backend is Python with FastAPI, pandas and DuckDB. "
         "The agent is built with Pydantic AI on Google Gemini's free tier. "
         "Everything is hosted on free plans: Vercel for the website, Render for the backend, and GitHub Actions for the daily data update.")

# ================================================================== 13. future work
s = prs.slides.add_slide(BLANK)
frame(s, 13, "Future work", "What comes next")
fut = [("Built", "Official AQI for all CPCB cities", "Done during the project: 329 cities, any festival or date", True),
       ("Planned", "Forecasting", "Predict the next few days of air quality from past data and weather", False),
       ("Planned", "More cities in depth", "Station-level PM2.5 and PM10 analysis beyond the six metros", False)]
for i, (tag, t, d, done) in enumerate(fut):
    x = 0.6 + i * 4.15
    box(s, x, 2.05, 3.85, 2.9, fill=TEAL_SOFT if done else CARD, line=TEAL if done else None)
    tg = box(s, x + 0.3, 2.35, 1.3, 0.4, fill=TEAL if done else AMBER_SOFT, radius=0.5)
    text(s, x + 0.3, 2.35, 1.3, 0.4, tag.upper(), size=12, bold=True, color=WHITE if done else AMBER,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    text(s, x + 0.3, 3.05, 3.25, 0.95, t, size=23, bold=True, spacing=1.0)
    text(s, x + 0.3, 4.05, 3.25, 1.5, d, size=16, color=MUTED, spacing=1.1)
notes(s, "Finally, future work. "
         "The first item on my plan, official AQI for every CPCB city, is already built: the app covers 329 cities and any festival or date. "
         "Next I plan to add forecasting of the next few days, and station-level analysis for more cities beyond the six metros. "
         "These two are planned, not built yet.")

# ================================================================== 14. thank you
s = prs.slides.add_slide(BLANK)
bg(s, NAVY)
for d, a in [(6.2, 90), (4.6, 84), (3.0, 76)]:
    box(s, SW / 2 - d / 2, 3.2 - d / 2, d, d, fill=TEAL, shape=MSO_SHAPE.OVAL, alpha=a)
text(s, 0.8, 2.1, SW - 1.6, 1.1, "Thank you", size=60, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
text(s, 0.8, 3.25, SW - 1.6, 0.6, "Questions?", size=30, color=ICE, align=PP_ALIGN.CENTER)
box(s, SW / 2 - 2.3, 4.9, 4.6, 0.6, fill=NAVY_2, line=TEAL, radius=0.5)
text(s, SW / 2 - 2.3, 4.9, 4.6, 0.6, f"Try it:  {LIVE}", size=17, bold=True, color=TEAL, align=PP_ALIGN.CENTER,
     anchor=MSO_ANCHOR.MIDDLE)
text(s, 0.8, 5.85, SW - 1.6, 0.4, NAME, size=16, color=FAINT, align=PP_ALIGN.CENTER)
notes(s, "Thank you for listening. "
         "The site is live, so you can try any question yourself at sky-query-chat.vercel.app. "
         "I am happy to take your questions now.")

prs.save(OUT)
print("saved", OUT.relative_to(ROOT), len(prs.slides._sldIdLst), "slides")
