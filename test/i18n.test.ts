// The phone's interface language (web/i18n.js, web/zh.js): every English sentence the app shows
// through tr() or in index.html has a Chinese entry with the same {placeholders}, and no entry is stale.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const WEB = new URL("../web/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, WEB), "utf8");

// Browser scripts, not modules: importing runs them. Ask for Chinese before the engine starts.
(globalThis as any).localStorage = { getItem: () => JSON.stringify("zh"), setItem() {}, removeItem() {} };
for (const script of ["../web/zh.js", "../web/i18n.js"]) await import(script);
const ZH: Record<string, string> = (globalThis as any).PiLocaleZh;
const I18N = (globalThis as any).PiI18n;

/** Every key the scripts pass to tr("…"), as the string literal says it. */
function scriptKeys(): Set<string> {
	const keys = new Set<string>();
	for (const name of readdirSync(WEB)) {
		if (!name.endsWith(".js") || name === "zh.js" || name === "i18n.js" || name === "qr.js") continue;
		for (const m of read(name).matchAll(/\btr\(\s*("(?:[^"\\]|\\.)*")/g)) keys.add(JSON.parse(m[1]));
	}
	// Tool verbs go through tr() from app.js's TOOL_LOOK table: [/re/, "icon", "Done", "Doing"].
	for (const m of read("app.js").matchAll(/\[\/.+?\/,\s*"[\w-]+",\s*"(\w+)",\s*"(\w+)"\]/g)) keys.add(m[1]).add(m[2]);
	return keys;
}

/** The static text and labels in index.html that i18n.js translates at load. */
function htmlKeys(): Set<string> {
	const html = read("index.html").replace(/<svg class="sprite"[\s\S]*?<\/svg>/, "").replace(/<head>[\s\S]*?<\/head>/, "");
	const keys = new Set<string>();
	for (const m of html.matchAll(/\s(?:aria-label|title|placeholder)="([^"]+)"/g)) keys.add(m[1]);
	for (const m of html.matchAll(/>([^<>]+)</g)) if (m[1].trim()) keys.add(m[1].trim());
	keys.delete("pi mobile");
	return keys;
}

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every interface sentence has a Chinese entry", () => {
	const missing = [...scriptKeys(), ...htmlKeys()].filter((k) => !ZH[k]);
	assert.deepEqual(missing, []);
});

test("translations keep the same placeholders", () => {
	const wrong = Object.entries(ZH).filter(([en, zh]) => holes(en).join() !== holes(zh).join()).map(([en]) => en);
	assert.deepEqual(wrong, []);
});

test("no stale entries", () => {
	const used = new Set([...scriptKeys(), ...htmlKeys()]);
	assert.deepEqual(Object.keys(ZH).filter((k) => !used.has(k)), []);
});

test("t() translates, fills placeholders and falls back to the English", () => {
	assert.equal(I18N.lang, "zh");
	assert.equal(I18N.t("Paired with {host}", { host: "mac" }), ZH["Paired with {host}"].replace("{host}", "mac"));
	assert.equal(I18N.t("Not in the table {x}", { x: 1 }), "Not in the table 1");
	assert.equal(I18N.t("Sessions"), ZH.Sessions);
});
