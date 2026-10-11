# MD-6 Low-fidelity Wireframes (Release 1)

- **Ticket:** MD-6 · Sprint 1 · Track: UX
- **Blocked by:** MD-5 (done: `docs/ux/md-5-ia-and-flows.md`) · **Blocks:** MD-15
- **Figma file:** <https://www.figma.com/design/93tXP1BwSWwUnEtX2JCjmF> ("ModDeck R1 Low-fi Wireframes (MD-6)")
- **Status:** Wireframes drawn and fixed (section 6). Flow walkthrough done (section 3). Decisions recorded (section 4). Team review still needed (section 5).

## 1. File structure

| Page    | Content                                                                                   |
| ------- | ----------------------------------------------------------------------------------------- |
| Student | 21 phone screens (360 × 740) in 4 groups: Join, Activity tab, Q&A + reactions, connection + end |
| Host    | Deck editor, presenter control, audience screen (projector), session history and results  |
| Archive | Empty. Move replaced screens here instead of deleting them                                |

Each screen has an ID (S01, H05, P03 …), a title with its route, and short notes under it. Notes point to the MD-5 section or decision (Q-number) that the screen follows.

Style: grey boxes, Inter, no colour. Dashed boxes are placeholders (images, keyboard, QR, slide content). Emojis are written as words ("Like", "Clap") so the file has no font gaps.

## 2. Screen inventory

### Student (mobile)

| ID  | Screen                               | MD-5 source            |
| --- | ------------------------------------ | ---------------------- |
| S01 | Enter PIN `/`                        | 5.1, 5.2               |
| S02 | PIN error (invalid, too many tries, bad QR) | 6.4             |
| S03 | Choose identity `/j/:pin` + privacy line | 2.3, 2.4           |
| S04 | Guest nickname                       | 2.6                    |
| S05 | Cannot join (ended / full / removed) | 6.3, 6.5, 2.5          |
| S06 | Waiting: "Look at the screen"        | 3.2, Q5                |
| S07 | Live Poll: answer                    | 5.2                    |
| S08 | Live Poll: answer sent               | 5.2, rule 6            |
| S09 | Voting closed                        | 7.1                    |
| S10 | Poll results                         | 5.2, 7.1               |
| S11 | Word Cloud: input                    | 5.2, 2.6               |
| S12 | Word Cloud: results                  | 7.1                    |
| S13 | Q&A list (Popular / Recent / Mine, upvote) | 5.2, Q13         |
| S14 | Ask question: anonymous ON (default) | 2.4, Q4, Q7            |
| S15 | Ask question: name ON + preview      | 2.4, Q7                |
| S16 | Reaction bar (open)                  | 5.2, Q14               |
| S17 | Q&A closed                           | 6.6, 7.2               |
| S18 | Reconnecting banner                  | 6.2                    |
| S19 | Connection lost                      | 6.2                    |
| S20 | Host away banner + rename notice     | 6.2, 6.6               |
| S21 | Session ended                        | 6.3                    |

### Host (desktop) and projector

| ID   | Screen                                                      | MD-5 source       |
| ---- | ----------------------------------------------------------- | ----------------- |
| H01  | My decks `/decks` + New deck dialog                         | 3.1               |
| H02  | Deck editor: slide list, slide canvas, Live Poll panel      | 4.1, 4.2          |
| H03  | Deck editor: add slide panel + PDF import progress          | 4.2, F9           |
| H04  | Deck editor: Word Cloud, pre-flight dialog, live lock       | 4.2, 4.3, Q3, Q15 |
| H04b | Session settings drawer                                     | 3.1, Q2, Q14, Q17 |
| H05  | Presenter control: Live Poll live                           | 2.2, 4.1          |
| H06  | Presenter control: Word Cloud results, Q&A on screen, near full | 2.2, 6.5      |
| H07  | Activity control card: all states (component sheet)        | 7.1               |
| H08  | People drawer + co-host invite                              | 2.5, F12, F13     |
| H09  | End session (hold 2 s, 60 s Undo) + host away               | Q16, 6.2          |
| H10  | Mirror mode: presenter overlay (`Tab`)                      | 2.2, Q19          |
| H11  | Co-host Q&A page `/host/:sessionId/qa`                      | 2.5               |
| H12  | Session history `/sessions`                                 | 3.1               |
| H13  | Session results + export `/sessions/:sessionId`             | 4.2, Q8           |
| P01  | Audience: lobby (PIN, QR, join count)                       | 3.3               |
| P02  | Audience: content slide + join bar + reactions              | 3.3, Q14          |
| P03  | Audience: Live Poll voting open                             | 3.3, 7.1          |
| P04  | Audience: Live Poll results                                 | 3.3, 2.7          |
| P05  | Audience: Word Cloud results                                | 3.3               |
| P06  | Audience: Q&A question on screen                            | 3.3, 7.2          |
| P07  | Audience: session ended / blank                             | 3.3               |

## 3. Flow walkthrough

Each MD-5 flow, step by step, with the screen that shows it.

**Host main flow (4.1):** login (SSO, external) → H01 → New deck dialog (H01) → H02 / H03 (add content, PDF, activities) → H04 (pre-flight) → Start session → H05 + P01 lobby → present P02 → activity slide: H07 Draft → Start → H05 Live / P03 → Close → Show results: H06 / P04 / P05 → Q&A any time (H05 panel, P06) → reactions any time (H05 toggle, P02) → End session H09 → H13 results → Export (H13). **Complete.**

**Student main flow (5.1):** QR (`/j/:pin`) or S01 → PIN check: S02 / S05 → S03 → KMUTT SSO (external) or S04 → S06 → Live Poll S07 → S08 → S09 → S10; Word Cloud S11 → S12 → Q&A S13 → S14 / S15 → reactions S16 → S21. **Complete.**

**Edge cases (6):** late join uses S06 / S07 / S09 / S10 (no new screen). Disconnect: S18, S19. Host disconnect: S20 (student), H09 (host), H11 take-over (co-host), H12 Rejoin. Session ended: S21, S05 A, P07. Invalid PIN: S02. Session full: S05 B, H06 warning. Q&A off: S17. Rename / remove: H08, S20, S05 C. PDF import failure: H03. Locked activity: H04. **Complete.**

**Acceptance check: host runs all activities from one screen.** Yes. H05 / H06 hold slide control, the activity card (H07 shows every state for both activity types), session toggles (reactions, Q&A, auto-start), Q&A panel, people, co-host invite and End session. Mirror mode (H10) gives the same controls by keyboard. The host never leaves presenter control during a session. Confirm in the team review.

### 3.1 Missing screens found in the walkthrough

| Gap | Action |
| --- | ------ |
| SSO login error page (host and student, "Try again" / "Join as guest") | Not drawn. Waits for MD-7 (SSO). Notes on S03 and H01 say where it goes |
| Editor Preview (projector / phone) | Only the toggle under the canvas (H02). Preview reuses P03 and S07, so no new screen |
| Account menu (profile, log out) | Not drawn. Standard dropdown |
| Live Poll multiple-choice variant on phone | Note on S07 only. Draw in hi-fi (MD-15) |
| Audience screen: Live Poll Closed (results hidden) | Note on P04 only |

## 4. Decisions (2026-10-12)

These came up while drawing the wireframes. They were not decided in MD-5, or differ from the ticket. Decided by the product owner on 2026-10-12 and added to MD-5 section 8 (Q19, Q24–Q27).

| # | Point | Decision |
| - | ----- | -------- |
| 1 | **Timer.** The ticket asks for a timer; MD-5 puts the countdown timer in R2 | Elapsed **session clock** only (H05, H10). Countdown stays in R2 (Q24) |
| 2 | **Hide one word in Word Cloud** (H06, H07) | Keep (Q25) |
| 3 | **"Go to next activity"** on the content-slide state of the activity card (H07) | Keep (Q26) |
| 4 | **Mirror mode (one display)** | Keep the MD-5 design. Known limit accepted (section 4.1) |
| 5 | **Overlay key** | `O` instead of `Tab`, so `Tab` stays free for keyboard focus (Q19) |
| 6 | **"+ React" on phones** | Always visible while reactions are on, on waiting and activity screens. Hidden only while the keyboard is open (Q27) |

### 4.1 Mirror mode (one display)

With a mirrored display the projector shows everything on the laptop. The audience also sees the overlay (H10) and the Q&A panel when the host opens it. The overlay shows status only; the host controls the session with keyboard shortcuts.

Decision: keep this design for R1 and accept the limit. Hosts who need private Q&A moderation use two displays (extend mode) or a co-host (H11).

Not chosen for R1 (ideas for later): phone as remote, audience screen on the room PC, window share for online classes, overlay that shows counts only.

Still open: mirror mode has no shortcut for End session (needs a 2 s hold on a button), Reopen, people or settings. Add shortcuts in hi-fi (MD-15), or the host leaves mirror mode for these actions.

## 5. Team review

Agenda (30 min): walk the host flow on the Host page, walk the student flow on the Student page, then go through section 3.1 and section 4.

- [ ] Host can run all activities from presenter control without switching screens (two displays; one display has the limit in 4.1)
- [ ] Every screen in the MD-5 sitemap has a wireframe or a note in section 3.1
- [x] Section 4 points decided
- [x] Known layout fixes done (section 6)

| Name                      | Reviewed | Comments |
| ------------------------- | -------- | -------- |
| จรณะ สุขโรจน์             | [ ]      |          |
| ภัทร์ทัศน์ จิรธรรมานุวัตร | [ ]      |          |
| อภิวิชญ์ พิศาลอัครเลิศกุล | [ ]      |          |

## 6. Layout and content fixes (done 2026-10-12)

A UI check after the first pass found these problems. All are fixed in Figma.

| Screen   | Fix                                                                          |
| -------- | ---------------------------------------------------------------------------- |
| H08      | Dimmed presenter area behind the drawer fills the left side                  |
| H03      | Removed the slide 7 thumbnail so the PDF import box is not clipped           |
| H01      | New deck dialog height set to Hug                                            |
| H07, H09 | Sheet height set to Hug (no empty space)                                     |
| H10      | Audience screen placeholder fills the frame (full screen)                    |
| H04      | Removed the disabled "Start session" button from the pre-flight dialog       |
| H11      | "Take over this session" is a real button in the banner                      |
| H05, H06 | "Hold to end session" is an outline button, different from primary actions  |
| P04, P05 | Added the join corner bar, same as the other projector slides                |
| S04      | Placeholder says "Keyboard" (a nickname needs a text keyboard)               |
| S08      | Removed "Change answer". Students tap another option to change their answer  |
| S12      | Note no longer says "underlined"                                             |
| S13      | Math shows rendered (2¹⁰), not raw `$...$`                                   |
| S16      | Note no longer mentions a close × that is not drawn                          |
| S21      | Removed the answer count (not in MD-5)                                       |
| Archive  | Added a note: move replaced screens here                                     |

Kept on purpose: S18 and S20 both put system banners above the header. H03 says "Edit slide" because a content slide is selected; H02 and H04 say "Edit activity" because an activity slide is selected.
