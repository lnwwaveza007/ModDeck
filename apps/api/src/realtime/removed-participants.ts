// Participants the host removed from a session (F13). The vote and word scripts check this set in
// the same atomic step that counts an answer, so an answer already on its way when the host
// pressed Remove cannot be counted after their answers were taken out. The socket handshake keeps
// a removed participant out for good; this set only closes that short window.
// All keys of one session share the hash tag {sid} (technical design §5.2).
export const removedKey = (sessionId: string) => `removed:{${sessionId}}`;
