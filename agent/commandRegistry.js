'use strict';

const BUILT_IN_COMMANDS = [
  ['!ai','AI & Learning','!ai [question]','Ask JARVIS a question'],
  ['!define','AI & Learning','!define [word]','Define a word',['!dictionary']],
  ['!quiz','AI & Learning','!quiz [subject]','Start a subject quiz; use !quiz off to stop'],
  ['!quiz off','AI & Learning','!quiz off','Stop the active quiz in the current group'],
  ['!timetable','AI & Learning','!timetable','Show the tutorial timetable'],
  ['!image','AI & Learning','!image [prompt]','Generate an image'],
  ['!vv','AI & Learning','!vv','Retrieve view-once media'],
  ['!createfile','AI & Learning','!createfile','Create a study document or PDF',['!create document','!generate pdf']],
  ['!crawl','Web & Media','!crawl [URL]','Inspect a public website'],
  ['!sitecheck','Web & Media','!sitecheck [URL]','Check website availability'],
  ['!translate','Web & Media','!translate [source] [target] [text]','Translate text'],
  ['!yt','Web & Media','!yt [search|video|audio|download]','Search or retrieve YouTube media'],
  ['!video','Web & Media','!video [prompt|status]','Generate or check a video'],
  ['!remind','Reminders','!remind [duration] [message]','Create a reminder'],
  ['!reminders','Reminders','!reminders','List reminders'],
  ['!cancelreminder','Reminders','!cancelreminder [ID]','Cancel a reminder'],
  ['!tts','Voice','!tts [on|off|status]','Control voice replies'],
  ['!status','Bot & Group Info','!status','Show bot status'],
  ['!healthgraph','Bot & Group Info','!healthgraph','Show health graph'],
  ['!ginfo','Bot & Group Info','!ginfo','Show group information'],
  ['!listadmins','Bot & Group Info','!listadmins','List group admins'],
  ['!listonline','Bot & Group Info','!listonline','List recently active members'],
  ['!getjid','Bot & Group Info','!getjid','Show current chat JID'],
  ['!groupids','Bot & Group Info','!groupids','List group IDs',['!getgroupids']],
  ['!groupname','Group Management','!groupname [GROUP_ID] [name]','Rename a group'],
  ['!add','Group Management','!add [phone number]','Add a group participant'],
  ['!kick','Group Management','!kick @user','Remove a participant'],
  ['!remove','Group Management','!remove all','Remove all eligible participants',['!remove all']],
  ['!ban','Group Management','!ban @user','Ban a participant'],
  ['!unban','Group Management','!unban @user','Unban a participant'],
  ['!promote','Group Management','!promote @user','Promote a participant'],
  ['!mute','Group Management','!mute [duration]','Mute the group'],
  ['!unmute','Group Management','!unmute [duration]','Unmute the group'],
  ['!reset','Group Management','!reset @user','Reset a participant setting'],
  ['!pay','Payments','!pay [month|week]','Payment information'],
  ['!name','Profile','!name [your name]','Set profile name'],
  ['!addxxjarvis','Integrations','!addxxjarvis meta [GROUP_ID]','Connect Meta AI group integration'],
  ['!quiet','Group Management','!quiet','Temporarily enable quiet mode'],
  ['!unquiet','Group Management','!unquiet','Disable quiet mode'],
  ['!stopquiz','AI & Learning','!stopquiz','Stop the current quiz using the legacy quiz control'],
  ['!command','Command Inventor','!command [list|create]','List or create safe custom commands'],
  ['!menu','Help','!menu','Show command menu',['!help']]
].map(([name, category, usage, descriptionOrAliases, maybeAliases]) => {
  const description = Array.isArray(descriptionOrAliases) ? '' : descriptionOrAliases;
  const aliases = Array.isArray(descriptionOrAliases) ? descriptionOrAliases : (maybeAliases || []);
  return { name, category, usage, description, aliases, execution: 'legacy-handler' };
});

class CommandRegistry {
  constructor(commands = BUILT_IN_COMMANDS) {
    this.commands = new Map();
    for (const command of commands) this.register(command);
  }
  register(command) {
    if (!command || typeof command.name !== 'string' || !/^![a-z][a-z0-9_ ]{0,40}$/i.test(command.name) ||
        typeof command.usage !== 'string' || typeof command.description !== 'string') {
      throw new Error('Invalid command registry entry.');
    }
    const normalized = { ...command, aliases: [...new Set(command.aliases || [])] };
    this.commands.set(normalized.name.toLowerCase(), normalized);
    return normalized;
  }
  resolve(name) {
    const key = String(name || '').trim().toLowerCase();
    for (const command of this.commands.values()) {
      if (command.name.toLowerCase() === key || command.aliases.some(alias => alias.toLowerCase() === key)) return command;
    }
    return null;
  }
  list(category) {
    return [...this.commands.values()].filter(command => !category || command.category.toLowerCase() === String(category).toLowerCase());
  }
}
module.exports = { CommandRegistry, BUILT_IN_COMMANDS };
