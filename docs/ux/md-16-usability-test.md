# MD-16 Clickable Prototype and Usability Test

- **Ticket:** MD-16 (Jira MOD-21) · Sprint 3 · Track: UX
- **Blocked by:** MD-12 (Jira MOD-15, status **Skipped**), MD-15 (hi-fi canvas) · **Blocks:** MD-19
- **Prototype:** <https://claude.ai/artifact/18cVic9CazqBazgMyDQwHK> ("ModDeck R1 Hi-fi (MD-15)"), pages **Student** and **Host**. The prototype is built on the hi-fi canvas, not in Figma.
- **Status:** Prototype linked (section 1). Test plan, script, note template and severity scale written (sections 2–6), because MD-12 was skipped. Pilot, sessions and findings are not done yet (sections 7–8).

## 1. Prototype

Both flows run in the canvas Play mode. Open the page, select the start screen, and press Play. Play full window for the test.

| Flow    | Page    | Start screen        | Screens linked |
| ------- | ------- | ------------------- | -------------- |
| Student | Student | S01 Enter PIN       | S01, S03, S04, S06, S07, S08, S10, S11, S12, S13, S14, S15, S21 |
| Host    | Host    | H00 Host sign-in    | H00, H01, H02, H03, H04, H04b, H05, H06, H09, H12, H13 |

### 1.1 Student path

S01 Enter PIN → S03 Choose identity → S04 Guest nickname (or KMUTT, which skips to S06) → S06 Waiting → S07 Live Poll → S08 Answer sent → S10 Poll results → S11 Word Cloud → S12 Word Cloud results → S21 Session ended.

- The **Q&A** tab opens S13 from every activity screen. S13 **Ask** → S14 → **Send** returns to S13. **Preview** on S14 opens S15.
- Steps that the lecturer starts (poll opens, voting closes, next activity) have no button for the student. **The participant taps the Activity tab** to move on. The moderator says when (section 4).
- Working controls inside a screen: poll options on S07, upvote on S13, anonymous switch on S14.

### 1.2 Host path

H00 Sign in → H01 My decks → (New deck → Create → H03 Add slide + PDF import) → INT365 บทที่ 4 title → H02 Editor → Session settings (H04b) → Start session → H04 Pre-flight → H05 Presenter → Next / Open Q&A → H06 Presenter + Q&A → End session → H09 → View results → H13 Results.

- **H01:** the New deck dialog now opens from the **เด็คใหม่** button. It was always open in the static comp. The Tweaks panel has a `dialog` switch to show it open on the canvas.
- **H04:** Start session is disabled while slide 9 has a problem. **ไปแก้** marks the slide fixed (a shortcut, the real fix happens in the editor). Then **เริ่มเซสชัน** opens H05.
- **H05:** **ปิดโหวต** and **แสดงผล** change the activity state on the screen.
- **H06:** **แสดงบนจอ**, **ตอบแล้ว**, **ซ่อน** and **เอาออกจากจอ** work. Counts on the filter tabs change.
- **H13:** **ดาวน์โหลด ZIP** shows a "downloaded" message.

### 1.3 Known gaps

Tell the participant about these only if they get stuck. Do not log them as findings.

- Hold-to-end is a single click.
- H13 shows the บทที่ 3 session, not the session that just ended.
- H01 shows บทที่ 4 as live before the host starts it.
- H03 (new deck) Start session is not linked. The host flow continues from the บทที่ 4 deck.
- Text inputs accept typing, but the next screen always shows the comp text.
- S08, S10 and S12 always show the comp answers (JavaScript, "FormGroup", "ตรวจสอบข้อมูล"). The tasks ask for JavaScript so that S10 matches.
- Settings switches on H04b and H02 do not toggle.
- The projector screens are not part of the prototype. Show P03/P04 on a second screen if a host asks what students see.

### 1.4 Edits made to the hi-fi comps

- Buttons that move to another screen are now links with the same style.
- S01: the 6th PIN box had a stray Thai vowel ("ิ"). It is now "4", which matches PIN 482 914 on S03. The Join button is now enabled.
- S07: no option is picked when the screen opens, so the participant makes the choice. The comp showed JavaScript picked. The disabled "เลือกคำตอบก่อนส่ง" button shows until an option is picked.

## 2. Test goals

1. A first-time student can join a session as a guest in **60 s or less**, without help.
2. A student can answer a Live Poll and send a Word Cloud word, and knows that the answer was sent.
3. A student can ask a question **anonymously** and knows who can see their name.
4. A new instructor can start a session and open a poll in **2 minutes or less** (MD-12 example goal), including the pre-flight check.
5. An instructor can control a live activity (close voting, show results, next) and moderate Q&A without help.
6. An instructor can end a session and get the results file.

## 3. Participants

| Group                 | Target | Source                                    | Flow    |
| --------------------- | ------ | ----------------------------------------- | ------- |
| Students              | 3–5    | Proposal interviewees first, then classmates | Student |
| Instructors or TAs    | 2–3    | Proposal interviewees first               | Host    |
| Backup                | 1–2    | Any group                                 | Either  |

- MD-12 was skipped, so nobody is booked yet. Book slots before the pilot. The ticket expects sessions on Sprint 3 day 3–4.
- Do not use team members as participants. A team member is the pilot only.
- Session length: about 25 min for a student, 35 min for a host.

## 4. Roles and setup

- **Moderator** reads the script, gives tasks, and moves the student flow on ("the lecturer has opened a poll").
- **Note-taker** fills the note template (section 6) and times each task. The note-taker does not talk to the participant.
- **Device:** student flow on a phone if possible, else a laptop browser at phone size. Host flow on a laptop.
- **Access:** the canvas is private. The moderator signs in and starts Play before the participant sits down, or shares the canvas from its Share menu.
- **Reset** between participants: close Play and start again from S01 or H00. This resets all state.
- **Recording:** only with consent. Screen and audio, no face.

## 5. Script

Read the text in quotes. The text can be read in Thai or English.

### 5.1 Intro and consent (3 min)

> "Thank you for helping us. We are testing a design for ModDeck, a classroom tool for polls, word clouds and Q&A. We test the design, not you. You cannot make a mistake. If something is hard, that helps us fix the design.
>
> This is a prototype. Some buttons do not work. If nothing happens, tell us what you expected.
>
> Please think aloud: say what you look at, what you try, and what you expect.
>
> Can we record the screen and your voice? Only the team sees the recording, and we delete it after the project. You can stop at any time."

Write down: consent yes/no, recording yes/no.

### 5.2 Warm-up questions (2 min)

- Students: "Which tools have you used in class to answer polls or ask questions? What was good or bad?"
- Hosts: "How do you get students to take part in a lecture today? Which tools have you used?"

### 5.3 Student tasks

Give one task at a time. Start the timer when you finish reading. Stop it when the success screen shows, or when the participant gives up.

| # | Task (read aloud) | Success when | Target |
| - | ----------------- | ------------ | ------ |
| ST1 | "You are in a lecture. The screen shows PIN 482 914. Join the class. You do not want to sign in." | S06 Waiting shows | ≤ 60 s |
| ST2 | Moderator: "The lecturer opens a poll now. Tap Activity." Then: "Answer the poll. Choose JavaScript." | S08 Answer sent shows | ≤ 45 s |
| ST3 | "Is your answer counted? How do you know? Can you still change it?" (verbal, do not change it) | Says it was sent and that tapping another option changes it | ≤ 30 s |
| ST4 | Moderator: "Voting is closed. Tap Activity." Then: "How many people chose the same answer as you?" | Says "24" or reads it from S10 | ≤ 30 s |
| ST5 | Moderator: "Next activity. Tap Activity." Then: "Send one word that you think of for Reactive Forms." | S12 shows | ≤ 45 s |
| ST6 | "You have a question for the lecturer, but you do not want classmates to know it is you. Ask it." | S13 after Send from S14 with the switch on | ≤ 60 s |
| ST7 | "Someone already asked a question you also want answered. Show the lecturer that you want it too." | Upvote on S13 pressed | ≤ 30 s |

After each task ask: "How easy was that, from 1 (very hard) to 7 (very easy)?"

### 5.4 Host tasks

| # | Task (read aloud) | Success when | Target |
| - | ----------------- | ------------ | ------ |
| HT1 | "Sign in. Create a new deck for chapter 5, Routing. You have the slides as a PDF." | H03 with the PDF import shows | ≤ 90 s |
| HT2 | "Go back to your decks. Open the chapter 4 deck, Reactive Forms. Find out if students can ask questions without their name." | Opens H04b and reads "อนุญาตถามแบบไม่ระบุชื่อ: on" | ≤ 60 s |
| HT3 | "Start the class session now." | H05 Presenter shows (the pre-flight problem is fixed on the way) | ≤ 2 min |
| HT4 | "Most students have voted. Stop the vote and show the result to the class. Then go to the next slide." | Voting closed, results shown, H06 shows | ≤ 60 s |
| HT5 | "A student asks about group projects. Put that question on the screen. Then mark it answered." | Question on screen, then gone from "ยังไม่ตอบ" | ≤ 60 s |
| HT6 | "The class is over. End the session and download the results." | H13 "downloaded" message shows | ≤ 90 s |

After each task ask the 1–7 ease question.

### 5.5 Follow-up questions (5 min)

- "What was the hardest part? Why?"
- "Was anything different from what you expected?"
- Students: "When you asked the question, who could see your name?"
- Hosts: "Would you use this in your next lecture? What would stop you?"
- "Is there anything you would change first?"

### 5.6 Close

> "Thank you. That is all. Your feedback helps us a lot."

## 6. Note template and severity

Copy one block per participant into the session notes.

```text
Participant: P_  Group: student / host  Date:  Device:
Moderator:  Note-taker:  Consent: Y/N  Recording: Y/N

Task | Result (S / SH / F) | Time | Ease 1–7 | Errors and path | Quotes
ST1  |                     |      |          |                 |
...

Result: S = success, SH = success with help, F = fail or gave up.
Other observations:
```

### 6.1 Severity scale

| Level | Name     | Use when |
| ----- | -------- | -------- |
| 4     | Blocker  | The participant cannot finish the task, or does the wrong thing and does not notice (for example, asks a question with their name and thinks it is anonymous). |
| 3     | Major    | The participant finishes only with help, or loses a lot of time, or is very unsure. |
| 2     | Minor    | The participant hesitates or makes an error but recovers alone. |
| 1     | Cosmetic | Wording, look, or a comment, with no effect on the task. |

If two or more participants hit the same issue, raise the level by one (maximum 4). Write how many participants hit each issue, for example 3/5.

## 7. Run log

| Step | Date | Who | Status |
| ---- | ---- | --- | ------ |
| Pilot with a team member, then fix this script | | | Not done |
| Student sessions (3–5) | | | Not done |
| Host sessions (2–3) | | | Not done |
| Findings grouped and ranked (section 8) | | | Not done |
| Top findings presented to the team | | | Not done |

## 8. Findings

Fill this after the sessions. One row per issue, ranked by severity, then by number of participants. MD-19 takes all severity 3–4 rows. Severity 1–2 rows become Release 1 backlog items.

### 8.1 Task results

| Task | Success | Success with help | Fail | Median time | Median ease |
| ---- | ------- | ----------------- | ---- | ----------- | ----------- |
| ST1  |         |                   |      |             |             |
| ST2  |         |                   |      |             |             |
| ST3  |         |                   |      |             |             |
| ST4  |         |                   |      |             |             |
| ST5  |         |                   |      |             |             |
| ST6  |         |                   |      |             |             |
| ST7  |         |                   |      |             |             |
| HT1  |         |                   |      |             |             |
| HT2  |         |                   |      |             |             |
| HT3  |         |                   |      |             |             |
| HT4  |         |                   |      |             |             |
| HT5  |         |                   |      |             |             |
| HT6  |         |                   |      |             |             |

### 8.2 Issues

| ID | Severity | Participants | Screen | Task | Issue | Evidence (quote) | Proposed fix | MD-19 or backlog |
| -- | -------- | ------------ | ------ | ---- | ----- | ---------------- | ------------ | ---------------- |
|    |          |              |        |      |       |                  |              |                  |

## 9. Acceptance criteria

- [x] Clickable prototype for host and student flows. Built on the hi-fi canvas instead of Figma.
- [ ] Test sessions run with MD-12 participants. Blocked: MD-12 was skipped, so participants must be recruited first.
- [ ] Findings ranked by severity.
