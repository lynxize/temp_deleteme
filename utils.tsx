/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AxiosError } from "axios"
import { DataStore } from "@api/index";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { findByCode } from "@webpack";
import { ChannelStore, FluxDispatcher, UserStore } from "@webpack/common";
import { Message } from "discord-types/general";

import { Member, MemberGuildSettings, PKAPI, System, SystemGuildSettings } from "./api";
import pluralKit, { settings } from "./index";


// I dont fully understand how to use datastores, if I used anything incorrectly please let me know
export const DATASTORE_KEY = "pk";
export let authors: Record<string, Author> = {};

export let localSystemNames: string[] = [];
export let localSystem: Author[] = [];

export interface Author {
    member: Member;
    system: System;
    guildSettings: Map<string, MemberGuildSettings>;
    systemSettings: Map<string, SystemGuildSettings>;
}

export function isPk(msg: Message) {
    return (msg && msg.applicationId === "466378653216014359");
}

export function isOwnPkMessage(message: Message, pk: PKAPI): boolean {
    if (!isPk(message)) return false;
    if ([[], {}, undefined].includes(localSystem)) return false;

    const authorMemberID: string = getAuthorOfMessage(message, pk)?.member;
    return (localSystem??[]).map(author => author.member.id).some(id => id === authorMemberID);
}

export function replaceTags(content: string, message: Message, localSystemData: string, pk: PKAPI) {
    const author = getAuthorOfMessage(message, pk);
    const localSystem: Author[] = JSON.parse(localSystemData);

    const messageGuildID = ChannelStore.getChannel(message.channel_id).guild_id;
    const { system } = author;

    // prioritize guild settings, then system/member settings
    const { tag } = system;
    const name = author.member.display_name ?? author.member.name;
    const avatar = author.member.avatar;

    return content
        .replace(/{tag}/g, tag??"")
        .replace(/{name}/g, name??"")
        .replace(/{memberid}/g, author.member.id??"")
        .replace(/{pronouns}/g, author.member.pronouns??"")
        .replace(/{systemid}/g, author.system.id??"")
        .replace(/{systemname}/g, author.system.name??"")
        .replace(/{color}/g, author.member.color??"ffffff")
        .replace(/{avatar}/g, avatar??"");
}

export async function loadAuthors() {
    authors = await DataStore.get<Record<string, Author>>(DATASTORE_KEY) ?? {};
    localSystem = JSON.parse(settings.store.data) ?? {};
    localSystemNames = localSystem.map(author => author.member.display_name??author.member.name);
}

export async function loadData() {
    const system = await pluralKit.api.getSystem({ system: UserStore.getCurrentUser().id });
    if (!system) {
        settings.store.data = "{}";
        return;
    }
    const localSystem: Author[] = [];

    (system.members??(await system.getMembers())).forEach((member: Member) => {
        localSystem.push({
            member,
            system,
            guildSettings: new Map(),
            systemSettings: new Map()
        });
    });

    settings.store.data = JSON.stringify(localSystem);

    await loadAuthors();
}

export function replyToMessage(msg: Message, mention: boolean, hideMention: boolean, content?: string | undefined) {
    FluxDispatcher.dispatch({
        type: "CREATE_PENDING_REPLY",
        channel: ChannelStore.getChannel(msg.channel_id),
        message: msg,
        shouldMention: mention,
        showMentionToggle: !hideMention,
    });
    if (content) {
        insertTextIntoChatInputBox(content);
    }
}

export function deleteMessage(msg: Message) {
    const addReaction = findByCode(".userHasReactedWithEmoji");

    addReaction(msg.channel_id, msg.id, { name: "❌" });
}

export function generateAuthorData(message: Message) {
    return `${message.author.username}##${message.author.avatar}`;
}

export function getAuthorOfMessage(message: Message, pk: PKAPI) {
    const authorData = generateAuthorData(message);
    let author: Author = authors[authorData]??undefined;

    if (author)
        return author;

    if (authors[authorData] == null)
        return;

    pk.getMessage({ message: message.id }).then(msg => {
        if (!msg.member)
            throw new TypeError("Message did not have an associated author!");

        author = ({ member: msg.member as Member, system: msg.system as System, systemSettings: new Map(), guildSettings: new Map() });

        const messageGuildID = ChannelStore.getChannel(msg.channel).guild_id;

        authors[authorData] = author;
        DataStore.set(DATASTORE_KEY, authors);
    }).catch(e => {
        authors[authorData] = author;
        throw e;
    });

    authors[authorData] = null;

    return undefined;
}

