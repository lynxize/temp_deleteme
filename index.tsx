/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { addDecoration } from "@api/MessageDecorations";
import { addPreEditListener } from "@api/MessageEvents";
import { addButton, removeButton } from "@api/MessagePopover";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { DeleteIcon, PencilIcon } from "@components/Icons";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import {
    Button,
    ChannelStore,
    Menu,
    MessageActions,
    MessageStore, UserStore
} from "@webpack/common";
import { Message } from "discord-types/general";

import { PKAPI } from "./api";
import pluralKit from "./index";
import {
    deleteMessage,
    getAuthorOfMessage,
    isOwnPkMessage,
    isPk,
    loadAuthors, loadData,
    replaceTags,
} from "./utils";


const ctxMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    let msg = props["message"]
    if (!isOwnPkMessage(msg, pluralKit.api)) return;

    // Place at the beginning of the second menu section
    children[3]?.props.children.splice(0, 0,
        <Menu.MenuItem
            id="pk-edit"
            icon={PencilIcon}
            label={
                <div className="edit">
                    <div className="edit">Edit Message</div>
                </div>
            }
            action={() => MessageActions.startEditMessage(msg.channel_id, msg.id, msg.content)}
        />
    );

    // Override the regular delete button if it's not present
    if (children[5] == null)
        return;
    if (children[5].props.children[2] != null)
        return;

    children[5].props.children[2] =
        <Menu.MenuItem
            id="pk-delete"
            icon={DeleteIcon}
            color="danger"
            label={
                <div className="delete">
                    <div className="delete">Delete Message</div>
                </div>
            }
            action={() => deleteMessage(msg)}
        />;
};

export const settings = definePluginSettings({
    colorNames: {
        type: OptionType.BOOLEAN,
        description: "Display member colors in their names in chat",
        default: false
    },
    pkIcon: {
        type: OptionType.BOOLEAN,
        description: "Enables a PluralKit icon next to proxied messages",
        default: false
    },
    displayOther: {
        type: OptionType.STRING,
        description: "How to display proxied users (from other systems) in chat\n" +
            "{tag}, {name}, {memberId}, {pronouns}, {systemId}, {systemName}, {color}, {avatar}, {messageCount}, {systemMessageCount} are valid variables (All lowercase)",
        default: "{name}{tag}",
    },
    displayLocal: {
        type: OptionType.STRING,
        description: "How to display proxied users (from your system, defaults to displayOther if blank) in chat\n" +
            "{tag}, {name}, {memberId}, {pronouns}, {systemId}, {systemName}, {color}, {avatar}, {messageCount}, {systemMessageCount} are valid variables (All lowercase)",
        default: "",
    },
    load: {
        type: OptionType.COMPONENT,
        component: () => {
            return <Button label={"Load"} onClick = {async () => {
                await loadData();
            }}>LOAD</Button>;
        },
        description: "Load local system into memory"
    },
    token: {
        type: OptionType.STRING,
        description: "Your PluralKit Token, required for many actions",
        default: ""
    },
    printData: {
        type: OptionType.COMPONENT,
        component: () => {
            return <Button onClick = {() => {
                console.log(settings.store.data);
            }}>Print Data</Button>;
        },
        description: "Print stored data to console",
        hidden: IS_DEV // showDebug
    },
    data: {
        type: OptionType.STRING,
        description: "Datastore",
        default: "{}",
        hidden: IS_DEV // showDebug
    }
});

export default definePlugin({
    name: "Plural Kit",
    description: "Pluralkit integration for Vencord",
    authors: [{
        name: "Scyye",
        id: 553652308295155723n
    }],
    startAt: StartAt.WebpackReady,
    settings,
    contextMenus: {
        "message": ctxMenuPatch
    },
    patches: [
        {
            find: '?"@":"")',
            replacement: {
                match: /(?<=onContextMenu:\i,children:).*?\)}/,
                replace: "$self.renderUsername(arguments[0])}"
            }
        },
        // make up arrow to edit most recent message work
        // this might conflict with messageLogger, but to be honest, if you're
        // using that plugin, you'll have enough problems with pk already
        // Stolen directly from https://github.com/lynxize/vencord-plugins/blob/plugins/src/userplugins/pk4vc/index.tsx
        {
            find: "getLastEditableMessage",
            replacement: {
                match: /return (.)\(\)\(this.getMessages\((.)\).{10,100}:.\.id\)/,
                replace: "return $1()(this.getMessages($2).toArray()).reverse().find(msg => $self.isOwnMessage(msg)"
            }
        },
    ],

    isOwnMessage: (message: Message) => isOwnPkMessage(message, pluralKit.api) || message.author.id === UserStore.getCurrentUser().id,

    renderUsername: ({ author, message, isRepliedMessage, withMentionPrefix }) => {
        const prefix = isRepliedMessage && withMentionPrefix ? "@" : "";
        try {
            const discordUsername = author.nick??author.displayName??author.username;
            if (!isPk(message)) {
                return <>{prefix}{discordUsername}</>;
            }

            let color: string = "666666";
            const pkAuthor = getAuthorOfMessage(message, pluralKit.api);

            if (pkAuthor === undefined) {
                return <>{prefix}{discordUsername}</>
            }

            if (pkAuthor.member && settings.store.colorNames) {
                color = pkAuthor.member.color ?? color;
            }

            const display = isOwnPkMessage(message, pluralKit.api) && settings.store.displayLocal !== "" ? settings.store.displayLocal : settings.store.displayOther;
            const resultText = replaceTags(display, message, settings.store.data, pluralKit.api);

            // PK mesasage, disable bot tag
            message.bot = false;
            message.author.bot = false;

            return <span style={{color: `#${color}`}}>{resultText}</span>;
        } catch (e) {
            console.error(e);
            return <>{prefix}{author?.nick}</>;
        }
    },

    api: new PKAPI({}),

    async start() {
        await loadData();
        if (settings.store.data === "{}") {
            await loadAuthors();
        }

        addDecoration("pk-proxied", props => {
            if (!settings.store.pkIcon)
                return null;
            if (!isPk(props.message))
                return null;
            return <ErrorBoundary noop>
                <img src="https://pluralkit.me/favicon.png" height="17" style={{
                    marginLeft: 4,
                    verticalAlign: "sub"
                }}/>
            </ErrorBoundary>;
        });

        addButton("pk-edit", msg => {
            if (!msg) return null;
            if (!isOwnPkMessage(msg, pluralKit.api)) return null;

            return {
                label: "Edit",
                icon: () => {
                    return <PencilIcon/>;
                },
                message: msg,
                channel: ChannelStore.getChannel(msg.channel_id),
                onClick: () => MessageActions.startEditMessage(msg.channel_id, msg.id, msg.content),
                onContextMenu: _ => {}
            };
        });

        addButton("pk-delete", msg => {
            if (!msg) return null;
            if (!isOwnPkMessage(msg, pluralKit.api)) return null;
            if (!shiftKey) return null;

            return {
                label: "Delete",
                dangerous: true,
                icon: () => {
                    return <DeleteIcon/>;
                },
                message: msg,
                channel: ChannelStore.getChannel(msg.channel_id),
                onClick: () => deleteMessage(msg),
                onContextMenu: _ => {}
            };
        });

        // Stolen directly from https://github.com/lynxize/vencord-plugins/blob/plugins/src/userplugins/pk4vc/index.tsx
        this.preEditListener = addPreEditListener((channelId, messageId, messageObj) => {
            if (isPk(MessageStore.getMessage(channelId, messageId))) {
                const { guild_id } = ChannelStore.getChannel(channelId);
                MessageActions.sendMessage("1276796961227276338", {
                        content: "pk;e https://discord.com/channels/" + guild_id + "/" + channelId + "/" + messageId + " " + messageObj.content},
                    false);
                //return { cancel: true };
            }
        });

        document.addEventListener("keydown", onKey);
        document.addEventListener("keyup", onKey);
    },
    stop() {
        removeButton("pk-edit");
        removeButton("pk-delete");
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("keyup", onKey);
    },
});

var shiftKey = false;
function onKey(e: KeyboardEvent) {
    shiftKey = e.shiftKey;
}
