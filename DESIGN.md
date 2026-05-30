---
name: chrono Design System
description: Sleek tech-minimalist scheduler interface modeled after Cal.com, using a dark zinc palette and brand burgundy accents.
colors:
  primary: "#fafafa"
  bg: "#09090b"
  border: "#27272a"
  secondary: "#18181b"
  muted-foreground: "#a1a1aa"
  success: "#10b981"
  error: "#f43f5e"
  brand-burgundy: "#97192c"
typography:
  body:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "0.875rem"
    lineHeight: 1.6
rounded:
  md: "8px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg}"
    rounded: "{rounded.md}"
    padding: "8px 20px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "8px 20px"
---

# Design System: chrono

## 1. Overview

**Creative North Star: "The Monospace Sync"**

The chrono visual identity is modeled after Cal.com and Vercel: a clean, high-performance, task-focused interface for developers and chapter leads. The layout utilizes a dark zinc base, sharp borders, clean layouts, and functional typography with a single primary accent role for brand burgundy (#97192c). The system rejects heavy gradients, rounded shapes exceeding 8px, and decorative animations.

**Key Characteristics:**
- **Task-First Clarity**: Components disappear to prioritize slot selection and team member availability inputs.
- **Sleek Dark Mode**: Deep black background (#09090b) paired with Zinc 900 (#18181b) sub-panels.
- **Micro-Interactions**: Hover, active, and focus states transition quickly (150–200ms) with ease-out cubic-beziers.

## 2. Colors

The color palette character is tech-minimalist, restrained, and structured around dark shades.

### Primary
- **Zinc Light** (#fafafa): Used for text, major buttons, and primary actions.

### Neutral
- **Ink Dark** (#09090b): The primary background color.
- **Muted Gray** (#a1a1aa): Secondary copy and label descriptors.
- **Border Zinc** (#27272a): Grid lines, card boundaries, and separator lines.

### Brand Accent
- **Brand Burgundy** (#97192c): Accent color representing the Bits&Bytes logo and identity, used only for critical status links, selected hosts, availability sliders, and focus highlights.

**The One Voice Rule.** Brand burgundy is used on ≤10% of any screen. Its rarity is the point.

## 3. Typography

**Body Font:** Plus Jakarta Sans (with system-ui, sans-serif fallbacks)
**Label/Mono Font:** Courier New (or Menlo, Monaco, monospace fallbacks)

**Character:** Modern geometric sans-serif paired with crisp, clean monospace indicators to convey engineering precision.

### Hierarchy
- **Display** (800 weight, 2.75rem, 1.2): Main page headers.
- **Headline** (700 weight, 2rem, 1.3): Major card headings.
- **Title** (600 weight, 1.15rem, 1.4): Cards and sub-headers.
- **Body** (400 weight, 0.875rem, 1.6): Paragraphs, descriptions, forms. Max line length 65–75ch.
- **Label** (500 weight, 0.75rem, 1.2, uppercase): Monospace details, table headers.

## 4. Elevation

The scheduler uses a flat/layered hybrid model. Depth is created via subtle border colors and backdrop-blurs rather than heavy drop shadows.

**The Flat-By-Default Rule.** Surfaces are flat at rest. Card backgrounds use a semi-transparent Zinc 900 tint (`rgba(24, 24, 27, 0.4)`) with backdrop filters to suggest layering without shadows.

## 5. Components

### Buttons
- **Shape:** Gently curved edges (8px radius).
- **Primary:** Zinc Light background with Ink Dark text.
- **Secondary:** Zinc 900 background with Border Zinc stroke.
- **Hover/Active:** Primary transitions to Zinc 200; secondary transitions to Zinc 800 with standard 150ms transition.

### Cards / Containers
- **Corner Style:** Rounded (8px).
- **Background:** Semi-transparent Zinc 900 (`rgba(24, 24, 27, 0.4)`) with `backdrop-filter: blur(8px)`.
- **Border:** 1px solid Border Zinc (#27272a).

### Inputs / Fields
- **Style:** Ink Dark background, Border Zinc border, 8px radius.
- **Focus:** 1px solid Brand Burgundy (#97192c) outline.

## 6. Do's and Don'ts

### Do:
- **Do** use strict 8px border-radius (`--radius: 8px`) for all containers and buttons.
- **Do** transition all state updates (hover, click, select) within 150-200ms using a standard ease-out curve.
- **Do** preserve monospace fonts for numbers, times, and timezone indicators.

### Don't:
- **Don't** use border-left/right greater than 1px as an accent stripe (violates product clean borders rule).
- **Don't** use text gradients or heavy background gradients.
- **Don't** use bouncy/springy animations for layout shifts.
