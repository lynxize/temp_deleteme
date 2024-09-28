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

    if (!author?.member)
        throw new TypeError("The member who wrote this message cannot be found! Were they deleted?");

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

    if (author != undefined)
        return author;

    if (author === null)
        return null;

    pk.getMessage({ message: message.id }).then(msg => {
        author = ({ member: msg.member as Member, system: msg.system as System, systemSettings: new Map(), guildSettings: new Map() });

        authors[authorData] = author;
        DataStore.set(DATASTORE_KEY, authors);
    });

    authors[authorData] = null;

    return undefined;
}

export function enforceMinLightness(colorString: string, lightness: number = 70): string {
    const [h, s, l] = hexStringToHSL(colorString);
    return hslToHexString([h, s, Math.max(l, lightness)]);
}

export function hexStringToHSL(hex: string): [number, number, number] {
    const r = parseInt("0x" + hex[0] + hex[1]) / 255;
    const g = parseInt("0x" + hex[2] + hex[3]) / 255;
    const b = parseInt("0x" + hex[4] + hex[5]) / 255;

    const cmin = Math.min(r,g,b);
    const cmax = Math.max(r,g,b);
    const delta = cmax - cmin;

    let [h, s, l] = [0, 0, 0];

    if (delta === 0) h = 0;
    else if (cmax === r) h = ((g - b) / delta) % 6;
    else if (cmax === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;

    h = Math.round(h * 60);

    if (h < 0)
        h += 360;

    l = (cmax + cmin) / 2;
    s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    s = +(s * 100).toFixed(1);
    l = +(l * 100).toFixed(1);

    return [h, s, l];
}

export function hslToHexString(hsl: [number, number, number]): string {
    let [h, s, l] = hsl;
    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c/2;
    let [r, g, b] = [0, 0, 0];

    if (h >= 0 && h < 60) [r, g, b] = [c, x, 0];
    else if (h >= 60 && h < 120) [r, g, b] = [x, c, 0];
    else if (h >= 120 && h < 180) [r, g, b] = [0, c, x];
    else if (h >= 180 && h < 240) [r, g, b] = [0, x, c];
    else if (h >= 240 && h < 300) [r, g, b] = [x, 0 ,c];
    else if (h >= 300 && h < 360) [r, g, b] = [c, 0, x];

    let rs = Math.round((r + m) * 255).toString(16);
    let gs = Math.round((g + m) * 255).toString(16);
    let bs = Math.round((b + m) * 255).toString(16);

    if (rs.length === 1) rs = "0" + r;
    if (gs.length === 1) gs = "0" + g;
    if (bs.length === 1) bs = "0" + b;

    return rs + gs + bs;
}

