# JARVIS WhatsApp Command Registry

**Total registered command entries: 68**

This inventory includes the public `!menu`, aliases, multi-word subcommands, and operational handlers. The Agent can inspect it using `command_registry_list` and `command_registry_get`. Existing WhatsApp command handlers remain the execution source for commands without a mapped Agent tool.

## AI & learning

- `!ai`: Ask JARVIS a question — WhatsApp handler
- `!define` `word`: Look up a word meaning — WhatsApp handler
- `!dictionary` `word`: Alias for !define — WhatsApp handler
- `!quiz` `subject?`: Start a quiz — WhatsApp handler
- `!quiz off`: Stop the active quiz; group-admin scoped — WhatsApp handler
- `!stopquiz`: Stop the active quiz — WhatsApp handler
- `!command`: Command Inventor root; use list or create subcommands — WhatsApp handler
- `!command list`: List saved custom commands — Agent tool: `command_builder_list`
- `!command create` `name`, `description`, `template`: Propose a safe custom command — Agent tool: `command_builder_create`
- `!timetable`: Show the tutorial timetable — WhatsApp handler
- `!image` `prompt`: Generate an image — Agent tool: `image_generate`
- `!vv`: Retrieve view-once media by replying to it — WhatsApp handler
- `!createfile` `prompt`: Create a study file — WhatsApp handler
- `!create document` `prompt`: Create a study document — WhatsApp handler
- `!generate pdf` `prompt`: Generate a PDF — WhatsApp handler
- `!create`: Create a study document (subcommand alias) — WhatsApp handler
- `!generate`: Generate a PDF (subcommand alias) — WhatsApp handler

## Web, translation & media

- `!crawl` `url`: Inspect a website and capture a screenshot — WhatsApp handler
- `!sitecheck` `url`: Check whether a website is reachable — Agent tool: `website_check`
- `!translate` `source`, `target`, `text`: Translate text — WhatsApp handler
- `!yt search` `query`: Search YouTube — WhatsApp handler
- `!yt video` `query_or_id`: Find/send a YouTube video — WhatsApp handler
- `!yt audio` `query_or_id`: Find/send YouTube audio — WhatsApp handler
- `!yt download` `video_id`: Download/send a YouTube video by ID — WhatsApp handler
- `!video` `prompt_or_status`: Generate a video or check status — WhatsApp handler
- `!video status`: Check latest video status — WhatsApp handler

## Reminders & voice

- `!remind` `delay`, `message`: Create a reminder — WhatsApp handler
- `!reminders`: List pending reminders — WhatsApp handler
- `!cancelreminder` `id`: Cancel a reminder — WhatsApp handler
- `!tts`: Control Piper text-to-speech replies — WhatsApp handler
- `!tts enable`: Alias for enabling Piper voice replies — WhatsApp handler
- `!tts disable`: Alias for disabling Piper voice replies — WhatsApp handler
- `!tts on`: Enable Piper voice replies — WhatsApp handler
- `!tts off`: Disable voice replies — WhatsApp handler
- `!tts status`: Check voice reply setting — WhatsApp handler
- `!quiet`: Pause AI replies — WhatsApp handler
- `!unquiet`: Resume AI replies — WhatsApp handler

## Bot & group info

- `!status`: Show JARVIS health/status — WhatsApp handler
- `!healthgraph`: Send health graph — WhatsApp handler
- `!ginfo`: Show current group information — Agent tool: `group_information`
- `!listadmins`: List current group administrators — Agent tool: `list_group_admins`
- `!listonline`: List recently active members — WhatsApp handler
- `!getjid`: Show current chat JID — WhatsApp handler
- `!groupids`: List group IDs — WhatsApp handler
- `!getgroupids`: Alias for !groupids — WhatsApp handler
- `!groupname` `group_id`, `name`: Rename a group — WhatsApp handler

## Group management

- `!add` `phone_number`: Add a participant — WhatsApp handler
- `!kick` `mentioned_user`: Remove a participant — WhatsApp handler
- `!remove all`: Remove all non-admin members — WhatsApp handler
- `!ban` `mentioned_user`: Ban a member from this group — WhatsApp handler
- `!unban` `mentioned_user`: Remove a group ban — WhatsApp handler
- `!promote` `mentioned_user`: Promote a member to group admin — WhatsApp handler
- `!mute`: Close group messaging — Agent tool: `group_mute`
- `!unmute`: Reopen group messaging — Agent tool: `group_unmute`
- `!reset` `mentioned_user`: Reset member warnings — WhatsApp handler
- `!approvals`: List pending approvals — WhatsApp handler
- `!approve` `approval_id`: Approve a pending action — WhatsApp handler
- `!reject` `approval_id`: Reject a pending action — WhatsApp handler
- `!remove`: Remove group participants; supports all subcommand — WhatsApp handler

## Flexi / account

- `!pay`: Open the tutorial payment portal — WhatsApp handler
- `!pay month`: Open monthly tutorial payment flow — WhatsApp handler
- `!pay week`: Open weekly tutorial payment flow — WhatsApp handler
- `!name` `name`: Register/update learner profile — WhatsApp handler
- `!addxxjarvis`: Manage supported group integration — WhatsApp handler
- `!addxxjarvis meta` `group_id`: Link supported group integration — WhatsApp handler

## Other

- `!menu`: Show the complete command menu — WhatsApp handler
- `!help`: Alias for !menu — WhatsApp handler

## Operational

- `!settimetable` `timetable_data`: Set/update the tutorial timetable — WhatsApp handler
