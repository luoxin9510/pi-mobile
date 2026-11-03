// The Changes sheet's data (src/changes.ts) against real git repositories in a temp folder.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changes, diff, file } from "../src/changes.ts";

function repo(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-changes-")));
	const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
	g("init", "-q", "-b", "main");
	g("config", "user.email", "t@example.com");
	g("config", "user.name", "t");
	return dir;
}
const git = (dir: string, ...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();

test("lists modified, added, deleted and new files with line counts", async () => {
	const dir = repo();
	writeFileSync(join(dir, "keep.txt"), "a\nb\nc\n");
	writeFileSync(join(dir, "gone.txt"), "x\n");
	mkdirSync(join(dir, "src"));
	writeFileSync(join(dir, "src", "app.ts"), "one\n");
	git(dir, "add", ".");
	git(dir, "commit", "-qm", "first");
	writeFileSync(join(dir, "keep.txt"), "a\nB\nc\nd\n");
	rmSync(join(dir, "gone.txt"));
	writeFileSync(join(dir, "staged.txt"), "s\n");
	git(dir, "add", "staged.txt");
	writeFileSync(join(dir, "src", "new.ts"), "n1\nn2\n");
	writeFileSync(join(dir, "img.bin"), Buffer.from([0, 1, 2, 0, 3]));

	const c = await changes(join(dir, "src")); // from a subfolder: the whole repository
	assert.equal(c.repo, true);
	if (!c.repo) return;
	assert.equal(c.root, dir);
	assert.equal(c.branch, "main");
	assert.equal(c.more, 0);
	assert.deepEqual(c.files, [
		{ path: "gone.txt", status: "D", add: 0, del: 1 },
		{ path: "img.bin", status: "?", binary: true },
		{ path: "keep.txt", status: "M", add: 2, del: 1 },
		{ path: "src/new.ts", status: "?", add: 2, del: 0 },
		{ path: "staged.txt", status: "A", add: 1, del: 0 },
	]);
});

test("one file's diff: tracked against HEAD, new against nothing; unchanged files refused", async () => {
	const dir = repo();
	writeFileSync(join(dir, "a.txt"), "old\n");
	writeFileSync(join(dir, "same.txt"), "same\n");
	git(dir, "add", ".");
	git(dir, "commit", "-qm", "first");
	writeFileSync(join(dir, "a.txt"), "new\n");
	writeFileSync(join(dir, "b.txt"), "fresh\n");

	const a = await diff(dir, "a.txt");
	assert.equal(a.status, "M");
	assert.match(a.diff, /^-old$/m);
	assert.match(a.diff, /^\+new$/m);
	const b = await diff(dir, "b.txt");
	assert.equal(b.status, "?");
	assert.match(b.diff, /^\+fresh$/m);
	await assert.rejects(diff(dir, "same.txt"), /no changes/);
	// A pathspec is literal: a glob never reaches other files.
	await assert.rejects(diff(dir, "*.txt"), /no changes/);
});

test("before the first commit everything is new", async () => {
	const dir = repo();
	writeFileSync(join(dir, "first.md"), "# hi\n");
	git(dir, "add", ".");
	const c = await changes(dir);
	assert.ok(c.repo);
	if (c.repo) {
		assert.equal(c.branch, "main");
		assert.deepEqual(c.files, [{ path: "first.md", status: "A", add: 1, del: 0 }]);
	}
	assert.match((await diff(dir, "first.md")).diff, /^\+# hi$/m);
});

test("a folder outside git says so", async () => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-nogit-")));
	assert.deepEqual(await changes(dir), { repo: false });
});

test("file(): text, binary, missing and too big; never outside the project", async () => {
	const dir = repo();
	writeFileSync(join(dir, "t.txt"), "hello\n");
	writeFileSync(join(dir, "b.bin"), Buffer.from([1, 0, 2]));
	writeFileSync(join(dir, "big.txt"), "x".repeat(600 * 1024));
	const outside = realpathSync(mkdtempSync(join(tmpdir(), "pi-outside-")));
	writeFileSync(join(outside, "secret.txt"), "no\n");
	symlinkSync(join(outside, "secret.txt"), join(dir, "link.txt"));

	assert.deepEqual(await file(dir, "t.txt"), { path: "t.txt", text: "hello\n", size: 6 });
	assert.equal((await file(dir, "b.bin")).binary, true);
	assert.equal((await file(dir, "big.txt")).tooBig, true);
	assert.equal((await file(dir, "nope.txt")).missing, true);
	await assert.rejects(file(dir, `../${outside.split("/").pop()}/secret.txt`), /outside this project/);
	await assert.rejects(file(dir, "link.txt"), /outside this project/);
	// An absolute path is taken inside the project, not from the disk's root.
	assert.equal((await file(dir, "/etc/hosts")).missing, true);
});
