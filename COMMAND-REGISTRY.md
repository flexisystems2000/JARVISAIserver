# JARVIS WhatsApp Command Registry

**Agent-visible command entries: 57**

The Agent registry is derived from the existing WhatsApp command inventory and routes each entry through the existing WhatsApp message handler. Group-management commands remain available to WhatsApp users through their existing handlers but are intentionally excluded from Agent discovery and execution tools.

## Agent-visible commands

| ID | Command | Description |
|---|---|---|
| `ai` | `!ai` | Answer a question using JARVIS AI. |
| `quiz` | `!quiz` | Start a group quiz for a subject. |
| `quiz_off` | `!quiz off` | Stop the active quiz. |
| `stopquiz` | `!stopquiz` | Stop the active quiz. |
| `command` | `!command` | Show Command Inventor usage. |
| `command_list` | `!command list` | List saved custom commands. |
| `command_create` | `!command create` | Propose a safe custom command for approval. |
| `timetable` | `!timetable` | Retrieve a department timetable. |
| `image` | `!image` | Generate an image from a prompt. |
| `vv` | `!vv` | Retrieve view-once media from a quoted message. |
| `createfile` | `!createfile` | Generate a document or study file. |
| `create_document` | `!create document` | Alias for document creation. |
| `generate_pdf` | `!generate pdf` | Alias for PDF creation. |
| `create` | `!create` | Document-creation command alias; provide a document request. |
| `generate` | `!generate` | Document-generation command alias; provide a document request. |
| `crawl` | `!crawl` | Inspect a public website and capture a screenshot. |
| `sitecheck` | `!sitecheck` | Check whether a public website is reachable. |
| `translate` | `!translate` | Translate text between languages. |
| `yt_search` | `!yt search` | Search YouTube. |
| `yt_video` | `!yt video` | Find and send a YouTube video. |
| `yt_audio` | `!yt audio` | Find and send YouTube audio. |
| `yt_download` | `!yt download` | Download a YouTube video by ID. |
| `video` | `!video` | Generate a video from a prompt. |
| `video_status` | `!video status` | Check the latest video generation status. |
| `remind` | `!remind` | Create a reminder with a duration and message. |
| `reminders` | `!reminders` | List pending reminders in this chat. |
| `cancelreminder` | `!cancelreminder` | Cancel a reminder by its ID. |
| `tts` | `!tts` | Check the voice-reply setting. |
| `tts_enable` | `!tts enable` | Enable voice replies. |
| `tts_disable` | `!tts disable` | Disable voice replies. |
| `tts_on` | `!tts on` | Enable voice replies. |
| `tts_off` | `!tts off` | Disable voice replies. |
| `tts_status` | `!tts status` | Check voice-reply status. |
| `quiet` | `!quiet` | Pause conversational AI replies. |
| `unquiet` | `!unquiet` | Resume conversational AI replies. |
| `status` | `!status` | Get JARVIS health and status. |
| `healthgraph` | `!healthgraph` | Send the JARVIS health graph. |
| `ginfo` | `!ginfo` | Get current WhatsApp group information. |
| `listadmins` | `!listadmins` | List current WhatsApp group admins. |
| `listonline` | `!listonline` | List recently active members. |
| `getjid` | `!getjid` | Get the current chat JID. |
| `groupids` | `!groupids` | List available group IDs. |
| `getgroupids` | `!getgroupids` | Alias for listing group IDs. |
| `groupname` | `!groupname` | Rename a WhatsApp group by its group ID. |
| `approvals` | `!approvals` | List approvals visible to this requester. |
| `approve` | `!approve` | Approve and execute a pending action by approval ID. |
| `reject` | `!reject` | Reject a pending action by approval ID. |
| `pay` | `!pay` | Open the tutorial payment flow. |
| `pay_month` | `!pay month` | Open the monthly payment flow. |
| `pay_week` | `!pay week` | Open the weekly payment flow. |
| `name` | `!name` | Register or update the learner profile name. |
| `addxxjarvis` | `!addxxjarvis` | Manage the supported JARVIS group integration. |
| `addxxjarvis_meta` | `!addxxjarvis meta` | Link the supported group integration. |
| `menu` | `!menu` | Show the WhatsApp command menu. |
| `help` | `!help` | Alias for the command menu. |
| `settimetable` | `!settimetable` | Set a department timetable URL. |
| `time` | `!time` | Get the current time. |

## WhatsApp-only group-management commands

These commands remain implemented by the existing WhatsApp handler and are not Agent tools:

- `!add`
- `!kick`
- `!remove all`
- `!ban`
- `!unban`
- `!promote`
- `!mute`
- `!unmute`
- `!reset`

## Removed from the command menu and Agent registry

- `!define`
- `!dictionary`

## Registration guarantees

- The Agent registry contains exactly **57** unique command entries.
- The nine WhatsApp-only group-management commands are not exposed through `command_registry_list`, `command_registry_get`, or Agent tool discovery.
- `!define` and `!dictionary` are absent from the Agent registry and `!menu`.
- Duplicate tool registration is rejected.
- Commands are dispatched through the existing WhatsApp handler so its existing permission checks and reply behaviour remain authoritative.
