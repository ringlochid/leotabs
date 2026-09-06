(() => {
  // extension/lib/model.js
  var SCHEMA = 1;
  var PALETTE = ["mint", "blue", "lavender", "peach", "rose", "teal", "yellow", "grey"];
  var uid = () => crypto.randomUUID();
  var stamp = () => Date.now();
  function text(value, max = 500) {
    return String(value ?? "").slice(0, max);
  }
  function safeURL(value) {
    try {
      const u = new URL(value);
      return ["http:", "https:", "file:"].includes(u.protocol) ? u.href : null;
    } catch {
      return null;
    }
  }
  function initialState() {
    return {
      schema: SCHEMA,
      revision: 0,
      spaces: [{ id: "main", name: "My space" }],
      collections: [],
      settings: {
        theme: "system",
        tabSort: "recent",
        view: "board",
        previewCapture: false,
        previewLimitMB: 50,
        currentWindowOnly: true,
        closeAfterStash: true,
        provider: "gemini",
        model: "gemini-2.5-flash",
        aiEndpoint: "",
        notionParent: "",
        rules: []
      }
    };
  }
  function validateSpaces(spaces) {
    if (!spaces) return [{ id: "main", name: "My space" }];
    if (!Array.isArray(spaces) || !spaces.length || spaces.length > 100)
      throw new Error("A library can contain 1 to 100 spaces.");
    const ids = /* @__PURE__ */ new Set();
    return spaces.map((s) => {
      if (!s || typeof s.id !== "string" || !s.id || ids.has(s.id)) throw new Error("Invalid space.");
      ids.add(s.id);
      return { id: text(s.id, 100), name: text(s.name).trim() || "New space" };
    });
  }
  function newCollection(name = "Untitled", color = "blue") {
    const now = stamp();
    return {
      id: uid(),
      spaceId: "main",
      pinned: false,
      autoUpdate: true,
      name: text(name).trim() || "Untitled",
      color: PALETTE.includes(color) ? color : "blue",
      note: "",
      collapsed: false,
      groups: [],
      links: [],
      createdAt: now,
      updatedAt: now
    };
  }
  function validateCollections(input, { freshIds = false } = {}) {
    if (!Array.isArray(input) || input.length > 2e3)
      throw new Error("Import must contain at most 2,000 collections.");
    let count = 0;
    return input.map((raw) => {
      if (!raw || !Array.isArray(raw.links) || !Array.isArray(raw.groups || []))
        throw new Error("Invalid collection structure.");
      const c = newCollection(raw.name, raw.color);
      c.spaceId = text(raw.spaceId || "main", 100);
      const map = /* @__PURE__ */ new Map();
      if (!freshIds && typeof raw.id === "string") c.id = text(raw.id, 100);
      c.note = text(raw.note, 1e4);
      c.collapsed = !!raw.collapsed;
      c.pinned = !!raw.pinned;
      c.autoUpdate = raw.autoUpdate !== false;
      if (Number.isFinite(raw.createdAt) && raw.createdAt > 0) c.createdAt = raw.createdAt;
      if (Number.isFinite(raw.updatedAt) && raw.updatedAt > 0) c.updatedAt = raw.updatedAt;
      c.groups = (raw.groups || []).map((g) => {
        if (!g || typeof g.id !== "string" || map.has(g.id))
          throw new Error("Invalid or duplicate group ID.");
        const id = freshIds ? uid() : text(g.id, 100);
        map.set(g.id, id);
        return {
          id,
          name: text(g.name) || "Group",
          color: text(g.color, 20),
          collapsed: !!g.collapsed
        };
      });
      const ids = /* @__PURE__ */ new Set();
      c.links = raw.links.map((l) => {
        if (++count > 5e4) throw new Error("Import is limited to 50,000 links.");
        const url = safeURL(l?.url);
        if (!url) throw new Error("An imported link has an unsupported URL.");
        const id = freshIds ? uid() : text(l.id || uid(), 100);
        if (ids.has(id)) throw new Error("Duplicate link ID.");
        ids.add(id);
        return {
          id,
          title: text(l.title || url),
          url,
          note: text(l.note, 1e4),
          groupId: map.get(l.groupId) || null,
          createdAt: Number(l.createdAt) || stamp()
        };
      });
      return c;
    });
  }
  function duplicateCandidates(tabs) {
    const seen = /* @__PURE__ */ new Set(), duplicates = [];
    for (const t of [...tabs].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0)
    )) {
      const url = safeURL(t.resourceUrl || t.pendingUrl || t.url);
      if (!url) continue;
      if (seen.has(url) && !t.pinned) duplicates.push(t.id);
      else seen.add(url);
    }
    return duplicates;
  }
  function score(query, ...values) {
    const q = query.toLocaleLowerCase().trim();
    if (!q) return 1;
    const hay = values.join(" ").toLocaleLowerCase();
    const words = q.split(/\s+/);
    if (!words.every((w) => hay.includes(w))) return 0;
    const title = String(values[0] || "").toLocaleLowerCase();
    return title === q ? 100 : title.startsWith(q) ? 70 : title.includes(q) ? 50 : 20;
  }

  // extension/lib/version.js
  var PROTOCOL = 14;

  // extension/ui/shared.js
  var surface = () => globalThis.__neoSurface || document;
  var $ = (selector, root = surface()) => root.querySelector(selector);
  function revealResult(container, node) {
    if (!node || !container.contains(node)) return;
    const card = node.closest(".switcher-card") || node;
    const bounds = container.getBoundingClientRect(), rect = card.getBoundingClientRect();
    const inset = 8;
    const top = rect.top - bounds.top + container.scrollTop;
    if (rect.top < bounds.top + inset || rect.height > container.clientHeight - inset * 2)
      container.scrollTop = Math.max(0, top - inset);
    else if (rect.bottom > bounds.top + container.clientHeight - inset)
      container.scrollTop = top + rect.height - container.clientHeight + inset;
  }
  async function rpc(action, data = {}) {
    const result = await chrome.runtime.sendMessage({
      action,
      protocol: PROTOCOL,
      data,
      overlayToken: globalThis.__neoOverlayContext?.token
    });
    if (result?.error === "Unknown action." || result?.ok && action === "load" && result.value?.protocol !== PROTOCOL)
      throw new Error(
        "Neo was updated. Reload Neo at chrome://extensions, then refresh the library."
      );
    if (!result?.ok) throw new Error(result?.error || "Neo did not respond. Please reopen the page.");
    return result.value;
  }
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    for (const child of children.flat(Infinity)) {
      if (child !== null && child !== void 0 && child !== false)
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  var icons = {
    audio: "M4 9h4l5-4v14l-5-4H4zM16 8q5 4 0 8M18 5q8 7 0 14",
    search: "M21 21l-5-5 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    plus: "M12 5v14M5 12h14",
    close: "M6 6l12 12M6 18L18 6",
    tray: "M12 3v11m-4-4 4 4 4-4M4 14v6h16v-6",
    sort: "M4 6h16M4 12h11M4 18h6",
    copy: "M8 8h12v12H8zM16 4H4v12",
    broom: "m16 3-5 8m-3-1 7 4-3 7H2l3-10 3-1zM7 14l-2 7m6-5-1 5",
    expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
    restore: "M3 8h5V3M16 3v5h5M21 16h-5v5M8 21v-5H3",
    clear: "M4 4h16v16H4zM8 12h8",
    library: "M3 4h4v16H3zM10 4h4v16h-4zM17 4l4-1 3 16-4 1z",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    chevron: "m9 5 7 7-7 7",
    down: "m5 9 7 7 7-7",
    back: "m14 5-7 7 7 7",
    settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    list: "M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01",
    group: "M3 6h6l2 2h10v12H3z",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    history: "M3 10a9 9 0 1 1 2 8M3 3v7h7M12 7v5l3 2",
    sparkles: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
    external: "M14 3h7v7M21 3 9 15M10 3H3v18h18v-7",
    sun: "M12 3v2M12 19v2M3 12h2M19 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    note: "M4 3h16v18H4zM8 8h8M8 12h8M8 16h5",
    check: "m4 12 5 5L20 6",
    select: "M4 4h16v16H4zM8 12l3 3 5-6",
    ungroup: "M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6M8 8h8v8H8z",
    rename: "m4 16 12-12 4 4-12 12H4zM13 7l4 4",
    pin: "M9 3h6v6l3 4v2H6v-2l3-4zM12 15v6"
  };
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [k, v] of Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.65,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true"
    }))
      svg.setAttribute(k, v);
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", icons[name] || icons.group);
    svg.append(path);
    return svg;
  }
  function button(label, handler, { glyph, quiet = false, className = "", disabled = false, title = label } = {}) {
    return el(
      "button",
      {
        type: "button",
        title,
        disabled,
        "aria-label": label,
        class: (quiet ? "icon-button " : "") + className,
        onclick: handler
      },
      glyph ? icon(glyph) : null,
      quiet ? null : label
    );
  }
  function theme(value) {
    const target = globalThis.__neoSurface?.host || document.documentElement;
    target.dataset.theme = value;
    target.style.setProperty("color-scheme", value === "system" ? "light dark" : value, "important");
  }
  function domain(url) {
    try {
      return new URL(url).hostname || "Local file";
    } catch {
      return "";
    }
  }
  function favicon(item) {
    const pageURL = item.resourceUrl || item.url;
    const mark = el(
      "span",
      {
        class: "favicon",
        style: `--hue:${[...domain(pageURL)].reduce((n, c) => n + c.charCodeAt(0), 0) % 360}`
      },
      String(domain(pageURL) || item.title || "?")[0].toUpperCase()
    );
    if (/^https?:/.test(pageURL || "")) {
      if (globalThis.__neoSurface) {
        if (/^(https?:|data:image\/png;base64,)/.test(item.favIconUrl || ""))
          mark.append(
            el("img", { src: item.favIconUrl, alt: "", onerror: (e) => e.target.remove() })
          );
        return mark;
      }
      const url = new URL(chrome.runtime.getURL("_favicon/"));
      url.searchParams.set("pageUrl", pageURL);
      url.searchParams.set("size", "32");
      const image = el("img", {
        src: url.href,
        alt: "",
        loading: "lazy",
        decoding: "async",
        onerror: () => image.remove()
      });
      mark.append(image);
    }
    return mark;
  }
  function toast(message, { undo, error = false } = {}) {
    let node = $("#toast");
    if (!node) {
      node = el("div", { id: "toast", role: "status" });
      (globalThis.__neoSurface || document.body).append(node);
    }
    node.className = error ? "error" : "";
    node.replaceChildren(
      ...[
        el("span", {}, message),
        undo ? button("Undo", () => undo().catch((e) => toast(e.message, { error: true }))) : null,
        button("Dismiss", () => node.hidden = true, { glyph: "close", quiet: true })
      ].filter(Boolean)
    );
    node.hidden = false;
    clearTimeout(node._timer);
    if (!error && !undo) node._timer = setTimeout(() => node.hidden = true, 5e3);
  }
  function task(fn) {
    return async (event) => {
      try {
        await fn(event);
      } catch (error) {
        toast(error.message, { error: true });
      }
    };
  }
  async function currentWindow() {
    if (globalThis.__neoOverlayContext) return globalThis.__neoOverlayContext.windowId;
    const source = Number(new URLSearchParams(location.search).get("window"));
    if (source > 0) {
      try {
        const w = await chrome.windows.get(source);
        if (w.type === "normal" && !w.incognito) return w.id;
      } catch {
      }
    }
    const tab = await chrome.tabs.getCurrent();
    if (tab) {
      const w = await chrome.windows.get(tab.windowId);
      if (w.type === "normal") return w.id;
    }
    return (await chrome.windows.getLastFocused({ windowTypes: ["normal"] })).id;
  }
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el("a", { href: url, download: name.replace(/[<>:"/\\|?*]/g, "_") });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e4);
  }
  function field(label, input) {
    return el("label", { class: "field" }, el("span", {}, label), input);
  }
  function modal(title, body, actions = []) {
    const previous = surface().activeElement, old = $("#dialog");
    if (old) {
      if (old.open) old.close();
      old.remove();
    }
    const dlg = el("dialog", { id: "dialog" }), close = () => dlg.close();
    dlg.append(
      ...[
        el(
          "header",
          { class: "dialog-head" },
          el("h2", {}, title),
          button("Close", close, { glyph: "close", quiet: true })
        ),
        el("div", { class: "dialog-body" }, body),
        actions.length ? el("footer", {}, actions) : null
      ].filter(Boolean)
    );
    dlg.addEventListener(
      "close",
      () => {
        dlg.remove();
        if (previous?.isConnected) previous.focus();
      },
      { once: true }
    );
    (globalThis.__neoSurface || document.body).append(dlg);
    dlg.showModal();
    return { dialog: dlg, close };
  }
  function popover(title, body, actions = [], { anchor: trigger = surface().activeElement, menu: menu2 = false } = {}) {
    $("#action-popover")?.remove();
    const anchor = trigger?.getBoundingClientRect();
    const panel = el(
      "div",
      {
        id: "action-popover",
        popover: "auto",
        role: menu2 ? "menu" : "dialog",
        "aria-label": title,
        class: "action-popover" + (menu2 ? " action-menu" : "")
      },
      menu2 ? null : el("h2", {}, title),
      body,
      actions.length ? el("footer", {}, actions) : null
    );
    const close = () => {
      panel.hidePopover();
      panel.remove();
      trigger?.setAttribute("aria-expanded", "false");
    };
    (globalThis.__neoSurface || document.body).append(panel);
    panel.style.left = Math.max(12, Math.min(innerWidth - 342, anchor?.left || (innerWidth - 330) / 2)) + "px";
    panel.style.top = Math.max(12, Math.min(innerHeight - 290, (anchor?.bottom || 80) + 8)) + "px";
    panel.showPopover();
    const bounds = panel.getBoundingClientRect();
    panel.style.left = Math.max(
      12,
      Math.min(
        innerWidth - bounds.width - 12,
        (menu2 && anchor ? anchor.right - bounds.width : anchor?.left) || (innerWidth - bounds.width) / 2
      )
    ) + "px";
    panel.style.top = Math.max(12, Math.min(innerHeight - bounds.height - 12, (anchor?.bottom || 80) + 6)) + "px";
    if (menu2) {
      panel.addEventListener("toggle", (e) => {
        if (e.newState === "closed") trigger?.setAttribute("aria-expanded", "false");
      });
      trigger?.setAttribute("aria-haspopup", "menu");
      trigger?.setAttribute("aria-expanded", "true");
      for (const item of panel.querySelectorAll("button")) item.setAttribute("role", "menuitem");
      panel.addEventListener("keydown", (e) => {
        const items = [...panel.querySelectorAll("button:not(:disabled)")];
        const index = items.indexOf(surface().activeElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          items[e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (index + (e.key === "ArrowUp" ? -1 : 1) + items.length) % items.length]?.focus();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
          trigger?.focus();
        }
      });
      panel.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    }
    return { close, dialog: panel };
  }
  function menu(title, entries, { anchor, prefix } = {}) {
    const list = el("div", { class: "menu-items" });
    const { close, dialog } = popover(title, el("div", {}, prefix, list), [], { anchor, menu: true });
    for (const entry of entries) {
      if (!entry) {
        list.append(el("hr"));
        continue;
      }
      const [label, run, glyph, disabled = false] = entry;
      const item = button(
        label,
        task(async () => {
          close();
          await run();
        }),
        { glyph, className: label.startsWith("Delete") || label === "Remove" ? "danger" : "" }
      );
      item.disabled = disabled;
      item.setAttribute("role", "menuitem");
      list.append(item);
    }
    const rect = dialog.getBoundingClientRect(), a = anchor?.getBoundingClientRect();
    dialog.style.top = Math.max(
      12,
      Math.min(innerHeight - rect.height - 12, (a?.bottom || parseFloat(dialog.style.top) - 6) + 6)
    ) + "px";
    dialog.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    return { close, dialog };
  }
  function styleCollectionChoice(node, collection) {
    node.classList.add("collection-choice");
    node.style.setProperty(
      "--collection-color",
      "var(--" + (PALETTE.includes(collection.color) ? collection.color : "blue") + ")"
    );
    node.prepend(el("span", { class: "collection-color", "aria-hidden": "true" }));
    if (collection.pinned) node.append(icon("pin"));
    return node;
  }
  function collectionChoice(collection, onChoose, { detail, ...options } = {}) {
    const row = button(collection.name, onChoose, options);
    row.replaceChildren(
      el(
        "span",
        { class: "collection-copy" },
        el("span", { class: "collection-name switch-name" }, collection.name),
        el(
          "small",
          { class: "collection-detail switch-detail" },
          detail ?? `${collection.links.length} ${collection.links.length === 1 ? "tab" : "tabs"}`
        )
      )
    );
    return styleCollectionChoice(row, collection);
  }

  // extension/lib/collection-workflow.js
  function orderedCollections(collections) {
    return [...collections].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  }

  // extension/lib/search.js
  var COMMANDS = [
    {
      id: "save",
      title: "Save tabs",
      detail: "Save to a new collection, with an optional close step",
      context: false
    },
    {
      id: "save-close",
      title: "Stash tabs",
      detail: "Save with an optional close step",
      context: false
    },
    {
      id: "open",
      title: "Open collection",
      detail: "Add saved tabs to the current window",
      context: true
    },
    {
      id: "switch",
      title: "Switch collection",
      detail: "Choose a collection and whether to retain current tabs",
      context: true
    },
    {
      id: "note",
      title: "Edit continuation note",
      detail: "Remember where to pick up",
      context: true
    },
    {
      id: "export",
      title: "Export collection",
      detail: "Files, Notion or browser bookmarks",
      context: true
    },
    {
      id: "organize",
      title: "Organise with AI",
      detail: "Review a plan before changing anything",
      context: true
    },
    {
      id: "history",
      title: "Search closed pages",
      detail: "Recent browser sessions and retained Neo actions",
      context: false
    },
    {
      id: "recovery",
      title: "Recovery",
      detail: "Recover saved pages or earlier library versions",
      context: false
    },
    {
      id: "settings",
      title: "Settings",
      detail: "Appearance, shortcuts and connections",
      context: false
    },
    {
      id: "import",
      title: "Import collections",
      detail: "Review a portable export before adding it",
      context: false
    }
  ];
  function contextExpression(value, collections) {
    if (!value.startsWith("@")) return null;
    const quoted = value.match(/^@("(?:\\.|[^"\\])*")(?:\s+(.*))?$/s);
    if (quoted) {
      let name;
      try {
        name = JSON.parse(quoted[1]);
      } catch {
        return { partial: value.slice(1) };
      }
      const matches = collections.filter(
        (c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase()
      );
      return matches.length === 1 ? { collection: matches[0], query: quoted[2] || "" } : { partial: name, matches };
    }
    const text2 = value.slice(1);
    const candidates = collections.filter(
      (c) => text2.toLocaleLowerCase() === c.name.toLocaleLowerCase() || text2.toLocaleLowerCase().startsWith(c.name.toLocaleLowerCase() + " ")
    );
    candidates.sort((a, b) => b.name.length - a.name.length);
    if (candidates.length && candidates.filter((c) => c.name.length === candidates[0].name.length).length === 1) {
      return { collection: candidates[0], query: text2.slice(candidates[0].name.length).trimStart() };
    }
    return { partial: text2 };
  }
  function parseQuery(value, collections, chipId = null) {
    const input = String(value).trimStart();
    const chip = collections.find((c) => c.id === chipId) || null;
    const command = input.match(/^\/([a-z-]*)(?:\s+(.*))?$/s);
    if (command) {
      const argument = (command[2] || "").trim();
      const context3 = contextExpression(argument, collections);
      return {
        mode: "commands",
        command: command[1],
        argument,
        context: context3?.collection || chip,
        contextPartial: context3?.partial,
        query: context3?.query || ""
      };
    }
    const context2 = contextExpression(input, collections);
    if (context2)
      return {
        mode: context2.collection && context2.query ? "search" : "contexts",
        context: context2.collection || null,
        query: context2.query || "",
        contextPartial: context2.partial ?? context2.collection?.name ?? ""
      };
    return { mode: "search", query: input.trim(), context: chip };
  }
  function searchResources({ state, tabs, recent = [], closed = [] }, query, contextId = null, windowId = null, limit = 40) {
    const context2 = state.collections.find((c) => c.id === contextId);
    const collections = context2 ? [context2] : state.collections;
    const associated = context2 ? new Set(context2.links.map((l) => l.url)) : null;
    const eligible = tabs.filter(
      (t) => (!state.settings.currentWindowOnly || t.windowId === windowId) && (!associated || associated.has(t.resourceUrl || t.url))
    );
    const rows = [];
    for (const tab of (context2 ? [] : [...eligible]).sort(
      (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)
    )) {
      const rank = score(query, tab.title, tab.resourceUrl || tab.url);
      if (rank)
        rows.push({
          key: `tab:${tab.id}`,
          type: "tab",
          id: tab.id,
          title: tab.title,
          subtitle: tab.resourceUrl || tab.url,
          verb: "Switch",
          rank: rank + 5
        });
    }
    if (query || context2)
      for (const c of collections) {
        if (!context2 && query && score(query, c.name, c.note))
          rows.push({
            key: `collection:${c.id}`,
            type: "collection",
            id: c.id,
            title: c.name,
            subtitle: c.note || `${c.links.length} saved links`,
            verb: "Search in",
            rank: score(query, c.name, c.note)
          });
        for (const link of c.links) {
          const rank = score(query, link.title, link.url, link.note, c.name);
          if (rank)
            rows.push({
              key: `link:${c.id}:${link.id}`,
              type: "link",
              id: link.id,
              collectionId: c.id,
              title: link.title,
              subtitle: link.note || c.name,
              verb: "Open new tab",
              rank
            });
        }
      }
    if (query && !context2) {
      for (const tab of recent)
        if (!associated || associated.has(tab.url)) {
          const rank = score(query, tab.title, tab.url);
          if (rank)
            rows.push({
              key: `session:${tab.sessionId}`,
              type: "session",
              id: tab.sessionId,
              title: tab.title || tab.url,
              subtitle: "Recently closed",
              verb: "Restore",
              rank
            });
        }
      for (const record of closed)
        if (!context2 || record.collectionId === context2.id || associated.has(record.url)) {
          const rank = score(query, record.title, record.url, record.note);
          if (rank)
            rows.push({
              key: `closed:${record.id}`,
              type: "closed",
              id: record.id,
              title: record.title,
              subtitle: "Retained closed page",
              verb: "Restore",
              rank
            });
        }
    }
    return rows.sort((a, b) => b.rank - a.rank).slice(0, limit);
  }

  // extension/ui/search-controller.js
  function createSearchController({
    input,
    results,
    scope,
    getData,
    windowId,
    actions,
    onNavigate = () => {
    },
    onDismiss = () => {
    },
    visualSearch = null,
    escapeDismiss = false,
    onHistory = null,
    onModeChange = () => {
    }
  }) {
    let chipId = null, choices = [], activeKey = null, pendingCommand = null, historyMode = false;
    let closed = [], closedLoaded = false, generation = 0, destroyed = false;
    const id = "search-" + crypto.randomUUID();
    results.id ||= id + "-results";
    results.setAttribute("role", "listbox");
    results.setAttribute("aria-label", "Search results");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", results.id);
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-label", "Search tabs and collections");
    input.placeholder = "Search, @collection, or /command\u2026";
    function setActive(index, { scroll = false } = {}) {
      if (!choices.length) {
        activeKey = null;
        input.removeAttribute("aria-activedescendant");
        return;
      }
      index = Math.max(0, Math.min(index, choices.length - 1));
      activeKey = choices[index].key;
      [...results.querySelectorAll("[role=option]")].forEach((node, i) => {
        node.setAttribute("aria-selected", String(i === index));
        if (i === index) {
          input.setAttribute("aria-activedescendant", node.id);
          if (scroll) revealResult(results, node);
        }
      });
    }
    async function run(choice) {
      try {
        await choice.run();
      } catch (error) {
        toast(error.message, { error: true });
      }
    }
    function rows(items) {
      results.className = "search-results";
      if (items.length && items.every((item) => item.collection || item.type === "collection"))
        results.classList.add("collection-choices");
      choices = items;
      results.replaceChildren(
        ...items.map((item, i) => {
          const row = el(
            "div",
            {
              id: `${id}-option-${i}`,
              role: "option",
              class: "search-result",
              "aria-selected": "false",
              onmousedown: (event) => event.preventDefault(),
              onclick: () => run(item)
            },
            item.icon ? icon(item.icon) : null,
            el(
              "span",
              { class: "row-title" },
              item.title,
              item.subtitle ? el("small", {}, item.subtitle) : null
            ),
            el("span", { class: "badge" }, item.verb || "Choose")
          );
          const collection = item.collection || item.type === "collection" && getData().state.collections.find((c) => c.id === item.id);
          return collection ? styleCollectionChoice(row, collection) : row;
        })
      );
      if (!items.length) results.append(el("p", { class: "empty" }, "No matching pages."));
      input.setAttribute("aria-expanded", String(!!items.length));
      setActive(
        Math.max(
          0,
          items.findIndex((item) => item.key === activeKey)
        )
      );
    }
    function selectContext(c, query = "") {
      chipId = c.id;
      input.value = query;
      if (pendingCommand) {
        const command = pendingCommand;
        pendingCommand = null;
        return invoke(command, c);
      }
      render();
      input.focus();
    }
    function invoke(command, c) {
      const handlers = {
        save: actions.save,
        "save-close": actions.stash,
        open: actions.resume,
        switch: actions.switch,
        note: actions.note,
        export: actions.export,
        organize: actions.ai,
        recovery: actions.recovery,
        settings: actions.settings,
        import: actions.import
      };
      if (command === "history") {
        if (onHistory) {
          input.value = "";
          onHistory();
          return;
        }
        historyMode = true;
        chipId = c?.id || chipId;
        input.value = "";
        render();
        ensureClosed();
        return;
      }
      const definition = COMMANDS.find((x) => x.id === command);
      if (definition?.context && !c) {
        pendingCommand = command;
        input.value = "";
        render();
        input.focus();
        return;
      }
      if (!handlers[command]) throw new Error("Unknown command.");
      return handlers[command](c);
    }
    function contextRows(query) {
      const list = orderedCollections(getData().state.collections).filter(
        (c) => c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
      );
      rows(
        list.slice(0, 80).map((c) => ({
          key: "scope:" + c.id,
          title: c.name,
          collection: c,
          subtitle: `${c.links.length} links`,
          verb: pendingCommand ? "Choose" : "Search in",
          run: () => selectContext(c)
        }))
      );
    }
    function chips(parsed) {
      const c = parsed.context || getData().state.collections.find((c2) => c2.id === chipId);
      const parts = [];
      if (c)
        parts.push(
          button(
            `${c.name} \xD7`,
            () => {
              chipId = null;
              if (input.value.trimStart().startsWith("@")) input.value = parsed.query || "";
              render();
              input.focus();
            },
            { className: "scope-chip" }
          )
        );
      if (pendingCommand)
        parts.push(
          button(
            `${COMMANDS.find((c2) => c2.id === pendingCommand)?.title} \xD7`,
            () => {
              pendingCommand = null;
              render();
              input.focus();
            },
            { className: "scope-chip" }
          )
        );
      if (c && !pendingCommand && !historyMode && parsed.mode !== "commands") {
        const currentSession = getData().sessionState?.active?.[windowId]?.collectionId === c.id;
        parts.push(
          button("Open collection", () => actions.resume(c), {
            glyph: "external",
            title: "Open collection: add its saved tabs to this window"
          })
        );
        parts.push(
          button(
            currentSession ? "Close current collection" : "Swap to collection",
            task(() => currentSession ? actions.closeCollection(c) : actions.swap(c)),
            {
              glyph: currentSession ? "close" : "arrow",
              title: currentSession ? "Save and close this collection\u2019s tabs. Pinned tabs stay open." : "Swap to collection: replace unpinned tabs and keep the current session for a quick return"
            }
          )
        );
      }
      if (c && actions.versions && !pendingCommand && !historyMode && parsed.mode !== "commands")
        parts.push(
          button(
            "Version history",
            task(() => actions.versions(c)),
            { glyph: "history" }
          )
        );
      if (c && !pendingCommand && !historyMode && parsed.mode !== "commands" && actions.update)
        parts.push(
          button(
            "Update collection",
            task(() => actions.update(c)),
            { glyph: "tray", title: "Review new tabs from this window" }
          )
        );
      if (historyMode && parsed.mode !== "commands")
        parts.push(
          button(
            "Closed pages \xD7",
            () => {
              historyMode = false;
              render();
              input.focus();
            },
            { className: "scope-chip" }
          )
        );
      scope.hidden = !parts.length;
      scope.replaceChildren(...parts);
    }
    function choiceFor(item) {
      return {
        ...item,
        run: async () => {
          if (item.type === "collection") {
            selectContext(getData().state.collections.find((c) => c.id === item.id));
            return;
          }
          if (item.type === "tab") await rpc("activate", { tabId: item.id });
          if (item.type === "session") await rpc("restore-session", { sessionId: item.id });
          if (item.type === "closed") await rpc("restore-closed", { id: item.id, windowId });
          if (item.type === "link") {
            await rpc("open-link", {
              collectionId: item.collectionId,
              linkId: item.id,
              windowId
            });
          }
          onNavigate();
        }
      };
    }
    async function ensureClosed() {
      if (closedLoaded) return;
      closedLoaded = true;
      const token = ++generation;
      try {
        const records = await rpc("closed-records");
        if (token === generation && !destroyed) {
          closed = records;
          render();
        }
      } catch (error) {
        if (token === generation && !destroyed) {
          closedLoaded = false;
          toast(error.message, { error: true });
        }
      }
    }
    function render() {
      const data = getData();
      if (!data || destroyed) return;
      if (chipId && !data.state.collections.some((c) => c.id === chipId)) chipId = null;
      const parsed = parseQuery(input.value, data.state.collections, chipId);
      onModeChange(parsed);
      chips(parsed);
      if (pendingCommand) {
        contextRows(input.value.trim());
        return;
      }
      if (parsed.mode === "contexts") {
        contextRows(parsed.contextPartial);
        return;
      }
      if (parsed.mode === "commands") {
        results.className = "search-results";
        const matching = COMMANDS.filter(
          (c) => c.id.startsWith(parsed.command) || c.title.toLocaleLowerCase().includes(parsed.command)
        );
        if (parsed.contextPartial !== void 0) {
          const command = COMMANDS.find((c) => c.id === parsed.command);
          if (command) {
            rows(
              data.state.collections.filter(
                (c) => c.name.toLocaleLowerCase().includes(parsed.contextPartial.toLocaleLowerCase())
              ).slice(0, 80).map((c) => ({
                key: "scope:" + c.id,
                title: c.name,
                collection: c,
                subtitle: command.title,
                verb: "Choose",
                run: () => {
                  chipId = c.id;
                  input.value = "";
                  return invoke(command.id, c);
                }
              }))
            );
            return;
          }
        }
        rows(
          matching.map((c) => ({
            key: "command:" + c.id,
            title: c.title,
            subtitle: parsed.context ? parsed.context.name : c.detail,
            verb: "Choose",
            run: () => invoke(c.id, parsed.context)
          }))
        );
        return;
      }
      if (visualSearch && !parsed.context && !historyMode) {
        choices = [];
        input.removeAttribute("aria-activedescendant");
        visualSearch(parsed.query);
        return;
      }
      results.className = "search-results";
      let found = searchResources(
        { ...data, closed },
        parsed.query,
        parsed.context?.id,
        windowId,
        historyMode ? 200 : 40
      );
      if (historyMode) {
        if (!parsed.query && !parsed.context)
          found = [
            ...data.recent.map((t) => ({
              key: "session:" + t.sessionId,
              type: "session",
              id: t.sessionId,
              title: t.title || t.url,
              subtitle: "Recently closed",
              verb: "Restore"
            })),
            ...closed.map((r) => ({
              key: "closed:" + r.id,
              type: "closed",
              id: r.id,
              title: r.title,
              subtitle: "Retained closed page",
              verb: "Restore"
            }))
          ];
        else found = found.filter((r) => r.type === "session" || r.type === "closed");
      }
      const items = found.slice(0, 40).map(choiceFor);
      if (parsed.query || historyMode) ensureClosed();
      if (parsed.query && !parsed.context && chrome.permissions)
        items.push({
          key: "native-history",
          title: "Search browser history",
          subtitle: "Optional browser permission",
          verb: "Search",
          run: async () => {
            if (!await chrome.permissions.request({ permissions: ["history"] })) return;
            const response = await rpc("history", { query: parsed.query });
            rows(
              response.map((record) => ({
                key: "history:" + record.id,
                title: record.title || record.url,
                subtitle: record.url,
                verb: "Open",
                run: async () => {
                  await rpc("open-url", { url: record.url, windowId });
                  onNavigate();
                }
              }))
            );
          }
        });
      rows(items);
    }
    const onInput = () => {
      activeKey = null;
      render();
    };
    const onKey = (event) => {
      if (event.isComposing) return;
      if (visualSearch && !choices.length && !scope.children.length && !input.value.trimStart().match(/^[@/]/))
        return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const index = choices.findIndex((c) => c.key === activeKey);
        setActive(index + (event.key === "ArrowDown" ? 1 : -1), { scroll: true });
      } else if (event.key === "Enter") {
        if (choices.length) {
          event.preventDefault();
          run(choices.find((c) => c.key === activeKey) || choices[0]);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (escapeDismiss) {
          onDismiss();
          return;
        }
        if (input.value) {
          input.value = "";
          activeKey = null;
          render();
        } else if (pendingCommand) {
          pendingCommand = null;
          render();
        } else if (chipId || historyMode) {
          chipId = null;
          historyMode = false;
          render();
        } else onDismiss();
      }
    };
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKey);
    render();
    return {
      render,
      update: () => {
        generation++;
        closedLoaded = false;
        render();
      },
      focus: () => input.focus(),
      destroy: () => {
        destroyed = true;
        generation++;
        input.removeEventListener("input", onInput);
        input.removeEventListener("keydown", onKey);
      },
      resetContext: () => {
        chipId = null;
        pendingCommand = null;
        historyMode = false;
        render();
      },
      setContext: (id2) => {
        chipId = id2;
        render();
      }
    };
  }

  // extension/lib/providers.js
  var PROVIDERS = {
    openai: {
      name: "OpenAI",
      model: "gpt-5-mini",
      endpoint: "https://api.openai.com/v1/chat/completions"
    },
    claude: {
      name: "Claude (Anthropic)",
      model: "claude-sonnet-5",
      endpoint: "https://api.anthropic.com/v1/messages"
    },
    gemini: {
      name: "Gemini (Google)",
      model: "gemini-2.5-flash",
      endpoint: "https://generativelanguage.googleapis.com"
    },
    deepseek: {
      name: "DeepSeek",
      model: "deepseek-v4-flash",
      endpoint: "https://api.deepseek.com/chat/completions"
    },
    compatible: { name: "Other / OpenAI-compatible", model: "", endpoint: "" }
  };
  function providerEndpoint(settings) {
    const provider = PROVIDERS[settings.provider];
    if (!provider) throw Error("Choose a supported AI provider.");
    return settings.provider === "compatible" ? settings.aiEndpoint : provider.endpoint;
  }
  function aiConnectionId(settings) {
    return settings.provider === "compatible" ? "compatible:" + settings.aiEndpoint : settings.provider;
  }

  // extension/lib/integrations.js
  function endpointOrigin(value) {
    const u = new URL(value);
    if (u.username || u.password || u.hash || u.search)
      throw new Error("Use an endpoint without credentials, query or fragment.");
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
      throw new Error("Use HTTPS, or a local endpoint on this computer.");
    return u.origin;
  }

  // extension/lib/settings.js
  function sanitizeSettings(input = {}, base = initialState().settings) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid saved preferences.");
    const next = { ...base };
    delete next.obsidianVault;
    for (const [key, values] of Object.entries({
      theme: ["system", "light", "dark"],
      tabSort: ["recent", "position", "reverse"],
      view: ["board", "list"],
      provider: ["openai", "claude", "gemini", "deepseek", "compatible"]
    }))
      if (values.includes(input[key])) next[key] = input[key];
    for (const key of ["previewCapture", "currentWindowOnly", "closeAfterStash"])
      if (typeof input[key] === "boolean") next[key] = input[key];
    for (const key of ["model", "notionParent"])
      if (input[key] !== void 0) next[key] = text(input[key], 200);
    if (input.aiEndpoint !== void 0) {
      if (input.aiEndpoint) endpointOrigin(input.aiEndpoint);
      next.aiEndpoint = text(input.aiEndpoint, 1e3);
    }
    if (input.rules !== void 0) {
      if (!Array.isArray(input.rules) || input.rules.length > 50)
        throw new Error("Use at most 50 rules.");
      next.rules = input.rules.map((r) => ({
        id: uid(),
        domain: text(r?.domain, 200).trim().toLowerCase(),
        group: text(r?.group, 100).trim()
      })).filter((r) => r.domain && r.group);
    }
    return next;
  }
  function portableSettings(settings) {
    const clean = sanitizeSettings(settings), keys = Object.keys(initialState().settings);
    return Object.fromEntries(keys.map((key) => [key, clean[key]]));
  }

  // extension/lib/portable.js
  var escapeHTML = (s) => String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
  var escapeMD = (s) => String(s).replace(/[\\\[\]*_`]/g, "\\$&").replace(/\r?\n/g, " ");
  var unescapeMD = (s) => s.replace(/\\([\\\[\]*_`])/g, "$1");
  var entity = (s) => String(s).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n <= 1114111 ? String.fromCodePoint(n) : "";
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[code.toLowerCase()];
  });
  function jsonExport(collections) {
    return JSON.stringify(
      { format: "neo-tabs", version: SCHEMA, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), collections },
      null,
      2
    );
  }
  function recoveryLog(records = []) {
    if (!Array.isArray(records) || records.length > 100)
      throw new Error("A backup can contain at most 100 recovery log entries.");
    return records.map((r) => ({
      id: uid(),
      at: Number(r.at) || Date.now(),
      label: text(r.label, 500),
      status: "archived",
      originalStatus: text(r.originalStatus || r.status, 50)
    }));
  }
  function backupExport(state, journal = []) {
    return JSON.stringify(
      {
        format: "neo-backup",
        spaces: validateSpaces(state.spaces),
        version: 1,
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        collections: validateCollections(state.collections),
        settings: portableSettings(state.settings),
        recovery: recoveryLog((journal.length ? journal : state.importedHistory || []).slice(0, 100))
      },
      null,
      2
    );
  }
  function markdownExport(collections) {
    return collections.map((c) => {
      const lines = [`# ${escapeMD(c.name)}`, "", c.note, ""];
      const render = (links) => {
        for (const l of links) {
          lines.push(`- [${escapeMD(l.title)}](<${l.url.replace(/>/g, "%3E")}>)`);
          if (l.note) lines.push(`  > ${l.note.replace(/\n/g, "\n  > ")}`);
        }
      };
      render(c.links.filter((l) => !l.groupId));
      for (const g of c.groups) {
        lines.push("", `## ${escapeMD(g.name)}`, "");
        render(c.links.filter((l) => l.groupId === g.id));
      }
      return lines.join("\n");
    }).join("\n\n");
  }
  function htmlExport(collections) {
    const rows = [
      "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      "<TITLE>Neo bookmarks</TITLE>",
      "<H1>Neo bookmarks</H1>",
      "<DL><p>"
    ];
    const links = (items) => {
      for (const l of items) {
        rows.push(`<DT><A HREF="${escapeHTML(l.url)}">${escapeHTML(l.title)}</A>`);
        if (l.note) rows.push(`<DD>${escapeHTML(l.note)}`);
      }
    };
    for (const c of collections) {
      rows.push(`<DT><H3>${escapeHTML(c.name)}</H3>`);
      if (c.note) rows.push(`<DD>${escapeHTML(c.note)}`);
      rows.push("<DL><p>");
      links(c.links.filter((l) => !l.groupId));
      for (const g of c.groups) {
        rows.push(`<DT><H3>${escapeHTML(g.name)}</H3>`, "<DL><p>");
        links(c.links.filter((l) => l.groupId === g.id));
        rows.push("</DL><p>");
      }
      rows.push("</DL><p>");
    }
    return [...rows, "</DL><p>"].join("\n");
  }
  function importBookmarkTree(tree) {
    const render = (node) => node.url ? `<DT><A HREF="${escapeHTML(node.url)}">${escapeHTML(node.title || node.url)}</A>` : `${node.title ? `<DT><H3>${escapeHTML(node.title)}</H3>` : ""}<DL>${(node.children || []).map(render).join("\n")}</DL>`;
    return parseImport("<DL>" + tree.map(render).join("\n") + "</DL>", "browser-bookmarks.html");
  }
  function parseImport(source, filename = "import.json") {
    if (typeof source !== "string" || source.length > 20 * 1024 * 1024)
      throw new Error("Choose a text export smaller than 20 MB.");
    const trimmed = source.trim();
    let collections = [], skipped = 0, settings, recovery, spaces;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const data = JSON.parse(trimmed);
      if (["neo-tabs", "neo-backup"].includes(data.format) && data.version !== SCHEMA)
        throw new Error("This backup version is unsupported.");
      if (data.format === "neo-backup") {
        spaces = validateSpaces(data.spaces);
        collections = validateCollections(data.collections, { freshIds: true });
        settings = portableSettings(data.settings);
        recovery = recoveryLog(data.recovery || []);
      } else if (data.format === "neo-tabs")
        collections = validateCollections(data.collections, { freshIds: true });
      else if (Array.isArray(data) && data.every((c) => Array.isArray(c.links)))
        collections = validateCollections(data, { freshIds: true });
      else if (Array.isArray(data.collections) && data.collections.every((c) => Array.isArray(c.cards))) {
        collections = data.collections.map((c) => {
          const dest = newCollection(c.title || c.name);
          dest.links = (c.cards || []).flatMap((l) => {
            const url = safeURL(l.url);
            if (!url) {
              skipped++;
              return [];
            }
            return [
              {
                id: uid(),
                url,
                title: text(l.customTitle || l.title || url),
                note: text(l.description, 1e4),
                groupId: null
              }
            ];
          });
          return dest;
        });
      } else
        throw new Error(
          "Unrecognised JSON export. Choose a Neo backup or supported collection export."
        );
    } else if (/<(?:!DOCTYPE NETSCAPE|DL|H3|A\s)/i.test(trimmed)) {
      const stack = [];
      let pending = null, last = null, fallback = null;
      const tokens = trimmed.match(
        /<H3\b[^>]*>[\s\S]*?<\/H3>|<A\b[^>]*>[\s\S]*?<\/A>|<DD\b[^>]*>[\s\S]*?(?=<(?:DT|DL|\/DL|DD)\b|$)|<\/?DL\b[^>]*>/gi
      ) || [];
      const clean = (s) => entity(s.replace(/<[^>]*>/g, "")).trim();
      for (const token of tokens) {
        if (/^<H3/i.test(token)) {
          pending = { name: clean(token), note: "" };
          last = null;
        } else if (/^<DL/i.test(token)) {
          stack.push(pending);
          pending = null;
          const path = stack.filter(Boolean);
          if (path.length) {
            const first = path[0];
            if (!first.collection) {
              first.collection = newCollection(first.name);
              first.collection.note = first.note;
              collections.push(first.collection);
            }
            if (path.length > 1) {
              const folder = path.at(-1);
              folder.group = {
                id: uid(),
                name: path.slice(1).map((x) => x.name).join(" / "),
                color: "blue",
                collapsed: false
              };
              first.collection.groups.push(folder.group);
            }
          }
        } else if (/^<\/DL/i.test(token)) stack.pop();
        else if (/^<A/i.test(token)) {
          const match = token.match(/\bHREF\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
          const url = safeURL(entity(match?.[1] || match?.[2] || match?.[3] || ""));
          if (!url) {
            skipped++;
            continue;
          }
          const path = stack.filter(Boolean);
          let c;
          if (path.length) {
            c = path[0].collection;
          } else {
            fallback ||= newCollection("Imported bookmarks");
            c = fallback;
            if (!collections.includes(c)) collections.push(c);
          }
          const groupName = path.slice(1).map((x) => x.name).join(" / ");
          let g = path.at(-1)?.group;
          if (groupName && !g) {
            g = { id: uid(), name: groupName, color: "blue", collapsed: false };
            c.groups.push(g);
          }
          last = { id: uid(), url, title: clean(token) || url, note: "", groupId: g?.id || null };
          c.links.push(last);
        } else if (/^<DD/i.test(token)) {
          if (last) last.note = clean(token);
          else if (pending) pending.note = clean(token);
        }
      }
    } else {
      let c = newCollection(filename.replace(/\.[^.]+$/, "")), group = null, last = null;
      collections.push(c);
      for (const line of source.split(/\r?\n/)) {
        if (/^# /.test(line)) {
          if (c.links.length || c.note || c.groups.length) {
            c = newCollection(unescapeMD(line.slice(2)));
            collections.push(c);
          } else c.name = text(unescapeMD(line.slice(2)));
          group = null;
          last = null;
        } else if (/^## /.test(line)) {
          group = {
            id: uid(),
            name: text(unescapeMD(line.slice(3))),
            color: "blue",
            collapsed: false
          };
          c.groups.push(group);
          last = null;
        } else if (/^\s*>/.test(line) && last) {
          last.note += (last.note ? "\n" : "") + line.replace(/^\s*>\s?/, "");
        } else {
          const m = line.match(/^\s*[-*]\s+\[((?:\\.|[^\]])*)\]\(<?([^>\s]+)>\)/) || line.match(/^\s*[-*]\s+\[((?:\\.|[^\]])*)\]\(([^\s)]+)\)/) || line.match(/^(https?:\/\/\S+)\s*\|?\s*(.*)$/);
          if (m) {
            const isMD = /^\s*[-*]/.test(line);
            const url = safeURL(isMD ? m[2] : m[1]);
            if (!url) {
              skipped++;
              continue;
            }
            last = {
              id: uid(),
              title: text((isMD ? m[1] : m[2] || url).replace(/\\([\\\[\]*_`])/g, "$1")),
              url,
              note: "",
              groupId: group?.id || null
            };
            c.links.push(last);
          } else if (line.trim() && !group) c.note += (c.note ? "\n" : "") + line;
        }
      }
    }
    collections = validateCollections(collections, { freshIds: true });
    if (!collections.length && !settings) throw new Error("No collections found in this file.");
    return {
      collections,
      spaces,
      settings,
      recovery,
      skipped,
      links: collections.reduce((n, c) => n + c.links.length, 0)
    };
  }

  // extension/ui/link-picker.js
  function linkPicker(links, { max = links.length, selected = links.length <= max, onChange = () => {
  } } = {}) {
    const picks = new Set(selected ? links.map((l) => l.id) : []);
    let limit = 80;
    const query = el("input", {
      type: "search",
      placeholder: "Find a link\u2026",
      "aria-label": "Filter links"
    }), summary = el("span", { class: "muted" }), list = el("div", { class: "review-list" });
    const select = button(max < links.length ? `Select first ${max}` : "Select all", () => {
      picks.clear();
      links.slice(0, max).forEach((l) => picks.add(l.id));
      render();
    });
    const node = el(
      "div",
      { class: "link-picker" },
      el(
        "div",
        { class: "row" },
        summary,
        select,
        button("Clear", () => {
          picks.clear();
          render();
        })
      ),
      links.length > 12 ? query : null,
      list
    );
    function render() {
      const filtered = links.filter(
        (l) => (l.title + " " + l.url).toLocaleLowerCase().includes(query.value.toLocaleLowerCase())
      );
      summary.textContent = `${picks.size} of ${links.length} selected`;
      onChange(picks.size);
      list.replaceChildren(
        ...filtered.slice(0, limit).map(
          (l) => el(
            "label",
            {},
            el("input", {
              type: "checkbox",
              checked: picks.has(l.id),
              disabled: !picks.has(l.id) && picks.size >= max,
              onchange: (event) => {
                if (event.target.checked && picks.size < max) picks.add(l.id);
                else picks.delete(l.id);
                summary.textContent = `${picks.size} of ${links.length} selected`;
                onChange(picks.size);
                for (const [index, input] of [...list.querySelectorAll("input")].entries())
                  input.disabled = !picks.has(filtered[index].id) && picks.size >= max;
              }
            }),
            el("span", { class: "row-title", title: l.url }, l.title)
          )
        )
      );
      if (filtered.length > limit)
        list.append(
          button("Show more links", () => {
            limit += 80;
            render();
          })
        );
    }
    query.oninput = () => {
      limit = 80;
      render();
    };
    render();
    return { node, ids: () => [...picks] };
  }

  // extension/ui/action-dialogs.js
  function createActionDialogs({ getData, windowId, getTabIds, change, onOpen = () => {
  } }) {
    const data = new Proxy({}, { get: (_, key) => getData()[key] });
    const win = windowId, selectedIds = getTabIds, act = (fn) => task(fn);
    function saveTo(context2, { closeTabs = data.state.settings.closeAfterStash } = {}) {
      const ids = selectedIds().filter((id) => data.tabs.some((t) => t.id === id && !t.pinned));
      if (!ids.length) return toast("Select at least one unpinned tab.", { error: true });
      const check = el("input", { type: "checkbox", checked: closeTabs });
      const save = button(
        "Save tabs",
        act(async () => {
          save.disabled = true;
          try {
            await change("save", {
              tabIds: ids,
              close: check.checked
            });
            close();
          } finally {
            save.disabled = false;
          }
        }),
        { className: "primary" }
      );
      const label = () => {
        save.textContent = check.checked ? "Stash tabs" : "Save tabs";
        save.title = save.textContent;
        save.setAttribute("aria-label", save.textContent);
      };
      check.onchange = label;
      label();
      const { close } = popover(
        `Save ${ids.length} tabs to a new collection`,
        el(
          "div",
          {},
          el(
            "p",
            { class: "hint" },
            "Tip: drag tabs or a group into an existing collection to save them there."
          ),
          el("label", { class: "check-label" }, check, "and close them"),
          el("p", { class: "hint" }, "Pinned tabs stay open. Saved groups are kept together.")
        ),
        [save, button("Cancel", () => close())]
      );
    }
    const opening = /* @__PURE__ */ new Set();
    async function resumeDialog(c, { target = "current", linkIds } = {}) {
      if (!c?.links.length || linkIds && !linkIds.length) return toast("No saved pages to open.");
      const key = c.id + ":" + target;
      if (opening.has(key)) return;
      opening.add(key);
      try {
        const job = await rpc("resume-start", {
          collectionId: c.id,
          linkIds,
          target,
          windowId: win,
          deferred: false
        });
        toast("Opening " + job.total + " tabs\u2026");
        clearTimeout($("#toast")?._timer);
        const cancel = button("Cancel", () => rpc("cancel-operation", { id: job.id }), {
          quiet: false
        });
        $("#toast")?.append(cancel);
        const result = await rpc("resume-run", { id: job.id });
        cancel.remove();
        toast(
          result.created.length + " tabs opened" + (result.failed.length ? " \xB7 " + result.failed.length + " failed" : "") + (result.groupFailures.length ? " \xB7 Some groups could not be restored" : ""),
          { error: !!result.failed.length || !!result.groupFailures.length }
        );
        onOpen();
        if (result.focusFirst && result.created[0])
          await rpc("activate", { tabId: result.created[0] });
      } catch (e) {
        toast(e.message, { error: true });
      } finally {
        opening.delete(key);
      }
    }
    let swapping = false;
    async function closeCollection(collection) {
      if (!collection || swapping) return;
      swapping = true;
      try {
        return await change("close-collection", { collectionId: collection.id, windowId: win });
      } finally {
        swapping = false;
      }
    }
    async function swapCollection(collection) {
      if (!collection || swapping) return;
      swapping = true;
      try {
        const result = await change("switch", {
          destinationId: collection.id,
          windowId: win,
          saveCurrent: true,
          requestId: uid(),
          focusPage: !!globalThis.__neoOverlayContext
        });
        if (result?.status === "partial" || result?.cancelled || result?.failed?.length)
          throw new Error("Swap incomplete. Review Previously open before trying again.");
        onOpen();
        return result;
      } finally {
        swapping = false;
      }
    }
    function switchDialog() {
      const trigger = globalThis.__neoSurface?.activeElement || document.activeElement;
      const ids = data.tabs.filter((t) => t.windowId === win && !t.pinned).map((t) => t.id);
      let running = false, requestId;
      const search = el("input", {
        type: "search",
        placeholder: "Search collections\u2026",
        "aria-label": "Search collections"
      });
      const saveCurrent = el("input", {
        type: "checkbox",
        checked: !!ids.length,
        disabled: !ids.length
      });
      const list = el("div", {
        class: "switch-choices collection-choices",
        "aria-label": "Collections"
      });
      const status = el("p", { class: "hint", role: "status" });
      const retained = (data.sessionState?.retained || []).filter((x) => x.key.startsWith(win + ":"));
      const collections = [
        ...orderedCollections(data.state.collections),
        ...retained.filter((x) => !data.state.collections.some((c) => c.id === x.id))
      ];
      function render() {
        const query = search.value.trim().toLocaleLowerCase();
        const matches = collections.filter((x) => x.name.toLocaleLowerCase().includes(query));
        list.replaceChildren(
          ...matches.map((collection) => {
            const space = data.state.spaces?.find((x) => x.id === collection.spaceId)?.name;
            const choose = collectionChoice(
              collection,
              act(async () => {
                if (running) return;
                running = true;
                requestId = uid();
                search.disabled = saveCurrent.disabled = true;
                for (const row of list.querySelectorAll("button")) row.disabled = true;
                status.textContent = "Switching to " + collection.name + "\u2026";
                try {
                  const result = await change("switch", {
                    requestId,
                    tabIds: ids,
                    destinationId: collection.id,
                    saveCurrent: saveCurrent.checked,
                    focusPage: !!globalThis.__neoOverlayContext,
                    windowId: win
                  });
                  if (result.status === "partial" || result.failed?.length || result.groupFailures?.length || result.cancelled)
                    throw new Error("Switch incomplete. Check Recovery before trying again.");
                  running = false;
                  close();
                  onOpen();
                } catch (error) {
                  status.textContent = error.message;
                } finally {
                  running = false;
                  search.disabled = false;
                  saveCurrent.disabled = !ids.length;
                  for (const row of list.querySelectorAll("button")) row.disabled = false;
                }
              }),
              {
                detail: `${data.sessionState?.active?.[win]?.collectionId === collection.id ? "Current \xB7 " : retained.some((x) => x.id === collection.id) ? "Resume \xB7 " : ""}${collection.links.length} tabs${space ? " \xB7 " + space : ""}`
              }
            );
            return choose;
          })
        );
        status.textContent = matches.length ? "" : collections.length ? "No matching collections." : "No saved collections with tabs yet.";
      }
      search.oninput = render;
      render();
      const { close, dialog } = popover(
        "Switch collection",
        el(
          "div",
          { class: "switch-picker" },
          search,
          el("label", { class: "check-label" }, saveCurrent, "Save current tabs"),
          el(
            "p",
            { class: "hint switch-explanation" },
            "Save keeps a snapshot for switching back. Tabs are replaced in this window; pinned tabs stay."
          ),
          list,
          status
        ),
        [
          button("Cancel", () => {
            close();
          })
        ]
      );
      dialog.addEventListener("toggle", (e) => {
        if (e.newState === "closed" && running)
          rpc("cancel-operation", { id: requestId }).catch(() => {
          });
      });
      dialog.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
          trigger?.focus();
          return;
        }
        if (running) return;
        const rows = [...list.querySelectorAll("button")];
        const index = rows.indexOf(e.target);
        if ((e.target === search || index >= 0) && ["ArrowDown", "ArrowUp"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "ArrowUp" && index <= 0) search.focus();
          else rows[Math.min(rows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))]?.focus();
        } else if ((e.target === search || index >= 0) && e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          rows[Math.max(0, index)]?.click();
        }
      });
      search.focus({ preventScroll: true });
    }
    function importDialog() {
      const input = el("input", { type: "file", accept: ".json,.html,.htm,.md,.markdown,.txt" });
      input.onchange = act(async () => {
        const f = input.files[0];
        if (!f) return;
        if (f.size > 20 * 1024 * 1024) throw new Error("Choose a file smaller than 20 MB.");
        previewImport(parseImport(await f.text(), f.name));
      });
      focusedDialog(
        "Import data",
        el(
          "div",
          { class: "transfer-options" },
          el(
            "p",
            { class: "hint" },
            "Bring your saved work into Neo. Your current collections are kept."
          ),
          button(
            "Import browser bookmarks",
            act(async () => {
              if (!await chrome.permissions.request({ permissions: ["bookmarks"] })) return;
              previewImport(importBookmarkTree(await rpc("bookmarks-read")));
            }),
            { glyph: "library", className: "transfer-primary" }
          ),
          el(
            "details",
            {},
            el("summary", {}, "Import from a file"),
            el(
              "p",
              { class: "hint" },
              "Neo backup, bookmark HTML, Markdown, Toby JSON or OneTab text."
            ),
            field("Choose a file", input)
          ),
          button("Switch to Export & backup", backupDialog)
        )
      );
    }
    function previewImport(result) {
      const preferences = el("input", { type: "checkbox" });
      const { close } = modal(
        "Review import",
        el(
          "div",
          {},
          el(
            "p",
            {},
            `${result.collections.length} collections \xB7 ${result.links} links${result.skipped ? ` \xB7 ${result.skipped} unsupported links skipped` : ""}`
          ),
          el(
            "div",
            { class: "review-list" },
            result.collections.map((c) => el("p", {}, `${c.name} \xB7 ${c.links.length}`))
          ),
          el("p", { class: "hint" }, "Imported collections are added as separate copies."),
          result.settings ? el(
            "label",
            { class: "check-label" },
            preferences,
            "Restore saved preferences and domain rules"
          ) : null,
          result.settings ? el(
            "p",
            { class: "hint" },
            "Keys and website permissions are not in backups. Automatic preview capture stays off until enabled in Settings. Recovery log entries are imported for reference; old browser actions are never replayed."
          ) : null
        ),
        [
          button(
            "Import collections",
            act(async () => {
              await change("import", {
                collections: result.collections,
                spaces: result.spaces,
                settings: preferences.checked ? result.settings : void 0,
                recovery: result.recovery
              });
              close();
            }),
            { className: "primary" }
          )
        ]
      );
    }
    function exportDialog(c, trigger) {
      const { close, dialog } = popover(
        `Export ${c.name}`,
        el(
          "div",
          {},
          el(
            "div",
            { class: "actions" },
            button("Markdown", () => download(markdownExport([c]), c.name + ".md", "text/markdown")),
            button("Bookmark HTML", () => download(htmlExport([c]), c.name + ".html", "text/html")),
            button("Neo JSON", () => download(jsonExport([c]), c.name + ".json", "application/json")),
            button(
              "Copy Markdown",
              act(async () => {
                await navigator.clipboard.writeText(markdownExport([c]));
                toast("Markdown copied");
              })
            ),
            button("Send to Notion\u2026", () => notionDialog(c)),
            button(
              "Export to browser bookmarks\u2026",
              act(async () => {
                if (!await chrome.permissions.request({ permissions: ["bookmarks"] })) return;
                const tree = await rpc("bookmarks-read");
                const select = el("select");
                function folders(n, depth = 0) {
                  if (!n.url && n.id !== "0")
                    select.append(el("option", { value: n.id }, "\u2014 ".repeat(depth) + n.title));
                  for (const child of n.children || []) if (!child.url) folders(child, depth + 1);
                }
                tree.forEach((n) => folders(n));
                const { close: close2 } = popover(
                  "Export browser bookmarks",
                  field("Create a new group inside", select),
                  [
                    button(
                      "Create bookmarks",
                      act(async () => {
                        await change("bookmarks-export", {
                          collectionId: c.id,
                          parentId: select.value
                        });
                        close2();
                      }),
                      { className: "primary" }
                    )
                  ]
                );
              })
            )
          )
        ),
        [],
        { menu: true, anchor: trigger }
      );
      dialog.addEventListener("click", (e) => {
        if (e.target.closest("button")) close();
      });
    }
    function notionDialog(c) {
      const parent = el("input", {
        value: data.state.settings.notionParent,
        placeholder: "Destination page ID"
      });
      const { close } = modal(
        "Send a snapshot to Notion",
        el(
          "div",
          {},
          el(
            "p",
            {},
            `Create a new page containing ${c.links.length} links and notes. People with access to the parent page may see this content.`
          ),
          field("Destination page ID", parent),
          el(
            "p",
            { class: "hint" },
            "Share the parent page with your internal integration first. Configure its token in Settings."
          )
        ),
        [
          button(
            "Create Notion page",
            act(async () => {
              if (!await chrome.permissions.request({ origins: ["https://api.notion.com/*"] }))
                return;
              const result = await rpc("notion-export", {
                collectionId: c.id,
                parent: parent.value.trim()
              });
              close();
              runNotion(result);
            }),
            { className: "primary" }
          )
        ]
      );
    }
    function runNotion(initial, resume = false) {
      let running = true, job = initial;
      const status = el("p", { role: "status" }), link = el("div"), progress = el("progress", { max: Math.max(1, job.total), value: job.cursor });
      const { dialog, close } = modal(
        "Export to Notion",
        el(
          "div",
          {},
          status,
          progress,
          link,
          el(
            "p",
            { class: "hint" },
            "You can pause between batches and continue from Recovery. A request already sent may finish after this dialog closes."
          )
        ),
        [
          button("Pause", () => {
            running = false;
            close();
          })
        ]
      );
      dialog.addEventListener(
        "close",
        () => {
          running = false;
        },
        { once: true }
      );
      async function run() {
        try {
          while (running) {
            status.textContent = `${job.cursor} of ${job.total} blocks sent`;
            progress.value = job.cursor;
            if (job.remoteURL)
              link.replaceChildren(
                el(
                  "a",
                  { href: job.remoteURL, target: "_blank", rel: "noreferrer" },
                  "Open the Notion page"
                )
              );
            if (job.status === "complete") {
              status.textContent = "Snapshot exported to Notion.";
              dialog.querySelector("footer").replaceChildren(button("Done", close));
              return;
            }
            if (!resume && ["partial", "failed", "uncertain", "sending"].includes(job.status)) {
              status.textContent = job.error || "This request may already be in Notion. Inspect the destination before taking another action.";
              dialog.querySelector("footer").replaceChildren(button("Close", close));
              return;
            }
            if (job.retryAt > Date.now()) {
              status.textContent = `${job.cursor} of ${job.total} blocks sent \xB7 waiting for Notion`;
              await new Promise(
                (resolve) => setTimeout(resolve, Math.min(1e3, job.retryAt - Date.now()))
              );
              continue;
            }
            job = await rpc("notion-step", { id: job.id, resume });
            resume = false;
          }
        } catch (error) {
          if (running) {
            status.textContent = error.message;
            dialog.querySelector("footer").replaceChildren(button("Close", close));
          }
        }
      }
      run();
    }
    function aiDialog(c, { linkIds } = {}) {
      const instruction = el("textarea", {
        value: "Group these links by project. Leave uncertain links ungrouped."
      }), picks = linkPicker(linkIds ? c.links.filter((l) => linkIds.includes(l.id)) : c.links, {
        max: 300
      });
      const requestId = uid(), status = el("p", { class: "hint", role: "status" });
      let running = false, cancelled = false;
      const generate = button(
        "Generate a plan",
        act(async () => {
          if (!picks.ids().length) throw new Error("Select between 1 and 300 links.");
          generate.disabled = true;
          running = true;
          status.textContent = "Preparing your organisation plan\u2026";
          try {
            const plan = await rpc("ai-plan", {
              requestId,
              collectionId: c.id,
              linkIds: picks.ids(),
              instruction: instruction.value
            });
            if (!cancelled) {
              running = false;
              close();
              reviewPlan(c, plan);
            }
          } catch (error) {
            if (!cancelled) status.textContent = error.message;
          } finally {
            running = false;
            generate.disabled = false;
          }
        }),
        { className: "primary" }
      );
      const { dialog, close } = modal(
        "Organise with AI",
        el(
          "div",
          {},
          !data.connections.ai ? el(
            "div",
            { class: "ai-setup" },
            el(
              "p",
              { class: "hint" },
              "Connect an AI provider in AI connection settings before generating a plan."
            ),
            button("AI connection settings", () => settingsDetails("AI connection"))
          ) : null,
          el(
            "p",
            {},
            `Send selected link titles, URLs and notes to ${PROVIDERS[data.state.settings.provider]?.name || "your configured provider"}.`
          ),
          el(
            "p",
            { class: "hint" },
            "Choose up to 300 links. Page contents, previews, other collections and browser history are excluded."
          ),
          picks.node,
          field("Instruction", instruction),
          status
        ),
        [
          button("Cancel", () => {
            cancelled = true;
            close();
          }),
          generate
        ]
      );
      dialog.addEventListener(
        "close",
        () => {
          cancelled = true;
          if (running) rpc("ai-cancel", { requestId }).catch(() => {
          });
        },
        { once: true }
      );
    }
    function reviewPlan(c, plan) {
      const groups = plan.groups.map((g) => {
        const check = el("input", {
          type: "checkbox",
          checked: true,
          onchange: (e) => g.accepted = e.target.checked
        });
        return el(
          "div",
          { class: "plan-group" },
          el(
            "div",
            { class: "row" },
            check,
            el("input", {
              value: g.name,
              "aria-label": "Proposed group name",
              oninput: (e) => g.name = e.target.value
            })
          ),
          el(
            "ul",
            {},
            g.linkIds.map(
              (id) => el("li", {}, c.links.find((l) => l.id === id)?.title || "Unknown link")
            )
          )
        );
      });
      const note = el("textarea", { value: plan.note, oninput: (e) => plan.note = e.target.value }), applyNote = el("input", { type: "checkbox" });
      const { close } = modal(
        "Review your organisation plan",
        el(
          "div",
          {},
          groups,
          el(
            "label",
            { class: "check-label" },
            applyNote,
            "Replace the collection note with this draft"
          ),
          note
        ),
        [
          button(
            "Apply selected changes",
            act(async () => {
              await change("ai-apply", { plan, applyNote: applyNote.checked });
              close();
            }),
            { className: "primary" }
          )
        ]
      );
    }
    function recoveryDialog() {
      modal(
        "Recovery",
        el(
          "div",
          {},
          el(
            "p",
            { class: "hint" },
            "Recover saved URLs and groups. Unsaved form or app state cannot be restored. Interrupted actions are never replayed automatically."
          ),
          data.journal.map(
            (op) => el(
              "div",
              { class: "recovery-row" },
              el(
                "div",
                { class: "row" },
                el("strong", {}, op.label),
                el("small", {}, new Date(op.at).toLocaleString())
              ),
              el(
                "p",
                {},
                op.kind === "notion" ? `${op.cursor} / ${op.total} blocks \xB7 ${op.status}` : op.status
              ),
              op.error ? el("p", {}, op.error) : null,
              op.kind === "notion" && ["ready", "waiting", "partial", "failed"].includes(op.status) ? button("Continue export", () => runNotion(op, true)) : null,
              op.kind === "notion" && ["sending", "uncertain"].includes(op.status) ? el(
                "p",
                { class: "hint" },
                "A batch may already be in Notion. Inspect the destination; it will not be sent again automatically."
              ) : null,
              op.recoverable ? button(
                "Recover pages",
                act(() => change("recover", { id: op.id, windowId: win }))
              ) : null,
              op.undoable ? button(
                "Restore earlier collection\u2026",
                act(() => recoverLibrary(op))
              ) : null,
              (op.undoable || op.closed?.length) && op.status !== "undone" ? button(
                "Undo action",
                act(() => change("undo-action", { id: op.id, windowId: win }))
              ) : null,
              op.remoteURL ? el("a", { href: op.remoteURL, target: "_blank", rel: "noreferrer" }, "Open export") : null
            )
          )
        )
      );
    }
    function focusedDialog(title, body, actions = []) {
      const result = modal(title, body, actions);
      result.dialog.classList.add("settings-detail");
      const focus = body.querySelector("input:not([type=file]), select, textarea") || result.dialog.querySelector("h2");
      if (focus.tagName === "H2") focus.tabIndex = -1;
      focus.focus({ preventScroll: true });
      return result;
    }
    function backupDialog() {
      focusedDialog(
        "Export & backup",
        el(
          "div",
          { class: "transfer-options" },
          el(
            "p",
            { class: "hint" },
            "Keep a copy of your collections, notes, preferences and recovery log. API keys are excluded."
          ),
          button(
            "Download Neo backup",
            () => download(backupExport(data.state, data.journal), "neo-backup.json", "application/json"),
            { glyph: "tray", className: "transfer-primary" }
          ),
          el(
            "details",
            {},
            el("summary", {}, "Other formats"),
            el(
              "div",
              { class: "transfer-formats" },
              button(
                "Bookmark HTML",
                () => download(htmlExport(data.state.collections), "neo-bookmarks.html", "text/html")
              ),
              button(
                "Markdown",
                () => download(
                  markdownExport(data.state.collections),
                  "neo-collections.md",
                  "text/markdown"
                )
              )
            )
          ),
          button("Switch to Import data", importDialog)
        )
      );
    }
    function settingsDialog() {
      const s = data.state.settings;
      const body = el("div", { class: "settings-list" });
      let close;
      const row = (label, run, glyph) => button(
        label,
        () => {
          close();
          run();
        },
        { glyph, className: "settings-entry" }
      );
      const preference = (label, name, options) => {
        const select = el(
          "select",
          { "aria-label": label },
          options.map(([value, text2]) => el("option", { value, selected: s[name] === value }, text2))
        );
        select.onchange = act(async () => {
          select.disabled = true;
          try {
            await change("settings", { settings: { [name]: select.value } });
          } finally {
            select.disabled = false;
          }
        });
        return el("label", { class: "settings-preference" }, el("span", {}, label), select);
      };
      const toggle = (label, name) => {
        const check = el("input", {
          type: "checkbox",
          role: "switch",
          checked: !!s[name],
          "aria-label": label
        });
        check.onchange = act(async () => {
          const value = check.checked;
          check.disabled = true;
          try {
            if (name === "previewCapture" && value && !await chrome.permissions.request({ origins: ["<all_urls>"] })) {
              check.checked = false;
              toast("Preview access was not enabled");
              return;
            }
            await change("settings", { settings: { [name]: value } });
          } catch (error) {
            check.checked = !value;
            throw error;
          } finally {
            check.disabled = false;
          }
        });
        return el("label", { class: "settings-preference" }, el("span", {}, label), check);
      };
      body.append(
        preference("Theme", "theme", [
          ["system", "System"],
          ["light", "Light"],
          ["dark", "Dark"]
        ]),
        toggle("Show this window only", "currentWindowOnly"),
        toggle("Capture page previews", "previewCapture"),
        el("hr"),
        row("AI connection", () => settingsDetails("AI connection"), "sparkles"),
        row("Notion", () => settingsDetails("Notion"), "note"),
        row("Domain rules", () => settingsDetails("Domain rules"), "group"),
        el("hr"),
        row("Import data", importDialog, "plus"),
        row("Export & backup", backupDialog, "tray"),
        row("Privacy & permissions", () => settingsDetails("Data & permissions"), "settings"),
        el("hr"),
        row(
          "Keyboard shortcuts",
          () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }),
          "external"
        ),
        row(
          "Help & privacy",
          () => chrome.tabs.create({ url: chrome.runtime.getURL("help.html") }),
          "external"
        )
      );
      const result = popover("Settings", body);
      close = result.close;
      result.dialog.classList.add("settings-menu");
      const bounds = result.dialog.getBoundingClientRect();
      result.dialog.style.left = Math.max(12, Math.min(innerWidth - bounds.width - 12, bounds.left)) + "px";
      result.dialog.style.top = Math.max(12, Math.min(innerHeight - bounds.height - 12, bounds.top)) + "px";
      const trigger = $("#settings");
      trigger?.setAttribute("aria-expanded", "true");
      result.dialog.addEventListener("toggle", (e) => {
        if (e.newState === "closed") trigger?.setAttribute("aria-expanded", "false");
      });
      result.dialog.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
          trigger?.focus();
        }
      });
      body.querySelector("select").focus({ preventScroll: true });
    }
    function settingsDetails(sectionName = "AI connection") {
      const s = data.state.settings;
      const fields = {};
      const input = (name, type = "text") => fields[name] = el("input", { value: s[name] || "", type });
      const select = (name, choices) => fields[name] = el(
        "select",
        {},
        choices.map(
          (v) => el(
            "option",
            { value: v, selected: s[name] === v },
            name === "provider" ? PROVIDERS[v].name : v[0].toUpperCase() + v.slice(1)
          )
        )
      );
      const aiKey = el("input", {
        type: "password",
        autocomplete: "off",
        placeholder: data.connections.ai ? "Saved \xB7 leave blank to keep" : "Your API key"
      }), notionKey = el("input", {
        type: "password",
        autocomplete: "off",
        placeholder: data.connections.notion ? "Saved \xB7 leave blank to keep" : "Your internal integration token"
      });
      const rules = el("textarea", {
        rows: 3,
        value: s.rules.map((r) => `${r.domain} => ${r.group}`).join("\n"),
        placeholder: "github.com => Development"
      });
      const body = el(
        "div",
        {},
        el(
          "section",
          { class: "settings-section" },
          el("h3", {}, "AI connection"),
          field("Provider", select("provider", Object.keys(PROVIDERS))),
          field("Model", input("model")),
          field("Compatible endpoint (complete chat/completions URL)", input("aiEndpoint")),
          field("API key", aiKey),
          el(
            "p",
            { class: "hint" },
            "Calls go directly to your provider only when requested. Keys stay in extension-local storage, outside backups; they are not encrypted by an OS keychain."
          ),
          button(
            "Forget AI key",
            act(async () => {
              await change("credentials", {
                aiKey: "",
                aiProvider: fields.provider.value,
                aiEndpoint: fields.aiEndpoint.value
              });
              aiKey.value = "";
              updateProvider();
            })
          )
        ),
        el(
          "section",
          { class: "settings-section" },
          el("h3", {}, "Notion"),
          field("Notion integration token", notionKey),
          field("Notion parent page ID", input("notionParent")),
          button(
            "Forget Notion token",
            act(() => change("credentials", { notionKey: "" }))
          )
        ),
        el(
          "section",
          { class: "settings-section" },
          el("h3", {}, "Domain rules"),
          field("One domain => group per line", rules),
          el(
            "p",
            { class: "hint" },
            "Rules run only when you choose Apply domain rules in a collection menu."
          )
        ),
        el(
          "section",
          { class: "settings-section" },
          el("h3", {}, "Data & permissions"),
          button("Export & backup", backupDialog),
          button(
            "Enable browser history search",
            act(async () => {
              const granted = await chrome.permissions.request({ permissions: ["history"] });
              toast(granted ? "History search enabled" : "History access was not enabled");
            })
          ),
          button(
            "Revoke optional access",
            act(async () => {
              const p = await chrome.permissions.getAll();
              await chrome.permissions.remove({
                origins: p.origins || [],
                permissions: (p.permissions || []).filter(
                  (x) => ["history", "bookmarks"].includes(x)
                )
              });
              await change("settings", { settings: { previewCapture: false } });
              toast("Optional access revoked");
            })
          ),
          el(
            "p",
            { class: "hint" },
            "No account, telemetry or server is required. Export a backup before uninstalling, which removes this extension\u2019s local data."
          )
        )
      );
      const section = [...body.querySelectorAll(".settings-section")].find(
        (node) => node.querySelector("h3").textContent === sectionName
      );
      section.querySelector("h3").remove();
      body.replaceChildren(section);
      if (sectionName === "Data & permissions") {
        section.prepend(
          el(
            "p",
            { class: "hint" },
            "Previews stay on this device. Only active pages are captured. The cache is limited to 50 MB."
          ),
          button(
            "Clear cached previews",
            act(() => change("clear-previews", {}))
          )
        );
      }
      function draftConnection() {
        return { provider: fields.provider.value, aiEndpoint: fields.aiEndpoint.value };
      }
      function updateProvider(reset = false) {
        if (sectionName !== "AI connection") return;
        const provider = PROVIDERS[fields.provider.value];
        if (reset) {
          fields.model.value = provider.model;
          fields.aiEndpoint.value = provider.endpoint;
          aiKey.value = "";
        }
        fields.aiEndpoint.closest(".field").hidden = fields.provider.value !== "compatible";
        aiKey.placeholder = data.connections.aiProviders?.[aiConnectionId(draftConnection())] ? "Saved for this provider \xB7 leave blank to keep" : "API key for " + provider.name;
      }
      if (sectionName === "AI connection") {
        fields.provider.onchange = () => updateProvider(true);
        fields.aiEndpoint.oninput = () => updateProvider();
        updateProvider();
      }
      const activeFields = Object.fromEntries(
        Object.entries(fields).filter(([, node]) => section.contains(node))
      );
      const { close } = focusedDialog(
        sectionName === "Data & permissions" ? "Privacy & permissions" : sectionName,
        body,
        sectionName === "Data & permissions" ? [] : [
          button(
            "Save settings",
            act(async () => {
              const settings = Object.fromEntries(
                Object.entries(activeFields).map(([k, v]) => [k, v.value])
              );
              if (sectionName === "Domain rules")
                settings.rules = rules.value.split("\n").filter((x) => x.trim()).map((line) => {
                  const [domain2, ...parts] = line.split("=>");
                  if (!parts.length) throw new Error("Use domain => group for each rule.");
                  return { domain: domain2.trim(), group: parts.join("=>").trim() };
                });
              const origins = [];
              if (sectionName === "AI connection" && (aiKey.value.trim() || data.connections.aiProviders?.[aiConnectionId(settings)] || settings.provider === "compatible" && settings.aiEndpoint))
                origins.push(endpointOrigin(providerEndpoint(settings)) + "/*");
              if (sectionName === "Notion" && notionKey.value.trim())
                origins.push("https://api.notion.com/*");
              if (origins.length && !await chrome.permissions.request({ origins: [...new Set(origins)] }))
                throw new Error("Permission was not granted. Settings were not saved.");
              await change("settings", { settings });
              const credentials = {};
              if (sectionName === "AI connection" && aiKey.value.trim())
                Object.assign(credentials, {
                  aiKey: aiKey.value.trim(),
                  aiProvider: settings.provider,
                  aiEndpoint: settings.aiEndpoint
                });
              if (sectionName === "Notion" && notionKey.value.trim())
                credentials.notionKey = notionKey.value.trim();
              if (Object.keys(credentials).length) await change("credentials", credentials);
              close();
            }),
            { className: "primary" }
          )
        ]
      );
    }
    function noteDialog(c) {
      const input = el("textarea", {
        value: c.note,
        rows: 7,
        maxLength: 1e4,
        "aria-label": "Continuation note"
      });
      const { close } = popover("Note \xB7 " + c.name, input, [
        button(
          "Save note",
          act(async () => {
            await change("edit", { kind: "collection", collectionId: c.id, note: input.value });
            close();
          }),
          { className: "primary" }
        )
      ]);
    }
    async function recoverLibrary(op) {
      const collections = await rpc("library-snapshot", { id: op.id });
      const selected = /* @__PURE__ */ new Set();
      const list = el(
        "div",
        { class: "review-list" },
        collections.map(
          (c) => el(
            "label",
            {},
            el("input", {
              type: "checkbox",
              onchange: (event) => event.target.checked ? selected.add(c.id) : selected.delete(c.id)
            }),
            el("span", { class: "row-title" }, c.name),
            el("small", {}, `${c.links.length} links`)
          )
        )
      );
      const { close } = modal(
        "Restore an earlier collection",
        el(
          "div",
          {},
          el(
            "p",
            { class: "hint" },
            "Choose collections from before this action. They are restored as separate copies, keeping your current work."
          ),
          list
        ),
        [
          button(
            "Restore selected copies",
            act(async () => {
              if (!selected.size) throw new Error("Choose a collection first.");
              await change("restore-library", { id: op.id, collectionIds: [...selected] });
              close();
            }),
            { className: "primary" }
          )
        ]
      );
    }
    async function updateCollection(context2) {
      const plan = await rpc("collection-update-preview", {
        collectionId: context2.id,
        windowId: win
      });
      const picked = new Set(plan.additions.map((l) => l.url));
      const status = el("p", { class: "hint", role: "status" });
      const commit = button(
        "",
        act(async () => {
          commit.disabled = true;
          try {
            await change("collection-update", {
              collectionId: context2.id,
              windowId: win,
              expectedRevision: plan.revision,
              signature: plan.signature,
              urls: [...picked]
            });
            close();
          } catch (error) {
            status.textContent = error.message;
          } finally {
            commit.disabled = !picked.size;
          }
        }),
        { className: "primary" }
      );
      const updateLabel = () => {
        commit.textContent = "Add " + picked.size + (picked.size === 1 ? " tab" : " tabs");
        commit.setAttribute("aria-label", commit.textContent);
        commit.disabled = !picked.size;
      };
      const body = el(
        "div",
        {},
        el("p", { class: "hint" }, `Current window \xB7 ${plan.currentCount} unpinned tabs`),
        el("p", {}, `${plan.additions.length} new \xB7 ${plan.alreadySaved} already saved`),
        el(
          "p",
          { class: "hint" },
          "Adds selected tabs. Existing saved links, custom titles and notes are kept."
        ),
        el(
          "div",
          { class: "collection-update-list" },
          plan.additions.map(
            (link) => el(
              "label",
              { class: "collection-update-row", title: link.url },
              el("input", {
                type: "checkbox",
                checked: true,
                "aria-label": "Add " + link.title,
                onchange: (e) => {
                  e.target.checked ? picked.add(link.url) : picked.delete(link.url);
                  updateLabel();
                }
              }),
              favicon(link),
              el("span", {}, el("strong", {}, link.title), el("small", {}, domain(link.url)))
            )
          )
        ),
        !plan.additions.length ? el(
          "p",
          {},
          plan.currentCount ? "All current tabs are already saved." : "No open pages to add from this window."
        ) : null,
        status
      );
      const { close } = modal("Update " + context2.name, body, [
        button("Cancel", () => close()),
        button(
          "Review again",
          act(() => updateCollection(context2))
        ),
        commit
      ]);
      updateLabel();
    }
    async function collectionVersions(c) {
      const rows = await rpc("collection-versions", { collectionId: c.id });
      const body = el("div", { class: "collection-versions" });
      body.append(
        el(
          "p",
          { class: "hint" },
          "Previous versions of " + c.name + ". Restoring keeps the current version in this history."
        )
      );
      for (const row of rows) {
        const details = el(
          "details",
          { class: "session-entry collection-version", dataset: { versionId: row.id } },
          el(
            "summary",
            {},
            new Date(row.at).toLocaleString(),
            el(
              "small",
              {},
              `${row.snapshot.links.length} ${row.snapshot.links.length === 1 ? "tab" : "tabs"}${row.version ? " \xB7 Saved version" : " \xB7 Earlier snapshot"}`
            )
          )
        );
        for (const link of row.snapshot.links)
          details.append(
            el(
              "div",
              { class: "session-page" },
              favicon(link),
              el("span", { class: "row-title" }, link.title, el("small", {}, domain(link.url)))
            )
          );
        details.append(
          button(
            "Restore this version",
            act(async () => {
              await change("collection-version-restore", {
                collectionId: c.id,
                id: row.id,
                windowId: win
              });
              close();
              toast("Collection version restored");
            }),
            { className: "session-restore" }
          )
        );
        body.append(details);
      }
      if (!rows.length)
        body.append(
          el(
            "p",
            { class: "empty" },
            "No previous versions yet. Changes will appear here automatically."
          )
        );
      const { close } = modal("Version history \xB7 " + c.name, body);
    }
    function stashDialog(context2) {
      return saveTo(context2, { closeTabs: true });
    }
    return {
      save: saveTo,
      update: updateCollection,
      versions: collectionVersions,
      stash: stashDialog,
      resume: resumeDialog,
      switch: switchDialog,
      swap: swapCollection,
      closeCollection,
      note: noteDialog,
      export: exportDialog,
      ai: aiDialog,
      recovery: recoveryDialog,
      settings: settingsDialog,
      aiSettings: () => settingsDetails("AI connection"),
      import: importDialog,
      previewImport,
      reviewPlan
    };
  }

  // extension/ui/session-list.js
  function sessionList({ data, query = "", windowId, history = false, refresh = () => {
  } }) {
    const root = el("div", { class: "session-results" });
    const rows = (history ? data.timeline || [] : data.recentSessions || []).filter(
      (r) => score(query, r.name, ...(r.tabs || r.snapshot?.links || []).flatMap((t) => [t.title, t.url]))
    ).sort((a, b) => b.at - a.at);
    let limit = 30;
    const restore = async (row, link) => {
      const result = history ? await rpc("timeline-restore", {
        id: row.id,
        linkIds: link ? [link.id] : void 0,
        windowId
      }) : link ? await rpc("restore-recent-tab", { sessionId: row.id, url: link.url, windowId }) : await rpc("restore-session", { sessionId: row.id });
      if (result?.failed?.length || result?.groupFailures?.length)
        throw Error("Some pages could not be restored. The snapshot is still available.");
      await refresh();
    };
    const pageButton = (r, t) => {
      const b = button(
        "Reopen tab: " + (t.title || t.url),
        task(() => restore(r, t)),
        { className: "tab-choice session-page" }
      );
      b.replaceChildren(
        favicon(t),
        el("span", { class: "row-title" }, t.title || domain(t.url), el("small", {}, domain(t.url))),
        el("span", { class: "result-verb" }, "Reopen tab")
      );
      return b;
    };
    function render() {
      root.replaceChildren(
        ...rows.slice(0, limit).map((r) => {
          const tabs = r.tabs || r.snapshot.links;
          const time = new Date(r.at).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          });
          if (!history && tabs.length === 1 && r.name !== "Closed window") {
            const b = pageButton(r, tabs[0]);
            return el(
              "div",
              { class: "session-entry" },
              el("small", { class: "session-time" }, time),
              b
            );
          }
          const details = el(
            "details",
            { class: "session-entry" },
            el(
              "summary",
              {},
              (r.name === "Browsing session" ? "Snapshot" : r.name) + " \xB7 " + tabs.length + " tabs",
              el("small", { class: "session-time" }, time)
            )
          );
          for (const t of tabs.filter((t2) => !query || score(query, t2.title, t2.url, r.name)))
            details.append(pageButton(r, t));
          details.append(
            button(
              history ? "Restore " + tabs.length + (tabs.length === 1 ? " tab" : " tabs") : "Restore window",
              task(() => restore(r)),
              { className: "session-restore" }
            )
          );
          return details;
        })
      );
      if (!rows.length)
        root.append(
          el(
            "p",
            { class: "empty" },
            query ? "No matching snapshots or tabs." : history ? "Snapshots appear here as you browse." : "No recently closed tabs or windows."
          )
        );
      if (rows.length > limit)
        root.append(
          button("Show more", () => {
            limit += 30;
            render();
          })
        );
    }
    render();
    return root;
  }

  // extension/ui/tab-tools.js
  function orderedTabs(tabs, order = "recent") {
    const sorted = [...tabs].sort(
      order === "recent" ? (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0) : (a, b) => a.windowId - b.windowId || a.index - b.index
    );
    return order === "reverse" ? sorted.reverse() : sorted;
  }
  function createTabTools({ getTabs, getSettings, change, actions, compact = false }) {
    const sort = button(
      "Sort tabs",
      (e) => menu(
        "Sort tabs",
        [
          ["recent", "Most recent first"],
          ["position", "Position in tab bar"],
          ["reverse", "Reverse tab order"]
        ].map(([tabSort, label]) => [
          label,
          () => change("settings", { settings: { tabSort } }),
          getSettings().tabSort === tabSort ? "check" : void 0
        ]),
        { anchor: e.currentTarget }
      ),
      { glyph: "sort", quiet: compact }
    );
    const save = button("Save tabs", () => actions.save(), { glyph: "tray", quiet: compact });
    const dedup = button(
      "Close duplicate tabs",
      task(async () => {
        const tabIds = duplicateCandidates(getTabs());
        if (tabIds.length) await change("close", { tabIds });
      }),
      { glyph: "broom", quiet: compact, className: "dedup-button" }
    );
    const node = el(
      "div",
      { class: "tab-tools" + (compact ? " compact" : ""), "aria-label": "Tab actions" },
      sort,
      save,
      dedup
    );
    function update() {
      const count = duplicateCandidates(getTabs()).length;
      dedup.replaceChildren(
        icon("broom"),
        ...compact ? [] : ["Duplicates"],
        ...count ? [el("span", { class: "count-badge", "aria-hidden": "true" }, count > 99 ? "99+" : count)] : []
      );
      dedup.title = count ? `Close ${count} duplicate tab${count === 1 ? "" : "s"}` : "No duplicate tabs";
      dedup.setAttribute("aria-label", dedup.title);
      dedup.disabled = !count;
      save.disabled = !getTabs().some((t) => !t.pinned);
    }
    update();
    return { node, update, save, dedup };
  }

  // extension/ui/quick.js
  async function startQuick() {
    const searchOnly = (globalThis.__neoOverlayContext?.mode || new URLSearchParams(location.search).get("mode")) === "search";
    let data = await rpc("load"), win = await currentWindow(), groupId = null;
    let browseMode = "window", audioOnly = false;
    let list = false, selecting = false, controller, disposed = false, busy = false;
    const root = surface(), mount = globalThis.__neoSurface || document.body;
    const selected = /* @__PURE__ */ new Set(), tiles = /* @__PURE__ */ new Map(), previews = /* @__PURE__ */ new Map(), observers = /* @__PURE__ */ new Set();
    theme(data.state.settings.theme);
    const close = () => globalThis.__neoCloseOverlay ? globalThis.__neoCloseOverlay() : window.close();
    const search = el("input", { id: "quick-search", type: "search" });
    const results = el("main", { id: "quick-results", class: "quick-grid" });
    const scope = el("div", { class: "search-scope", hidden: true });
    const scopeBar = el("div", {
      class: "browse-scopes",
      role: "group",
      "aria-label": "Search scope"
    });
    const scopeButtons = /* @__PURE__ */ new Map();
    for (const [id, label] of [
      ["window", "This window"],
      ["all", "All windows"],
      ["recent", "Recently closed"]
    ]) {
      const b = button(label, () => setBrowseMode(id));
      b.dataset.mode = id;
      scopeButtons.set(id, b);
      scopeBar.append(b);
    }
    const audioButton = button(
      "Audio",
      () => {
        audioOnly = !audioOnly;
        controller.render();
      },
      { glyph: "audio", className: "audio-filter" }
    );
    const clearSearch = button(
      "Clear search",
      () => {
        search.value = "";
        controller.render();
        search.focus();
      },
      { className: "clear-search" }
    );
    clearSearch.replaceChildren("Clear");
    const collectionsButton = button("Collections", () => setBrowseMode("collections"), {
      glyph: "group"
    });
    const actionButton = button("More actions", (e) => showActions(e.currentTarget), {
      glyph: "more",
      quiet: true,
      className: "overlay-more"
    });
    const title = el("h1", {}, "Open tabs"), summary = el("span", { class: "muted" });
    const back = button(
      "All tabs",
      () => {
        groupId = null;
        controller.render();
        search.focus();
      },
      { glyph: "back" }
    );
    const previewButton = button(
      "Previews",
      () => {
        list = false;
        controller.render();
      },
      { glyph: "grid" }
    );
    const listButton = button(
      "List",
      () => {
        list = true;
        controller.render();
      },
      { glyph: "list" }
    );
    const selectButton = button("Select", () => setSelecting(!selecting), { glyph: "select" });
    selectButton.id = "select-mode";
    selectButton.className = "selection-mode-button";
    const selectionCount = el("strong", { "aria-live": "polite" });
    const groupButton = button(
      "Group",
      task(
        () => manage(async () => {
          const result = await rpc("group-tabs", { tabIds: [...selected] });
          groupId = null;
          await refresh();
          startRename(result.groupId);
        })
      ),
      { glyph: "group" }
    );
    const ungroupButton = button(
      "Ungroup",
      task(
        () => manage(async () => {
          await rpc("ungroup-tabs", { tabIds: [...selected] });
          await refresh();
          toast("Tabs ungrouped");
        })
      ),
      { glyph: "ungroup" }
    );
    const closeButton = button(
      "Close tabs",
      task(
        () => manage(async () => {
          const op = await rpc("close", { tabIds: [...selected] });
          selected.clear();
          await refresh();
          if (!disposed)
            toast((op.closed?.length || 0) + " tabs closed", {
              undo: task(async () => {
                await rpc("undo-action", { id: op.id, windowId: win });
                await refresh();
              })
            });
        })
      ),
      { glyph: "close" }
    );
    const selectAll = button("Select all", () => {
      for (const tab of visibleTabs()) selected.add(tab.id);
      updateSelection();
    });
    const clear = button("Clear", () => {
      selected.clear();
      updateSelection();
    });
    const saveSelected = button("Save tabs", () => actions.save(), { glyph: "tray" });
    const toolbar = el(
      "div",
      { class: "selection-toolbar", hidden: true },
      selectionCount,
      selectAll,
      clear,
      saveSelected,
      groupButton,
      ungroupButton,
      closeButton
    );
    closeButton.classList.add("close-selected");
    selectAll.classList.add("icon-button");
    selectAll.replaceChildren(icon("select"));
    clear.classList.add("icon-button");
    clear.replaceChildren(icon("clear"));
    let cancelRename = null;
    const dock = el("nav", { class: "collection-dock", "aria-label": "Saved collections" });
    const libraryButton = button(
      "Library",
      task(async () => {
        await rpc("open-library");
        close();
      }),
      { glyph: "library" }
    );
    const dismissButton = button("Close switcher", close, { glyph: "close", quiet: true });
    scopeBar.append(
      collectionsButton,
      el("div", { class: "overlay-navigation" }, audioButton, selectButton, actionButton)
    );
    const view = el(
      "section",
      {
        class: "task-view" + (searchOnly ? " search-only" : ""),
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "Tab switcher"
      },
      el(
        "div",
        { class: "quick-head" },
        back,
        icon("search"),
        search,
        clearSearch,
        el("div", { class: "view-choices" }, previewButton, listButton),
        libraryButton,
        dismissButton
      ),
      scopeBar,
      scope,
      toolbar,
      results,
      dock
    );
    const backdrop = el(
      "div",
      {
        class: "switcher-backdrop",
        onclick: (e) => {
          if (e.target === backdrop && !selecting) close();
        }
      },
      view
    );
    mount.append(backdrop);
    const actions = createActionDialogs({
      getData: () => data,
      windowId: win,
      getTabIds: () => selecting ? [...selected] : allTabs().filter((t) => !t.pinned && (groupId === null || t.groupId === groupId)).map((t) => t.id),
      onOpen: close,
      change: async (action, payload) => {
        const result = await rpc(action, payload);
        await refresh();
        const op = result?.operation || result;
        if (op?.label)
          toast(op.label, {
            undo: action !== "undo-action" && (op.before || op.closed?.length) ? async () => {
              await rpc("undo-action", { id: op.id, windowId: win });
              await refresh();
            } : void 0
          });
        return result;
      }
    });
    const tools = createTabTools({
      getTabs: () => allTabs().filter((t) => groupId === null || t.groupId === groupId),
      getSettings: () => data.state.settings,
      change: async (action, payload) => {
        const result = await rpc(action, payload);
        await refresh();
        const op = result?.operation || result;
        if (op?.label)
          toast(op.label, {
            undo: op.closed?.length ? async () => {
              await rpc("undo-action", { id: op.id, windowId: win });
              await refresh();
            } : void 0
          });
        return result;
      },
      actions
    });
    if (globalThis.__neoSurface) {
      for (const action of ["settings", "import", "export", "ai"])
        actions[action] = async (c) => {
          await rpc("open-library", {
            hash: "#" + new URLSearchParams({ action, ...c?.id ? { collection: c.id } : {} })
          });
          close();
        };
    }
    function setBrowseMode(mode) {
      browseMode = mode;
      groupId = null;
      selecting = false;
      selected.clear();
      search.value = search.value.replace(/^[/@]/, "");
      controller.resetContext();
      search.focus();
    }
    function updateScopes() {
      for (const [id, b] of scopeButtons) {
        b.setAttribute("aria-pressed", String(browseMode === id));
        const count = id === "recent" ? (data.recentSessions || []).length : data.tabs.filter((t) => id === "all" || t.windowId === win).length;
        b.dataset.count = String(count);
      }
      audioButton.hidden = !["window", "all"].includes(browseMode);
      audioButton.setAttribute("aria-pressed", String(audioOnly));
      audioButton.dataset.count = String(
        data.tabs.filter(
          (t) => (browseMode !== "window" || t.windowId === win) && (t.audible || t.mutedInfo?.muted)
        ).length
      );
      collectionsButton.setAttribute("aria-pressed", String(browseMode === "collections"));
      dock.hidden = true;
      view.querySelector(".view-choices").hidden = !["window", "all"].includes(browseMode);
    }
    function showActions(anchor) {
      menu(
        "Actions",
        [
          ["Save tabs", () => actions.save(), "tray", !["window", "all"].includes(browseMode)],
          [
            "Sort tabs",
            () => menu(
              "Sort tabs",
              [
                ["recent", "Most recent first"],
                ["position", "Tab order"],
                ["reverse", "Reverse tab order"]
              ].map(([tabSort, label]) => [
                label,
                async () => {
                  await rpc("settings", { settings: { tabSort } });
                  await refresh();
                }
              ]),
              { anchor }
            ),
            "sort"
          ],
          [
            "Close duplicate tabs",
            () => tools.node.querySelector(".dedup-button").click(),
            "broom",
            tools.node.querySelector(".dedup-button").disabled
          ],
          null,
          [
            "All actions",
            () => {
              search.value = "/";
              controller.setContext(null);
              search.focus();
            },
            "more"
          ]
        ],
        { anchor }
      );
    }
    function focusResult(node) {
      if (!node) return;
      node.focus({ preventScroll: true });
      revealResult(results, node);
    }
    async function closeSingle(entry) {
      if (entry.tab.pinned || busy) return;
      const index = [...results.querySelectorAll(".switcher-card")].indexOf(entry.node);
      await manage(async () => {
        await rpc("close", { tabIds: [entry.tab.id] });
        await refresh();
      });
      const buttons = [...results.querySelectorAll(".preview-tile,.tab-choice")];
      focusResult(buttons[Math.min(index, buttons.length - 1)] || search);
    }
    function renderBrowse(query) {
      updateScopes();
      if (["window", "all"].includes(browseMode)) return renderTabs(query);
      results.className = "search-results tab-list";
      results.setAttribute("role", "group");
      back.hidden = true;
      summary.textContent = "";
      if (browseMode === "collections") {
        results.classList.add("collection-choices");
        title.textContent = "Collections";
        const matches = orderedCollections(data.state.collections).filter(
          (c) => score(query, c.name, c.note)
        );
        results.replaceChildren(
          ...matches.map((c) => {
            const choice = collectionChoice(
              c,
              () => {
                search.value = "";
                controller.setContext(c.id);
                search.focus();
              },
              { className: "tab-choice collection-result", title: "Browse collection: " + c.name }
            );
            return choice;
          })
        );
        if (!matches.length) results.append(el("p", { class: "empty" }, "No matching collections."));
        return;
      }
      const history = browseMode === "history";
      title.textContent = history ? "Timeline" : "Recently closed";
      results.replaceChildren(
        button(
          history ? "Back to recently closed" : "Timeline",
          () => setBrowseMode(history ? "recent" : "history"),
          { className: "history-link", glyph: "history" }
        ),
        el(
          "p",
          { class: "hint" },
          history ? "Saved snapshots \xB7 restore adds pages to this window" : "Closed tabs and windows across this browser"
        ),
        sessionList({ data, query, windowId: win, history, refresh })
      );
    }
    function allTabs() {
      return orderedTabs(
        data.tabs.filter(
          (t) => (browseMode !== "window" || t.windowId === win) && (!audioOnly || t.audible || t.mutedInfo?.muted)
        ),
        data.state.settings.tabSort
      );
    }
    function visibleTabs() {
      return allTabs().filter(
        (t) => (groupId === null || t.groupId === groupId) && score(search.value, t.title, t.resourceUrl || t.url)
      );
    }
    function selectedGroup() {
      const members = allTabs().filter((t) => selected.has(t.id));
      return members.length && members[0].groupId >= 0 && members.every((t) => t.groupId === members[0].groupId) ? members[0].groupId : null;
    }
    async function manage(action) {
      if (busy) return;
      busy = true;
      updateSelection();
      try {
        await action();
      } finally {
        busy = false;
        if (!disposed) {
          updateSelection();
          if (!root.activeElement || root.activeElement.disabled || !view.contains(root.activeElement))
            selectButton.focus();
        }
      }
    }
    function setSelecting(value) {
      selecting = value;
      if (!value) {
        selected.clear();
        cancelRename?.();
      }
      if (value) {
        search.value = "";
        controller.setContext(null);
      }
      updateSelection();
    }
    function updateSelection() {
      for (const id of selected) if (!data.tabs.some((t) => t.id === id)) selected.delete(id);
      toolbar.hidden = !selecting;
      selectButton.replaceChildren(selecting ? "Done" : "Select");
      selectButton.setAttribute("aria-label", selecting ? "Done selecting" : "Select tabs");
      selectButton.removeAttribute("aria-pressed");
      selectButton.title = selecting ? "Done selecting" : "Select tabs";
      view.classList.toggle("selecting", selecting);
      selectionCount.textContent = selected.size ? selected.size + " selected" : "Select tabs or groups";
      const members = allTabs().filter((t) => selected.has(t.id)), unpinned = members.filter((t) => !t.pinned);
      groupButton.disabled = busy || !unpinned.length || new Set(unpinned.map((t) => t.windowId)).size > 1;
      ungroupButton.disabled = busy || !members.some((t) => t.groupId >= 0);
      closeButton.disabled = busy || !unpinned.length;
      closeButton.textContent = unpinned.length ? "Close " + unpinned.length + (unpinned.length === 1 ? " tab" : " tabs") : "Close tabs";
      closeButton.setAttribute("aria-label", closeButton.textContent);
      saveSelected.disabled = busy || !unpinned.length;
      closeButton.title = members.some((t) => t.pinned) ? "Close selected unpinned tabs; pinned tabs stay open" : "Close selected tabs";
      selectAll.disabled = busy || !visibleTabs().length;
      clear.disabled = busy || !selected.size;
      for (const entry of tiles.values()) {
        const count = entry.ids.filter((id) => selected.has(id)).length;
        entry.node.classList.toggle("is-selected", selecting && count > 0);
        entry.mark.hidden = !selecting;
        entry.mark.textContent = count === entry.ids.length ? "\u2713" : count ? "\u2212" : "";
        entry.rowActions.hidden = selecting || entry.isGroup;
        if (selecting)
          entry.button.setAttribute(
            "aria-pressed",
            count && count < entry.ids.length ? "mixed" : String(count === entry.ids.length)
          );
        else entry.button.removeAttribute("aria-pressed");
        entry.button.setAttribute("aria-label", (selecting ? "Select " : "") + entry.name);
        if (entry.groupSelect) {
          entry.groupSelect.hidden = !selecting;
          entry.groupSelect.disabled = busy;
          entry.groupSelect.setAttribute(
            "aria-pressed",
            count && count < entry.ids.length ? "mixed" : String(count === entry.ids.length)
          );
          entry.groupSelect.setAttribute("aria-label", "Select group " + entry.name);
          entry.button.removeAttribute("aria-pressed");
          entry.button.setAttribute("aria-label", "Open group " + entry.name);
          entry.nameNode.title = "Rename " + entry.name;
          entry.nameNode.setAttribute("aria-label", "Rename " + entry.name);
        }
      }
    }
    function startRename(id) {
      if (id === null) return;
      cancelRename?.();
      const group = data.groups.find((g) => g.id === id);
      if (!group) return;
      let entry = [...tiles.values()].find(
        (x) => x.isGroup && x.tab.groupId === id && x.node.isConnected
      );
      if (!entry) {
        groupId = null;
        search.value = "";
        audioOnly = false;
        controller.render();
        entry = [...tiles.values()].find(
          (x) => x.isGroup && x.tab.groupId === id && x.node.isConnected
        );
      }
      if (!entry) return;
      const input = el("input", {
        value: group.title || "Group",
        "aria-label": "Group name",
        maxlength: 100
      });
      let finished = false;
      const finish = (focus = false) => {
        finished = true;
        cancelRename = null;
        entry.nameSlot.replaceChildren(entry.nameNode);
        if (focus) entry.nameNode.focus();
      };
      cancelRename = () => finish();
      const save = task(async (focus = false) => {
        if (finished) return;
        const name = input.value.trim() || "Group";
        if (name === (group.title || "Group")) {
          finish(focus);
          return;
        }
        finished = true;
        input.disabled = true;
        try {
          await rpc("rename-tab-group", { groupId: id, name });
          finish(focus);
          await refresh();
        } catch (error) {
          finished = false;
          input.disabled = false;
          input.focus();
          throw error;
        }
      });
      input.onblur = () => save();
      input.onkeydown = (e) => {
        if (e.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(true);
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          save(true);
        }
      };
      entry.nameSlot.replaceChildren(input);
      input.focus();
      input.select();
    }
    function preview(tab) {
      const url = tab.resourceUrl || tab.url;
      const frame = el(
        "div",
        { class: "preview-image" },
        el(
          "span",
          { class: "preview-missing" },
          favicon(tab),
          domain(url),
          el("small", {}, "Preview available after visiting")
        )
      );
      const load = async () => {
        if (!previews.has(url))
          previews.set(
            url,
            rpc("preview", { url }).catch(() => null)
          );
        const image = await previews.get(url);
        if (disposed || !image) return;
        const img = el("img", { src: image.data, alt: "" });
        await img.decode().catch(() => {
        });
        if (!disposed) frame.replaceChildren(img);
      };
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          observer.disconnect();
          observers.delete(observer);
          load();
        },
        { root: results }
      );
      observer.observe(frame);
      observers.add(observer);
      return frame;
    }
    function groupPreview(members) {
      const shown = members.slice(0, 4);
      return el(
        "div",
        {
          class: "preview-image group-preview",
          "aria-hidden": "true",
          dataset: { count: shown.length }
        },
        shown.map((tab) => preview(tab))
      );
    }
    function createTile(tab, isGroup, key, members) {
      const mark = el("span", { class: "selection-mark", "aria-hidden": "true", hidden: true });
      const nameNode = isGroup ? button("", () => startRename(entry.tab.groupId), { className: "group-name" }) : el("span"), meta = el("small");
      const entry = { ids: [], name: "", isGroup, tab, nameNode, meta, mark };
      const primary = el(
        "button",
        {
          class: list ? "search-result tab-choice" : "preview-tile",
          dataset: { focusKey: key },
          onclick: task(async () => {
            if (isGroup) {
              groupId = entry.tab.groupId;
              controller.render();
              search.focus();
            } else if (selecting) {
              const remove = entry.ids.every((id) => selected.has(id));
              entry.ids.forEach((id) => remove ? selected.delete(id) : selected.add(id));
              updateSelection();
            } else {
              await rpc("activate", { tabId: entry.tab.id });
              close();
            }
          })
        },
        el(
          "div",
          { class: "tile-topline" },
          isGroup ? icon("group") : favicon(tab),
          isGroup ? el("span") : nameNode,
          isGroup ? null : mark
        ),
        list ? null : isGroup ? groupPreview(members) : preview(tab),
        el("div", { class: "preview-info" }, meta)
      );
      const nameSlot = isGroup ? el("div", { class: "group-name-slot" }, nameNode) : null;
      const groupSelect = isGroup ? button(
        "",
        () => {
          const remove = entry.ids.every((id) => selected.has(id));
          entry.ids.forEach((id) => remove ? selected.delete(id) : selected.add(id));
          updateSelection();
        },
        { className: "group-select" }
      ) : null;
      if (groupSelect) groupSelect.append(mark);
      const node = el(
        "div",
        { class: "switcher-card" + (isGroup ? " group-tile" : ""), dataset: { key } },
        primary,
        nameSlot,
        groupSelect
      );
      const closeOne = button(
        "Close tab",
        task(() => closeSingle(entry)),
        { glyph: "close", quiet: true, className: "tile-close" }
      );
      const muteOne = button(
        "Mute tab",
        task(async () => {
          await rpc("mute-tab", { tabId: entry.tab.id, muted: !entry.tab.mutedInfo?.muted });
          await refresh();
        }),
        { glyph: "audio", quiet: true, className: "tile-mute" }
      );
      const rowActions = el("div", { class: "tile-actions" }, muteOne, closeOne);
      node.append(rowActions);
      primary.onauxclick = task(async (e) => {
        if (e.button === 1 && !isGroup) {
          e.preventDefault();
          await closeSingle(entry);
        }
      });
      Object.assign(entry, {
        node,
        button: primary,
        nameSlot,
        groupSelect,
        closeOne,
        muteOne,
        rowActions
      });
      return entry;
    }
    function renderTabs(query) {
      results.className = list ? "search-results tab-list" : "quick-grid";
      results.setAttribute("role", "group");
      results.setAttribute("aria-label", "Open tabs");
      previewButton.classList.toggle("view-active", !list);
      listButton.classList.toggle("view-active", list);
      previewButton.setAttribute("aria-pressed", String(!list));
      listButton.setAttribute("aria-pressed", String(list));
      updateScopes();
      const tabs = allTabs();
      if (groupId !== null && !tabs.some((t) => t.groupId === groupId)) groupId = null;
      back.hidden = groupId === null;
      title.textContent = groupId === null ? browseMode === "all" ? "All windows" : "This window" : data.groups.find((g) => g.id === groupId)?.title || "Group";
      const count = tabs.filter((t) => groupId === null || t.groupId === groupId).length;
      summary.textContent = count + (count === 1 ? " tab" : " tabs");
      const seen = /* @__PURE__ */ new Set(), nodes = [];
      for (const tab of tabs.filter(
        (t) => (groupId === null || t.groupId === groupId) && score(query, t.title, t.resourceUrl || t.url)
      ).slice(0, 120)) {
        const isGroup = !query && !audioOnly && groupId === null && tab.groupId >= 0;
        if (isGroup && seen.has(tab.groupId)) continue;
        if (isGroup) seen.add(tab.groupId);
        const members = isGroup ? tabs.filter((t) => t.groupId === tab.groupId) : [tab];
        const key = (list ? "list:" : "preview:") + (isGroup ? "group:" + tab.groupId + ":" + members.map((t) => t.id + ":" + (t.resourceUrl || t.url)).join("|") : "tab:" + tab.id) + ":" + (tab.resourceUrl || tab.url);
        let entry = tiles.get(key);
        if (!entry) {
          entry = createTile(tab, isGroup, key, members);
          tiles.set(key, entry);
        }
        entry.tab = tab;
        const nativeGroup = data.groups.find((g) => g.id === tab.groupId);
        entry.node.dataset.groupColor = nativeGroup?.color || "";
        entry.node.classList.toggle("native-group-card", !!nativeGroup);
        entry.ids = members.map((t) => t.id);
        entry.name = isGroup ? data.groups.find((g) => g.id === tab.groupId)?.title || "Group" : tab.title || domain(tab.url);
        if (entry.nameNode.textContent !== entry.name) entry.nameNode.textContent = entry.name;
        const text2 = isGroup ? members.length + (members.length === 1 ? " tab" : " tabs") : (nativeGroup ? (nativeGroup.title || "Group") + " \xB7 " : "") + (tab.pinned ? "Pinned \xB7 " : "") + domain(tab.resourceUrl || tab.url) + (browseMode === "all" ? " \xB7 " + (tab.windowId === win ? "This window" : "Window " + tab.windowId) : "");
        entry.rowActions.hidden = isGroup || selecting;
        entry.closeOne.disabled = !!tab.pinned || busy;
        entry.closeOne.title = tab.pinned ? "Unpin this tab before closing it" : "Close tab: " + entry.name;
        entry.closeOne.setAttribute("aria-label", entry.closeOne.title);
        entry.muteOne.hidden = !(tab.audible || tab.mutedInfo?.muted);
        entry.muteOne.title = tab.mutedInfo?.muted ? "Unmute tab" : "Mute tab";
        entry.muteOne.setAttribute("aria-label", entry.muteOne.title);
        if (entry.meta.textContent !== text2) entry.meta.textContent = text2;
        entry.button.title = entry.name;
        nodes.push(entry.node);
      }
      if (!nodes.length)
        nodes.push(
          el(
            "p",
            { class: "empty" },
            audioOnly ? "No tabs with audio." : query ? "No matching open tabs." : browseMode === "all" ? "No open pages." : "No open pages in this window."
          )
        );
      results.style.setProperty(
        "--columns",
        Math.min(
          nodes.length,
          Math.max(1, Math.min(4, Math.floor((Math.min(1180, innerWidth - 64) - 48) / 260)))
        )
      );
      const wanted = new Set(nodes);
      for (const child of [...results.children]) if (!wanted.has(child)) child.remove();
      nodes.forEach((node, i) => {
        if (results.children[i] !== node) results.insertBefore(node, results.children[i] || null);
      });
      tools.update();
      updateSelection();
    }
    let dockKey;
    function renderDock() {
      const key = JSON.stringify(
        data.state.collections.map((c) => [c.id, c.name, c.color, c.links.length])
      );
      if (key === dockKey) return;
      dockKey = key;
      dock.replaceChildren(
        el(
          "div",
          { class: "dock-actions" },
          el("strong", {}, "Collections"),
          button("Switch collection", () => actions.switch(), { glyph: "arrow" })
        ),
        el(
          "div",
          { class: "dock-collections" },
          data.state.collections.map((c) => {
            const b = button(
              c.name,
              () => {
                setSelecting(false);
                groupId = null;
                controller.setContext(c.id);
                search.focus();
              },
              { className: "dock-collection" }
            );
            b.style.setProperty("--color", "var(--" + c.color + ")");
            return b;
          })
        )
      );
    }
    const dismiss = () => {
      if (selecting) {
        setSelecting(false);
        return;
      }
      if (groupId !== null) {
        groupId = null;
        controller.render();
        search.focus();
        return;
      }
      close();
    };
    controller = createSearchController({
      input: search,
      results,
      scope,
      getData: () => data,
      windowId: win,
      actions,
      onNavigate: close,
      onDismiss: dismiss,
      visualSearch: renderBrowse,
      escapeDismiss: true,
      onHistory: () => setBrowseMode("recent"),
      onModeChange: (parsed) => {
        if (parsed.context || parsed.mode === "contexts") browseMode = "collections";
        const live = parsed.mode === "search" && !parsed.context && ["window", "all"].includes(browseMode);
        updateScopes();
        clearSearch.hidden = !search.value;
        search.placeholder = parsed.context ? "Search " + parsed.context.name + "\u2026" : parsed.mode === "commands" ? "Search actions\u2026" : browseMode === "recent" ? "Search recently closed tabs\u2026" : browseMode === "history" ? "Search timeline\u2026" : browseMode === "collections" ? "Search collections\u2026" : "Search tabs\u2026";
        selectButton.hidden = !live;
        tools.node.hidden = searchOnly || !live;
        if (!live && selecting) {
          selecting = false;
          selected.clear();
          updateSelection();
          cancelRename?.();
        }
        if (!live) {
          results.setAttribute("role", "listbox");
          title.textContent = parsed.context?.name || (parsed.mode === "commands" ? "Actions" : "Collections");
          summary.textContent = "";
        }
      }
    });
    renderDock();
    search.focus();
    const onKey = (e) => {
      if (e.isComposing || $("#dialog")?.open || $("#action-popover")?.matches(":popover-open"))
        return;
      if (e.key === "Tab") {
        const controls = [
          ...view.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')
        ].filter((n) => n.getClientRects().length);
        const index = controls.indexOf(root.activeElement);
        if (e.shiftKey && index <= 0) {
          e.preventDefault();
          controls.at(-1)?.focus();
        } else if (!e.shiftKey && index === controls.length - 1) {
          e.preventDefault();
          controls[0]?.focus();
        }
        return;
      }
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.target.closest(".group-name-slot")) return;
      if (e.key === "Delete" && !selecting && e.target.matches(".preview-tile,.tab-choice") && results.contains(e.target)) {
        const entry = [...tiles.values()].find((x) => x.button === e.target);
        if (entry && !entry.isGroup) {
          e.preventDefault();
          task(() => closeSingle(entry))();
        }
        return;
      }
      if (selecting && e.key === "F2" && selectedGroup() !== null) {
        e.preventDefault();
        startRename(selectedGroup());
        return;
      }
      const buttons = [...results.querySelectorAll(".preview-tile, .tab-choice")];
      if (e.target === search && !search.value.match(/^[@/]/) && !scope.children.length) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          focusResult(buttons[0]);
        }
        if (e.key === "Enter") {
          e.preventDefault();
          buttons[0]?.click();
        }
      } else if (results.contains(e.target) && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const columns = list ? 1 : getComputedStyle(results).gridTemplateColumns.split(" ").length;
        const step = { ArrowDown: columns, ArrowUp: -columns, ArrowLeft: -1, ArrowRight: 1 }[e.key];
        focusResult(
          buttons[Math.max(0, Math.min(buttons.length - 1, buttons.indexOf(root.activeElement) + step))]
        );
      }
    };
    const containKeys = (e) => e.stopPropagation();
    root.addEventListener("keydown", onKey);
    root.addEventListener("keydown", containKeys);
    root.addEventListener("keyup", containKeys);
    const onResize = () => controller.render();
    window.addEventListener("resize", onResize);
    let generation = 0, lastData = JSON.stringify(data);
    async function refresh() {
      const g = ++generation, next = await rpc("load");
      if (disposed || g !== generation) return;
      const nextKey = JSON.stringify(next);
      if (lastData === nextKey) return;
      lastData = nextKey;
      data = next;
      theme(data.state.settings.theme);
      controller.update();
      renderDock();
      tools.update();
      updateSelection();
    }
    const onMessage = (m) => {
      if (m.event === "changed") refresh().catch(() => {
      });
    };
    globalThis.chrome.runtime.onMessage.addListener(onMessage);
    const timer = setInterval(() => refresh().catch(() => {
    }), 2500);
    return () => {
      disposed = true;
      clearInterval(timer);
      controller.destroy();
      root.removeEventListener("keydown", onKey);
      root.removeEventListener("keydown", containKeys);
      root.removeEventListener("keyup", containKeys);
      window.removeEventListener("resize", onResize);
      globalThis.chrome.runtime.onMessage.removeListener(onMessage);
      observers.forEach((o) => o.disconnect());
      tiles.clear();
      previews.clear();
      backdrop.remove();
    };
  }

  // extension/ui/styles.css
  var styles_default = "/* SPDX-License-Identifier: MPL-2.0 */\n@layer base,layout,components;\n@layer base {\n  :root {\n    color-scheme: light dark;\n    --bg: light-dark(#fff, #232426);\n    --side: light-dark(#f7f7f5, #1c1d1f);\n    --panel: light-dark(#fff, #2c2d30);\n    --text: light-dark(#292b30, #ececef);\n    --muted: light-dark(#71747b, #a5a7ad);\n    --line: light-dark(#e9e9e6, #3a3c40);\n    --hover: light-dark(#efefed, #35363a);\n    --selected: light-dark(#e8ecff, #343f63);\n    --accent: light-dark(#575acb, #abb0ff);\n    --accent-fill: light-dark(#6264d8, #939bf4);\n    --on-accent: light-dark(#fff, #171d43);\n    --shadow: 0 12px 45px #0002;\n    --mint: light-dark(#b2e5c6, #93c5a7);\n    --blue: light-dark(#bdd1fc, #9db5e3);\n    --lavender: light-dark(#d6c7f3, #b3a2d4);\n    --peach: light-dark(#f3d0b7, #d7b094);\n    --rose: light-dark(#f0bdd5, #d59bb6);\n    --teal: light-dark(#b6dedc, #93bebc);\n    --yellow: light-dark(#f3e4a5, #d1c582);\n    --grey: light-dark(#dddeda, #aeb0ac);\n    font-family: Inter, 'Segoe UI', system-ui, sans-serif;\n    font-size: 14px;\n    line-height: 1.5;\n    background: var(--bg);\n    color: var(--text);\n  }\n  :root[data-theme='light'] {\n    color-scheme: light;\n  }\n  :root[data-theme='dark'] {\n    color-scheme: dark;\n  }\n  * {\n    box-sizing: border-box;\n  }\n  body {\n    margin: 0;\n  }\n  button,\n  input,\n  textarea,\n  select {\n    font: inherit;\n    color: inherit;\n  }\n  button {\n    border: 0;\n    background: transparent;\n    padding: 7px 10px;\n    border-radius: 6px;\n    cursor: pointer;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    gap: 7px;\n    line-height: 1.4;\n  }\n  button:hover {\n    background: var(--hover);\n  }\n  button:disabled {\n    opacity: 0.5;\n    cursor: wait;\n  }\n  button:focus-visible,\n  a:focus-visible {\n    outline: 2px solid var(--accent);\n    outline-offset: 2px;\n  }\n  input,\n  textarea,\n  select {\n    width: 100%;\n    padding: 9px 10px;\n    border: 1px solid var(--line);\n    border-radius: 6px;\n    background: var(--bg);\n    outline: 0;\n  }\n  input:focus,\n  textarea:focus,\n  select:focus {\n    border-color: var(--accent);\n    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent);\n  }\n  input[type='checkbox'] {\n    width: 15px;\n    height: 15px;\n    accent-color: var(--accent);\n    padding: 0;\n    box-shadow: none;\n    flex: none;\n  }\n  textarea {\n    resize: vertical;\n    min-height: 85px;\n  }\n  svg {\n    width: 18px;\n    height: 18px;\n    flex: none;\n  }\n  h1,\n  h2,\n  h3,\n  p {\n    margin: 0;\n  }\n  h1 {\n    font-size: 29px;\n    letter-spacing: -0.8px;\n    font-weight: 630;\n  }\n  h2 {\n    font-size: 15px;\n    font-weight: 600;\n  }\n  h3 {\n    font-size: 14px;\n    font-weight: 600;\n  }\n  a {\n    color: var(--accent);\n    text-decoration: none;\n  }\n  a:hover {\n    text-decoration: underline;\n  }\n  [hidden] {\n    display: none !important;\n  }\n  small,\n  .muted {\n    font-size: 12px;\n    color: var(--muted);\n  }\n  kbd {\n    font: 11px inherit;\n    border: 1px solid var(--line);\n    padding: 0 5px;\n    border-radius: 4px;\n    color: var(--muted);\n  }\n  .primary {\n    background: var(--accent-fill);\n    color: var(--on-accent);\n  }\n  .primary:hover {\n    filter: brightness(0.96);\n    background: var(--accent-fill);\n  }\n  .danger {\n    color: light-dark(#bb414c, #ff9b9d);\n  }\n  .icon-button {\n    width: 30px;\n    height: 30px;\n    padding: 5px;\n    color: var(--muted);\n  }\n  .icon-button:hover {\n    color: var(--text);\n  }\n  .field {\n    display: flex;\n    flex-direction: column;\n    gap: 6px;\n    margin: 0 0 15px;\n  }\n  .field > span {\n    font-size: 13px;\n    font-weight: 550;\n  }\n  .check-label {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    margin: 13px 0;\n  }\n  .empty {\n    padding: 60px 24px;\n    text-align: center;\n    color: var(--muted);\n  }\n  .empty h2 {\n    font-size: 19px;\n    color: var(--text);\n    margin-bottom: 7px;\n  }\n  .empty p {\n    max-width: 370px;\n    margin: 0 auto 18px;\n  }\n  .favicon {\n    width: 18px;\n    height: 18px;\n    border-radius: 4px;\n    background: hsl(var(--hue) 35% 47%);\n    color: white;\n    font-size: 11px;\n    font-weight: 650;\n    display: inline-grid;\n    place-items: center;\n    flex: none;\n  }\n  .row-title {\n    flex: 1;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n    min-width: 0;\n  }\n  .hint {\n    color: var(--muted);\n    font-size: 12px;\n    margin-top: 8px;\n  }\n  .row {\n    display: flex;\n    align-items: center;\n    gap: 9px;\n    min-width: 0;\n  }\n  ::selection {\n    background: var(--selected);\n  }\n}\n@layer layout {\n  .app-shell {\n    display: grid;\n    grid-template-columns: 280px minmax(0, 1fr);\n    min-height: 100dvh;\n  }\n  .app-shell > aside {\n    background: var(--side);\n    border-right: 1px solid var(--line);\n    height: 100dvh;\n    position: sticky;\n    top: 0;\n    overflow: auto;\n    padding: 22px 15px 15px;\n    display: flex;\n    flex-direction: column;\n  }\n  .brand {\n    display: flex;\n    align-items: center;\n    gap: 9px;\n    padding: 0 7px 20px;\n  }\n  .brand strong {\n    font-size: 17px;\n    letter-spacing: -0.3px;\n  }\n  .brand-mark {\n    display: grid;\n    place-items: center;\n    background: var(--accent-fill);\n    color: var(--on-accent);\n    width: 25px;\n    height: 25px;\n    border-radius: 7px;\n    font-size: 24px;\n    line-height: 1;\n    font-weight: 700;\n  }\n  .brand button {\n    margin-left: auto;\n    padding: 5px;\n  }\n  .tab-search input {\n    background: var(--hover);\n    border-color: transparent;\n    font-size: 13px;\n    padding: 9px 11px;\n  }\n  .section-heading {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    margin: 23px 5px 13px;\n  }\n  .section-heading h2 span {\n    font-size: 11px;\n    font-weight: 400;\n    color: var(--muted);\n    margin-left: 3px;\n  }\n  #tab-tools {\n    display: flex;\n    gap: 1px;\n  }\n  .group-label {\n    font-size: 11px;\n    letter-spacing: 0.2px;\n    color: var(--muted);\n    margin: 15px 9px 5px;\n    display: flex;\n    align-items: center;\n    gap: 6px;\n  }\n  .group-dot {\n    width: 6px;\n    height: 6px;\n    background: var(--blue);\n    border-radius: 50%;\n  }\n  .tab-row {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    min-height: 36px;\n    padding: 3px 7px;\n    border-radius: 5px;\n    position: relative;\n    font-size: 13px;\n    user-select: none;\n  }\n  .tab-row:hover {\n    background: var(--hover);\n  }\n  .tab-row.selected {\n    background: var(--selected);\n  }\n  .tab-row .tab-select {\n    position: absolute;\n    left: 8px;\n    opacity: 0;\n    z-index: 1;\n  }\n  .tab-row:is(:hover, :focus-within, .selected) .tab-select {\n    opacity: 1;\n  }\n  .tab-row:is(:hover, :focus-within, .selected) > .favicon {\n    visibility: hidden;\n  }\n  .tab-row .tab-open {\n    display: flex;\n    justify-content: flex-start;\n    padding: 4px 0;\n    flex: 1;\n    min-width: 0;\n    text-align: left;\n  }\n  .tab-row .tab-open:hover {\n    background: transparent;\n  }\n  .tab-row .row-close {\n    opacity: 0;\n    width: 23px;\n    height: 23px;\n  }\n  .tab-row:is(:hover, :focus-within) .row-close {\n    opacity: 1;\n  }\n  .tab-row .row-close svg {\n    width: 14px;\n    height: 14px;\n  }\n  #selection {\n    margin: 12px 3px;\n    padding: 10px;\n    background: var(--panel);\n    border: 1px solid var(--line);\n    border-radius: 7px;\n  }\n  #selection .row {\n    margin-bottom: 7px;\n  }\n  #selection strong {\n    font-size: 12px;\n    flex: 1;\n  }\n  #selection button {\n    font-size: 12px;\n    padding: 5px 7px;\n  }\n  .sidebar-bottom {\n    margin-top: auto;\n    padding: 24px 6px 0;\n    display: flex;\n    gap: 8px;\n  }\n  .sidebar-bottom button {\n    font-size: 12px;\n    color: var(--muted);\n  }\n  #recent {\n    border-top: 1px solid var(--line);\n    margin: 24px 7px 0;\n    padding-top: 19px;\n  }\n  #recent h2 {\n    font-size: 13px;\n    margin-bottom: 11px;\n  }\n  #recent .recent-link {\n    font-size: 12px;\n    display: flex;\n    justify-content: flex-start;\n    width: 100%;\n    padding: 7px 0;\n  }\n  .page-head {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    gap: 20px;\n    margin-bottom: 28px;\n  }\n  .eyebrow {\n    color: var(--muted);\n    font-size: 10px;\n    letter-spacing: 1.3px;\n    margin: 0 0 7px;\n    font-weight: 600;\n  }\n  .head-actions {\n    display: flex;\n    align-items: center;\n    gap: 12px;\n  }\n  .head-actions button {\n    font-size: 12px;\n  }\n  #global-search {\n    color: var(--muted);\n  }\n  #main {\n    padding: 40px clamp(24px, 4vw, 72px) 70px;\n    max-width: 1700px;\n    width: 100%;\n    margin: 0 auto;\n  }\n  .library-tools {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    margin-bottom: 23px;\n    min-height: 32px;\n    color: var(--muted);\n    font-size: 12px;\n  }\n  #breadcrumbs {\n    display: flex;\n    align-items: center;\n    gap: 5px;\n  }\n  #breadcrumbs button {\n    font-size: 12px;\n  }\n  #view-tools {\n    display: flex;\n    align-items: center;\n    gap: 4px;\n  }\n  #board {\n    display: grid;\n    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));\n    gap: 30px 28px;\n    align-items: start;\n  }\n  #board.detail {\n    display: block;\n    max-width: none;\n  }\n  .collection {\n    min-width: 0;\n    content-visibility: auto;\n    contain-intrinsic-size: auto 240px;\n    border-radius: 7px;\n    background: color-mix(in srgb, var(--color) 4%, var(--bg));\n  }\n  .collection-head {\n    display: flex;\n    align-items: center;\n    background: var(--color);\n    color: #252935;\n    border-radius: 6px;\n    padding: 4px 7px 4px 13px;\n    min-height: 39px;\n    gap: 6px;\n  }\n  .collection-head > .collection-name {\n    font-weight: 600;\n    font-size: 14px;\n    flex: 1;\n    justify-content: flex-start;\n    min-width: 0;\n    padding: 4px 0;\n  }\n  .collection-head > .collection-name:hover {\n    background: transparent;\n    text-decoration: underline;\n  }\n  .collection-head > small {\n    color: #354054;\n    font-size: 11px;\n  }\n  .collection-head .icon-button {\n    color: #354054;\n  }\n  .collection-body {\n    padding: 9px 6px 12px;\n  }\n  .saved-row {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    border-radius: 5px;\n    padding: 2px 6px;\n    min-height: 34px;\n    position: relative;\n  }\n  .saved-row:hover {\n    background: var(--hover);\n  }\n  .saved-row > .link-open {\n    padding: 4px 0;\n    min-width: 0;\n    flex: 1;\n    text-align: left;\n    justify-content: flex-start;\n    font-size: 13px;\n  }\n  .saved-row > .link-open:hover {\n    background: transparent;\n  }\n  .saved-row .icon-button {\n    opacity: 0;\n    width: 24px;\n    height: 24px;\n  }\n  .saved-row:is(:hover, :focus-within) .icon-button {\n    opacity: 1;\n  }\n  .saved-row input[type='checkbox'] {\n    margin: 0;\n  }\n  .saved-group {\n    margin-top: 5px;\n  }\n  .group-toggle {\n    display: flex;\n    justify-content: flex-start;\n    width: 100%;\n    gap: 7px;\n    font-size: 12px;\n    color: var(--muted);\n    padding: 6px;\n  }\n  .group-toggle svg {\n    width: 14px;\n    height: 14px;\n  }\n  .group-toggle span {\n    flex: 1;\n    text-align: left;\n  }\n  .group-members {\n    margin-left: 12px;\n    border-left: 1px solid var(--line);\n    padding-left: 5px;\n  }\n  .collection-note {\n    border: 0;\n    border-left: 2px solid var(--color);\n    border-radius: 0;\n    min-height: 0;\n    width: calc(100% - 12px);\n    margin: 9px 6px 0;\n    padding: 8px 10px;\n    font-size: 12px;\n    background: color-mix(in srgb, var(--color) 11%, var(--bg));\n    color: var(--muted);\n    resize: vertical;\n  }\n  .collection-footer {\n    padding: 5px 4px 0;\n    display: flex;\n    gap: 4px;\n    opacity: 0;\n  }\n  .collection:hover .collection-footer,\n  .collection:focus-within .collection-footer {\n    opacity: 1;\n  }\n  .collection-footer button {\n    font-size: 11px;\n    color: var(--muted);\n  }\n  .collection.drag-over {\n    outline: 2px solid var(--accent);\n    outline-offset: 4px;\n  }\n  .collection .empty {\n    padding: 18px 6px;\n    text-align: left;\n    font-size: 12px;\n  }\n  .detail .collection-head {\n    min-height: 46px;\n  }\n  .detail .collection-body {\n    padding-top: 13px;\n  }\n  .detail .saved-row {\n    min-height: 40px;\n  }\n  .detail .collection-note {\n    font-size: 13px;\n  }\n  .detail .collection-footer {\n    opacity: 1;\n  }\n  .list-view {\n    grid-template-columns: 1fr !important;\n    max-width: none;\n  }\n  .list-view .collection {\n    content-visibility: auto;\n  }\n  .view-active {\n    background: var(--hover);\n    color: var(--text);\n  }\n  @media (min-width: 1700px) {\n    #board {\n      grid-template-columns: repeat(3, minmax(280px, 1fr));\n    }\n  }\n  @media (max-width: 1000px) {\n    .app-shell {\n      grid-template-columns: 248px minmax(0, 1fr);\n    }\n    #main {\n      padding: 30px 25px;\n    }\n    #board {\n      grid-template-columns: 1fr;\n    }\n    .head-actions {\n      gap: 3px;\n    }\n    #global-search kbd {\n      display: none;\n    }\n  }\n  @media (max-width: 640px) {\n    .app-shell {\n      display: block;\n    }\n    .app-shell > aside {\n      position: relative;\n      height: auto;\n      max-height: 45dvh;\n      border-right: 0;\n      border-bottom: 1px solid var(--line);\n      padding: 15px;\n    }\n    .brand {\n      padding-bottom: 10px;\n    }\n    .section-heading {\n      margin: 13px 5px 8px;\n    }\n    .sidebar-bottom,\n    #recent {\n      display: none;\n    }\n    #main {\n      padding: 25px 17px;\n    }\n    .page-head {\n      gap: 10px;\n    }\n    .head-actions {\n      flex-direction: column;\n      align-items: flex-end;\n    }\n    h1 {\n      font-size: 26px;\n    }\n    .eyebrow {\n      font-size: 9px;\n    }\n    #board {\n      gap: 22px;\n    }\n    .collection-footer {\n      opacity: 1;\n    }\n  }\n  @media (pointer: coarse) {\n    .tab-row .tab-select {\n      position: static;\n      opacity: 1;\n    }\n    .tab-row > .favicon {\n      visibility: visible !important;\n    }\n    .tab-row .row-close,\n    .saved-row .icon-button {\n      opacity: 1;\n    }\n    button {\n      min-height: 34px;\n    }\n  }\n  @media (prefers-reduced-motion: reduce) {\n    * {\n      scroll-behavior: auto !important;\n      transition: none !important;\n    }\n  }\n}\n@layer components {\n  dialog {\n    color: var(--text);\n    background: var(--panel);\n    border: 1px solid var(--line);\n    border-radius: 11px;\n    padding: 0;\n    width: min(560px, calc(100vw - 32px));\n    max-height: 85dvh;\n    box-shadow: var(--shadow);\n  }\n  dialog::backdrop {\n    background: #12162355;\n  }\n  .dialog-head {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    padding: 20px 23px 12px;\n  }\n  .dialog-head h2 {\n    font-size: 18px;\n    letter-spacing: -0.3px;\n  }\n  .dialog-body {\n    padding: 10px 23px 23px;\n    overflow: auto;\n    max-height: 65dvh;\n  }\n  dialog footer {\n    padding: 13px 23px 19px;\n    display: flex;\n    justify-content: flex-end;\n    gap: 8px;\n    border-top: 1px solid var(--line);\n  }\n  .dialog-body .actions {\n    display: grid;\n    gap: 4px;\n  }\n  .actions > button {\n    justify-content: flex-start;\n    text-align: left;\n  }\n  .swatches {\n    display: flex;\n    gap: 8px;\n    margin: 12px 0;\n  }\n  .swatch {\n    width: 24px;\n    height: 24px;\n    border-radius: 50%;\n    padding: 0;\n    border: 2px solid transparent;\n  }\n  .swatch.selected {\n    outline: 2px solid var(--accent);\n    outline-offset: 2px;\n  }\n  .stash {\n    position: fixed;\n    inset: auto;\n    margin: 0;\n    border: 1px solid var(--line);\n    border-radius: 8px;\n    background: var(--panel);\n    color: var(--text);\n    box-shadow: var(--shadow);\n    padding: 18px;\n    width: 286px;\n    max-width: calc(100vw - 24px);\n  }\n  .stash h3 {\n    font-size: 13px;\n    font-weight: 550;\n  }\n  .stash .row {\n    margin-top: 16px;\n    gap: 8px;\n  }\n  .stash button {\n    font-size: 12px;\n  }\n  .stash .check-label {\n    font-size: 13px;\n  }\n  .settings-section {\n    border-top: 1px solid var(--line);\n    padding-top: 19px;\n    margin-top: 23px;\n  }\n  .settings-section h3 {\n    margin-bottom: 16px;\n  }\n  .settings-section .hint {\n    margin-bottom: 12px;\n  }\n  .settings-row {\n    display: grid;\n    grid-template-columns: 1fr 1fr;\n    gap: 14px;\n  }\n  #toast {\n    position: fixed;\n    bottom: 24px;\n    left: 50%;\n    transform: translateX(-50%);\n    background: var(--panel);\n    border: 1px solid var(--line);\n    box-shadow: var(--shadow);\n    padding: 10px 13px;\n    border-radius: 8px;\n    display: flex;\n    align-items: center;\n    gap: 16px;\n    max-width: calc(100vw - 30px);\n    z-index: 30;\n    font-size: 13px;\n  }\n  #toast.error {\n    border-color: light-dark(#cf767e, #b05964);\n  }\n  #toast button {\n    color: var(--accent);\n    font-size: 12px;\n  }\n  .search-input {\n    font-size: 16px;\n    padding: 12px;\n    border: 0;\n    border-bottom: 1px solid var(--line);\n    border-radius: 0;\n  }\n  .search-result {\n    width: 100%;\n    justify-content: flex-start;\n    text-align: left;\n    min-height: 49px;\n    padding: 9px 12px;\n  }\n  .search-result small {\n    display: block;\n    font-size: 11px;\n  }\n  .search-result .row-title {\n    white-space: normal;\n  }\n  .search-result:focus {\n    background: var(--selected);\n    outline: 0;\n  }\n  .search-result > .badge {\n    font-size: 10px;\n    color: var(--muted);\n    margin-left: auto;\n  }\n  .search-results {\n    max-height: 380px;\n    overflow: auto;\n    padding: 6px;\n  }\n  .search-scope {\n    padding: 6px 12px;\n  }\n  .quick-body {\n    width: 620px;\n    min-width: 560px;\n    max-width: none;\n    min-height: 160px;\n    max-height: 590px;\n    overflow: hidden;\n    background: var(--bg);\n  }\n  .quick-head {\n    display: flex;\n    padding: 12px;\n    align-items: center;\n    gap: 8px;\n    border-bottom: 1px solid var(--line);\n  }\n  .quick-head input {\n    border: 0;\n    background: var(--side);\n    padding: 10px;\n    flex: 1;\n    min-width: 0;\n  }\n  .quick-grid {\n    display: grid;\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n    gap: 10px;\n    padding: 14px;\n    max-height: 480px;\n    overflow: auto;\n  }\n  .preview-tile {\n    display: block;\n    text-align: left;\n    padding: 0;\n    border: 1px solid var(--line);\n    background: var(--panel);\n    overflow: hidden;\n    border-radius: 7px;\n  }\n  .preview-tile:focus {\n    outline: 2px solid var(--accent);\n    outline-offset: 1px;\n    background: var(--selected);\n  }\n  .preview-image {\n    height: 105px;\n    width: 100%;\n    background: var(--side);\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    overflow: hidden;\n  }\n  .preview-image img {\n    width: 100%;\n    height: 100%;\n    object-fit: cover;\n    object-position: top;\n    display: block;\n  }\n  .preview-image .muted {\n    font-size: 11px;\n  }\n  .preview-info {\n    padding: 9px 10px;\n  }\n  .preview-info strong {\n    display: block;\n    font-size: 12px;\n    font-weight: 550;\n    white-space: nowrap;\n    overflow: hidden;\n    text-overflow: ellipsis;\n  }\n  .preview-info small {\n    display: block;\n    font-size: 10px;\n    margin-top: 2px;\n  }\n  .group-preview {\n    display: grid;\n    grid-template-columns: 1fr 1fr;\n    gap: 4px;\n    padding: 8px;\n    background: color-mix(in srgb, var(--blue) 25%, var(--bg));\n    height: 105px;\n  }\n  .group-preview .preview-image {\n    height: 42px;\n    border-radius: 3px;\n  }\n  .group-preview .preview-image .muted {\n    font-size: 8px;\n  }\n  .plan-group {\n    border: 1px solid var(--line);\n    border-radius: 6px;\n    padding: 11px;\n    margin: 10px 0;\n  }\n  .plan-group ul {\n    padding-left: 23px;\n    font-size: 12px;\n    color: var(--muted);\n    margin: 9px 0 0;\n  }\n  .review-list {\n    max-height: 240px;\n    overflow: auto;\n    border: 1px solid var(--line);\n    border-radius: 6px;\n    padding: 5px;\n  }\n  .review-list > label {\n    display: flex;\n    align-items: center;\n    gap: 9px;\n    font-size: 12px;\n    padding: 7px;\n  }\n  .recovery-row {\n    padding: 12px 0;\n    border-bottom: 1px solid var(--line);\n  }\n  .recovery-row .row {\n    justify-content: space-between;\n  }\n  .recovery-row p {\n    font-size: 12px;\n    color: var(--muted);\n  }\n  .parked-page {\n    display: grid;\n    place-items: center;\n    min-height: 100dvh;\n  }\n  .parked-card {\n    max-width: 500px;\n    padding: 35px;\n  }\n  .parked-spinner {\n    width: 28px;\n    height: 28px;\n    border: 2px solid var(--line);\n    border-top-color: var(--accent);\n    border-radius: 50%;\n    animation: parked-spin 0.8s linear infinite;\n  }\n  @keyframes parked-spin {\n    to {\n      transform: rotate(360deg);\n    }\n  }\n  @media (prefers-reduced-motion: reduce) {\n    .parked-spinner {\n      animation: none;\n    }\n  }\n  .parked-card p {\n    margin-bottom: 20px;\n    color: var(--muted);\n  }\n  @media (max-width: 640px) {\n    .quick-body.search-window {\n      width: 100%;\n      min-width: 0;\n    }\n    .quick-grid {\n      grid-template-columns: repeat(2, minmax(0, 1fr));\n    }\n    .settings-row {\n      grid-template-columns: 1fr;\n    }\n    .preview-image {\n      height: 95px;\n    }\n  }\n}\n\n.quick-body.search-window {\n  width: 100%;\n  min-width: 0;\n}\n.search-result[role='option'] {\n  cursor: pointer;\n  display: flex;\n  gap: 10px;\n  align-items: center;\n  border-radius: 5px;\n}\n.search-result[role='option'][aria-selected='true'] {\n  background: var(--selected);\n}\n.search-result[role='option']:hover {\n  background: var(--hover);\n}\n.scope-chip {\n  background: var(--selected);\n  font-size: 12px;\n  padding: 4px 8px;\n}\n.search-scope {\n  display: flex;\n  gap: 6px;\n  flex-wrap: wrap;\n}\n.search-dialog {\n  width: min(680px, calc(100vw - 28px));\n}\n.search-dialog > .search-input {\n  width: calc(100% - 24px);\n  margin: 0 12px;\n}\n.search-window {\n  min-height: 300px;\n  max-height: none;\n  overflow: auto;\n}\n.search-window .search-results {\n  max-height: calc(100dvh - 106px);\n}\n.group-header {\n  display: flex;\n  align-items: center;\n  min-width: 0;\n}\n.group-header .group-toggle {\n  flex: 1;\n  min-width: 0;\n}\n.group-toggle span {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.group-header > .icon-button {\n  opacity: 0;\n  flex: none;\n  width: 25px;\n  height: 25px;\n}\n.group-header:is(:hover, :focus-within) > .icon-button {\n  opacity: 1;\n}\n.more-links {\n  font-size: 12px;\n  color: var(--muted);\n  margin: 3px 6px;\n}\n.collection-head > .collection-name {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  display: block;\n  text-align: left;\n}\n.collection-footer {\n  flex-wrap: wrap;\n}\n.recovery-row .row {\n  flex-wrap: wrap;\n}\ndialog .row-title {\n  min-width: 0;\n}\n@media (pointer: coarse) {\n  .group-header > .icon-button {\n    opacity: 1;\n  }\n}\n.favicon {\n  position: relative;\n}\n.favicon img {\n  position: absolute;\n  width: 18px;\n  height: 18px;\n  inset: 0;\n  background: var(--bg);\n  border-radius: 3px;\n}\n.link-picker {\n  margin: 14px 0;\n}\n.link-picker > .row {\n  justify-content: space-between;\n  flex-wrap: wrap;\n  margin-bottom: 7px;\n}\n.link-picker > .row button {\n  font-size: 12px;\n  padding: 4px 7px;\n}\n.link-picker > input {\n  margin-bottom: 8px;\n}\n.link-picker .review-list {\n  max-height: 210px;\n}\nprogress {\n  width: 100%;\n  height: 7px;\n  accent-color: var(--accent);\n  margin: 16px 0;\n}\n.help-page {\n  max-width: 760px;\n  padding: 44px 24px 80px;\n  margin: auto;\n}\n.help-page h1 {\n  margin: 20px 0 32px;\n}\n.help-page section {\n  margin: 30px 0;\n}\n.help-page h2 {\n  font-size: 18px;\n  margin-bottom: 10px;\n}\n.help-page p {\n  margin: 10px 0;\n  color: var(--muted);\n  line-height: 1.75;\n}\n.help-page code {\n  color: var(--text);\n}\n\n/* Direct organization: spaces, editable titles, and a final add row. */\n#spaces {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n  overflow-x: auto;\n  padding: 3px;\n}\n.space-tab {\n  display: flex;\n  align-items: center;\n  flex: none;\n  border-bottom: 2px solid transparent;\n}\n.space-tab.active {\n  border-color: var(--accent);\n}\n.space-tab > button,\n.space-tab > input {\n  font-size: 17px;\n  font-weight: 600;\n}\n.space-tab > .icon-button {\n  padding: 4px;\n}\n.space-tab .inline-name {\n  width: 170px;\n}\n.page-head {\n  align-items: flex-start;\n  flex-wrap: wrap;\n  gap: 16px;\n  margin-bottom: 24px;\n}\n.head-actions {\n  flex: none;\n  flex-wrap: wrap;\n  gap: 5px;\n}\n#save-current,\n#switch-collection {\n  background: var(--side);\n}\n.add-collection {\n  min-height: 44px;\n  align-self: start;\n  justify-content: flex-start;\n  padding: 10px 14px;\n  color: var(--muted);\n  background: var(--side);\n  border: 1px dashed var(--line);\n  font-weight: 550;\n}\n.add-collection:hover {\n  color: var(--text);\n  border-color: var(--muted);\n}\n.inline-name {\n  min-width: 0;\n  padding: 4px 6px;\n  background: transparent;\n  border: 1px solid currentColor;\n}\n.editable-name {\n  text-align: left;\n  justify-content: flex-start;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.collection-head > input.collection-name {\n  padding: 4px 6px;\n  background: #ffffff40;\n}\n.collection-head {\n  min-height: 44px;\n}\n.collection-head .icon-button {\n  width: 28px;\n  height: 30px;\n  padding: 4px;\n  opacity: 0.45;\n}\n.collection-head:is(:hover, :focus-within) .icon-button {\n  opacity: 1;\n}\n.group-header .group-toggle {\n  flex: none;\n  width: auto;\n  gap: 6px;\n}\n.group-header > .editable-name,\n.group-header > .inline-name {\n  flex: 1;\n  min-width: 0;\n}\n.group-label {\n  display: flex;\n  align-items: center;\n}\n.group-label > .editable-name,\n.group-label > .inline-name {\n  min-width: 0;\n  padding: 3px 5px;\n}\n.saved-row > .icon-button {\n  flex: none;\n  width: 25px;\n  height: 28px;\n  padding: 4px;\n}\n.saved-row .remove-link:hover {\n  color: light-dark(#b43343, #ffb2ba);\n}\n#dedup {\n  position: relative;\n  overflow: visible;\n}\n#dedup:disabled {\n  cursor: default;\n}\n.count-badge {\n  position: absolute;\n  top: -4px;\n  right: -3px;\n  min-width: 15px;\n  height: 15px;\n  padding: 0 3px;\n  font-size: 10px;\n  line-height: 15px;\n  border-radius: 9px;\n  background: var(--text);\n  color: var(--bg);\n  font-weight: 650;\n}\n.action-popover {\n  position: fixed;\n  margin: 0;\n  width: 330px;\n  max-width: calc(100vw - 24px);\n  padding: 20px;\n  border: 1px solid var(--line);\n  border-radius: 10px;\n  box-shadow: var(--shadow);\n  background: var(--panel);\n  color: var(--text);\n}\n.action-popover h2 {\n  margin-bottom: 16px;\n}\n.action-popover footer {\n  display: flex;\n  justify-content: flex-end;\n  margin-top: 16px;\n}\n\n/* A transient Windows-style switcher, with the current page visible around it. */\n.full-switcher {\n  margin: 0;\n  overflow: hidden;\n}\n.switcher-backdrop {\n  position: fixed;\n  inset: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 32px;\n  background: light-dark(#00000020, #00000045);\n  color: var(--text);\n  font:\n    14px/1.5 'Segoe UI',\n    system-ui,\n    sans-serif;\n}\n.task-view {\n  display: flex;\n  flex-direction: column;\n  width: min(1180px, 100%);\n  max-height: min(86dvh, 900px);\n  min-height: 0;\n  padding: 22px 24px 14px;\n  gap: 16px;\n  color: var(--text);\n  background: light-dark(#f4f4f2e6, #282a2ee6);\n  border: 1px solid light-dark(#ffffffaa, #ffffff28);\n  border-radius: 14px;\n  box-shadow:\n    0 22px 80px #0005,\n    inset 0 1px 0 #ffffff12;\n  backdrop-filter: blur(32px) saturate(135%);\n}\n.task-view [hidden] {\n  display: none !important;\n}\n.task-view button:disabled {\n  cursor: default;\n}\n.task-head,\n.task-title,\n.view-choices {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n.task-head {\n  flex: none;\n}\n.task-title {\n  flex: 1;\n  align-items: baseline;\n}\n.task-title h1 {\n  font-size: 20px;\n  letter-spacing: -0.35px;\n}\n.task-title .muted {\n  font-size: 12px;\n}\n.task-head > button {\n  font-size: 12px;\n}\n.task-view .quick-head {\n  flex: none;\n  padding: 0;\n  border: 0;\n  gap: 10px;\n}\n.task-view .quick-head input {\n  background: light-dark(#ffffffb8, #15171999);\n  border: 1px solid var(--line);\n  padding: 10px 12px;\n  font-size: 14px;\n}\n.view-choices {\n  gap: 2px;\n}\n.view-choices button,\n#select-mode {\n  white-space: nowrap;\n  font-size: 12px;\n}\n#select-mode {\n  border: 1px solid var(--line);\n  margin-left: 4px;\n}\n#select-mode[aria-pressed='true'] {\n  background: var(--selected);\n  border-color: var(--accent);\n}\n.task-view .quick-grid {\n  grid-template-columns: repeat(var(--columns, 3), minmax(0, 340px));\n  gap: 18px;\n  justify-content: center;\n  padding: 7px;\n  margin: -7px;\n  align-content: start;\n  min-height: 0;\n  max-height: min(50dvh, 550px);\n  overflow-y: auto;\n  flex: 0 1 auto;\n}\n.switcher-card {\n  position: relative;\n  min-width: 0;\n  border-radius: 9px;\n}\n.task-view .preview-tile {\n  width: 100%;\n  border: 1px solid light-dark(#00000016, #ffffff1c);\n  border-radius: 8px;\n  background: light-dark(#ffffffa8, #17191dbb);\n  box-shadow: 0 2px 7px #0002;\n}\n.task-view .preview-tile:hover {\n  border-color: var(--muted);\n  background: var(--panel);\n}\n.task-view .preview-tile:focus-visible,\n.task-view .tab-choice:focus-visible {\n  outline: 3px solid light-dark(#087cca, #68caff);\n  outline-offset: 3px;\n}\n.task-view .preview-image {\n  width: 100%;\n  height: auto;\n  aspect-ratio: 16 / 10;\n  background: var(--side);\n}\n.task-view .preview-image img {\n  object-fit: cover;\n  object-position: top;\n}\n.tile-topline {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  height: 36px;\n  padding: 7px 10px;\n}\n.tile-topline > span:not(.favicon):not(.selection-mark) {\n  flex: 1;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 12px;\n}\n.task-view .group-tile {\n  box-shadow:\n    0 -4px 0 -1px var(--blue),\n    0 -8px 0 -3px color-mix(in srgb, var(--blue) 45%, var(--panel));\n  margin-top: 4px;\n}\n.task-view .preview-info {\n  padding: 7px 11px 8px;\n}\n.task-view .preview-info small {\n  margin: 0;\n  font-size: 11px;\n  color: var(--muted);\n}\n.preview-missing {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  text-align: center;\n  gap: 6px;\n  padding: 20px;\n  font-size: 14px;\n}\n.preview-missing small {\n  font-size: 11px;\n  color: var(--muted);\n}\n.task-view .search-results {\n  min-height: 0;\n  max-height: min(50dvh, 550px);\n  overflow: auto;\n  padding: 5px;\n  flex: 0 1 auto;\n}\n.task-view .search-result {\n  min-height: 52px;\n  width: 100%;\n  font-size: 14px;\n}\n.task-view .tab-list .switcher-card {\n  margin: 0 0 5px;\n  box-shadow: none;\n}\n.task-view .tab-choice {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: flex-start;\n  text-align: left;\n}\n.task-view .tab-choice .tile-topline {\n  flex: 1;\n  min-width: 0;\n  padding: 0;\n}\n.task-view .tab-choice .preview-info {\n  padding: 0 8px;\n}\n.task-view .search-scope {\n  margin: -8px 0 0;\n  padding: 0;\n  flex: none;\n}\n.selection-toolbar {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 4px;\n  border-bottom: 1px solid var(--line);\n  padding-bottom: 12px;\n  flex: none;\n}\n.selection-toolbar strong {\n  margin-right: auto;\n  font-size: 12px;\n}\n.selection-toolbar button {\n  font-size: 12px;\n}\n.selection-mark {\n  display: grid;\n  place-items: center;\n  flex: none;\n  width: 18px;\n  height: 18px;\n  border: 1px solid var(--muted);\n  border-radius: 4px;\n  line-height: 1;\n}\n.is-selected .selection-mark {\n  background: var(--accent-fill);\n  color: var(--on-accent);\n  border-color: var(--accent-fill);\n}\n.is-selected > button:first-child {\n  outline: 2px solid var(--accent);\n  outline-offset: 1px;\n  background: var(--selected);\n}\n.browse-group {\n  position: absolute;\n  right: 5px;\n  bottom: 3px;\n  background: var(--panel);\n  font-size: 11px;\n  padding: 4px 6px;\n}\n.selecting .group-tile .preview-info {\n  padding-right: 125px;\n}\n.group-rename {\n  display: flex;\n  align-items: flex-end;\n  gap: 8px;\n  flex: none;\n}\n.group-rename label {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  font-size: 12px;\n  flex: 1;\n}\n.group-rename input {\n  flex: 1;\n}\n.group-rename button {\n  font-size: 12px;\n}\n.collection-dock {\n  flex: none;\n  border-top: 1px solid var(--line);\n  padding-top: 12px;\n  min-width: 0;\n}\n.dock-actions {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  margin-bottom: 7px;\n}\n.dock-actions strong {\n  margin-right: auto;\n  font-size: 11px;\n  color: var(--muted);\n}\n.dock-actions button {\n  font-size: 12px;\n}\n.dock-collections {\n  display: flex;\n  gap: 9px;\n  overflow-x: auto;\n  padding-bottom: 4px;\n}\n.dock-collection {\n  border-top: 3px solid var(--color);\n  min-width: 125px;\n  max-width: 220px;\n  min-height: 42px;\n  padding: 8px 12px;\n  background: light-dark(#ffffff70, #ffffff08);\n  justify-content: flex-start;\n  text-align: left;\n  flex: none;\n  font-size: 12px;\n}\n.switcher-hint {\n  display: flex;\n  justify-content: space-between;\n  font-size: 10px;\n  color: var(--muted);\n  margin-top: -6px;\n}\n/* Only protected browser pages need a separate, bounded extension window. */\n.full-switcher .switcher-backdrop {\n  padding: 12px;\n}\n.full-switcher .task-view {\n  max-height: calc(100dvh - 24px);\n  width: 100%;\n}\n.note-preview {\n  margin: 0;\n  position: fixed;\n  width: min(340px, calc(100vw - 24px));\n  max-height: min(320px, calc(100vh - 24px));\n  padding: 14px;\n  background: var(--panel);\n  color: var(--text);\n  border: 1px solid var(--line);\n  border-radius: 9px;\n  box-shadow: 0 10px 32px #0003;\n  overflow: auto;\n}\n.note-preview header {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  margin-bottom: 8px;\n}\n.note-preview header strong {\n  flex: 1;\n  font-size: 13px;\n}\n.note-content {\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  font-size: 14px;\n  line-height: 1.6;\n}\n.note-button {\n  color: var(--accent);\n}\n.group-label[draggable='true'],\n.group-header[draggable='true'] {\n  cursor: grab;\n}\n.group-label[draggable='true']:active,\n.group-header[draggable='true']:active {\n  cursor: grabbing;\n}\n@media (max-width: 780px) {\n  .switcher-backdrop {\n    padding: 16px;\n  }\n  .task-view {\n    padding: 16px;\n    gap: 12px;\n    max-height: calc(100dvh - 32px);\n  }\n  .task-view .quick-head {\n    flex-wrap: wrap;\n    gap: 6px;\n  }\n  .task-view .quick-head input {\n    flex-basis: 70%;\n  }\n  .task-view .quick-grid {\n    gap: 12px;\n  }\n  .selection-toolbar strong {\n    flex-basis: 100%;\n  }\n}\n@media (prefers-reduced-transparency: reduce) {\n  .task-view {\n    background: var(--panel);\n    backdrop-filter: none;\n  }\n}\n@media (forced-colors: active) {\n  .task-view,\n  .task-view .preview-tile {\n    background: Canvas;\n    border: 1px solid CanvasText;\n  }\n  .is-selected > button:first-child {\n    outline-color: Highlight;\n  }\n}\n\n/* Shared controls across the organizer and the floating switcher. */\n.tab-tools {\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  flex-wrap: wrap;\n}\n#tab-tools {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n}\n.task-view > .tab-tools {\n  flex: none;\n  padding-bottom: 4px;\n}\n.tab-tools button {\n  font-size: 12px;\n}\n.dedup-button {\n  position: relative;\n  overflow: visible;\n}\n.dedup-button:disabled {\n  opacity: 0.45;\n}\n.dedup-button .count-badge {\n  position: static;\n  min-width: 17px;\n  margin-left: 2px;\n}\n.task-view .switcher-card {\n  width: 100%;\n  max-width: 340px;\n  justify-self: center;\n}\n.task-view .tab-list .switcher-card {\n  max-width: none;\n}\n.task-view.search-only {\n  width: min(760px, 100%);\n}\n.search-only .search-results {\n  max-height: min(55dvh, 440px);\n  overflow-y: auto;\n}\n.search-scope {\n  flex-wrap: wrap;\n}\n.saved-selection {\n  margin: 10px 12px 0;\n  padding-bottom: 10px;\n  gap: 4px;\n}\n.saved-selection button {\n  font-size: 11px;\n  padding: 5px 7px;\n}\n.saved-row.selected {\n  background: var(--selected);\n  border-radius: 5px;\n}\n.saved-row > input[type='checkbox'],\n.group-header > input[type='checkbox'] {\n  width: 16px;\n  height: 16px;\n  flex: none;\n}\n#tabs.selecting .tab-select {\n  opacity: 1;\n}\n#selection {\n  display: flex;\n  gap: 4px;\n  flex-wrap: wrap;\n  align-items: center;\n}\n#selection > strong {\n  flex-basis: 100%;\n}\n#selection button {\n  font-size: 12px;\n  padding: 6px;\n}\n.collection-head .collection-select {\n  flex: none;\n  font-size: 11px;\n  padding: 4px 6px;\n}\n\n/* Direct actions: small anchored lists and a single compact selection strip. */\n.action-menu {\n  width: 240px;\n  padding: 8px;\n  max-height: calc(100dvh - 24px);\n  overflow-y: auto;\n}\n.action-menu .menu-items {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n.action-menu .menu-items > button {\n  width: 100%;\n  min-height: 30px;\n  justify-content: flex-start;\n  text-align: left;\n  padding: 6px 9px;\n  font-size: 12px;\n}\n.action-menu hr {\n  width: calc(100% - 12px);\n  border: 0;\n  border-top: 1px solid var(--line);\n  margin: 6px;\n}\n.action-menu .swatches {\n  gap: 8px;\n  padding: 8px;\n  flex-wrap: wrap;\n}\n.action-menu .swatch {\n  width: 23px;\n  height: 23px;\n}\n.collection-head .icon-button,\n.collection-head .selection-mode-button {\n  width: 28px;\n  height: 28px;\n  padding: 5px;\n  color: #18202b;\n  opacity: 0.75;\n  flex: none;\n  background: transparent;\n}\n.collection-head .icon-button:is(:hover, :active),\n.collection-head .selection-mode-button:is(:hover, :active) {\n  background: #00000012;\n  opacity: 1;\n}\n.collection-head .icon-button:focus-visible,\n.collection-head .selection-mode-button:focus-visible {\n  outline: 2px solid #263850;\n  outline-offset: -2px;\n}\n.collection-head .collection-name:hover {\n  text-decoration: none;\n}\n.collection-head {\n  gap: 4px;\n  cursor: grab;\n}\n.collection-head:active {\n  cursor: grabbing;\n}\n.collection.folded {\n  min-height: 0;\n  background: transparent;\n}\n.collection.folded .collection-head {\n  margin-bottom: 0;\n}\n.collection.dragging {\n  opacity: 0.28;\n}\n.collection-insertion {\n  position: fixed;\n  z-index: 2147483647;\n  background: var(--accent);\n  box-shadow: 0 0 0 1px var(--bg);\n  border-radius: 2px;\n  pointer-events: none;\n}\n.collection-drag-ghost {\n  position: fixed;\n  top: 0;\n  left: 0;\n  z-index: -1;\n  border-radius: 6px;\n  padding: 12px 14px;\n  background: var(--color);\n  color: #18202b;\n  font:\n    600 14px 'Segoe UI',\n    sans-serif;\n  pointer-events: none;\n}\n#selection,\n.saved-selection {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 3px;\n  align-items: center;\n  padding: 6px 0;\n  margin: 0 0 7px;\n  border: 0;\n  border-bottom: 1px solid var(--line);\n  border-radius: 0;\n  background: transparent;\n}\n.saved-selection {\n  margin: 0 10px;\n  padding: 8px 0;\n}\n#selection > strong,\n.saved-selection > strong {\n  flex: 0 0 auto;\n  font-size: 11px;\n  margin-right: auto;\n  white-space: nowrap;\n}\n#selection button,\n.saved-selection button {\n  width: 27px;\n  height: 27px;\n  min-width: 27px;\n  padding: 5px;\n}\n#tabs .tab-row {\n  margin-bottom: 4px;\n}\n#tabs.selecting .tab-row > .favicon {\n  visibility: hidden;\n}\n#selection {\n  gap: 1px;\n}\n#selection button {\n  width: 24px;\n  height: 24px;\n  min-width: 24px;\n  padding: 4px;\n}\n#selection > strong {\n  margin-right: 4px;\n}\n#tabs .tab-row .tab-open:focus-visible {\n  outline: 0;\n}\n#tabs .tab-row:has(.tab-open:focus-visible) {\n  outline: 2px solid var(--accent);\n  outline-offset: -2px;\n}\n#tabs .tab-row.selected .tab-open {\n  background: transparent;\n  box-shadow: none;\n}\n.saved-row {\n  margin-bottom: 3px;\n}\n.saved-row .link-open:focus-visible {\n  outline-offset: -2px;\n}\n.selection-toolbar .icon-button {\n  width: 28px;\n  height: 28px;\n  padding: 5px;\n}\n#ai-tools {\n  display: inline-flex;\n  gap: 6px;\n  align-items: center;\n}\n\n.action-popover:has(.switch-picker) {\n  width: 380px;\n  max-height: calc(100vh - 24px);\n  overflow-y: auto;\n}\n.switch-picker {\n  display: grid;\n  gap: 10px;\n  min-width: 0;\n}\n.switch-picker input[type='search'] {\n  width: 100%;\n}\n.switch-picker .hint {\n  margin: 0;\n}\n.switch-picker [role='status']:empty {\n  display: none;\n}\n.switch-choices {\n  display: grid;\n  gap: 3px;\n  max-height: min(300px, 40vh);\n  overflow-y: auto;\n}\n.switch-choices > button {\n  display: grid;\n  gap: 3px;\n  width: 100%;\n  text-align: left;\n  padding: 9px 10px;\n}\n.switch-name,\n.switch-detail {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.switch-detail {\n  font-size: 12px;\n  color: var(--muted);\n}\n\n.switch-picker .check-label {\n  margin: 0;\n  font-size: 13px;\n}\n.switch-choices > button {\n  justify-content: stretch;\n  justify-items: start;\n  font-size: 14px;\n}\n\n/* Selection actions must be distinguishable from leaving selection mode. */\n#sidebar .section-heading {\n  gap: 6px;\n  margin-inline: 0;\n}\n#sidebar .section-heading h2 {\n  white-space: nowrap;\n  font-size: 14px;\n}\n#tab-tools,\n.tab-tools.compact {\n  flex-wrap: nowrap;\n  gap: 2px;\n  flex: none;\n}\n.tab-tools.compact > button {\n  width: 28px;\n  min-width: 28px;\n  height: 28px;\n  padding: 5px;\n  flex: none;\n}\n.tab-tools .dedup-button,\n.tab-tools.compact > .dedup-button {\n  width: auto;\n  min-width: 28px;\n  gap: 3px;\n  overflow: hidden;\n}\n.dedup-button .count-badge {\n  position: static;\n  display: inline-grid;\n  place-items: center;\n  flex: none;\n  width: 16px;\n  min-width: 16px;\n  height: 16px;\n  padding: 0;\n  margin: 0;\n  border-radius: 50%;\n  font-size: 10px;\n  line-height: 1;\n}\n#tab-tools .selection-mode-button,\n#select-mode.selection-mode-button,\n.collection-head .selection-mode-button {\n  width: auto;\n  min-width: 46px;\n  height: 28px;\n  padding: 4px 7px;\n  flex: none;\n  font-size: 12px;\n  opacity: 1;\n}\n#tab-tools button:focus-visible,\n.tab-tools button:focus-visible,\n.selection-mode-button:focus-visible,\n#selection button:focus-visible,\n.selection-toolbar button:focus-visible {\n  outline: 2px solid var(--accent);\n  outline-offset: -2px;\n}\n#selection {\n  display: flex;\n  gap: 4px;\n  flex-direction: column;\n  align-items: stretch;\n}\n.selection-summary,\n.selection-actions {\n  display: flex;\n  align-items: center;\n  gap: 3px;\n}\n.selection-summary > strong {\n  margin-right: auto;\n  font-size: 12px;\n}\n#selection .selection-actions > button {\n  width: 28px;\n  min-width: 28px;\n  height: 28px;\n  padding: 5px;\n}\n#selection .selection-actions > .close-selected,\n.selection-toolbar > .close-selected {\n  width: auto;\n  min-width: 72px;\n  height: 28px;\n  padding: 4px 8px;\n  margin-left: auto;\n  font-size: 12px;\n  color: light-dark(#a52c3b, #ffb2ba);\n}\n.close-selected:not(:disabled):hover {\n  background: light-dark(#fce9ed, #482b32);\n}\n\n/* Settings: a toolbar menu for quick preferences, focused dialogs for longer tasks. */\n.head-actions > #settings {\n  display: inline-grid;\n  place-items: center;\n  width: 32px;\n  height: 32px;\n  padding: 6px;\n  flex: none;\n}\n.settings-menu {\n  width: 320px;\n  padding: 12px;\n  max-height: calc(100dvh - 24px);\n  overflow-y: auto;\n}\n.settings-menu h2 {\n  margin: 4px 8px 8px;\n  font-size: 14px;\n}\n.settings-list {\n  display: grid;\n  gap: 2px;\n}\n.settings-list hr {\n  width: auto;\n  margin: 8px;\n  border: 0;\n  border-top: 1px solid var(--line);\n}\n.settings-entry {\n  display: flex;\n  justify-content: flex-start;\n  width: 100%;\n  min-height: 36px;\n  gap: 10px;\n  padding: 8px;\n  font-size: 13px;\n  text-align: left;\n}\n.settings-preference {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  min-height: 36px;\n  padding: 5px 8px;\n  font-size: 13px;\n  cursor: pointer;\n}\n.settings-preference select {\n  width: 96px;\n  padding: 4px 7px;\n  font-size: 12px;\n}\n.settings-preference input[role='switch'] {\n  appearance: none;\n  position: relative;\n  width: 30px;\n  height: 18px;\n  flex: none;\n  margin: 0;\n  padding: 0;\n  border: 1px solid var(--muted);\n  border-radius: 12px;\n  background: var(--hover);\n  cursor: pointer;\n}\n.settings-preference input[role='switch']::after {\n  content: '';\n  position: absolute;\n  top: 2px;\n  left: 2px;\n  width: 12px;\n  height: 12px;\n  border-radius: 50%;\n  background: var(--muted);\n}\n.settings-preference input[role='switch']:checked {\n  background: var(--accent-fill);\n  border-color: var(--accent-fill);\n}\n.settings-preference input[role='switch']:checked::after {\n  left: 14px;\n  background: var(--on-accent);\n}\n.settings-menu :is(button, select, input):focus-visible {\n  outline: 2px solid var(--accent);\n  outline-offset: -2px;\n}\n.settings-detail {\n  width: min(640px, calc(100vw - 32px));\n  max-height: calc(100dvh - 40px);\n}\n.settings-detail::backdrop {\n  background: #080b10a0;\n  backdrop-filter: blur(3px);\n}\n.settings-detail .dialog-head {\n  padding: 26px 30px 12px;\n}\n.settings-detail .dialog-head h2 {\n  font-size: 24px;\n  font-weight: 650;\n}\n.settings-detail .dialog-head .icon-button {\n  width: 32px;\n  height: 32px;\n  padding: 6px;\n}\n.settings-detail .dialog-head :focus-visible {\n  outline-offset: -2px;\n}\n.settings-detail .dialog-head h2:focus {\n  outline: none;\n}\n.settings-detail .dialog-body {\n  padding: 12px 30px 28px;\n  max-height: calc(100dvh - 220px);\n}\n.settings-detail .settings-section {\n  border: 0;\n  padding: 0;\n  margin: 0;\n}\n.settings-detail .field {\n  margin-bottom: 16px;\n}\n.settings-detail footer {\n  padding: 16px 30px 22px;\n}\n.transfer-options {\n  display: grid;\n  gap: 18px;\n}\n.transfer-options .transfer-primary {\n  justify-content: flex-start;\n  text-align: left;\n  gap: 12px;\n  padding: 20px;\n  min-height: 70px;\n  border-radius: 9px;\n  background: var(--hover);\n  font-size: 15px;\n  font-weight: 600;\n}\n.transfer-options summary {\n  padding: 12px 0;\n  cursor: pointer;\n  font-weight: 550;\n}\n.transfer-options details {\n  border-bottom: 1px solid var(--line);\n  padding-bottom: 8px;\n}\n.transfer-formats {\n  display: grid;\n  gap: 6px;\n}\n@media (max-width: 600px) {\n  .settings-detail .dialog-head {\n    padding: 20px 20px 10px;\n  }\n  .settings-detail .dialog-body {\n    padding: 10px 20px 20px;\n  }\n}\n\n.collection-note-editor {\n  margin: 9px 6px 2px;\n}\n.collection-note-editor .collection-note {\n  display: block;\n  width: 100%;\n  margin: 0;\n  min-height: 44px;\n}\n.collection-note-editor .delete-collection-note {\n  display: block;\n  margin: 3px 0 0 auto;\n  padding: 4px 6px;\n  font-size: 11px;\n  color: var(--muted);\n}\n.collection-note-editor .delete-collection-note:hover {\n  color: light-dark(#a52c3b, #ffb2ba);\n  background: var(--hover);\n}\n.collection-note-editor :focus-visible {\n  outline-offset: -2px;\n}\n\n.space-tab > .space-options {\n  opacity: 0.65;\n  width: 26px;\n  height: 26px;\n  padding: 4px;\n  flex: none;\n}\n.space-tab > .space-options:is(:hover, :focus-visible) {\n  opacity: 1;\n}\n.space-tab > .space-options:focus-visible {\n  outline-offset: -2px;\n}\n\n/* Session history stays compact above a scrollable, grouped tab list. */\n.history-heading {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n.history-heading h2 {\n  margin: 0;\n  flex: 1;\n  white-space: nowrap;\n}\n.history-heading select {\n  width: auto;\n  max-width: 130px;\n  font: inherit;\n  font-size: 11px;\n  padding: 4px;\n}\n.history-navigation {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 6px;\n  margin: 12px 0;\n}\n.history-navigation time {\n  font-size: 12px;\n  color: var(--muted);\n  text-align: center;\n}\n.history-name {\n  display: block;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 13px;\n}\n.history-reason {\n  margin: 3px 0 8px;\n  font-size: 11px;\n}\n.history-tabs {\n  max-height: 230px;\n  overflow-y: auto;\n}\n.history-tabs .recent-link {\n  display: block;\n  width: 100%;\n  text-align: left;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  padding: 7px 6px;\n  margin: 2px 0;\n}\n.history-group {\n  display: block;\n  color: var(--muted);\n  padding: 8px 6px 2px;\n}\n.history-restore {\n  width: 100%;\n  margin-top: 10px;\n}\n.history-footnote {\n  font-size: 10px;\n  margin: 8px 0 0;\n}\n.collection-switch {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  margin: 6px 10px;\n  padding: 4px 6px;\n  max-width: calc(100% - 20px);\n  font-size: 12px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.collection-switch svg {\n  width: 14px;\n  height: 14px;\n}\n\n/* Focused switcher: clear scopes, stable card actions and quiet surfaces. */\n.switcher-backdrop {\n  background: light-dark(#18203630, #03060c66);\n  backdrop-filter: blur(5px);\n}\n.task-view {\n  width: min(1240px, 100%);\n  padding: 24px 28px 16px;\n  gap: 14px;\n  background: light-dark(#fafbfdf5, #202328f5);\n  border-radius: 20px;\n  box-shadow: 0 28px 100px #0006;\n}\n.task-view.search-only {\n  width: min(1050px, 100%);\n}\n.task-head h1 {\n  font-size: 20px;\n  letter-spacing: -0.3px;\n}\n.task-view .quick-head {\n  gap: 10px;\n}\n.task-view .quick-head input {\n  min-height: 46px;\n  border-radius: 10px;\n  padding: 10px 14px;\n  font-size: 15px;\n  background: light-dark(#fff, #171a1f);\n}\n.task-view .quick-grid {\n  gap: 18px;\n  padding: 5px;\n}\n.task-view .switcher-card {\n  max-width: 380px;\n  position: relative;\n}\n.task-view .preview-tile {\n  border-radius: 12px;\n  overflow: hidden;\n  box-shadow: none;\n  background: light-dark(#fff, #181b20);\n}\n.task-view .preview-tile:focus-visible,\n.task-view .tab-choice:focus-visible {\n  outline: 2px solid var(--accent);\n  outline-offset: 2px;\n}\n.task-view .tile-topline {\n  height: 42px;\n  padding-right: 72px;\n}\n.task-view .group-tile .tile-topline {\n  padding-right: 12px;\n}\n.task-view .preview-info {\n  padding: 9px 12px;\n  color: var(--muted);\n}\n.tile-actions {\n  position: absolute;\n  right: 5px;\n  top: 5px;\n  display: flex;\n  gap: 2px;\n  z-index: 1;\n}\n.tile-actions button {\n  width: 28px;\n  height: 28px;\n  min-width: 28px;\n  padding: 5px;\n  border-radius: 6px;\n  background: light-dark(#ffffffee, #202328ee);\n  color: var(--muted);\n}\n.tile-actions .tile-close:hover {\n  color: light-dark(#b42335, #ff8795);\n  background: light-dark(#fff0f2, #48232c);\n}\n.tile-actions .tile-mute:hover {\n  color: var(--text);\n}\n.task-view .tab-list .tile-actions {\n  top: 50%;\n  transform: translateY(-50%);\n}\n.task-view .tab-list .tab-choice {\n  padding-right: 76px;\n}\n.browse-scopes {\n  display: flex;\n  gap: 4px;\n  align-items: center;\n  flex-wrap: wrap;\n}\n.browse-scopes button {\n  font-size: 13px;\n  padding: 7px 12px;\n  border-radius: 8px;\n  color: var(--muted);\n}\n.browse-scopes button[aria-pressed='true'],\n.overlay-utilities button[aria-pressed='true'] {\n  color: var(--text);\n  background: light-dark(#e6eafa, #39435a);\n}\n.browse-scopes button[data-count]::after {\n  content: attr(data-count);\n  margin-left: 7px;\n  opacity: 0.65;\n  font-size: 11px;\n}\n.browse-scopes .audio-filter {\n  margin-left: auto;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n.overlay-utilities {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding-top: 10px;\n  border-top: 1px solid var(--line);\n}\n.overlay-utilities button {\n  display: flex;\n  gap: 7px;\n  align-items: center;\n  padding: 6px 10px;\n  font-size: 13px;\n}\n.task-view .collection-dock {\n  padding-top: 10px;\n}\n.task-view .selection-toolbar {\n  background: light-dark(#edf0f9, #2c3342);\n  border: 0;\n  border-radius: 10px;\n  padding: 8px 10px;\n  gap: 5px;\n  flex-wrap: wrap;\n}\n.task-view .selection-toolbar button {\n  font-size: 12px;\n}\n.task-view .selection-toolbar > .close-selected {\n  margin-left: auto;\n}\n.task-view .switcher-hint {\n  font-size: 11px;\n  opacity: 0.65;\n}\n.clear-search {\n  flex: none;\n}\n.session-results {\n  display: flex;\n  flex-direction: column;\n  gap: 9px;\n}\n.session-entry {\n  border-bottom: 1px solid var(--line);\n  padding: 8px 0;\n}\n.session-entry summary {\n  cursor: pointer;\n  padding: 9px;\n  font-size: 14px;\n}\n.session-time {\n  display: block;\n  color: var(--muted);\n  font-size: 11px;\n  padding: 0 9px;\n}\n.session-page {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  gap: 14px;\n  width: 100%;\n  text-align: left;\n  padding: 10px;\n  border-radius: 8px;\n}\n.session-page .row-title {\n  min-width: 0;\n  flex: 1;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.session-page small {\n  display: block;\n  color: var(--muted);\n  font-size: 11px;\n}\n.result-verb {\n  font-size: 11px;\n  color: var(--muted);\n  flex: none;\n}\n.session-restore,\n.history-link {\n  margin: 5px 9px;\n  font-size: 12px;\n}\n.collection-result {\n  display: block;\n  width: 100%;\n  padding: 14px;\n  text-align: left;\n  border-radius: 9px;\n}\n.sidebar-scopes {\n  margin: 8px 0 12px;\n  gap: 2px;\n}\n.sidebar-scopes button {\n  font-size: 10px;\n  padding: 5px 6px;\n}\n#sidebar .session-page {\n  flex-wrap: wrap;\n  gap: 3px;\n}\n#sidebar .session-page .result-verb {\n  margin-left: auto;\n}\n@media (max-width: 700px) {\n  .switcher-backdrop {\n    padding: 12px;\n  }\n  .task-view {\n    padding: 16px;\n    border-radius: 14px;\n  }\n  .browse-scopes button {\n    font-size: 12px;\n    padding: 6px 8px;\n  }\n  .task-view .quick-head {\n    flex-wrap: wrap;\n  }\n  .task-view .quick-head input {\n    flex: 1;\n    width: 65%;\n  }\n  .browse-scopes .audio-filter {\n    margin-left: 0;\n  }\n  .task-view .selection-toolbar > .close-selected {\n    margin-left: 0;\n  }\n}\n\n.task-view .quick-head input {\n  flex: 1 1 180px;\n  width: auto;\n  min-width: 120px;\n}\n.task-view .browse-scopes,\n.task-view .overlay-utilities,\n.task-view .switcher-hint,\n.task-view .search-scope {\n  flex: none;\n}\n.task-view .search-results {\n  min-height: 100px;\n}\n@media (max-height: 560px) {\n  .task-view {\n    gap: 10px;\n    padding: 16px 20px 12px;\n    max-height: calc(100dvh - 24px);\n  }\n  .task-view .switcher-hint {\n    display: none;\n  }\n  .task-view .quick-head input {\n    min-height: 40px;\n  }\n}\n\n.task-view input[type='search']::-webkit-search-cancel-button {\n  -webkit-appearance: none;\n}\n.task-view .clear-search {\n  font-size: 12px;\n  color: var(--muted);\n  padding: 5px 8px;\n}\n\n/* One search, compact page recovery, and a distinct whole-session action. */\n#sidebar > * {\n  flex-shrink: 0;\n}\n#sidebar #tabs .empty {\n  padding: 18px 8px;\n  min-height: 0;\n}\n#sidebar #recent {\n  margin: 18px 2px 0;\n  padding-top: 14px;\n}\n.recent-heading {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 6px;\n  margin-bottom: 12px;\n}\n#recent .recent-heading h2 {\n  margin: 0;\n  font-size: 13px;\n}\n.recent-mode {\n  font-size: 11px;\n  padding: 5px 7px;\n  gap: 4px;\n  color: var(--accent);\n}\n.recent-mode svg {\n  width: 14px;\n  height: 14px;\n}\n.recent-section-label {\n  font-size: 11px;\n  color: var(--muted);\n  font-weight: 600;\n  margin: 10px 5px 5px;\n}\n.history-divider {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  margin-top: 16px;\n}\n.history-divider::after {\n  content: '';\n  height: 1px;\n  background: var(--line);\n  flex: 1;\n}\n.recent-page {\n  display: flex;\n  width: 100%;\n  align-items: center;\n  text-align: left;\n  gap: 8px;\n  padding: 7px 5px;\n  min-width: 0;\n}\n.recent-page-copy {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  min-width: 0;\n  flex: 1;\n}\n.recent-page-copy .row-title {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 12px;\n}\n.recent-page-copy small {\n  font-size: 10px;\n  color: var(--muted);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.recent-page-verb {\n  font-size: 10px;\n  color: var(--muted);\n  flex-shrink: 0;\n}\n.recent-page:hover .recent-page-verb,\n.recent-page:focus-visible .recent-page-verb {\n  color: var(--accent);\n}\n.recent-more {\n  color: var(--accent);\n  font-size: 11px;\n  margin: 3px 0;\n}\n.enable-history {\n  font-size: 12px;\n  background: var(--hover);\n  width: 100%;\n  margin-top: 6px;\n}\n#recent > .hint {\n  padding: 3px 5px;\n  font-size: 11px;\n}\n#recent .history-heading {\n  margin-top: 6px;\n  justify-content: space-between;\n}\n#recent .history-heading h3 {\n  font-size: 11px;\n  color: var(--muted);\n  font-weight: 500;\n}\n#recent .history-restore {\n  background: var(--accent-fill);\n  color: var(--on-accent);\n  border: 1px solid transparent;\n  font-size: 13px;\n  font-weight: 650;\n  min-height: 38px;\n  margin: 8px 0 12px;\n  width: 100%;\n}\n#recent .history-restore:hover {\n  filter: brightness(1.08);\n}\n#recent .history-tabs {\n  border-top: 1px solid var(--line);\n  padding-top: 6px;\n}\n#sidebar mark,\n#board mark {\n  background: color-mix(in srgb, var(--accent) 28%, transparent);\n  color: var(--text);\n  border-radius: 2px;\n}\n#breadcrumbs {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n#breadcrumbs button {\n  color: var(--accent);\n}\n\n#board .collection-head mark {\n  color: inherit;\n  background: #fff5;\n}\n.link-open:has(.search-match-url) {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  min-width: 0;\n}\n.search-match-url {\n  display: block;\n  max-width: 100%;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  color: var(--muted);\n  font-size: 10px;\n  font-weight: 400;\n}\n\n#sidebar .section-heading {\n  flex-wrap: wrap;\n}\n#sidebar #tab-tools {\n  margin-left: auto;\n}\n#sidebar #recent {\n  display: block;\n}\n\n/* Flat overlay: one search row, one navigation row, individual tab frames. */\n.task-view {\n  background: light-dark(#f4f5f7, #202226);\n  border-radius: 8px;\n  box-shadow: none;\n  backdrop-filter: none;\n  border: 1px solid var(--line);\n  padding: 20px 24px;\n  gap: 16px;\n}\n.task-view.search-only {\n  width: min(1240px, 100%);\n}\n.task-view .quick-head input {\n  border-radius: 5px;\n  min-height: 42px;\n}\n.task-view .browse-scopes {\n  gap: 4px;\n}\n.task-view .browse-scopes .audio-filter {\n  margin-left: 0;\n}\n.task-view .browse-scopes button {\n  border-radius: 4px;\n}\n.overlay-navigation {\n  margin-left: auto;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n.task-view .overlay-more {\n  padding: 7px;\n  flex: none;\n}\n.task-view .quick-grid {\n  max-height: min(62dvh, 650px);\n  gap: 16px;\n}\n.task-view .switcher-card {\n  border-radius: 5px;\n  background: light-dark(#e5e7eb, #30343a);\n  padding: 5px;\n  box-shadow: none;\n}\n.task-view .preview-tile {\n  background: transparent;\n  border: 0;\n  border-radius: 2px;\n  padding: 0;\n  box-shadow: none;\n  color: var(--text);\n}\n.task-view .preview-tile:hover {\n  background: transparent;\n}\n.task-view .switcher-card:has(.preview-tile:hover) {\n  outline: 1px solid var(--muted);\n  outline-offset: 1px;\n}\n.task-view .preview-tile:focus-visible {\n  outline: 2px solid var(--accent);\n  outline-offset: 5px;\n}\n.task-view .tile-topline {\n  height: 36px;\n  padding: 4px 64px 6px 5px;\n}\n.task-view .preview-info {\n  padding: 7px 5px 3px;\n}\n.task-view .preview-image {\n  border-radius: 1px;\n}\n.task-view .preview-info small {\n  color: var(--text);\n  opacity: 0.8;\n}\n.task-view .tile-actions {\n  right: 7px;\n  top: 7px;\n}\n.task-view .tile-actions button {\n  background: transparent;\n  border-radius: 3px;\n  color: var(--text);\n}\n.task-view .native-group-card {\n  background: var(--group-frame);\n}\n.task-view [data-group-color='blue'] {\n  --group-frame: light-dark(#c8dcfc, #354e72);\n}\n.task-view [data-group-color='red'] {\n  --group-frame: light-dark(#f5cccc, #693b40);\n}\n.task-view [data-group-color='yellow'] {\n  --group-frame: light-dark(#f3e5b3, #61532e);\n}\n.task-view [data-group-color='green'] {\n  --group-frame: light-dark(#c6e6cf, #345944);\n}\n.task-view [data-group-color='pink'] {\n  --group-frame: light-dark(#f0d0e4, #633e58);\n}\n.task-view [data-group-color='purple'] {\n  --group-frame: light-dark(#dfd2f5, #50416b);\n}\n.task-view [data-group-color='cyan'] {\n  --group-frame: light-dark(#c1e5e9, #305861);\n}\n.task-view [data-group-color='orange'] {\n  --group-frame: light-dark(#f2d5b8, #674a30);\n}\n.task-view [data-group-color='grey'] {\n  --group-frame: light-dark(#d9dce1, #454950);\n}\n.task-view .tab-list .switcher-card {\n  max-width: none;\n}\n.task-view .tab-list .tile-topline {\n  padding-right: 0;\n}\n.task-view .preview-missing .favicon {\n  width: 30px;\n  height: 30px;\n}\n.preview-missing .favicon:has(img) {\n  background: transparent;\n  color: transparent;\n}\n.preview-missing .favicon img {\n  width: 100%;\n  height: 100%;\n  object-fit: contain;\n  background: transparent;\n  border-radius: 0;\n}\n@media (max-width: 700px) {\n  .task-view {\n    padding: 14px;\n  }\n  .task-view .quick-head {\n    flex-wrap: wrap;\n    gap: 6px;\n  }\n  .task-view .quick-head input {\n    flex: 1 1 calc(100% - 50px);\n  }\n  .task-view .view-choices {\n    margin-left: auto;\n  }\n  .task-view .browse-scopes button {\n    padding: 6px 8px;\n  }\n  .overlay-navigation {\n    margin-left: auto;\n  }\n}\n\n/* Native groups remain folder-like containers with whole-group selection. */\n.task-view .group-tile {\n  box-shadow: none;\n  margin-top: 0;\n}\n.task-view .group-preview {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  grid-template-rows: repeat(2, minmax(0, 1fr));\n  gap: 6px;\n  padding: 6px;\n  background: transparent;\n}\n.task-view .group-preview > .preview-image {\n  width: 100%;\n  height: 100%;\n  min-height: 0;\n  aspect-ratio: auto;\n  border-radius: 3px;\n}\n.task-view .group-preview .preview-missing {\n  padding: 5px;\n  font-size: 10px;\n  gap: 4px;\n  overflow: hidden;\n}\n.task-view .group-preview .preview-missing small {\n  display: none;\n}\n.task-view .group-preview .preview-missing .favicon {\n  width: 22px;\n  height: 22px;\n}\n.task-view.selecting .tile-topline {\n  padding-right: 8px;\n}\n.task-view .selection-mark {\n  margin-left: auto;\n  flex: 0 0 18px;\n}\n.task-view .quick-head > button {\n  flex-shrink: 0;\n}\n\n/* Timeline uses the same page rows and website icons as Recent & history. */\n#recent .history-tabs {\n  border: 0;\n  padding: 0;\n  margin-top: 8px;\n  max-height: 280px;\n}\n#recent .history-name {\n  margin: 0 5px 6px;\n}\n#recent .history-navigation {\n  margin: 0 0 12px;\n}\n#recent .history-group {\n  padding: 8px 5px 3px;\n  font-size: 11px;\n}\n#recent .history-restore {\n  margin: 12px 0 0;\n}\n.session-page > .favicon {\n  flex-shrink: 0;\n}\n\n.collection-meta {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n  margin: 8px 14px 2px;\n  min-height: 20px;\n  color: var(--muted);\n  font-size: 11px;\n}\n.collection-pinned {\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n  color: var(--accent);\n}\n.collection-pinned svg {\n  width: 12px;\n  height: 12px;\n}\n.collection-meta .collection-update-prompt {\n  margin-left: auto;\n  color: var(--accent);\n  font-size: 11px;\n  padding: 3px 5px;\n}\n.collection-update-list {\n  max-height: 320px;\n  overflow: auto;\n  margin-top: 16px;\n}\n.collection-update-row {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 9px 4px;\n}\n.collection-update-row > span:last-child {\n  min-width: 0;\n}\n.collection-update-row strong {\n  display: block;\n  font-size: 13px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.collection-update-row small {\n  display: block;\n  color: var(--muted);\n  font-size: 11px;\n}\n\n/* Separate folder navigation, name editing and whole-group selection. */\n.task-view .group-name-slot {\n  position: absolute;\n  top: 10px;\n  left: 36px;\n  right: 42px;\n  height: 28px;\n}\n.task-view .group-name-slot .group-name {\n  display: block;\n  width: 100%;\n  padding: 3px 4px;\n  min-height: 28px;\n  text-align: left;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  background: transparent;\n  color: var(--text);\n  border: 0;\n}\n.task-view .group-name:hover {\n  background: color-mix(in srgb, var(--text) 10%, transparent);\n}\n.task-view .group-name-slot input {\n  width: 100%;\n  height: 28px;\n  padding: 3px 4px;\n  font: inherit;\n}\n.task-view .group-select {\n  position: absolute;\n  right: 8px;\n  top: 10px;\n  padding: 4px;\n  min-width: 28px;\n  min-height: 28px;\n  background: transparent;\n  border: 0;\n}\n.task-view .group-select .selection-mark {\n  display: block;\n}\n.task-view .tab-list .group-name-slot {\n  top: 50%;\n  transform: translateY(-50%);\n  right: 115px;\n}\n.task-view .tab-list .group-select {\n  top: 50%;\n  transform: translateY(-50%);\n}\n.task-view .tab-list .group-tile .preview-info {\n  margin-right: 30px;\n}\n.collection-color {\n  width: 12px;\n  height: 12px;\n  flex: 0 0 12px;\n  border-radius: 50%;\n  background: var(--collection-color);\n}\n\n/* Bounded native groups distinguish their members from ungrouped tabs. */\n.open-tab-group {\n  margin: 8px 0;\n  border-left: 3px solid var(--native-color);\n  border-radius: 6px;\n  background: color-mix(in srgb, var(--native-color) 13%, var(--side));\n  padding: 3px 4px 4px;\n  min-width: 0;\n}\n.open-group-header.group-label {\n  margin: 0;\n  min-height: 34px;\n  gap: 3px;\n  color: var(--text);\n}\n.open-group-header .editable-name,\n.open-group-header .inline-name {\n  flex: 1;\n  text-align: left;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 12px;\n}\n.open-group-fold {\n  flex: 0 0 25px;\n  width: 25px;\n  padding: 4px;\n}\n.open-group-count {\n  color: var(--muted);\n  padding: 0 5px;\n}\n.open-group-tabs {\n  padding-left: 3px;\n}\n.open-tab-group.dragging {\n  outline: 2px solid var(--native-color);\n  opacity: 0.6;\n}\n.native-group-drag-image {\n  position: fixed;\n  left: -10000px;\n  top: 0;\n  width: 290px;\n  padding: 12px;\n  box-shadow: 0 8px 24px #0004;\n  background: color-mix(in srgb, var(--native-color) 24%, var(--panel));\n}\n.native-group-drag-image strong {\n  display: block;\n  margin-bottom: 8px;\n  font-size: 13px;\n}\n.native-drag-row {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 5px 0;\n  font-size: 12px;\n}\n.native-drag-row span:last-child {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* Collection lists share one readable, full-width row rhythm. */\n.collection-picker {\n  display: grid;\n  gap: 12px;\n  min-width: 0;\n}\n.collection-choices {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  gap: 8px;\n  align-content: start;\n  padding: 4px;\n  scroll-padding-block: 8px;\n}\n.collection-picker .collection-choices,\n.switch-choices.collection-choices {\n  max-height: min(340px, 42dvh);\n  overflow-y: auto;\n}\n.collection-choice,\n.switch-choices > .collection-choice,\n.task-view .collection-choice {\n  display: flex;\n  flex-wrap: nowrap;\n  align-items: center;\n  gap: 12px;\n  width: 100%;\n  min-width: 0;\n  min-height: 56px;\n  padding: 10px 12px;\n  text-align: left;\n  font-size: 14px;\n  line-height: 1.4;\n  border: 0;\n  border-radius: 7px;\n  background: color-mix(in srgb, var(--collection-color) 14%, var(--panel));\n}\n.collection-copy {\n  display: block;\n  flex: 1;\n  min-width: 0;\n}\n.collection-name {\n  display: block;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.collection-detail {\n  display: block;\n  margin-top: 3px;\n  font-size: 12px;\n  color: var(--muted);\n}\n.collection-choice > .icon {\n  flex: 0 0 16px;\n  color: var(--muted);\n}\n.collection-choice:hover,\n.collection-choice:focus-visible,\n.collection-choice[aria-selected='true'] {\n  background: color-mix(in srgb, var(--collection-color) 28%, var(--panel));\n}\n.collection-choice:focus-visible {\n  outline: 2px solid var(--accent);\n  outline-offset: 1px;\n}\n.search-result.collection-choice {\n  margin-block: 4px;\n}\n.collection-choices .search-result.collection-choice {\n  margin-block: 0;\n}\n\n.collection-versions {\n  display: grid;\n  gap: 10px;\n  max-height: 60dvh;\n  overflow: auto;\n  padding: 4px;\n}\n.collection-version summary small {\n  display: block;\n  color: var(--muted);\n  margin-top: 4px;\n}\n.collection-version .session-page {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 9px 12px;\n}\n.collection-version .row-title small {\n  display: block;\n  color: var(--muted);\n}\n";

  // extension/ui/overlay-entry.js
  var context = globalThis.__neoOverlayContext;
  if (context) {
    const previous = document.activeElement;
    const host = document.createElement("div");
    host.setAttribute("popover", "manual");
    host.setAttribute("aria-label", "Neo tab switcher");
    for (const [key, value] of Object.entries({
      all: "initial",
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      "max-width": "none",
      "max-height": "none",
      margin: "0",
      padding: "0",
      border: "0",
      overflow: "hidden",
      background: "transparent",
      font: '14px/1.5 "Segoe UI", Tahoma, sans-serif',
      "z-index": "2147483647"
    }))
      host.style.setProperty(key, value, "important");
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = styles_default.replaceAll(":root", ":host");
    root.append(style);
    globalThis.__neoSurface = root;
    let dispose, closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      dispose?.();
      host.remove();
      globalThis.__neoSurface = null;
      globalThis.__neoCloseOverlay = null;
      globalThis.__neoOverlayContext = null;
      if (previous?.isConnected) previous.focus();
    };
    globalThis.__neoCloseOverlay = close;
    document.documentElement.append(host);
    host.showPopover();
    startQuick().then((cleanup) => {
      dispose = cleanup;
      if (closed) dispose();
    }).catch((error) => {
      const text2 = document.createElement("p");
      text2.textContent = error.message;
      const button2 = document.createElement("button");
      button2.textContent = "Close switcher";
      button2.onclick = close;
      root.append(text2, button2);
      button2.focus();
    });
  }
})();
