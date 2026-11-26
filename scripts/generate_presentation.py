"""Generate the Arknights: Endfield-styled AIC-GATE project presentation (.pptx)."""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

ROOT_DIR = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT_DIR / "docs" / "AIC-GATE_Presentation.pptx"

# Endfield Tactical Dark Palette
BG_OBSIDIAN = RGBColor(0x09, 0x0C, 0x11)
BG_PANEL = RGBColor(0x11, 0x16, 0x1E)
BG_ELEVATED = RGBColor(0x16, 0x1C, 0x26)
BORDER_SUBTLE = RGBColor(0x28, 0x33, 0x45)
TEXT_MAIN = RGBColor(0xED, 0xF2, 0xF7)
TEXT_MUTED = RGBColor(0x8B, 0x98, 0xAA)
ACCENT_VOLT = RGBColor(0xE5, 0xFF, 0x00)
ACCENT_CYAN = RGBColor(0x00, 0xD4, 0xFF)
ACCENT_GREEN = RGBColor(0x2B, 0xD5, 0x8A)
ACCENT_AMBER = RGBColor(0xF5, 0xB7, 0x00)
ACCENT_RED = RGBColor(0xFF, 0x4D, 0x63)

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)


def _apply_canvas(slide, tag: str, title: str, slide_num: int) -> None:
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = BG_OBSIDIAN

    # Top accent bar
    top_bar = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), SLIDE_W, Inches(0.08)
    )
    top_bar.fill.solid()
    top_bar.fill.fore_color.rgb = ACCENT_VOLT
    top_bar.line.fill.background()

    # Eyebrow tag
    eyebrow_box = slide.shapes.add_textbox(
        Inches(0.7), Inches(0.32), Inches(9.0), Inches(0.3)
    )
    tf = eyebrow_box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = tag.upper()
    r.font.name = "Consolas"
    r.font.size = Pt(11)
    r.font.bold = True
    r.font.color.rgb = ACCENT_CYAN

    # Slide title
    title_box = slide.shapes.add_textbox(
        Inches(0.7), Inches(0.6), Inches(11.5), Inches(0.65)
    )
    ttf = title_box.text_frame
    ttf.word_wrap = True
    tp = ttf.paragraphs[0]
    tr = tp.add_run()
    tr.text = title
    tr.font.name = "Segoe UI"
    tr.font.size = Pt(28)
    tr.font.bold = True
    tr.font.color.rgb = TEXT_MAIN

    # Divider line
    line = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(0.7), Inches(1.28), Inches(11.93), Inches(0.02)
    )
    line.fill.solid()
    line.fill.fore_color.rgb = BORDER_SUBTLE
    line.line.fill.background()

    # Footer
    footer_left = slide.shapes.add_textbox(
        Inches(0.7), Inches(7.05), Inches(7.0), Inches(0.3)
    )
    fl = footer_left.text_frame.paragraphs[0].add_run()
    fl.text = "AIC-GATE // ZERO STANDING PRIVILEGES CLOUD ACCESS GATEWAY"
    fl.font.name = "Consolas"
    fl.font.size = Pt(9.5)
    fl.font.color.rgb = TEXT_MUTED

    footer_right = slide.shapes.add_textbox(
        Inches(11.2), Inches(7.05), Inches(1.43), Inches(0.3)
    )
    frp = footer_right.text_frame.paragraphs[0]
    frp.alignment = PP_ALIGN.RIGHT
    fr = frp.add_run()
    fr.text = f"0{slide_num} / 09"
    fr.font.name = "Consolas"
    fr.font.size = Pt(10)
    fr.font.bold = True
    fr.font.color.rgb = ACCENT_VOLT


def _add_card(
    slide,
    left: float,
    top: float,
    width: float,
    height: float,
    header: str,
    bullets: list[str],
    accent: RGBColor = ACCENT_CYAN,
) -> None:
    card = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height)
    )
    card.fill.solid()
    card.fill.fore_color.rgb = BG_PANEL
    card.line.color.rgb = BORDER_SUBTLE
    card.line.width = Pt(1)

    stripe = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(0.06)
    )
    stripe.fill.solid()
    stripe.fill.fore_color.rgb = accent
    stripe.line.fill.background()

    tb = slide.shapes.add_textbox(
        Inches(left + 0.22),
        Inches(top + 0.18),
        Inches(width - 0.44),
        Inches(height - 0.3),
    )
    tf = tb.text_frame
    tf.word_wrap = True

    hp = tf.paragraphs[0]
    hp.space_after = Pt(8)
    hr = hp.add_run()
    hr.text = header
    hr.font.name = "Segoe UI"
    hr.font.size = Pt(15)
    hr.font.bold = True
    hr.font.color.rgb = TEXT_MAIN

    for item in bullets:
        bp = tf.add_paragraph()
        bp.space_after = Pt(6)
        br = bp.add_run()
        br.text = f"▸  {item}"
        br.font.name = "Segoe UI"
        br.font.size = Pt(12)
        br.font.color.rgb = TEXT_MUTED


def build_deck() -> Path:
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    blank = prs.slide_layouts[6]

    # ------------------------------------------------------------------
    # Slide 1: Title Slide
    # ------------------------------------------------------------------
    s1 = prs.slides.add_slide(blank)
    s1.background.fill.solid()
    s1.background.fill.fore_color.rgb = BG_OBSIDIAN

    top_accent = s1.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), SLIDE_W, Inches(0.12)
    )
    top_accent.fill.solid()
    top_accent.fill.fore_color.rgb = ACCENT_VOLT
    top_accent.line.fill.background()

    # Hero Emblem Badge on right
    hex_shape = s1.shapes.add_shape(
        MSO_SHAPE.HEXAGON, Inches(9.35), Inches(1.85), Inches(2.9), Inches(2.9)
    )
    hex_shape.fill.solid()
    hex_shape.fill.fore_color.rgb = BG_PANEL
    hex_shape.line.color.rgb = TEXT_MAIN
    hex_shape.line.width = Pt(6)

    volt_sq = s1.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(9.95), Inches(3.85), Inches(0.45), Inches(0.45)
    )
    volt_sq.fill.solid()
    volt_sq.fill.fore_color.rgb = ACCENT_VOLT
    volt_sq.line.fill.background()
    volt_sq.rotation = 28

    a_tb = s1.shapes.add_textbox(
        Inches(9.65), Inches(2.45), Inches(2.3), Inches(1.6)
    )
    ap = a_tb.text_frame.paragraphs[0]
    ap.alignment = PP_ALIGN.CENTER
    ar = ap.add_run()
    ar.text = "A"
    ar.font.name = "Segoe UI"
    ar.font.size = Pt(92)
    ar.font.bold = True
    ar.font.color.rgb = TEXT_MAIN

    # Title Text
    badge = s1.shapes.add_textbox(Inches(0.85), Inches(1.55), Inches(7.5), Inches(0.4))
    bp = badge.text_frame.paragraphs[0].add_run()
    bp.text = "ZERO STANDING PRIVILEGES // CLOUD PAM ARCHITECTURE"
    bp.font.name = "Consolas"
    bp.font.size = Pt(12)
    bp.font.bold = True
    bp.font.color.rgb = ACCENT_CYAN

    hero = s1.shapes.add_textbox(Inches(0.85), Inches(2.05), Inches(8.1), Inches(2.1))
    htf = hero.text_frame
    htf.word_wrap = True
    hp1 = htf.paragraphs[0]
    hr1 = hp1.add_run()
    hr1.text = "AIC-GATE"
    hr1.font.name = "Segoe UI"
    hr1.font.size = Pt(58)
    hr1.font.bold = True
    hr1.font.color.rgb = TEXT_MAIN

    hp2 = htf.add_paragraph()
    hr2 = hp2.add_run()
    hr2.text = "Automated Identity Controller & Just-in-Time Gateway"
    hr2.font.name = "Segoe UI"
    hr2.font.size = Pt(22)
    hr2.font.bold = True
    hr2.font.color.rgb = ACCENT_VOLT

    sub = s1.shapes.add_textbox(Inches(0.85), Inches(4.25), Inches(8.0), Inches(1.1))
    stf = sub.text_frame
    stf.word_wrap = True
    sp = stf.paragraphs[0].add_run()
    sp.text = (
        "Multi-tenant cloud access governance brokering short-lived AWS STS "
        "credentials across S3, DynamoDB, CloudWatch Logs, and SSM with "
        "optional TOTP MFA, custom RBAC roles, and real-time entitlement graphs."
    )
    sp.font.name = "Segoe UI"
    sp.font.size = Pt(14)
    sp.font.color.rgb = TEXT_MUTED

    stack = s1.shapes.add_textbox(Inches(0.85), Inches(6.25), Inches(11.6), Inches(0.5))
    stk = stack.text_frame.paragraphs[0].add_run()
    stk.text = "FASTAPI · REACT 19 + TYPESCRIPT · AWS STS / IAM / DYNAMODB · GCP CLOUD RUN · RFC 6238 TOTP"
    stk.font.name = "Consolas"
    stk.font.size = Pt(11)
    stk.font.bold = True
    stk.font.color.rgb = ACCENT_CYAN

    # ------------------------------------------------------------------
    # Slide 2: Problem Statement
    # ------------------------------------------------------------------
    s2 = prs.slides.add_slide(blank)
    _apply_canvas(s2, "01 // PROBLEM STATEMENT", "Why Standing Cloud Privileges Fail", 2)
    _add_card(
        s2, 0.7, 1.65, 5.8, 2.45,
        "Static Keys & Permanent Roles",
        [
            "Long-lived IAM access keys leaked in code, laptops, or CI logs stay valid indefinitely.",
            "Developers accumulate broad roles across sprints without automatic revocation.",
        ],
        ACCENT_RED,
    )
    _add_card(
        s2, 6.8, 1.65, 5.8, 2.45,
        "Lateral Movement & Reconnaissance",
        [
            "Over-scoped console policies expose internal bucket names, ARNs, and production tables.",
            "Single compromised developer identity threatens unrelated services and tenants.",
        ],
        ACCENT_AMBER,
    )
    _add_card(
        s2, 0.7, 4.35, 5.8, 2.45,
        "Admin Bottlenecks vs. Privilege Creep",
        [
            "Single-admin setups fail if that admin loses MFA or goes offline.",
            "Cloning full admin rights to backup staff risks org hijacking and policy tampering.",
        ],
        ACCENT_CYAN,
    )
    _add_card(
        s2, 6.8, 4.35, 5.8, 2.45,
        "Audit & Compliance Gaps",
        [
            "Raw cloud logs rarely capture business justification ('why') or approval context.",
            "Teams lack live visual topology showing who currently holds active access to what.",
        ],
        ACCENT_VOLT,
    )

    # ------------------------------------------------------------------
    # Slide 3: Architecture & STS Policy Intersection
    # ------------------------------------------------------------------
    s3 = prs.slides.add_slide(blank)
    _apply_canvas(s3, "02 // CORE ARCHITECTURE", "Just-in-Time AWS STS Broker & Policy Intersection", 3)

    steps = [
        ("1. CATALOG REQUEST", "Operator selects approved service without seeing raw ARNs (15–60 min TTL).", ACCENT_CYAN),
        ("2. ADMIN TRIAGE", "Org Admin sees risk score & inspects compiled IAM JSON before approving.", ACCENT_AMBER),
        ("3. ATOMIC STS MINT", "DynamoDB claim lock prevents duplicates; STS AssumeRole applies inline policy.", ACCENT_VOLT),
        ("4. INTERSECTION LOCK", "Effective Access = AICGateJITRole ∩ Inline Session Policy. Auto-expires at TTL.", ACCENT_GREEN),
    ]
    x = 0.7
    for header, body, col in steps:
        _add_card(s3, x, 1.7, 2.85, 2.6, header, [body], col)
        x += 3.03

    _add_card(
        s3, 0.7, 4.55, 11.93, 2.25,
        "Three-Table Persistence + Honest Security Semantics",
        [
            "AICGateSession (session_id) tracks live TTL countdowns and application-level REVOKED / EXPIRED state.",
            "AICGateAccessRequest (request_id) enforces atomic CREATING_SESSION locking with automatic rollback on STS failure.",
            "AICGateIdentity (pk) stores multi-tenant Orgs, Users, Custom Roles, Retired Invite Ledger, Alerts, and Master Tickets.",
            "Honest Boundary: App revocation immediately halts new key minting & proxied reads while noting existing STS TTL.",
        ],
        ACCENT_CYAN,
    )

    # ------------------------------------------------------------------
    # Slide 4: Multi-Service Resource Catalog
    # ------------------------------------------------------------------
    s4 = prs.slides.add_slide(blank)
    _apply_canvas(s4, "03 // MULTI-SERVICE CATALOG", "4 Integrated AWS Services + Zero ARN Exposure", 4)
    _add_card(
        s4, 0.7, 1.65, 5.8, 2.45,
        "Amazon S3 (Live + Sandbox Tester)",
        [
            "Actions: s3:GetObject, s3:ListBucket constrained to logs/* via StringLike prefix condition.",
            "Live proof verified against cloudsec.proj.aicgate (logs/sample.log ALLOW vs restricted/secret.txt DENY).",
        ],
        ACCENT_CYAN,
    )
    _add_card(
        s4, 6.8, 1.65, 5.8, 2.45,
        "Amazon DynamoDB Telemetry",
        [
            "Actions: GetItem, Query, Scan, DescribeTable scoped to AICGateSession.",
            "Automated risk engine flags dynamodb:Scan + >=45m duration as HIGH risk for admin review.",
        ],
        ACCENT_AMBER,
    )
    _add_card(
        s4, 0.7, 4.35, 5.8, 2.45,
        "Amazon CloudWatch Logs",
        [
            "Actions: DescribeLogStreams, GetLogEvents, FilterLogEvents strictly under /aic-gate/*.",
            "Interconnected catalog links S3 error logs directly to runtime CloudWatch streams.",
        ],
        ACCENT_GREEN,
    )
    _add_card(
        s4, 6.8, 4.35, 5.8, 2.45,
        "AWS Systems Manager (SSM Parameter Store)",
        [
            "Actions: GetParameter, GetParametersByPath, DescribeParameters under /aic-gate/config*.",
            "Client Multi-Service Scope Lab enforces real backend session boundaries across all 4 services.",
        ],
        ACCENT_VOLT,
    )

    # ------------------------------------------------------------------
    # Slide 5: Multi-Tenant Governance & 3-Tier Admin Split
    # ------------------------------------------------------------------
    s5 = prs.slides.add_slide(blank)
    _apply_canvas(s5, "04 // MULTI-TENANT GOVERNANCE", "3-Tier Admin Separation of Duties & Zero-Trust Boundary", 5)
    _add_card(
        s5, 0.7, 1.65, 3.8, 5.1,
        "Platform Master (AIC-GATE)",
        [
            "Non-organizational SaaS control plane (/master).",
            "Resolves Org Admin tickets (org renames, break-glass MFA reset, owner recovery).",
            "Can suspend/reactivate compromised orgs.",
            "ZERO-TRUST BOUNDARY: Blocked (403) from tenant requests & STS key minting.",
        ],
        ACCENT_VOLT,
    )
    _add_card(
        s5, 4.76, 1.65, 3.8, 5.1,
        "Org Owner (Primary Admin)",
        [
            "Created when registering a new organization.",
            "Owns tenant governance: rename org, rotate non-reusable invite codes.",
            "Promotes or demotes Delegated Admins without single-point-of-failure risk.",
            "Approves access requests and provisions STS keys.",
        ],
        ACCENT_AMBER,
    )
    _add_card(
        s5, 8.83, 1.65, 3.8, 5.1,
        "Delegated Admin & Custom Roles",
        [
            "Operational approvers scale triage without exposing org-takeover risk.",
            "Blocked (403) from renaming org, rotating invites, or modifying the Org Owner.",
            "Dedicated /admin/roles console creates colored role badges & bulk-assigns members.",
            "Invite code Join Org flow autocompletes verified corporate email domains.",
        ],
        ACCENT_CYAN,
    )

    # ------------------------------------------------------------------
    # Slide 6: Security Hardening & OWASP Controls
    # ------------------------------------------------------------------
    s6 = prs.slides.add_slide(blank)
    _apply_canvas(s6, "05 // CYBERSECURITY CONTROLS", "OWASP ASVS & Cloud Hardening Built-In", 6)
    _add_card(
        s6, 0.7, 1.65, 5.8, 2.45,
        "AuthN, Optional TOTP MFA & Session Safety",
        [
            "bcrypt password hashing + signed HS256 JWTs + strict server-side FastAPI RBAC.",
            "Optional RFC 6238 TOTP 2FA uses an isolated mfa_challenge JWT (cannot call APIs).",
        ],
        ACCENT_GREEN,
    )
    _add_card(
        s6, 6.8, 1.65, 5.8, 2.45,
        "Injection, Traversal & IDOR Prevention",
        [
            "Rejects '..' traversals, '*'/'?' wildcards, '//' double slashes, and control chars.",
            "Cross-tenant & cross-user IDOR prevented on all /requests and /sessions endpoints.",
        ],
        ACCENT_RED,
    )
    _add_card(
        s6, 0.7, 4.35, 5.8, 2.45,
        "Secret-Safe Audit & Compliance Export",
        [
            "Structured JSON audit logs automatically redact secrets, tokens, and passwords.",
            "One-click CSV and JSON audit exports for compliance reviews.",
        ],
        ACCENT_CYAN,
    )
    _add_card(
        s6, 6.8, 4.35, 5.8, 2.45,
        "Live 5-Check Security Boundary Proof",
        [
            "Built-in POST /admin/security-proof verifies policy compiler, traversal/wildcard blocks,",
            "non-admin RBAC 403 enforcement, and expired session auto-termination live on stage.",
        ],
        ACCENT_VOLT,
    )

    # ------------------------------------------------------------------
    # Slide 7: Endfield UI & Interactive Telemetry
    # ------------------------------------------------------------------
    s7 = prs.slides.add_slide(blank)
    _apply_canvas(s7, "06 // PRODUCT UX & TELEMETRY", "Arknights: Endfield Tactical Interface & Live Sync", 7)
    _add_card(
        s7, 0.7, 1.65, 5.8, 2.45,
        "Interactive Pan/Zoom Entitlement Graph",
        [
            "GPS-style drag-to-pan, scroll-to-zoom canvas with Fullscreen Maximize mode.",
            "User hover popover, downstream-only Session -> Resource glow, red X on expired edges.",
        ],
        ACCENT_CYAN,
    )
    _add_card(
        s7, 6.8, 1.65, 5.8, 2.45,
        "Endfield Access Key Card Profile",
        [
            "Dedicated profile page with 3D cursor-parallax access card & Big-Screen Showcase.",
            "Interactive 1:1 square avatar cropper (PNG/JPEG/WEBP) with strict backend validation.",
        ],
        ACCENT_VOLT,
    )
    _add_card(
        s7, 0.7, 4.35, 5.8, 2.45,
        "Native Top-Layer Alerts & Smart Sync",
        [
            "Browser Top-Layer <dialog> Alert Drawer prevents clipping behind any layout card.",
            "Smart 'While you were away...' summary vs live online notifications + visibility-aware sync.",
        ],
        ACCENT_GREEN,
    )
    _add_card(
        s7, 6.8, 4.35, 5.8, 2.45,
        "Dual Theme & Org Support Channel",
        [
            "Seamless Industrial Light / Tactical Dark switching across Operator, Admin, and Master.",
            "In-app Org Admin -> Master Admin escalation tickets with one-click action resolution.",
        ],
        ACCENT_AMBER,
    )

    # ------------------------------------------------------------------
    # Slide 8: Verification & Deployment
    # ------------------------------------------------------------------
    s8 = prs.slides.add_slide(blank)
    _apply_canvas(s8, "07 // VERIFICATION & CLOUD DEPLOY", "Tested End-to-End & Production-Ready on Cloud Run", 8)
    _add_card(
        s8, 0.7, 1.65, 5.8, 5.1,
        "Automated Verification Metrics",
        [
            "136 Backend Unit Tests Passing (Auth, RBAC, IDOR, Risk Scoring, Multi-Admin split, Custom Roles, Profiles, Notifications, Scope Tester, Master Portal, File Persistence).",
            "3 Live AWS Integration Tests Passing (STS AssumeRole positive read vs AccessDenied).",
            "React + TypeScript strict build (tsc -b && vite build) passing with zero 'any' types.",
            "Global gitleaks pre-commit scanner verifying zero credential leaks in Git history.",
        ],
        ACCENT_GREEN,
    )
    _add_card(
        s8, 6.8, 1.65, 5.8, 5.1,
        "Multi-Cloud Container Deployment",
        [
            "Multi-stage Dockerfile (Node 22 Vite builder -> non-root Python 3.13 slim runtime).",
            "Hosted on Google Cloud Run (asia-south1) using Google Secret Manager for secrets.",
            "Connects to AWS STS, S3, and 3 DynamoDB tables in ap-south-1 via least-privilege IAM user AICGateCloudRunBackend.",
            "Migration script sync_identity_to_dynamodb.py moves local data cleanly to AWS.",
        ],
        ACCENT_CYAN,
    )

    # ------------------------------------------------------------------
    # Slide 9: Live Demo & Future Roadmap
    # ------------------------------------------------------------------
    s9 = prs.slides.add_slide(blank)
    _apply_canvas(s9, "08 // DEMO FLOW & FUTURE", "Live Presentation Walkthrough & Roadmap", 9)
    _add_card(
        s9, 0.7, 1.65, 5.8, 5.1,
        "5-Minute Live Demo Flow",
        [
            "1. Register Org (Endfield Industries) -> join via invite code with domain autocomplete.",
            "2. Approve member, create colored role in Role Management, promote Delegated Admin.",
            "3. Submit multi-service JIT request as Operator -> Inspect policy & Provision as Admin.",
            "4. Prove boundary in Multi-Service Scope Tester (ALLOW vs 403 DENY) & Security Proof.",
            "5. Explore Pan/Zoom Entitlement Graph, 1:1 Access Key Card parallax, & Master Console.",
        ],
        ACCENT_VOLT,
    )
    _add_card(
        s9, 6.8, 1.65, 5.8, 5.1,
        "Future Enterprise Roadmap",
        [
            "OIDC & SAML 2.0 enterprise SSO integration (Okta, Google Workspace, Entra ID).",
            "Multi-Account AWS Organizations AssumeRole across Dev / Staging / Prod accounts.",
            "ChatOps interactive Slack & Microsoft Teams JIT approval workflows.",
            "Terraform / AWS CDK Infrastructure-as-Code deployment templates.",
        ],
        ACCENT_CYAN,
    )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUTPUT_PATH))
    return OUTPUT_PATH


if __name__ == "__main__":
    out = build_deck()
    print(f"Generated {out} ({out.stat().st_size} bytes)")
