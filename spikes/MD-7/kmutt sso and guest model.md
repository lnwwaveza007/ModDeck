## 1. KMUTT SSO Check

### Method
1. Registered the application in Microsoft Azure as a **Single Tenant** application (KMUTT only).
2. Configured Postman to use **OAuth 2.0 Authorization Code Flow with PKCE**.
3. Signed in with a KMUTT account through the browser.
4. Successfully received an ID token.

## Result
<video controls width="640">
  <source src="./Kmutt%20SSO%20Check.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

[Watch the demo video](./Kmutt%20SSO%20Check.mp4)

## 2. Guest Identity Model: Anonymous Session

### Decision
Use an **anonymous, session-based guest access model**. Attendees can join a room using a join code or QR code without creating an account or logging in.

### How It Works
1. **Join a Room:** Attendees enter a join code or scan a QR code.
2. **Create a Guest Session:** The server generates a temporary guest ID and session token associated with the room.
3. **Track Participation:** The system stores attendee progress and answers against the guest session.
4. **Handle Reconnection:** Session state is maintained server-side, while a cookie stores the session token to support page refreshes and brief disconnections.
5. **Expire the Session:** The token becomes invalid when the session expires or the room session ends.

### Why This Model?

| Reason | Explanation |
|---|---|
| **Low Friction** | Attendees can join within seconds without registration or login. |
| **Inclusive Access** | Supports external guests and participants without KMUTT accounts. |
| **Simple and Scalable** | Avoids account management and supports large audiences. |
| **Secure by Design** | Short-lived, room-scoped tokens limit the impact of token exposure. |

### Security Considerations
- Generate session tokens using cryptographically secure randomness.
- Store tokens in cookies with `HttpOnly`, `Secure`, and an appropriate `SameSite` policy.
- Validate room access on every guest request.
- Store answers and progress server-side rather than relying solely on cookies.
- Invalidate sessions when they expire or the room session ends.
- Apply rate limiting to join-code attempts.
