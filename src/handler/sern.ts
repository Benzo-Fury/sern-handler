import type { Arg, Context, Visibility } from "../types/handler";
import * as Files from "./utils/readFile"
import type { ApplicationCommandOptionData, Awaitable, Client, CommandInteraction, Message } from "discord.js";
import type { possibleOutput } from "../types/handler"
import { Ok, Result, None, Some } from "ts-results";
import type * as Utils from "./utils/preprocessors/args";
import { isBot, hasPrefix, fmt } from "./utils/messageHelpers";


/**
 * @class
 */
export class Handler {
    private wrapper: Wrapper;
    /**
     * @constructor
     * @param {Wrapper} wrapper Some data that is required to run sern handler 
     */
    constructor(
        wrapper: Wrapper,
    ) {
        this.wrapper = wrapper;


        this.client
            /**
             * On ready, builds command data and registers them all
             * from command directory 
             **/
            .on("ready", async () => {
                Files.buildData(this)
                     .then( data => this.registerModules(data))
                if (wrapper.init !== undefined) wrapper.init(this);
            })

            .on("messageCreate", async message => {
                if (isBot(message) || !hasPrefix(message, this.prefix)) return;
                if (message.channel.type === "DM") return; //todo, handle dms

                const tryFmt = fmt(message, this.prefix)
                const commandName = tryFmt.shift()!;
                const module = Files.Commands.get(commandName) ?? Files.Alias.get(commandName)
                if (module === undefined) {
                    message.channel.send("Unknown legacy command")
                    return;
                }
                const cmdResult = (await this.commandResult(module, message, tryFmt.join(" ")))
                if (cmdResult === undefined) return;

                message.channel.send(cmdResult)

            })

            .on("interactionCreate", async interaction => {
                if (!interaction.isCommand()) return;
                const module = Files.Commands.get(interaction.commandName);
                const res = await this.interactionResult(module, interaction);
                if (res === undefined) return;
                await interaction.reply(res);
            })
    }
    /**
     * 
     * @param {Files.CommandVal | undefined} module command file information 
     * @param {CommandInteraction} interaction a Discord.js command interaction 
     * @returns {possibleOutput | undefined} takes return value and replies it, if possible input
     */
    private async interactionResult(
        module: Files.CommandVal | undefined,
        interaction: CommandInteraction): Promise<possibleOutput | undefined> {

        if (module === undefined) return "Unknown slash command!";
        const name = Array.from(Files.Commands.keys()).find(it => it === interaction.commandName);
        if (name === undefined) return `Could not find ${interaction.commandName} command!`;

        if (module.mod.type < CommandType.SLASH) return "This is not a slash command";
        const context = { message: None, interaction: Some(interaction) }
        const parsedArgs = module.mod.parse?.(context, ["slash", interaction.options]) ?? Ok("");
        if (parsedArgs.err) return parsedArgs.val;
        return (await module.mod.delegate(context, parsedArgs))?.val;
    }
    /**
     * 
     * @param {Files.CommandVal | undefined} module command file information
     * @param {Message} message a message object
     * @param {string} args anything after the command 
     * @returns takes return value and replies it, if possible input
     */
    private async commandResult(module: Files.CommandVal | undefined, message: Message, args: string): Promise<possibleOutput | undefined> {
        if (module?.mod === undefined) return "Unknown legacy command";
        if (module.mod.type === CommandType.SLASH) return `This may be a slash command and not a legacy command`
        if (module.mod.visibility === "private") {
            const checkIsTestServer = this.privateServers.find(({ id }) => id === message.guildId!)?.test;
            if (checkIsTestServer === undefined) return "This command has the private modifier but is not registered under Handler#privateServers";
            if (checkIsTestServer !== module.testOnly) {
                return "This private command is a testing command";
            }
        }
        const context = { message: Some(message), interaction: None }
        const parsedArgs = module.mod.parse?.(context, ["text", args]) ?? Ok("");
        if (parsedArgs.err) return parsedArgs.val;
        return (await module.mod.delegate(context, parsedArgs))?.val;
    }
    /**
     * This function chains `Files.buildData`
     * @param {{name: string, mod: Module<unknown>, absPath: string}} modArr module information
     */
    private async registerModules(
        modArr: {
            name: string,
            mod: Module<unknown>,
            absPath: string
        }[]
    ) {
        for await (const { name, mod, absPath } of modArr) {
            const { cmdName, testOnly } = Files.fmtFileName(name);
            switch (mod.type) {
                case 1: Files.Commands.set(cmdName, { mod, options: [], testOnly }); break;
                case 2:
                case (1 | 2): {
                    const options = ((await import(absPath)).options as ApplicationCommandOptionData[])
                    Files.Commands.set(cmdName, { mod, options: options ?? [], testOnly });
                    switch (mod.visibility) {
                        case "private": {
                            // loading guild slash commands only
                           await this.reloadSlash(cmdName, mod.desc, options)
                        }
                        case "public": {
                            // creating global commands!
                           await this.client.application!.commands
                                .create({
                                    name: cmdName,
                                    description: mod.desc,
                                    options
                                })
                        }
                    }
                } break;
                default: throw Error(`${name} with ${mod.visibility} is not a valid module type.`);
            }

            if (mod.alias.length > 0) {
                for (const alias of mod.alias) {
                    Files.Alias.set(alias, { mod, options: [], testOnly })
                }
            }
        }
    }
    /**
     * 
     * @param {string} cmdName name of command
     * @param {string} description description of command 
     * @param {ApplicationCommandOptionData[]} options any options for the slash command 
     */
    private async reloadSlash(
        cmdName: string,
        description: string,
        options: ApplicationCommandOptionData[]
    ) : Promise<void> {
        for (const { id } of this.privateServers) {
            const guild = (await this.client.guilds.fetch(id));

            guild.commands.create({
                name: cmdName,
                description,
                options
            })
        }
    }
    /**
     * @readonly
     * @returns {string} prefix used for legacy commands
     */
    get prefix(): string {
        return this.wrapper.prefix;
    }
    /**
    * @readonly
    * @returns {string} directory of your commands folder
    */
    get commandDir(): string {
        return this.wrapper.commands;
    }
    /**
     * @readonly
     * @returns {Client<boolean>} discord.js client
     */
    get client(): Client<boolean> {
        return this.wrapper.client
    }
    /**
     * @readonly
     * @returns {{test: boolean, id: string}[]} private server id for testing or personal use
     */
    get privateServers(): { test: boolean, id: string }[] {
        return this.wrapper.privateServers;
    }


}

/**
 * An object to be passed into Sern.Handler constructor. 
 * @typedef {object} Wrapper
 * @property {readonly Client} client
 * @property {readonly string} prefix
 * @property {readonly string} commands
 * @prop {(handler : Handler) => void)} init
 * @property {readonly {test: boolean, id: string}[]} privateServers
 */
export interface Wrapper {
    readonly client: Client,
    readonly prefix: string,
    readonly commands: string
    init?: (handler: Handler) => void,
    readonly privateServers: { test: boolean, id: string }[],
}
/**
 * An object to be passed into Sern.Handler constructor. 
 * @typedef {object} Module<T=string>
 * @property {string} desc
 * @property {Visibility} visibility
 * @property {CommandType} type
 * @property {(eventParams : Context, args : Ok<T=string>) => Awaitable<Result<possibleOutput, string> | void>)} delegate
 * @prop {(ctx: Context, args: Arg) => Utils.ArgType<T>} parse
 */
export interface Module<T = string> {
    alias: string[],
    desc: string,
    visibility: Visibility,
    type: CommandType,
    delegate: (eventParams: Context, args: Ok<T>) => Awaitable<Result<possibleOutput, string> | void>
    parse?: (ctx: Context, args: Arg) => Utils.ArgType<T>
}
/**
 * @enum { number };
 */
export enum CommandType {
    TEXT = 1,
    SLASH = 2,
}


