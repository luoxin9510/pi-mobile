// pi mobile — interface language. The English text is the key (gettext style): `t("Paired with {host}",
// { host })` looks the sentence up in the chosen language's table (web/zh.js) and falls back to the
// English when there is no entry, so an untranslated string still reads fine. The static text in
// index.html (text, aria-label, title, placeholder) is translated once at load the same way.
// The choice (auto, zh, en) lives on this phone; changing it reloads the page.
"use strict";

(() => {
	const KEY = "pi-mobile-lang";
	const TABLES = { zh: globalThis.PiLocaleZh || {} };

	function pref() {
		try {
			const v = JSON.parse(globalThis.localStorage?.getItem(KEY) || "null");
			return v === "zh" || v === "en" ? v : "auto";
		} catch {
			return "auto";
		}
	}
	function resolve(p) {
		if (p === "zh" || p === "en") return p;
		const nav = globalThis.navigator || {};
		const langs = nav.languages?.length ? nav.languages : [nav.language];
		return langs.some((l) => /^zh\b/i.test(l || "")) ? "zh" : "en";
	}

	const lang = resolve(pref());
	const table = TABLES[lang] || null;

	/** The sentence in the interface language, with `{name}` filled from `vars`. */
	function t(text, vars) {
		let out = (table && table[text]) || text;
		if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
		return out;
	}

	function setLang(p) {
		try {
			if (p === "auto") localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, JSON.stringify(p));
		} catch {}
		location.reload();
	}

	/** Translates the static text and labels under `root` (index.html's markup). */
	function translateDOM(root = document.body) {
		if (!table || !root) return;
		for (const e of root.querySelectorAll("[aria-label], [title], [placeholder]"))
			for (const a of ["aria-label", "title", "placeholder"]) {
				const v = e.getAttribute(a);
				if (v && table[v]) e.setAttribute(a, table[v]);
			}
		const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (n) => (n.parentElement?.closest("script, style, svg") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
		});
		for (let n = walk.nextNode(); n; n = walk.nextNode()) {
			const s = n.nodeValue.trim();
			if (s && table[s]) n.nodeValue = n.nodeValue.replace(s, table[s]);
		}
	}

	globalThis.PiI18n = { t, lang, pref, setLang, translateDOM };
	if (typeof document !== "undefined") {
		document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
		translateDOM();
	}
})();
