# Security Model

- Admin authentication: email + password + email OTP/2FA.
- No automatic inactivity logout.
- Supabase RLS enabled on all exposed tables.
- Privileged operations run server-side with protected credentials.
- Participants cannot read other participants' answers or unreleased scores.
- Projector sessions cannot access participant-private data.
- Media is private and delivered through controlled/signed access.
- Integrity events include visibility/tab changes, reconnects and round termination.
- Audit events record actor, action, timestamp, event and relevant before/after values.
- No camera/microphone/screen recording is required.
- Screenshot prevention is mitigation only; it cannot be guaranteed on the web.
