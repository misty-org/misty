from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1] / "demo" / "product-research-hub"
PAGE = landscape(letter)
INK = HexColor("#17212B")
MUTED = HexColor("#5B6875")
TEAL = HexColor("#178B86")
MINT = HexColor("#DDF4EF")
PAPER = HexColor("#F5F4EF")
WHITE = HexColor("#FFFFFF")


def styles():
    return {
        "eyebrow": ParagraphStyle("eyebrow", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=TEAL, spaceAfter=7),
        "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=25, leading=29, textColor=INK, spaceAfter=10),
        "subtitle": ParagraphStyle("subtitle", fontName="Helvetica", fontSize=11, leading=16, textColor=MUTED, spaceAfter=15),
        "heading": ParagraphStyle("heading", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=INK, spaceAfter=7),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=15, textColor=INK, spaceAfter=7, alignment=TA_LEFT),
        "quote": ParagraphStyle("quote", fontName="Helvetica-Oblique", fontSize=13, leading=19, textColor=INK, spaceAfter=8),
        "meta": ParagraphStyle("meta", fontName="Helvetica", fontSize=8, leading=10, textColor=MUTED),
    }


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, PAGE[0], PAGE[1], fill=1, stroke=0)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(0.55 * inch, 0.28 * inch, "MISTY / PRODUCT RESEARCH HUB")
    canvas.drawRightString(PAGE[0] - 0.55 * inch, 0.28 * inch, f"{doc.page}")
    canvas.restoreState()


def card(content, width, background=WHITE, padding=14):
    table = Table([[content]], colWidths=[width])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("BOX", (0, 0), (-1, -1), 0.6, HexColor("#DDE1DD")),
        ("LEFTPADDING", (0, 0), (-1, -1), padding),
        ("RIGHTPADDING", (0, 0), (-1, -1), padding),
        ("TOPPADDING", (0, 0), (-1, -1), padding),
        ("BOTTOMPADDING", (0, 0), (-1, -1), padding),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return table


def build(filename, title, subtitle, story):
    doc = SimpleDocTemplate(
        str(ROOT / filename), pagesize=PAGE, rightMargin=0.58 * inch, leftMargin=0.58 * inch,
        topMargin=0.5 * inch, bottomMargin=0.48 * inch, title=title, author="Misty Demo Research Team",
    )
    s = styles()
    flow = [Paragraph("PRODUCT RESEARCH / CORE EVIDENCE", s["eyebrow"]), Paragraph(title, s["title"]), Paragraph(subtitle, s["subtitle"])]
    flow.extend(story(s))
    doc.build(flow, onFirstPage=footer, onLaterPages=footer)


def brief_story(s):
    question = [Paragraph("Research question", s["heading"]), Paragraph("Why do capable teams lose momentum even when they already have cloud storage, collaboration tools, and powerful AI models?", s["quote"])]
    checks = [Paragraph("What we are testing", s["heading"])]
    for number, text in enumerate([
        "People can find the latest evidence without asking a teammate.",
        "Shared discussion stays connected to the files that informed it.",
        "An Agent can act with the same working context as the team.",
        "A repeatable workflow moves research forward without handoffs.",
    ], 1):
        checks.append(Paragraph(f"<b>{number:02}</b> &nbsp; {text}", s["body"]))
    columns = Table([[card(question, 3.45 * inch, MINT), card(checks, 5.8 * inch)]], colWidths=[3.65 * inch, 6 * inch])
    columns.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 10)]))
    success = [Paragraph("Success signal", s["heading"]), Paragraph("A teammate can enter one Space, understand what changed, inspect the source material, and continue the work without requesting another upload or recap.", s["body"])]
    return [columns, Spacer(1, 13), card(success, 9.65 * inch, HexColor("#E9EFEF"))]


def synthesis_story(s):
    signals = []
    for title, text in [
        ("01 / Split record", "Files live in cloud drives, while decisions live in chat."),
        ("02 / Duplicate handoffs", "Teammates download, rename, and re-upload the same material."),
        ("03 / Isolated intelligence", "AI answers are useful, but each model begins without the team's history."),
        ("04 / Repeated reconstruction", "People pause the work to explain what changed and which version matters."),
    ]:
        signals.append([Paragraph(title, s["heading"]), Paragraph(text, s["body"])])
    grid = Table([[signals[0], signals[1]], [signals[2], signals[3]]], colWidths=[4.8 * inch, 4.8 * inch])
    grid.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.6, HexColor("#DDE1DD")),
        ("LEFTPADDING", (0, 0), (-1, -1), 14), ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    opportunity = [Paragraph("Strongest opportunity", s["heading"]), Paragraph("A shared work environment where data, people, Agents, and workflows continue from the same thread.", s["quote"])]
    return [grid, Spacer(1, 4), card(opportunity, 9.65 * inch, MINT)]


def transcript_story(s):
    exchanges = [
        ("What usually breaks your momentum?", "It is rarely the creative task. I stop because the file is in Drive, the feedback is in Slack, and the AI draft is in another tab. Before I continue, I have to rebuild the story of what happened."),
        ("What does your team do next?", "Someone asks for the newest export. We send it again, then explain which comments still apply. The tools are powerful, but none of them share the same memory of the work."),
        ("What would feel meaningfully different?", "Open the project and keep moving. The team and the AI should already understand the files, decisions, and next step."),
    ]
    rows = []
    for question, answer in exchanges:
        rows.append([Paragraph(f"<b>INTERVIEWER</b><br/>{question}", s["body"]), Paragraph(f"<b>PARTICIPANT</b><br/><i>{answer}</i>", s["body"])])
    table = Table(rows, colWidths=[2.55 * inch, 7.1 * inch])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), HexColor("#E9EFEF")), ("BACKGROUND", (1, 0), (1, -1), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.6, HexColor("#DDE1DD")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 13), ("RIGHTPADDING", (0, 0), (-1, -1), 13),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return [KeepTogether([Paragraph("SESSION 04 / DISTRIBUTED MEDIA TEAM / PRODUCT DESIGNER", s["meta"]), Spacer(1, 8), table])]


if __name__ == "__main__":
    build("research-brief.pdf", "Product Research Brief", "Testing whether a shared working context can protect team momentum.", brief_story)
    build("interview-synthesis.pdf", "Interview Synthesis", "Across six product and creative teams, the recurring complaint was reconstruction - not a lack of tools.", synthesis_story)
    build("customer-transcript.pdf", "Customer Transcript 04", "A product designer describes the hidden cost of rebuilding context between every tool.", transcript_story)
