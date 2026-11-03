// What pi changed, for the phone's Changes sheet: the session folder's git working tree against HEAD
// (staged, unstaged and untracked together, the way you'd review before a commit), one file's diff,
// and a file's current text. Read-only. git runs without a shell, from the repository's root, with a
// time limit; files are read only inside that root (no `..`, no symlink out) and only up to a size.

import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";

/** git's id for the empty tree: the base before the first commit. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
/** At most this many files are listed (the rest only counted). */
const MAX_FILES = 300;
/** Line counts for at most this many new (untracked) files; each is one more git run. */
const MAX_UNTRACKED_COUNTS = 40;
const MAX_DIFF_CHARS = 200_000;
const MAX_FILE_BYTES = 512 * 1024;

export type FileStatus = "M" | "A" | "D" | "U" | "?";
export interface ChangedFile {
	path: string;
	status: FileStatus;
	add?: number;
	del?: number;
	binary?: boolean;
}
export type Changes = { repo: false } | { repo: true; root: string; branch: string; files: ChangedFile[]; more: number };

function git(cwd: string, args: string[], ok: number[] = [0]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			args,
			// No optional locks: pi's own git commands in this folder must never wait on ours.
			{ cwd, timeout: 10_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } },
			(err, stdout) => {
				const code = err ? (typeof (err as any).code === "number" ? (err as any).code : -1) : 0;
				if (err && !ok.includes(code)) reject(err);
				else resolve(stdout);
			},
		);
	});
}

async function rootOf(cwd: string): Promise<string | undefined> {
	try {
		return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || undefined;
	} catch {
		return undefined;
	}
}

async function base(root: string): Promise<string> {
	return (await git(root, ["rev-parse", "--verify", "-q", "HEAD"], [0, 1])).trim() ? "HEAD" : EMPTY_TREE;
}

/** `git status` entries as [status, path], renames as a delete and an add. */
async function status(root: string, path?: string): Promise<Array<[FileStatus, string]>> {
	const out = await git(root, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", ...(path ? ["--", `:(literal)${path}`] : [])]);
	const list: Array<[FileStatus, string]> = [];
	for (const entry of out.split("\0")) {
		if (entry.length < 4) continue;
		const xy = entry.slice(0, 2);
		const p = entry.slice(3);
		let s: FileStatus;
		if (xy === "??") s = "?";
		else if (xy.includes("U") || xy === "AA" || xy === "DD") s = "U";
		else if (xy.includes("D")) s = "D";
		else if (xy.includes("A") || xy.includes("C")) s = "A";
		else s = "M";
		list.push([s, p]);
	}
	return list;
}

function parseNumstat(out: string): Map<string, { add?: number; del?: number; binary?: boolean }> {
	const m = new Map<string, { add?: number; del?: number; binary?: boolean }>();
	for (const entry of out.split("\0")) {
		const t = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(entry);
		if (!t) continue;
		m.set(t[3], t[1] === "-" ? { binary: true } : { add: Number(t[1]), del: Number(t[2]) });
	}
	return m;
}

/** The working tree's changes against HEAD, or `{ repo: false }` when the folder isn't in a git repository. */
export async function changes(cwd: string): Promise<Changes> {
	const root = await rootOf(cwd);
	if (!root) return { repo: false };
	const [entries, from, branch] = await Promise.all([
		status(root),
		base(root),
		// The branch's name, also before its first commit; empty when HEAD is detached.
		git(root, ["symbolic-ref", "--short", "-q", "HEAD"], [0, 1]).then((s) => s.trim()),
	]);
	const counts = parseNumstat(await git(root, ["diff", from, "--numstat", "-z", "--no-renames"]));
	entries.sort((a, b) => a[1].localeCompare(b[1]));
	const shown = entries.slice(0, MAX_FILES);
	let counted = 0;
	const files: ChangedFile[] = [];
	for (const [s, path] of shown) {
		const f: ChangedFile = { path, status: s, ...counts.get(path) };
		if (s === "?" && counted < MAX_UNTRACKED_COUNTS) {
			counted++;
			// Against /dev/null git prints it like a rename ("add\tdel\t\0/dev/null\0path"): only the counts matter.
			const t = /^(-|\d+)\t(-|\d+)\t/.exec(await git(root, ["diff", "--no-index", "--numstat", "-z", "--", "/dev/null", path], [0, 1]));
			if (t) Object.assign(f, t[1] === "-" ? { binary: true } : { add: Number(t[1]), del: Number(t[2]) });
		}
		files.push(f);
	}
	return { repo: true, root, branch, files, more: entries.length - shown.length };
}

/** One changed file's diff against HEAD (a new file against nothing). Only files the working tree has changed. */
export async function diff(cwd: string, path: string): Promise<{ path: string; status: FileStatus; diff: string; truncated: boolean }> {
	const root = await rootOf(cwd);
	if (!root) throw new Error("this folder isn't a git repository");
	const [hit] = await status(root, path);
	if (!hit || hit[1] !== path) throw new Error("that file has no changes any more");
	const text =
		hit[0] === "?"
			? await git(root, ["diff", "--no-index", "--no-color", "--", "/dev/null", path], [0, 1])
			: await git(root, ["diff", await base(root), "--no-color", "--no-renames", "--", `:(literal)${path}`]);
	// The start of a diff says what it's about; keep it.
	const truncated = text.length > MAX_DIFF_CHARS;
	return { path, status: hit[0], diff: truncated ? text.slice(0, MAX_DIFF_CHARS) : text, truncated };
}

/** A file's current text, from inside the repository (or the session folder when there's none). */
export async function file(
	cwd: string,
	path: string,
): Promise<{ path: string; text?: string; missing?: boolean; binary?: boolean; tooBig?: boolean; size?: number }> {
	if (!path || path.includes("\0")) throw new Error("no such file");
	const root = await realpath((await rootOf(cwd)) ?? cwd);
	let real: string;
	try {
		real = await realpath(join(root, path));
	} catch {
		return { path, missing: true };
	}
	if (real !== root && !real.startsWith(root + sep)) throw new Error("that file is outside this project");
	const st = await stat(real);
	if (!st.isFile()) throw new Error("that isn't a file");
	if (st.size > MAX_FILE_BYTES) return { path, tooBig: true, size: st.size };
	const buf = await readFile(real);
	if (buf.subarray(0, 8000).includes(0)) return { path, binary: true, size: st.size };
	return { path, text: buf.toString("utf8"), size: st.size };
}
