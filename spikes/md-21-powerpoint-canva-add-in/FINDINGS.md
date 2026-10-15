# Spike Findings Note: MD-21 PowerPoint and Canva Add-in

- **Ticket:** MD-21
- **Track:** Spike (Technical Feasibility)
- **Status:** Completed on PowerPoint for Windows. PowerPoint on the web and Mac not tested
- **Date:** October 15, 2026
- **Authors:** ModDeck Team

---

## 1. Goal and Pass Criteria

### Goal

Prove that a ModDeck poll or quiz can be **shown live on a teacher's slide**. The add-in only displays the poll. It does not create or edit polls. (Scope agreed with Wave.)

### Pass criteria

- [x] A poll view shows on a slide and updates live during slideshow (Windows desktop)
- [x] It still works after the deck is reopened (Windows desktop)
- [x] Sign-in / access path is defined (§5)
- [x] Canva: a clear yes/no with limits and a fallback (§6)

### Out of scope

Reading slide text, editing polls from the add-in, Google Slides.

---

## 2. Setup

| Item       | Choice                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| Add-in     | PowerPoint **content add-in** (`xsi:type="ContentApp"`), add-in only XML manifest                            |
| Server     | `server.mjs`: Node + Socket.IO 4.8, in-memory votes. HTTPS :3021 (add-in), HTTP :3022 (phones)               |
| Messages   | MD-2 schema: `join`, `vote`, `reset_votes` → `joined`, `user_joined`, `vote_update`, `error`                 |
| Poll view  | `public/poll.html`. Read-only: it joins the room and listens. It never sends `vote`                          |
| Vote page  | `public/vote.html`, opened from a QR code on the slide                                                       |
| Saved data | Poll PIN in `Office.context.document.settings`, which is stored per add-in instance inside the deck          |

**Why a content add-in, not a task pane.** A task pane sits beside the slide and is not shown to the audience. A content add-in is a web view placed _on_ the slide, and it keeps running in slideshow. That is what "show our poll on the slide" needs.

**Why a mock server, not MD-2.** This spike tests the add-in, not the server; MD-2 already proved the server. The mock runs as one process with no Redis, and it includes a phone vote page that MD-2 does not have. Because it uses MD-2's event names and payloads, the poll view can point at the MD-2 gateway without changes.

---

## 3. What was checked

### 3.1 Automated (done)

| Check                                                              | Result |
| ------------------------------------------------------------------ | ------ |
| `office-addin-manifest validate manifest.xml`                      | Valid  |
| `GET /api/polls/:pin` returns question and options                 | Pass   |
| QR code served as SVG                                              | Pass   |
| Read-only "slide" client gets `vote_update` when a "phone" votes   | Pass   |
| Vote count goes up by exactly one                                  | Pass   |
| Invalid PIN rejected with `INVALID_PIN`                            | Pass   |
| Vote → slide update time, same machine                             | ~1 ms  |
| Path traversal (`/../server.mjs`) blocked                          | 404    |

The validator lists these platforms for the manifest: PowerPoint on the web, Windows (2013 and later, Microsoft 365), Mac (2016 and later, Microsoft 365) and iPad. This is based on the manifest only, not on runtime calls.

### 3.2 In PowerPoint

Run by the team on PowerPoint for Windows (Microsoft 365), voting from a phone over the QR code.

| Test                                   | Windows desktop | PowerPoint on the web | Mac |
| -------------------------------------- | --------------- | --------------------- | --- |
| Poll shows in edit view                | Pass            | Not tested            | Not tested |
| Poll shows in slideshow                | Pass            | Not tested            | Not tested |
| Live update while presenting           | Pass            | Not tested            | Not tested |
| Same poll after reopening the deck     | Pass            | Not tested            | Not tested |
| Two slides keep two different polls    | Not tested      | Not tested            | Not tested |
| Reconnects after the server restarts   | Not tested      | Not tested            | Not tested |

**Slide-load delay in slideshow.** In the first build, moving to the poll slide with F5 was slow, and sometimes the poll only appeared after going back one slide and forward again. Two changes made it acceptable to the tester:

1. The poll (question, options, QR code) is cached in the deck, so it draws without waiting for the network. The live socket connects in parallel.
2. The view reports load timings to the server terminal (`[load]` lines).

In a browser the page is ready in about 80 ms once Office.js is cached, and about 600 ms on a cold load. Most of the remaining delay in slideshow is PowerPoint starting the add-in for the slide, which the page cannot control. A release should test this with a long deck and on the lecture-room PC.

### 3.3 Why this was expected

- **Live in slideshow.** Microsoft describes content add-ins as surfaces embedded in the document that display data from a data source. Shipped products already rely on this: the Power BI add-in stays interactive in edit and slideshow mode, and AhaSlides shows live polls in slideshow through an add-in.
- **Reopen.** `document.settings` is saved in the deck for that add-in instance. Each slide's add-in keeps its own PIN.
- **Watch for:** on Windows and Mac, a content add-in can be shown as a saved image (snapshot) instead of live content. On the web, "Show as saved image" is not supported and the add-in stays interactive. On Windows the poll came back after reopening.

---

## 4. Design notes from the build

- **Slideshow detection works through Office.js.** `getActiveViewAsync` returns `read` in slideshow and `edit` while editing, and `ActiveViewChanged` fires on the switch. The poll view hides its "Change poll" link in slideshow, so the audience sees only the poll.
- **Read-only by design.** The poll view has no vote or edit controls. Choosing the poll (typing the PIN) is the only teacher action, and only in edit view.
- **HTTPS is required.** PowerPoint only loads add-ins over HTTPS. Locally that means Office dev certificates; in production it is the normal ModDeck domain.
- **Phones need a reachable URL.** A laptop IP works on home Wi-Fi. Campus Wi-Fi often blocks device-to-device traffic, so the demo may need a tunnel. In production, phones use the public ModDeck URL, so this is a demo issue only.
- **Fixed 16:9 stage.** The poll is drawn on a 1600×900 stage scaled to the add-in frame, so it never scrolls and looks the same at any frame size. Styling uses the MD-11 tokens (KMUTT orange, chart colors per answer).
- **Permissions.** The manifest asks for `ReadWriteDocument` so it can save the PIN. A release should check whether a lower level is enough.

---

## 5. Sign-in / access path

**The slide needs no sign-in.** The poll view loads a poll by its 6-digit PIN, the same way students join under the MD-7 guest model (join code or QR, no account). This is acceptable because everything on the slide is already shown on the projector, including the PIN.

**Teacher sign-in comes later.** It is only needed when the add-in shows the teacher's _own_ list of polls instead of asking for a PIN. Then:

1. Use KMUTT SSO from MD-7 (Entra single-tenant, Authorization Code + PKCE).
2. Run it in a pop-up with the Office dialog API (`Office.context.ui.displayDialogAsync`). Microsoft's login page does not load inside an add-in iframe.
3. Office's built-in SSO (`getAccessToken`) could skip the pop-up, because KMUTT accounts are Entra accounts. It needs extra manifest setup and admin consent from KMUTT IT, so treat it as an option to check, not the plan.

**Risks:** a PIN can be guessed, so anyone could watch a poll's live results. The MD-7 rules cover this: short-lived rooms, rate-limited join attempts. Votes must still be checked server-side against the guest session.

---

## 6. Canva

### Verdict: **No**, Canva cannot show a live ModDeck poll inside a design today.

| Question                                   | Answer                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Can a Canva app add elements to a design?  | Yes: text, images, shapes, video and embeds (`addElementAtPoint`)                                                                                            |
| Can it embed a live web page?              | **No.** Embeds must be URLs supported by **Iframely**. Canva's docs: "Iframely can't embed arbitrary HTML files. It can only embed media supported by its API" |
| Can ModDeck become a supported embed?      | Maybe. Iframely keeps a domain whitelist, and adding a domain is a manual review by Iframely. Outside our control, no timeline                              |
| Do embed changes update in the design?     | Canva's docs say changes to the original media "are not immediately reflected" in the design                                                                 |
| Can a Canva app read page content?         | Yes, with the Design Editing API (`openDesign`). Only for designs with absolute pages (presentations count); docs and whiteboards are not supported         |

### Fallback that works

A Canva app adds the **session QR code and link** (an image plus text) to the slide. Students scan it and vote on their phones. The live results show on the ModDeck presenter screen, not inside Canva.

### Limits to know

- A live poll on the Canva slide depends on Iframely whitelisting ModDeck. That is an external process, so don't plan a release on it.
- A Canva app has to pass Canva's app review before other teachers can install it. _(Check the current review rules before the release phase.)_
- Canva has merged the Apps SDK into the "Canva Developers SDK", and some doc pages disagree about what is in preview. Check the current docs before building.

This verdict comes from Canva's docs. No Canva app was built in this spike.

---

## 7. Verdict

| Platform   | Verdict                                                              |
| ---------- | -------------------------------------------------------------------- |
| PowerPoint | **Pass** on Windows desktop. Web and Mac still to test               |
| Canva      | **Fail for a live poll.** QR/link fallback only                      |

## 8. Recommendation for the add-in release phase

1. **Ship PowerPoint first** as a read-only content add-in: the teacher inserts it, picks a poll, and it shows live in slideshow.
2. **Point it at the real gateway** (MD-18, MD-2's Socket.IO schema). The poll view needs only the server URL changed.
3. **Add teacher sign-in** only when the add-in lists the teacher's polls (§5). Use the dialog API.
4. **Canva:** release a small app that adds the session QR code and link. Ask Iframely about whitelisting as a long-term option, but don't depend on it.
5. **Distribution:** decide between AppSource (public listing, Microsoft review) and KMUTT IT deploying the add-in centrally. Central deployment is faster for a single university.

---

## Sources

- Microsoft, [Content Office Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/design/content-add-ins)
- Microsoft, [Persist add-in state and settings](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings)
- Microsoft, [Power BI in PowerPoint: view and present](https://learn.microsoft.com/en-us/power-bi/collaborate-share/office-integration/service-power-bi-powerpoint-add-in-view-present)
- AhaSlides, [Using the PowerPoint add-in](https://docs.ahaslides.com/integrations/using-powerpoint-s-ahaslides-add-in.md)
- Canva, [Embedding rich media](https://www.canva.dev/docs/apps/embedding-rich-media/)
- Canva, [Design Editing API](https://canva.dev/docs/apps/design-editing)
- Canva community, [Design Editing API is generally available](https://community.canva.dev/t/solstice-of-surprises-design-editing-api-is-out-of-preview-and-now-generally-available/7599)
- Iframely, [Whitelist file format](https://iframely.com/docs/whitelist-format)
