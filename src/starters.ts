// Other extensions can start new pi sessions for the phone, the way herdr does, over pi's
// event bus (no import between the packages):
//
//   pi.events.on("pi-mobile:starters", ({ register }) =>
//     register({ id: "pi-roost", label: "Background session", start: async ({ cwd, prompt, env }) => ({ name }) }));
//
// `register` must be called right away (pi-mobile collects starters synchronously). `env`
// must reach the new pi's environment: it carries PI_MOBILE_SPAWN, which the new session
// echoes back so the phone opens it. pi-mobile checks `cwd` before calling `start`.
//
// pi-mobile also emits "pi-mobile:activity" ({ action }) in a session whenever a paired
// device calls it, so a host that stops idle sessions can keep the ones in use.

import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const STARTERS_CHANNEL = "pi-mobile:starters";
export const ACTIVITY_CHANNEL = "pi-mobile:activity";

export interface StartRequest {
	/** An absolute folder that exists on this machine. */
	cwd: string;
	/** The first prompt, if any. */
	prompt?: string;
	/** Must be set in the new pi's environment. */
	env: Record<string, string>;
}

export interface Starter {
	/** Stable id the phone sends back; not "herdr", which is built in. */
	id: string;
	/** Shown on the phone, e.g. "Background session". */
	label: string;
	start(req: StartRequest): Promise<{ name?: string }>;
}

/** The starters other extensions in this pi offer right now. */
export function starters(pi: ExtensionAPI): Starter[] {
	const out: Starter[] = [];
	const register = (s: unknown) => {
		const x = s as Partial<Starter> | undefined;
		if (!x || typeof x.id !== "string" || !x.id || x.id === "herdr" || typeof x.label !== "string" || typeof x.start !== "function") return;
		if (!out.some((o) => o.id === x.id)) out.push(x as Starter);
	};
	try {
		(pi as { events?: ExtensionAPI["events"] }).events?.emit(STARTERS_CHANNEL, { register });
	} catch {}
	return out;
}

/** Tells the session's host that a paired device is using it. Never throws. */
export function noteActivity(pi: ExtensionAPI, action: string): void {
	try {
		(pi as { events?: ExtensionAPI["events"] }).events?.emit(ACTIVITY_CHANNEL, { action });
	} catch {}
}

/** `~/x` or an absolute path to an existing folder; throws a message for the phone otherwise. */
export function checkFolder(raw: string): string {
	const cwd = raw.trim().replace(/^~(?=\/|$)/, process.env.HOME ?? "~");
	if (!isAbsolute(cwd)) throw new Error("choose an absolute folder");
	let isDir = false;
	try {
		isDir = statSync(cwd).isDirectory();
	} catch {}
	if (!isDir) throw new Error(`${cwd} is not a folder on this machine`);
	return cwd;
}
