/**
 * Formatted, High-Precision PDF Generator for ReFlow Commercial & Technical Feasibility Report
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ReFlow - Commercial & Technical Feasibility Architecture</title>
<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1e293b;
    background: #ffffff;
    line-height: 1.45;
    font-size: 8.5pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Page layout rules */
  .page-break {
    page-break-before: always;
    break-before: page;
  }

  .avoid-break {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  h2, h3, h4 {
    page-break-after: avoid;
    break-after: avoid;
  }

  /* Cover & Headers */
  .cover {
    border-bottom: 2px solid #059669;
    padding-bottom: 14px;
    margin-bottom: 16px;
  }

  .top-badge-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .brand-badge {
    background: #ecfdf5;
    color: #065f46;
    font-weight: 700;
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid #a7f3d0;
  }

  .confidential-tag {
    font-size: 7pt;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 1px;
    text-transform: uppercase;
    background: #f1f5f9;
    padding: 3px 8px;
    border-radius: 4px;
  }

  h1.doc-title {
    font-size: 20pt;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.4px;
    line-height: 1.15;
    margin-bottom: 3px;
  }

  p.doc-subtitle {
    font-size: 9.5pt;
    color: #475569;
    font-weight: 400;
    margin-bottom: 10px;
    line-height: 1.35;
  }

  .meta-grid {
    display: flex;
    gap: 8px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 5px;
    padding: 7px 10px;
  }

  .meta-item {
    flex: 1 1 0;
    min-width: 0;
  }

  .meta-item strong {
    display: block;
    color: #64748b;
    text-transform: uppercase;
    font-size: 6.5pt;
    letter-spacing: 0.5px;
    margin-bottom: 1px;
  }

  .meta-item span {
    font-weight: 700;
    color: #0f172a;
    font-size: 7.5pt;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }

  /* Headings */
  h2 {
    font-size: 11.5pt;
    font-weight: 700;
    color: #0f172a;
    border-left: 3.5px solid #059669;
    padding-left: 7px;
    margin-top: 14px;
    margin-bottom: 6px;
    letter-spacing: -0.2px;
  }

  h3 {
    font-size: 9.5pt;
    font-weight: 700;
    color: #1e293b;
    margin-top: 10px;
    margin-bottom: 4px;
  }

  p {
    margin-bottom: 6px;
    color: #334155;
    text-align: justify;
  }

  /* Tables */
  table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    margin: 6px 0 12px 0;
    font-size: 7.2pt;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  table th {
    background: #0f172a;
    color: #ffffff;
    font-weight: 600;
    text-align: left;
    padding: 5px 6px;
    border: 1px solid #1e293b;
    font-size: 6.8pt;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  table td {
    padding: 4.5px 6px;
    border: 1px solid #e2e8f0;
    vertical-align: top;
    color: #334155;
    word-break: break-word;
  }

  table tr:nth-child(even) td {
    background: #f8fafc;
  }

  table tr.highlight td {
    background: #ecfdf5;
    font-weight: 600;
    color: #065f46;
  }

  /* Architecture Diagram */
  .diagram-container {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    padding: 8px;
    margin: 8px 0;
    display: flex;
    gap: 8px;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .diagram-box {
    flex: 1 1 0;
    min-width: 0;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 7px;
  }

  .diagram-box.active {
    border-top: 2.5px solid #059669;
  }

  .diagram-box.cloud {
    border-top: 2.5px solid #2563eb;
  }

  .diagram-box h4 {
    font-size: 8pt;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 4px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .diagram-box ul {
    list-style: none;
    font-size: 6.8pt;
    color: #475569;
  }

  .diagram-box ul li {
    padding: 2px 0;
    border-bottom: 1px dashed #f1f5f9;
  }

  .diagram-box ul li:last-child {
    border-bottom: none;
  }

  /* Callout Boxes */
  .callout {
    border-radius: 4px;
    padding: 6px 9px;
    margin: 8px 0;
    font-size: 7.5pt;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .callout-success {
    background: #ecfdf5;
    border-left: 3.5px solid #059669;
    color: #065f46;
  }

  .callout-info {
    background: #eff6ff;
    border-left: 3.5px solid #3b82f6;
    color: #1e40af;
  }

  .callout strong {
    display: block;
    margin-bottom: 2px;
    font-weight: 700;
  }

  /* Competitor Cards */
  .comp-card {
    border: 1px solid #e2e8f0;
    border-radius: 5px;
    background: #ffffff;
    padding: 7px 9px;
    margin-bottom: 7px;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .comp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #f1f5f9;
    padding-bottom: 3px;
    margin-bottom: 4px;
  }

  .comp-name {
    font-size: 8.5pt;
    font-weight: 700;
    color: #0f172a;
  }

  .comp-tag {
    font-size: 6.5pt;
    font-weight: 600;
    padding: 1.5px 5px;
    border-radius: 3px;
    background: #f1f5f9;
    color: #475569;
  }

  .comp-pricing {
    font-size: 7.5pt;
    color: #047857;
    font-weight: 600;
    margin-bottom: 3px;
  }

  .comp-details {
    font-size: 7pt;
    color: #475569;
    line-height: 1.35;
  }

  .comp-weakness {
    margin-top: 4px;
    padding: 3px 6px;
    background: #fef2f2;
    border-left: 2.5px solid #ef4444;
    color: #991b1b;
    font-size: 6.8pt;
  }

  /* Pricing Cards Grid (Flexbox for perfect print alignment) */
  .pricing-grid {
    display: flex;
    gap: 8px;
    margin: 8px 0 10px 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .price-card {
    flex: 1 1 0;
    min-width: 0;
    border: 1px solid #e2e8f0;
    border-radius: 5px;
    background: #ffffff;
    padding: 8px;
    text-align: left;
    position: relative;
  }

  .price-card.featured {
    border: 1.5px solid #059669;
    background: #f0fdf4;
  }

  .price-tag {
    font-size: 13.5pt;
    font-weight: 800;
    color: #0f172a;
    margin: 3px 0 1px 0;
  }

  .price-tag span {
    font-size: 7pt;
    font-weight: 500;
    color: #64748b;
  }

  .price-tier-name {
    font-size: 8.5pt;
    font-weight: 700;
    color: #0f172a;
  }

  .price-features {
    list-style: none;
    margin-top: 5px;
    font-size: 6.8pt;
    color: #334155;
  }

  .price-features li {
    padding: 1.5px 0;
  }

  .price-features li::before {
    content: "✓ ";
    color: #059669;
    font-weight: bold;
  }

  pre {
    background: #0f172a;
    color: #e2e8f0;
    font-family: "Cascadia Code", "Consolas", monospace;
    font-size: 6.8pt;
    padding: 5px 7px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 5px 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }
</style>
</head>
<body>

<!-- COVER / HEADER -->
<div class="cover">
  <div class="top-badge-row">
    <span class="brand-badge">Commercial & Technical Architecture Blueprint</span>
    <span class="confidential-tag">ReFlow Master Strategy • Confidential</span>
  </div>
  <h1 class="doc-title">ReFlow</h1>
  <p class="doc-subtitle">Comprehensive Competitor Intelligence, Plan Breakdowns, Cloud Hosting Feasibility, Operational Cost Modeling, and Commercial Pricing Architecture</p>
  
  <div class="meta-grid">
    <div class="meta-item">
      <strong>Product Architecture</strong>
      <span>Hybrid Cloud + Chrome CDP</span>
    </div>
    <div class="meta-item">
      <strong>Target Segment</strong>
      <span>General-Purpose SMB RPA</span>
    </div>
    <div class="meta-item">
      <strong>Cloud Baseline Cost</strong>
      <span>$37 – $50 / month</span>
    </div>
    <div class="meta-item">
      <strong>Gross Profit Margin</strong>
      <span>95.6% Contribution</span>
    </div>
  </div>
</div>

<!-- SECTION 1 -->
<h2>1. Executive Summary & The ReFlow Architectural Advantage</h2>
<p>
Modern automation software is broken into two extremes: <strong>Cloud Headless Scrapers</strong> (Axiom, Browse AI), which incur huge server bills ($0.02–$0.10/min) and suffer frequent IP bans and 2FA failures; and <strong>Enterprise RPA Suites</strong> (UiPath, Microsoft Power Automate), which cost hundreds of dollars per month and require certified consultants.
</p>
<p>
<strong>ReFlow operates on a Hybrid Paradigm</strong> that decouples the local execution engine from the cloud control plane:
</p>

<div class="diagram-container">
  <div class="diagram-box active">
    <h4>Customer Workstation (ReFlow Runner) <span style="color:#059669;">Zero Compute Cost</span></h4>
    <ul>
      <li><strong>Native Chrome (Port 9222):</strong> Real user profile, persistent cookies, genuine hardware canvas.</li>
      <li><strong>Node.js Daemon (packages/engine):</strong> Lightweight CDP connector, 10s poll loop, atomic run claims.</li>
      <li><strong>90s HITL 2FA Window:</strong> Halts replay, alerts user for SMS/Authenticator, resumes smoothly.</li>
      <li><strong>Local Storage:</strong> Files stored directly in customer folders with SHA-256 deduplication.</li>
    </ul>
  </div>
  <div class="diagram-box cloud">
    <h4>ReFlow Cloud Control Plane <span style="color:#2563eb;">$37–$50/mo Fixed</span></h4>
    <ul>
      <li><strong>Next.js 16 Web Dashboard:</strong> Real-time workflow builder, run dispatcher, and audit views.</li>
      <li><strong>REST API v1:</strong> Authenticated polling queue, atomic state transitions, telemetry sync.</li>
      <li><strong>Supabase PostgreSQL:</strong> Workflows, organizations, runs, and artifact hash tracking.</li>
      <li><strong>Cloudflare R2:</strong> Optional zero-egress cloud artifact vault for paying subscribers.</li>
    </ul>
  </div>
</div>

<div class="callout callout-success avoid-break">
  <strong>ReFlow's Structural Margin Advantage:</strong>
  Because Chromium, DOM parsing, JavaScript execution, and heavy file downloads occur 100% on customer hardware, your cloud server cost per run is sub-millicent ($0.0001–$0.0003). You achieve software gross margins exceeding 95% while bypassing bot detection naturally through real residential/office IPs.
</div>

<!-- SECTION 2 -->
<h2>2. Deep Competitor Intelligence & Monetization Breakdown</h2>
<p>
Below is an exhaustive forensic analysis of how the major competitors package, meter, and price their platforms:
</p>

<!-- COMP 1: POWER AUTOMATE -->
<div class="comp-card">
  <div class="comp-header">
    <span class="comp-name">Microsoft Power Automate (Desktop & Cloud)</span>
    <span class="comp-tag">Enterprise Desktop RPA</span>
  </div>
  <div class="comp-pricing">Plans: Free (Attended Windows only) • $15/user/mo (Premium) • $150/bot/mo (Process/Unattended) • $215/bot/mo (Hosted VM)</div>
  <div class="comp-details">
    <strong>How They Charge:</strong> Capacity-based licensing. Free edition lacks cloud scheduling and triggers. Attended desktop flows require user presence ($15/user/mo). Autonomous background execution requires the "Process" license at $150/bot/month, plus user-managed Windows VM costs. Pay-as-you-go Azure meters charge $0.60/cloud run and $3.00/desktop run.
  </div>
  <div class="comp-weakness">
    <strong>Traps & Weaknesses:</strong> Running 3 unattended bots costs $450/month in licenses alone. Premium connectors require all flow users to hold paid licenses. Free AI Builder credits removed in late 2026 ($500/mo add-on).
  </div>
</div>

<!-- COMP 2: UIPATH -->
<div class="comp-card">
  <div class="comp-header">
    <span class="comp-name">UiPath (Automation Cloud)</span>
    <span class="comp-tag">Global Enterprise Leader</span>
  </div>
  <div class="comp-pricing">Plans: Community (Non-commercial) • $420/month (~$5,040/yr Pro Starter) • $15,000–$50,000+/year (Enterprise)</div>
  <div class="comp-details">
    <strong>How They Charge:</strong> Per-Robot / Per-Developer annual seat commitments. Pro tier includes 1 Studio license, 1 attended robot, and 1,000 Automation Units. Unattended bots cost $1,380 to $8,000/year extra.
  </div>
  <div class="comp-weakness">
    <strong>Traps & Weaknesses:</strong> Prohibitive cost for SMBs; "Automation Units" burn rapidly on Document Understanding; requires specialized certified RPA developers to build and maintain.
  </div>
</div>

<div class="page-break"></div>

<!-- COMP 3: AXIOM.AI -->
<div class="comp-card">
  <div class="comp-header">
    <span class="comp-name">Axiom.ai (Browser Automation)</span>
    <span class="comp-tag">No-Code Extension & Cloud</span>
  </div>
  <div class="comp-pricing">Plans: Free Trial (2 hrs) • $15/mo (Starter: 5 hrs) • $50/mo (Pro: 20 hrs) • $150/mo (60 hrs) • $250/mo (100 hrs)</div>
  <div class="comp-details">
    <strong>How They Charge:</strong> Metered strictly on <em>runtime minutes/hours</em>. If a slow portal or rate limit takes 3 minutes to load a page, 3 minutes are deducted from your balance. Concurrency is throttled (1 bot on Starter up to 20 on Ultimate).
  </div>
  <div class="comp-weakness">
    <strong>Traps & Weaknesses:</strong> Zero minute rollover; users suffer runtime anxiety when web pages lag; Chrome extension frequently crashes on massive DOM tables; cloud runs trigger bot bans.
  </div>
</div>

<!-- COMP 4: BROWSE AI -->
<div class="comp-card">
  <div class="comp-header">
    <span class="comp-name">Browse AI (Web Extraction & Monitoring)</span>
    <span class="comp-tag">Cloud Headless Scraper</span>
  </div>
  <div class="comp-pricing">Plans: Free (50 credits) • $48/mo (Personal: 2,000 credits) • $87/mo (Pro: 5,000 credits) • $500+/mo (Company)</div>
  <div class="comp-details">
    <strong>How They Charge:</strong> Credit-based consumption. 1 credit = 1 basic page extraction or 10 extracted rows. Monitored robot slots are capped (5 on Personal, 10 on Pro).
  </div>
  <div class="comp-weakness">
    <strong>Traps & Weaknesses:</strong> Severe 2x–10x credit penalty on "Premium Sites" (LinkedIn, Amazon, government portals); cloud IPs get blocked by Cloudflare; zero local desktop file handling.
  </div>
</div>

<!-- COMP 5: BARDEEN.AI -->
<div class="comp-card">
  <div class="comp-header">
    <span class="comp-name">Bardeen.ai (Work Intelligence)</span>
    <span class="comp-tag">AI GTM & Sales Agents</span>
  </div>
  <div class="comp-pricing">Plans: Free (100 credits) • $10–$15/mo (Pro: 500–1,000 credits) • $50–$150/mo (Business teams)</div>
  <div class="comp-details">
    <strong>How They Charge:</strong> Monthly credit subscriptions. Web actions cost 1 credit; data enrichment costs 3 credits/row. Pivoted heavily to GTM sales workflows (HubSpot/LinkedIn).
  </div>
  <div class="comp-weakness">
    <strong>Traps & Weaknesses:</strong> Enrichment burns credits rapidly; abandoned generic back-office portal automation; cannot handle repetitive invoice loop downloads.
  </div>
</div>

<!-- COMP 6: SEMA4.AI (ROBOCORP) -->
<div class="comp-card">
  <div class="comp-header">
    <span class="comp-name">Sema4.ai / Robocorp</span>
    <span class="comp-tag">Developer Python RPA</span>
  </div>
  <div class="comp-pricing">Plans: Developer (Free 240 min) • Consumption Tier ($0.10 / run minute) • Enterprise Custom</div>
  <div class="comp-details">
    <strong>How They Charge:</strong> Pure consumption per execution minute across Control Room environments. Supports 20 workspaces and 20 parallel executions.
  </div>
  <div class="comp-weakness">
    <strong>Traps & Weaknesses:</strong> At $0.10/min, a daily 30-min extraction costs $90/mo; code-only barrier (Python/Robot Framework); zero visual no-code builder for office staff.
  </div>
</div>

<!-- COMPETITOR MATRIX TABLE -->
<h3>Comprehensive Competitor Comparison Matrix</h3>
<table>
  <thead>
    <tr>
      <th style="width: 17%;">Dimension</th>
      <th style="width: 16%;">Power Automate</th>
      <th style="width: 16%;">UiPath</th>
      <th style="width: 16%;">Axiom.ai</th>
      <th style="width: 16%;">Browse AI</th>
      <th style="width: 19%;">ReFlow (Your Product)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Pricing Metric</strong></td>
      <td>Per User / Bot</td>
      <td>Per Robot License</td>
      <td>Runtime Minutes</td>
      <td>Task Credits / Rows</td>
      <td><strong>Runner Seats + Runs</strong></td>
    </tr>
    <tr>
      <td><strong>Entry Cost</strong></td>
      <td>$15 / $150 / mo</td>
      <td>$420 / mo</td>
      <td>$15 / mo</td>
      <td>$48 / mo</td>
      <td><strong>$29 / mo (Starter)</strong></td>
    </tr>
    <tr>
      <td><strong>3 Unattended Bots</strong></td>
      <td>$450 / mo</td>
      <td>$1,200+ / mo</td>
      <td>$150 / mo</td>
      <td>N/A (Cloud only)</td>
      <td><strong>$79 / mo (Professional)</strong></td>
    </tr>
    <tr>
      <td><strong>Execution Engine</strong></td>
      <td>Windows VM</td>
      <td>Windows Desktop/VM</td>
      <td>Cloud / Extension</td>
      <td>Cloud Headless</td>
      <td><strong>Local Real Chrome (CDP)</strong></td>
    </tr>
    <tr>
      <td><strong>2FA / HITL Window</strong></td>
      <td>Complex setup</td>
      <td>Attended prompt</td>
      <td>None</td>
      <td>Breaks completely</td>
      <td><strong>Built-in 90s HITL Banner</strong></td>
    </tr>
    <tr>
      <td><strong>Anti-Bot Resistance</strong></td>
      <td>Moderate</td>
      <td>Moderate</td>
      <td>Poor (Cloud IPs)</td>
      <td>Poor (Cloud IPs)</td>
      <td><strong>Unmatched (Residential IP)</strong></td>
    </tr>
    <tr>
      <td><strong>Local Deduplication</strong></td>
      <td>Manual script</td>
      <td>Manual script</td>
      <td>None</td>
      <td>None</td>
      <td><strong>Native SHA-256 Checksums</strong></td>
    </tr>
  </tbody>
</table>

<div class="page-break"></div>

<!-- SECTION 3 -->
<h2>3. ReFlow Monetization Options: 7 Commercial Models</h2>

<h3>Model 1: The Hybrid "Runner Seats + Run Volume" Model (Recommended Flagship)</h3>
<p>
This model aligns pricing with physical machine utilization while giving generous monthly run quotas:
</p>

<div class="pricing-grid">
  <div class="price-card">
    <div class="price-tier-name">Starter</div>
    <div class="price-tag">$29 <span>/ month</span></div>
    <div style="font-size:6.5pt; color:#64748b; margin-bottom:4px;">$24/mo billed annually</div>
    <ul class="price-features">
      <li><strong>1 Desktop Runner</strong> connected</li>
      <li><strong>500 Runs / month</strong></li>
      <li>5 Active Workflows</li>
      <li>Local disk storage only</li>
      <li>Standard 10s polling interval</li>
      <li>Overages: $10 / 500 extra runs</li>
    </ul>
  </div>

  <div class="price-card featured">
    <div style="position:absolute; top:-6px; right:8px; background:#059669; color:#fff; font-size:6pt; font-weight:700; padding:1.5px 5px; border-radius:3px;">MOST POPULAR</div>
    <div class="price-tier-name">Professional</div>
    <div class="price-tag">$79 <span>/ month</span></div>
    <div style="font-size:6.5pt; color:#64748b; margin-bottom:4px;">$65/mo billed annually</div>
    <ul class="price-features">
      <li><strong>3 Desktop Runners</strong> connected</li>
      <li><strong>3,000 Runs / month</strong></li>
      <li>Unlimited Workflows</li>
      <li><strong>10 GB Cloudflare R2 Backup</strong></li>
      <li>Webhook & Slack 2FA alerts</li>
      <li>5s priority polling interval</li>
      <li>Overages: $8 / 1,000 extra runs</li>
    </ul>
  </div>

  <div class="price-card">
    <div class="price-tier-name">Business / Team</div>
    <div class="price-tag">$199 <span>/ month</span></div>
    <div style="font-size:6.5pt; color:#64748b; margin-bottom:4px;">$165/mo billed annually</div>
    <ul class="price-features">
      <li><strong>10 Desktop Runners</strong> connected</li>
      <li><strong>15,000 Runs / month</strong></li>
      <li>Unlimited Workflows</li>
      <li><strong>50 GB Cloudflare R2 Backup</strong></li>
      <li>Multi-user RBAC & Audit Logs</li>
      <li>Real-time push & priority support</li>
      <li>Overages: $5 / 1,000 extra runs</li>
    </ul>
  </div>
</div>

<h3>Complete Portfolio of Alternate Commercial Models</h3>
<table>
  <thead>
    <tr>
      <th style="width: 22%;">Model Strategy</th>
      <th style="width: 28%;">Pricing Structure</th>
      <th style="width: 25%;">Core Advantages</th>
      <th style="width: 25%;">Target Best-Fit Persona</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Model 2: Per-Worker License</strong></td>
      <td><strong>$39 to $49 / mo per PC</strong><br>Unlimited local runs. Optional $15/mo for 25GB cloud vault.</td>
      <td>Predictable IT budgets; undercuts Power Automate by 70%.</td>
      <td>Mid-market IT & corporate procurement.</td>
    </tr>
    <tr>
      <td><strong>Model 3: Task Consumption</strong></td>
      <td><strong>$19/mo</strong> (1,000 runs) • <strong>$49/mo</strong> (4,000 runs) • <strong>$119/mo</strong> (15,000 runs)</td>
      <td>Low entry price point; high self-serve conversion velocity.</td>
      <td>Self-serve growth hackers and freelancers.</td>
    </tr>
    <tr>
      <td><strong>Model 4: Accounting Vertical</strong></td>
      <td><strong>$49/mo</strong> (10 portals) • <strong>$129/mo</strong> (35 portals) • <strong>$299/mo</strong> (100 portals)</td>
      <td>Massive perceived value: directly saves 20+ billable hours/mo.</td>
      <td>Accounting firms, bookkeepers, CFOs.</td>
    </tr>
    <tr>
      <td><strong>Model 5: Agency / MSP Reseller</strong></td>
      <td><strong>$249/mo base</strong> (15 client orgs, 15 runners, 25k pooled runs) + $15/client add-on.</td>
      <td>Rapid distribution: one agency partner brings 15–50 end users.</td>
      <td>IT MSPs, bookkeeping agencies.</td>
    </tr>
    <tr>
      <td><strong>Model 6: Per-Step / Operations</strong></td>
      <td><strong>$19/mo</strong> (25k steps) • <strong>$49/mo</strong> (100k steps) • <strong>$129/mo</strong> (400k steps). Refill: $10 / 25k.</td>
      <td>Granular & fair (Make.com/Zapier model); captures true complexity of multi-page loops.</td>
      <td>High-volume data loops, ERP batch extractors.</td>
    </tr>
    <tr>
      <td><strong>Model 7: Hourly Credits / Digital Bot</strong></td>
      <td><strong>$19/mo</strong> (15 hrs @ $1.26/hr) • <strong>$49/mo</strong> (50 hrs @ $0.98/hr) • <strong>$129/mo</strong> (160 hrs @ $0.80/hr).</td>
      <td>Unbeatable ROI hook: "Hire a digital worker for &lt;$1/hr vs $25/hr human temp." Pauses clock during 2FA!</td>
      <td>Operational business owners, finance teams.</td>
    </tr>
  </tbody>
</table>

<!-- SECTION 4 -->
<h2>4. Cloud Hosting & Infrastructure Comparison</h2>
<table>
  <thead>
    <tr>
      <th style="width: 25%;">Infrastructure Stack</th>
      <th style="width: 32%;">Architecture Components</th>
      <th style="width: 18%;">Monthly Cost</th>
      <th style="width: 25%;">10s Polling Suitability</th>
    </tr>
  </thead>
  <tbody>
    <tr class="highlight">
      <td><strong>Option A: Managed PaaS (Recommended)</strong></td>
      <td>Render/Railway (Node.js) + Supabase Cloud Pro + Cloudflare R2</td>
      <td><strong>$37 – $50 / mo</strong></td>
      <td><strong>High:</strong> Persistent Node instance handles HTTP keep-alive effortlessly.</td>
    </tr>
    <tr>
      <td><strong>Option B: Self-Hosted VPS</strong></td>
      <td>Hetzner Cloud CPX31 (Docker / Coolify) + Self-hosted Postgres + MinIO</td>
      <td><strong>$16 – $35 / mo</strong></td>
      <td><strong>Unmatched:</strong> Native Linux kernel handles 5,000+ polling connections.</td>
    </tr>
    <tr>
      <td><strong>Option C: Serverless / Edge</strong></td>
      <td>Vercel Pro + Neon Serverless Postgres + Cloudflare R2</td>
      <td><strong>$60 – $150+ / mo</strong></td>
      <td><strong>Poor:</strong> 21.6M monthly polling requests incur heavy serverless invocation penalties.</td>
    </tr>
    <tr>
      <td><strong>Option D: Hyperscaler</strong></td>
      <td>AWS ECS Fargate + RDS Aurora Postgres + AWS S3</td>
      <td><strong>$180 – $350+ / mo</strong></td>
      <td><strong>High:</strong> Enterprise grade; high ops overhead.</td>
    </tr>
  </tbody>
</table>

<div class="page-break"></div>

<!-- SECTION 5 -->
<h2>5. Granular Operational Cost Modeling Across Scale Milestones</h2>
<table>
  <thead>
    <tr>
      <th style="width: 26%;">Expense Item</th>
      <th style="width: 30%;">Underlying Service / Calculation</th>
      <th style="width: 14%;">Phase 1: Launch<br>(50 Orgs, 100 Workers)</th>
      <th style="width: 15%;">Phase 2: Growth<br>(250 Orgs, 750 Workers)</th>
      <th style="width: 15%;">Phase 3: Scale<br>(1,000 Orgs, 3,500 Workers)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Web & API Compute</strong></td>
      <td>Render / Railway persistent Node.js instances</td>
      <td>$15 / mo (1x 2GB RAM)</td>
      <td>$35 / mo (2x Instances)</td>
      <td>$100 / mo (Cluster of 4)</td>
    </tr>
    <tr>
      <td><strong>PostgreSQL Database</strong></td>
      <td>Supabase Pro (PgBouncer/Supavisor pooling)</td>
      <td>$25 / mo</td>
      <td>$50 / mo (+ Compute addon)</td>
      <td>$150 / mo (Team 4vCPU)</td>
    </tr>
    <tr>
      <td><strong>Object Storage</strong></td>
      <td>Cloudflare R2 ($0.015 / GB stored)</td>
      <td>$1 / mo (~60 GB)</td>
      <td>$8 / mo (~500 GB)</td>
      <td>$45 / mo (~3,000 GB)</td>
    </tr>
    <tr>
      <td><strong>Data Egress</strong></td>
      <td>Cloudflare R2 ($0.00 Egress fee)</td>
      <td><strong>$0.00</strong></td>
      <td><strong>$0.00</strong></td>
      <td><strong>$0.00</strong></td>
    </tr>
    <tr>
      <td><strong>DNS, CDN & DDoS</strong></td>
      <td>Cloudflare Pro / Free</td>
      <td>$0 / mo</td>
      <td>$20 / mo</td>
      <td>$20 / mo</td>
    </tr>
    <tr>
      <td><strong>Email & 2FA Notifications</strong></td>
      <td>Resend / Postmark + Twilio SMS</td>
      <td>$5 / mo</td>
      <td>$45 / mo</td>
      <td>$160 / mo</td>
    </tr>
    <tr>
      <td><strong>Error Monitoring</strong></td>
      <td>Sentry & BetterStack Telemetry</td>
      <td>$0 / mo (Developer tier)</td>
      <td>$26 / mo</td>
      <td>$65 / mo</td>
    </tr>
    <tr>
      <td><strong>Domain & CI/CD</strong></td>
      <td>Cloudflare Registrar + GitHub Actions</td>
      <td>$5 / mo</td>
      <td>$10 / mo</td>
      <td>$25 / mo</td>
    </tr>
    <tr>
      <td><strong>Stripe Processing</strong></td>
      <td>2.9% + $0.30 per customer transaction</td>
      <td>~$115 / mo</td>
      <td>~$560 / mo</td>
      <td>~$2,200 / mo</td>
    </tr>
    <tr class="highlight">
      <td><strong>Total Monthly Operating Cost</strong></td>
      <td><strong>All Infrastructure & Gateway Fees</strong></td>
      <td><strong>~$166 / month</strong></td>
      <td><strong>~$754 / month</strong></td>
      <td><strong>~$2,765 / month</strong></td>
    </tr>
  </tbody>
</table>

<!-- SECTION 6 -->
<h2>6. Technical Feasibility & Scalability Guardrails</h2>

<h3>6.1 Polling Math & Database Query Indexing</h3>
<p>
At a 12-second average polling interval, 1 worker produces 7,200 requests/day. At 1,000 customers (3,500 workers), the system handles ~291 requests/second. To prevent table scans and DB locks, run this migration in Supabase:
</p>
<pre>-- Optimized Partial B-Tree Index for High-Frequency Polling
CREATE INDEX IF NOT EXISTS idx_execution_runs_active_polling
ON wf_execution_runs (org_id, status)
WHERE status = 'pending';</pre>
<p>
This ensures polling executes as an index-only scan in <code>&lt; 0.8ms</code>, keeping PostgreSQL CPU usage below 15% on modest compute.
</p>

<h3>6.2 Direct Pre-Signed Cloud Storage Pattern</h3>
<p>
To keep Next.js API server RAM consumption under 150MB, files must <strong>never stream through the web server</strong>:
</p>
<pre>1. Runner downloads PDF locally -> computes SHA-256 checksum.
2. Runner requests presigned URL: POST /api/v1/artifacts/presigned-url
3. Next.js validates plan quota -> issues Cloudflare R2 pre-signed PUT URL.
4. Runner uploads directly to Cloudflare R2 via HTTP PUT.
5. Runner registers artifact: POST /api/v1/artifacts</pre>

<!-- SECTION 7 -->
<h2>7. Unit Economics, Cash Flow & Financial Trajectory</h2>
<p>
Assuming the recommended <strong>Model 1 (Hybrid $29 / $79 / $199)</strong> with a blended ARPU of <strong>$65 / month</strong>:
</p>

<table>
  <thead>
    <tr>
      <th style="width: 25%;">Milestone Metric</th>
      <th style="width: 12%;">10 Customers</th>
      <th style="width: 12%;">50 Customers</th>
      <th style="width: 12%;">100 Customers</th>
      <th style="width: 13%;">250 Customers</th>
      <th style="width: 13%;">500 Customers</th>
      <th style="width: 13%;">1,000 Customers</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Monthly Revenue (MRR)</strong></td>
      <td><strong>$650</strong></td>
      <td><strong>$3,250</strong></td>
      <td><strong>$6,500</strong></td>
      <td><strong>$16,250</strong></td>
      <td><strong>$32,500</strong></td>
      <td><strong>$65,000</strong></td>
    </tr>
    <tr>
      <td><strong>Annual Run-Rate (ARR)</strong></td>
      <td>$7,800</td>
      <td>$39,000</td>
      <td>$78,000</td>
      <td>$195,000</td>
      <td>$390,000</td>
      <td>$780,000</td>
    </tr>
    <tr>
      <td><strong>Total Infra & Stripe Costs</strong></td>
      <td>$75 / mo</td>
      <td>$166 / mo</td>
      <td>$280 / mo</td>
      <td>$754 / mo</td>
      <td>$1,420 / mo</td>
      <td>$2,765 / mo</td>
    </tr>
    <tr class="highlight">
      <td><strong>Monthly Net Operating Profit</strong></td>
      <td><strong>$575 / mo</strong></td>
      <td><strong>$3,084 / mo</strong></td>
      <td><strong>$6,220 / mo</strong></td>
      <td><strong>$15,496 / mo</strong></td>
      <td><strong>$31,080 / mo</strong></td>
      <td><strong>$62,235 / mo</strong></td>
    </tr>
    <tr>
      <td><strong>Net Operating Margin</strong></td>
      <td>88.5%</td>
      <td>94.9%</td>
      <td>95.7%</td>
      <td>95.4%</td>
      <td>95.6%</td>
      <td>95.7%</td>
    </tr>
  </tbody>
</table>

<div class="callout callout-info avoid-break">
  <strong>Break-Even Milestone:</strong>
  Baseline fixed infrastructure (Render $15 + Supabase $25 + Domain $5) = <strong>$45.00 / month</strong>.
  Just <strong>2 paying customers</strong> on the Starter plan ($29/mo) make the business completely self-sustaining.
</div>

</body>
</html>
`;

async function generatePdf() {
  console.log('Connecting to browser at:', CHROME_PATH);
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  const outputPaths = [
    path.resolve('c:/Users/AbuZar/Desktop/Fyp/Workflow-Capture-SaaS/docs/ReFlow_Commercial_and_Technical_Analysis.pdf'),
    path.resolve('c:/Users/AbuZar/Desktop/Fyp/Workflow-Capture/docs/ReFlow_Commercial_and_Technical_Analysis.pdf'),
    path.resolve('C:/Users/AbuZar/.gemini/antigravity/brain/74fbe904-8d92-4428-9386-678085665b53/ReFlow_Commercial_and_Technical_Analysis.pdf')
  ];

  for (const outPath of outputPaths) {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div style="font-size: 7pt; color: #94a3b8; width: 100%; padding: 0 14mm; display: flex; justify-content: space-between; font-family: Segoe UI, sans-serif;"><span>ReFlow Commercial & Technical Architecture Blueprint</span><span style="color: #059669; font-weight: 700;">CONFIDENTIAL</span></div>',
      footerTemplate: '<div style="font-size: 7pt; color: #94a3b8; width: 100%; padding: 0 14mm; display: flex; justify-content: space-between; font-family: Segoe UI, sans-serif;"><span>ReFlow (formerly PortalSync)</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
      margin: {
        top: '16mm',
        bottom: '16mm',
        left: '14mm',
        right: '14mm'
      }
    });
    console.log('Successfully generated formatted PDF at:', outPath);
  }

  await browser.close();
  console.log('PDF generation complete!');
}

generatePdf().catch(err => {
  console.error('Error generating PDF:', err);
  process.exit(1);
});
