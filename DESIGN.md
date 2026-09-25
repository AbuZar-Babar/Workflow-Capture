# Design Direction: Workflow Capture (FlowMind Studio)

> Design system, aesthetic principles, and quality standards for Workflow Capture.
> Dial: ENERGY 2 / RHYTHM 2 / MOTION 2

---

## 1. Identity & Purpose

- **Product:** Workflow Capture (FlowMind Studio).
- **Domain:** Local-first visual browser automation, workflow recording, and execution engine.
- **Audience:** Automation engineers, QA testers, and developers building resilient web scraping and RPA flows.
- **Visual Character:** Engineered precision, spatial orientation, purposeful density. Designed like a developer-grade workbench (think n8n meets Linear), never an AI landing-page template.

---

## 2. The Three Dials

| Dial | Level | Definition & Visual Execution |
| :--- | :---: | :--- |
| **ENERGY** | **2 (Balanced)** | Crisp high-contrast indigo primary (`#3B55D9`), clean slate surfaces, clear status signaling without sensory overload. |
| **RHYTHM** | **2 (Structured Breaks)** | Clear section hierarchy: pinned brand topbar, vertical tool dock, full-bleed spatial node canvas, structured modal inspectors. |
| **MOTION** | **2 (Micro-Interactions)** | Snappy 180ms–220ms ease-out transitions for buttons and docks; functional canvas grab/panning; modal zoom-ins. Zero gratuitous floating blobs or looping bounces. |

---

## 3. Color Tokens & Contrast Standards (WCAG AA Compliance)

All foreground and background color combinations strictly adhere to WCAG AA ($\ge 4.5:1$ for normal text, $\ge 3.0:1$ for large text).

### Light Mode Palette
- **Canvas Base:** `#F4F7FD`
- **Surface / Cards:** `#FFFFFF` (Solid, high-legibility crisp cards)
- **Primary Brand:** `#3B55D9` (Ratio **`6.02:1`** on white, **`5.61:1`** on canvas base)
- **Primary Hover:** `#2A40B5`
- **Secondary Accent:** `#0284C7` (Sky 600)
- **Text Main (Headings):** `#0F172A` (Ratio **`16.9:1`**)
- **Text Body:** `#334155` (Ratio **`9.6:1`**)
- **Text Sub / Labels:** `#475569` (Ratio **`7.1:1`**)
- **Text Muted / Hints:** `#596780` (Ratio **`4.95:1`**)
- **Success State:** `#047857` (Emerald 700: Ratio **`5.48:1`**)
- **Warning State:** `#B45309` (Amber 700: Ratio **`4.88:1`**)
- **Danger State:** `#DC2626` (Crimson 600: Ratio **`4.82:1`**)

### Dark Mode Palette (Cyber Slate)
- **Canvas Base:** `#080C16`
- **Surface / Cards:** `#162038`
- **Primary Brand:** `#6366F1`
- **Text Main:** `#F8FAFC` (Ratio **`15.4:1`**)
- **Text Body:** `#94A3B8` (Ratio **`7.2:1`**)
- **Success State:** `#34D399` (Ratio **`8.42:1`**)
- **Danger State:** `#F87171` (Ratio **`7.1:1`**)

---

## 4. Typography Ramp

- **Primary UI:** `Plus Jakarta Sans`, -apple-system, sans-serif.
- **Data & Automation Code:** `JetBrains Mono`, `Fira Code`, monospace.
- **Size Scale:**
  - `11.5px` (`0.72rem`) — Strict floor for micro-badges and tags.
  - `13px` (`0.8125rem`) — Button labels, secondary inputs.
  - `15px` (`0.9375rem`) — Primary body text, form controls.
  - `17px` (`1.0625rem`) — Card titles, subheadings.
  - `20px` (`1.25rem`) — Modal titles, view headers.

---

## 5. Geometric Hierarchy & Radius Tokens

To avoid the "pill soup" trap where every element is rendered with `border-radius: 9999px`:
- **Tags & Status Indicators:** `6px` rounded rect or 50% circular dot.
- **Buttons & Nav Pills:** `8px` rounded rect with 2px focus-visible offset.
- **Sidebar Dock:** `16px` rounded container.
- **Workflow Cards:** `14px` crisp bordered rect.
- **Dialogs & Modals:** `18px`–`24px` modal window.

---

## 6. Accessibility & Keyboard Guarantees

1. **Universal Focus Ring:** Every interactive element reveals `:focus-visible { outline: 2px solid var(--brand-forest); outline-offset: 2px; }`.
2. **Tap Targets:** Coarse pointers (touch devices) scale interactive targets to a minimum of $44 \times 44\text{px}$.
3. **Esc Key:** All modals close cleanly on `Escape` without trapping focus.
4. **No Dead Links:** All navigation links target active sections or explicit actions.
