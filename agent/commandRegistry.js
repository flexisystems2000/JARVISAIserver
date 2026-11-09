'use strict';

// Canonical user-facing WhatsApp command inventory. Keep this in sync with !menu.
// `agentTool` is populated only where the Agent has a real registered capability;
// commands without one remain available through their existing WhatsApp handlers.
const COMMANDS = [
  ['ai','AI & learning','Ask JARVIS a question',[], null],
  ['define','AI & learning','Look up a word meaning',['word'], null],
  ['dictionary','AI & learning','Alias for !define',['word'], null],
  ['quiz','AI & learning','Start a quiz',['subject?'], null],
  ['quiz off','AI & learning','Stop the active quiz; group-admin scoped',[], null],
  ['stopquiz','AI & learning','Stop the active quiz',[], null],
  ['command','AI & learning','Command Inventor root; use list or create subcommands',[], null],
  ['command list','AI & learning','List saved custom commands',[], 'command_builder_list'],
  ['command create','AI & learning','Propose a safe custom command',['name','description','template'], 'command_builder_create'],
  ['timetable','AI & learning','Show the tutorial timetable',[], null],
  ['image','AI & learning','Generate an image',['prompt'], 'image_generate'],
  ['vv','AI & learning','Retrieve view-once media by replying to it',[], null],
  ['createfile','AI & learning','Create a study file',['prompt'], null],
  ['create document','AI & learning','Create a study document',['prompt'], null],
  ['generate pdf','AI & learning','Generate a PDF',['prompt'], null],
  ['crawl','Web, translation & media','Inspect a website and capture a screenshot',['url'], null],
  ['sitecheck','Web, translation & media','Check whether a website is reachable',['url'], 'website_check'],
  ['translate','Web, translation & media','Translate text',['source','target','text'], null],
  ['yt search','Web, translation & media','Search YouTube',['query'], null],
  ['yt video','Web, translation & media','Find/send a YouTube video',['query_or_id'], null],
  ['yt audio','Web, translation & media','Find/send YouTube audio',['query_or_id'], null],
  ['yt download','Web, translation & media','Download/send a YouTube video by ID',['video_id'], null],
  ['video','Web, translation & media','Generate a video or check status',['prompt_or_status'], null],
  ['video status','Web, translation & media','Check latest video status',[], null],
  ['remind','Reminders & voice','Create a reminder',['delay','message'], null],
  ['reminders','Reminders & voice','List pending reminders',[], null],
  ['cancelreminder','Reminders & voice','Cancel a reminder',['id'], null],
  ['tts','Reminders & voice','Control Piper text-to-speech replies',[], null],
  ['tts enable','Reminders & voice','Alias for enabling Piper voice replies',[], null],
  ['tts disable','Reminders & voice','Alias for disabling Piper voice replies',[], null],
  ['tts on','Reminders & voice','Enable Piper voice replies',[], null],
  ['tts off','Reminders & voice','Disable voice replies',[], null],
  ['tts status','Reminders & voice','Check voice reply setting',[], null],
  ['quiet','Reminders & voice','Pause AI replies',[], null],
  ['unquiet','Reminders & voice','Resume AI replies',[], null],
  ['status','Bot & group info','Show JARVIS health/status',[], null],
  ['healthgraph','Bot & group info','Send health graph',[], null],
  ['ginfo','Bot & group info','Show current group information',[], 'group_information'],
  ['listadmins','Bot & group info','List current group administrators',[], 'list_group_admins'],
  ['listonline','Bot & group info','List recently active members',[], null],
  ['getjid','Bot & group info','Show current chat JID',[], null],
  ['groupids','Bot & group info','List group IDs',[], null],
  ['getgroupids','Bot & group info','Alias for !groupids',[], null],
  ['groupname','Bot & group info','Rename a group',['group_id','name'], null],
  ['add','Group management','Add a participant',['phone_number'], null],
  ['kick','Group management','Remove a participant',['mentioned_user'], null],
  ['remove all','Group management','Remove all non-admin members',[], null],
  ['ban','Group management','Ban a member from this group',['mentioned_user'], null],
  ['unban','Group management','Remove a group ban',['mentioned_user'], null],
  ['promote','Group management','Promote a member to group admin',['mentioned_user'], null],
  ['mute','Group management','Close group messaging',[], 'group_mute'],
  ['unmute','Group management','Reopen group messaging',[], 'group_unmute'],
  ['reset','Group management','Reset member warnings',['mentioned_user'], null],
  ['approvals','Group management','List pending approvals',[], null],
  ['approve','Group management','Approve a pending action',['approval_id'], null],
  ['reject','Group management','Reject a pending action',['approval_id'], null],
  ['pay','Flexi / account','Open the tutorial payment portal',[], null],
  ['pay month','Flexi / account','Open monthly tutorial payment flow',[], null],
  ['pay week','Flexi / account','Open weekly tutorial payment flow',[], null],
  ['name','Flexi / account','Register/update learner profile',['name'], null],
  ['addxxjarvis','Flexi / account','Manage supported group integration',[], null],
  ['addxxjarvis meta','Flexi / account','Link supported group integration',['group_id'], null],
  ['create','AI & learning','Create a study document (subcommand alias)',[], null],
  ['generate','AI & learning','Generate a PDF (subcommand alias)',[], null],
  ['remove','Group management','Remove group participants; supports all subcommand',[], null],
  ['menu','Other','Show the complete command menu',[], null],
  ['help','Other','Alias for !menu',[], null],
  // Operational handlers that exist outside the public !menu.
  ['settimetable','Operational','Set/update the tutorial timetable',['timetable_data'], null]
].map(([name, category, description, argumentsList, agentTool]) => Object.freeze({
  name, command: `!${name}`, category, description,
  arguments: Object.freeze(argumentsList), agentTool,
  agentAvailable: Boolean(agentTool)
}));

const BY_NAME = new Map(COMMANDS.map(command => [command.name, command]));
function listCommands({ category } = {}) {
  return COMMANDS.filter(command => !category || command.category.toLowerCase() === String(category).toLowerCase());
}
function getCommand(name) {
  return BY_NAME.get(String(name || '').trim().replace(/^!/, '').toLowerCase()) || null;
}
module.exports = { COMMANDS, listCommands, getCommand };
