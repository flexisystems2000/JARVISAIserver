# WhatsApp transport and rich-message integration status

Updated: 2026-11-19

## Active transport retained

JARVIS now starts one authenticated WhatsApp socket using `plogme@2.2.8` (loaded dynamically from the existing CommonJS entry point). The same socket is used for ordinary messages, rich replies, group events and Channel quiz publishing. This avoids competing socket connections against the same multi-file authentication state.

## Already integrated in this source tree

- `rich-renderer.js` is called by the central assistant-reply path in `index.js`.
- The renderer uses Plogme `sock.sendRichText()` for Markdown prose, fenced code and tables, with an ordinary-text fallback when that method is unavailable.
- `quizEngine.js` sends newsletter quiz polls with `pollType: 1` and the correct option metadata.
- `channelQuizScheduler.js` retains the persisted Lagos-time quiz timetable; its questions and answer replies use the existing socket.
- The `!channelquiz` manual command and `!channelquiz off` remain in place.

## Plogme primary transport

Plogme is a Baileys transport fork, not a helper that can safely be loaded beside the active socket. The npm package has a confirmed malicious-package advisory for versions 1.0.0–1.0.3: those releases silently followed publisher-controlled WhatsApp Channels and transmitted a machine fingerprint when the socket connected (GitHub Advisory GHSA-q276-hmjg-47qw; OSV MAL-2026-16199). Security scanners have also flagged at least one later 1.x build. Newer 2.x releases are not established as safe merely because they are outside the exact versions in the original advisory; the exact tarball, transitive dependencies, lifecycle scripts, socket connection code and outbound network calls still need a source-level audit.

This release pins `plogme` to the exact v2.2.8 release (no floating semver range). The previously advisory-affected versions 1.0.0–1.0.3 are not used. Plogme is the sole authenticated socket transport. `@itsliaaa/baileys` remains installed only as a compatibility helper for poll-vote aggregation; JARVIS does not start a second Itsliaaa socket. The package tarball could not be downloaded in this build environment, so full local source/tarball and dependency-tree audit plus live runtime validation remain deployment-stage checks. Do not treat the exclusion of the four advisory-listed versions as a blanket security certification of v2.2.8.

## ChannelQuiz: identified as a Telegram-only service

The public ChannelQuiz service found during the project review is the Telegram bot `@channelquizbot` / `@ChannelQuiz`, described as a tool for creating interactive quiz and poll posts in Telegram Channels. It is not a Baileys library, npm transport, or WhatsApp integration, so there is no external ChannelQuiz code to install into this WhatsApp bot. Reference: https://channelquiz.io/ and https://t.me/channelquiz.

The WhatsApp equivalent is already implemented directly in JARVIS and does not require that Telegram service: `quizEngine.fireChannelQuiz()` publishes native WhatsApp newsletter quiz polls (`pollType: 1`, correct option metadata); `!channelquiz <subject>` starts the manual publisher; `!channelquiz off` stops it; and `channelQuizScheduler.js` runs the persisted Flexi Channel timetable in `Africa/Lagos` time. The existing tests cover native poll payloads, the answer not being leaked into the public Channel post, scheduled answer replies, and stopping a manual quiz. The Plogme socket remains responsible for delivery; the existing quiz scheduler and native newsletter poll payloads are preserved.

## Rich-message feature mapping

The requested Meta AI-style response presentation is handled through JARVIS's own `rich-renderer.js` and Plogme `sendRichText()`: prose, Markdown tables and fenced code blocks are sent in one Markdown-capable rich envelope. Unsupported transports fall back to ordinary text. Full interactive HTML, arbitrary web-app screens, and every experimental Plogme envelope are not claimed as implemented by this renderer.

## Integration rule

Do not run multiple Baileys transports against the same WhatsApp account/session. The Plogme primary transport must be tested in staging and run regression checks for login/reconnect, group-admin detection, normal messages, rich messages, newsletter quiz creation, quiz updates, scheduler persistence and message-history persistence before deployment.
