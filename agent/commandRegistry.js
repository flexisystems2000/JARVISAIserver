'use strict';

// This registry describes user-facing WhatsApp command forms. Aliases and
// subcommands are separate entries so the Agent can select the exact route.
const COMMANDS = [
  ['ai','!ai','Answer a question using JARVIS AI.'],
  ['quiz','!quiz','Start a group quiz for a subject.'],
  ['quiz_off','!quiz off','Stop the active quiz.'],
  ['stopquiz','!stopquiz','Stop the active quiz.'],
  ['command','!command','Show Command Inventor usage.'],
  ['command_list','!command list','List saved custom commands.'],
  ['command_create','!command create','Propose a safe custom command for approval.'],
  ['timetable','!timetable','Retrieve a department timetable.'],
  ['image','!image','Generate an image from a prompt.'],
  ['vv','!vv','Retrieve view-once media from a quoted message.'],
  ['createfile','!createfile','Generate a document or study file.'],
  ['create_document','!create document','Alias for document creation.'],
  ['generate_pdf','!generate pdf','Alias for PDF creation.'],
  ['create','!create','Document-creation command alias; provide a document request.'],
  ['generate','!generate','Document-generation command alias; provide a document request.'],
  ['crawl','!crawl','Inspect a public website and capture a screenshot.'],
  ['sitecheck','!sitecheck','Check whether a public website is reachable.'],
  ['translate','!translate','Translate text between languages.'],
  ['yt_search','!yt search','Search YouTube.'],
  ['yt_video','!yt video','Find and send a YouTube video.'],
  ['yt_audio','!yt audio','Find and send YouTube audio.'],
  ['yt_download','!yt download','Download a YouTube video by ID.'],
  ['video','!video','Generate a video from a prompt.'],
  ['video_status','!video status','Check the latest video generation status.'],
  ['remind','!remind','Create a reminder with a duration and message.'],
  ['reminders','!reminders','List pending reminders in this chat.'],
  ['cancelreminder','!cancelreminder','Cancel a reminder by its ID.'],
  ['tts','!tts','Check the voice-reply setting.'],
  ['tts_enable','!tts enable','Enable voice replies.'],
  ['tts_disable','!tts disable','Disable voice replies.'],
  ['tts_on','!tts on','Enable voice replies.'],
  ['tts_off','!tts off','Disable voice replies.'],
  ['tts_status','!tts status','Check voice-reply status.'],
  ['quiet','!quiet','Pause conversational AI replies.'],
  ['unquiet','!unquiet','Resume conversational AI replies.'],
  ['status','!status','Get JARVIS health and status.'],
  ['healthgraph','!healthgraph','Send the JARVIS health graph.'],
  ['ginfo','!ginfo','Get current WhatsApp group information.'],
  ['listadmins','!listadmins','List current WhatsApp group admins.'],
  ['listonline','!listonline','List recently active members.'],
  ['getjid','!getjid','Get the current chat JID.'],
  ['groupids','!groupids','List available group IDs.'],
  ['getgroupids','!getgroupids','Alias for listing group IDs.'],
  ['groupname','!groupname','Rename a WhatsApp group by its group ID.'],
  ['approvals','!approvals','List approvals visible to this requester.'],
  ['approve','!approve','Approve and execute a pending action by approval ID.'],
  ['reject','!reject','Reject a pending action by approval ID.'],
  ['pay','!pay','Open the tutorial payment flow.'],
  ['pay_month','!pay month','Open the monthly payment flow.'],
  ['pay_week','!pay week','Open the weekly payment flow.'],
  ['name','!name','Register or update the learner profile name.'],
  ['addxxjarvis','!addxxjarvis','Manage the supported JARVIS group integration.'],
  ['addxxjarvis_meta','!addxxjarvis meta','Link the supported group integration.'],
  ['menu','!menu','Show the WhatsApp command menu.'],
  ['help','!help','Alias for the command menu.'],
  ['settimetable','!settimetable','Set a department timetable URL.'],
  ['time','!time','Get the current time.']
].map(([id, command, description]) => Object.freeze({ id, command, description }));

if (COMMANDS.length !== 57) throw new Error(`Expected 57 Agent command entries, found ${COMMANDS.length}`);

const WHATSAPP_ONLY_COMMANDS = Object.freeze(['!add', '!kick', '!remove all', '!ban', '!unban', '!promote', '!mute', '!unmute', '!reset']);
const REMOVED_COMMANDS = Object.freeze(['!define', '!dictionary']);

function registerWhatsAppCommandTools(registry, dispatch) {
  if (!registry || typeof registry.register !== 'function' || typeof dispatch !== 'function') {
    throw new Error('Command tool registration requires a tool registry and dispatcher.');
  }
  for (const entry of COMMANDS) {
    registry.register({
      name: `whatsapp_${entry.id}`,
      description: `${entry.description} Invoke the existing WhatsApp command ${entry.command}. Put command-specific arguments in input. Existing WhatsApp permission checks remain authoritative.`,
      parameters: {
        type: 'object',
        properties: { input: { type: 'string', maxLength: 4000, description: 'Arguments after the command, without repeating the command itself.' } },
        required: [],
        additionalProperties: false
      },
      permissions: ['user'],
      handler: async ({ input = '' }, context) => dispatch(entry, input, context)
    });
  }
  return registry;
}

module.exports = { COMMANDS, WHATSAPP_ONLY_COMMANDS, REMOVED_COMMANDS, registerWhatsAppCommandTools };
