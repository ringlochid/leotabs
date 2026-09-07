(() => {
  // extension/lib/colors.js
  var COLORS = {
    mint: "#a4d9bc",
    blue: "#aac0ec",
    lavender: "#c6b4e6",
    peach: "#efc1a7",
    rose: "#e2acbe",
    teal: "#9fced0",
    yellow: "#eadb99",
    grey: "#b9c0be"
  };
  function validColor(value) {
    return Object.hasOwn(COLORS, value || "") || /^#[0-9a-f]{6}$/i.test(value || "");
  }
  function colorHex(value) {
    return COLORS[value] || (/^#[0-9a-f]{6}$/i.test(value || "") ? value : COLORS.blue);
  }

  // extension/lib/tab-policy.js
  function manageableURL(url = "") {
    return /^(?:https?|file|chrome|edge|chrome-extension|extension):/i.test(url) || /^about:(?:blank|newtab)/i.test(url);
  }
  function duplicateKey(tab) {
    const url = tab.resourceUrl || tab.pendingUrl || tab.url || "";
    if (!manageableURL(url)) return null;
    if (/^(?:chrome|edge):\/\/(?:newtab|new-tab-page)\/?$/i.test(url) || /^about:newtab$/i.test(url)) return "browser-new-tab";
    return url;
  }

  // extension/lib/organisation.js
  var POLICY_CHOICES = {
    group: ["keep", "rules", "ai", "rules-ai"],
    collectionName: ["keep", "template", "ai"],
    groupName: ["keep", "template", "ai"],
    tabOrder: ["manual", "title", "domain", "recent", "rule", "ai"],
    groupOrder: ["manual", "title", "rule", "ai"],
    collectionOrder: ["manual", "title", "recent", "rule", "ai"]
  };
  var DEFAULT_POLICY = {
    group: "rules",
    collectionName: "keep",
    groupName: "keep",
    tabOrder: "manual",
    groupOrder: "manual",
    collectionOrder: "manual",
    automatic: true,
    collectionTemplate: "{domain} \xB7 {date}",
    groupTemplate: "{domain}",
    orderInstruction: "Arrange in a useful reading sequence: overview, explanation, examples, reference."
  };
  var short = (value, max = 500) => String(value ?? "").slice(0, max).trim();
  function sanitizePolicy(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid organisation policy.");
    const result = {};
    for (const [key, choices] of Object.entries(POLICY_CHOICES)) {
      if (input[key] === void 0) continue;
      if (!choices.includes(input[key])) throw Error("Invalid organisation choice: " + key);
      result[key] = input[key];
    }
    if (input.automatic !== void 0) {
      if (typeof input.automatic !== "boolean") throw Error("Choose whether organisation runs automatically.");
      result.automatic = input.automatic;
    }
    for (const key of ["collectionTemplate", "groupTemplate", "orderInstruction"])
      if (input[key] !== void 0) result[key] = short(input[key], 1500);
    return result;
  }
  function policyFor(state, collection, spaceId = collection?.spaceId) {
    const settings = state.settings || {};
    const result = {
      ...DEFAULT_POLICY,
      group: settings.autoGroup === false ? "keep" : "rules",
      collectionName: settings.aiNaming ? "ai" : "keep",
      groupName: settings.aiNaming ? "ai" : "keep",
      ...sanitizePolicy(settings.organisation || {}),
      ...sanitizePolicy(state.spaces?.find((s) => s.id === spaceId)?.organisation || {}),
      ...sanitizePolicy(collection?.organisation || {})
    };
    if (settings.autoGroup === false) result.group = "keep";
    return result;
  }
  function sanitizeRules(rules) {
    if (!Array.isArray(rules) || rules.length > 50) throw Error("Use at most 50 rules.");
    for (const rule of rules) if (rule?.regex) {
      const pattern = short(rule.domain, 200);
      if (/\\[1-9]|\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) throw Error("Use a simple URL expression without nested repetition or backreferences.");
      try {
        new RegExp(pattern);
      } catch {
        throw Error("Invalid URL regular expression.");
      }
    }
    return rules.map((rule, index) => ({
      id: short(rule?.id, 100) || crypto.randomUUID(),
      domain: short(rule?.domain, 200).replace(/^https?:\/\//i, "").toLowerCase(),
      title: short(rule?.title, 200),
      group: short(rule?.group, 100),
      priority: Number.isFinite(Number(rule?.priority)) ? Math.max(-1e3, Math.min(1e3, Number(rule.priority))) : 0,
      enabled: rule?.enabled !== false,
      exclude: !!rule?.exclude,
      regex: !!rule?.regex,
      color: validColor(rule?.color) ? rule.color : "random"
    })).filter((r) => (r.domain || r.title) && (r.group || r.exclude));
  }
  function glob(value, pattern) {
    const escaped = pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp("^" + escaped + "$", "i").test(value);
  }
  function findRule(link, rules = []) {
    let u;
    try {
      u = new URL(link.resourceUrl || link.url);
    } catch {
      return null;
    }
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return [...rules].filter((r) => r.enabled !== false).sort((a, b) => (b.priority || 0) - (a.priority || 0)).find((r) => {
      const pattern = (r.domain || "").replace(/^https?:\/\//i, "");
      let regexMatch = false;
      if (r.regex) {
        try {
          regexMatch = new RegExp(pattern, "i").test(u.href.slice(0, 4e3));
        } catch {
          return false;
        }
      }
      const matchesURL = r.regex ? regexMatch : !pattern || (pattern.includes("/") || pattern.includes("*") ? glob(u.hostname + (pattern.includes("/") ? u.pathname + u.search : ""), pattern) : u.hostname === pattern || u.hostname.endsWith("." + pattern));
      return matchesURL && (!r.title || glob(link.title || "", r.title.includes("*") ? r.title : "*" + r.title + "*"));
    }) || null;
  }

  // extension/lib/arrange.js
  var DEFAULT_RULES = [{ id: "github", domain: "github.com/*", group: "GitHub", color: "random" }];

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
        tabSort: "position",
        view: "board",
        previewCapture: false,
        previewLimitMB: 50,
        currentWindowOnly: true,
        closeAfterStash: true,
        autoUpdateDefault: false,
        provider: "gemini",
        model: "gemini-2.5-flash",
        aiEndpoint: "",
        notionParent: "",
        rules: structuredClone(DEFAULT_RULES),
        autoGroup: true,
        regroupExisting: true,
        aiNaming: false,
        organisation: {},
        websiteGrouping: true
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
      return { id: text(s.id, 100), name: text(s.name).trim() || "New space", ...s.organisation ? { organisation: sanitizePolicy(s.organisation) } : {} };
    });
  }
  function newCollection(name = "Untitled", color = "blue") {
    const now = stamp();
    return {
      id: uid(),
      spaceId: "main",
      pinned: false,
      autoUpdate: false,
      name: text(name).trim() || "Untitled",
      color: validColor(color) ? color : "blue",
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
      if (raw.organisation) c.organisation = sanitizePolicy(raw.organisation);
      if (raw.manualName) c.manualName = true;
      if (raw.manualOrder) c.manualOrder = true;
      if (raw.manualPlacement) c.manualPlacement = true;
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
          collapsed: !!g.collapsed,
          ...g.manualName ? { manualName: true } : {}
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
          createdAt: Number(l.createdAt) || stamp(),
          ...l.manualGroup ? { manualGroup: true } : {}
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
      const url = duplicateKey(t);
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
  var PROTOCOL = 20;

  // extension/ui/raster.js
  async function rasterCanvas(data) {
    const match = /^data:(image\/(?:png|webp|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(data || "");
    if (!match) throw Error("Unsupported image");
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: match[1] }));
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.setAttribute("aria-hidden", "true");
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      return canvas;
    } finally {
      bitmap.close();
    }
  }

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
  var iconImages = /* @__PURE__ */ new Map();
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
      const draw = (source) => {
        const image = el("canvas", {
          width: source.width,
          height: source.height,
          "aria-hidden": "true"
        });
        image.getContext("2d").drawImage(source, 0, 0);
        mark.replaceChildren(image);
        mark.classList.add("has-icon");
      };
      const ready = iconImages.get(pageURL)?.canvas;
      if (ready) draw(ready);
      else {
        const load = async (attempt = 0) => {
          let entry = iconImages.get(pageURL);
          if (!entry) {
            entry = {};
            entry.promise = rpc("favicon", { url: pageURL }).then(async (data) => {
              if (!data) return null;
              entry.canvas = await rasterCanvas(data);
              return entry.canvas;
            }).catch(() => null);
            iconImages.set(pageURL, entry);
            if (iconImages.size > 512) iconImages.delete(iconImages.keys().next().value);
          }
          const image = entry.canvas || await entry.promise;
          if (image) draw(image);
          else {
            if (iconImages.get(pageURL) === entry) iconImages.delete(pageURL);
            if (attempt < 3)
              setTimeout(
                () => {
                  if (mark.isConnected) load(attempt + 1);
                },
                1500 * (attempt + 1)
              );
          }
        };
        load();
      }
    }
    return mark;
  }
  function toast(message, { undo, error = false, duration = undo ? 8e3 : 5e3 } = {}) {
    let node = $("#toast");
    if (!node) {
      node = el("div", { id: "toast", role: "status" });
      (globalThis.__neoSurface || document.body).append(node);
    }
    node.className = error ? "error" : "";
    node.replaceChildren(
      ...[
        el("span", {}, message),
        undo ? button("Undo", task(async () => {
          node.hidden = true;
          await undo();
        })) : null,
        button("Dismiss", () => node.hidden = true, { glyph: "close", quiet: true })
      ].filter(Boolean)
    );
    node.hidden = false;
    clearTimeout(node._timer);
    let remaining = duration, started = Date.now(), paused = false;
    const resume = () => {
      clearTimeout(node._timer);
      if (error || !duration || node.matches(":hover") || node.contains(surface().activeElement)) return;
      paused = false;
      started = Date.now();
      node._timer = setTimeout(() => {
        if (node.matches(":hover") || node.contains(surface().activeElement)) {
          pause();
          return;
        }
        node.hidden = true;
      }, remaining);
    };
    const pause = () => {
      if (paused) return;
      paused = true;
      clearTimeout(node._timer);
      remaining = Math.max(0, remaining - (Date.now() - started));
    };
    node._toastEvents?.abort();
    node._toastEvents = new AbortController();
    const options = { signal: node._toastEvents.signal };
    node.addEventListener("mouseenter", pause, options);
    node.addEventListener("mouseleave", resume, options);
    node.addEventListener("focusin", pause, options);
    node.addEventListener("focusout", () => queueMicrotask(resume), options);
    resume();
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
      colorHex(collection.color)
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
            currentSession ? "Close current collection" : "Switch to collection",
            task(() => currentSession ? actions.closeCollection(c) : actions.swap(c)),
            {
              glyph: currentSession ? "close" : "arrow",
              title: currentSession ? "Save and close this collection\u2019s tabs. Pinned tabs stay open." : "Make this collection current in this window; choose whether to save the current tabs"
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
    if (input.organisation !== void 0) next.organisation = sanitizePolicy(input.organisation);
    else {
      if (input.autoGroup !== void 0 && Object.keys(next.organisation || {}).length)
        next.organisation = { ...next.organisation, group: input.autoGroup ? "rules" : "keep" };
      if (input.aiNaming !== void 0 && Object.keys(next.organisation || {}).length)
        next.organisation = { ...next.organisation, collectionName: input.aiNaming ? "ai" : "keep", groupName: input.aiNaming ? "ai" : "keep" };
    }
    delete next.obsidianVault;
    delete next.captureWebStore;
    for (const [key, values] of Object.entries({
      theme: ["system", "light", "dark"],
      tabSort: ["recent", "position", "reverse", "title", "domain"],
      view: ["board", "list"],
      provider: ["openai", "claude", "gemini", "deepseek", "compatible"]
    }))
      if (values.includes(input[key])) next[key] = input[key];
    for (const key of ["previewCapture", "currentWindowOnly", "closeAfterStash", "autoGroup", "aiNaming", "autoUpdateDefault", "websiteGrouping", "regroupExisting"])
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
      next.rules = sanitizeRules(input.rules);
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

  // extension/lib/public-suffixes.js
  var suffixes = "ac\ncom.ac\nedu.ac\ngov.ac\nmil.ac\nnet.ac\norg.ac\nad\nae\nac.ae\nco.ae\ngov.ae\nmil.ae\nnet.ae\norg.ae\nsch.ae\naero\nairline.aero\nairport.aero\naccident-investigation.aero\naccident-prevention.aero\naerobatic.aero\naeroclub.aero\naerodrome.aero\nagents.aero\nair-surveillance.aero\nair-traffic-control.aero\naircraft.aero\nairtraffic.aero\nambulance.aero\nassociation.aero\nauthor.aero\nballooning.aero\nbroker.aero\ncaa.aero\ncargo.aero\ncatering.aero\ncertification.aero\nchampionship.aero\ncharter.aero\ncivilaviation.aero\nclub.aero\nconference.aero\nconsultant.aero\nconsulting.aero\ncontrol.aero\ncouncil.aero\ncrew.aero\ndesign.aero\ndgca.aero\neducator.aero\nemergency.aero\nengine.aero\nengineer.aero\nentertainment.aero\nequipment.aero\nexchange.aero\nexpress.aero\nfederation.aero\nflight.aero\nfreight.aero\nfuel.aero\ngliding.aero\ngovernment.aero\ngroundhandling.aero\ngroup.aero\nhanggliding.aero\nhomebuilt.aero\ninsurance.aero\njournal.aero\njournalist.aero\nleasing.aero\nlogistics.aero\nmagazine.aero\nmaintenance.aero\nmarketplace.aero\nmedia.aero\nmicrolight.aero\nmodelling.aero\nnavigation.aero\nparachuting.aero\nparagliding.aero\npassenger-association.aero\npilot.aero\npress.aero\nproduction.aero\nrecreation.aero\nrepbody.aero\nres.aero\nresearch.aero\nrotorcraft.aero\nsafety.aero\nscientist.aero\nservices.aero\nshow.aero\nskydiving.aero\nsoftware.aero\nstudent.aero\ntaxi.aero\ntrader.aero\ntrading.aero\ntrainer.aero\nunion.aero\nworkinggroup.aero\nworks.aero\naf\ncom.af\nedu.af\ngov.af\nnet.af\norg.af\nag\nco.ag\ncom.ag\nnet.ag\nnom.ag\norg.ag\nai\ncom.ai\nnet.ai\noff.ai\norg.ai\nal\ncom.al\nedu.al\ngov.al\nmil.al\nnet.al\norg.al\nam\nco.am\ncom.am\ncommune.am\nnet.am\norg.am\nao\nco.ao\ned.ao\nedu.ao\ngov.ao\ngv.ao\nit.ao\nog.ao\norg.ao\npb.ao\naq\nar\nbet.ar\ncom.ar\ncoop.ar\nedu.ar\ngob.ar\ngov.ar\nint.ar\nmil.ar\nmusica.ar\nmutual.ar\nnet.ar\norg.ar\nseg.ar\nsenasa.ar\ntur.ar\narpa\ne164.arpa\nhome.arpa\nin-addr.arpa\nip6.arpa\niris.arpa\nuri.arpa\nurn.arpa\nas\ngov.as\nasia\nat\nac.at\nsth.ac.at\nco.at\ngv.at\nor.at\nau\nasn.au\ncom.au\nedu.au\ngov.au\nid.au\nnet.au\norg.au\nconf.au\noz.au\nact.au\nnsw.au\nnt.au\nqld.au\nsa.au\ntas.au\nvic.au\nwa.au\nact.edu.au\ncatholic.edu.au\nnsw.edu.au\nnt.edu.au\nqld.edu.au\nsa.edu.au\ntas.edu.au\nvic.edu.au\nwa.edu.au\nqld.gov.au\nsa.gov.au\ntas.gov.au\nvic.gov.au\nwa.gov.au\naw\ncom.aw\nax\naz\nbiz.az\nco.az\ncom.az\nedu.az\ngov.az\ninfo.az\nint.az\nmil.az\nname.az\nnet.az\norg.az\npp.az\npro.az\nba\ncom.ba\nedu.ba\ngov.ba\nmil.ba\nnet.ba\norg.ba\nbb\nbiz.bb\nco.bb\ncom.bb\nedu.bb\ngov.bb\ninfo.bb\nnet.bb\norg.bb\nstore.bb\ntv.bb\nbd\nac.bd\nai.bd\nco.bd\ncom.bd\nedu.bd\ngov.bd\nid.bd\ninfo.bd\nit.bd\nmil.bd\nnet.bd\norg.bd\nsch.bd\ntv.bd\nbe\nac.be\nbf\ngov.bf\nbg\n0.bg\n1.bg\n2.bg\n3.bg\n4.bg\n5.bg\n6.bg\n7.bg\n8.bg\n9.bg\na.bg\nb.bg\nc.bg\nd.bg\ne.bg\nf.bg\ng.bg\nh.bg\ni.bg\nj.bg\nk.bg\nl.bg\nm.bg\nn.bg\no.bg\np.bg\nq.bg\nr.bg\ns.bg\nt.bg\nu.bg\nv.bg\nw.bg\nx.bg\ny.bg\nz.bg\nbh\ncom.bh\nedu.bh\ngov.bh\nnet.bh\norg.bh\nbi\nco.bi\ncom.bi\nedu.bi\nor.bi\norg.bi\nbiz\nbj\nafrica.bj\nagro.bj\narchitectes.bj\nassur.bj\navocats.bj\nco.bj\ncom.bj\neco.bj\necono.bj\nedu.bj\ninfo.bj\nloisirs.bj\nmoney.bj\nnet.bj\norg.bj\note.bj\nrestaurant.bj\nresto.bj\ntourism.bj\nuniv.bj\nbm\ncom.bm\nedu.bm\ngov.bm\nnet.bm\norg.bm\nbn\ncom.bn\nedu.bn\ngov.bn\nnet.bn\norg.bn\nbo\ncom.bo\nedu.bo\ngob.bo\nint.bo\nmil.bo\nnet.bo\norg.bo\ntv.bo\nweb.bo\nacademia.bo\nagro.bo\narte.bo\nblog.bo\nbolivia.bo\nciencia.bo\ncooperativa.bo\ndemocracia.bo\ndeporte.bo\necologia.bo\neconomia.bo\nempresa.bo\nia.bo\nindigena.bo\nindustria.bo\ninfo.bo\nmedicina.bo\nmovimiento.bo\nmusica.bo\nnatural.bo\nnombre.bo\nnoticias.bo\npatria.bo\nplurinacional.bo\npolitica.bo\nprofesional.bo\npueblo.bo\nrevista.bo\nsalud.bo\ntecnologia.bo\ntksat.bo\ntransporte.bo\nwiki.bo\nbr\n9guacu.br\nabc.br\nadm.br\nadv.br\nagr.br\naju.br\nam.br\nanani.br\naparecida.br\napi.br\napp.br\narq.br\nart.br\nato.br\nb.br\nbarueri.br\nbelem.br\nbet.br\nbhz.br\nbib.br\nbio.br\nblog.br\nbmd.br\nboavista.br\nbsb.br\ncampinagrande.br\ncampinas.br\ncaxias.br\ncim.br\ncng.br\ncnt.br\ncom.br\ncontagem.br\ncoop.br\ncoz.br\ncri.br\ncuiaba.br\ncuritiba.br\ndef.br\ndes.br\ndet.br\ndev.br\necn.br\neco.br\nedu.br\nemp.br\nenf.br\neng.br\nesp.br\netc.br\neti.br\nfar.br\nfeira.br\nflog.br\nfloripa.br\nfm.br\nfnd.br\nfortal.br\nfot.br\nfoz.br\nfst.br\ng12.br\ngeo.br\nggf.br\ngoiania.br\ngov.br\nac.gov.br\nal.gov.br\nam.gov.br\nap.gov.br\nba.gov.br\nce.gov.br\ndf.gov.br\nes.gov.br\ngo.gov.br\nma.gov.br\nmg.gov.br\nms.gov.br\nmt.gov.br\npa.gov.br\npb.gov.br\npe.gov.br\npi.gov.br\npr.gov.br\nrj.gov.br\nrn.gov.br\nro.gov.br\nrr.gov.br\nrs.gov.br\nsc.gov.br\nse.gov.br\nsp.gov.br\nto.gov.br\ngru.br\nia.br\nimb.br\nind.br\ninf.br\njab.br\njampa.br\njdf.br\njoinville.br\njor.br\njus.br\nleg.br\nleilao.br\nlel.br\nlog.br\nlondrina.br\nmacapa.br\nmaceio.br\nmanaus.br\nmaringa.br\nmat.br\nmed.br\nmil.br\nmorena.br\nmp.br\nmus.br\nnatal.br\nnet.br\nniteroi.br\n*.nom.br\nnot.br\nntr.br\nodo.br\nong.br\norg.br\nosasco.br\npalmas.br\npoa.br\nppg.br\npro.br\npsc.br\npsi.br\npvh.br\nqsl.br\nradio.br\nrec.br\nrecife.br\nrep.br\nribeirao.br\nrio.br\nriobranco.br\nriopreto.br\nsalvador.br\nsampa.br\nsantamaria.br\nsantoandre.br\nsaobernardo.br\nsaogonca.br\nseg.br\nsjc.br\nslg.br\nslz.br\nsocial.br\nsorocaba.br\nsrv.br\ntaxi.br\ntc.br\ntec.br\nteo.br\nthe.br\ntmp.br\ntrd.br\ntur.br\ntv.br\nudi.br\nvet.br\nvix.br\nvlog.br\nwiki.br\nxyz.br\nzlg.br\nbs\ncom.bs\nedu.bs\ngov.bs\nnet.bs\norg.bs\nbt\ncom.bt\nedu.bt\ngov.bt\nnet.bt\norg.bt\nbv\nbw\nac.bw\nco.bw\ngov.bw\nnet.bw\norg.bw\nby\ngov.by\nmil.by\ncom.by\nof.by\nbz\nco.bz\ncom.bz\nedu.bz\ngov.bz\nnet.bz\norg.bz\nca\nab.ca\nbc.ca\nmb.ca\nnb.ca\nnf.ca\nnl.ca\nns.ca\nnt.ca\nnu.ca\non.ca\npe.ca\nqc.ca\nsk.ca\nyk.ca\ngc.ca\ncat\ncc\ncd\ngov.cd\ncf\ncg\nch\nci\nac.ci\nxn--aroport-bya.ci\nasso.ci\nco.ci\ncom.ci\ned.ci\nedu.ci\ngo.ci\ngouv.ci\nint.ci\nnet.ci\nor.ci\norg.ci\n*.ck\n!www.ck\ncl\nco.cl\ngob.cl\ngov.cl\nmil.cl\ncm\nco.cm\ncom.cm\ngov.cm\nnet.cm\ncn\nac.cn\ncom.cn\nedu.cn\ngov.cn\nmil.cn\nnet.cn\norg.cn\nxn--55qx5d.cn\nxn--od0alg.cn\nxn--io0a7i.cn\nah.cn\nbj.cn\ncq.cn\nfj.cn\ngd.cn\ngs.cn\ngx.cn\ngz.cn\nha.cn\nhb.cn\nhe.cn\nhi.cn\nhk.cn\nhl.cn\nhn.cn\njl.cn\njs.cn\njx.cn\nln.cn\nmo.cn\nnm.cn\nnx.cn\nqh.cn\nsc.cn\nsd.cn\nsh.cn\nsn.cn\nsx.cn\ntj.cn\ntw.cn\nxj.cn\nxz.cn\nyn.cn\nzj.cn\nco\ncom.co\nedu.co\ngov.co\nmil.co\nnet.co\nnom.co\norg.co\ncom\ncoop\ncr\nac.cr\nco.cr\ned.cr\nfi.cr\ngo.cr\nor.cr\nsa.cr\ncu\ncom.cu\nedu.cu\ngob.cu\ninf.cu\nnat.cu\nnet.cu\norg.cu\ncv\ncom.cv\nedu.cv\nid.cv\nint.cv\nnet.cv\nnome.cv\norg.cv\npubl.cv\ncw\ncom.cw\nedu.cw\nnet.cw\norg.cw\ncx\ngov.cx\ncy\nac.cy\nbiz.cy\ncom.cy\nekloges.cy\ngov.cy\nltd.cy\nmil.cy\nnet.cy\norg.cy\npress.cy\npro.cy\ntm.cy\ncz\ngov.cz\nde\ndj\ndk\ndm\nco.dm\ncom.dm\nedu.dm\ngov.dm\nnet.dm\norg.dm\ndo\nart.do\ncom.do\nedu.do\ngob.do\ngov.do\nmil.do\nnet.do\norg.do\nsld.do\nweb.do\ndz\nart.dz\nasso.dz\ncom.dz\nedu.dz\ngov.dz\nnet.dz\norg.dz\npol.dz\nsoc.dz\ntm.dz\nec\nabg.ec\nadm.ec\nagron.ec\narqt.ec\nart.ec\nbar.ec\nchef.ec\ncom.ec\ncont.ec\ncpa.ec\ncue.ec\ndent.ec\ndgn.ec\ndisco.ec\ndoc.ec\nedu.ec\neng.ec\nesm.ec\nfin.ec\nfot.ec\ngal.ec\ngob.ec\ngov.ec\ngye.ec\nibr.ec\ninfo.ec\nk12.ec\nlat.ec\nloj.ec\nmed.ec\nmil.ec\nmktg.ec\nmon.ec\nnet.ec\nntr.ec\nodont.ec\norg.ec\npro.ec\nprof.ec\npsic.ec\npsiq.ec\npub.ec\nrio.ec\nrrpp.ec\nsal.ec\ntech.ec\ntul.ec\ntur.ec\nuio.ec\nvet.ec\nxxx.ec\nedu\nee\naip.ee\ncom.ee\nedu.ee\nfie.ee\ngov.ee\nlib.ee\nmed.ee\norg.ee\npri.ee\nriik.ee\neg\nac.eg\ncom.eg\nedu.eg\neun.eg\ngov.eg\ninfo.eg\nme.eg\nmil.eg\nname.eg\nnet.eg\norg.eg\nsci.eg\nsport.eg\ntv.eg\n*.er\nes\ncom.es\nedu.es\ngob.es\nnom.es\norg.es\net\nbiz.et\ncom.et\nedu.et\ngov.et\ninfo.et\nname.et\nnet.et\norg.et\neu\nfi\naland.fi\nfj\nac.fj\nbiz.fj\ncom.fj\nedu.fj\ngov.fj\nid.fj\ninfo.fj\nmil.fj\nname.fj\nnet.fj\norg.fj\npro.fj\n*.fk\nfm\ncom.fm\nedu.fm\nnet.fm\norg.fm\nfo\nfr\nasso.fr\ncom.fr\ngouv.fr\nnom.fr\nprd.fr\ntm.fr\navoues.fr\ncci.fr\ngreta.fr\nhuissier-justice.fr\nga\ngb\ngd\nedu.gd\ngov.gd\nge\ncom.ge\ncyb.ge\nedu.ge\ngov.ge\nllc.ge\nnet.ge\nonline.ge\norg.ge\npvt.ge\nschool.ge\ntnx.ge\ngf\ngg\nco.gg\nnet.gg\norg.gg\ngh\nbiz.gh\ncom.gh\nedu.gh\ngov.gh\nmil.gh\nnet.gh\norg.gh\ngi\ncom.gi\nedu.gi\ngov.gi\nltd.gi\nmod.gi\norg.gi\ngl\nco.gl\ncom.gl\nedu.gl\nnet.gl\norg.gl\ngm\ngn\nac.gn\ncom.gn\nedu.gn\ngov.gn\nnet.gn\norg.gn\ngov\ngp\nasso.gp\ncom.gp\nedu.gp\nmobi.gp\nnet.gp\norg.gp\ngq\ngr\ncom.gr\nedu.gr\ngov.gr\nnet.gr\norg.gr\ngs\ngt\ncom.gt\nedu.gt\ngob.gt\nind.gt\nmil.gt\nnet.gt\norg.gt\ngu\ncom.gu\nedu.gu\ngov.gu\nguam.gu\ninfo.gu\nnet.gu\norg.gu\nweb.gu\ngw\ngy\nco.gy\ncom.gy\nedu.gy\ngov.gy\nnet.gy\norg.gy\nhk\ncom.hk\nedu.hk\ngov.hk\nidv.hk\nnet.hk\norg.hk\nxn--ciqpn.hk\nxn--gmqw5a.hk\nxn--55qx5d.hk\nxn--mxtq1m.hk\nxn--lcvr32d.hk\nxn--wcvs22d.hk\nxn--gmq050i.hk\nxn--uc0atv.hk\nxn--uc0ay4a.hk\nxn--od0alg.hk\nxn--zf0avx.hk\nxn--mk0axi.hk\nxn--tn0ag.hk\nxn--od0aq3b.hk\nxn--io0a7i.hk\nhm\nhn\ncom.hn\nedu.hn\ngob.hn\nmil.hn\nnet.hn\norg.hn\nhr\ncom.hr\nfrom.hr\niz.hr\nname.hr\nht\nadult.ht\nart.ht\nasso.ht\ncom.ht\ncoop.ht\nedu.ht\nfirm.ht\ngouv.ht\ninfo.ht\nmed.ht\nnet.ht\norg.ht\nperso.ht\npol.ht\npro.ht\nrel.ht\nshop.ht\nhu\n2000.hu\nagrar.hu\nbolt.hu\ncasino.hu\ncity.hu\nco.hu\nerotica.hu\nerotika.hu\nfilm.hu\nforum.hu\ngames.hu\nhotel.hu\ninfo.hu\ningatlan.hu\njogasz.hu\nkonyvelo.hu\nlakas.hu\nmedia.hu\nnews.hu\norg.hu\npriv.hu\nreklam.hu\nsex.hu\nshop.hu\nsport.hu\nsuli.hu\nszex.hu\ntm.hu\ntozsde.hu\nutazas.hu\nvideo.hu\nid\nac.id\nai.id\nbiz.id\nco.id\ndesa.id\ngo.id\nkop.id\nmil.id\nmy.id\nnet.id\nor.id\nponpes.id\nsch.id\nweb.id\nxn--9tfky.id\nie\ngov.ie\nil\nac.il\nco.il\ngov.il\nidf.il\nk12.il\nmuni.il\nnet.il\norg.il\nxn--4dbrk0ce\nxn--4dbgdty6c.xn--4dbrk0ce\nxn--5dbhl8d.xn--4dbrk0ce\nxn--8dbq2a.xn--4dbrk0ce\nxn--hebda8b.xn--4dbrk0ce\nim\nac.im\nco.im\nltd.co.im\nplc.co.im\ncom.im\nnet.im\norg.im\ntt.im\ntv.im\nin\n5g.in\n6g.in\nac.in\naero.in\nai.in\nalumni.in\nam.in\nbank.in\nbihar.in\nbiz.in\nbusiness.in\nca.in\ncn.in\nco.in\ncom.in\ncoop.in\ncs.in\ndelhi.in\ndr.in\nedu.in\ner.in\nfin.in\nfirm.in\ngen.in\ngov.in\ngujarat.in\nind.in\ninfo.in\nint.in\ninternet.in\nio.in\nme.in\nmil.in\nnet.in\nnic.in\norg.in\npg.in\npost.in\npro.in\nres.in\nschool.in\ntravel.in\ntv.in\nub.in\nuk.in\nup.in\nus.in\ninfo\nint\neu.int\nio\nco.io\ncom.io\nedu.io\ngov.io\nmil.io\nnet.io\nnom.io\norg.io\niq\ncom.iq\nedu.iq\ngov.iq\nmil.iq\nnet.iq\norg.iq\nir\nac.ir\nco.ir\ngov.ir\nid.ir\nnet.ir\norg.ir\nsch.ir\nxn--mgba3a4f16a.ir\nxn--mgba3a4fra.ir\nis\nit\nedu.it\ngov.it\nabr.it\nabruzzo.it\naosta-valley.it\naostavalley.it\nbas.it\nbasilicata.it\ncal.it\ncalabria.it\ncam.it\ncampania.it\nemilia-romagna.it\nemiliaromagna.it\nemr.it\nfriuli-v-giulia.it\nfriuli-ve-giulia.it\nfriuli-vegiulia.it\nfriuli-venezia-giulia.it\nfriuli-veneziagiulia.it\nfriuli-vgiulia.it\nfriuliv-giulia.it\nfriulive-giulia.it\nfriulivegiulia.it\nfriulivenezia-giulia.it\nfriuliveneziagiulia.it\nfriulivgiulia.it\nfvg.it\nlaz.it\nlazio.it\nlig.it\nliguria.it\nlom.it\nlombardia.it\nlombardy.it\nlucania.it\nmar.it\nmarche.it\nmol.it\nmolise.it\npiedmont.it\npiemonte.it\npmn.it\npug.it\npuglia.it\nsar.it\nsardegna.it\nsardinia.it\nsic.it\nsicilia.it\nsicily.it\ntaa.it\ntos.it\ntoscana.it\ntrentin-sud-tirol.it\nxn--trentin-sd-tirol-rzb.it\ntrentin-sudtirol.it\nxn--trentin-sdtirol-7vb.it\ntrentin-sued-tirol.it\ntrentin-suedtirol.it\ntrentino-a-adige.it\ntrentino-aadige.it\ntrentino-alto-adige.it\ntrentino-altoadige.it\ntrentino-s-tirol.it\ntrentino-stirol.it\ntrentino-sud-tirol.it\nxn--trentino-sd-tirol-c3b.it\ntrentino-sudtirol.it\nxn--trentino-sdtirol-szb.it\ntrentino-sued-tirol.it\ntrentino-suedtirol.it\ntrentinoa-adige.it\ntrentinoaadige.it\ntrentinoalto-adige.it\ntrentinoaltoadige.it\ntrentinos-tirol.it\ntrentinostirol.it\ntrentinosud-tirol.it\nxn--trentinosd-tirol-rzb.it\nxn--trentinosdtirol-7vb.it\ntrentinosued-tirol.it\ntrentinosuedtirol.it\ntrentinsud-tirol.it\nxn--trentinsd-tirol-6vb.it\ntrentinsudtirol.it\nxn--trentinsdtirol-nsb.it\ntrentinsued-tirol.it\ntrentinsuedtirol.it\ntuscany.it\numb.it\numbria.it\nval-d-aosta.it\nval-daosta.it\nvald-aosta.it\nvalle-aosta.it\nvalle-d-aosta.it\nvalle-daosta.it\nvalleaosta.it\nvalled-aosta.it\nvalledaosta.it\nvallee-aoste.it\nxn--valle-aoste-ebb.it\nvallee-d-aoste.it\nxn--valle-d-aoste-ehb.it\nvalleeaoste.it\nxn--valleaoste-e7a.it\nvalleedaoste.it\nxn--valledaoste-ebb.it\nvao.it\nvda.it\nven.it\nveneto.it\nag.it\nagrigento.it\nal.it\nalessandria.it\nalto-adige.it\naltoadige.it\nan.it\nancona.it\nandria-barletta-trani.it\nandria-trani-barletta.it\nandriabarlettatrani.it\nandriatranibarletta.it\nao.it\naosta.it\naoste.it\nap.it\naq.it\nar.it\narezzo.it\nascoli-piceno.it\nascolipiceno.it\nasti.it\nat.it\nav.it\navellino.it\nba.it\nbalsan.it\nbalsan-sudtirol.it\nxn--balsan-sdtirol-nsb.it\nbalsan-suedtirol.it\nbari.it\nbarletta-trani-andria.it\nbarlettatraniandria.it\nbelluno.it\nbenevento.it\nbergamo.it\nbg.it\nbi.it\nbiella.it\nbl.it\nbn.it\nbo.it\nbologna.it\nbolzano.it\nbolzano-altoadige.it\nbozen.it\nbozen-sudtirol.it\nxn--bozen-sdtirol-2ob.it\nbozen-suedtirol.it\nbr.it\nbrescia.it\nbrindisi.it\nbs.it\nbt.it\nbulsan.it\nbulsan-sudtirol.it\nxn--bulsan-sdtirol-nsb.it\nbulsan-suedtirol.it\nbz.it\nca.it\ncagliari.it\ncaltanissetta.it\ncampidano-medio.it\ncampidanomedio.it\ncampobasso.it\ncarbonia-iglesias.it\ncarboniaiglesias.it\ncarrara-massa.it\ncarraramassa.it\ncaserta.it\ncatania.it\ncatanzaro.it\ncb.it\nce.it\ncesena-forli.it\nxn--cesena-forl-mcb.it\ncesenaforli.it\nxn--cesenaforl-i8a.it\nch.it\nchieti.it\nci.it\ncl.it\ncn.it\nco.it\ncomo.it\ncosenza.it\ncr.it\ncremona.it\ncrotone.it\ncs.it\nct.it\ncuneo.it\ncz.it\ndell-ogliastra.it\ndellogliastra.it\nen.it\nenna.it\nfc.it\nfe.it\nfermo.it\nferrara.it\nfg.it\nfi.it\nfirenze.it\nflorence.it\nfm.it\nfoggia.it\nforli-cesena.it\nxn--forl-cesena-fcb.it\nforlicesena.it\nxn--forlcesena-c8a.it\nfr.it\nfrosinone.it\nge.it\ngenoa.it\ngenova.it\ngo.it\ngorizia.it\ngr.it\ngrosseto.it\niglesias-carbonia.it\niglesiascarbonia.it\nim.it\nimperia.it\nis.it\nisernia.it\nkr.it\nla-spezia.it\nlaquila.it\nlaspezia.it\nlatina.it\nlc.it\nle.it\nlecce.it\nlecco.it\nli.it\nlivorno.it\nlo.it\nlodi.it\nlt.it\nlu.it\nlucca.it\nmacerata.it\nmantova.it\nmassa-carrara.it\nmassacarrara.it\nmatera.it\nmb.it\nmc.it\nme.it\nmedio-campidano.it\nmediocampidano.it\nmessina.it\nmi.it\nmilan.it\nmilano.it\nmn.it\nmo.it\nmodena.it\nmonza.it\nmonza-brianza.it\nmonza-e-della-brianza.it\nmonzabrianza.it\nmonzaebrianza.it\nmonzaedellabrianza.it\nms.it\nmt.it\nna.it\nnaples.it\nnapoli.it\nno.it\nnovara.it\nnu.it\nnuoro.it\nog.it\nogliastra.it\nolbia-tempio.it\nolbiatempio.it\nor.it\noristano.it\not.it\npa.it\npadova.it\npadua.it\npalermo.it\nparma.it\npavia.it\npc.it\npd.it\npe.it\nperugia.it\npesaro-urbino.it\npesarourbino.it\npescara.it\npg.it\npi.it\npiacenza.it\npisa.it\npistoia.it\npn.it\npo.it\npordenone.it\npotenza.it\npr.it\nprato.it\npt.it\npu.it\npv.it\npz.it\nra.it\nragusa.it\nravenna.it\nrc.it\nre.it\nreggio-calabria.it\nreggio-emilia.it\nreggiocalabria.it\nreggioemilia.it\nrg.it\nri.it\nrieti.it\nrimini.it\nrm.it\nrn.it\nro.it\nroma.it\nrome.it\nrovigo.it\nsa.it\nsalerno.it\nsassari.it\nsavona.it\nsi.it\nsiena.it\nsiracusa.it\nso.it\nsondrio.it\nsp.it\nsr.it\nss.it\nsu.it\nsud-sardegna.it\nsudsardegna.it\nxn--sdtirol-n2a.it\nsuedtirol.it\nsv.it\nta.it\ntaranto.it\nte.it\ntempio-olbia.it\ntempioolbia.it\nteramo.it\nterni.it\ntn.it\nto.it\ntorino.it\ntp.it\ntr.it\ntrani-andria-barletta.it\ntrani-barletta-andria.it\ntraniandriabarletta.it\ntranibarlettaandria.it\ntrapani.it\ntrentino.it\ntrento.it\ntreviso.it\ntrieste.it\nts.it\nturin.it\ntv.it\nud.it\nudine.it\nurbino-pesaro.it\nurbinopesaro.it\nva.it\nvarese.it\nvb.it\nvc.it\nve.it\nvenezia.it\nvenice.it\nverbania.it\nverbano-cusio-ossola.it\nvercelli.it\nverona.it\nvi.it\nvibo-valentia.it\nvibovalentia.it\nvicenza.it\nviterbo.it\nvr.it\nvs.it\nvt.it\nvv.it\nje\nco.je\nnet.je\norg.je\n*.jm\njo\nagri.jo\nai.jo\ncom.jo\nedu.jo\neng.jo\nfm.jo\ngov.jo\nmil.jo\nnet.jo\norg.jo\nper.jo\nphd.jo\nsch.jo\ntv.jo\njobs\njp\nac.jp\nad.jp\nco.jp\ned.jp\ngo.jp\ngr.jp\nlg.jp\nne.jp\nor.jp\naichi.jp\nakita.jp\naomori.jp\nchiba.jp\nehime.jp\nfukui.jp\nfukuoka.jp\nfukushima.jp\ngifu.jp\ngunma.jp\nhiroshima.jp\nhokkaido.jp\nhyogo.jp\nibaraki.jp\nishikawa.jp\niwate.jp\nkagawa.jp\nkagoshima.jp\nkanagawa.jp\nkochi.jp\nkumamoto.jp\nkyoto.jp\nmie.jp\nmiyagi.jp\nmiyazaki.jp\nnagano.jp\nnagasaki.jp\nnara.jp\nniigata.jp\noita.jp\nokayama.jp\nokinawa.jp\nosaka.jp\nsaga.jp\nsaitama.jp\nshiga.jp\nshimane.jp\nshizuoka.jp\ntochigi.jp\ntokushima.jp\ntokyo.jp\ntottori.jp\ntoyama.jp\nwakayama.jp\nyamagata.jp\nyamaguchi.jp\nyamanashi.jp\nxn--ehqz56n.jp\nxn--1lqs03n.jp\nxn--qqqt11m.jp\nxn--f6qx53a.jp\nxn--djrs72d6uy.jp\nxn--mkru45i.jp\nxn--0trq7p7nn.jp\nxn--5js045d.jp\nxn--kbrq7o.jp\nxn--pssu33l.jp\nxn--ntsq17g.jp\nxn--uisz3g.jp\nxn--6btw5a.jp\nxn--1ctwo.jp\nxn--6orx2r.jp\nxn--rht61e.jp\nxn--rht27z.jp\nxn--nit225k.jp\nxn--rht3d.jp\nxn--djty4k.jp\nxn--klty5x.jp\nxn--kltx9a.jp\nxn--kltp7d.jp\nxn--c3s14m.jp\nxn--vgu402c.jp\nxn--efvn9s.jp\nxn--1lqs71d.jp\nxn--4pvxs.jp\nxn--uuwu58a.jp\nxn--zbx025d.jp\nxn--8pvr4u.jp\nxn--5rtp49c.jp\nxn--ntso0iqx3a.jp\nxn--elqq16h.jp\nxn--4it168d.jp\nxn--klt787d.jp\nxn--rny31h.jp\nxn--7t0a264c.jp\nxn--uist22h.jp\nxn--8ltr62k.jp\nxn--2m4a15e.jp\nxn--32vp30h.jp\nxn--4it797k.jp\nxn--5rtq34k.jp\nxn--k7yn95e.jp\nxn--tor131o.jp\nxn--d5qv7z876c.jp\n*.kawasaki.jp\n!city.kawasaki.jp\n*.kitakyushu.jp\n!city.kitakyushu.jp\n*.kobe.jp\n!city.kobe.jp\n*.nagoya.jp\n!city.nagoya.jp\n*.sapporo.jp\n!city.sapporo.jp\n*.sendai.jp\n!city.sendai.jp\n*.yokohama.jp\n!city.yokohama.jp\naisai.aichi.jp\nama.aichi.jp\nanjo.aichi.jp\nasuke.aichi.jp\nchiryu.aichi.jp\nchita.aichi.jp\nfuso.aichi.jp\ngamagori.aichi.jp\nhanda.aichi.jp\nhazu.aichi.jp\nhekinan.aichi.jp\nhigashiura.aichi.jp\nichinomiya.aichi.jp\ninazawa.aichi.jp\ninuyama.aichi.jp\nisshiki.aichi.jp\niwakura.aichi.jp\nkanie.aichi.jp\nkariya.aichi.jp\nkasugai.aichi.jp\nkira.aichi.jp\nkiyosu.aichi.jp\nkomaki.aichi.jp\nkonan.aichi.jp\nkota.aichi.jp\nmihama.aichi.jp\nmiyoshi.aichi.jp\nnishio.aichi.jp\nnisshin.aichi.jp\nobu.aichi.jp\noguchi.aichi.jp\noharu.aichi.jp\nokazaki.aichi.jp\nowariasahi.aichi.jp\nseto.aichi.jp\nshikatsu.aichi.jp\nshinshiro.aichi.jp\nshitara.aichi.jp\ntahara.aichi.jp\ntakahama.aichi.jp\ntobishima.aichi.jp\ntoei.aichi.jp\ntogo.aichi.jp\ntokai.aichi.jp\ntokoname.aichi.jp\ntoyoake.aichi.jp\ntoyohashi.aichi.jp\ntoyokawa.aichi.jp\ntoyone.aichi.jp\ntoyota.aichi.jp\ntsushima.aichi.jp\nyatomi.aichi.jp\nakita.akita.jp\ndaisen.akita.jp\nfujisato.akita.jp\ngojome.akita.jp\nhachirogata.akita.jp\nhappou.akita.jp\nhigashinaruse.akita.jp\nhonjo.akita.jp\nhonjyo.akita.jp\nikawa.akita.jp\nkamikoani.akita.jp\nkamioka.akita.jp\nkatagami.akita.jp\nkazuno.akita.jp\nkitaakita.akita.jp\nkosaka.akita.jp\nkyowa.akita.jp\nmisato.akita.jp\nmitane.akita.jp\nmoriyoshi.akita.jp\nnikaho.akita.jp\nnoshiro.akita.jp\nodate.akita.jp\noga.akita.jp\nogata.akita.jp\nsemboku.akita.jp\nyokote.akita.jp\nyurihonjo.akita.jp\naomori.aomori.jp\ngonohe.aomori.jp\nhachinohe.aomori.jp\nhashikami.aomori.jp\nhiranai.aomori.jp\nhirosaki.aomori.jp\nitayanagi.aomori.jp\nkuroishi.aomori.jp\nmisawa.aomori.jp\nmutsu.aomori.jp\nnakadomari.aomori.jp\nnoheji.aomori.jp\noirase.aomori.jp\nowani.aomori.jp\nrokunohe.aomori.jp\nsannohe.aomori.jp\nshichinohe.aomori.jp\nshingo.aomori.jp\ntakko.aomori.jp\ntowada.aomori.jp\ntsugaru.aomori.jp\ntsuruta.aomori.jp\nabiko.chiba.jp\nasahi.chiba.jp\nchonan.chiba.jp\nchosei.chiba.jp\nchoshi.chiba.jp\nchuo.chiba.jp\nfunabashi.chiba.jp\nfuttsu.chiba.jp\nhanamigawa.chiba.jp\nichihara.chiba.jp\nichikawa.chiba.jp\nichinomiya.chiba.jp\ninzai.chiba.jp\nisumi.chiba.jp\nkamagaya.chiba.jp\nkamogawa.chiba.jp\nkashiwa.chiba.jp\nkatori.chiba.jp\nkatsuura.chiba.jp\nkimitsu.chiba.jp\nkisarazu.chiba.jp\nkozaki.chiba.jp\nkujukuri.chiba.jp\nkyonan.chiba.jp\nmatsudo.chiba.jp\nmidori.chiba.jp\nmihama.chiba.jp\nminamiboso.chiba.jp\nmobara.chiba.jp\nmutsuzawa.chiba.jp\nnagara.chiba.jp\nnagareyama.chiba.jp\nnarashino.chiba.jp\nnarita.chiba.jp\nnoda.chiba.jp\noamishirasato.chiba.jp\nomigawa.chiba.jp\nonjuku.chiba.jp\notaki.chiba.jp\nsakae.chiba.jp\nsakura.chiba.jp\nshimofusa.chiba.jp\nshirako.chiba.jp\nshiroi.chiba.jp\nshisui.chiba.jp\nsodegaura.chiba.jp\nsosa.chiba.jp\ntako.chiba.jp\ntateyama.chiba.jp\ntogane.chiba.jp\ntohnosho.chiba.jp\ntomisato.chiba.jp\nurayasu.chiba.jp\nyachimata.chiba.jp\nyachiyo.chiba.jp\nyokaichiba.chiba.jp\nyokoshibahikari.chiba.jp\nyotsukaido.chiba.jp\nainan.ehime.jp\nhonai.ehime.jp\nikata.ehime.jp\nimabari.ehime.jp\niyo.ehime.jp\nkamijima.ehime.jp\nkihoku.ehime.jp\nkumakogen.ehime.jp\nmasaki.ehime.jp\nmatsuno.ehime.jp\nmatsuyama.ehime.jp\nnamikata.ehime.jp\nniihama.ehime.jp\nozu.ehime.jp\nsaijo.ehime.jp\nseiyo.ehime.jp\nshikokuchuo.ehime.jp\ntobe.ehime.jp\ntoon.ehime.jp\nuchiko.ehime.jp\nuwajima.ehime.jp\nyawatahama.ehime.jp\nechizen.fukui.jp\neiheiji.fukui.jp\nfukui.fukui.jp\nikeda.fukui.jp\nkatsuyama.fukui.jp\nmihama.fukui.jp\nminamiechizen.fukui.jp\nobama.fukui.jp\nohi.fukui.jp\nono.fukui.jp\nsabae.fukui.jp\nsakai.fukui.jp\ntakahama.fukui.jp\ntsuruga.fukui.jp\nwakasa.fukui.jp\nashiya.fukuoka.jp\nbuzen.fukuoka.jp\nchikugo.fukuoka.jp\nchikuho.fukuoka.jp\nchikujo.fukuoka.jp\nchikushino.fukuoka.jp\nchikuzen.fukuoka.jp\nchuo.fukuoka.jp\ndazaifu.fukuoka.jp\nfukuchi.fukuoka.jp\nhakata.fukuoka.jp\nhigashi.fukuoka.jp\nhirokawa.fukuoka.jp\nhisayama.fukuoka.jp\niizuka.fukuoka.jp\ninatsuki.fukuoka.jp\nkaho.fukuoka.jp\nkasuga.fukuoka.jp\nkasuya.fukuoka.jp\nkawara.fukuoka.jp\nkeisen.fukuoka.jp\nkoga.fukuoka.jp\nkurate.fukuoka.jp\nkurogi.fukuoka.jp\nkurume.fukuoka.jp\nminami.fukuoka.jp\nmiyako.fukuoka.jp\nmiyama.fukuoka.jp\nmiyawaka.fukuoka.jp\nmizumaki.fukuoka.jp\nmunakata.fukuoka.jp\nnakagawa.fukuoka.jp\nnakama.fukuoka.jp\nnishi.fukuoka.jp\nnogata.fukuoka.jp\nogori.fukuoka.jp\nokagaki.fukuoka.jp\nokawa.fukuoka.jp\noki.fukuoka.jp\nomuta.fukuoka.jp\nonga.fukuoka.jp\nonojo.fukuoka.jp\noto.fukuoka.jp\nsaigawa.fukuoka.jp\nsasaguri.fukuoka.jp\nshingu.fukuoka.jp\nshinyoshitomi.fukuoka.jp\nshonai.fukuoka.jp\nsoeda.fukuoka.jp\nsue.fukuoka.jp\ntachiarai.fukuoka.jp\ntagawa.fukuoka.jp\ntakata.fukuoka.jp\ntoho.fukuoka.jp\ntoyotsu.fukuoka.jp\ntsuiki.fukuoka.jp\nukiha.fukuoka.jp\numi.fukuoka.jp\nusui.fukuoka.jp\nyamada.fukuoka.jp\nyame.fukuoka.jp\nyanagawa.fukuoka.jp\nyukuhashi.fukuoka.jp\naizubange.fukushima.jp\naizumisato.fukushima.jp\naizuwakamatsu.fukushima.jp\nasakawa.fukushima.jp\nbandai.fukushima.jp\ndate.fukushima.jp\nfukushima.fukushima.jp\nfurudono.fukushima.jp\nfutaba.fukushima.jp\nhanawa.fukushima.jp\nhigashi.fukushima.jp\nhirata.fukushima.jp\nhirono.fukushima.jp\niitate.fukushima.jp\ninawashiro.fukushima.jp\nishikawa.fukushima.jp\niwaki.fukushima.jp\nizumizaki.fukushima.jp\nkagamiishi.fukushima.jp\nkaneyama.fukushima.jp\nkawamata.fukushima.jp\nkitakata.fukushima.jp\nkitashiobara.fukushima.jp\nkoori.fukushima.jp\nkoriyama.fukushima.jp\nkunimi.fukushima.jp\nmiharu.fukushima.jp\nmishima.fukushima.jp\nnamie.fukushima.jp\nnango.fukushima.jp\nnishiaizu.fukushima.jp\nnishigo.fukushima.jp\nokuma.fukushima.jp\nomotego.fukushima.jp\nono.fukushima.jp\notama.fukushima.jp\nsamegawa.fukushima.jp\nshimogo.fukushima.jp\nshirakawa.fukushima.jp\nshowa.fukushima.jp\nsoma.fukushima.jp\nsukagawa.fukushima.jp\ntaishin.fukushima.jp\ntamakawa.fukushima.jp\ntanagura.fukushima.jp\ntenei.fukushima.jp\nyabuki.fukushima.jp\nyamato.fukushima.jp\nyamatsuri.fukushima.jp\nyanaizu.fukushima.jp\nyugawa.fukushima.jp\nanpachi.gifu.jp\nena.gifu.jp\ngifu.gifu.jp\nginan.gifu.jp\ngodo.gifu.jp\ngujo.gifu.jp\nhashima.gifu.jp\nhichiso.gifu.jp\nhida.gifu.jp\nhigashishirakawa.gifu.jp\nibigawa.gifu.jp\nikeda.gifu.jp\nkakamigahara.gifu.jp\nkani.gifu.jp\nkasahara.gifu.jp\nkasamatsu.gifu.jp\nkawaue.gifu.jp\nkitagata.gifu.jp\nmino.gifu.jp\nminokamo.gifu.jp\nmitake.gifu.jp\nmizunami.gifu.jp\nmotosu.gifu.jp\nnakatsugawa.gifu.jp\nogaki.gifu.jp\nsakahogi.gifu.jp\nseki.gifu.jp\nsekigahara.gifu.jp\nshirakawa.gifu.jp\ntajimi.gifu.jp\ntakayama.gifu.jp\ntarui.gifu.jp\ntoki.gifu.jp\ntomika.gifu.jp\nwanouchi.gifu.jp\nyamagata.gifu.jp\nyaotsu.gifu.jp\nyoro.gifu.jp\nannaka.gunma.jp\nchiyoda.gunma.jp\nfujioka.gunma.jp\nhigashiagatsuma.gunma.jp\nisesaki.gunma.jp\nitakura.gunma.jp\nkanna.gunma.jp\nkanra.gunma.jp\nkatashina.gunma.jp\nkawaba.gunma.jp\nkiryu.gunma.jp\nkusatsu.gunma.jp\nmaebashi.gunma.jp\nmeiwa.gunma.jp\nmidori.gunma.jp\nminakami.gunma.jp\nnaganohara.gunma.jp\nnakanojo.gunma.jp\nnanmoku.gunma.jp\nnumata.gunma.jp\noizumi.gunma.jp\nora.gunma.jp\nota.gunma.jp\nshibukawa.gunma.jp\nshimonita.gunma.jp\nshinto.gunma.jp\nshowa.gunma.jp\ntakasaki.gunma.jp\ntakayama.gunma.jp\ntamamura.gunma.jp\ntatebayashi.gunma.jp\ntomioka.gunma.jp\ntsukiyono.gunma.jp\ntsumagoi.gunma.jp\nueno.gunma.jp\nyoshioka.gunma.jp\nasaminami.hiroshima.jp\ndaiwa.hiroshima.jp\netajima.hiroshima.jp\nfuchu.hiroshima.jp\nfukuyama.hiroshima.jp\nhatsukaichi.hiroshima.jp\nhigashihiroshima.hiroshima.jp\nhongo.hiroshima.jp\njinsekikogen.hiroshima.jp\nkaita.hiroshima.jp\nkui.hiroshima.jp\nkumano.hiroshima.jp\nkure.hiroshima.jp\nmihara.hiroshima.jp\nmiyoshi.hiroshima.jp\nnaka.hiroshima.jp\nonomichi.hiroshima.jp\nosakikamijima.hiroshima.jp\notake.hiroshima.jp\nsaka.hiroshima.jp\nsera.hiroshima.jp\nseranishi.hiroshima.jp\nshinichi.hiroshima.jp\nshobara.hiroshima.jp\ntakehara.hiroshima.jp\nabashiri.hokkaido.jp\nabira.hokkaido.jp\naibetsu.hokkaido.jp\nakabira.hokkaido.jp\nakkeshi.hokkaido.jp\nasahikawa.hokkaido.jp\nashibetsu.hokkaido.jp\nashoro.hokkaido.jp\nassabu.hokkaido.jp\natsuma.hokkaido.jp\nbibai.hokkaido.jp\nbiei.hokkaido.jp\nbifuka.hokkaido.jp\nbihoro.hokkaido.jp\nbiratori.hokkaido.jp\nchippubetsu.hokkaido.jp\nchitose.hokkaido.jp\ndate.hokkaido.jp\nebetsu.hokkaido.jp\nembetsu.hokkaido.jp\neniwa.hokkaido.jp\nerimo.hokkaido.jp\nesan.hokkaido.jp\nesashi.hokkaido.jp\nfukagawa.hokkaido.jp\nfukushima.hokkaido.jp\nfurano.hokkaido.jp\nfurubira.hokkaido.jp\nhaboro.hokkaido.jp\nhakodate.hokkaido.jp\nhamatonbetsu.hokkaido.jp\nhidaka.hokkaido.jp\nhigashikagura.hokkaido.jp\nhigashikawa.hokkaido.jp\nhiroo.hokkaido.jp\nhokuryu.hokkaido.jp\nhokuto.hokkaido.jp\nhonbetsu.hokkaido.jp\nhorokanai.hokkaido.jp\nhoronobe.hokkaido.jp\nikeda.hokkaido.jp\nimakane.hokkaido.jp\nishikari.hokkaido.jp\niwamizawa.hokkaido.jp\niwanai.hokkaido.jp\nkamifurano.hokkaido.jp\nkamikawa.hokkaido.jp\nkamishihoro.hokkaido.jp\nkamisunagawa.hokkaido.jp\nkamoenai.hokkaido.jp\nkayabe.hokkaido.jp\nkembuchi.hokkaido.jp\nkikonai.hokkaido.jp\nkimobetsu.hokkaido.jp\nkitahiroshima.hokkaido.jp\nkitami.hokkaido.jp\nkiyosato.hokkaido.jp\nkoshimizu.hokkaido.jp\nkunneppu.hokkaido.jp\nkuriyama.hokkaido.jp\nkuromatsunai.hokkaido.jp\nkushiro.hokkaido.jp\nkutchan.hokkaido.jp\nkyowa.hokkaido.jp\nmashike.hokkaido.jp\nmatsumae.hokkaido.jp\nmikasa.hokkaido.jp\nminamifurano.hokkaido.jp\nmombetsu.hokkaido.jp\nmoseushi.hokkaido.jp\nmukawa.hokkaido.jp\nmuroran.hokkaido.jp\nnaie.hokkaido.jp\nnakagawa.hokkaido.jp\nnakasatsunai.hokkaido.jp\nnakatombetsu.hokkaido.jp\nnanae.hokkaido.jp\nnanporo.hokkaido.jp\nnayoro.hokkaido.jp\nnemuro.hokkaido.jp\nniikappu.hokkaido.jp\nniki.hokkaido.jp\nnishiokoppe.hokkaido.jp\nnoboribetsu.hokkaido.jp\nnumata.hokkaido.jp\nobihiro.hokkaido.jp\nobira.hokkaido.jp\noketo.hokkaido.jp\nokoppe.hokkaido.jp\notaru.hokkaido.jp\notobe.hokkaido.jp\notofuke.hokkaido.jp\notoineppu.hokkaido.jp\noumu.hokkaido.jp\nozora.hokkaido.jp\npippu.hokkaido.jp\nrankoshi.hokkaido.jp\nrebun.hokkaido.jp\nrikubetsu.hokkaido.jp\nrishiri.hokkaido.jp\nrishirifuji.hokkaido.jp\nsaroma.hokkaido.jp\nsarufutsu.hokkaido.jp\nshakotan.hokkaido.jp\nshari.hokkaido.jp\nshibecha.hokkaido.jp\nshibetsu.hokkaido.jp\nshikabe.hokkaido.jp\nshikaoi.hokkaido.jp\nshimamaki.hokkaido.jp\nshimizu.hokkaido.jp\nshimokawa.hokkaido.jp\nshinshinotsu.hokkaido.jp\nshintoku.hokkaido.jp\nshiranuka.hokkaido.jp\nshiraoi.hokkaido.jp\nshiriuchi.hokkaido.jp\nsobetsu.hokkaido.jp\nsunagawa.hokkaido.jp\ntaiki.hokkaido.jp\ntakasu.hokkaido.jp\ntakikawa.hokkaido.jp\ntakinoue.hokkaido.jp\nteshikaga.hokkaido.jp\ntobetsu.hokkaido.jp\ntohma.hokkaido.jp\ntomakomai.hokkaido.jp\ntomari.hokkaido.jp\ntoya.hokkaido.jp\ntoyako.hokkaido.jp\ntoyotomi.hokkaido.jp\ntoyoura.hokkaido.jp\ntsubetsu.hokkaido.jp\ntsukigata.hokkaido.jp\nurakawa.hokkaido.jp\nurausu.hokkaido.jp\nuryu.hokkaido.jp\nutashinai.hokkaido.jp\nwakkanai.hokkaido.jp\nwassamu.hokkaido.jp\nyakumo.hokkaido.jp\nyoichi.hokkaido.jp\naioi.hyogo.jp\nakashi.hyogo.jp\nako.hyogo.jp\namagasaki.hyogo.jp\naogaki.hyogo.jp\nasago.hyogo.jp\nashiya.hyogo.jp\nawaji.hyogo.jp\nfukusaki.hyogo.jp\ngoshiki.hyogo.jp\nharima.hyogo.jp\nhimeji.hyogo.jp\nichikawa.hyogo.jp\ninagawa.hyogo.jp\nitami.hyogo.jp\nkakogawa.hyogo.jp\nkamigori.hyogo.jp\nkamikawa.hyogo.jp\nkasai.hyogo.jp\nkasuga.hyogo.jp\nkawanishi.hyogo.jp\nmiki.hyogo.jp\nminamiawaji.hyogo.jp\nnishinomiya.hyogo.jp\nnishiwaki.hyogo.jp\nono.hyogo.jp\nsanda.hyogo.jp\nsannan.hyogo.jp\nsasayama.hyogo.jp\nsayo.hyogo.jp\nshingu.hyogo.jp\nshinonsen.hyogo.jp\nshiso.hyogo.jp\nsumoto.hyogo.jp\ntaishi.hyogo.jp\ntaka.hyogo.jp\ntakarazuka.hyogo.jp\ntakasago.hyogo.jp\ntakino.hyogo.jp\ntamba.hyogo.jp\ntatsuno.hyogo.jp\ntoyooka.hyogo.jp\nyabu.hyogo.jp\nyashiro.hyogo.jp\nyoka.hyogo.jp\nyokawa.hyogo.jp\nami.ibaraki.jp\nasahi.ibaraki.jp\nbando.ibaraki.jp\nchikusei.ibaraki.jp\ndaigo.ibaraki.jp\nfujishiro.ibaraki.jp\nhitachi.ibaraki.jp\nhitachinaka.ibaraki.jp\nhitachiomiya.ibaraki.jp\nhitachiota.ibaraki.jp\nibaraki.ibaraki.jp\nina.ibaraki.jp\ninashiki.ibaraki.jp\nitako.ibaraki.jp\niwama.ibaraki.jp\njoso.ibaraki.jp\nkamisu.ibaraki.jp\nkasama.ibaraki.jp\nkashima.ibaraki.jp\nkasumigaura.ibaraki.jp\nkoga.ibaraki.jp\nmiho.ibaraki.jp\nmito.ibaraki.jp\nmoriya.ibaraki.jp\nnaka.ibaraki.jp\nnamegata.ibaraki.jp\noarai.ibaraki.jp\nogawa.ibaraki.jp\nomitama.ibaraki.jp\nryugasaki.ibaraki.jp\nsakai.ibaraki.jp\nsakuragawa.ibaraki.jp\nshimodate.ibaraki.jp\nshimotsuma.ibaraki.jp\nshirosato.ibaraki.jp\nsowa.ibaraki.jp\nsuifu.ibaraki.jp\ntakahagi.ibaraki.jp\ntamatsukuri.ibaraki.jp\ntokai.ibaraki.jp\ntomobe.ibaraki.jp\ntone.ibaraki.jp\ntoride.ibaraki.jp\ntsuchiura.ibaraki.jp\ntsukuba.ibaraki.jp\nuchihara.ibaraki.jp\nushiku.ibaraki.jp\nyachiyo.ibaraki.jp\nyamagata.ibaraki.jp\nyawara.ibaraki.jp\nyuki.ibaraki.jp\nanamizu.ishikawa.jp\nhakui.ishikawa.jp\nhakusan.ishikawa.jp\nkaga.ishikawa.jp\nkahoku.ishikawa.jp\nkanazawa.ishikawa.jp\nkawakita.ishikawa.jp\nkomatsu.ishikawa.jp\nnakanoto.ishikawa.jp\nnanao.ishikawa.jp\nnomi.ishikawa.jp\nnonoichi.ishikawa.jp\nnoto.ishikawa.jp\nshika.ishikawa.jp\nsuzu.ishikawa.jp\ntsubata.ishikawa.jp\ntsurugi.ishikawa.jp\nuchinada.ishikawa.jp\nwajima.ishikawa.jp\nfudai.iwate.jp\nfujisawa.iwate.jp\nhanamaki.iwate.jp\nhiraizumi.iwate.jp\nhirono.iwate.jp\nichinohe.iwate.jp\nichinoseki.iwate.jp\niwaizumi.iwate.jp\niwate.iwate.jp\njoboji.iwate.jp\nkamaishi.iwate.jp\nkanegasaki.iwate.jp\nkarumai.iwate.jp\nkawai.iwate.jp\nkitakami.iwate.jp\nkuji.iwate.jp\nkunohe.iwate.jp\nkuzumaki.iwate.jp\nmiyako.iwate.jp\nmizusawa.iwate.jp\nmorioka.iwate.jp\nninohe.iwate.jp\nnoda.iwate.jp\nofunato.iwate.jp\noshu.iwate.jp\notsuchi.iwate.jp\nrikuzentakata.iwate.jp\nshiwa.iwate.jp\nshizukuishi.iwate.jp\nsumita.iwate.jp\ntanohata.iwate.jp\ntono.iwate.jp\nyahaba.iwate.jp\nyamada.iwate.jp\nayagawa.kagawa.jp\nhigashikagawa.kagawa.jp\nkanonji.kagawa.jp\nkotohira.kagawa.jp\nmanno.kagawa.jp\nmarugame.kagawa.jp\nmitoyo.kagawa.jp\nnaoshima.kagawa.jp\nsanuki.kagawa.jp\ntadotsu.kagawa.jp\ntakamatsu.kagawa.jp\ntonosho.kagawa.jp\nuchinomi.kagawa.jp\nutazu.kagawa.jp\nzentsuji.kagawa.jp\nakune.kagoshima.jp\namami.kagoshima.jp\nhioki.kagoshima.jp\nisa.kagoshima.jp\nisen.kagoshima.jp\nizumi.kagoshima.jp\nkagoshima.kagoshima.jp\nkanoya.kagoshima.jp\nkawanabe.kagoshima.jp\nkinko.kagoshima.jp\nkouyama.kagoshima.jp\nmakurazaki.kagoshima.jp\nmatsumoto.kagoshima.jp\nminamitane.kagoshima.jp\nnakatane.kagoshima.jp\nnishinoomote.kagoshima.jp\nsatsumasendai.kagoshima.jp\nsoo.kagoshima.jp\ntarumizu.kagoshima.jp\nyusui.kagoshima.jp\naikawa.kanagawa.jp\natsugi.kanagawa.jp\nayase.kanagawa.jp\nchigasaki.kanagawa.jp\nebina.kanagawa.jp\nfujisawa.kanagawa.jp\nhadano.kanagawa.jp\nhakone.kanagawa.jp\nhiratsuka.kanagawa.jp\nisehara.kanagawa.jp\nkaisei.kanagawa.jp\nkamakura.kanagawa.jp\nkiyokawa.kanagawa.jp\nmatsuda.kanagawa.jp\nminamiashigara.kanagawa.jp\nmiura.kanagawa.jp\nnakai.kanagawa.jp\nninomiya.kanagawa.jp\nodawara.kanagawa.jp\noi.kanagawa.jp\noiso.kanagawa.jp\nsagamihara.kanagawa.jp\nsamukawa.kanagawa.jp\ntsukui.kanagawa.jp\nyamakita.kanagawa.jp\nyamato.kanagawa.jp\nyokosuka.kanagawa.jp\nyugawara.kanagawa.jp\nzama.kanagawa.jp\nzushi.kanagawa.jp\naki.kochi.jp\ngeisei.kochi.jp\nhidaka.kochi.jp\nhigashitsuno.kochi.jp\nino.kochi.jp\nkagami.kochi.jp\nkami.kochi.jp\nkitagawa.kochi.jp\nkochi.kochi.jp\nmihara.kochi.jp\nmotoyama.kochi.jp\nmuroto.kochi.jp\nnahari.kochi.jp\nnakamura.kochi.jp\nnankoku.kochi.jp\nnishitosa.kochi.jp\nniyodogawa.kochi.jp\nochi.kochi.jp\nokawa.kochi.jp\notoyo.kochi.jp\notsuki.kochi.jp\nsakawa.kochi.jp\nsukumo.kochi.jp\nsusaki.kochi.jp\ntosa.kochi.jp\ntosashimizu.kochi.jp\ntoyo.kochi.jp\ntsuno.kochi.jp\numaji.kochi.jp\nyasuda.kochi.jp\nyusuhara.kochi.jp\namakusa.kumamoto.jp\narao.kumamoto.jp\naso.kumamoto.jp\nchoyo.kumamoto.jp\ngyokuto.kumamoto.jp\nkamiamakusa.kumamoto.jp\nkikuchi.kumamoto.jp\nkumamoto.kumamoto.jp\nmashiki.kumamoto.jp\nmifune.kumamoto.jp\nminamata.kumamoto.jp\nminamioguni.kumamoto.jp\nnagasu.kumamoto.jp\nnishihara.kumamoto.jp\noguni.kumamoto.jp\nozu.kumamoto.jp\nsumoto.kumamoto.jp\ntakamori.kumamoto.jp\nuki.kumamoto.jp\nuto.kumamoto.jp\nyamaga.kumamoto.jp\nyamato.kumamoto.jp\nyatsushiro.kumamoto.jp\nayabe.kyoto.jp\nfukuchiyama.kyoto.jp\nhigashiyama.kyoto.jp\nide.kyoto.jp\nine.kyoto.jp\njoyo.kyoto.jp\nkameoka.kyoto.jp\nkamo.kyoto.jp\nkita.kyoto.jp\nkizu.kyoto.jp\nkumiyama.kyoto.jp\nkyotamba.kyoto.jp\nkyotanabe.kyoto.jp\nkyotango.kyoto.jp\nmaizuru.kyoto.jp\nminami.kyoto.jp\nminamiyamashiro.kyoto.jp\nmiyazu.kyoto.jp\nmuko.kyoto.jp\nnagaokakyo.kyoto.jp\nnakagyo.kyoto.jp\nnantan.kyoto.jp\noyamazaki.kyoto.jp\nsakyo.kyoto.jp\nseika.kyoto.jp\ntanabe.kyoto.jp\nuji.kyoto.jp\nujitawara.kyoto.jp\nwazuka.kyoto.jp\nyamashina.kyoto.jp\nyawata.kyoto.jp\nasahi.mie.jp\ninabe.mie.jp\nise.mie.jp\nkameyama.mie.jp\nkawagoe.mie.jp\nkiho.mie.jp\nkisosaki.mie.jp\nkiwa.mie.jp\nkomono.mie.jp\nkumano.mie.jp\nkuwana.mie.jp\nmatsusaka.mie.jp\nmeiwa.mie.jp\nmihama.mie.jp\nminamiise.mie.jp\nmisugi.mie.jp\nmiyama.mie.jp\nnabari.mie.jp\nshima.mie.jp\nsuzuka.mie.jp\ntado.mie.jp\ntaiki.mie.jp\ntaki.mie.jp\ntamaki.mie.jp\ntoba.mie.jp\ntsu.mie.jp\nudono.mie.jp\nureshino.mie.jp\nwatarai.mie.jp\nyokkaichi.mie.jp\nfurukawa.miyagi.jp\nhigashimatsushima.miyagi.jp\nishinomaki.miyagi.jp\niwanuma.miyagi.jp\nkakuda.miyagi.jp\nkami.miyagi.jp\nkawasaki.miyagi.jp\nmarumori.miyagi.jp\nmatsushima.miyagi.jp\nminamisanriku.miyagi.jp\nmisato.miyagi.jp\nmurata.miyagi.jp\nnatori.miyagi.jp\nogawara.miyagi.jp\nohira.miyagi.jp\nonagawa.miyagi.jp\nosaki.miyagi.jp\nrifu.miyagi.jp\nsemine.miyagi.jp\nshibata.miyagi.jp\nshichikashuku.miyagi.jp\nshikama.miyagi.jp\nshiogama.miyagi.jp\nshiroishi.miyagi.jp\ntagajo.miyagi.jp\ntaiwa.miyagi.jp\ntome.miyagi.jp\ntomiya.miyagi.jp\nwakuya.miyagi.jp\nwatari.miyagi.jp\nyamamoto.miyagi.jp\nzao.miyagi.jp\naya.miyazaki.jp\nebino.miyazaki.jp\ngokase.miyazaki.jp\nhyuga.miyazaki.jp\nkadogawa.miyazaki.jp\nkawaminami.miyazaki.jp\nkijo.miyazaki.jp\nkitagawa.miyazaki.jp\nkitakata.miyazaki.jp\nkitaura.miyazaki.jp\nkobayashi.miyazaki.jp\nkunitomi.miyazaki.jp\nkushima.miyazaki.jp\nmimata.miyazaki.jp\nmiyakonojo.miyazaki.jp\nmiyazaki.miyazaki.jp\nmorotsuka.miyazaki.jp\nnichinan.miyazaki.jp\nnishimera.miyazaki.jp\nnobeoka.miyazaki.jp\nsaito.miyazaki.jp\nshiiba.miyazaki.jp\nshintomi.miyazaki.jp\ntakaharu.miyazaki.jp\ntakanabe.miyazaki.jp\ntakazaki.miyazaki.jp\ntsuno.miyazaki.jp\nachi.nagano.jp\nagematsu.nagano.jp\nanan.nagano.jp\naoki.nagano.jp\nasahi.nagano.jp\nazumino.nagano.jp\nchikuhoku.nagano.jp\nchikuma.nagano.jp\nchino.nagano.jp\nfujimi.nagano.jp\nhakuba.nagano.jp\nhara.nagano.jp\nhiraya.nagano.jp\niida.nagano.jp\niijima.nagano.jp\niiyama.nagano.jp\niizuna.nagano.jp\nikeda.nagano.jp\nikusaka.nagano.jp\nina.nagano.jp\nkaruizawa.nagano.jp\nkawakami.nagano.jp\nkiso.nagano.jp\nkisofukushima.nagano.jp\nkitaaiki.nagano.jp\nkomagane.nagano.jp\nkomoro.nagano.jp\nmatsukawa.nagano.jp\nmatsumoto.nagano.jp\nmiasa.nagano.jp\nminamiaiki.nagano.jp\nminamimaki.nagano.jp\nminamiminowa.nagano.jp\nminowa.nagano.jp\nmiyada.nagano.jp\nmiyota.nagano.jp\nmochizuki.nagano.jp\nnagano.nagano.jp\nnagawa.nagano.jp\nnagiso.nagano.jp\nnakagawa.nagano.jp\nnakano.nagano.jp\nnozawaonsen.nagano.jp\nobuse.nagano.jp\nogawa.nagano.jp\nokaya.nagano.jp\nomachi.nagano.jp\nomi.nagano.jp\nookuwa.nagano.jp\nooshika.nagano.jp\notaki.nagano.jp\notari.nagano.jp\nsakae.nagano.jp\nsakaki.nagano.jp\nsaku.nagano.jp\nsakuho.nagano.jp\nshimosuwa.nagano.jp\nshinanomachi.nagano.jp\nshiojiri.nagano.jp\nsuwa.nagano.jp\nsuzaka.nagano.jp\ntakagi.nagano.jp\ntakamori.nagano.jp\ntakayama.nagano.jp\ntateshina.nagano.jp\ntatsuno.nagano.jp\ntogakushi.nagano.jp\ntogura.nagano.jp\ntomi.nagano.jp\nueda.nagano.jp\nwada.nagano.jp\nyamagata.nagano.jp\nyamanouchi.nagano.jp\nyasaka.nagano.jp\nyasuoka.nagano.jp\nchijiwa.nagasaki.jp\nfutsu.nagasaki.jp\ngoto.nagasaki.jp\nhasami.nagasaki.jp\nhirado.nagasaki.jp\niki.nagasaki.jp\nisahaya.nagasaki.jp\nkawatana.nagasaki.jp\nkuchinotsu.nagasaki.jp\nmatsuura.nagasaki.jp\nnagasaki.nagasaki.jp\nobama.nagasaki.jp\nomura.nagasaki.jp\noseto.nagasaki.jp\nsaikai.nagasaki.jp\nsasebo.nagasaki.jp\nseihi.nagasaki.jp\nshimabara.nagasaki.jp\nshinkamigoto.nagasaki.jp\ntogitsu.nagasaki.jp\ntsushima.nagasaki.jp\nunzen.nagasaki.jp\nando.nara.jp\ngose.nara.jp\nheguri.nara.jp\nhigashiyoshino.nara.jp\nikaruga.nara.jp\nikoma.nara.jp\nkamikitayama.nara.jp\nkanmaki.nara.jp\nkashiba.nara.jp\nkashihara.nara.jp\nkatsuragi.nara.jp\nkawai.nara.jp\nkawakami.nara.jp\nkawanishi.nara.jp\nkoryo.nara.jp\nkurotaki.nara.jp\nmitsue.nara.jp\nmiyake.nara.jp\nnara.nara.jp\nnosegawa.nara.jp\noji.nara.jp\nouda.nara.jp\noyodo.nara.jp\nsakurai.nara.jp\nsango.nara.jp\nshimoichi.nara.jp\nshimokitayama.nara.jp\nshinjo.nara.jp\nsoni.nara.jp\ntakatori.nara.jp\ntawaramoto.nara.jp\ntenkawa.nara.jp\ntenri.nara.jp\nuda.nara.jp\nyamatokoriyama.nara.jp\nyamatotakada.nara.jp\nyamazoe.nara.jp\nyoshino.nara.jp\naga.niigata.jp\nagano.niigata.jp\ngosen.niigata.jp\nitoigawa.niigata.jp\nizumozaki.niigata.jp\njoetsu.niigata.jp\nkamo.niigata.jp\nkariwa.niigata.jp\nkashiwazaki.niigata.jp\nminamiuonuma.niigata.jp\nmitsuke.niigata.jp\nmuika.niigata.jp\nmurakami.niigata.jp\nmyoko.niigata.jp\nnagaoka.niigata.jp\nniigata.niigata.jp\nojiya.niigata.jp\nomi.niigata.jp\nsado.niigata.jp\nsanjo.niigata.jp\nseiro.niigata.jp\nseirou.niigata.jp\nsekikawa.niigata.jp\nshibata.niigata.jp\ntagami.niigata.jp\ntainai.niigata.jp\ntochio.niigata.jp\ntokamachi.niigata.jp\ntsubame.niigata.jp\ntsunan.niigata.jp\nuonuma.niigata.jp\nyahiko.niigata.jp\nyoita.niigata.jp\nyuzawa.niigata.jp\nbeppu.oita.jp\nbungoono.oita.jp\nbungotakada.oita.jp\nhasama.oita.jp\nhiji.oita.jp\nhimeshima.oita.jp\nhita.oita.jp\nkamitsue.oita.jp\nkokonoe.oita.jp\nkuju.oita.jp\nkunisaki.oita.jp\nkusu.oita.jp\noita.oita.jp\nsaiki.oita.jp\ntaketa.oita.jp\ntsukumi.oita.jp\nusa.oita.jp\nusuki.oita.jp\nyufu.oita.jp\nakaiwa.okayama.jp\nasakuchi.okayama.jp\nbizen.okayama.jp\nhayashima.okayama.jp\nibara.okayama.jp\nkagamino.okayama.jp\nkasaoka.okayama.jp\nkibichuo.okayama.jp\nkumenan.okayama.jp\nkurashiki.okayama.jp\nmaniwa.okayama.jp\nmisaki.okayama.jp\nnagi.okayama.jp\nniimi.okayama.jp\nnishiawakura.okayama.jp\nokayama.okayama.jp\nsatosho.okayama.jp\nsetouchi.okayama.jp\nshinjo.okayama.jp\nshoo.okayama.jp\nsoja.okayama.jp\ntakahashi.okayama.jp\ntamano.okayama.jp\ntsuyama.okayama.jp\nwake.okayama.jp\nyakage.okayama.jp\naguni.okinawa.jp\nginowan.okinawa.jp\nginoza.okinawa.jp\ngushikami.okinawa.jp\nhaebaru.okinawa.jp\nhigashi.okinawa.jp\nhirara.okinawa.jp\niheya.okinawa.jp\nishigaki.okinawa.jp\nishikawa.okinawa.jp\nitoman.okinawa.jp\nizena.okinawa.jp\nkadena.okinawa.jp\nkin.okinawa.jp\nkitadaito.okinawa.jp\nkitanakagusuku.okinawa.jp\nkumejima.okinawa.jp\nkunigami.okinawa.jp\nminamidaito.okinawa.jp\nmotobu.okinawa.jp\nnago.okinawa.jp\nnaha.okinawa.jp\nnakagusuku.okinawa.jp\nnakijin.okinawa.jp\nnanjo.okinawa.jp\nnishihara.okinawa.jp\nogimi.okinawa.jp\nokinawa.okinawa.jp\nonna.okinawa.jp\nshimoji.okinawa.jp\ntaketomi.okinawa.jp\ntarama.okinawa.jp\ntokashiki.okinawa.jp\ntomigusuku.okinawa.jp\ntonaki.okinawa.jp\nurasoe.okinawa.jp\nuruma.okinawa.jp\nyaese.okinawa.jp\nyomitan.okinawa.jp\nyonabaru.okinawa.jp\nyonaguni.okinawa.jp\nzamami.okinawa.jp\nabeno.osaka.jp\nchihayaakasaka.osaka.jp\nchuo.osaka.jp\ndaito.osaka.jp\nfujiidera.osaka.jp\nhabikino.osaka.jp\nhannan.osaka.jp\nhigashiosaka.osaka.jp\nhigashisumiyoshi.osaka.jp\nhigashiyodogawa.osaka.jp\nhirakata.osaka.jp\nibaraki.osaka.jp\nikeda.osaka.jp\nizumi.osaka.jp\nizumiotsu.osaka.jp\nizumisano.osaka.jp\nkadoma.osaka.jp\nkaizuka.osaka.jp\nkanan.osaka.jp\nkashiwara.osaka.jp\nkatano.osaka.jp\nkawachinagano.osaka.jp\nkishiwada.osaka.jp\nkita.osaka.jp\nkumatori.osaka.jp\nmatsubara.osaka.jp\nminato.osaka.jp\nminoh.osaka.jp\nmisaki.osaka.jp\nmoriguchi.osaka.jp\nneyagawa.osaka.jp\nnishi.osaka.jp\nnose.osaka.jp\nosakasayama.osaka.jp\nsakai.osaka.jp\nsayama.osaka.jp\nsennan.osaka.jp\nsettsu.osaka.jp\nshijonawate.osaka.jp\nshimamoto.osaka.jp\nsuita.osaka.jp\ntadaoka.osaka.jp\ntaishi.osaka.jp\ntajiri.osaka.jp\ntakaishi.osaka.jp\ntakatsuki.osaka.jp\ntondabayashi.osaka.jp\ntoyonaka.osaka.jp\ntoyono.osaka.jp\nyao.osaka.jp\nariake.saga.jp\narita.saga.jp\nfukudomi.saga.jp\ngenkai.saga.jp\nhamatama.saga.jp\nhizen.saga.jp\nimari.saga.jp\nkamimine.saga.jp\nkanzaki.saga.jp\nkaratsu.saga.jp\nkashima.saga.jp\nkitagata.saga.jp\nkitahata.saga.jp\nkiyama.saga.jp\nkouhoku.saga.jp\nkyuragi.saga.jp\nnishiarita.saga.jp\nogi.saga.jp\nomachi.saga.jp\nouchi.saga.jp\nsaga.saga.jp\nshiroishi.saga.jp\ntaku.saga.jp\ntara.saga.jp\ntosu.saga.jp\nyoshinogari.saga.jp\narakawa.saitama.jp\nasaka.saitama.jp\nchichibu.saitama.jp\nfujimi.saitama.jp\nfujimino.saitama.jp\nfukaya.saitama.jp\nhanno.saitama.jp\nhanyu.saitama.jp\nhasuda.saitama.jp\nhatogaya.saitama.jp\nhatoyama.saitama.jp\nhidaka.saitama.jp\nhigashichichibu.saitama.jp\nhigashimatsuyama.saitama.jp\nhonjo.saitama.jp\nina.saitama.jp\niruma.saitama.jp\niwatsuki.saitama.jp\nkamiizumi.saitama.jp\nkamikawa.saitama.jp\nkamisato.saitama.jp\nkasukabe.saitama.jp\nkawagoe.saitama.jp\nkawaguchi.saitama.jp\nkawajima.saitama.jp\nkazo.saitama.jp\nkitamoto.saitama.jp\nkoshigaya.saitama.jp\nkounosu.saitama.jp\nkuki.saitama.jp\nkumagaya.saitama.jp\nmatsubushi.saitama.jp\nminano.saitama.jp\nmisato.saitama.jp\nmiyashiro.saitama.jp\nmiyoshi.saitama.jp\nmoroyama.saitama.jp\nnagatoro.saitama.jp\nnamegawa.saitama.jp\nniiza.saitama.jp\nogano.saitama.jp\nogawa.saitama.jp\nogose.saitama.jp\nokegawa.saitama.jp\nomiya.saitama.jp\notaki.saitama.jp\nranzan.saitama.jp\nryokami.saitama.jp\nsaitama.saitama.jp\nsakado.saitama.jp\nsatte.saitama.jp\nsayama.saitama.jp\nshiki.saitama.jp\nshiraoka.saitama.jp\nsoka.saitama.jp\nsugito.saitama.jp\ntoda.saitama.jp\ntokigawa.saitama.jp\ntokorozawa.saitama.jp\ntsurugashima.saitama.jp\nurawa.saitama.jp\nwarabi.saitama.jp\nyashio.saitama.jp\nyokoze.saitama.jp\nyono.saitama.jp\nyorii.saitama.jp\nyoshida.saitama.jp\nyoshikawa.saitama.jp\nyoshimi.saitama.jp\naisho.shiga.jp\ngamo.shiga.jp\nhigashiomi.shiga.jp\nhikone.shiga.jp\nkoka.shiga.jp\nkonan.shiga.jp\nkosei.shiga.jp\nkoto.shiga.jp\nkusatsu.shiga.jp\nmaibara.shiga.jp\nmoriyama.shiga.jp\nnagahama.shiga.jp\nnishiazai.shiga.jp\nnotogawa.shiga.jp\nomihachiman.shiga.jp\notsu.shiga.jp\nritto.shiga.jp\nryuoh.shiga.jp\ntakashima.shiga.jp\ntakatsuki.shiga.jp\ntorahime.shiga.jp\ntoyosato.shiga.jp\nyasu.shiga.jp\nakagi.shimane.jp\nama.shimane.jp\ngotsu.shimane.jp\nhamada.shimane.jp\nhigashiizumo.shimane.jp\nhikawa.shimane.jp\nhikimi.shimane.jp\nizumo.shimane.jp\nkakinoki.shimane.jp\nmasuda.shimane.jp\nmatsue.shimane.jp\nmisato.shimane.jp\nnishinoshima.shimane.jp\nohda.shimane.jp\nokinoshima.shimane.jp\nokuizumo.shimane.jp\nshimane.shimane.jp\ntamayu.shimane.jp\ntsuwano.shimane.jp\nunnan.shimane.jp\nyakumo.shimane.jp\nyasugi.shimane.jp\nyatsuka.shimane.jp\narai.shizuoka.jp\natami.shizuoka.jp\nfuji.shizuoka.jp\nfujieda.shizuoka.jp\nfujikawa.shizuoka.jp\nfujinomiya.shizuoka.jp\nfukuroi.shizuoka.jp\ngotemba.shizuoka.jp\nhaibara.shizuoka.jp\nhamamatsu.shizuoka.jp\nhigashiizu.shizuoka.jp\nito.shizuoka.jp\niwata.shizuoka.jp\nizu.shizuoka.jp\nizunokuni.shizuoka.jp\nkakegawa.shizuoka.jp\nkannami.shizuoka.jp\nkawanehon.shizuoka.jp\nkawazu.shizuoka.jp\nkikugawa.shizuoka.jp\nkosai.shizuoka.jp\nmakinohara.shizuoka.jp\nmatsuzaki.shizuoka.jp\nminamiizu.shizuoka.jp\nmishima.shizuoka.jp\nmorimachi.shizuoka.jp\nnishiizu.shizuoka.jp\nnumazu.shizuoka.jp\nomaezaki.shizuoka.jp\nshimada.shizuoka.jp\nshimizu.shizuoka.jp\nshimoda.shizuoka.jp\nshizuoka.shizuoka.jp\nsusono.shizuoka.jp\nyaizu.shizuoka.jp\nyoshida.shizuoka.jp\nashikaga.tochigi.jp\nbato.tochigi.jp\nhaga.tochigi.jp\nichikai.tochigi.jp\niwafune.tochigi.jp\nkaminokawa.tochigi.jp\nkanuma.tochigi.jp\nkarasuyama.tochigi.jp\nkuroiso.tochigi.jp\nmashiko.tochigi.jp\nmibu.tochigi.jp\nmoka.tochigi.jp\nmotegi.tochigi.jp\nnasu.tochigi.jp\nnasushiobara.tochigi.jp\nnikko.tochigi.jp\nnishikata.tochigi.jp\nnogi.tochigi.jp\nohira.tochigi.jp\nohtawara.tochigi.jp\noyama.tochigi.jp\nsakura.tochigi.jp\nsano.tochigi.jp\nshimotsuke.tochigi.jp\nshioya.tochigi.jp\ntakanezawa.tochigi.jp\ntochigi.tochigi.jp\ntsuga.tochigi.jp\nujiie.tochigi.jp\nutsunomiya.tochigi.jp\nyaita.tochigi.jp\naizumi.tokushima.jp\nanan.tokushima.jp\nichiba.tokushima.jp\nitano.tokushima.jp\nkainan.tokushima.jp\nkomatsushima.tokushima.jp\nmatsushige.tokushima.jp\nmima.tokushima.jp\nminami.tokushima.jp\nmiyoshi.tokushima.jp\nmugi.tokushima.jp\nnakagawa.tokushima.jp\nnaruto.tokushima.jp\nsanagochi.tokushima.jp\nshishikui.tokushima.jp\ntokushima.tokushima.jp\nwajiki.tokushima.jp\nadachi.tokyo.jp\nakiruno.tokyo.jp\nakishima.tokyo.jp\naogashima.tokyo.jp\narakawa.tokyo.jp\nbunkyo.tokyo.jp\nchiyoda.tokyo.jp\nchofu.tokyo.jp\nchuo.tokyo.jp\nedogawa.tokyo.jp\nfuchu.tokyo.jp\nfussa.tokyo.jp\nhachijo.tokyo.jp\nhachioji.tokyo.jp\nhamura.tokyo.jp\nhigashikurume.tokyo.jp\nhigashimurayama.tokyo.jp\nhigashiyamato.tokyo.jp\nhino.tokyo.jp\nhinode.tokyo.jp\nhinohara.tokyo.jp\ninagi.tokyo.jp\nitabashi.tokyo.jp\nkatsushika.tokyo.jp\nkita.tokyo.jp\nkiyose.tokyo.jp\nkodaira.tokyo.jp\nkoganei.tokyo.jp\nkokubunji.tokyo.jp\nkomae.tokyo.jp\nkoto.tokyo.jp\nkouzushima.tokyo.jp\nkunitachi.tokyo.jp\nmachida.tokyo.jp\nmeguro.tokyo.jp\nminato.tokyo.jp\nmitaka.tokyo.jp\nmizuho.tokyo.jp\nmusashimurayama.tokyo.jp\nmusashino.tokyo.jp\nnakano.tokyo.jp\nnerima.tokyo.jp\nogasawara.tokyo.jp\nokutama.tokyo.jp\nome.tokyo.jp\noshima.tokyo.jp\nota.tokyo.jp\nsetagaya.tokyo.jp\nshibuya.tokyo.jp\nshinagawa.tokyo.jp\nshinjuku.tokyo.jp\nsuginami.tokyo.jp\nsumida.tokyo.jp\ntachikawa.tokyo.jp\ntaito.tokyo.jp\ntama.tokyo.jp\ntoshima.tokyo.jp\nchizu.tottori.jp\nhino.tottori.jp\nkawahara.tottori.jp\nkoge.tottori.jp\nkotoura.tottori.jp\nmisasa.tottori.jp\nnanbu.tottori.jp\nnichinan.tottori.jp\nsakaiminato.tottori.jp\ntottori.tottori.jp\nwakasa.tottori.jp\nyazu.tottori.jp\nyonago.tottori.jp\nasahi.toyama.jp\nfuchu.toyama.jp\nfukumitsu.toyama.jp\nfunahashi.toyama.jp\nhimi.toyama.jp\nimizu.toyama.jp\ninami.toyama.jp\njohana.toyama.jp\nkamiichi.toyama.jp\nkurobe.toyama.jp\nnakaniikawa.toyama.jp\nnamerikawa.toyama.jp\nnanto.toyama.jp\nnyuzen.toyama.jp\noyabe.toyama.jp\ntaira.toyama.jp\ntakaoka.toyama.jp\ntateyama.toyama.jp\ntoga.toyama.jp\ntonami.toyama.jp\ntoyama.toyama.jp\nunazuki.toyama.jp\nuozu.toyama.jp\nyamada.toyama.jp\narida.wakayama.jp\naridagawa.wakayama.jp\ngobo.wakayama.jp\nhashimoto.wakayama.jp\nhidaka.wakayama.jp\nhirogawa.wakayama.jp\ninami.wakayama.jp\niwade.wakayama.jp\nkainan.wakayama.jp\nkamitonda.wakayama.jp\nkatsuragi.wakayama.jp\nkimino.wakayama.jp\nkinokawa.wakayama.jp\nkitayama.wakayama.jp\nkoya.wakayama.jp\nkoza.wakayama.jp\nkozagawa.wakayama.jp\nkudoyama.wakayama.jp\nkushimoto.wakayama.jp\nmihama.wakayama.jp\nmisato.wakayama.jp\nnachikatsuura.wakayama.jp\nshingu.wakayama.jp\nshirahama.wakayama.jp\ntaiji.wakayama.jp\ntanabe.wakayama.jp\nwakayama.wakayama.jp\nyuasa.wakayama.jp\nyura.wakayama.jp\nasahi.yamagata.jp\nfunagata.yamagata.jp\nhigashine.yamagata.jp\niide.yamagata.jp\nkahoku.yamagata.jp\nkaminoyama.yamagata.jp\nkaneyama.yamagata.jp\nkawanishi.yamagata.jp\nmamurogawa.yamagata.jp\nmikawa.yamagata.jp\nmurayama.yamagata.jp\nnagai.yamagata.jp\nnakayama.yamagata.jp\nnanyo.yamagata.jp\nnishikawa.yamagata.jp\nobanazawa.yamagata.jp\noe.yamagata.jp\noguni.yamagata.jp\nohkura.yamagata.jp\noishida.yamagata.jp\nsagae.yamagata.jp\nsakata.yamagata.jp\nsakegawa.yamagata.jp\nshinjo.yamagata.jp\nshirataka.yamagata.jp\nshonai.yamagata.jp\ntakahata.yamagata.jp\ntendo.yamagata.jp\ntozawa.yamagata.jp\ntsuruoka.yamagata.jp\nyamagata.yamagata.jp\nyamanobe.yamagata.jp\nyonezawa.yamagata.jp\nyuza.yamagata.jp\nabu.yamaguchi.jp\nhagi.yamaguchi.jp\nhikari.yamaguchi.jp\nhofu.yamaguchi.jp\niwakuni.yamaguchi.jp\nkudamatsu.yamaguchi.jp\nmitou.yamaguchi.jp\nnagato.yamaguchi.jp\noshima.yamaguchi.jp\nshimonoseki.yamaguchi.jp\nshunan.yamaguchi.jp\ntabuse.yamaguchi.jp\ntokuyama.yamaguchi.jp\ntoyota.yamaguchi.jp\nube.yamaguchi.jp\nyuu.yamaguchi.jp\nchuo.yamanashi.jp\ndoshi.yamanashi.jp\nfuefuki.yamanashi.jp\nfujikawa.yamanashi.jp\nfujikawaguchiko.yamanashi.jp\nfujiyoshida.yamanashi.jp\nhayakawa.yamanashi.jp\nhokuto.yamanashi.jp\nichikawamisato.yamanashi.jp\nkai.yamanashi.jp\nkofu.yamanashi.jp\nkoshu.yamanashi.jp\nkosuge.yamanashi.jp\nminami-alps.yamanashi.jp\nminobu.yamanashi.jp\nnakamichi.yamanashi.jp\nnanbu.yamanashi.jp\nnarusawa.yamanashi.jp\nnirasaki.yamanashi.jp\nnishikatsura.yamanashi.jp\noshino.yamanashi.jp\notsuki.yamanashi.jp\nshowa.yamanashi.jp\ntabayama.yamanashi.jp\ntsuru.yamanashi.jp\nuenohara.yamanashi.jp\nyamanakako.yamanashi.jp\nyamanashi.yamanashi.jp\nke\nac.ke\nco.ke\ngo.ke\ninfo.ke\nme.ke\nmobi.ke\nne.ke\nor.ke\nsc.ke\nkg\ncom.kg\nedu.kg\ngov.kg\nmil.kg\nnet.kg\norg.kg\nkh\ncom.kh\nedu.kh\ngov.kh\nnet.kh\norg.kh\nki\nbiz.ki\ncom.ki\nedu.ki\ngov.ki\ninfo.ki\nnet.ki\norg.ki\nkm\nass.km\ncom.km\nedu.km\ngov.km\nmil.km\nnom.km\norg.km\nprd.km\ntm.km\nasso.km\ncoop.km\ngouv.km\nmedecin.km\nnotaires.km\npharmaciens.km\npresse.km\nveterinaire.km\nkn\nedu.kn\ngov.kn\nnet.kn\norg.kn\nkp\ncom.kp\nedu.kp\ngov.kp\norg.kp\nrep.kp\ntra.kp\nkr\nac.kr\nai.kr\nco.kr\nes.kr\ngo.kr\nhs.kr\nio.kr\nit.kr\nkg.kr\nme.kr\nmil.kr\nms.kr\nne.kr\nor.kr\npe.kr\nre.kr\nsc.kr\nbusan.kr\nchungbuk.kr\nchungnam.kr\ndaegu.kr\ndaejeon.kr\ngangwon.kr\ngwangju.kr\ngyeongbuk.kr\ngyeonggi.kr\ngyeongnam.kr\nincheon.kr\njeju.kr\njeonbuk.kr\njeonnam.kr\nseoul.kr\nulsan.kr\nkw\ncom.kw\nedu.kw\nemb.kw\ngov.kw\nind.kw\nnet.kw\norg.kw\nky\ncom.ky\nedu.ky\nnet.ky\norg.ky\nkz\ncom.kz\nedu.kz\ngov.kz\nmil.kz\nnet.kz\norg.kz\nla\ncom.la\nedu.la\ngov.la\ninfo.la\nint.la\nnet.la\norg.la\nper.la\nlb\ncom.lb\nedu.lb\ngov.lb\nnet.lb\norg.lb\nlc\nco.lc\ncom.lc\nedu.lc\ngov.lc\nnet.lc\norg.lc\nli\nlk\nac.lk\nassn.lk\ncom.lk\nedu.lk\ngov.lk\ngrp.lk\nhotel.lk\nint.lk\nltd.lk\nnet.lk\nngo.lk\norg.lk\nsch.lk\nsoc.lk\nweb.lk\nlr\ncom.lr\nedu.lr\ngov.lr\nnet.lr\norg.lr\nls\nac.ls\nbiz.ls\nco.ls\nedu.ls\ngov.ls\ninfo.ls\nnet.ls\norg.ls\nsc.ls\nlt\ngov.lt\nlu\nlv\nasn.lv\ncom.lv\nconf.lv\nedu.lv\ngov.lv\nid.lv\nmil.lv\nnet.lv\norg.lv\nly\ncom.ly\nedu.ly\ngov.ly\nid.ly\nmed.ly\nnet.ly\norg.ly\nplc.ly\nsch.ly\nma\nac.ma\nco.ma\ngov.ma\nnet.ma\norg.ma\npress.ma\nmc\nasso.mc\ntm.mc\nmd\nme\nac.me\nco.me\nedu.me\ngov.me\nits.me\nnet.me\norg.me\npriv.me\nmg\nco.mg\ncom.mg\nedu.mg\ngov.mg\nmil.mg\nnom.mg\norg.mg\nprd.mg\nmh\nmil\nmk\ncom.mk\nedu.mk\ngov.mk\ninf.mk\nname.mk\nnet.mk\norg.mk\nml\nac.ml\nart.ml\nasso.ml\ncom.ml\nedu.ml\ngouv.ml\ngov.ml\ninfo.ml\ninst.ml\nnet.ml\norg.ml\npr.ml\npresse.ml\n*.mm\nmn\nedu.mn\ngov.mn\norg.mn\nmo\ncom.mo\nedu.mo\ngov.mo\nnet.mo\norg.mo\nmobi\nmp\nmq\nmr\ngov.mr\nms\ncom.ms\nedu.ms\ngov.ms\nnet.ms\norg.ms\nmt\ncom.mt\nedu.mt\nnet.mt\norg.mt\nmu\nac.mu\nco.mu\ncom.mu\ngov.mu\nnet.mu\nor.mu\norg.mu\nmuseum\nmv\naero.mv\nbiz.mv\ncom.mv\ncoop.mv\nedu.mv\ngov.mv\ninfo.mv\nint.mv\nmil.mv\nmuseum.mv\nname.mv\nnet.mv\norg.mv\npro.mv\nmw\nac.mw\nbiz.mw\nco.mw\ncom.mw\ncoop.mw\nedu.mw\ngov.mw\nint.mw\nnet.mw\norg.mw\nmx\ncom.mx\nedu.mx\ngob.mx\nnet.mx\norg.mx\nmy\nbiz.my\ncom.my\nedu.my\ngov.my\nmil.my\nname.my\nnet.my\norg.my\nmz\nac.mz\nadv.mz\nco.mz\nedu.mz\ngov.mz\nmil.mz\nnet.mz\norg.mz\nna\nalt.na\nco.na\ncom.na\ngov.na\nnet.na\norg.na\nname\nnc\nasso.nc\nnom.nc\nne\nnet\nnf\narts.nf\ncom.nf\nfirm.nf\ninfo.nf\nnet.nf\nother.nf\nper.nf\nrec.nf\nstore.nf\nweb.nf\nng\ncom.ng\nedu.ng\ngov.ng\ni.ng\nmil.ng\nmobi.ng\nname.ng\nnet.ng\norg.ng\nsch.ng\nni\nac.ni\nbiz.ni\nco.ni\ncom.ni\nedu.ni\ngob.ni\nin.ni\ninfo.ni\nint.ni\nmil.ni\nnet.ni\nnom.ni\norg.ni\nweb.ni\nnl\nno\nfhs.no\nfolkebibl.no\nfylkesbibl.no\ngielda.no\nherad.no\nidrett.no\nkommune.no\nmuseum.no\npriv.no\nsuohkan.no\ntjielte.no\nuenorge.no\nvgs.no\ndep.no\nmil.no\nstat.no\naa.no\nah.no\nbu.no\nfm.no\nhl.no\nhm.no\njan-mayen.no\nmr.no\nnl.no\nnt.no\nof.no\nol.no\noslo.no\nrl.no\nsf.no\nst.no\nsvalbard.no\ntm.no\ntr.no\nva.no\nvf.no\ngs.aa.no\ngs.ah.no\ngs.bu.no\ngs.fm.no\ngs.hl.no\ngs.hm.no\ngs.jan-mayen.no\ngs.mr.no\ngs.nl.no\ngs.nt.no\ngs.of.no\ngs.ol.no\ngs.oslo.no\ngs.rl.no\ngs.sf.no\ngs.st.no\ngs.svalbard.no\ngs.tm.no\ngs.tr.no\ngs.va.no\ngs.vf.no\nakrehamn.no\nxn--krehamn-dxa.no\nalgard.no\nxn--lgrd-poac.no\narna.no\nbronnoysund.no\nxn--brnnysund-m8ac.no\nbrumunddal.no\nbryne.no\ndrobak.no\nxn--drbak-wua.no\negersund.no\nfetsund.no\nfloro.no\nxn--flor-jra.no\nfredrikstad.no\nhokksund.no\nhonefoss.no\nxn--hnefoss-q1a.no\njessheim.no\njorpeland.no\nxn--jrpeland-54a.no\nkirkenes.no\nkopervik.no\nkrokstadelva.no\nlangevag.no\nxn--langevg-jxa.no\nleirvik.no\nmjondalen.no\nxn--mjndalen-64a.no\nmo-i-rana.no\nmosjoen.no\nxn--mosjen-eya.no\nnesoddtangen.no\norkanger.no\nosoyro.no\nxn--osyro-wua.no\nraholt.no\nxn--rholt-mra.no\nsandnessjoen.no\nxn--sandnessjen-ogb.no\nskedsmokorset.no\nslattum.no\nspjelkavik.no\nstathelle.no\nstavern.no\nstjordalshalsen.no\nxn--stjrdalshalsen-sqb.no\ntananger.no\ntranby.no\nvossevangen.no\naarborte.no\naejrie.no\nafjord.no\nxn--fjord-lra.no\nagdenes.no\nnes.akershus.no\naknoluokta.no\nxn--koluokta-7ya57h.no\nal.no\nxn--l-1fa.no\nalaheadju.no\nxn--laheadju-7ya.no\nalesund.no\nxn--lesund-hua.no\nalstahaug.no\nalta.no\nxn--lt-liac.no\nalvdal.no\namli.no\nxn--mli-tla.no\namot.no\nxn--mot-tla.no\nandasuolo.no\nandebu.no\nandoy.no\nxn--andy-ira.no\nardal.no\nxn--rdal-poa.no\naremark.no\narendal.no\nxn--s-1fa.no\naseral.no\nxn--seral-lra.no\nasker.no\naskim.no\naskoy.no\nxn--asky-ira.no\naskvoll.no\nasnes.no\nxn--snes-poa.no\naudnedal.no\naukra.no\naure.no\naurland.no\naurskog-holand.no\nxn--aurskog-hland-jnb.no\naustevoll.no\naustrheim.no\naveroy.no\nxn--avery-yua.no\nbadaddja.no\nxn--bdddj-mrabd.no\nxn--brum-voa.no\nbahcavuotna.no\nxn--bhcavuotna-s4a.no\nbahccavuotna.no\nxn--bhccavuotna-k7a.no\nbaidar.no\nxn--bidr-5nac.no\nbajddar.no\nxn--bjddar-pta.no\nbalat.no\nxn--blt-elab.no\nbalestrand.no\nballangen.no\nbalsfjord.no\nbamble.no\nbardu.no\nbarum.no\nbatsfjord.no\nxn--btsfjord-9za.no\nbearalvahki.no\nxn--bearalvhki-y4a.no\nbeardu.no\nbeiarn.no\nberg.no\nbergen.no\nberlevag.no\nxn--berlevg-jxa.no\nbievat.no\nxn--bievt-0qa.no\nbindal.no\nbirkenes.no\nbjerkreim.no\nbjugn.no\nbodo.no\nxn--bod-2na.no\nbokn.no\nbomlo.no\nxn--bmlo-gra.no\nbremanger.no\nbronnoy.no\nxn--brnny-wuac.no\nbudejju.no\nnes.buskerud.no\nbygland.no\nbykle.no\ncahcesuolo.no\nxn--hcesuolo-7ya35b.no\ndavvenjarga.no\nxn--davvenjrga-y4a.no\ndavvesiida.no\ndeatnu.no\ndielddanuorri.no\ndivtasvuodna.no\ndivttasvuotna.no\ndonna.no\nxn--dnna-gra.no\ndovre.no\ndrammen.no\ndrangedal.no\ndyroy.no\nxn--dyry-ira.no\neid.no\neidfjord.no\neidsberg.no\neidskog.no\neidsvoll.no\neigersund.no\nelverum.no\nenebakk.no\nengerdal.no\netne.no\netnedal.no\nevenassi.no\nxn--eveni-0qa01ga.no\nevenes.no\nevje-og-hornnes.no\nfarsund.no\nfauske.no\nfedje.no\nfet.no\nfinnoy.no\nxn--finny-yua.no\nfitjar.no\nfjaler.no\nfjell.no\nfla.no\nxn--fl-zia.no\nflakstad.no\nflatanger.no\nflekkefjord.no\nflesberg.no\nflora.no\nfolldal.no\nforde.no\nxn--frde-gra.no\nforsand.no\nfosnes.no\nxn--frna-woa.no\nfrana.no\nfrogn.no\nfroland.no\nfrosta.no\nfroya.no\nxn--frya-hra.no\nfuoisku.no\nfuossko.no\nfusa.no\nfyresdal.no\ngaivuotna.no\nxn--givuotna-8ya.no\ngalsa.no\nxn--gls-elac.no\ngamvik.no\ngangaviika.no\nxn--ggaviika-8ya47h.no\ngaular.no\ngausdal.no\ngiehtavuoatna.no\ngildeskal.no\nxn--gildeskl-g0a.no\ngiske.no\ngjemnes.no\ngjerdrum.no\ngjerstad.no\ngjesdal.no\ngjovik.no\nxn--gjvik-wua.no\ngloppen.no\ngol.no\ngran.no\ngrane.no\ngranvin.no\ngratangen.no\ngrimstad.no\ngrong.no\ngrue.no\ngulen.no\nguovdageaidnu.no\nha.no\nxn--h-2fa.no\nhabmer.no\nxn--hbmer-xqa.no\nhadsel.no\nxn--hgebostad-g3a.no\nhagebostad.no\nhalden.no\nhalsa.no\nhamar.no\nhamaroy.no\nxn--hamary-fya.no\nhammarfeasta.no\nxn--hmmrfeasta-s4ac.no\nhammerfest.no\nhapmir.no\nxn--hpmir-xqa.no\nharam.no\nhareid.no\nharstad.no\nhasvik.no\nhattfjelldal.no\nhaugesund.no\nos.hedmark.no\nvaler.hedmark.no\nxn--vler-qoa.hedmark.no\nhemne.no\nhemnes.no\nhemsedal.no\nhitra.no\nhjartdal.no\nhjelmeland.no\nhobol.no\nxn--hobl-ira.no\nhof.no\nhol.no\nhole.no\nholmestrand.no\nholtalen.no\nxn--holtlen-hxa.no\nos.hordaland.no\nhornindal.no\nhorten.no\nhoyanger.no\nxn--hyanger-q1a.no\nhoylandet.no\nxn--hylandet-54a.no\nhurdal.no\nhurum.no\nhvaler.no\nhyllestad.no\nibestad.no\ninderoy.no\nxn--indery-fya.no\niveland.no\nivgu.no\njevnaker.no\njolster.no\nxn--jlster-bya.no\njondal.no\nkafjord.no\nxn--kfjord-iua.no\nkarasjohka.no\nxn--krjohka-hwab49j.no\nkarasjok.no\nkarlsoy.no\nxn--karlsy-fya.no\nkarmoy.no\nxn--karmy-yua.no\nkautokeino.no\nklabu.no\nxn--klbu-woa.no\nklepp.no\nkongsberg.no\nkongsvinger.no\nkraanghke.no\nxn--kranghke-b0a.no\nkragero.no\nxn--krager-gya.no\nkristiansand.no\nkristiansund.no\nkrodsherad.no\nxn--krdsherad-m8a.no\nxn--kvfjord-nxa.no\nxn--kvnangen-k0a.no\nkvafjord.no\nkvalsund.no\nkvam.no\nkvanangen.no\nkvinesdal.no\nkvinnherad.no\nkviteseid.no\nkvitsoy.no\nxn--kvitsy-fya.no\nlaakesvuemie.no\nxn--lrdal-sra.no\nlahppi.no\nxn--lhppi-xqa.no\nlardal.no\nlarvik.no\nlavagis.no\nlavangen.no\nleangaviika.no\nxn--leagaviika-52b.no\nlebesby.no\nleikanger.no\nleirfjord.no\nleka.no\nleksvik.no\nlenvik.no\nlerdal.no\nlesja.no\nlevanger.no\nlier.no\nlierne.no\nlillehammer.no\nlillesand.no\nlindas.no\nxn--linds-pra.no\nlindesnes.no\nloabat.no\nxn--loabt-0qa.no\nlodingen.no\nxn--ldingen-q1a.no\nlom.no\nloppa.no\nlorenskog.no\nxn--lrenskog-54a.no\nloten.no\nxn--lten-gra.no\nlund.no\nlunner.no\nluroy.no\nxn--lury-ira.no\nluster.no\nlyngdal.no\nlyngen.no\nmalatvuopmi.no\nxn--mlatvuopmi-s4a.no\nmalselv.no\nxn--mlselv-iua.no\nmalvik.no\nmandal.no\nmarker.no\nmarnardal.no\nmasfjorden.no\nmasoy.no\nxn--msy-ula0h.no\nmatta-varjjat.no\nxn--mtta-vrjjat-k7af.no\nmeland.no\nmeldal.no\nmelhus.no\nmeloy.no\nxn--mely-ira.no\nmeraker.no\nxn--merker-kua.no\nmidsund.no\nmidtre-gauldal.no\nmoareke.no\nxn--moreke-jua.no\nmodalen.no\nmodum.no\nmolde.no\nheroy.more-og-romsdal.no\nsande.more-og-romsdal.no\nxn--hery-ira.xn--mre-og-romsdal-qqb.no\nsande.xn--mre-og-romsdal-qqb.no\nmoskenes.no\nmoss.no\nmuosat.no\nxn--muost-0qa.no\nnaamesjevuemie.no\nxn--nmesjevuemie-tcba.no\nxn--nry-yla5g.no\nnamdalseid.no\nnamsos.no\nnamsskogan.no\nnannestad.no\nnaroy.no\nnarviika.no\nnarvik.no\nnaustdal.no\nnavuotna.no\nxn--nvuotna-hwa.no\nnedre-eiker.no\nnesna.no\nnesodden.no\nnesseby.no\nnesset.no\nnissedal.no\nnittedal.no\nnord-aurdal.no\nnord-fron.no\nnord-odal.no\nnorddal.no\nnordkapp.no\nbo.nordland.no\nxn--b-5ga.nordland.no\nheroy.nordland.no\nxn--hery-ira.nordland.no\nnordre-land.no\nnordreisa.no\nnore-og-uvdal.no\nnotodden.no\nnotteroy.no\nxn--nttery-byae.no\nodda.no\noksnes.no\nxn--ksnes-uua.no\nomasvuotna.no\noppdal.no\noppegard.no\nxn--oppegrd-ixa.no\norkdal.no\norland.no\nxn--rland-uua.no\norskog.no\nxn--rskog-uua.no\norsta.no\nxn--rsta-fra.no\nosen.no\nosteroy.no\nxn--ostery-fya.no\nvaler.ostfold.no\nxn--vler-qoa.xn--stfold-9xa.no\nostre-toten.no\nxn--stre-toten-zcb.no\noverhalla.no\novre-eiker.no\nxn--vre-eiker-k8a.no\noyer.no\nxn--yer-zna.no\noygarden.no\nxn--ygarden-p1a.no\noystre-slidre.no\nxn--ystre-slidre-ujb.no\nporsanger.no\nporsangu.no\nxn--porsgu-sta26f.no\nporsgrunn.no\nrade.no\nxn--rde-ula.no\nradoy.no\nxn--rady-ira.no\nxn--rlingen-mxa.no\nrahkkeravju.no\nxn--rhkkervju-01af.no\nraisa.no\nxn--risa-5na.no\nrakkestad.no\nralingen.no\nrana.no\nrandaberg.no\nrauma.no\nre.no\nrendalen.no\nrennebu.no\nrennesoy.no\nxn--rennesy-v1a.no\nrindal.no\nringebu.no\nringerike.no\nringsaker.no\nrisor.no\nxn--risr-ira.no\nrissa.no\nroan.no\nrodoy.no\nxn--rdy-0nab.no\nrollag.no\nromsa.no\nromskog.no\nxn--rmskog-bya.no\nroros.no\nxn--rros-gra.no\nrost.no\nxn--rst-0na.no\nroyken.no\nxn--ryken-vua.no\nroyrvik.no\nxn--ryrvik-bya.no\nruovat.no\nrygge.no\nsalangen.no\nsalat.no\nxn--slat-5na.no\nxn--slt-elab.no\nsaltdal.no\nsamnanger.no\nsandefjord.no\nsandnes.no\nsandoy.no\nxn--sandy-yua.no\nsarpsborg.no\nsauda.no\nsauherad.no\nsel.no\nselbu.no\nselje.no\nseljord.no\nsiellak.no\nsigdal.no\nsiljan.no\nsirdal.no\nskanit.no\nxn--sknit-yqa.no\nskanland.no\nxn--sknland-fxa.no\nskaun.no\nskedsmo.no\nski.no\nskien.no\nskierva.no\nxn--skierv-uta.no\nskiptvet.no\nskjak.no\nxn--skjk-soa.no\nskjervoy.no\nxn--skjervy-v1a.no\nskodje.no\nsmola.no\nxn--smla-hra.no\nsnaase.no\nxn--snase-nra.no\nsnasa.no\nxn--snsa-roa.no\nsnillfjord.no\nsnoasa.no\nsogndal.no\nsogne.no\nxn--sgne-gra.no\nsokndal.no\nsola.no\nsolund.no\nsomna.no\nxn--smna-gra.no\nsondre-land.no\nxn--sndre-land-0cb.no\nsongdalen.no\nsor-aurdal.no\nxn--sr-aurdal-l8a.no\nsor-fron.no\nxn--sr-fron-q1a.no\nsor-odal.no\nxn--sr-odal-q1a.no\nsor-varanger.no\nxn--sr-varanger-ggb.no\nsorfold.no\nxn--srfold-bya.no\nsorreisa.no\nxn--srreisa-q1a.no\nsortland.no\nsorum.no\nxn--srum-gra.no\nspydeberg.no\nstange.no\nstavanger.no\nsteigen.no\nsteinkjer.no\nstjordal.no\nxn--stjrdal-s1a.no\nstokke.no\nstor-elvdal.no\nstord.no\nstordal.no\nstorfjord.no\nstrand.no\nstranda.no\nstryn.no\nsula.no\nsuldal.no\nsund.no\nsunndal.no\nsurnadal.no\nsveio.no\nsvelvik.no\nsykkylven.no\ntana.no\nbo.telemark.no\nxn--b-5ga.telemark.no\ntime.no\ntingvoll.no\ntinn.no\ntjeldsund.no\ntjome.no\nxn--tjme-hra.no\ntokke.no\ntolga.no\ntonsberg.no\nxn--tnsberg-q1a.no\ntorsken.no\nxn--trna-woa.no\ntrana.no\ntranoy.no\nxn--trany-yua.no\ntroandin.no\ntrogstad.no\nxn--trgstad-r1a.no\ntromsa.no\ntromso.no\nxn--troms-zua.no\ntrondheim.no\ntrysil.no\ntvedestrand.no\ntydal.no\ntynset.no\ntysfjord.no\ntysnes.no\nxn--tysvr-vra.no\ntysvar.no\nullensaker.no\nullensvang.no\nulstein.no\nulvik.no\nunjarga.no\nxn--unjrga-rta.no\nutsira.no\nvaapste.no\nvadso.no\nxn--vads-jra.no\nxn--vry-yla5g.no\nvaga.no\nxn--vg-yiab.no\nvagan.no\nxn--vgan-qoa.no\nvagsoy.no\nxn--vgsy-qoa0j.no\nvaksdal.no\nvalle.no\nvang.no\nvanylven.no\nvardo.no\nxn--vard-jra.no\nvarggat.no\nxn--vrggt-xqad.no\nvaroy.no\nvefsn.no\nvega.no\nvegarshei.no\nxn--vegrshei-c0a.no\nvennesla.no\nverdal.no\nverran.no\nvestby.no\nsande.vestfold.no\nvestnes.no\nvestre-slidre.no\nvestre-toten.no\nvestvagoy.no\nxn--vestvgy-ixa6o.no\nvevelstad.no\nvik.no\nvikna.no\nvindafjord.no\nvoagat.no\nvolda.no\nvoss.no\n*.np\nnr\nbiz.nr\ncom.nr\nedu.nr\ngov.nr\ninfo.nr\nnet.nr\norg.nr\nnu\nnz\nac.nz\nco.nz\ncri.nz\ngeek.nz\ngen.nz\ngovt.nz\nhealth.nz\niwi.nz\nkiwi.nz\nmaori.nz\nxn--mori-qsa.nz\nmil.nz\nnet.nz\norg.nz\nparliament.nz\nschool.nz\nom\nco.om\ncom.om\nedu.om\ngov.om\nmed.om\nmuseum.om\nnet.om\norg.om\npro.om\nonion\norg\npa\nabo.pa\nac.pa\ncom.pa\nedu.pa\ngob.pa\ning.pa\nmed.pa\nnet.pa\nnom.pa\norg.pa\nsld.pa\npe\ncom.pe\nedu.pe\ngob.pe\nmil.pe\nnet.pe\nnom.pe\norg.pe\npf\ncom.pf\nedu.pf\norg.pf\n*.pg\nph\ncom.ph\nedu.ph\ngov.ph\ni.ph\nmil.ph\nnet.ph\nngo.ph\norg.ph\npk\nac.pk\nbiz.pk\ncom.pk\nedu.pk\nfam.pk\ngkp.pk\ngob.pk\ngog.pk\ngok.pk\ngop.pk\ngos.pk\ngov.pk\nnet.pk\norg.pk\nweb.pk\npl\ncom.pl\nnet.pl\norg.pl\nagro.pl\naid.pl\natm.pl\nauto.pl\nbiz.pl\nedu.pl\ngmina.pl\ngsm.pl\ninfo.pl\nmail.pl\nmedia.pl\nmiasta.pl\nmil.pl\nnieruchomosci.pl\nnom.pl\npc.pl\npowiat.pl\npriv.pl\nrealestate.pl\nrel.pl\nsex.pl\nshop.pl\nsklep.pl\nsos.pl\nszkola.pl\ntargi.pl\ntm.pl\ntourism.pl\ntravel.pl\nturystyka.pl\ngov.pl\nap.gov.pl\ngriw.gov.pl\nic.gov.pl\nis.gov.pl\nkmpsp.gov.pl\nkonsulat.gov.pl\nkppsp.gov.pl\nkwp.gov.pl\nkwpsp.gov.pl\nmup.gov.pl\nmw.gov.pl\noia.gov.pl\noirm.gov.pl\noke.gov.pl\noow.gov.pl\noschr.gov.pl\noum.gov.pl\npa.gov.pl\npinb.gov.pl\npiw.gov.pl\npo.gov.pl\npr.gov.pl\npsp.gov.pl\npsse.gov.pl\npup.gov.pl\nrzgw.gov.pl\nsa.gov.pl\nsdn.gov.pl\nsko.gov.pl\nso.gov.pl\nsr.gov.pl\nstarostwo.gov.pl\nug.gov.pl\nugim.gov.pl\num.gov.pl\numig.gov.pl\nupow.gov.pl\nuppo.gov.pl\nus.gov.pl\nuw.gov.pl\nuzs.gov.pl\nwif.gov.pl\nwiih.gov.pl\nwinb.gov.pl\nwios.gov.pl\nwitd.gov.pl\nwiw.gov.pl\nwkz.gov.pl\nwsa.gov.pl\nwskr.gov.pl\nwsse.gov.pl\nwuoz.gov.pl\nwzmiuw.gov.pl\nzp.gov.pl\nzpisdn.gov.pl\naugustow.pl\nbabia-gora.pl\nbedzin.pl\nbeskidy.pl\nbialowieza.pl\nbialystok.pl\nbielawa.pl\nbieszczady.pl\nboleslawiec.pl\nbydgoszcz.pl\nbytom.pl\ncieszyn.pl\nczeladz.pl\nczest.pl\ndlugoleka.pl\nelblag.pl\nelk.pl\nglogow.pl\ngniezno.pl\ngorlice.pl\ngrajewo.pl\nilawa.pl\njaworzno.pl\njelenia-gora.pl\njgora.pl\nkalisz.pl\nkarpacz.pl\nkartuzy.pl\nkaszuby.pl\nkatowice.pl\nkazimierz-dolny.pl\nkepno.pl\nketrzyn.pl\nklodzko.pl\nkobierzyce.pl\nkolobrzeg.pl\nkonin.pl\nkonskowola.pl\nkutno.pl\nlapy.pl\nlebork.pl\nlegnica.pl\nlezajsk.pl\nlimanowa.pl\nlomza.pl\nlowicz.pl\nlubin.pl\nlukow.pl\nmalbork.pl\nmalopolska.pl\nmazowsze.pl\nmazury.pl\nmielec.pl\nmielno.pl\nmragowo.pl\nnaklo.pl\nnowaruda.pl\nnysa.pl\nolawa.pl\nolecko.pl\nolkusz.pl\nolsztyn.pl\nopoczno.pl\nopole.pl\nostroda.pl\nostroleka.pl\nostrowiec.pl\nostrowwlkp.pl\npila.pl\npisz.pl\npodhale.pl\npodlasie.pl\npolkowice.pl\npomorskie.pl\npomorze.pl\nprochowice.pl\npruszkow.pl\nprzeworsk.pl\npulawy.pl\nradom.pl\nrawa-maz.pl\nrybnik.pl\nrzeszow.pl\nsanok.pl\nsejny.pl\nskoczow.pl\nslask.pl\nslupsk.pl\nsosnowiec.pl\nstalowa-wola.pl\nstarachowice.pl\nstargard.pl\nsuwalki.pl\nswidnica.pl\nswiebodzin.pl\nswinoujscie.pl\nszczecin.pl\nszczytno.pl\ntarnobrzeg.pl\ntgory.pl\nturek.pl\ntychy.pl\nustka.pl\nwalbrzych.pl\nwarmia.pl\nwarszawa.pl\nwaw.pl\nwegrow.pl\nwielun.pl\nwlocl.pl\nwloclawek.pl\nwodzislaw.pl\nwolomin.pl\nwroclaw.pl\nzachpomor.pl\nzagan.pl\nzarow.pl\nzgora.pl\nzgorzelec.pl\npm\npn\nco.pn\nedu.pn\ngov.pn\nnet.pn\norg.pn\npost\npr\nac.pr\nbiz.pr\ncom.pr\nedu.pr\nest.pr\ngov.pr\ninfo.pr\nisla.pr\nname.pr\nnet.pr\norg.pr\npro.pr\nprof.pr\npro\naaa.pro\naca.pro\nacct.pro\navocat.pro\nbar.pro\ncpa.pro\neng.pro\njur.pro\nlaw.pro\nmed.pro\nrecht.pro\nps\ncom.ps\nedu.ps\ngov.ps\nnet.ps\norg.ps\nplo.ps\nsec.ps\npt\ncom.pt\nedu.pt\ngov.pt\nint.pt\nnet.pt\nnome.pt\norg.pt\npubl.pt\npw\ngov.pw\npy\ncom.py\ncoop.py\nedu.py\ngov.py\nmil.py\nnet.py\norg.py\nqa\ncom.qa\nedu.qa\ngov.qa\nmil.qa\nname.qa\nnet.qa\norg.qa\nsch.qa\nre\nasso.re\ncom.re\nro\narts.ro\ncom.ro\nfirm.ro\ninfo.ro\nnom.ro\nnt.ro\norg.ro\nrec.ro\nstore.ro\ntm.ro\nwww.ro\nrs\nac.rs\nco.rs\nedu.rs\ngov.rs\nin.rs\norg.rs\nru\nrw\nac.rw\nco.rw\ncoop.rw\ngov.rw\nmil.rw\nnet.rw\norg.rw\nsa\ncom.sa\nedu.sa\ngov.sa\nmed.sa\nnet.sa\norg.sa\npub.sa\nsch.sa\nsb\ncom.sb\nedu.sb\ngov.sb\nnet.sb\norg.sb\nsc\ncom.sc\nedu.sc\ngov.sc\nnet.sc\norg.sc\nsd\ncom.sd\nedu.sd\ngov.sd\ninfo.sd\nmed.sd\nnet.sd\norg.sd\ntv.sd\nse\na.se\nac.se\nb.se\nbd.se\nbrand.se\nc.se\nd.se\ne.se\nf.se\nfh.se\nfhsk.se\nfhv.se\ng.se\nh.se\ni.se\nk.se\nkomforb.se\nkommunalforbund.se\nkomvux.se\nl.se\nlanbib.se\nm.se\nn.se\nnaturbruksgymn.se\no.se\norg.se\np.se\nparti.se\npp.se\npress.se\nr.se\ns.se\nt.se\ntm.se\nu.se\nw.se\nx.se\ny.se\nz.se\nsg\ncom.sg\nedu.sg\ngov.sg\nnet.sg\norg.sg\nsh\ncom.sh\ngov.sh\nmil.sh\nnet.sh\norg.sh\nsi\nsj\nsk\norg.sk\nsl\ncom.sl\nedu.sl\ngov.sl\nnet.sl\norg.sl\nsm\nsn\nart.sn\ncom.sn\nedu.sn\ngouv.sn\norg.sn\nuniv.sn\nso\ncom.so\nedu.so\ngov.so\nme.so\nnet.so\norg.so\nsr\nss\nbiz.ss\nco.ss\ncom.ss\nedu.ss\ngov.ss\nme.ss\nnet.ss\norg.ss\nsch.ss\nst\nco.st\ncom.st\nconsulado.st\nedu.st\nembaixada.st\nmil.st\nnet.st\norg.st\nprincipe.st\nsaotome.st\nstore.st\nsu\nsv\ncom.sv\nedu.sv\ngob.sv\norg.sv\nred.sv\nsx\ngov.sx\nsy\ncom.sy\nedu.sy\ngov.sy\nmil.sy\nnet.sy\norg.sy\nsz\nac.sz\nco.sz\norg.sz\ntc\ntd\ntel\ntf\ntg\nth\nac.th\nco.th\ngo.th\nin.th\nmi.th\nnet.th\nor.th\ntj\nbiz.tj\nco.tj\ncom.tj\nedu.tj\ngo.tj\ngov.tj\nint.tj\nmil.tj\nname.tj\nnet.tj\nnic.tj\norg.tj\ntest.tj\nweb.tj\ntk\ntl\ngov.tl\ntm\nco.tm\ncom.tm\nedu.tm\ngov.tm\nmil.tm\nnet.tm\nnom.tm\norg.tm\ntn\ncom.tn\nens.tn\nfin.tn\ngov.tn\nind.tn\ninfo.tn\nintl.tn\nmincom.tn\nnat.tn\nnet.tn\norg.tn\nperso.tn\ntourism.tn\nto\ncom.to\nedu.to\ngov.to\nmil.to\nnet.to\norg.to\ntr\nav.tr\nbbs.tr\nbel.tr\nbiz.tr\ncom.tr\ndr.tr\nedu.tr\ngen.tr\ngov.tr\ninfo.tr\nk12.tr\nkep.tr\nmil.tr\nname.tr\nnet.tr\norg.tr\npol.tr\ntel.tr\ntsk.tr\ntv.tr\nweb.tr\nnc.tr\ngov.nc.tr\ntt\nbiz.tt\nco.tt\ncom.tt\nedu.tt\ngov.tt\ninfo.tt\nmil.tt\nname.tt\nnet.tt\norg.tt\npro.tt\ntv\ntw\nclub.tw\ncom.tw\nebiz.tw\nedu.tw\ngame.tw\ngov.tw\nidv.tw\nmil.tw\nnet.tw\norg.tw\ntz\nac.tz\nco.tz\ngo.tz\nhotel.tz\ninfo.tz\nme.tz\nmil.tz\nmobi.tz\nne.tz\nor.tz\nsc.tz\ntv.tz\nua\ncom.ua\nedu.ua\ngov.ua\nin.ua\nnet.ua\norg.ua\ncherkassy.ua\ncherkasy.ua\nchernigov.ua\nchernihiv.ua\nchernivtsi.ua\nchernovtsy.ua\nck.ua\ncn.ua\ncr.ua\ncrimea.ua\ncv.ua\ndn.ua\ndnepropetrovsk.ua\ndnipropetrovsk.ua\ndonetsk.ua\ndp.ua\nif.ua\nivano-frankivsk.ua\nkh.ua\nkharkiv.ua\nkharkov.ua\nkherson.ua\nkhmelnitskiy.ua\nkhmelnytskyi.ua\nkiev.ua\nkirovograd.ua\nkm.ua\nkr.ua\nkropyvnytskyi.ua\nkrym.ua\nks.ua\nkv.ua\nkyiv.ua\nlg.ua\nlt.ua\nlugansk.ua\nluhansk.ua\nlutsk.ua\nlv.ua\nlviv.ua\nmk.ua\nmykolaiv.ua\nnikolaev.ua\nod.ua\nodesa.ua\nodessa.ua\npl.ua\npoltava.ua\nrivne.ua\nrovno.ua\nrv.ua\nsb.ua\nsebastopol.ua\nsevastopol.ua\nsm.ua\nsumy.ua\nte.ua\nternopil.ua\nuz.ua\nuzhgorod.ua\nuzhhorod.ua\nvinnica.ua\nvinnytsia.ua\nvn.ua\nvolyn.ua\nyalta.ua\nzakarpattia.ua\nzaporizhzhe.ua\nzaporizhzhia.ua\nzhitomir.ua\nzhytomyr.ua\nzp.ua\nzt.ua\nug\nac.ug\nco.ug\ncom.ug\nedu.ug\ngo.ug\ngov.ug\nmil.ug\nne.ug\nor.ug\norg.ug\nsc.ug\nus.ug\nuk\nac.uk\nco.uk\ngov.uk\nltd.uk\nme.uk\nnet.uk\nnhs.uk\norg.uk\nplc.uk\npolice.uk\n*.sch.uk\nus\ndni.us\nisa.us\nnsn.us\nak.us\nal.us\nar.us\nas.us\naz.us\nca.us\nco.us\nct.us\ndc.us\nde.us\nfl.us\nga.us\ngu.us\nhi.us\nia.us\nid.us\nil.us\nin.us\nks.us\nky.us\nla.us\nma.us\nmd.us\nme.us\nmi.us\nmn.us\nmo.us\nms.us\nmt.us\nnc.us\nnd.us\nne.us\nnh.us\nnj.us\nnm.us\nnv.us\nny.us\noh.us\nok.us\nor.us\npa.us\npr.us\nri.us\nsc.us\nsd.us\ntn.us\ntx.us\nut.us\nva.us\nvi.us\nvt.us\nwa.us\nwi.us\nwv.us\nwy.us\nk12.ak.us\nk12.al.us\nk12.ar.us\nk12.as.us\nk12.az.us\nk12.ca.us\nk12.co.us\nk12.ct.us\nk12.dc.us\nk12.fl.us\nk12.ga.us\nk12.gu.us\nk12.ia.us\nk12.id.us\nk12.il.us\nk12.in.us\nk12.ks.us\nk12.ky.us\nk12.la.us\nk12.ma.us\nk12.md.us\nk12.me.us\nk12.mi.us\nk12.mn.us\nk12.mo.us\nk12.ms.us\nk12.mt.us\nk12.nc.us\nk12.ne.us\nk12.nh.us\nk12.nj.us\nk12.nm.us\nk12.nv.us\nk12.ny.us\nk12.oh.us\nk12.ok.us\nk12.or.us\nk12.pa.us\nk12.pr.us\nk12.sc.us\nk12.tn.us\nk12.tx.us\nk12.ut.us\nk12.va.us\nk12.vi.us\nk12.vt.us\nk12.wa.us\nk12.wi.us\ncc.ak.us\nlib.ak.us\ncc.al.us\nlib.al.us\ncc.ar.us\nlib.ar.us\ncc.as.us\nlib.as.us\ncc.az.us\nlib.az.us\ncc.ca.us\nlib.ca.us\ncc.co.us\nlib.co.us\ncc.ct.us\nlib.ct.us\ncc.dc.us\nlib.dc.us\ncc.de.us\ncc.fl.us\nlib.fl.us\ncc.ga.us\nlib.ga.us\ncc.gu.us\nlib.gu.us\ncc.hi.us\nlib.hi.us\ncc.ia.us\nlib.ia.us\ncc.id.us\nlib.id.us\ncc.il.us\nlib.il.us\ncc.in.us\nlib.in.us\ncc.ks.us\nlib.ks.us\ncc.ky.us\nlib.ky.us\ncc.la.us\nlib.la.us\ncc.ma.us\nlib.ma.us\ncc.md.us\nlib.md.us\ncc.me.us\nlib.me.us\ncc.mi.us\nlib.mi.us\ncc.mn.us\nlib.mn.us\ncc.mo.us\nlib.mo.us\ncc.ms.us\ncc.mt.us\nlib.mt.us\ncc.nc.us\nlib.nc.us\ncc.ne.us\nlib.ne.us\ncc.nh.us\nlib.nh.us\ncc.nj.us\nlib.nj.us\ncc.nm.us\nlib.nm.us\ncc.nv.us\nlib.nv.us\ncc.ny.us\nlib.ny.us\ncc.oh.us\nlib.oh.us\ncc.ok.us\nlib.ok.us\ncc.or.us\nlib.or.us\ncc.pa.us\nlib.pa.us\ncc.pr.us\nlib.pr.us\ncc.ri.us\nlib.ri.us\ncc.sc.us\nlib.sc.us\ncc.sd.us\nlib.sd.us\ncc.tn.us\nlib.tn.us\ncc.tx.us\nlib.tx.us\ncc.ut.us\nlib.ut.us\ncc.va.us\nlib.va.us\ncc.vi.us\nlib.vi.us\ncc.vt.us\nlib.vt.us\ncc.wa.us\nlib.wa.us\ncc.wi.us\nlib.wi.us\ncc.wv.us\ncc.wy.us\nk12.wy.us\nlib.wy.us\nchtr.k12.ma.us\nparoch.k12.ma.us\npvt.k12.ma.us\nann-arbor.mi.us\ncog.mi.us\ndst.mi.us\neaton.mi.us\ngen.mi.us\nmus.mi.us\ntec.mi.us\nwashtenaw.mi.us\nuy\ncom.uy\nedu.uy\ngub.uy\nmil.uy\nnet.uy\norg.uy\nuz\nco.uz\ncom.uz\nnet.uz\norg.uz\nva\nvc\ncom.vc\nedu.vc\ngov.vc\nmil.vc\nnet.vc\norg.vc\nve\narts.ve\nbib.ve\nco.ve\ncom.ve\ne12.ve\nedu.ve\nemprende.ve\nfirm.ve\ngob.ve\ngov.ve\nia.ve\ninfo.ve\nint.ve\nmil.ve\nnet.ve\nnom.ve\norg.ve\nrar.ve\nrec.ve\nstore.ve\ntec.ve\nweb.ve\nvg\nedu.vg\nvi\nco.vi\ncom.vi\nk12.vi\nnet.vi\norg.vi\nvn\nac.vn\nai.vn\nbiz.vn\ncom.vn\nedu.vn\ngov.vn\nhealth.vn\nid.vn\ninfo.vn\nint.vn\nio.vn\nname.vn\nnet.vn\norg.vn\npro.vn\nangiang.vn\nbacgiang.vn\nbackan.vn\nbaclieu.vn\nbacninh.vn\nbaria-vungtau.vn\nbentre.vn\nbinhdinh.vn\nbinhduong.vn\nbinhphuoc.vn\nbinhthuan.vn\ncamau.vn\ncantho.vn\ncaobang.vn\ndaklak.vn\ndaknong.vn\ndanang.vn\ndienbien.vn\ndongnai.vn\ndongthap.vn\ngialai.vn\nhagiang.vn\nhaiduong.vn\nhaiphong.vn\nhanam.vn\nhanoi.vn\nhatinh.vn\nhaugiang.vn\nhoabinh.vn\nhue.vn\nhungyen.vn\nkhanhhoa.vn\nkiengiang.vn\nkontum.vn\nlaichau.vn\nlamdong.vn\nlangson.vn\nlaocai.vn\nlongan.vn\nnamdinh.vn\nnghean.vn\nninhbinh.vn\nninhthuan.vn\nphutho.vn\nphuyen.vn\nquangbinh.vn\nquangnam.vn\nquangngai.vn\nquangninh.vn\nquangtri.vn\nsoctrang.vn\nsonla.vn\ntayninh.vn\nthaibinh.vn\nthainguyen.vn\nthanhhoa.vn\nthanhphohochiminh.vn\nthuathienhue.vn\ntiengiang.vn\ntravinh.vn\ntuyenquang.vn\nvinhlong.vn\nvinhphuc.vn\nyenbai.vn\nvu\ncom.vu\nedu.vu\nnet.vu\norg.vu\nwf\nws\ncom.ws\nedu.ws\ngov.ws\nnet.ws\norg.ws\nyt\nxn--mgbaam7a8h\nxn--y9a3aq\nxn--54b7fta0cc\nxn--90ae\nxn--mgbcpq6gpa1a\nxn--90ais\nxn--fiqs8s\nxn--fiqz9s\nxn--lgbbat1ad8j\nxn--wgbh1c\nxn--e1a4c\nxn--qxa6a\nxn--mgbah1a3hjkrd\nxn--node\nxn--qxam\nxn--j6w193g\nxn--gmqw5a.xn--j6w193g\nxn--55qx5d.xn--j6w193g\nxn--mxtq1m.xn--j6w193g\nxn--wcvs22d.xn--j6w193g\nxn--uc0atv.xn--j6w193g\nxn--od0alg.xn--j6w193g\nxn--2scrj9c\nxn--3hcrj9c\nxn--45br5cyl\nxn--h2breg3eve\nxn--h2brj9c8c\nxn--mgbgu82a\nxn--rvc1e0am3e\nxn--h2brj9c\nxn--mgbbh1a\nxn--mgbbh1a71e\nxn--fpcrj9c3d\nxn--gecrj9c\nxn--s9brj9c\nxn--45brj9c\nxn--xkc2dl3a5ee0h\nxn--mgba3a4f16a\nxn--mgba3a4fra\nxn--mgbtx2b\nxn--mgbayh7gpa\nxn--3e0b707e\nxn--80ao21a\nxn--q7ce6a\nxn--fzc2c9e2c\nxn--xkc2al3hye2a\nxn--mgbc0a9azcg\nxn--d1alf\nxn--l1acc\nxn--mix891f\nxn--mix082f\nxn--mgbx4cd0ab\nxn--mgb9awbf\nxn--mgbai9azgqp6j\nxn--mgbai9a5eva00b\nxn--ygbi2ammx\nxn--90a3ac\nxn--80au.xn--90a3ac\nxn--90azh.xn--90a3ac\nxn--d1at.xn--90a3ac\nxn--c1avg.xn--90a3ac\nxn--o1ac.xn--90a3ac\nxn--o1ach.xn--90a3ac\nxn--p1ai\nxn--wgbl6a\nxn--mgberp4a5d4ar\nxn--mgberp4a5d4a87g\nxn--mgbqly7c0a67fbc\nxn--mgbqly7cvafr\nxn--mgbpl2fh\nxn--yfro4i67o\nxn--clchc0ea0b2g2a9gcd\nxn--ogbpf8fl\nxn--mgbtf8fl\nxn--o3cw4h\nxn--o3cyx2a.xn--o3cw4h\nxn--12co0c3b4eva.xn--o3cw4h\nxn--m3ch0j3a.xn--o3cw4h\nxn--h3cuzk1di.xn--o3cw4h\nxn--12c1fe0br.xn--o3cw4h\nxn--12cfi8ixb8l.xn--o3cw4h\nxn--pgbs0dh\nxn--kpry57d\nxn--kprw13d\nxn--nnx388a\nxn--j1amh\nxn--mgb2ddes\nxxx\nye\ncom.ye\nedu.ye\ngov.ye\nmil.ye\nnet.ye\norg.ye\nac.za\nagric.za\nalt.za\nco.za\nedu.za\ngov.za\ngrondar.za\nlaw.za\nmil.za\nnet.za\nngo.za\nnic.za\nnis.za\nnom.za\norg.za\nschool.za\ntm.za\nweb.za\nzm\nac.zm\nbiz.zm\nco.zm\ncom.zm\nedu.zm\ngov.zm\ninfo.zm\nmil.zm\nnet.zm\norg.zm\nsch.zm\nzw\nac.zw\nco.zw\ngov.zw\nmil.zw\norg.zw\naaa\naarp\nabb\nabbott\nabbvie\nabc\nable\nabogado\nabudhabi\nacademy\naccenture\naccountant\naccountants\naco\nactor\nads\nadult\naeg\naetna\nafl\nafrica\nagakhan\nagency\naig\nairbus\nairforce\nairtel\nakdn\nalibaba\nalipay\nallfinanz\nallstate\nally\nalsace\nalstom\namazon\namericanexpress\namericanfamily\namex\namfam\namica\namsterdam\nanalytics\nandroid\nanquan\nanz\naol\napartments\napp\napple\naquarelle\narab\naramco\narchi\narmy\nart\narte\nasda\nassociates\nathleta\nattorney\nauction\naudi\naudible\naudio\nauspost\nauthor\nauto\nautos\naws\naxa\nazure\nbaby\nbaidu\nbanamex\nband\nbank\nbar\nbarcelona\nbarclaycard\nbarclays\nbarefoot\nbargains\nbaseball\nbasketball\nbauhaus\nbayern\nbbc\nbbt\nbbva\nbcg\nbcn\nbeats\nbeauty\nbeer\nberlin\nbest\nbestbuy\nbet\nbharti\nbible\nbid\nbike\nbing\nbingo\nbio\nblack\nblackfriday\nblockbuster\nblog\nbloomberg\nblue\nbms\nbmw\nbnpparibas\nboats\nboehringer\nbofa\nbom\nbond\nboo\nbook\nbooking\nbosch\nbostik\nboston\nbot\nboutique\nbox\nbradesco\nbridgestone\nbroadway\nbroker\nbrother\nbrussels\nbuild\nbuilders\nbusiness\nbuy\nbuzz\nbzh\ncab\ncafe\ncal\ncall\ncalvinklein\ncam\ncamera\ncamp\ncanon\ncapetown\ncapital\ncapitalone\ncar\ncaravan\ncards\ncare\ncareer\ncareers\ncars\ncasa\ncase\ncash\ncasino\ncatering\ncatholic\ncba\ncbn\ncbre\ncenter\nceo\ncern\ncfa\ncfd\nchanel\nchannel\ncharity\nchase\nchat\ncheap\nchintai\nchristmas\nchrome\nchurch\ncipriani\ncircle\ncisco\ncitadel\nciti\ncitic\ncity\nclaims\ncleaning\nclick\nclinic\nclinique\nclothing\ncloud\nclub\nclubmed\ncoach\ncodes\ncoffee\ncollege\ncologne\ncommbank\ncommunity\ncompany\ncompare\ncomputer\ncomsec\ncondos\nconstruction\nconsulting\ncontact\ncontractors\ncooking\ncool\ncorsica\ncountry\ncoupon\ncoupons\ncourses\ncpa\ncredit\ncreditcard\ncreditunion\ncricket\ncrown\ncrs\ncruise\ncruises\ncuisinella\ncymru\ncyou\ndad\ndance\ndata\ndate\ndating\ndatsun\nday\ndclk\ndds\ndeal\ndealer\ndeals\ndegree\ndelivery\ndell\ndeloitte\ndelta\ndemocrat\ndental\ndentist\ndesi\ndesign\ndev\ndhl\ndiamonds\ndiet\ndigital\ndirect\ndirectory\ndiscount\ndiscover\ndish\ndiy\ndnp\ndocs\ndoctor\ndog\ndomains\ndot\ndownload\ndrive\ndtv\ndubai\ndupont\ndurban\ndvag\ndvr\nearth\neat\neco\nedeka\neducation\nemail\nemerck\nenergy\nengineer\nengineering\nenterprises\nepson\nequipment\nericsson\nerni\nesq\nestate\neurovision\neus\nevents\nexchange\nexpert\nexposed\nexpress\nextraspace\nfage\nfail\nfairwinds\nfaith\nfamily\nfan\nfans\nfarm\nfarmers\nfashion\nfast\nfedex\nfeedback\nferrari\nferrero\nfidelity\nfido\nfilm\nfinal\nfinance\nfinancial\nfire\nfirestone\nfirmdale\nfish\nfishing\nfit\nfitness\nflickr\nflights\nflir\nflorist\nflowers\nfly\nfoo\nfood\nfootball\nford\nforex\nforsale\nforum\nfoundation\nfox\nfree\nfresenius\nfrl\nfrogans\nfrontier\nftr\nfujitsu\nfun\nfund\nfurniture\nfutbol\nfyi\ngal\ngallery\ngallo\ngallup\ngame\ngames\ngap\ngarden\ngay\ngbiz\ngdn\ngea\ngent\ngenting\ngeorge\nggee\ngift\ngifts\ngives\ngiving\nglass\ngle\nglobal\nglobo\ngmail\ngmbh\ngmo\ngmx\ngodaddy\ngold\ngoldpoint\ngolf\ngoodyear\ngoog\ngoogle\ngop\ngot\ngrainger\ngraphics\ngratis\ngreen\ngripe\ngrocery\ngroup\ngucci\nguge\nguide\nguitars\nguru\nhair\nhamburg\nhangout\nhaus\nhbo\nhdfc\nhdfcbank\nhealth\nhealthcare\nhelp\nhelsinki\nhere\nhermes\nhiphop\nhisamitsu\nhitachi\nhiv\nhkt\nhockey\nholdings\nholiday\nhomedepot\nhomegoods\nhomes\nhomesense\nhonda\nhorse\nhospital\nhost\nhosting\nhot\nhotel\nhotels\nhotmail\nhouse\nhow\nhsbc\nhughes\nhyatt\nhyundai\nibm\nicbc\nice\nicu\nieee\nifm\nikano\nimamat\nimdb\nimmo\nimmobilien\ninc\nindustries\ninfiniti\ning\nink\ninstitute\ninsurance\ninsure\ninternational\nintuit\ninvestments\nipiranga\nirish\nismaili\nist\nistanbul\nitau\nitv\njaguar\njava\njcb\njeep\njetzt\njewelry\njio\njll\njmp\njnj\njoburg\njot\njoy\njpmorgan\njprs\njuegos\njuniper\nkaufen\nkddi\nkerryhotels\nkerryproperties\nkfh\nkia\nkids\nkim\nkindle\nkitchen\nkiwi\nkoeln\nkomatsu\nkosher\nkpmg\nkpn\nkrd\nkred\nkuokgroup\nkyoto\nlacaixa\nlamborghini\nlamer\nland\nlandrover\nlanxess\nlasalle\nlat\nlatino\nlatrobe\nlaw\nlawyer\nlds\nlease\nleclerc\nlefrak\nlegal\nlego\nlexus\nlgbt\nlidl\nlife\nlifeinsurance\nlifestyle\nlighting\nlike\nlilly\nlimited\nlimo\nlincoln\nlink\nlive\nliving\nllc\nllp\nloan\nloans\nlocker\nlocus\nlol\nlondon\nlotte\nlotto\nlove\nlpl\nlplfinancial\nltd\nltda\nlundbeck\nluxe\nluxury\nmadrid\nmaif\nmaison\nmakeup\nman\nmanagement\nmango\nmap\nmarket\nmarketing\nmarkets\nmarriott\nmarshalls\nmattel\nmba\nmckinsey\nmed\nmedia\nmeet\nmelbourne\nmeme\nmemorial\nmen\nmenu\nmerck\nmerckmsd\nmiami\nmicrosoft\nmini\nmint\nmit\nmitsubishi\nmlb\nmls\nmma\nmobile\nmoda\nmoe\nmoi\nmom\nmonash\nmoney\nmonster\nmormon\nmortgage\nmoscow\nmoto\nmotorcycles\nmov\nmovie\nmsd\nmtn\nmtr\nmusic\nnab\nnagoya\nnavy\nnba\nnec\nnetbank\nnetflix\nnetwork\nneustar\nnew\nnews\nnext\nnextdirect\nnexus\nnfl\nngo\nnhk\nnico\nnike\nnikon\nninja\nnissan\nnissay\nnokia\nnorton\nnow\nnowruz\nnowtv\nnra\nnrw\nntt\nnyc\nobi\nobserver\noffice\nokinawa\nolayan\nolayangroup\nollo\nomega\none\nong\nonl\nonline\nooo\nopen\noracle\norange\norganic\norigins\nosaka\notsuka\nott\novh\npage\npanasonic\nparis\npars\npartners\nparts\nparty\npay\npccw\npet\npfizer\npharmacy\nphd\nphilips\nphone\nphoto\nphotography\nphotos\nphysio\npics\npictet\npictures\npid\npin\nping\npink\npioneer\npizza\nplace\nplay\nplaystation\nplumbing\nplus\npnc\npohl\npoker\npolitie\nporn\npraxi\npress\nprime\nprod\nproductions\nprof\nprogressive\npromo\nproperties\nproperty\nprotection\npru\nprudential\npub\npwc\nqpon\nquebec\nquest\nracing\nradio\nread\nrealestate\nrealtor\nrealty\nrecipes\nred\nredumbrella\nrehab\nreise\nreisen\nreit\nreliance\nren\nrent\nrentals\nrepair\nreport\nrepublican\nrest\nrestaurant\nreview\nreviews\nrexroth\nrich\nrichardli\nricoh\nril\nrio\nrip\nrocks\nrodeo\nrogers\nroom\nrsvp\nrugby\nruhr\nrun\nrwe\nryukyu\nsaarland\nsafe\nsafety\nsakura\nsale\nsalon\nsamsclub\nsamsung\nsandvik\nsandvikcoromant\nsanofi\nsap\nsarl\nsas\nsave\nsaxo\nsbi\nsbs\nscb\nschaeffler\nschmidt\nscholarships\nschool\nschule\nschwarz\nscience\nscot\nsearch\nseat\nsecure\nsecurity\nseek\nselect\nsener\nservices\nseven\nsew\nsex\nsexy\nsfr\nshangrila\nsharp\nshell\nshia\nshiksha\nshoes\nshop\nshopping\nshouji\nshow\nsilk\nsina\nsingles\nsite\nski\nskin\nsky\nskype\nsling\nsmart\nsmile\nsncf\nsoccer\nsocial\nsoftbank\nsoftware\nsohu\nsolar\nsolutions\nsong\nsony\nsoy\nspa\nspace\nsport\nspot\nsrl\nstada\nstaples\nstar\nstatebank\nstatefarm\nstc\nstcgroup\nstockholm\nstorage\nstore\nstream\nstudio\nstudy\nstyle\nsucks\nsupplies\nsupply\nsupport\nsurf\nsurgery\nsuzuki\nswatch\nswiss\nsydney\nsystems\ntab\ntaipei\ntalk\ntaobao\ntarget\ntatamotors\ntatar\ntattoo\ntax\ntaxi\ntci\ntdk\nteam\ntech\ntechnology\ntemasek\ntennis\nteva\nthd\ntheater\ntheatre\ntiaa\ntickets\ntienda\ntips\ntires\ntirol\ntjmaxx\ntjx\ntkmaxx\ntmall\ntoday\ntokyo\ntools\ntop\ntoray\ntoshiba\ntotal\ntours\ntown\ntoyota\ntoys\ntrade\ntrading\ntraining\ntravel\ntravelers\ntravelersinsurance\ntrust\ntrv\ntube\ntui\ntunes\ntushu\ntvs\nubank\nubs\nunicom\nuniversity\nuno\nuol\nups\nvacations\nvana\nvanguard\nvegas\nventures\nverisign\nversicherung\nvet\nviajes\nvideo\nvig\nviking\nvillas\nvin\nvip\nvirgin\nvisa\nvision\nviva\nvivo\nvlaanderen\nvodka\nvolvo\nvote\nvoting\nvoto\nvoyage\nwales\nwalmart\nwalter\nwang\nwanggou\nwatch\nwatches\nweather\nweatherchannel\nweb\nwebcam\nweber\nwebsite\nwed\nwedding\nweibo\nweir\nwhoswho\nwien\nwiki\nwilliamhill\nwin\nwindows\nwine\nwinners\nwme\nwoodside\nwork\nworks\nworld\nwow\nwtc\nwtf\nxbox\nxerox\nxihuan\nxin\nxn--11b4c3d\nxn--1ck2e1b\nxn--1qqw23a\nxn--30rr7y\nxn--3bst00m\nxn--3ds443g\nxn--3pxu8k\nxn--42c2d9a\nxn--45q11c\nxn--4gbrim\nxn--55qw42g\nxn--55qx5d\nxn--5su34j936bgsg\nxn--5tzm5g\nxn--6frz82g\nxn--6qq986b3xl\nxn--80adxhks\nxn--80aqecdr1a\nxn--80asehdb\nxn--80aswg\nxn--8y0a063a\nxn--9dbq2a\nxn--9et52u\nxn--9krt00a\nxn--b4w605ferd\nxn--bck1b9a5dre4c\nxn--c1avg\nxn--c2br7g\nxn--cck2b3b\nxn--cckwcxetd\nxn--cg4bki\nxn--czr694b\nxn--czrs0t\nxn--czru2d\nxn--d1acj3b\nxn--eckvdtc9d\nxn--efvy88h\nxn--fct429k\nxn--fhbei\nxn--fiq228c5hs\nxn--fiq64b\nxn--fjq720a\nxn--flw351e\nxn--fzys8d69uvgm\nxn--g2xx48c\nxn--gckr3f0f\nxn--gk3at1e\nxn--hxt814e\nxn--i1b6b1a6a2e\nxn--imr513n\nxn--io0a7i\nxn--j1aef\nxn--jlq480n2rg\nxn--jvr189m\nxn--kcrx77d1x4a\nxn--kput3i\nxn--mgba3a3ejt\nxn--mgba7c0bbn0a\nxn--mgbab2bd\nxn--mgbca7dzdo\nxn--mgbi4ecexp\nxn--mgbt3dhd\nxn--mk1bu44c\nxn--mxtq1m\nxn--ngbc5azd\nxn--ngbe9e0a\nxn--ngbrx\nxn--nqv7f\nxn--nqv7fs00ema\nxn--nyqy26a\nxn--otu796d\nxn--p1acf\nxn--pssy2u\nxn--q9jyb4c\nxn--qcka1pmc\nxn--rhqv96g\nxn--rovu88b\nxn--ses554g\nxn--t60b56a\nxn--tckwe\nxn--tiq49xqyj\nxn--unup4y\nxn--vermgensberater-ctb\nxn--vermgensberatung-pwb\nxn--vhquv\nxn--vuq861b\nxn--w4r85el8fhu5dnra\nxn--w4rs40l\nxn--xhq521b\nxn--zfr164b\nxyz\nyachts\nyahoo\nyamaxun\nyandex\nyodobashi\nyoga\nyokohama\nyou\nyoutube\nyun\nzappos\nzara\nzero\nzip\nzone\nzuerich\nco.krd\nedu.krd\nart.pl\ngliwice.pl\nkrakow.pl\npoznan.pl\nwroc.pl\nzakopane.pl\ncc.ua\ninf.ua\nltd.ua\n611.to\na2hosted.com\ncpserver.com\nactivetrail.biz\nmyaddr.dev\nmyaddr.io\ndyn.addr.tools\nmyaddr.tools\nadobeaemcloud.com\n*.dev.adobeaemcloud.com\naem.live\nhlx.live\nadobeaemcloud.net\naem.network\naem.page\nhlx.page\naem.reviews\nadobeio-static.net\nadobeioruntime.net\nafrica.com\n*.auiusercontent.com\nbeep.pl\naiven.app\n*.aivencloud.com\nakadns.net\nakamai.net\nakamai-staging.net\nakamaiedge.net\nakamaiedge-staging.net\nakamaihd.net\nakamaihd-staging.net\nakamaiorigin.net\nakamaiorigin-staging.net\nakamaized.net\nakamaized-staging.net\nedgekey.net\nedgekey-staging.net\nedgesuite.net\nedgesuite-staging.net\nbarsy.ca\n*.compute.estate\n*.alces.network\nalibabacloudcs.com\nms.fun\nms.show\nkasserver.com\naltervista.org\nalwaysdata.net\nmyamaze.net\nexecute-api.cn-north-1.amazonaws.com.cn\nexecute-api.cn-northwest-1.amazonaws.com.cn\nexecute-api.af-south-1.amazonaws.com\nexecute-api.ap-east-1.amazonaws.com\nexecute-api.ap-northeast-1.amazonaws.com\nexecute-api.ap-northeast-2.amazonaws.com\nexecute-api.ap-northeast-3.amazonaws.com\nexecute-api.ap-south-1.amazonaws.com\nexecute-api.ap-south-2.amazonaws.com\nexecute-api.ap-southeast-1.amazonaws.com\nexecute-api.ap-southeast-2.amazonaws.com\nexecute-api.ap-southeast-3.amazonaws.com\nexecute-api.ap-southeast-4.amazonaws.com\nexecute-api.ap-southeast-5.amazonaws.com\nexecute-api.ca-central-1.amazonaws.com\nexecute-api.ca-west-1.amazonaws.com\nexecute-api.eu-central-1.amazonaws.com\nexecute-api.eu-central-2.amazonaws.com\nexecute-api.eu-north-1.amazonaws.com\nexecute-api.eu-south-1.amazonaws.com\nexecute-api.eu-south-2.amazonaws.com\nexecute-api.eu-west-1.amazonaws.com\nexecute-api.eu-west-2.amazonaws.com\nexecute-api.eu-west-3.amazonaws.com\nexecute-api.il-central-1.amazonaws.com\nexecute-api.me-central-1.amazonaws.com\nexecute-api.me-south-1.amazonaws.com\nexecute-api.sa-east-1.amazonaws.com\nexecute-api.us-east-1.amazonaws.com\nexecute-api.us-east-2.amazonaws.com\nexecute-api.us-gov-east-1.amazonaws.com\nexecute-api.us-gov-west-1.amazonaws.com\nexecute-api.us-west-1.amazonaws.com\nexecute-api.us-west-2.amazonaws.com\ncloudfront.net\nauth.af-south-1.amazoncognito.com\nauth.ap-east-1.amazoncognito.com\nauth.ap-northeast-1.amazoncognito.com\nauth.ap-northeast-2.amazoncognito.com\nauth.ap-northeast-3.amazoncognito.com\nauth.ap-south-1.amazoncognito.com\nauth.ap-south-2.amazoncognito.com\nauth.ap-southeast-1.amazoncognito.com\nauth.ap-southeast-2.amazoncognito.com\nauth.ap-southeast-3.amazoncognito.com\nauth.ap-southeast-4.amazoncognito.com\nauth.ap-southeast-5.amazoncognito.com\nauth.ap-southeast-7.amazoncognito.com\nauth.ca-central-1.amazoncognito.com\nauth.ca-west-1.amazoncognito.com\nauth.eu-central-1.amazoncognito.com\nauth.eu-central-2.amazoncognito.com\nauth.eu-north-1.amazoncognito.com\nauth.eu-south-1.amazoncognito.com\nauth.eu-south-2.amazoncognito.com\nauth.eu-west-1.amazoncognito.com\nauth.eu-west-2.amazoncognito.com\nauth.eu-west-3.amazoncognito.com\nauth.il-central-1.amazoncognito.com\nauth.me-central-1.amazoncognito.com\nauth.me-south-1.amazoncognito.com\nauth.mx-central-1.amazoncognito.com\nauth.sa-east-1.amazoncognito.com\nauth.us-east-1.amazoncognito.com\nauth-fips.us-east-1.amazoncognito.com\nauth.us-east-2.amazoncognito.com\nauth-fips.us-east-2.amazoncognito.com\nauth-fips.us-gov-east-1.amazoncognito.com\nauth-fips.us-gov-west-1.amazoncognito.com\nauth.us-west-1.amazoncognito.com\nauth-fips.us-west-1.amazoncognito.com\nauth.us-west-2.amazoncognito.com\nauth-fips.us-west-2.amazoncognito.com\nauth.cognito-idp.eusc-de-east-1.on.amazonwebservices.eu\n*.compute.amazonaws.com.cn\n*.compute.amazonaws.com\n*.compute-1.amazonaws.com\nus-east-1.amazonaws.com\nemrappui-prod.cn-north-1.amazonaws.com.cn\nemrnotebooks-prod.cn-north-1.amazonaws.com.cn\nemrstudio-prod.cn-north-1.amazonaws.com.cn\nemrappui-prod.cn-northwest-1.amazonaws.com.cn\nemrnotebooks-prod.cn-northwest-1.amazonaws.com.cn\nemrstudio-prod.cn-northwest-1.amazonaws.com.cn\nemrappui-prod.af-south-1.amazonaws.com\nemrnotebooks-prod.af-south-1.amazonaws.com\nemrstudio-prod.af-south-1.amazonaws.com\nemrappui-prod.ap-east-1.amazonaws.com\nemrnotebooks-prod.ap-east-1.amazonaws.com\nemrstudio-prod.ap-east-1.amazonaws.com\nemrappui-prod.ap-northeast-1.amazonaws.com\nemrnotebooks-prod.ap-northeast-1.amazonaws.com\nemrstudio-prod.ap-northeast-1.amazonaws.com\nemrappui-prod.ap-northeast-2.amazonaws.com\nemrnotebooks-prod.ap-northeast-2.amazonaws.com\nemrstudio-prod.ap-northeast-2.amazonaws.com\nemrappui-prod.ap-northeast-3.amazonaws.com\nemrnotebooks-prod.ap-northeast-3.amazonaws.com\nemrstudio-prod.ap-northeast-3.amazonaws.com\nemrappui-prod.ap-south-1.amazonaws.com\nemrnotebooks-prod.ap-south-1.amazonaws.com\nemrstudio-prod.ap-south-1.amazonaws.com\nemrappui-prod.ap-south-2.amazonaws.com\nemrnotebooks-prod.ap-south-2.amazonaws.com\nemrstudio-prod.ap-south-2.amazonaws.com\nemrappui-prod.ap-southeast-1.amazonaws.com\nemrnotebooks-prod.ap-southeast-1.amazonaws.com\nemrstudio-prod.ap-southeast-1.amazonaws.com\nemrappui-prod.ap-southeast-2.amazonaws.com\nemrnotebooks-prod.ap-southeast-2.amazonaws.com\nemrstudio-prod.ap-southeast-2.amazonaws.com\nemrappui-prod.ap-southeast-3.amazonaws.com\nemrnotebooks-prod.ap-southeast-3.amazonaws.com\nemrstudio-prod.ap-southeast-3.amazonaws.com\nemrappui-prod.ap-southeast-4.amazonaws.com\nemrnotebooks-prod.ap-southeast-4.amazonaws.com\nemrstudio-prod.ap-southeast-4.amazonaws.com\nemrappui-prod.ca-central-1.amazonaws.com\nemrnotebooks-prod.ca-central-1.amazonaws.com\nemrstudio-prod.ca-central-1.amazonaws.com\nemrappui-prod.ca-west-1.amazonaws.com\nemrnotebooks-prod.ca-west-1.amazonaws.com\nemrstudio-prod.ca-west-1.amazonaws.com\nemrappui-prod.eu-central-1.amazonaws.com\nemrnotebooks-prod.eu-central-1.amazonaws.com\nemrstudio-prod.eu-central-1.amazonaws.com\nemrappui-prod.eu-central-2.amazonaws.com\nemrnotebooks-prod.eu-central-2.amazonaws.com\nemrstudio-prod.eu-central-2.amazonaws.com\nemrappui-prod.eu-north-1.amazonaws.com\nemrnotebooks-prod.eu-north-1.amazonaws.com\nemrstudio-prod.eu-north-1.amazonaws.com\nemrappui-prod.eu-south-1.amazonaws.com\nemrnotebooks-prod.eu-south-1.amazonaws.com\nemrstudio-prod.eu-south-1.amazonaws.com\nemrappui-prod.eu-south-2.amazonaws.com\nemrnotebooks-prod.eu-south-2.amazonaws.com\nemrstudio-prod.eu-south-2.amazonaws.com\nemrappui-prod.eu-west-1.amazonaws.com\nemrnotebooks-prod.eu-west-1.amazonaws.com\nemrstudio-prod.eu-west-1.amazonaws.com\nemrappui-prod.eu-west-2.amazonaws.com\nemrnotebooks-prod.eu-west-2.amazonaws.com\nemrstudio-prod.eu-west-2.amazonaws.com\nemrappui-prod.eu-west-3.amazonaws.com\nemrnotebooks-prod.eu-west-3.amazonaws.com\nemrstudio-prod.eu-west-3.amazonaws.com\nemrappui-prod.il-central-1.amazonaws.com\nemrnotebooks-prod.il-central-1.amazonaws.com\nemrstudio-prod.il-central-1.amazonaws.com\nemrappui-prod.me-central-1.amazonaws.com\nemrnotebooks-prod.me-central-1.amazonaws.com\nemrstudio-prod.me-central-1.amazonaws.com\nemrappui-prod.me-south-1.amazonaws.com\nemrnotebooks-prod.me-south-1.amazonaws.com\nemrstudio-prod.me-south-1.amazonaws.com\nemrappui-prod.sa-east-1.amazonaws.com\nemrnotebooks-prod.sa-east-1.amazonaws.com\nemrstudio-prod.sa-east-1.amazonaws.com\nemrappui-prod.us-east-1.amazonaws.com\nemrnotebooks-prod.us-east-1.amazonaws.com\nemrstudio-prod.us-east-1.amazonaws.com\nemrappui-prod.us-east-2.amazonaws.com\nemrnotebooks-prod.us-east-2.amazonaws.com\nemrstudio-prod.us-east-2.amazonaws.com\nemrappui-prod.us-gov-east-1.amazonaws.com\nemrnotebooks-prod.us-gov-east-1.amazonaws.com\nemrstudio-prod.us-gov-east-1.amazonaws.com\nemrappui-prod.us-gov-west-1.amazonaws.com\nemrnotebooks-prod.us-gov-west-1.amazonaws.com\nemrstudio-prod.us-gov-west-1.amazonaws.com\nemrappui-prod.us-west-1.amazonaws.com\nemrnotebooks-prod.us-west-1.amazonaws.com\nemrstudio-prod.us-west-1.amazonaws.com\nemrappui-prod.us-west-2.amazonaws.com\nemrnotebooks-prod.us-west-2.amazonaws.com\nemrstudio-prod.us-west-2.amazonaws.com\n*.airflow.af-south-1.on.aws\n*.airflow.ap-east-1.on.aws\n*.airflow.ap-northeast-1.on.aws\n*.airflow.ap-northeast-2.on.aws\n*.airflow.ap-northeast-3.on.aws\n*.airflow.ap-south-1.on.aws\n*.airflow.ap-south-2.on.aws\n*.airflow.ap-southeast-1.on.aws\n*.airflow.ap-southeast-2.on.aws\n*.airflow.ap-southeast-3.on.aws\n*.airflow.ap-southeast-4.on.aws\n*.airflow.ap-southeast-5.on.aws\n*.airflow.ca-central-1.on.aws\n*.airflow.ca-west-1.on.aws\n*.airflow.eu-central-1.on.aws\n*.airflow.eu-central-2.on.aws\n*.airflow.eu-north-1.on.aws\n*.airflow.eu-south-1.on.aws\n*.airflow.eu-south-2.on.aws\n*.airflow.eu-west-1.on.aws\n*.airflow.eu-west-2.on.aws\n*.airflow.eu-west-3.on.aws\n*.airflow.il-central-1.on.aws\n*.airflow.me-central-1.on.aws\n*.airflow.me-south-1.on.aws\n*.airflow.sa-east-1.on.aws\n*.airflow.us-east-1.on.aws\n*.airflow.us-east-2.on.aws\n*.airflow.us-west-1.on.aws\n*.airflow.us-west-2.on.aws\n*.cn-north-1.airflow.amazonaws.com.cn\n*.cn-northwest-1.airflow.amazonaws.com.cn\n*.airflow.cn-north-1.on.amazonwebservices.com.cn\n*.airflow.cn-northwest-1.on.amazonwebservices.com.cn\n*.af-south-1.airflow.amazonaws.com\n*.ap-east-1.airflow.amazonaws.com\n*.ap-northeast-1.airflow.amazonaws.com\n*.ap-northeast-2.airflow.amazonaws.com\n*.ap-northeast-3.airflow.amazonaws.com\n*.ap-south-1.airflow.amazonaws.com\n*.ap-south-2.airflow.amazonaws.com\n*.ap-southeast-1.airflow.amazonaws.com\n*.ap-southeast-2.airflow.amazonaws.com\n*.ap-southeast-3.airflow.amazonaws.com\n*.ap-southeast-4.airflow.amazonaws.com\n*.ap-southeast-5.airflow.amazonaws.com\n*.ap-southeast-7.airflow.amazonaws.com\n*.ca-central-1.airflow.amazonaws.com\n*.ca-west-1.airflow.amazonaws.com\n*.eu-central-1.airflow.amazonaws.com\n*.eu-central-2.airflow.amazonaws.com\n*.eu-north-1.airflow.amazonaws.com\n*.eu-south-1.airflow.amazonaws.com\n*.eu-south-2.airflow.amazonaws.com\n*.eu-west-1.airflow.amazonaws.com\n*.eu-west-2.airflow.amazonaws.com\n*.eu-west-3.airflow.amazonaws.com\n*.il-central-1.airflow.amazonaws.com\n*.me-central-1.airflow.amazonaws.com\n*.me-south-1.airflow.amazonaws.com\n*.sa-east-1.airflow.amazonaws.com\n*.us-east-1.airflow.amazonaws.com\n*.us-east-2.airflow.amazonaws.com\n*.us-west-1.airflow.amazonaws.com\n*.us-west-2.airflow.amazonaws.com\n*.rds.cn-north-1.amazonaws.com.cn\n*.rds.cn-northwest-1.amazonaws.com.cn\n*.af-south-1.rds.amazonaws.com\n*.ap-east-1.rds.amazonaws.com\n*.ap-east-2.rds.amazonaws.com\n*.ap-northeast-1.rds.amazonaws.com\n*.ap-northeast-2.rds.amazonaws.com\n*.ap-northeast-3.rds.amazonaws.com\n*.ap-south-1.rds.amazonaws.com\n*.ap-south-2.rds.amazonaws.com\n*.ap-southeast-1.rds.amazonaws.com\n*.ap-southeast-2.rds.amazonaws.com\n*.ap-southeast-3.rds.amazonaws.com\n*.ap-southeast-4.rds.amazonaws.com\n*.ap-southeast-5.rds.amazonaws.com\n*.ap-southeast-6.rds.amazonaws.com\n*.ap-southeast-7.rds.amazonaws.com\n*.ca-central-1.rds.amazonaws.com\n*.ca-west-1.rds.amazonaws.com\n*.eu-central-1.rds.amazonaws.com\n*.eu-central-2.rds.amazonaws.com\n*.eu-west-1.rds.amazonaws.com\n*.eu-west-2.rds.amazonaws.com\n*.eu-west-3.rds.amazonaws.com\n*.il-central-1.rds.amazonaws.com\n*.me-central-1.rds.amazonaws.com\n*.me-south-1.rds.amazonaws.com\n*.mx-central-1.rds.amazonaws.com\n*.sa-east-1.rds.amazonaws.com\n*.us-east-1.rds.amazonaws.com\n*.us-east-2.rds.amazonaws.com\n*.us-gov-east-1.rds.amazonaws.com\n*.us-gov-west-1.rds.amazonaws.com\n*.us-northeast-1.rds.amazonaws.com\n*.us-west-1.rds.amazonaws.com\n*.us-west-2.rds.amazonaws.com\ns3.dualstack.cn-north-1.amazonaws.com.cn\ns3-accesspoint.dualstack.cn-north-1.amazonaws.com.cn\ns3-website.dualstack.cn-north-1.amazonaws.com.cn\ns3.cn-north-1.amazonaws.com.cn\ns3-accesspoint.cn-north-1.amazonaws.com.cn\ns3-deprecated.cn-north-1.amazonaws.com.cn\ns3-object-lambda.cn-north-1.amazonaws.com.cn\ns3-website.cn-north-1.amazonaws.com.cn\ns3.dualstack.cn-northwest-1.amazonaws.com.cn\ns3-accesspoint.dualstack.cn-northwest-1.amazonaws.com.cn\ns3.cn-northwest-1.amazonaws.com.cn\ns3-accesspoint.cn-northwest-1.amazonaws.com.cn\ns3-object-lambda.cn-northwest-1.amazonaws.com.cn\ns3-website.cn-northwest-1.amazonaws.com.cn\ns3.dualstack.af-south-1.amazonaws.com\ns3-accesspoint.dualstack.af-south-1.amazonaws.com\ns3-website.dualstack.af-south-1.amazonaws.com\ns3.af-south-1.amazonaws.com\ns3-accesspoint.af-south-1.amazonaws.com\ns3-object-lambda.af-south-1.amazonaws.com\ns3-website.af-south-1.amazonaws.com\ns3.dualstack.ap-east-1.amazonaws.com\ns3-accesspoint.dualstack.ap-east-1.amazonaws.com\ns3.ap-east-1.amazonaws.com\ns3-accesspoint.ap-east-1.amazonaws.com\ns3-object-lambda.ap-east-1.amazonaws.com\ns3-website.ap-east-1.amazonaws.com\ns3.dualstack.ap-northeast-1.amazonaws.com\ns3-accesspoint.dualstack.ap-northeast-1.amazonaws.com\ns3-website.dualstack.ap-northeast-1.amazonaws.com\ns3.ap-northeast-1.amazonaws.com\ns3-accesspoint.ap-northeast-1.amazonaws.com\ns3-object-lambda.ap-northeast-1.amazonaws.com\ns3-website.ap-northeast-1.amazonaws.com\ns3.dualstack.ap-northeast-2.amazonaws.com\ns3-accesspoint.dualstack.ap-northeast-2.amazonaws.com\ns3-website.dualstack.ap-northeast-2.amazonaws.com\ns3.ap-northeast-2.amazonaws.com\ns3-accesspoint.ap-northeast-2.amazonaws.com\ns3-object-lambda.ap-northeast-2.amazonaws.com\ns3-website.ap-northeast-2.amazonaws.com\ns3.dualstack.ap-northeast-3.amazonaws.com\ns3-accesspoint.dualstack.ap-northeast-3.amazonaws.com\ns3-website.dualstack.ap-northeast-3.amazonaws.com\ns3.ap-northeast-3.amazonaws.com\ns3-accesspoint.ap-northeast-3.amazonaws.com\ns3-object-lambda.ap-northeast-3.amazonaws.com\ns3-website.ap-northeast-3.amazonaws.com\ns3.dualstack.ap-south-1.amazonaws.com\ns3-accesspoint.dualstack.ap-south-1.amazonaws.com\ns3-website.dualstack.ap-south-1.amazonaws.com\ns3.ap-south-1.amazonaws.com\ns3-accesspoint.ap-south-1.amazonaws.com\ns3-object-lambda.ap-south-1.amazonaws.com\ns3-website.ap-south-1.amazonaws.com\ns3.dualstack.ap-south-2.amazonaws.com\ns3-accesspoint.dualstack.ap-south-2.amazonaws.com\ns3-website.dualstack.ap-south-2.amazonaws.com\ns3.ap-south-2.amazonaws.com\ns3-accesspoint.ap-south-2.amazonaws.com\ns3-object-lambda.ap-south-2.amazonaws.com\ns3-website.ap-south-2.amazonaws.com\ns3.dualstack.ap-southeast-1.amazonaws.com\ns3-accesspoint.dualstack.ap-southeast-1.amazonaws.com\ns3-website.dualstack.ap-southeast-1.amazonaws.com\ns3.ap-southeast-1.amazonaws.com\ns3-accesspoint.ap-southeast-1.amazonaws.com\ns3-object-lambda.ap-southeast-1.amazonaws.com\ns3-website.ap-southeast-1.amazonaws.com\ns3.dualstack.ap-southeast-2.amazonaws.com\ns3-accesspoint.dualstack.ap-southeast-2.amazonaws.com\ns3-website.dualstack.ap-southeast-2.amazonaws.com\ns3.ap-southeast-2.amazonaws.com\ns3-accesspoint.ap-southeast-2.amazonaws.com\ns3-object-lambda.ap-southeast-2.amazonaws.com\ns3-website.ap-southeast-2.amazonaws.com\ns3.dualstack.ap-southeast-3.amazonaws.com\ns3-accesspoint.dualstack.ap-southeast-3.amazonaws.com\ns3-website.dualstack.ap-southeast-3.amazonaws.com\ns3.ap-southeast-3.amazonaws.com\ns3-accesspoint.ap-southeast-3.amazonaws.com\ns3-object-lambda.ap-southeast-3.amazonaws.com\ns3-website.ap-southeast-3.amazonaws.com\ns3.dualstack.ap-southeast-4.amazonaws.com\ns3-accesspoint.dualstack.ap-southeast-4.amazonaws.com\ns3-website.dualstack.ap-southeast-4.amazonaws.com\ns3.ap-southeast-4.amazonaws.com\ns3-accesspoint.ap-southeast-4.amazonaws.com\ns3-object-lambda.ap-southeast-4.amazonaws.com\ns3-website.ap-southeast-4.amazonaws.com\ns3.dualstack.ap-southeast-5.amazonaws.com\ns3-accesspoint.dualstack.ap-southeast-5.amazonaws.com\ns3-website.dualstack.ap-southeast-5.amazonaws.com\ns3.ap-southeast-5.amazonaws.com\ns3-accesspoint.ap-southeast-5.amazonaws.com\ns3-deprecated.ap-southeast-5.amazonaws.com\ns3-object-lambda.ap-southeast-5.amazonaws.com\ns3-website.ap-southeast-5.amazonaws.com\ns3.dualstack.ca-central-1.amazonaws.com\ns3-accesspoint.dualstack.ca-central-1.amazonaws.com\ns3-accesspoint-fips.dualstack.ca-central-1.amazonaws.com\ns3-fips.dualstack.ca-central-1.amazonaws.com\ns3-website.dualstack.ca-central-1.amazonaws.com\ns3.ca-central-1.amazonaws.com\ns3-accesspoint.ca-central-1.amazonaws.com\ns3-accesspoint-fips.ca-central-1.amazonaws.com\ns3-fips.ca-central-1.amazonaws.com\ns3-object-lambda.ca-central-1.amazonaws.com\ns3-website.ca-central-1.amazonaws.com\ns3.dualstack.ca-west-1.amazonaws.com\ns3-accesspoint.dualstack.ca-west-1.amazonaws.com\ns3-accesspoint-fips.dualstack.ca-west-1.amazonaws.com\ns3-fips.dualstack.ca-west-1.amazonaws.com\ns3-website.dualstack.ca-west-1.amazonaws.com\ns3.ca-west-1.amazonaws.com\ns3-accesspoint.ca-west-1.amazonaws.com\ns3-accesspoint-fips.ca-west-1.amazonaws.com\ns3-fips.ca-west-1.amazonaws.com\ns3-object-lambda.ca-west-1.amazonaws.com\ns3-website.ca-west-1.amazonaws.com\ns3.dualstack.eu-central-1.amazonaws.com\ns3-accesspoint.dualstack.eu-central-1.amazonaws.com\ns3-website.dualstack.eu-central-1.amazonaws.com\ns3.eu-central-1.amazonaws.com\ns3-accesspoint.eu-central-1.amazonaws.com\ns3-object-lambda.eu-central-1.amazonaws.com\ns3-website.eu-central-1.amazonaws.com\ns3.dualstack.eu-central-2.amazonaws.com\ns3-accesspoint.dualstack.eu-central-2.amazonaws.com\ns3-website.dualstack.eu-central-2.amazonaws.com\ns3.eu-central-2.amazonaws.com\ns3-accesspoint.eu-central-2.amazonaws.com\ns3-object-lambda.eu-central-2.amazonaws.com\ns3-website.eu-central-2.amazonaws.com\ns3.dualstack.eu-north-1.amazonaws.com\ns3-accesspoint.dualstack.eu-north-1.amazonaws.com\ns3.eu-north-1.amazonaws.com\ns3-accesspoint.eu-north-1.amazonaws.com\ns3-object-lambda.eu-north-1.amazonaws.com\ns3-website.eu-north-1.amazonaws.com\ns3.dualstack.eu-south-1.amazonaws.com\ns3-accesspoint.dualstack.eu-south-1.amazonaws.com\ns3-website.dualstack.eu-south-1.amazonaws.com\ns3.eu-south-1.amazonaws.com\ns3-accesspoint.eu-south-1.amazonaws.com\ns3-object-lambda.eu-south-1.amazonaws.com\ns3-website.eu-south-1.amazonaws.com\ns3.dualstack.eu-south-2.amazonaws.com\ns3-accesspoint.dualstack.eu-south-2.amazonaws.com\ns3-website.dualstack.eu-south-2.amazonaws.com\ns3.eu-south-2.amazonaws.com\ns3-accesspoint.eu-south-2.amazonaws.com\ns3-object-lambda.eu-south-2.amazonaws.com\ns3-website.eu-south-2.amazonaws.com\ns3.dualstack.eu-west-1.amazonaws.com\ns3-accesspoint.dualstack.eu-west-1.amazonaws.com\ns3-website.dualstack.eu-west-1.amazonaws.com\ns3.eu-west-1.amazonaws.com\ns3-accesspoint.eu-west-1.amazonaws.com\ns3-deprecated.eu-west-1.amazonaws.com\ns3-object-lambda.eu-west-1.amazonaws.com\ns3-website.eu-west-1.amazonaws.com\ns3.dualstack.eu-west-2.amazonaws.com\ns3-accesspoint.dualstack.eu-west-2.amazonaws.com\ns3.eu-west-2.amazonaws.com\ns3-accesspoint.eu-west-2.amazonaws.com\ns3-object-lambda.eu-west-2.amazonaws.com\ns3-website.eu-west-2.amazonaws.com\ns3.dualstack.eu-west-3.amazonaws.com\ns3-accesspoint.dualstack.eu-west-3.amazonaws.com\ns3-website.dualstack.eu-west-3.amazonaws.com\ns3.eu-west-3.amazonaws.com\ns3-accesspoint.eu-west-3.amazonaws.com\ns3-object-lambda.eu-west-3.amazonaws.com\ns3-website.eu-west-3.amazonaws.com\ns3.dualstack.il-central-1.amazonaws.com\ns3-accesspoint.dualstack.il-central-1.amazonaws.com\ns3-website.dualstack.il-central-1.amazonaws.com\ns3.il-central-1.amazonaws.com\ns3-accesspoint.il-central-1.amazonaws.com\ns3-object-lambda.il-central-1.amazonaws.com\ns3-website.il-central-1.amazonaws.com\ns3.dualstack.me-central-1.amazonaws.com\ns3-accesspoint.dualstack.me-central-1.amazonaws.com\ns3-website.dualstack.me-central-1.amazonaws.com\ns3.me-central-1.amazonaws.com\ns3-accesspoint.me-central-1.amazonaws.com\ns3-object-lambda.me-central-1.amazonaws.com\ns3-website.me-central-1.amazonaws.com\ns3.dualstack.me-south-1.amazonaws.com\ns3-accesspoint.dualstack.me-south-1.amazonaws.com\ns3.me-south-1.amazonaws.com\ns3-accesspoint.me-south-1.amazonaws.com\ns3-object-lambda.me-south-1.amazonaws.com\ns3-website.me-south-1.amazonaws.com\ns3.amazonaws.com\ns3-1.amazonaws.com\ns3-ap-east-1.amazonaws.com\ns3-ap-northeast-1.amazonaws.com\ns3-ap-northeast-2.amazonaws.com\ns3-ap-northeast-3.amazonaws.com\ns3-ap-south-1.amazonaws.com\ns3-ap-southeast-1.amazonaws.com\ns3-ap-southeast-2.amazonaws.com\ns3-ca-central-1.amazonaws.com\ns3-eu-central-1.amazonaws.com\ns3-eu-north-1.amazonaws.com\ns3-eu-west-1.amazonaws.com\ns3-eu-west-2.amazonaws.com\ns3-eu-west-3.amazonaws.com\ns3-external-1.amazonaws.com\ns3-fips-us-gov-east-1.amazonaws.com\ns3-fips-us-gov-west-1.amazonaws.com\nmrap.accesspoint.s3-global.amazonaws.com\ns3-me-south-1.amazonaws.com\ns3-sa-east-1.amazonaws.com\ns3-us-east-2.amazonaws.com\ns3-us-gov-east-1.amazonaws.com\ns3-us-gov-west-1.amazonaws.com\ns3-us-west-1.amazonaws.com\ns3-us-west-2.amazonaws.com\ns3-website-ap-northeast-1.amazonaws.com\ns3-website-ap-southeast-1.amazonaws.com\ns3-website-ap-southeast-2.amazonaws.com\ns3-website-eu-west-1.amazonaws.com\ns3-website-sa-east-1.amazonaws.com\ns3-website-us-east-1.amazonaws.com\ns3-website-us-gov-west-1.amazonaws.com\ns3-website-us-west-1.amazonaws.com\ns3-website-us-west-2.amazonaws.com\ns3.dualstack.sa-east-1.amazonaws.com\ns3-accesspoint.dualstack.sa-east-1.amazonaws.com\ns3-website.dualstack.sa-east-1.amazonaws.com\ns3.sa-east-1.amazonaws.com\ns3-accesspoint.sa-east-1.amazonaws.com\ns3-object-lambda.sa-east-1.amazonaws.com\ns3-website.sa-east-1.amazonaws.com\ns3.dualstack.us-east-1.amazonaws.com\ns3-accesspoint.dualstack.us-east-1.amazonaws.com\ns3-accesspoint-fips.dualstack.us-east-1.amazonaws.com\ns3-fips.dualstack.us-east-1.amazonaws.com\ns3-website.dualstack.us-east-1.amazonaws.com\ns3.us-east-1.amazonaws.com\ns3-accesspoint.us-east-1.amazonaws.com\ns3-accesspoint-fips.us-east-1.amazonaws.com\ns3-deprecated.us-east-1.amazonaws.com\ns3-fips.us-east-1.amazonaws.com\ns3-object-lambda.us-east-1.amazonaws.com\ns3-website.us-east-1.amazonaws.com\ns3.dualstack.us-east-2.amazonaws.com\ns3-accesspoint.dualstack.us-east-2.amazonaws.com\ns3-accesspoint-fips.dualstack.us-east-2.amazonaws.com\ns3-fips.dualstack.us-east-2.amazonaws.com\ns3-website.dualstack.us-east-2.amazonaws.com\ns3.us-east-2.amazonaws.com\ns3-accesspoint.us-east-2.amazonaws.com\ns3-accesspoint-fips.us-east-2.amazonaws.com\ns3-deprecated.us-east-2.amazonaws.com\ns3-fips.us-east-2.amazonaws.com\ns3-object-lambda.us-east-2.amazonaws.com\ns3-website.us-east-2.amazonaws.com\ns3.dualstack.us-gov-east-1.amazonaws.com\ns3-accesspoint.dualstack.us-gov-east-1.amazonaws.com\ns3-accesspoint-fips.dualstack.us-gov-east-1.amazonaws.com\ns3-fips.dualstack.us-gov-east-1.amazonaws.com\ns3-website.dualstack.us-gov-east-1.amazonaws.com\ns3.us-gov-east-1.amazonaws.com\ns3-accesspoint.us-gov-east-1.amazonaws.com\ns3-accesspoint-fips.us-gov-east-1.amazonaws.com\ns3-fips.us-gov-east-1.amazonaws.com\ns3-object-lambda.us-gov-east-1.amazonaws.com\ns3-website.us-gov-east-1.amazonaws.com\ns3.dualstack.us-gov-west-1.amazonaws.com\ns3-accesspoint.dualstack.us-gov-west-1.amazonaws.com\ns3-accesspoint-fips.dualstack.us-gov-west-1.amazonaws.com\ns3-fips.dualstack.us-gov-west-1.amazonaws.com\ns3-website.dualstack.us-gov-west-1.amazonaws.com\ns3.us-gov-west-1.amazonaws.com\ns3-accesspoint.us-gov-west-1.amazonaws.com\ns3-accesspoint-fips.us-gov-west-1.amazonaws.com\ns3-fips.us-gov-west-1.amazonaws.com\ns3-object-lambda.us-gov-west-1.amazonaws.com\ns3-website.us-gov-west-1.amazonaws.com\ns3.dualstack.us-west-1.amazonaws.com\ns3-accesspoint.dualstack.us-west-1.amazonaws.com\ns3-accesspoint-fips.dualstack.us-west-1.amazonaws.com\ns3-fips.dualstack.us-west-1.amazonaws.com\ns3-website.dualstack.us-west-1.amazonaws.com\ns3.us-west-1.amazonaws.com\ns3-accesspoint.us-west-1.amazonaws.com\ns3-accesspoint-fips.us-west-1.amazonaws.com\ns3-fips.us-west-1.amazonaws.com\ns3-object-lambda.us-west-1.amazonaws.com\ns3-website.us-west-1.amazonaws.com\ns3.dualstack.us-west-2.amazonaws.com\ns3-accesspoint.dualstack.us-west-2.amazonaws.com\ns3-accesspoint-fips.dualstack.us-west-2.amazonaws.com\ns3-fips.dualstack.us-west-2.amazonaws.com\ns3-website.dualstack.us-west-2.amazonaws.com\ns3.us-west-2.amazonaws.com\ns3-accesspoint.us-west-2.amazonaws.com\ns3-accesspoint-fips.us-west-2.amazonaws.com\ns3-deprecated.us-west-2.amazonaws.com\ns3-fips.us-west-2.amazonaws.com\ns3-object-lambda.us-west-2.amazonaws.com\ns3-website.us-west-2.amazonaws.com\nlabeling.ap-northeast-1.sagemaker.aws\nlabeling.ap-northeast-2.sagemaker.aws\nlabeling.ap-south-1.sagemaker.aws\nlabeling.ap-southeast-1.sagemaker.aws\nlabeling.ap-southeast-2.sagemaker.aws\nlabeling.ca-central-1.sagemaker.aws\nlabeling.eu-central-1.sagemaker.aws\nlabeling.eu-west-1.sagemaker.aws\nlabeling.eu-west-2.sagemaker.aws\nlabeling.us-east-1.sagemaker.aws\nlabeling.us-east-2.sagemaker.aws\nlabeling.us-west-2.sagemaker.aws\nnotebook.af-south-1.sagemaker.aws\nnotebook.ap-east-1.sagemaker.aws\nnotebook.ap-northeast-1.sagemaker.aws\nnotebook.ap-northeast-2.sagemaker.aws\nnotebook.ap-northeast-3.sagemaker.aws\nnotebook.ap-south-1.sagemaker.aws\nnotebook.ap-south-2.sagemaker.aws\nnotebook.ap-southeast-1.sagemaker.aws\nnotebook.ap-southeast-2.sagemaker.aws\nnotebook.ap-southeast-3.sagemaker.aws\nnotebook.ap-southeast-4.sagemaker.aws\nnotebook.ca-central-1.sagemaker.aws\nnotebook-fips.ca-central-1.sagemaker.aws\nnotebook.ca-west-1.sagemaker.aws\nnotebook-fips.ca-west-1.sagemaker.aws\nnotebook.eu-central-1.sagemaker.aws\nnotebook.eu-central-2.sagemaker.aws\nnotebook.eu-north-1.sagemaker.aws\nnotebook.eu-south-1.sagemaker.aws\nnotebook.eu-south-2.sagemaker.aws\nnotebook.eu-west-1.sagemaker.aws\nnotebook.eu-west-2.sagemaker.aws\nnotebook.eu-west-3.sagemaker.aws\nnotebook.il-central-1.sagemaker.aws\nnotebook.me-central-1.sagemaker.aws\nnotebook.me-south-1.sagemaker.aws\nnotebook.sa-east-1.sagemaker.aws\nnotebook.us-east-1.sagemaker.aws\nnotebook-fips.us-east-1.sagemaker.aws\nnotebook.us-east-2.sagemaker.aws\nnotebook-fips.us-east-2.sagemaker.aws\nnotebook.us-gov-east-1.sagemaker.aws\nnotebook-fips.us-gov-east-1.sagemaker.aws\nnotebook.us-gov-west-1.sagemaker.aws\nnotebook-fips.us-gov-west-1.sagemaker.aws\nnotebook.us-west-1.sagemaker.aws\nnotebook-fips.us-west-1.sagemaker.aws\nnotebook.us-west-2.sagemaker.aws\nnotebook-fips.us-west-2.sagemaker.aws\nnotebook.cn-north-1.sagemaker.com.cn\nnotebook.cn-northwest-1.sagemaker.com.cn\nstudio.af-south-1.sagemaker.aws\nstudio.ap-east-1.sagemaker.aws\nstudio.ap-northeast-1.sagemaker.aws\nstudio.ap-northeast-2.sagemaker.aws\nstudio.ap-northeast-3.sagemaker.aws\nstudio.ap-south-1.sagemaker.aws\nstudio.ap-southeast-1.sagemaker.aws\nstudio.ap-southeast-2.sagemaker.aws\nstudio.ap-southeast-3.sagemaker.aws\nstudio.ca-central-1.sagemaker.aws\nstudio.eu-central-1.sagemaker.aws\nstudio.eu-central-2.sagemaker.aws\nstudio.eu-north-1.sagemaker.aws\nstudio.eu-south-1.sagemaker.aws\nstudio.eu-south-2.sagemaker.aws\nstudio.eu-west-1.sagemaker.aws\nstudio.eu-west-2.sagemaker.aws\nstudio.eu-west-3.sagemaker.aws\nstudio.il-central-1.sagemaker.aws\nstudio.me-central-1.sagemaker.aws\nstudio.me-south-1.sagemaker.aws\nstudio.sa-east-1.sagemaker.aws\nstudio.us-east-1.sagemaker.aws\nstudio.us-east-2.sagemaker.aws\nstudio.us-gov-east-1.sagemaker.aws\nstudio-fips.us-gov-east-1.sagemaker.aws\nstudio.us-gov-west-1.sagemaker.aws\nstudio-fips.us-gov-west-1.sagemaker.aws\nstudio.us-west-1.sagemaker.aws\nstudio.us-west-2.sagemaker.aws\nstudio.cn-north-1.sagemaker.com.cn\nstudio.cn-northwest-1.sagemaker.com.cn\n*.experiments.sagemaker.aws\nanalytics-gateway.ap-northeast-1.amazonaws.com\nanalytics-gateway.ap-northeast-2.amazonaws.com\nanalytics-gateway.ap-south-1.amazonaws.com\nanalytics-gateway.ap-southeast-1.amazonaws.com\nanalytics-gateway.ap-southeast-2.amazonaws.com\nanalytics-gateway.eu-central-1.amazonaws.com\nanalytics-gateway.eu-west-1.amazonaws.com\nanalytics-gateway.us-east-1.amazonaws.com\nanalytics-gateway.us-east-2.amazonaws.com\nanalytics-gateway.us-west-2.amazonaws.com\namplifyapp.com\n*.awsapprunner.com\nwebview-assets.aws-cloud9.af-south-1.amazonaws.com\nvfs.cloud9.af-south-1.amazonaws.com\nwebview-assets.cloud9.af-south-1.amazonaws.com\nwebview-assets.aws-cloud9.ap-east-1.amazonaws.com\nvfs.cloud9.ap-east-1.amazonaws.com\nwebview-assets.cloud9.ap-east-1.amazonaws.com\nwebview-assets.aws-cloud9.ap-northeast-1.amazonaws.com\nvfs.cloud9.ap-northeast-1.amazonaws.com\nwebview-assets.cloud9.ap-northeast-1.amazonaws.com\nwebview-assets.aws-cloud9.ap-northeast-2.amazonaws.com\nvfs.cloud9.ap-northeast-2.amazonaws.com\nwebview-assets.cloud9.ap-northeast-2.amazonaws.com\nwebview-assets.aws-cloud9.ap-northeast-3.amazonaws.com\nvfs.cloud9.ap-northeast-3.amazonaws.com\nwebview-assets.cloud9.ap-northeast-3.amazonaws.com\nwebview-assets.aws-cloud9.ap-south-1.amazonaws.com\nvfs.cloud9.ap-south-1.amazonaws.com\nwebview-assets.cloud9.ap-south-1.amazonaws.com\nwebview-assets.aws-cloud9.ap-southeast-1.amazonaws.com\nvfs.cloud9.ap-southeast-1.amazonaws.com\nwebview-assets.cloud9.ap-southeast-1.amazonaws.com\nwebview-assets.aws-cloud9.ap-southeast-2.amazonaws.com\nvfs.cloud9.ap-southeast-2.amazonaws.com\nwebview-assets.cloud9.ap-southeast-2.amazonaws.com\nwebview-assets.aws-cloud9.ca-central-1.amazonaws.com\nvfs.cloud9.ca-central-1.amazonaws.com\nwebview-assets.cloud9.ca-central-1.amazonaws.com\nwebview-assets.aws-cloud9.eu-central-1.amazonaws.com\nvfs.cloud9.eu-central-1.amazonaws.com\nwebview-assets.cloud9.eu-central-1.amazonaws.com\nwebview-assets.aws-cloud9.eu-north-1.amazonaws.com\nvfs.cloud9.eu-north-1.amazonaws.com\nwebview-assets.cloud9.eu-north-1.amazonaws.com\nwebview-assets.aws-cloud9.eu-south-1.amazonaws.com\nvfs.cloud9.eu-south-1.amazonaws.com\nwebview-assets.cloud9.eu-south-1.amazonaws.com\nwebview-assets.aws-cloud9.eu-west-1.amazonaws.com\nvfs.cloud9.eu-west-1.amazonaws.com\nwebview-assets.cloud9.eu-west-1.amazonaws.com\nwebview-assets.aws-cloud9.eu-west-2.amazonaws.com\nvfs.cloud9.eu-west-2.amazonaws.com\nwebview-assets.cloud9.eu-west-2.amazonaws.com\nwebview-assets.aws-cloud9.eu-west-3.amazonaws.com\nvfs.cloud9.eu-west-3.amazonaws.com\nwebview-assets.cloud9.eu-west-3.amazonaws.com\nwebview-assets.aws-cloud9.il-central-1.amazonaws.com\nvfs.cloud9.il-central-1.amazonaws.com\nwebview-assets.aws-cloud9.me-south-1.amazonaws.com\nvfs.cloud9.me-south-1.amazonaws.com\nwebview-assets.cloud9.me-south-1.amazonaws.com\nwebview-assets.aws-cloud9.sa-east-1.amazonaws.com\nvfs.cloud9.sa-east-1.amazonaws.com\nwebview-assets.cloud9.sa-east-1.amazonaws.com\nwebview-assets.aws-cloud9.us-east-1.amazonaws.com\nvfs.cloud9.us-east-1.amazonaws.com\nwebview-assets.cloud9.us-east-1.amazonaws.com\nwebview-assets.aws-cloud9.us-east-2.amazonaws.com\nvfs.cloud9.us-east-2.amazonaws.com\nwebview-assets.cloud9.us-east-2.amazonaws.com\nwebview-assets.aws-cloud9.us-west-1.amazonaws.com\nvfs.cloud9.us-west-1.amazonaws.com\nwebview-assets.cloud9.us-west-1.amazonaws.com\nwebview-assets.aws-cloud9.us-west-2.amazonaws.com\nvfs.cloud9.us-west-2.amazonaws.com\nwebview-assets.cloud9.us-west-2.amazonaws.com\nawsapps.com\ncn-north-1.eb.amazonaws.com.cn\ncn-northwest-1.eb.amazonaws.com.cn\nelasticbeanstalk.com\naf-south-1.elasticbeanstalk.com\nap-east-1.elasticbeanstalk.com\nap-northeast-1.elasticbeanstalk.com\nap-northeast-2.elasticbeanstalk.com\nap-northeast-3.elasticbeanstalk.com\nap-south-1.elasticbeanstalk.com\nap-southeast-1.elasticbeanstalk.com\nap-southeast-2.elasticbeanstalk.com\nap-southeast-3.elasticbeanstalk.com\nap-southeast-5.elasticbeanstalk.com\nap-southeast-7.elasticbeanstalk.com\nca-central-1.elasticbeanstalk.com\neu-central-1.elasticbeanstalk.com\neu-north-1.elasticbeanstalk.com\neu-south-1.elasticbeanstalk.com\neu-south-2.elasticbeanstalk.com\neu-west-1.elasticbeanstalk.com\neu-west-2.elasticbeanstalk.com\neu-west-3.elasticbeanstalk.com\nil-central-1.elasticbeanstalk.com\nme-central-1.elasticbeanstalk.com\nme-south-1.elasticbeanstalk.com\nsa-east-1.elasticbeanstalk.com\nus-east-1.elasticbeanstalk.com\nus-east-2.elasticbeanstalk.com\nus-gov-east-1.elasticbeanstalk.com\nus-gov-west-1.elasticbeanstalk.com\nus-west-1.elasticbeanstalk.com\nus-west-2.elasticbeanstalk.com\n*.elb.amazonaws.com.cn\n*.elb.amazonaws.com\nawsglobalaccelerator.com\nlambda-url.af-south-1.on.aws\nlambda-url.ap-east-1.on.aws\nlambda-url.ap-northeast-1.on.aws\nlambda-url.ap-northeast-2.on.aws\nlambda-url.ap-northeast-3.on.aws\nlambda-url.ap-south-1.on.aws\nlambda-url.ap-southeast-1.on.aws\nlambda-url.ap-southeast-2.on.aws\nlambda-url.ap-southeast-3.on.aws\nlambda-url.ca-central-1.on.aws\nlambda-url.eu-central-1.on.aws\nlambda-url.eu-north-1.on.aws\nlambda-url.eu-south-1.on.aws\nlambda-url.eu-west-1.on.aws\nlambda-url.eu-west-2.on.aws\nlambda-url.eu-west-3.on.aws\nlambda-url.me-south-1.on.aws\nlambda-url.sa-east-1.on.aws\nlambda-url.us-east-1.on.aws\nlambda-url.us-east-2.on.aws\nlambda-url.us-west-1.on.aws\nlambda-url.us-west-2.on.aws\n*.private.repost.aws\ntransfer-webapp.af-south-1.on.aws\ntransfer-webapp.ap-east-1.on.aws\ntransfer-webapp.ap-northeast-1.on.aws\ntransfer-webapp.ap-northeast-2.on.aws\ntransfer-webapp.ap-northeast-3.on.aws\ntransfer-webapp.ap-south-1.on.aws\ntransfer-webapp.ap-south-2.on.aws\ntransfer-webapp.ap-southeast-1.on.aws\ntransfer-webapp.ap-southeast-2.on.aws\ntransfer-webapp.ap-southeast-3.on.aws\ntransfer-webapp.ap-southeast-4.on.aws\ntransfer-webapp.ap-southeast-5.on.aws\ntransfer-webapp.ap-southeast-7.on.aws\ntransfer-webapp.ca-central-1.on.aws\ntransfer-webapp.ca-west-1.on.aws\ntransfer-webapp.eu-central-1.on.aws\ntransfer-webapp.eu-central-2.on.aws\ntransfer-webapp.eu-north-1.on.aws\ntransfer-webapp.eu-south-1.on.aws\ntransfer-webapp.eu-south-2.on.aws\ntransfer-webapp.eu-west-1.on.aws\ntransfer-webapp.eu-west-2.on.aws\ntransfer-webapp.eu-west-3.on.aws\ntransfer-webapp.il-central-1.on.aws\ntransfer-webapp.me-central-1.on.aws\ntransfer-webapp.me-south-1.on.aws\ntransfer-webapp.mx-central-1.on.aws\ntransfer-webapp.sa-east-1.on.aws\ntransfer-webapp.us-east-1.on.aws\ntransfer-webapp.us-east-2.on.aws\ntransfer-webapp.us-gov-east-1.on.aws\ntransfer-webapp-fips.us-gov-east-1.on.aws\ntransfer-webapp.us-gov-west-1.on.aws\ntransfer-webapp-fips.us-gov-west-1.on.aws\ntransfer-webapp.us-west-1.on.aws\ntransfer-webapp.us-west-2.on.aws\ntransfer-webapp.cn-north-1.on.amazonwebservices.com.cn\ntransfer-webapp.cn-northwest-1.on.amazonwebservices.com.cn\neero.online\neero-stage.online\nopentunnel.xyz\nantagonist.cloud\nclaude.app\nclaudeusercontent.com\nframe.claudeusercontent.com\n*.cursorusercontent.com\napigee.io\npanel.dev\nsiiites.com\nint.apple\n*.cloud.int.apple\n*.r.cloud.int.apple\n*.ap-north-1.r.cloud.int.apple\n*.ap-south-1.r.cloud.int.apple\n*.ap-south-2.r.cloud.int.apple\n*.eu-central-1.r.cloud.int.apple\n*.eu-north-1.r.cloud.int.apple\n*.us-central-1.r.cloud.int.apple\n*.us-central-2.r.cloud.int.apple\n*.us-east-1.r.cloud.int.apple\n*.us-east-2.r.cloud.int.apple\n*.us-west-1.r.cloud.int.apple\n*.us-west-2.r.cloud.int.apple\n*.us-west-3.r.cloud.int.apple\nappspacehosted.com\nappspaceusercontent.com\nappudo.net\nappwrite.global\nappwrite.network\n*.appwrite.run\non-aptible.com\nf5.si\narvanedge.ir\nuser.aseinet.ne.jp\ngv.vc\nd.gv.vc\nuser.party.eus\npimienta.org\npoivron.org\npotager.org\nsweetpepper.org\nmyasustor.com\n*.atlassian-3p.com\n*.atlassian-3p-us-gov-mod.com\n*.atlassian-isolated-3p.com\ncdn.prod.atlassian-dev.net\nmyfritz.link\nmyfritz.net\n*.awdev.ca\n*.advisor.ws\necommerce-shop.pl\nb-data.io\nbalena-devices.com\nbase.ec\nofficial.ec\nbuyshop.jp\nfashionstore.jp\nhandcrafted.jp\nkawaiishop.jp\nsupersale.jp\ntheshop.jp\nshopselect.net\nbase.shop\nbeagleboard.io\nbearblog.dev\n*.beget.app\n*.begetcdn.cloud\npages.gay\nbnr.la\nbitbucket.io\nblackbaudcdn.net\nof.je\nsquare.site\nbluebite.io\nboomla.net\nboutir.com\nboxfuse.io\nsquare7.ch\nbplaced.com\nbplaced.de\nsquare7.de\nbplaced.net\nsquare7.net\nbrave.app\n*.s.brave.app\nbrave.dev\n*.s.brave.dev\nbrave.io\n*.s.brave.io\nshop.brendly.ba\nshop.brendly.hr\nshop.brendly.rs\nbrowsersafetymark.io\nradio.am\nradio.fm\ncdn.bubble.io\nbubbleapps.io\n*.bwcloud-os-instance.de\ncafjs.com\ncanva-apps.cn\ncanva-code.cn\nmy.canvasite.cn\nkhsj.cn\ncanva-apps.com\ncanva-hosted-embed.com\ncanvacode.com\nrice-labs.com\ncanva.link\ncanva.run\nmy.canva.site\ndrr.ac\nuwu.ai\ncarrd.co\ncrd.co\nju.mp\napi.gov.uk\ncdn77-storage.com\nrsc.contentproxy9.cz\nr.cdn77.net\ncdn77-ssl.net\nc.cdn77.org\nrsc.cdn77.org\nssl.origin.cdn77-secure.org\nza.bz\nbr.com\ncn.com\nde.com\neu.com\njpn.com\nmex.com\nru.com\nsa.com\nuk.com\nus.com\nza.com\ncom.de\ngb.net\nhu.net\njp.net\nse.net\nuk.net\nae.org\ncom.se\ncx.ua\ndiscourse.diy\ndiscourse.group\ndiscourse.team\nclerk.app\nclerkstage.app\n*.lcl.dev\n*.lclstage.dev\n*.stg.dev\n*.stgstage.dev\ncleverapps.cc\n*.services.clever-cloud.com\ncleverapps.io\ncleverapps.tech\nclickrising.net\ncloudns.asia\ncloudns.be\ncloud-ip.biz\ncloudns.biz\ncloud-ip.cc\ncloudns.cc\ncloudns.ch\ncloudns.cl\ncloudns.club\nabrdns.com\ndnsabr.com\nip-ddns.com\ncloudns.cx\ncloudns.eu\ncloudns.in\ncloudns.info\nddns-ip.net\ndns-cloud.net\ndns-dynamic.net\ncloudns.nz\ncloudns.org\nip-dynamic.org\ncloudns.ph\ncloudns.pro\ncloudns.pw\ncloudns.us\nc66.me\ncloud66.ws\njdevcloud.com\nwpdevcloud.com\ncloudaccess.host\nfreesite.host\ncloudaccess.net\ncloudbeesusercontent.io\n*.cloudera.site\ncloudflare.app\ncf-ipfs.com\ncloudflare-ipfs.com\ntrycloudflare.com\npages.dev\nr2.dev\nworkers.dev\ncloudflare.net\ncdn.cloudflare.net\ncdn.cloudflareanycast.net\ncdn.cloudflarecn.net\ncdn.cloudflareglobal.net\ncust.cloudscale.ch\nobjects.lpg.cloudscale.ch\nobjects.rma.cloudscale.ch\nlpg.objectstorage.ch\nrma.objectstorage.ch\nwnext.app\ncnpy.gdn\n*.otap.co\nco.ca\nco.com\nsch.ac\ndev.cv\nstore.cv\ncodeberg.page\ncodepen.app\ncodepen.dev\ncsb.app\npreview.csb.app\nco.nl\nco.no\n*.devinapps.com\nwebhosting.be\nprvw.eu\nhosting-cluster.nl\nctfcloud.net\nconvex.app\nconvex.cloud\neu-west-1.convex.cloud\nus-east-1.convex.cloud\nconvex.site\neu-west-1.convex.site\nus-east-1.convex.site\nac.ru\nedu.ru\ngov.ru\nint.ru\nmil.ru\ncorespeed.app\ndyn.cosidns.de\ndnsupdater.de\ndynamisches-dns.de\ninternet-dns.de\nl-o-g-i-n.de\ndynamic-dns.info\nfeste-ip.net\nknx-server.net\nstatic-access.net\ncraft.me\nrealm.cz\ncfolks.pl\ncyon.link\ncyon.site\nbiz.dk\nco.dk\nfirm.dk\nreg.dk\nstore.dk\ndyndns.dappnode.io\nbuiltwithdark.com\ndarklang.io\ndemo.datadetect.com\ninstance.datadetect.com\nedgestack.me\ndattolocal.com\ndattorelay.com\ndattoweb.com\nmydatto.com\ndattolocal.net\nmydatto.net\nddnss.de\ndyn.ddnss.de\ndyndns.ddnss.de\ndyn-ip24.de\ndyndns1.de\nhome-webserver.de\ndyn.home-webserver.de\nmyhome-server.de\nddnss.org\ndebian.net\ndefinima.io\ndefinima.net\ndeno.dev\ndeno-staging.dev\ndeno.net\nsandbox.deno.net\ndeployagent.com\npiebox.site\ndeployagent.space\ndedyn.io\ndeuxfleurs.eu\ndeuxfleurs.page\n*.at.ply.gg\nd6.ply.gg\njoinmc.link\nplayit.plus\n*.at.playit.plus\nwith.playit.plus\nicp0.io\n*.raw.icp0.io\nicp1.io\n*.raw.icp1.io\nopencloud.me\n*.icp.net\ncaffeine.site\ncaffeine.xyz\nmybox.company\nintouch.email\nmybox.me\nmybox.page\ndfirma.pl\ndkonto.pl\nyou2.pl\nondigitalocean.app\n*.digitaloceanspaces.com\nqzz.io\nus.kg\nxx.kg\ndpdns.org\ndiscordsays.com\ndiscordsez.com\njozi.biz\nccwu.cc\ncc.cd\nus.ci\nde5.net\ndnshome.at\nresolve.bar\nddns.berlin\ndnshome.cloud\nddnssec.de\ndnshome.de\ndyndnssec.de\nheimdns.de\nsrvdns.de\ndnshome.eu\ndnshome.it\ndyn.now\nheimdns.online\nddns.wtf\nonline.th\nshop.th\nco.scot\nme.scot\norg.scot\ndrayddns.com\nshoparena.pl\ndreamhosters.com\ndurumis.com\nduckdns.org\ndy.fi\ntunk.org\ndyndns.biz\nfor-better.biz\nfor-more.biz\nfor-some.biz\nfor-the.biz\nselfip.biz\nwebhop.biz\nftpaccess.cc\ngame-server.cc\nmyphotos.cc\nscrapping.cc\nblogdns.com\ncechire.com\ndnsalias.com\ndnsdojo.com\ndoesntexist.com\ndontexist.com\ndoomdns.com\ndyn-o-saur.com\ndynalias.com\ndyndns-at-home.com\ndyndns-at-work.com\ndyndns-blog.com\ndyndns-free.com\ndyndns-home.com\ndyndns-ip.com\ndyndns-mail.com\ndyndns-office.com\ndyndns-pics.com\ndyndns-remote.com\ndyndns-server.com\ndyndns-web.com\ndyndns-wiki.com\ndyndns-work.com\nest-a-la-maison.com\nest-a-la-masion.com\nest-le-patron.com\nest-mon-blogueur.com\nfrom-ak.com\nfrom-al.com\nfrom-ar.com\nfrom-ca.com\nfrom-ct.com\nfrom-dc.com\nfrom-de.com\nfrom-fl.com\nfrom-ga.com\nfrom-hi.com\nfrom-ia.com\nfrom-id.com\nfrom-il.com\nfrom-in.com\nfrom-ks.com\nfrom-ky.com\nfrom-ma.com\nfrom-md.com\nfrom-mi.com\nfrom-mn.com\nfrom-mo.com\nfrom-ms.com\nfrom-mt.com\nfrom-nc.com\nfrom-nd.com\nfrom-ne.com\nfrom-nh.com\nfrom-nj.com\nfrom-nm.com\nfrom-nv.com\nfrom-oh.com\nfrom-ok.com\nfrom-or.com\nfrom-pa.com\nfrom-pr.com\nfrom-ri.com\nfrom-sc.com\nfrom-sd.com\nfrom-tn.com\nfrom-tx.com\nfrom-ut.com\nfrom-va.com\nfrom-vt.com\nfrom-wa.com\nfrom-wi.com\nfrom-wv.com\nfrom-wy.com\ngetmyip.com\ngotdns.com\nhobby-site.com\nhomelinux.com\nhomeunix.com\niamallama.com\nis-a-anarchist.com\nis-a-blogger.com\nis-a-bookkeeper.com\nis-a-bulls-fan.com\nis-a-caterer.com\nis-a-chef.com\nis-a-conservative.com\nis-a-cpa.com\nis-a-cubicle-slave.com\nis-a-democrat.com\nis-a-designer.com\nis-a-doctor.com\nis-a-financialadvisor.com\nis-a-geek.com\nis-a-green.com\nis-a-guru.com\nis-a-hard-worker.com\nis-a-hunter.com\nis-a-landscaper.com\nis-a-lawyer.com\nis-a-liberal.com\nis-a-libertarian.com\nis-a-llama.com\nis-a-musician.com\nis-a-nascarfan.com\nis-a-nurse.com\nis-a-painter.com\nis-a-personaltrainer.com\nis-a-photographer.com\nis-a-player.com\nis-a-republican.com\nis-a-rockstar.com\nis-a-socialist.com\nis-a-student.com\nis-a-teacher.com\nis-a-techie.com\nis-a-therapist.com\nis-an-accountant.com\nis-an-actor.com\nis-an-actress.com\nis-an-anarchist.com\nis-an-artist.com\nis-an-engineer.com\nis-an-entertainer.com\nis-certified.com\nis-gone.com\nis-into-anime.com\nis-into-cars.com\nis-into-cartoons.com\nis-into-games.com\nis-leet.com\nis-not-certified.com\nis-slick.com\nis-uberleet.com\nis-with-theband.com\nisa-geek.com\nisa-hockeynut.com\nissmarterthanyou.com\nlikes-pie.com\nlikescandy.com\nneat-url.com\nsaves-the-whales.com\nselfip.com\nsells-for-less.com\nsells-for-u.com\nservebbs.com\nsimple-url.com\nspace-to-rent.com\nteaches-yoga.com\nwritesthisblog.com\nath.cx\nfuettertdasnetz.de\nisteingeek.de\nistmein.de\nlebtimnetz.de\nleitungsen.de\ntraeumtgerade.de\nbarrel-of-knowledge.info\nbarrell-of-knowledge.info\ndyndns.info\nfor-our.info\ngroks-the.info\ngroks-this.info\nhere-for-more.info\nknowsitall.info\nselfip.info\nwebhop.info\nforgot.her.name\nforgot.his.name\nat-band-camp.net\nblogdns.net\nbroke-it.net\nbuyshouses.net\ndnsalias.net\ndnsdojo.net\ndoes-it.net\ndontexist.net\ndynalias.net\ndynathome.net\nendofinternet.net\nfrom-az.net\nfrom-co.net\nfrom-la.net\nfrom-ny.net\ngets-it.net\nham-radio-op.net\nhomeftp.net\nhomeip.net\nhomelinux.net\nhomeunix.net\nin-the-band.net\nis-a-chef.net\nis-a-geek.net\nisa-geek.net\nkicks-ass.net\noffice-on-the.net\npodzone.net\nscrapper-site.net\nselfip.net\nsells-it.net\nservebbs.net\nserveftp.net\nthruhere.net\nwebhop.net\nmerseine.nu\nmine.nu\nshacknet.nu\nblogdns.org\nblogsite.org\nboldlygoingnowhere.org\ndnsalias.org\ndnsdojo.org\ndoesntexist.org\ndontexist.org\ndoomdns.org\ndvrdns.org\ndynalias.org\ndyndns.org\ngo.dyndns.org\nhome.dyndns.org\nendofinternet.org\nendoftheinternet.org\nfrom-me.org\ngame-host.org\ngotdns.org\nhobby-site.org\nhomedns.org\nhomeftp.org\nhomelinux.org\nhomeunix.org\nis-a-bruinsfan.org\nis-a-candidate.org\nis-a-celticsfan.org\nis-a-chef.org\nis-a-geek.org\nis-a-knight.org\nis-a-linux-user.org\nis-a-patsfan.org\nis-a-soxfan.org\nis-found.org\nis-lost.org\nis-saved.org\nis-very-bad.org\nis-very-evil.org\nis-very-good.org\nis-very-nice.org\nis-very-sweet.org\nisa-geek.org\nkicks-ass.org\nmisconfused.org\npodzone.org\nreadmyblog.org\nselfip.org\nsellsyourhome.org\nservebbs.org\nserveftp.org\nservegame.org\nstuff-4-sale.org\nwebhop.org\nbetter-than.tv\ndyndns.tv\non-the-web.tv\nworse-than.tv\nis-by.us\nland-4-sale.us\nstuff-4-sale.us\ndyndns.ws\nmypets.ws\n1cooldns.com\nbumbleshrimp.com\nddnsfree.com\nddnsgeek.com\nddnsguru.com\ndynuddns.com\ndynuhosting.com\ngiize.com\ngleeze.com\nkozow.com\nloseyourip.com\nooguy.com\npivohosting.com\ntheworkpc.com\nwiredbladehosting.com\ncasacam.net\ndynu.net\ndynuddns.net\nmysynology.net\nopik.net\nspryt.net\naccesscam.org\ncamdvr.org\nfreeddns.org\nmywire.org\nroxa.org\nwebredirect.org\nmyddns.rocks\ndynv6.net\ne4.cz\neasypanel.app\neasypanel.host\n*.ewp.live\ntwmail.cc\ntwmail.net\ntwmail.org\nmymailer.com.tw\nurl.tw\nat.emf.camp\nrt.ht\nelementor.cloud\nelementor.cool\nemergent.cloud\npreview.emergentagent.com\nemergent.host\nmytuleap.com\ntuleap-partners.com\nencr.app\nfrontend.encr.app\nencoreapi.com\nlp.dev\napi.lp.dev\nobjects.lp.dev\neu.encoway.cloud\neu.org\nal.eu.org\nasso.eu.org\nat.eu.org\nau.eu.org\nbe.eu.org\nbg.eu.org\nca.eu.org\ncd.eu.org\nch.eu.org\ncn.eu.org\ncy.eu.org\ncz.eu.org\nde.eu.org\ndk.eu.org\nedu.eu.org\nee.eu.org\nes.eu.org\nfi.eu.org\nfr.eu.org\ngr.eu.org\nhr.eu.org\nhu.eu.org\nie.eu.org\nil.eu.org\nin.eu.org\nint.eu.org\nis.eu.org\nit.eu.org\njp.eu.org\nkr.eu.org\nlt.eu.org\nlu.eu.org\nlv.eu.org\nme.eu.org\nmk.eu.org\nmt.eu.org\nmy.eu.org\nnet.eu.org\nng.eu.org\nnl.eu.org\nno.eu.org\nnz.eu.org\npl.eu.org\npt.eu.org\nro.eu.org\nru.eu.org\nse.eu.org\nsi.eu.org\nsk.eu.org\ntr.eu.org\nuk.eu.org\nus.eu.org\neurodir.ru\neu-1.evennode.com\neu-2.evennode.com\neu-3.evennode.com\neu-4.evennode.com\nus-1.evennode.com\nus-2.evennode.com\nus-3.evennode.com\nus-4.evennode.com\nrelay.evervault.app\nrelay.evervault.dev\nexe.xyz\nexpo.app\non.expo.app\nstaging.expo.app\non.staging.expo.app\nfspages.org\nru.net\nadygeya.ru\nbashkiria.ru\nbir.ru\ncbg.ru\ncom.ru\ndagestan.ru\ngrozny.ru\nkalmykia.ru\nkustanai.ru\nmarine.ru\nmordovia.ru\nmsk.ru\nmytis.ru\nnalchik.ru\nnov.ru\npyatigorsk.ru\nspb.ru\nvladikavkaz.ru\nvladimir.ru\nabkhazia.su\nadygeya.su\naktyubinsk.su\narkhangelsk.su\narmenia.su\nashgabad.su\nazerbaijan.su\nbalashov.su\nbashkiria.su\nbryansk.su\nbukhara.su\nchimkent.su\ndagestan.su\neast-kazakhstan.su\nexnet.su\ngeorgia.su\ngrozny.su\nivanovo.su\njambyl.su\nkalmykia.su\nkaluga.su\nkaracol.su\nkaraganda.su\nkarelia.su\nkhakassia.su\nkrasnodar.su\nkurgan.su\nkustanai.su\nlenug.su\nmangyshlak.su\nmordovia.su\nmsk.su\nmurmansk.su\nnalchik.su\nnavoi.su\nnorth-kazakhstan.su\nnov.su\nobninsk.su\npenza.su\npokrovsk.su\nsochi.su\nspb.su\ntashkent.su\ntermez.su\ntogliatti.su\ntroitsk.su\ntselinograd.su\ntula.su\ntuva.su\nvladikavkaz.su\nvladimir.su\nvologda.su\nchannelsdvr.net\nu.channelsdvr.net\nedgecompute.app\nfastly-edge.com\nfastly-terrarium.com\nfreetls.fastly.net\nmap.fastly.net\na.prod.fastly.net\nglobal.prod.fastly.net\na.ssl.fastly.net\nb.ssl.fastly.net\nglobal.ssl.fastly.net\nfastlylb.net\nmap.fastlylb.net\n*.user.fm\nfastvps-server.com\nfastvps.host\nmyfast.host\nfastvps.site\nmyfast.space\nconn.uk\ncopro.uk\nhosp.uk\nfedorainfracloud.org\nfedorapeople.org\ncloud.fedoraproject.org\napp.os.fedoraproject.org\napp.os.stg.fedoraproject.org\nmydobiss.com\nfh-muenster.io\npayload.dev\nfigma.site\nfigma-gov.site\npreview.site\nfilegear.me\nfirebaseapp.com\nfldrv.com\non-fleek.app\nflutterflow.app\nsprites.app\nfly.dev\ne2b.app\nframer.ai\nframer.app\nframercanvas.com\nframer.media\nframer.photos\nframer.website\nframer.wiki\n*.0e.vc\nfreebox-os.com\nfreeboxos.com\nfbx-os.fr\nfbxos.fr\nfreebox-os.fr\nfreeboxos.fr\nfreedesktop.org\nfreemyip.com\n*.frusky.de\nwien.funkfeuer.at\ndaemon.asia\ndix.asia\nmydns.bz\n0am.jp\n0g0.jp\n0j0.jp\n0t0.jp\nmydns.jp\npgw.jp\nwjg.jp\nkeyword-on.net\nlive-on.net\nserver-on.net\nmydns.tw\nmydns.vc\n*.futurecms.at\n*.ex.futurecms.at\n*.in.futurecms.at\nfuturehosting.at\nfuturemailing.at\n*.ex.ortsinfo.at\n*.kunden.ortsinfo.at\n*.statics.cloud\ngadget.app\ngadget.host\naliases121.com\ncampaign.gov.uk\nservice.gov.uk\nindependent-commission.uk\nindependent-inquest.uk\nindependent-inquiry.uk\nindependent-panel.uk\nindependent-review.uk\npublic-inquiry.uk\nroyal-commission.uk\ngehirn.ne.jp\nusercontent.jp\ngentapps.com\ngentlentapis.com\ncdn-edges.net\ngsj.bz\ngitbook.io\ngithub.app\ngithubusercontent.com\ngithubpreview.dev\ngithub.io\ngitlab.io\ngitapp.si\ngitpage.si\nnog.community\nco.ro\nshop.ro\nlolipop.io\nangry.jp\nbabyblue.jp\nbabymilk.jp\nbackdrop.jp\nbambina.jp\nbitter.jp\nblush.jp\nboo.jp\nboy.jp\nboyfriend.jp\nbut.jp\ncandypop.jp\ncapoo.jp\ncatfood.jp\ncheap.jp\nchicappa.jp\nchillout.jp\nchips.jp\nchowder.jp\nchu.jp\nciao.jp\ncocotte.jp\ncoolblog.jp\ncranky.jp\ncutegirl.jp\ndaa.jp\ndeca.jp\ndeci.jp\ndigick.jp\negoism.jp\nfakefur.jp\nfem.jp\nflier.jp\nfloppy.jp\nfool.jp\nfrenchkiss.jp\ngirlfriend.jp\ngirly.jp\ngloomy.jp\ngonna.jp\ngreater.jp\nhacca.jp\nheavy.jp\nher.jp\nhiho.jp\nhippy.jp\nholy.jp\nhungry.jp\nicurus.jp\nitigo.jp\njellybean.jp\nkikirara.jp\nkill.jp\nkilo.jp\nkuron.jp\nlittlestar.jp\nlolipopmc.jp\nlolitapunk.jp\nlomo.jp\nlovepop.jp\nlovesick.jp\nmain.jp\nmods.jp\nmond.jp\nmongolian.jp\nmoo.jp\nnamaste.jp\nnikita.jp\nnobushi.jp\nnoor.jp\noops.jp\nparallel.jp\nparasite.jp\npecori.jp\npeewee.jp\npenne.jp\npepper.jp\nperma.jp\npigboat.jp\npinoko.jp\npunyu.jp\npupu.jp\npussycat.jp\npya.jp\nraindrop.jp\nreadymade.jp\nsadist.jp\nschoolbus.jp\nsecret.jp\nstaba.jp\nstripper.jp\nsub.jp\nsunnyday.jp\nthick.jp\ntonkotsu.jp\nunder.jp\nupper.jp\nvelvet.jp\nverse.jp\nversus.jp\nvivian.jp\nwatson.jp\nweblike.jp\nwhitesnow.jp\nzombie.jp\nheteml.net\nvibehost.space\ngraphic.design\ngoip.de\n*.hosted.app\n*.run.app\n*.mtls.run.app\nweb.app\n*.0emm.com\nappspot.com\n*.r.appspot.com\nblogspot.com\ncodespot.com\ngoogleapis.com\ngooglecode.com\npagespeedmobilizer.com\nwithgoogle.com\nwithyoutube.com\n*.gateway.dev\ncloud.goog\ntranslate.goog\n*.usercontent.goog\ncloudfunctions.net\ngoupile.fr\npymnt.uk\ngov.nl\ngrafana-dev.net\ngrayjayleagues.com\ngrebedoc.dev\nxn--gnstigbestellen-zvb.de\nxn--gnstigliefern-wob.de\ngv.uy\nhackclub.app\nxn--hkkinen-5wa.fi\nhashbang.sh\nhasura.app\nhasura-app.io\nhatenablog.com\nhatenadiary.com\nhateblo.jp\nhatenablog.jp\nhatenadiary.jp\nhatenadiary.org\npages.it.hs-heilbronn.de\npages-research.it.hs-heilbronn.de\nheiyu.space\nhelioho.st\nheliohost.us\nhepforge.org\nonhercules.app\nhercules-app.com\nhercules-dev.com\nhere.now\nherokuapp.com\nheyflow.page\nheyflow.site\nravendb.cloud\nravendb.community\ndevelopment.run\nravendb.run\nhidns.co\nhidns.vip\nhomesklep.pl\n*.kin.one\n*.id.pub\n*.kin.pub\nseprox.hooc.me\nhoplix.shop\norx.biz\nbiz.ng\nco.biz.ng\ndl.biz.ng\ngo.biz.ng\nlg.biz.ng\non.biz.ng\ncol.ng\nfirm.ng\ngen.ng\nltd.ng\nngo.ng\nplc.ng\nhstgr.cloud\nhostyhosting.io\nhf.space\nstatic.hf.space\nhypernode.io\niobb.net\nco.cz\n*.moonscale.io\nmoonscale.net\ngr.com\niki.fi\nibxos.it\niliadboxos.it\nimagine.diy\nimagine-proxy.work\nsmushcdn.com\nwphostedmail.com\nwpmucdn.com\ntempurl.host\nwpmudev.host\ndyn-berlin.de\nin-berlin.de\nin-brb.de\nin-butter.de\nin-dsl.de\nin-vpn.de\nin-dsl.net\nin-vpn.net\nin-dsl.org\nin-vpn.org\noninferno.net\ninfo.cx\nac.leg.br\nal.leg.br\nam.leg.br\nap.leg.br\nba.leg.br\nce.leg.br\ndf.leg.br\nes.leg.br\ngo.leg.br\nma.leg.br\nmg.leg.br\nms.leg.br\nmt.leg.br\npa.leg.br\npb.leg.br\npe.leg.br\npi.leg.br\npr.leg.br\nrj.leg.br\nrn.leg.br\nro.leg.br\nrr.leg.br\nrs.leg.br\nsc.leg.br\nse.leg.br\nsp.leg.br\nto.leg.br\npixolino.com\nna4u.ru\nbotdash.app\nbotdash.dev\nbotdash.gg\nbotdash.net\nbotda.sh\nbotdash.xyz\nonline-server.cloud\napps-1and1.com\nlive-website.com\nwebspace-host.com\napps-1and1.net\nwebsitebuilder.online\napp-ionos.space\niopsys.se\n*.inbrowser.dev\n*.dweb.link\n*.inbrowser.link\nipifony.net\nhome64.de\nipv64.de\nipv64.net\nir.md\nis-a-good.dev\niservschule.de\nmein-iserv.de\nschuldock.de\nschulplattform.de\nschulserver.de\ntest-iserv.de\niserv.dev\niserv.host\nispmanager.name\nmel.cloudlets.com.au\ncloud.interhostsolutions.be\nalp1.ae.flow.ch\nappengine.flow.ch\nes-1.axarnet.cloud\ndiadem.cloud\nvip.jelastic.cloud\njele.cloud\nit1.eur.aruba.jenv-aruba.cloud\nit1.jenv-aruba.cloud\nkeliweb.cloud\ncs.keliweb.cloud\noxa.cloud\ntn.oxa.cloud\nuk.oxa.cloud\nprimetel.cloud\nuk.primetel.cloud\nca.reclaim.cloud\nuk.reclaim.cloud\nus.reclaim.cloud\nch.trendhosting.cloud\nde.trendhosting.cloud\njele.club\ndopaas.com\npaas.hosted-by-previder.com\nrag-cloud.hosteur.com\nrag-cloud-ch.hosteur.com\njcloud.ik-server.com\njcloud-ver-jpc.ik-server.com\ndemo.jelastic.com\npaas.massivegrid.com\njed.wafaicloud.com\nryd.wafaicloud.com\nj.scaleforce.com.cy\njelastic.dogado.eu\nfi.cloudplatform.fi\njele.host\nmircloud.host\npaas.beebyte.io\nsekd1.beebyteapp.io\njele.io\njc.neen.it\njcloud.kz\ncloudjiffy.net\nfra1-de.cloudjiffy.net\nwest1-us.cloudjiffy.net\njls-sto1.elastx.net\njls-sto2.elastx.net\njls-sto3.elastx.net\nfr-1.paas.massivegrid.net\nlon-1.paas.massivegrid.net\nlon-2.paas.massivegrid.net\nny-1.paas.massivegrid.net\nny-2.paas.massivegrid.net\nsg-1.paas.massivegrid.net\njelastic.saveincloud.net\nnordeste-idc.saveincloud.net\nj.scaleforce.net\nsdscloud.pl\nunicloud.pl\nmircloud.ru\nenscaled.sg\njele.site\njelastic.team\norangecloud.tn\nj.layershift.co.uk\nphx.enscaled.us\nmircloud.us\nmyjino.ru\n*.hosting.myjino.ru\n*.landing.myjino.ru\n*.spectrum.myjino.ru\n*.vps.myjino.ru\njote.cloud\njotelulu.cloud\neu1-plenit.com\nla1-plenit.com\nus1-plenit.com\nwebadorsite.com\njouwweb.site\njs.org\nelastic.k2.cloud\nlb.ru-msk.k2.cloud\ns3.ru-msk.k2.cloud\nwebsite.ru-msk.k2.cloud\nlb.ru-spb.k2.cloud\ns3.ru-spb.k2.cloud\nwebsite.ru-spb.k2.cloud\ns3.k2.cloud\nwebsite.k2.cloud\nkaas.gg\nkhplay.nl\nkapsi.fi\nkdns.fr\nezproxy.kuleuven.be\nkuleuven.cloud\nkeenetic.io\nkeenetic.link\nkeenetic.name\nkeenetic.pro\nae.kg\nkeymachine.de\nkiloapps.ai\nkiloapps.io\nkinghost.net\nuni5.net\nknightpoint.systems\nkoobin.events\nwebthings.io\nkrellian.net\noya.to\nco.de\nshiptoday.app\nshiptoday.build\nlaravel.cloud\non-forge.com\non-vapor.com\n*.eth.limo\n*.eth.link\ngit-repos.de\nlcube-server.de\nsvn-repos.de\nleadpages.co\nlpages.co\nlpusercontent.com\nleapcell.app\nleapcell.dev\nleapcell.online\nliara.run\niran.liara.run\nlibp2p.direct\nruncontainers.dev\nco.business\nco.education\nco.events\nco.financial\nco.network\nco.place\nco.technology\nlinkyard-cloud.ch\nlinkyard.cloud\nmembers.linode.com\n*.nodebalancer.linode.com\n*.linodeobjects.com\nip.linodeusercontent.com\nwe.bs\nfilegear-sg.me\nggff.net\n*.user.localcert.dev\nlocaltonet.com\n*.localto.net\nlodz.pl\npabianice.pl\nplock.pl\nsieradz.pl\nskierniewice.pl\nzgierz.pl\nloginline.app\nloginline.dev\nloginline.io\nloginline.services\nloginline.site\nlohmus.me\nlovable.app\nlovableproject.com\nlovable.run\nlovable.sh\nkrasnik.pl\nleczna.pl\nlubartow.pl\nlublin.pl\nponiatowa.pl\nswidnik.pl\nglug.org.uk\nlug.org.uk\nlugs.org.uk\nbarsy.bg\nbarsy.club\nbarsycenter.com\nbarsyonline.com\nbarsy.de\nbarsy.dev\nbarsy.eu\nbarsy.gr\nbarsy.in\nbarsy.info\nbarsy.io\nbarsy.me\nbarsy.menu\nbarsyonline.menu\nbarsy.mobi\nbarsy.net\nbarsy.online\nbarsy.org\nbarsy.pro\nbarsy.pub\nbarsy.ro\nbarsy.rs\nbarsy.shop\nbarsyonline.shop\nbarsy.site\nbarsy.store\nbarsy.support\nbarsy.uk\nbarsy.co.uk\nbarsyonline.co.uk\n*.lutrausercontent.com\nluyani.app\nluyani.net\n*.magentosite.cloud\nmagicpatterns.app\nmagicpatternsapp.com\nhb.cldmail.ru\nmatlab.cloud\nmodelscape.com\nmwcloudnonprod.com\npolyspace.com\nmayfirst.info\nmcdir.me\nmcdir.ru\nvps.mcdir.ru\nmcpre.ru\nmediatech.by\nmediatech.dev\nhra.health\nmedusajs.app\nminiserver.com\nmemset.net\nmesserli.app\natmeta.com\napps.fbsbx.com\n*.metaaiusercontent.com\n*.cloud.metacentrum.cz\ncustom.metacentrum.cz\nflt.cloud.muni.cz\nusr.cloud.muni.cz\nmeteorapp.com\neu.meteorapp.com\nco.pl\n*.azurecontainer.io\nazure-api.net\nazure-mobile.net\nazureedge.net\nazurefd.net\nazurestaticapps.net\n1.azurestaticapps.net\n2.azurestaticapps.net\n3.azurestaticapps.net\n4.azurestaticapps.net\n5.azurestaticapps.net\n6.azurestaticapps.net\n7.azurestaticapps.net\ncentralus.azurestaticapps.net\neastasia.azurestaticapps.net\neastus2.azurestaticapps.net\nwesteurope.azurestaticapps.net\nwestus2.azurestaticapps.net\nazurewebsites.net\naustraliacentral-01.azurewebsites.net\naustraliacentral2-01.azurewebsites.net\naustraliaeast-01.azurewebsites.net\naustraliasoutheast-01.azurewebsites.net\naustriaeast-01.azurewebsites.net\nbelgiumcentral-01.azurewebsites.net\nbrazilsouth-01.azurewebsites.net\nbrazilsoutheast-01.azurewebsites.net\ncanadacentral-01.azurewebsites.net\ncanadaeast-01.azurewebsites.net\ncentralindia-01.azurewebsites.net\ncentralus-01.azurewebsites.net\ncentraluseuap-01.azurewebsites.net\nchilecentral-01.azurewebsites.net\ndenmarkeast-01.azurewebsites.net\neastasia-01.azurewebsites.net\neastasiastage-01.azurewebsites.net\neastus-01.azurewebsites.net\neastus2-01.azurewebsites.net\neastus2euap-01.azurewebsites.net\neastus3-01.azurewebsites.net\nfrancecentral-01.azurewebsites.net\nfrancesouth-01.azurewebsites.net\ngermanynorth-01.azurewebsites.net\ngermanywestcentral-01.azurewebsites.net\nindiasouthcentral-01.azurewebsites.net\nindonesiacentral-01.azurewebsites.net\nisraelcentral-01.azurewebsites.net\nisraelnorthwest-01.azurewebsites.net\nitalynorth-01.azurewebsites.net\njapaneast-01.azurewebsites.net\njapanwest-01.azurewebsites.net\njioindiacentral-01.azurewebsites.net\njioindiawest-01.azurewebsites.net\nkoreacentral-01.azurewebsites.net\nkoreasouth-01.azurewebsites.net\nmalaysiawest-01.azurewebsites.net\nmexicocentral-01.azurewebsites.net\nnewzealandnorth-01.azurewebsites.net\nnorthcentralus-01.azurewebsites.net\nnorthcentralusstage-01.azurewebsites.net\nnortheastus5-01.azurewebsites.net\nnortheurope-01.azurewebsites.net\nnorwayeast-01.azurewebsites.net\nnorwaywest-01.azurewebsites.net\n*.p.azurewebsites.net\npolandcentral-01.azurewebsites.net\nqatarcentral-01.azurewebsites.net\nsouthafricanorth-01.azurewebsites.net\nsouthafricawest-01.azurewebsites.net\nsouthcentralus-01.azurewebsites.net\nsouthcentralus2-01.azurewebsites.net\nsoutheastasia-01.azurewebsites.net\nsoutheastus5-01.azurewebsites.net\nsouthindia-01.azurewebsites.net\nspaincentral-01.azurewebsites.net\nswedencentral-01.azurewebsites.net\nswedensouth-01.azurewebsites.net\nswitzerlandnorth-01.azurewebsites.net\nswitzerlandwest-01.azurewebsites.net\ntaiwannorth-01.azurewebsites.net\ntaiwannorthwest-01.azurewebsites.net\nuaecentral-01.azurewebsites.net\nuaenorth-01.azurewebsites.net\nuksouth-01.azurewebsites.net\nukwest-01.azurewebsites.net\nwestcentralus-01.azurewebsites.net\nwesteurope-01.azurewebsites.net\nwestindia-01.azurewebsites.net\nwestus-01.azurewebsites.net\nwestus2-01.azurewebsites.net\nwestus3-01.azurewebsites.net\ncloudapp.net\ntrafficmanager.net\nblob.core.usgovcloudapi.net\nfile.core.usgovcloudapi.net\nweb.core.usgovcloudapi.net\nservicebus.usgovcloudapi.net\nusgovcloudapp.net\nusgovtrafficmanager.net\nblob.core.windows.net\nfile.core.windows.net\nweb.core.windows.net\nservicebus.windows.net\nazure-api.us\nazurewebsites.us\nroutingthecloud.com\nsn.mynetname.net\nroutingthecloud.net\nroutingthecloud.org\nsame-app.com\nsame-preview.com\ncsx.cc\nmiren.app\nmiren.systems\nmydbserver.com\nwebspaceconfig.de\nmittwald.info\nmittwaldserver.info\ntypo3server.info\nproject.space\nmkm.fan\nmocha.app\nmochausercontent.com\nmocha-sandbox.dev\nmodx.dev\nbmoattachments.org\nnet.ru\norg.ru\npp.ru\nmy.be\nhostedpi.com\ncaracal.mythic-beasts.com\ncustomer.mythic-beasts.com\nfentiger.mythic-beasts.com\nlynx.mythic-beasts.com\nocelot.mythic-beasts.com\noncilla.mythic-beasts.com\nonza.mythic-beasts.com\nsphinx.mythic-beasts.com\nvs.mythic-beasts.com\nx.mythic-beasts.com\nyali.mythic-beasts.com\ncust.retrosnub.co.uk\nui.nabu.casa\nneedle.run\nco.site\ncloud.nospamproxy.com\no365.cloud.nospamproxy.com\nnetlib.re\nnetlify.app\n4u.com\nnfshost.com\nipfs.nftstorage.link\nngo.us\nngrok.app\nngrok-free.app\nngrok.dev\nngrok-free.dev\nngrok.io\nap.ngrok.io\nau.ngrok.io\neu.ngrok.io\nin.ngrok.io\njp.ngrok.io\nsa.ngrok.io\nus.ngrok.io\nngrok.pizza\nngrok.pro\ntorun.pl\nnh-serv.co.uk\nnimsite.uk\nmmafan.biz\nmyftp.biz\nno-ip.biz\nno-ip.ca\nfantasyleague.cc\ngotdns.ch\n3utilities.com\nblogsyte.com\nciscofreak.com\ndamnserver.com\nddnsking.com\nditchyourip.com\ndnsiskinky.com\ndynns.com\ngeekgalaxy.com\nhealth-carereform.com\nhomesecuritymac.com\nhomesecuritypc.com\nmyactivedirectory.com\nmysecuritycamera.com\nmyvnc.com\nnet-freaks.com\nonthewifi.com\npoint2this.com\nquicksytes.com\nsecuritytactics.com\nservebeer.com\nservecounterstrike.com\nserveexchange.com\nserveftp.com\nservegame.com\nservehalflife.com\nservehttp.com\nservehumour.com\nserveirc.com\nservemp3.com\nservep2p.com\nservepics.com\nservequake.com\nservesarcasm.com\nstufftoread.com\nunusualperson.com\nworkisboring.com\ndvrcam.info\nilovecollege.info\nno-ip.info\nbrasilia.me\nddns.me\ndnsfor.me\nhopto.me\nloginto.me\nnoip.me\nwebhop.me\nbounceme.net\nddns.net\neating-organic.net\nmydissent.net\nmyeffect.net\nmymediapc.net\nmypsx.net\nmysecuritycamera.net\nnhlfan.net\nno-ip.net\npgafan.net\nprivatizehealthinsurance.net\nredirectme.net\nserveblog.net\nserveminecraft.net\nsytes.net\ncable-modem.org\ncollegefan.org\ncouchpotatofries.org\nhopto.org\nmlbfan.org\nmyftp.org\nmysecuritycamera.org\nnflfan.org\nno-ip.org\nread-books.org\nufcfan.org\nzapto.org\nno-ip.co.uk\ngolffan.us\nnoip.us\npointto.us\nstage.nodeart.io\n*.developer.app\nnoop.app\n*.northflank.app\n*.build.run\n*.code.run\n*.database.run\n*.migration.run\naberdeen.wa.us\nbainbridge-isl.wa.us\nbellevue.wa.us\nbremerton.wa.us\ncentralia.wa.us\nchehalis.wa.us\nforks.wa.us\ngig-harbor.wa.us\nhoquiam.wa.us\nkeyport.wa.us\nkingston.wa.us\nolympia.wa.us\nport-angeles.wa.us\nport-ludlow.wa.us\nport-orchard.wa.us\nport-townsend.wa.us\npoulsbo.wa.us\nredmond.wa.us\nrenton.wa.us\nsea.wa.us\nseattle.wa.us\nsequim.wa.us\nshelton.wa.us\nsilverdale.wa.us\nyarrow-point.wa.us\nnoticeable.news\nnotion.site\ndnsking.ch\nmypi.co\nmyiphost.com\nforumz.info\nsoundcast.me\ntcp4.me\ndnsup.net\nhicam.net\nnow-dns.net\nownip.net\nvpndns.net\ndynserv.org\nnow-dns.org\nx443.pw\nntdll.top\nfreeddns.us\nnsupdate.info\nnerdpol.ovh\nprvcy.page\nobservablehq.cloud\nstatic.observableusercontent.com\nomg.lol\ncloudycluster.net\nomniwe.site\n123webseite.at\n123website.be\nsimplesite.com.br\n123website.ch\nsimplesite.com\n123webseite.de\n123hjemmeside.dk\n123miweb.es\n123kotisivu.fi\n123siteweb.fr\nsimplesite.gr\n123homepage.it\n123website.lu\n123website.nl\n123hjemmeside.no\nservice.one\nwebsite.one\nsimplesite.pl\n123paginaweb.pt\n123minsida.se\nonid.ca\nis-a-fullstack.dev\nis-cool.dev\nis-not-a.dev\nlocalplayer.dev\nis-local.org\nopensocial.site\n*.oaiusercontent.com\nchatgpt.site\nopencraft.hosting\n16-b.it\n32-b.it\n64-b.it\norsites.com\noperaunite.com\n*.customer-oci.com\n*.oci.customer-oci.com\n*.ocp.customer-oci.com\n*.ocs.customer-oci.com\n*.oraclecloudapps.com\n*.oraclegovcloudapps.com\n*.oraclegovcloudapps.uk\ntech.orange\ncan.re\nauthgear-staging.com\nauthgearapps.com\noutsystemscloud.com\n*.hosting.ovh.net\n*.webpaas.ovh.net\nownprovider.com\nown.pm\n*.owo.codes\nox.rs\noy.lc\npgfog.com\ngotpantheon.com\npantheonsite.io\n*.paywhirl.com\n*.xmit.co\nxmit.dev\nmadethis.site\nsrv.us\ngh.srv.us\ngl.srv.us\nmypep.link\npplx.app\nperspecta.cloud\nforgeblocks.com\nid.forgerock.io\nsupport.site\non-web.fr\n*.upsun.app\nupsunapp.com\nent.platform.sh\neu.platform.sh\nus.platform.sh\n*.platformsh.site\n*.tst.site\nplaycode.site\npley.games\nonporter.run\nco.bn\npostman-echo.com\npstmn.io\nmock.pstmn.io\nhttpbin.org\nprequalifyme.today\nxen.prgmr.com\npriv.at\nc01.kr\neliv-api.kr\neliv-cdn.kr\neliv-dns.kr\nmmv.kr\nvki.kr\ndev.project-study.com\nplatter-app.dev\ne.id\nchirurgiens-dentistes-en-france.fr\nbyen.site\nnyc.mn\n*.cn.st\npubtls.org\nputer.app\nputer.site\nputer.work\npythonanywhere.com\neu.pythonanywhere.com\nqa2.com\nqcx.io\n*.sys.qcx.io\nmyqnapcloud.cn\nalpha-myqnapcloud.com\ndev-myqnapcloud.com\nmycloudnas.com\nmynascloud.com\nmyqnapcloud.com\nqoto.io\nqualifioapp.com\nladesk.com\n*.qualyhqpartner.com\n*.qualyhqportal.com\nqbuser.com\n*.quipelements.com\nvapor.cloud\nvaporcloud.io\nrackmaze.com\nrackmaze.net\ncloudsite.builders\nmyradweb.net\nservername.us\nweb.in\nin.net\nmyrdbx.io\nsite.rb-hosting.io\nup.railway.app\n*.on-rancher.cloud\n*.on-k3s.io\n*.on-rio.io\nravpage.co.il\nreadthedocs-hosted.com\nreadthedocs.io\nrhcloud.com\ninstances.spawn.cc\n*.clusters.rdpa.co\n*.srvrless.rdpa.co\nonrender.com\napp.render.com\nreplit.app\nid.replit.app\nfirewalledreplit.co\nid.firewalledreplit.co\nrepl.co\nid.repl.co\nreplit.dev\narcher.replit.dev\nbones.replit.dev\ncanary.replit.dev\nglobal.replit.dev\nhacker.replit.dev\nid.replit.dev\njaneway.replit.dev\nkim.replit.dev\nkira.replit.dev\nkirk.replit.dev\nodo.replit.dev\nparis.replit.dev\npicard.replit.dev\npike.replit.dev\nprerelease.replit.dev\nreed.replit.dev\nriker.replit.dev\nsisko.replit.dev\nspock.replit.dev\nstaging.replit.dev\nsulu.replit.dev\ntarpit.replit.dev\nteams.replit.dev\ntucker.replit.dev\nwesley.replit.dev\nworf.replit.dev\nrepl.run\nresindevice.io\ndevices.resinstaging.io\nadimo.co.uk\nitcouldbewor.se\naus.basketball\nnz.basketball\nsubsc-pay.com\nsubsc-pay.net\ngit-pages.rit.edu\nrocketpreview.app\n*.builtwithrocket.new\nrocky.page\nrub.de\nruhr-uni-bochum.de\nio.noc.ruhr-uni-bochum.de\nxn--90amc.xn--p1acf\nxn--j1aef.xn--p1acf\nxn--j1ael8b.xn--p1acf\nxn--h1ahn.xn--p1acf\nxn--j1adp.xn--p1acf\nxn--c1avg.xn--p1acf\nxn--80aaa0cvac.xn--p1acf\nxn--h1aliz.xn--p1acf\nxn--90a1af.xn--p1acf\nxn--41a.xn--p1acf\nras.ru\nnyat.app\n180r.com\ndojin.com\nsakuratan.com\nsakuraweb.com\nx0.com\n2-d.jp\nbona.jp\ncrap.jp\ndaynight.jp\neek.jp\nflop.jp\nhalfmoon.jp\njeez.jp\nmatrix.jp\nmimoza.jp\nivory.ne.jp\nmail-box.ne.jp\nmints.ne.jp\nmokuren.ne.jp\nopal.ne.jp\nsakura.ne.jp\nsumomo.ne.jp\ntopaz.ne.jp\nnetgamers.jp\nnyanta.jp\no0o0.jp\nrdy.jp\nrgr.jp\nrulez.jp\ns3.isk01.sakurastorage.jp\ns3.isk02.sakurastorage.jp\nsaloon.jp\nsblo.jp\nskr.jp\ntank.jp\nuh-oh.jp\nundo.jp\nrs.webaccel.jp\nuser.webaccel.jp\nwebsozai.jp\nxii.jp\nsquares.net\njpn.org\nkirara.st\nx0.to\nfrom.tv\nsakura.tv\n*.builder.code.com\n*.dev-builder.code.com\n*.stg-builder.code.com\n*.001.test.code-builder-stg.platform.salesforce.com\n*.aa.crm.dev\n*.ab.crm.dev\n*.ac.crm.dev\n*.ad.crm.dev\n*.ae.crm.dev\n*.af.crm.dev\n*.ci.crm.dev\n*.d.crm.dev\n*.pa.crm.dev\n*.pb.crm.dev\n*.pc.crm.dev\n*.pd.crm.dev\n*.pe.crm.dev\n*.pf.crm.dev\n*.w.crm.dev\n*.wa.crm.dev\n*.wb.crm.dev\n*.wc.crm.dev\n*.wd.crm.dev\n*.we.crm.dev\n*.wf.crm.dev\nsandcats.io\nsav.case\nlogoip.com\nlogoip.de\nfr-par-1.baremetal.scw.cloud\nfr-par-2.baremetal.scw.cloud\nnl-ams-1.baremetal.scw.cloud\ncockpit.fr-par.scw.cloud\nddl.fr-par.scw.cloud\ndtwh.fr-par.scw.cloud\nfnc.fr-par.scw.cloud\nfunctions.fnc.fr-par.scw.cloud\nifr.fr-par.scw.cloud\nk8s.fr-par.scw.cloud\nnodes.k8s.fr-par.scw.cloud\nkafk.fr-par.scw.cloud\nmgdb.fr-par.scw.cloud\nrdb.fr-par.scw.cloud\ns3.fr-par.scw.cloud\ns3-website.fr-par.scw.cloud\nscbl.fr-par.scw.cloud\nwhm.fr-par.scw.cloud\npriv.instances.scw.cloud\npub.instances.scw.cloud\nk8s.scw.cloud\ncockpit.nl-ams.scw.cloud\nddl.nl-ams.scw.cloud\ndtwh.nl-ams.scw.cloud\nifr.nl-ams.scw.cloud\nk8s.nl-ams.scw.cloud\nnodes.k8s.nl-ams.scw.cloud\nkafk.nl-ams.scw.cloud\nmgdb.nl-ams.scw.cloud\nrdb.nl-ams.scw.cloud\ns3.nl-ams.scw.cloud\ns3-website.nl-ams.scw.cloud\nscbl.nl-ams.scw.cloud\nwhm.nl-ams.scw.cloud\ncockpit.pl-waw.scw.cloud\nddl.pl-waw.scw.cloud\ndtwh.pl-waw.scw.cloud\nifr.pl-waw.scw.cloud\nk8s.pl-waw.scw.cloud\nnodes.k8s.pl-waw.scw.cloud\nkafk.pl-waw.scw.cloud\nmgdb.pl-waw.scw.cloud\nrdb.pl-waw.scw.cloud\ns3.pl-waw.scw.cloud\ns3-website.pl-waw.scw.cloud\nscbl.pl-waw.scw.cloud\nscalebook.scw.cloud\nsmartlabeling.scw.cloud\ndedibox.fr\nscw.site\nams.scw.site\nwaw.scw.site\nschokokeks.net\ngov.scot\nservice.gov.scot\nmygov.scot\nscrysec.com\nclient.scrypted.io\nfirewall-gateway.com\nfirewall-gateway.de\nmy-gateway.de\nmy-router.de\nspdns.de\nspdns.eu\nfirewall-gateway.net\nmy-firewall.org\nmyfirewall.org\nspdns.org\nseidat.net\nsellfy.store\nminisite.ms\nsenseering.net\nservebolt.cloud\nbiz.ua\nco.ua\npp.ua\nas.sh.cn\nvicp.fun\nyicp.fun\nzicp.fun\nsheezy.games\nmyshopblocks.com\nmyshopify.com\nshopitsite.com\nshopware.shop\nshopware.store\nmo-siemens.io\n1kapp.com\nappchizi.com\napplinzi.com\nsinaapp.com\nvipsinaapp.com\nsiteleaf.net\nsmall-web.org\naeroport.fr\navocat.fr\nchambagri.fr\nchirurgiens-dentistes.fr\nexperts-comptables.fr\nmedecin.fr\nnotaires.fr\npharmacien.fr\nport.fr\nveterinaire.fr\nvp4.me\n*.snowflake.app\n*.privatelink.snowflake.app\nstreamlit.app\nstreamlitapp.com\ntry-snowplow.com\nmafelo.net\nsol.site\nplaystation-cloud.com\nsrht.site\napps.lair.io\n*.stolos.io\n4.at\nmy.at\nmy.de\n*.nxa.eu\nnx.gw\nspawnbase.app\ncustomer.speedpartner.de\nmyspreadshop.at\nmyspreadshop.com.au\nmyspreadshop.be\nmyspreadshop.ca\nmyspreadshop.ch\nmyspreadshop.com\nmyspreadshop.de\nmyspreadshop.dk\nmyspreadshop.es\nmyspreadshop.fi\nmyspreadshop.fr\nmyspreadshop.ie\nmyspreadshop.it\nmyspreadshop.net\nmyspreadshop.nl\nmyspreadshop.no\nmyspreadshop.pl\nmyspreadshop.se\nmyspreadshop.co.uk\nw-corp-staticblitz.com\nw-credentialless-staticblitz.com\nw-staticblitz.com\nbolt.host\nstackhero-network.com\nruns.onstackit.cloud\nstackit.gg\nstackit.rocks\nstackit.run\nstackit.zone\nsryze.cc\nindevs.in\nmusician.io\nnovecore.site\nstatichost.page\nfeedback.ac\nforms.ac\nassessments.cx\ncalculators.cx\nfunnels.cx\npaynow.cx\nquizzes.cx\nresearched.cx\ntests.cx\nsurveys.so\nipfs.storacha.link\nipfs.w3s.link\nstorebase.store\nstrapiapp.com\nmedia.strapiapp.com\nvps-host.net\natl.jelastic.vps-host.net\nnjs.jelastic.vps-host.net\nric.jelastic.vps-host.net\nstreak-link.com\nstreaklinks.com\nstreakusercontent.com\nsoc.srcf.net\nuser.srcf.net\nutwente.io\ntemp-dns.com\nsupabase.co\nrealtime.supabase.co\nstorage.supabase.co\nsupabase.in\nsupabase.net\nsyncloud.it\ndscloud.biz\ndirect.quickconnect.cn\ndsmynas.com\nfamilyds.com\ndiskstation.me\ndscloud.me\ni234.me\nmyds.me\nsynology.me\ndscloud.mobi\ndsmynas.net\nfamilyds.net\ndsmynas.org\nfamilyds.org\ndirect.quickconnect.to\nvpnplus.to\nmytabit.com\nmytabit.co.il\ntabitorder.co.il\ntaifun-dns.de\nerp.dev\nweb.erp.dev\nts.net\n*.c.ts.net\ngda.pl\ngdansk.pl\ngdynia.pl\nmed.pl\nsopot.pl\ntaveusercontent.com\np.tawk.email\np.tawkto.email\ntche.br\nsite.tb-hosting.com\ndirectwp.eu\nec.cc\neu.cc\ngu.cc\nuk.cc\nus.cc\nedugit.io\ns3.teckids.org\ntelebit.app\ntelebit.io\n*.telebit.xyz\nteleport.sh\n*.firenet.ch\n*.svc.firenet.ch\nreservd.com\nthingdustdata.com\ncust.dev.thingdust.io\nreservd.dev.thingdust.io\ncust.disrec.thingdust.io\nreservd.disrec.thingdust.io\ncust.prod.thingdust.io\ncust.testing.thingdust.io\nreservd.testing.thingdust.io\ntickets.io\nt3.storage.dev\nt3.storageapi.dev\narvo.network\nazimuth.network\ntlon.network\ntorproject.net\npages.torproject.net\ntownnews-staging.com\n12hp.at\n2ix.at\n4lima.at\nlima-city.at\n12hp.ch\n2ix.ch\n4lima.ch\nlima-city.ch\ntrafficplex.cloud\nde.cool\n12hp.de\n2ix.de\n4lima.de\nlima-city.de\n1337.pictures\nclan.rip\nlima-city.rocks\nwebspace.rocks\nlima.zone\n*.transurl.be\n*.transurl.eu\nsite.transip.me\n*.transurl.nl\n*.triton.zone\ntunnelmole.net\ntuxfamily.org\ntypedream.app\npro.typeform.com\nuber.space\nhk.com\ninc.hk\nltd.hk\nhk.org\nit.com\numso.co\nunison-services.cloud\nvirtual-user.de\nvirtualuser.de\nobj.ag\nname.pm\nsch.tf\nbiz.wf\nsch.wf\norg.yt\nrs.ba\nbielsko.pl\nurown.cloud\ndnsupdate.info\nus.org\nv.ua\nval.run\nweb.val.run\nvercel.app\nv0.build\nvercel.dev\nvusercontent.net\ntmp.now\nvercel.run\nnow.sh\n2038.io\nv-info.info\nvistablog.ir\ndeus-canvas.com\nvivenushop.com\nvivenushop.dev\nvoorloper.cloud\n*.vultrobjects.com\nwafflecell.com\nwal.app\nwasmer.app\nwebflow.io\nwebflowtest.io\n*.webhare.dev\nhotelwithflight.com\nreserve-online.net\nbook.online\ncprapid.com\npleskns.com\nwp2.host\npdns.page\nplesk.page\ncpanel.site\nwpsquared.site\n*.wadl.top\nremotewd.com\nbox.ca\npages.wiardweb.com\ntoolforge.org\nwmcloud.org\nbeta.wmcloud.org\nwmflabs.org\nhrsn.dev\nis-a.dev\nvps.hrsn.net\nlocalcert.net\nwindsurf.app\nwindsurf.build\ndrive-platform.com\ndrive-platform.io\npanel.gg\ndaemon.panel.gg\nbase44.app\nbase44-sandbox.com\nwixsite.com\nwixstudio.com\neditorx.io\nwixstudio.io\nwix.run\nmesswithdns.com\nwoltlab-demo.com\nmyforum.community\ncommunity-pro.de\ndiskussionsbereich.de\ncommunity-pro.net\nmeinforum.net\naffinitylottery.org.uk\nraffleentry.org.uk\nweeklylottery.org.uk\nwpenginepowered.com\njs.wpenginepowered.com\ngrok.me\n*.xenonconnect.de\nhalf.host\ncistron.nl\ndemon.nl\nxs4all.space\nxtooldevice.com\nyandexcloud.net\nstorage.yandexcloud.net\nwebsite.yandexcloud.net\nsourcecraft.site\nofficial.academy\nyolasite.com\nynh.fr\nnohost.me\nnoho.st\nza.net\nza.org\nzap.cloud\nzeabur.app\n*.zerops.app\nprg1-zerops.zone\n*.zerops.zone\nbss.design\nbasicserver.io\nvirtualserver.io\nenterprisecloud.nu\nzone.id\nnett.to\nzabc.net";

  // extension/lib/website-groups.js
  var suffixRules = new Set(suffixes.split("\n"));
  var aliases = { "github.com": "GitHub", "gitlab.com": "GitLab", "chatgpt.com": "ChatGPT", "gemini.google.com": "Gemini", "mail.google.com": "Gmail", "docs.google.com": "Google Docs", "drive.google.com": "Google Drive", "webstore.google.com": "Chrome Web Store", "microsoftedge.microsoft.com": "Edge Add-ons", "youtube.com": "YouTube", "stackoverflow.com": "Stack Overflow" };
  function website(url) {
    let host;
    try {
      const u = new URL(url);
      if (!["http:", "https:", "file:"].includes(u.protocol)) return null;
      if (u.protocol === "file:") return { key: "site:file", name: "Local files" };
      host = u.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return null;
    }
    if (/^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".")) return { key: "site:" + host, name: host };
    const labels2 = host.split(".");
    let size = 1;
    for (let i = 0; i < labels2.length; i++) {
      const tail = labels2.slice(i).join(".");
      if (suffixRules.has("!" + tail)) {
        size = labels2.length - i - 1;
        break;
      }
      if (suffixRules.has(tail) || i > 0 && suffixRules.has("*." + tail)) size = Math.max(size, labels2.length - i + (suffixRules.has("*." + tail) && i > 0 ? 1 : 0));
    }
    const stem = labels2.slice(0, Math.max(1, labels2.length - size)).join(".");
    return { key: "site:" + host, name: aliases[host] || stem.charAt(0).toUpperCase() + stem.slice(1) };
  }
  var RULE_PRESETS = [
    { id: "ai-tools", name: "Combine AI tools", description: "ChatGPT, Gemini and Claude together", rules: [{ domain: "chatgpt.com", group: "AI tools" }, { domain: "gemini.google.com", group: "AI tools" }, { domain: "claude.ai", group: "AI tools" }] },
    { id: "github-projects", name: "Separate GitHub projects", description: "One group per repository", rules: [{ domain: "github.com/*/*", group: "GitHub \xB7 {project}" }] },
    { id: "google-work", name: "Google work", description: "Gmail, Drive and Docs together", rules: [{ domain: "mail.google.com", group: "Google work" }, { domain: "drive.google.com", group: "Google work" }, { domain: "docs.google.com", group: "Google work" }] }
  ];

  // extension/ui/rules-dialog.js
  function rulesDialog({ state, tabs = [], change, seed }) {
    const rules = structuredClone(state.settings.rules || []).sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const automatic = el("input", { type: "checkbox", role: "switch", checked: state.settings.autoGroup !== false, "aria-label": "Auto-group new tabs" });
    const websites = el("input", { type: "checkbox", checked: state.settings.websiteGrouping !== false, "aria-label": "Group remaining tabs by website" });
    const list = el("div", { class: "rules-list" }), presets = el("div", { class: "rule-presets" }), suggestions = el("div", { class: "rule-suggestions" });
    function add(rule) {
      rules.push({ id: crypto.randomUUID(), enabled: true, color: "random", ...rule });
      render();
    }
    function render() {
      list.replaceChildren(...rules.map((rule, index) => {
        const toggle = el("input", { type: "checkbox", checked: rule.enabled !== false, "aria-label": "Enable " + (rule.group || rule.domain || "rule"), onchange: (e) => rule.enabled = e.target.checked });
        const summary = el("summary", {}, toggle, el("span", {}, rule.exclude ? "Leave matching tabs alone" : rule.group || "New rule"), el("span", { class: "hint" }, rule.domain || rule.title || "Choose a website"));
        const count = el("p", { class: "hint", role: "status" });
        const updateCount = () => {
          count.textContent = `Matches ${tabs.filter((t) => findRule(t, [{ ...rule, enabled: true }])).length} open tabs`;
        };
        const input = (key, label) => field(label, el("input", { value: rule[key] || "", oninput: (e) => {
          rule[key] = e.target.value;
          updateCount();
        } }));
        const colour = el("select", { "aria-label": "Group colour", onchange: (e) => rule.color = e.target.value }, ...["random", ...PALETTE].map((c) => el("option", { value: c, selected: c === (rule.color || "random") }, c === "random" ? "Random" : c)));
        const details = el("details", { class: "rule-card", open: !!rule.editing }, summary, el(
          "div",
          { class: "rule-editor" },
          input("domain", "Website or URL pattern"),
          input("group", "Group name"),
          field("Colour", colour),
          count,
          el("details", {}, el("summary", {}, "Advanced"), input("title", "Title contains"), el("label", { class: "check-label" }, el("input", { type: "checkbox", checked: !!rule.regex, onchange: (e) => {
            rule.regex = e.target.checked;
            updateCount();
          } }), "Use a regular expression for URL matching"), el("label", { class: "check-label" }, el("input", { type: "checkbox", checked: !!rule.exclude, onchange: (e) => rule.exclude = e.target.checked }), "Leave matching tabs alone"), el("p", { class: "hint" }, "Use * for URL wildcards. Both conditions must match. GitHub names can use {project}.")),
          el("div", { class: "rule-row-actions" }, button("Move up", () => {
            if (index) {
              [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
              render();
            }
          }), button("Move down", () => {
            if (index < rules.length - 1) {
              [rules[index + 1], rules[index]] = [rules[index], rules[index + 1]];
              render();
            }
          }), button("Remove", () => {
            rules.splice(index, 1);
            render();
          }))
        ));
        toggle.onclick = (e) => e.stopPropagation();
        updateCount();
        return details;
      }));
      if (!rules.length) list.append(el("p", { class: "hint" }, "Website grouping already works. Add a rule only when you want a different destination."));
    }
    for (const preset of RULE_PRESETS) presets.append(button(preset.name, () => {
      for (const rule of preset.rules) if (!rules.some((r) => r.domain === rule.domain && r.group === rule.group)) rules.unshift({ id: crypto.randomUUID(), enabled: true, color: "random", ...rule });
      render();
    }, { title: preset.description }));
    const sites = /* @__PURE__ */ new Map();
    for (const tab of tabs) {
      const site = website(tab.resourceUrl || tab.url);
      if (site) {
        if (!sites.has(site.key)) sites.set(site.key, { ...site, tabs: [] });
        sites.get(site.key).tabs.push(tab);
      }
    }
    for (const site of [...sites.values()].sort((a, b) => b.tabs.length - a.tabs.length).slice(0, 4)) suggestions.append(button(`Group ${site.tabs.length} ${site.name} tab${site.tabs.length === 1 ? "" : "s"}`, () => {
      if (!rules.some((r) => r.domain === site.key.slice(5))) add({ domain: site.key.slice(5), group: site.name, editing: true });
    }));
    if (seed?.length) {
      const hosts = [...new Set(seed.map((t) => {
        try {
          return new URL(t.resourceUrl || t.url).hostname;
        } catch {
          return "";
        }
      }))].filter(Boolean);
      for (const domain2 of hosts) add({ domain: domain2, group: seed.groupName || website("https://" + domain2)?.name || domain2, editing: true });
    }
    render();
    const body = el(
      "div",
      { class: "rules-screen" },
      el("div", { class: "rules-defaults" }, el("label", { class: "check-label" }, websites, "Group remaining tabs by website"), el("p", { class: "hint" }, "Short names, varied colours and alphabetical order. Works locally, without AI."), el("label", { class: "settings-preference" }, el("span", {}, "Auto-group new tabs"), automatic), el("p", { class: "hint" }, "Create a new group when at least two tabs match. A single tab can join an existing group.")),
      el("strong", {}, "Ready-made rules"),
      presets,
      sites.size ? el("div", {}, el("strong", {}, "From your open tabs"), suggestions) : null,
      el("div", { class: "rules-heading" }, el("strong", {}, "Your rules"), button("Add rule", () => add({ editing: true }))),
      el("p", { class: "hint" }, "First matching rule wins. Move specific rules above general ones."),
      list
    );
    const { close } = modal("Grouping rules", body, [button("Cancel", () => close()), button("Save rules", task(async () => {
      await change("settings", { settings: { autoGroup: automatic.checked, websiteGrouping: websites.checked, rules: rules.map((r, i) => ({ ...r, priority: rules.length - i })) } });
      close();
    }), { className: "primary" })]);
  }

  // extension/ui/organisation-dialog.js
  var names = { keep: "Keep existing", rules: "Rules", ai: "AI", "rules-ai": "Rules, then AI", template: "Template", manual: "Keep current order", title: "Alphabetical", domain: "Website", recent: "Recent activity", rule: "Rule priority" };
  var labels = { group: "Group tabs", collectionName: "Name collections", groupName: "Name groups", tabOrder: "Order tabs and saved links", groupOrder: "Order groups", collectionOrder: "Order collections" };
  function organisationDialog({ state, scope = { type: "global" }, change }) {
    const collection = state.collections.find((c) => c.id === scope.id);
    const space = state.spaces.find((s) => s.id === (scope.type === "space" ? scope.id : collection?.spaceId));
    const target = scope.type === "collection" ? collection : scope.type === "space" ? space : state.settings;
    const inherited = el("input", { type: "checkbox", checked: scope.type !== "global" && !target?.organisation });
    const policy = policyFor(state, scope.type === "collection" ? collection : null, scope.type === "global" ? null : space?.id);
    const fields = {};
    const form = el("div", { class: "organisation-fields" }, ...Object.entries(POLICY_CHOICES).filter(([key]) => scope.type !== "collection" || key !== "collectionOrder").map(([key, values]) => {
      const input = fields[key] = el("select", { "aria-label": labels[key] }, ...values.map((value) => el("option", { value, selected: value === policy[key] }, names[value])));
      return field(labels[key], input);
    }));
    for (const [key, label] of [["collectionTemplate", "Collection name template"], ["groupTemplate", "Group name template"], ["orderInstruction", "AI ordering purpose"]]) {
      fields[key] = el("input", { value: policy[key], "aria-label": label });
      form.append(field(label, fields[key]));
    }
    const automatic = el("input", { type: "checkbox", checked: policy.automatic });
    form.append(el("label", { class: "check-label" }, automatic, "Apply automatically to new work"));
    const update = () => {
      for (const input of form.querySelectorAll("input,select")) input.disabled = scope.type !== "global" && inherited.checked;
    };
    inherited.onchange = update;
    update();
    const body = el(
      "div",
      {},
      scope.type !== "global" ? el("label", { class: "check-label" }, inherited, "Inherit " + (scope.type === "space" ? "global defaults" : "space defaults")) : null,
      form,
      el("p", { class: "hint" }, "Templates: {domain}, {title}, {count}, {date}, {space}, {name}. Manual names and placements are preserved."),
      scope.type === "global" ? button("Open grouping rules", () => rulesDialog({ state, change })) : null
    );
    const status = el("p", { class: "hint", role: "status" });
    body.append(status);
    const refresh = async () => {
      const result = await rpc("organisation-status", { scope });
      status.textContent = `${result.count} remembered manual exceptions.` + (result.error ? " Last automatic AI attempt: " + result.error : "");
    };
    refresh().catch((error) => {
      status.textContent = error.message;
    });
    body.append(button("Forget manual exceptions", task(async () => {
      await change("organisation-reset", { scope });
      await refresh();
    })));
    body.append(button("Retry automatic AI", task(async () => {
      await change("organisation-retry", {});
      status.textContent = "Automatic organisation queued.";
    })));
    body.append(button("Apply saved policy once", task(async () => {
      if (Object.values(policy).some((v) => v === "ai" || v === "rules-ai") && !await chrome.permissions.request({ origins: [endpointOrigin(providerEndpoint(state.settings)) + "/*"] })) throw Error("AI access was not enabled.");
      await change("organisation-run", { scope });
      status.textContent = "Organisation applied; any AI changes are queued.";
    })));
    const { close } = modal("Organisation \xB7 " + (scope.type === "global" ? "Global defaults" : target.name), body, [
      button("Cancel", () => close()),
      button("Save", task(async () => {
        const organisation = scope.type !== "global" && inherited.checked ? null : sanitizePolicy({ ...Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])), automatic: automatic.checked });
        if (organisation?.automatic && Object.values(organisation).some((v) => v === "ai" || v === "rules-ai")) {
          const granted = await chrome.permissions.request({ origins: [endpointOrigin(providerEndpoint(state.settings)) + "/*"] });
          if (!granted) throw Error("AI access was not enabled. Your settings have not changed.");
        }
        const ruleValues = void 0;
        await change("organisation-policy", { scope, organisation, rules: ruleValues });
        close();
      }), { className: "primary" })
    ]);
  }

  // extension/ui/contextual-ai.js
  async function assist(state, data) {
    const granted = await chrome.permissions.request({ origins: [endpointOrigin(providerEndpoint(state.settings)) + "/*"] });
    if (!granted) throw Error("AI access was not enabled.");
    return rpc("ai-assist", data);
  }
  function researchOverview({ state, collection, change }) {
    const picks = linkPicker(collection.links, { max: 20 });
    const status = el("p", { class: "hint", role: "status" }), requestId = uid();
    let cancelled = false;
    const { dialog, close } = modal("Research overview", el("div", {}, el("p", {}, "Read selected open pages and draft an overview with sources and suggested next steps."), picks.node, status), [
      button("Cancel", () => close()),
      button("Read pages and draft", task(async () => {
        const links = collection.links.filter((l) => picks.ids().includes(l.id));
        if (!links.length) throw Error("Choose at least one page.");
        const origins = [...new Set(links.filter((l) => /^https?:/.test(l.url)).map((l) => new URL(l.url).origin + "/*"))];
        const granted = await chrome.permissions.request({ origins: [...origins, endpointOrigin(providerEndpoint(state.settings)) + "/*"] });
        if (!granted) throw Error("Page access was not enabled.");
        status.textContent = "Reading pages and drafting\u2026";
        const result = await rpc("ai-assist", { kind: "overview", collectionId: collection.id, linkIds: links.map((l) => l.id), requestId });
        if (cancelled) return;
        close();
        const note = el("textarea", { rows: 14, value: result.note, "aria-label": "Research overview draft" });
        const review = modal("Review research overview", el("div", {}, note, result.unavailable.length ? el("details", {}, el("summary", {}, result.unavailable.length + " pages not read"), ...result.unavailable.map((p) => el("p", {}, p.url + " \xB7 " + p.reason))) : null), [
          button("Cancel", () => review.close()),
          button("Save collection note", task(async () => {
            await change("ai-overview-apply", { collectionId: collection.id, note: note.value, revision: result.revision });
            review.close();
          }), { className: "primary" })
        ]);
      }), { className: "primary" })
    ]);
    dialog.addEventListener("close", () => {
      cancelled = true;
      rpc("ai-cancel", { requestId }).catch(() => {
      });
    }, { once: true });
  }

  // extension/ui/action-dialogs.js
  function createActionDialogs({ getData, windowId, getTabIds, change, onOpen = () => {
  }, inLibrary = false }) {
    const data = new Proxy({}, { get: (_, key) => getData()[key] });
    const win = windowId, selectedIds = getTabIds, act = (fn) => task(fn);
    function saveTo(context2, { closeTabs = data.state.settings.closeAfterStash } = {}) {
      const ids = selectedIds().filter((id) => data.tabs.some((t) => t.id === id && !t.pinned));
      if (!ids.length) return toast("Select at least one unpinned tab.", { error: true });
      const check = el("input", { type: "checkbox", checked: closeTabs });
      const adopt = el("input", { type: "checkbox", checked: false, "aria-label": "and switch to new collection" });
      const windowIds = data.tabs.filter((t) => t.windowId === win && !t.pinned).map((t) => t.id);
      const canAdopt = ids.length === windowIds.length && ids.every((id) => windowIds.includes(id));
      adopt.disabled = !canAdopt;
      const save = button(
        "Save tabs",
        act(async () => {
          save.disabled = true;
          try {
            await change("save", {
              tabIds: ids,
              windowId: win,
              minimal: true,
              adopt: adopt.checked,
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
      check.onchange = () => {
        if (check.checked) adopt.checked = false;
        label();
      };
      adopt.onchange = () => {
        if (adopt.checked) check.checked = false;
        label();
      };
      label();
      const { close } = popover(
        `Save ${ids.length} tabs`,
        el(
          "div",
          {},
          el("label", { class: "check-label" }, check, "and close them"),
          el("label", { class: "check-label", title: canAdopt ? "" : "Select all unpinned tabs in this window to switch to the new collection." }, adopt, "and switch to new collection")
        ),
        [save, button("Cancel", () => close())]
      );
    }
    let groupingBusy = false;
    const groupingIds = (include = true) => selectedIds().filter((id) => data.tabs.some((t) => t.id === id && t.windowId === win && !t.pinned && (include || t.groupId < 0)));
    function topicOptions(title, run) {
      if (groupingBusy) return;
      if (!data.connections.ai) {
        settingsDetails("AI connection");
        return;
      }
      const include = el("input", { type: "checkbox", checked: data.state.settings.regroupExisting !== false, "aria-label": "Include already grouped tabs" });
      const apply = button("Organise by topic", act(async () => {
        if (!await chrome.permissions.request({ origins: [endpointOrigin(providerEndpoint(data.state.settings)) + "/*"] })) return;
        apply.disabled = true;
        try {
          if (include.checked !== (data.state.settings.regroupExisting !== false)) await change("settings", { settings: { regroupExisting: include.checked } });
          close();
          await run(include.checked);
        } finally {
          apply.disabled = false;
        }
      }), { className: "primary topic-apply" });
      const { close } = modal(title, el("div", {}, el("label", { class: "check-label" }, include, "Include already grouped tabs"), el("p", { class: "hint" }, "Included tabs are grouped afresh by topic. Existing group names and membership are ignored. Uncheck to leave grouped tabs unchanged.")), [button("Cancel", () => close()), apply]);
    }
    function aiTabs() {
      return topicOptions("Group open tabs by topic", runTopicTabs);
    }
    async function runTopicTabs(regroupExisting) {
      if (groupingBusy) return;
      if (!data.connections.ai) {
        settingsDetails("AI connection");
        return;
      }
      groupingBusy = true;
      const requestId = uid();
      let cancelled = false;
      const progress = el("span", {}, "Grouping by topic\u2026");
      const cancel = button("Cancel", () => {
        cancelled = true;
        rpc("ai-cancel", { requestId });
        progress.textContent = "Cancelling\u2026";
      });
      toast(el("span", { class: "grouping-progress" }, progress, cancel), { duration: 0 });
      try {
        await change("group-topic", { windowId: win, tabIds: groupingIds(regroupExisting), regroupExisting, requestId });
      } catch (error) {
        toast(cancelled ? "AI grouping cancelled" : error.message, { error: !cancelled });
      } finally {
        groupingBusy = false;
      }
    }
    async function groupSort(options = {}) {
      if (groupingBusy) return;
      groupingBusy = true;
      try {
        return await change("group-sort", { windowId: win, tabIds: groupingIds(), ...options });
      } finally {
        groupingBusy = false;
      }
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
    async function performSwap(collection, { working = collection.autoUpdate !== false, outgoing = "keep", expectedSourceId } = {}) {
      if (!collection || swapping) return;
      swapping = true;
      try {
        if (working) await change("edit", { kind: "collection", collectionId: collection.id, autoUpdate: true });
        const result = await change("switch", {
          destinationId: collection.id,
          windowId: win,
          outgoing,
          expectedSourceId,
          tracking: working,
          requestId: uid(),
          focusPage: !!globalThis.__neoOverlayContext
        });
        if (result?.status === "partial" || result?.cancelled || result?.failed?.length)
          throw new Error("Switch incomplete. Review Timeline before trying again.");
        onOpen();
        return result;
      } finally {
        swapping = false;
      }
    }
    function outgoingOption() {
      const source = data.state.collections.find((c) => c.id === data.sessionState?.active?.[win]?.collectionId);
      const label = source ? "Update \u201C" + source.name + "\u201D with current tabs" : "Save current tabs as a new collection";
      const check = el("input", { type: "checkbox", checked: false, "aria-label": label });
      const payload = () => ({ outgoing: check.checked ? source ? "update" : "new" : "keep", expectedSourceId: source?.id || null });
      return { check, label, payload };
    }
    function swapCollection(collection, { working = collection?.autoUpdate !== false } = {}) {
      if (!collection || swapping) return;
      const option = outgoingOption();
      const confirm = button("Switch to collection", act(async () => {
        confirm.disabled = true;
        try {
          await performSwap(collection, { working, ...option.payload() });
          close();
        } finally {
          confirm.disabled = false;
        }
      }), { className: "primary" });
      const { close } = modal("Switch to " + collection.name + "?", el(
        "div",
        {},
        el("label", { class: "check-label" }, option.check, option.label)
      ), [button("Cancel", () => close()), confirm]);
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
      const option = outgoingOption(), saveCurrent = option.check;
      saveCurrent.disabled = !ids.length;
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
                    ...option.payload(),
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
          el("label", { class: "check-label" }, saveCurrent, option.label),
          el(
            "p",
            { class: "hint switch-explanation" },
            "Timeline is saved automatically. Pinned tabs stay open."
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
    function aiSaved(c) {
      return topicOptions("Organise collection with AI", (include) => runCollectionAI(c, include));
    }
    async function runCollectionAI(c, regroupExisting) {
      if (groupingBusy) return;
      if (!data.connections.ai) {
        settingsDetails("AI connection");
        return;
      }
      const requestId = uid();
      let cancelled = false;
      groupingBusy = true;
      toast(el("span", { class: "grouping-progress" }, "Organising name, note and topic groups\u2026", button("Cancel", () => {
        cancelled = true;
        rpc("ai-cancel", { requestId });
      })), { duration: 0 });
      try {
        await change("collection-ai", { collectionId: c.id, windowId: win, regroupExisting, requestId });
      } catch (error) {
        toast(cancelled ? "AI organisation cancelled" : error.message, { error: !cancelled });
      } finally {
        groupingBusy = false;
      }
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
        ...!inLibrary ? [toggle("Show this window only", "currentWindowOnly")] : [],
        toggle("Auto-update all collections", "autoUpdateDefault"),
        ...!inLibrary ? [toggle("Auto-group new tabs", "autoGroup")] : [],
        row("Collapse all collections", act(() => change("collapse-collections", {})), "chevron"),
        el("hr"),
        row("AI connection", () => settingsDetails("AI connection"), "sparkles"),
        row("Notion", () => settingsDetails("Notion"), "note"),
        row("Grouping rules", () => rulesDialog({ state: data.state, tabs: data.tabs, change }), "group"),
        row("Open Library in its own window", () => change("library-window", {}), "external"),
        el("hr"),
        ...!inLibrary ? [row("Import data", importDialog, "plus")] : [],
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
      const autoGroup = el("input", { type: "checkbox", checked: s.autoGroup });
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
            "Calls go directly to your provider when you request AI assistance or enable automatic grouping, naming or ordering. Keys stay in extension-local storage, outside backups; they are not encrypted by an OS keychain."
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
          field("One URL pattern => group per line", rules),
          el("label", { class: "check-label" }, autoGroup, "Automatically group new ungrouped tabs using these rules"),
          el(
            "p",
            { class: "hint" },
            "Example: github.com/* => Github. First matching rule wins. Existing groups stay intact. AI is not needed."
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
              if (sectionName === "Domain rules") settings.autoGroup = autoGroup.checked;
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
    function dropSuggestions(c) {
      const options = el("div", {}), status = el("p", { class: "hint", role: "status" });
      const render = (rows) => options.replaceChildren(...rows.map((r) => button("File in " + (data.state.collections.find((x) => x.id === r.id)?.name || r.name), act(async () => {
        await change("ai-library-apply", { plan: { revision: data.state.revision, scope: { type: "all" }, actions: [{ type: "merge", collectionId: c.id, destinationId: r.id }] } });
        close();
      }), { title: r.reason || "Move these links, groups and notes into this collection" })));
      const { close } = popover("Name or file dropped tabs", el("div", {}, options, status), [button("Ask AI", act(async () => {
        status.textContent = "Finding a name and destinations\u2026";
        const result = await assist(data.state, { kind: "destinations", collectionId: c.id });
        render(result.destinations);
        status.textContent = "";
        if (result.name) options.prepend(button("Name this " + result.name, act(async () => {
          await change("edit", { kind: "collection", collectionId: c.id, name: result.name });
          close();
        })));
      }), { glyph: "sparkles" }), button("Keep here", () => close())]);
      rpc("destination-suggestions", { collectionId: c.id }).then(render).catch((error) => status.textContent = error.message);
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
      closeWindow: () => change("close-window", { windowId: win }),
      note: noteDialog,
      export: exportDialog,
      ai: aiSaved,
      aiTabs,
      overview: (c) => researchOverview({ state: data.state, collection: c, change }),
      dropSuggestions,
      arrangeRules: () => change("arrange-tabs", { windowId: win }),
      groupSort,
      sortTabs: (order) => change("sort-open-tabs", { windowId: win, order }),
      ruleSettings: (seed) => rulesDialog({ state: data.state, tabs: data.tabs, change, seed }),
      organisation: (scope) => organisationDialog({ state: data.state, scope, change }),
      recovery: recoveryDialog,
      settings: settingsDialog,
      aiSettings: () => settingsDetails("AI connection"),
      import: importDialog,
      previewImport
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
    if (order === "title") return [...tabs].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    if (order === "domain") return [...tabs].sort((a, b) => {
      const host = (t) => {
        try {
          return new URL(t.resourceUrl || t.url).hostname;
        } catch {
          return "";
        }
      };
      return host(a).localeCompare(host(b)) || a.index - b.index;
    });
    const sorted = [...tabs].sort(
      order === "recent" ? (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0) : (a, b) => a.windowId - b.windowId || a.index - b.index
    );
    return order === "reverse" ? sorted.reverse() : sorted;
  }
  function createTabTools({ getTabs, getSettings, change, actions, compact = false, showCloseAll = true, showTopicAI = true }) {
    const openGrouping = () => {
      const sort = more;
      const include = el("input", { type: "checkbox", checked: getSettings().regroupExisting !== false, "aria-label": "Include already grouped tabs" });
      const apply = button("Group & sort", task(async () => {
        const started = performance.now();
        delete sort.dataset.durationMs;
        sort.disabled = true;
        sort.setAttribute("aria-busy", "true");
        close();
        try {
          if (include.checked !== (getSettings().regroupExisting !== false)) await change("settings", { settings: { regroupExisting: include.checked } });
          const result = await actions.groupSort({ regroupExisting: include.checked });
          sort.dataset.operationId = result?.id || "";
          sort.dataset.timings = JSON.stringify({ operationMs: result?.durationMs, ...result?.timings });
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        } finally {
          sort.dataset.durationMs = String(Math.round(performance.now() - started));
          sort.disabled = false;
          sort.removeAttribute("aria-busy");
        }
      }), { className: "primary group-apply" });
      const { close } = popover("Group tabs", el("div", {}, el("p", { class: "hint" }, "Use rules, then websites. Order groups and tab titles A\u2013Z."), el("label", { class: "check-label" }, include, "Include already grouped tabs")), [apply], { anchor: sort });
    };
    const autoState = el("small", { class: "auto-group-state" });
    const auto = el("input", { type: "checkbox", role: "switch", "aria-label": "Auto-group new tabs", onchange: task(async (e) => {
      const enabled = e.target.checked;
      auto.disabled = true;
      try {
        await change("settings", { settings: { autoGroup: enabled } });
      } catch (error) {
        auto.checked = !enabled;
        throw error;
      } finally {
        auto.disabled = false;
        autoState.textContent = auto.checked ? "On" : "Off";
      }
    }) });
    const grouping = el("div", { class: "grouping-controls" }, el("label", { class: "settings-preference auto-group-control" }, el("span", {}, "Auto-group new tabs"), auto, autoState));
    const more = button("More tab actions", (e) => menu("Tab actions", [
      ["Group & sort", openGrouping, "group"],
      ...showTopicAI ? [["Group by topic with AI", () => actions.aiTabs(), "sparkles"], null] : [],
      ...[["recent", "Most recent first"], ["title", "Title A\u2013Z"], ["domain", "Website"]].map(([order, label]) => [label, () => actions.sortTabs(order)])
    ], { anchor: e.currentTarget, prefix: el("p", { class: "hint" }, "Reorder browser tabs in this window. Groups stay together; pinned tabs stay in place.") }), { glyph: "more", quiet: true, className: "tab-more-button" });
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
      grouping,
      more,
      save,
      dedup,
      ...showCloseAll ? [button("Close all", task(() => actions.closeWindow()), { className: "close-all-tabs", title: "Close all unpinned tabs in this window. Pinned tabs stay open." })] : []
    );
    function update() {
      auto.checked = getSettings().autoGroup !== false;
      autoState.textContent = auto.checked ? "On" : "Off";
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
    let data = await rpc("load", { includeTimeline: false }), win = await currentWindow(), groupId = null;
    let browseMode = "window", audioOnly = false;
    let list = false, selecting = false, controller, disposed = false, busy = false;
    const root = surface(), mount = globalThis.__neoSurface || document.body;
    const selected = /* @__PURE__ */ new Set(), tiles = /* @__PURE__ */ new Map(), previews = /* @__PURE__ */ new Map(), previewLoads = /* @__PURE__ */ new Map(), observers = /* @__PURE__ */ new Set();
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
            undo: action !== "undo-action" && (op.undoable || op.before || op.closed?.length) ? async () => {
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
        "position"
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
      let nextAttempt = 0;
      const load = async () => {
        if (disposed || Date.now() < nextAttempt) return;
        nextAttempt = Date.now() + 2500;
        if (!previews.has(url))
          previews.set(
            url,
            rpc("preview", { url }).catch(() => null)
          );
        const image = await previews.get(url);
        if (disposed) return;
        if (!image) {
          previews.delete(url);
          return;
        }
        try {
          const canvas = await rasterCanvas(image.data);
          if (!disposed) frame.replaceChildren(canvas);
          previewLoads.delete(frame);
          observer.disconnect();
          observers.delete(observer);
        } catch {
          previews.delete(url);
        }
      };
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            previewLoads.set(frame, load);
            load();
          } else previewLoads.delete(frame);
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
            b.style.setProperty("--color", colorHex(c.color));
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
      for (const [frame, load] of previewLoads) {
        if (!frame.isConnected) previewLoads.delete(frame);
        else load();
      }
      const g = ++generation, next = await rpc("load", { includeTimeline: false, allowBusy: true });
      if (disposed || g !== generation || next.layoutBusy) return;
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
      previewLoads.clear();
      backdrop.remove();
    };
  }

  // extension/ui/styles.css
  var styles_default = "/* SPDX-License-Identifier: MPL-2.0 */\r\n@layer base,layout,components;\r\n@layer base {\r\n  :root {\r\n    color-scheme: light dark;\r\n    --bg: light-dark(#fff, #232426);\r\n    --side: light-dark(#f7f7f5, #1c1d1f);\r\n    --panel: light-dark(#fff, #2c2d30);\r\n    --text: light-dark(#292b30, #ececef);\r\n    --muted: light-dark(#71747b, #a5a7ad);\r\n    --line: light-dark(#e9e9e6, #3a3c40);\r\n    --hover: light-dark(#efefed, #35363a);\r\n    --selected: light-dark(#e8ecff, #343f63);\r\n    --accent: light-dark(#575acb, #abb0ff);\r\n    --accent-fill: light-dark(#6264d8, #939bf4);\r\n    --on-accent: light-dark(#fff, #171d43);\r\n    --shadow: 0 12px 45px #0002;\r\n    --mint: light-dark(#b2e5c6, #93c5a7);\r\n    --blue: light-dark(#bdd1fc, #9db5e3);\r\n    --lavender: light-dark(#d6c7f3, #b3a2d4);\r\n    --peach: light-dark(#f3d0b7, #d7b094);\r\n    --rose: light-dark(#f0bdd5, #d59bb6);\r\n    --teal: light-dark(#b6dedc, #93bebc);\r\n    --yellow: light-dark(#f3e4a5, #d1c582);\r\n    --grey: light-dark(#dddeda, #aeb0ac);\r\n    font-family: Inter, 'Segoe UI', system-ui, sans-serif;\r\n    font-size: 14px;\r\n    line-height: 1.5;\r\n    background: var(--bg);\r\n    color: var(--text);\r\n  }\r\n  :root[data-theme='light'] {\r\n    color-scheme: light;\r\n  }\r\n  :root[data-theme='dark'] {\r\n    color-scheme: dark;\r\n  }\r\n  * {\r\n    box-sizing: border-box;\r\n  }\r\n  body {\r\n    margin: 0;\r\n  }\r\n  button,\r\n  input,\r\n  textarea,\r\n  select {\r\n    font: inherit;\r\n    color: inherit;\r\n  }\r\n  button {\r\n    border: 0;\r\n    background: transparent;\r\n    padding: 7px 10px;\r\n    border-radius: 6px;\r\n    cursor: pointer;\r\n    display: inline-flex;\r\n    align-items: center;\r\n    justify-content: center;\r\n    gap: 7px;\r\n    line-height: 1.4;\r\n  }\r\n  button:hover {\r\n    background: var(--hover);\r\n  }\r\n  button:disabled {\r\n    opacity: 0.5;\r\n    cursor: wait;\r\n  }\r\n  button:focus-visible,\r\n  a:focus-visible {\r\n    outline: 2px solid var(--accent);\r\n    outline-offset: 2px;\r\n  }\r\n  input,\r\n  textarea,\r\n  select {\r\n    width: 100%;\r\n    padding: 9px 10px;\r\n    border: 1px solid var(--line);\r\n    border-radius: 6px;\r\n    background: var(--bg);\r\n    outline: 0;\r\n  }\r\n  input:focus,\r\n  textarea:focus,\r\n  select:focus {\r\n    border-color: var(--accent);\r\n    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent);\r\n  }\r\n  input[type='checkbox'] {\r\n    width: 15px;\r\n    height: 15px;\r\n    accent-color: var(--accent);\r\n    padding: 0;\r\n    box-shadow: none;\r\n    flex: none;\r\n  }\r\n  textarea {\r\n    resize: vertical;\r\n    min-height: 85px;\r\n  }\r\n  svg {\r\n    width: 18px;\r\n    height: 18px;\r\n    flex: none;\r\n  }\r\n  h1,\r\n  h2,\r\n  h3,\r\n  p {\r\n    margin: 0;\r\n  }\r\n  h1 {\r\n    font-size: 29px;\r\n    letter-spacing: -0.8px;\r\n    font-weight: 630;\r\n  }\r\n  h2 {\r\n    font-size: 15px;\r\n    font-weight: 600;\r\n  }\r\n  h3 {\r\n    font-size: 14px;\r\n    font-weight: 600;\r\n  }\r\n  a {\r\n    color: var(--accent);\r\n    text-decoration: none;\r\n  }\r\n  a:hover {\r\n    text-decoration: underline;\r\n  }\r\n  [hidden] {\r\n    display: none !important;\r\n  }\r\n  small,\r\n  .muted {\r\n    font-size: 12px;\r\n    color: var(--muted);\r\n  }\r\n  kbd {\r\n    font: 11px inherit;\r\n    border: 1px solid var(--line);\r\n    padding: 0 5px;\r\n    border-radius: 4px;\r\n    color: var(--muted);\r\n  }\r\n  .primary {\r\n    background: var(--accent-fill);\r\n    color: var(--on-accent);\r\n  }\r\n  .primary:hover {\r\n    filter: brightness(0.96);\r\n    background: var(--accent-fill);\r\n  }\r\n  .danger {\r\n    color: light-dark(#bb414c, #ff9b9d);\r\n  }\r\n  .icon-button {\r\n    width: 30px;\r\n    height: 30px;\r\n    padding: 5px;\r\n    color: var(--muted);\r\n  }\r\n  .icon-button:hover {\r\n    color: var(--text);\r\n  }\r\n  .field {\r\n    display: flex;\r\n    flex-direction: column;\r\n    gap: 6px;\r\n    margin: 0 0 15px;\r\n  }\r\n  .field > span {\r\n    font-size: 13px;\r\n    font-weight: 550;\r\n  }\r\n  .check-label {\r\n    display: flex;\r\n    align-items: center;\r\n    gap: 8px;\r\n    margin: 13px 0;\r\n  }\r\n  .empty {\r\n    padding: 60px 24px;\r\n    text-align: center;\r\n    color: var(--muted);\r\n  }\r\n  .empty h2 {\r\n    font-size: 19px;\r\n    color: var(--text);\r\n    margin-bottom: 7px;\r\n  }\r\n  .empty p {\r\n    max-width: 370px;\r\n    margin: 0 auto 18px;\r\n  }\r\n  .favicon {\r\n    width: 18px;\r\n    height: 18px;\r\n    border-radius: 4px;\r\n    background: hsl(var(--hue) 35% 47%);\r\n    color: white;\r\n    font-size: 11px;\r\n    font-weight: 650;\r\n    display: inline-grid;\r\n    place-items: center;\r\n    flex: none;\r\n  }\r\n  .row-title {\r\n    flex: 1;\r\n    overflow: hidden;\r\n    text-overflow: ellipsis;\r\n    white-space: nowrap;\r\n    min-width: 0;\r\n  }\r\n  .hint {\r\n    color: var(--muted);\r\n    font-size: 12px;\r\n    margin-top: 8px;\r\n  }\r\n  .row {\r\n    display: flex;\r\n    align-items: center;\r\n    gap: 9px;\r\n    min-width: 0;\r\n  }\r\n  ::selection {\r\n    background: var(--selected);\r\n  }\r\n}\r\n@layer layout {\r\n  .app-shell {\r\n    display: grid;\r\n    grid-template-columns: 280px minmax(0, 1fr);\r\n    min-height: 100dvh;\r\n  }\r\n  .app-shell > aside {\r\n    background: var(--side);\r\n    border-right: 1px solid var(--line);\r\n    height: 100dvh;\r\n    position: sticky;\r\n    top: 0;\r\n    overflow: auto;\r\n    padding: 22px 15px 15px;\r\n    display: flex;\r\n    flex-direction: column;\r\n  }\r\n  .brand {\r\n    display: flex;\r\n    align-items: center;\r\n    gap: 9px;\r\n    padding: 0 7px 20px;\r\n  }\r\n  .brand strong {\r\n    font-size: 17px;\r\n    letter-spacing: -0.3px;\r\n  }\r\n  .brand-mark {\r\n    display: grid;\r\n    place-items: center;\r\n    background: var(--accent-fill);\r\n    color: var(--on-accent);\r\n    width: 25px;\r\n    height: 25px;\r\n    border-radius: 7px;\r\n    font-size: 24px;\r\n    line-height: 1;\r\n    font-weight: 700;\r\n  }\r\n  .brand button {\r\n    margin-left: auto;\r\n    padding: 5px;\r\n  }\r\n  .tab-search input {\r\n    background: var(--hover);\r\n    border-color: transparent;\r\n    font-size: 13px;\r\n    padding: 9px 11px;\r\n  }\r\n  .section-heading {\r\n    display: flex;\r\n    align-items: center;\r\n    justify-content: space-between;\r\n    margin: 23px 5px 13px;\r\n  }\r\n  .section-heading h2 span {\r\n    font-size: 11px;\r\n    font-weight: 400;\r\n    color: var(--muted);\r\n    margin-left: 3px;\r\n  }\r\n  #tab-tools {\r\n    display: flex;\r\n    gap: 1px;\r\n  }\r\n  .group-label {\r\n    font-size: 11px;\r\n    letter-spacing: 0.2px;\r\n    color: var(--muted);\r\n    margin: 15px 9px 5px;\r\n    display: flex;\r\n    align-items: center;\r\n    gap: 6px;\r\n  }\r\n  .group-dot {\r\n    width: 6px;\r\n    height: 6px;\r\n    background: var(--blue);\r\n    border-radius: 50%;\r\n  }\r\n  .tab-row {\r\n    display: flex;\r\n    align-items: center;\r\n    gap: 8px;\r\n    min-height: 36px;\r\n    padding: 3px 7px;\r\n    border-radius: 5px;\r\n    position: relative;\r\n    font-size: 13px;\r\n    user-select: none;\r\n  }\r\n  .tab-row:hover {\r\n    background: var(--hover);\r\n  }\r\n  .tab-row.selected {\r\n    background: var(--selected);\r\n  }\r\n  .tab-row .tab-select {\r\n    position: absolute;\r\n    left: 8px;\r\n    opacity: 0;\r\n    z-index: 1;\r\n  }\r\n  .tab-row:is(:hover, :has(:focus-visible), .selected) .tab-select {\r\n    opacity: 1;\r\n  }\r\n  .tab-row:is(:hover, :has(:focus-visible), .selected) > .favicon {\r\n    visibility: hidden;\r\n  }\r\n  .tab-row .tab-open {\r\n    display: flex;\r\n    justify-content: flex-start;\r\n    padding: 4px 0;\r\n    flex: 1;\r\n    min-width: 0;\r\n    text-align: left;\r\n  }\r\n  .tab-row .tab-open:hover {\r\n    background: transparent;\r\n  }\r\n  .tab-row .row-close {\r\n    opacity: 0;\r\n    width: 23px;\r\n    height: 23px;\r\n  }\r\n  .tab-row:is(:hover, :has(:focus-visible)) .row-close {\r\n    opacity: 1;\r\n  }\r\n  .tab-row .row-close svg {\r\n    width: 14px;\r\n    height: 14px;\r\n  }\r\n  #selection {\r\n    margin: 12px 3px;\r\n    padding: 10px;\r\n    background: var(--panel);\r\n    border: 1px solid var(--line);\r\n    border-radius: 7px;\r\n  }\r\n  #selection .row {\r\n    margin-bottom: 7px;\r\n  }\r\n  #selection strong {\r\n    font-size: 12px;\r\n    flex: 1;\r\n  }\r\n  #selection button {\r\n    font-size: 12px;\r\n    padding: 5px 7px;\r\n  }\r\n  .sidebar-bottom {\r\n    margin-top: auto;\r\n    padding: 24px 6px 0;\r\n    display: flex;\r\n    gap: 8px;\r\n  }\r\n  .sidebar-bottom button {\r\n    font-size: 12px;\r\n    color: var(--muted);\r\n  }\r\n  #recent {\r\n    border-top: 1px solid var(--line);\r\n    margin: 24px 7px 0;\r\n    padding-top: 19px;\r\n  }\r\n  #recent h2 {\r\n    font-size: 13px;\r\n    margin-bottom: 11px;\r\n  }\r\n  #recent .recent-link {\r\n    font-size: 12px;\r\n    display: flex;\r\n    justify-content: flex-start;\r\n    width: 100%;\r\n    padding: 7px 0;\r\n  }\r\n  .page-head {\r\n    display: flex;\r\n    align-items: center;\r\n    justify-content: space-between;\r\n    gap: 20px;\r\n    margin-bottom: 28px;\r\n  }\r\n  .eyebrow {\r\n    color: var(--muted);\r\n    font-size: 10px;\r\n    letter-spacing: 1.3px;\r\n    margin: 0 0 7px;\r\n    font-weight: 600;\r\n  }\r\n  .head-actions {\r\n    display: flex;\r\n    align-items: center;\r\n    gap: 12px;\r\n  }\r\n  .head-actions button {\r\n    font-size: 12px;\r\n  }\r\n  #global-search {\r\n    color: var(--muted);\r\n  }\r\n  #main {\r\n    padding: 40px clamp(24px, 4vw, 72px) 70px;\r\n    max-width: 1700px;\r\n    width: 100%;\r\n    margin: 0 auto;\r\n  }\r\n  .library-tools {\r\n    display: flex;\r\n    justify-content: space-between;\r\n    align-items: center;\r\n    margin-bottom: 23px;\r\n    min-height: 32px;\r\n    color: var(--muted);\r\n    font-size: 12px;\r\n  }\r\n  #breadcrumbs {\r\n    display: flex;\r\n    align-items: center;\r\n    gap: 5px;\r\n  }\r\n  #breadcrumbs button {\r\n    font-size: 12px;\r\n  }\r\n  #view-tools {\r\n    display: flex;\r\n    align-items: center;\r\n    gap: 4px;\r\n  }\r\n  #board {\r\n    display: grid;\r\n    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));\r\n    gap: 30px 28px;\r\n    align-items: start;\r\n  }\r\n  #board.detail {\r\n    display: block;\r\n    max-width: none;\r\n  }\r\n  .collection {\r\n    min-width: 0;\r\n    /* Cards are rebuilt after collection edits: estimated offscreen heights\r\n       would reset and make the board jump before their next layout. */\r\n    border-radius: 7px;\r\n    background: color-mix(in srgb, var(--color) 4%, var(--bg));\r\n  }\r\n  .collection-head {\r\n    display: flex;\r\n    align-items: center;\r\n    background: var(--color);\r\n    color: #252935;\r\n    border-radius: 6px;\r\n    padding: 4px 7px 4px 13px;\r\n    min-height: 39px;\r\n    gap: 6px;\r\n  }\r\n  .collection-head > .collection-name {\r\n    font-weight: 600;\r\n    font-size: 14px;\r\n    flex: 1;\r\n    justify-content: flex-start;\r\n    min-width: 0;\r\n    padding: 4px 0;\r\n  }\r\n  .collection-head > .collection-name:hover {\r\n    background: transparent;\r\n    text-decoration: underline;\r\n  }\r\n  .collection-head > small {\r\n    color: #354054;\r\n    font-size: 11px;\r\n  }\r\n  .collection-head .icon-button {\r\n    color: #354054;\r\n  }\r\n  .collection-body {\r\n    padding: 9px 6px 12px;\r\n  }\r\n  .saved-row {\r\n    display: flex;\r\n    align-items: center;\r\n    gap: 8px;\r\n    border-radius: 5px;\r\n    padding: 2px 6px;\r\n    min-height: 34px;\r\n    position: relative;\r\n  }\r\n  .saved-row:hover {\r\n    background: var(--hover);\r\n  }\r\n  .saved-row > .link-open {\r\n    padding: 4px 0;\r\n    min-width: 0;\r\n    flex: 1;\r\n    text-align: left;\r\n    justify-content: flex-start;\r\n    font-size: 13px;\r\n  }\r\n  .saved-row > .link-open:hover {\r\n    background: transparent;\r\n  }\r\n  .saved-row .icon-button {\r\n    opacity: 0;\r\n    width: 24px;\r\n    height: 24px;\r\n  }\r\n  .saved-row:is(:hover, :focus-within) .icon-button {\r\n    opacity: 1;\r\n  }\r\n  .saved-row input[type='checkbox'] {\r\n    margin: 0;\r\n  }\r\n  .saved-group {\r\n    margin-top: 5px;\r\n  }\r\n  .group-toggle {\r\n    display: flex;\r\n    justify-content: flex-start;\r\n    width: 100%;\r\n    gap: 7px;\r\n    font-size: 12px;\r\n    color: var(--muted);\r\n    padding: 6px;\r\n  }\r\n  .group-toggle svg {\r\n    width: 14px;\r\n    height: 14px;\r\n  }\r\n  .group-toggle span {\r\n    flex: 1;\r\n    text-align: left;\r\n  }\r\n  .group-members {\r\n    margin-left: 12px;\r\n    border-left: 1px solid var(--line);\r\n    padding-left: 5px;\r\n  }\r\n  .collection-note {\r\n    border: 0;\r\n    border-left: 2px solid var(--color);\r\n    border-radius: 0;\r\n    min-height: 0;\r\n    width: calc(100% - 12px);\r\n    margin: 9px 6px 0;\r\n    padding: 12px 14px;\r\n    font-size: 15px;\r\n    line-height: 1.65;\r\n    background: color-mix(in srgb, var(--color) 11%, var(--bg));\r\n    color: var(--text);\r\n    resize: vertical;\r\n  }\r\n  .collection-footer {\r\n    padding: 5px 4px 0;\r\n    display: flex;\r\n    gap: 4px;\r\n    opacity: 0;\r\n  }\r\n  .collection:hover .collection-footer,\r\n  .collection:focus-within .collection-footer {\r\n    opacity: 1;\r\n  }\r\n  .collection-footer button {\r\n    font-size: 11px;\r\n    color: var(--muted);\r\n  }\r\n  .collection.drag-over {\r\n    outline: 2px solid var(--accent);\r\n    outline-offset: 4px;\r\n  }\r\n  .collection .empty {\r\n    padding: 18px 6px;\r\n    text-align: left;\r\n    font-size: 12px;\r\n  }\r\n  .detail .collection-head {\r\n    min-height: 46px;\r\n  }\r\n  .detail .collection-body {\r\n    padding-top: 13px;\r\n  }\r\n  .detail .saved-row {\r\n    min-height: 40px;\r\n  }\r\n  .detail .collection-note {\r\n    font-size: 15px;\r\n  }\r\n  .detail .collection-footer {\r\n    opacity: 1;\r\n  }\r\n  .list-view {\r\n    grid-template-columns: 1fr !important;\r\n    max-width: none;\r\n  }\r\n  .list-view .collection {\r\n    content-visibility: auto;\r\n  }\r\n  .view-active {\r\n    background: var(--hover);\r\n    color: var(--text);\r\n  }\r\n  @media (min-width: 1700px) {\r\n    #board {\r\n      grid-template-columns: repeat(3, minmax(280px, 1fr));\r\n    }\r\n  }\r\n  @media (max-width: 1000px) {\r\n    .app-shell {\r\n      grid-template-columns: 248px minmax(0, 1fr);\r\n    }\r\n    #main {\r\n      padding: 30px 25px;\r\n    }\r\n    #board {\r\n      grid-template-columns: 1fr;\r\n    }\r\n    .head-actions {\r\n      gap: 3px;\r\n    }\r\n    #global-search kbd {\r\n      display: none;\r\n    }\r\n  }\r\n  @media (max-width: 640px) {\r\n    .app-shell {\r\n      display: block;\r\n    }\r\n    .app-shell > aside {\r\n      position: relative;\r\n      height: auto;\r\n      max-height: 45dvh;\r\n      border-right: 0;\r\n      border-bottom: 1px solid var(--line);\r\n      padding: 15px;\r\n    }\r\n    .brand {\r\n      padding-bottom: 10px;\r\n    }\r\n    .section-heading {\r\n      margin: 13px 5px 8px;\r\n    }\r\n    .sidebar-bottom,\r\n    #recent {\r\n      display: none;\r\n    }\r\n    #main {\r\n      padding: 25px 17px;\r\n    }\r\n    .page-head {\r\n      gap: 10px;\r\n    }\r\n    .head-actions {\r\n      flex-direction: column;\r\n      align-items: flex-end;\r\n    }\r\n    h1 {\r\n      font-size: 26px;\r\n    }\r\n    .eyebrow {\r\n      font-size: 9px;\r\n    }\r\n    #board {\r\n      gap: 22px;\r\n    }\r\n    .collection-footer {\r\n      opacity: 1;\r\n    }\r\n  }\r\n  @media (pointer: coarse) {\r\n    .tab-row .tab-select {\r\n      position: static;\r\n      opacity: 1;\r\n    }\r\n    .tab-row > .favicon {\r\n      visibility: visible !important;\r\n    }\r\n    .tab-row .row-close,\r\n    .saved-row .icon-button {\r\n      opacity: 1;\r\n    }\r\n    button {\r\n      min-height: 34px;\r\n    }\r\n  }\r\n  @media (prefers-reduced-motion: reduce) {\r\n    * {\r\n      scroll-behavior: auto !important;\r\n      transition: none !important;\r\n    }\r\n  }\r\n}\r\n@layer components {\r\n  dialog {\r\n    color: var(--text);\r\n    background: var(--panel);\r\n    border: 1px solid var(--line);\r\n    border-radius: 11px;\r\n    padding: 0;\r\n    width: min(560px, calc(100vw - 32px));\r\n    max-height: 85dvh;\r\n    box-shadow: var(--shadow);\r\n  }\r\n  dialog::backdrop {\r\n    background: #12162355;\r\n  }\r\n  .dialog-head {\r\n    display: flex;\r\n    align-items: center;\r\n    justify-content: space-between;\r\n    padding: 20px 23px 12px;\r\n  }\r\n  .dialog-head h2 {\r\n    font-size: 18px;\r\n    letter-spacing: -0.3px;\r\n  }\r\n  .dialog-body {\r\n    padding: 10px 23px 23px;\r\n    overflow: auto;\r\n    max-height: 65dvh;\r\n  }\r\n  dialog footer {\r\n    padding: 13px 23px 19px;\r\n    display: flex;\r\n    justify-content: flex-end;\r\n    gap: 8px;\r\n    border-top: 1px solid var(--line);\r\n  }\r\n  .dialog-body .actions {\r\n    display: grid;\r\n    gap: 4px;\r\n  }\r\n  .actions > button {\r\n    justify-content: flex-start;\r\n    text-align: left;\r\n  }\r\n  .swatches {\r\n    display: flex;\r\n    gap: 8px;\r\n    margin: 12px 0;\r\n  }\r\n  .swatch {\r\n    width: 24px;\r\n    height: 24px;\r\n    border-radius: 50%;\r\n    padding: 0;\r\n    border: 2px solid transparent;\r\n  }\r\n  .swatch.selected {\r\n    outline: 2px solid var(--accent);\r\n    outline-offset: 2px;\r\n  }\r\n  .stash {\r\n    position: fixed;\r\n    inset: auto;\r\n    margin: 0;\r\n    border: 1px solid var(--line);\r\n    border-radius: 8px;\r\n    background: var(--panel);\r\n    color: var(--text);\r\n    box-shadow: var(--shadow);\r\n    padding: 18px;\r\n    width: 286px;\r\n    max-width: calc(100vw - 24px);\r\n  }\r\n  .stash h3 {\r\n    font-size: 13px;\r\n    font-weight: 550;\r\n  }\r\n  .stash .row {\r\n    margin-top: 16px;\r\n    gap: 8px;\r\n  }\r\n  .stash button {\r\n    font-size: 12px;\r\n  }\r\n  .stash .check-label {\r\n    font-size: 13px;\r\n  }\r\n  .settings-section {\r\n    border-top: 1px solid var(--line);\r\n    padding-top: 19px;\r\n    margin-top: 23px;\r\n  }\r\n  .settings-section h3 {\r\n    margin-bottom: 16px;\r\n  }\r\n  .settings-section .hint {\r\n    margin-bottom: 12px;\r\n  }\r\n  .settings-row {\r\n    display: grid;\r\n    grid-template-columns: 1fr 1fr;\r\n    gap: 14px;\r\n  }\r\n  #toast {\r\n    position: fixed;\r\n    bottom: 24px;\r\n    left: 50%;\r\n    transform: translateX(-50%);\r\n    background: var(--panel);\r\n    border: 1px solid var(--line);\r\n    box-shadow: var(--shadow);\r\n    padding: 10px 13px;\r\n    border-radius: 8px;\r\n    display: flex;\r\n    align-items: center;\r\n    gap: 16px;\r\n    max-width: calc(100vw - 30px);\r\n    z-index: 30;\r\n    font-size: 13px;\r\n  }\r\n  #toast.error {\r\n    border-color: light-dark(#cf767e, #b05964);\r\n  }\r\n  #toast button {\r\n    color: var(--accent);\r\n    font-size: 12px;\r\n  }\r\n  .search-input {\r\n    font-size: 16px;\r\n    padding: 12px;\r\n    border: 0;\r\n    border-bottom: 1px solid var(--line);\r\n    border-radius: 0;\r\n  }\r\n  .search-result {\r\n    width: 100%;\r\n    justify-content: flex-start;\r\n    text-align: left;\r\n    min-height: 49px;\r\n    padding: 9px 12px;\r\n  }\r\n  .search-result small {\r\n    display: block;\r\n    font-size: 11px;\r\n  }\r\n  .search-result .row-title {\r\n    white-space: normal;\r\n  }\r\n  .search-result:focus {\r\n    background: var(--selected);\r\n    outline: 0;\r\n  }\r\n  .search-result > .badge {\r\n    font-size: 10px;\r\n    color: var(--muted);\r\n    margin-left: auto;\r\n  }\r\n  .search-results {\r\n    max-height: 380px;\r\n    overflow: auto;\r\n    padding: 6px;\r\n  }\r\n  .search-scope {\r\n    padding: 6px 12px;\r\n  }\r\n  .quick-body {\r\n    width: 620px;\r\n    min-width: 560px;\r\n    max-width: none;\r\n    min-height: 160px;\r\n    max-height: 590px;\r\n    overflow: hidden;\r\n    background: var(--bg);\r\n  }\r\n  .quick-head {\r\n    display: flex;\r\n    padding: 12px;\r\n    align-items: center;\r\n    gap: 8px;\r\n    border-bottom: 1px solid var(--line);\r\n  }\r\n  .quick-head input {\r\n    border: 0;\r\n    background: var(--side);\r\n    padding: 10px;\r\n    flex: 1;\r\n    min-width: 0;\r\n  }\r\n  .quick-grid {\r\n    display: grid;\r\n    grid-template-columns: repeat(3, minmax(0, 1fr));\r\n    gap: 10px;\r\n    padding: 14px;\r\n    max-height: 480px;\r\n    overflow: auto;\r\n  }\r\n  .preview-tile {\r\n    display: block;\r\n    text-align: left;\r\n    padding: 0;\r\n    border: 1px solid var(--line);\r\n    background: var(--panel);\r\n    overflow: hidden;\r\n    border-radius: 7px;\r\n  }\r\n  .preview-tile:focus {\r\n    outline: 2px solid var(--accent);\r\n    outline-offset: 1px;\r\n    background: var(--selected);\r\n  }\r\n  .preview-image {\r\n    height: 105px;\r\n    width: 100%;\r\n    background: var(--side);\r\n    display: flex;\r\n    align-items: center;\r\n    justify-content: center;\r\n    overflow: hidden;\r\n  }\r\n  .preview-image > :is(img, canvas) {\r\n    width: 100%;\r\n    height: 100%;\r\n    object-fit: cover;\r\n    object-position: top;\r\n    display: block;\r\n  }\r\n  .preview-image .muted {\r\n    font-size: 11px;\r\n  }\r\n  .preview-info {\r\n    padding: 9px 10px;\r\n  }\r\n  .preview-info strong {\r\n    display: block;\r\n    font-size: 12px;\r\n    font-weight: 550;\r\n    white-space: nowrap;\r\n    overflow: hidden;\r\n    text-overflow: ellipsis;\r\n  }\r\n  .preview-info small {\r\n    display: block;\r\n    font-size: 10px;\r\n    margin-top: 2px;\r\n  }\r\n  .group-preview {\r\n    display: grid;\r\n    grid-template-columns: 1fr 1fr;\r\n    gap: 4px;\r\n    padding: 8px;\r\n    background: color-mix(in srgb, var(--blue) 25%, var(--bg));\r\n    height: 105px;\r\n  }\r\n  .group-preview .preview-image {\r\n    height: 42px;\r\n    border-radius: 3px;\r\n  }\r\n  .group-preview .preview-image .muted {\r\n    font-size: 8px;\r\n  }\r\n  .plan-group {\r\n    border: 1px solid var(--line);\r\n    border-radius: 6px;\r\n    padding: 11px;\r\n    margin: 10px 0;\r\n  }\r\n  .plan-group ul {\r\n    padding-left: 23px;\r\n    font-size: 12px;\r\n    color: var(--muted);\r\n    margin: 9px 0 0;\r\n  }\r\n  .review-list {\r\n    max-height: 240px;\r\n    overflow: auto;\r\n    border: 1px solid var(--line);\r\n    border-radius: 6px;\r\n    padding: 5px;\r\n  }\r\n  .review-list > label {\r\n    display: flex;\r\n    align-items: center;\r\n    gap: 9px;\r\n    font-size: 12px;\r\n    padding: 7px;\r\n  }\r\n  .recovery-row {\r\n    padding: 12px 0;\r\n    border-bottom: 1px solid var(--line);\r\n  }\r\n  .recovery-row .row {\r\n    justify-content: space-between;\r\n  }\r\n  .recovery-row p {\r\n    font-size: 12px;\r\n    color: var(--muted);\r\n  }\r\n  .parked-page {\r\n    display: grid;\r\n    place-items: center;\r\n    min-height: 100dvh;\r\n  }\r\n  .parked-card {\r\n    max-width: 500px;\r\n    padding: 35px;\r\n  }\r\n  .parked-spinner {\r\n    width: 28px;\r\n    height: 28px;\r\n    border: 2px solid var(--line);\r\n    border-top-color: var(--accent);\r\n    border-radius: 50%;\r\n    animation: parked-spin 0.8s linear infinite;\r\n  }\r\n  @keyframes parked-spin {\r\n    to {\r\n      transform: rotate(360deg);\r\n    }\r\n  }\r\n  @media (prefers-reduced-motion: reduce) {\r\n    .parked-spinner {\r\n      animation: none;\r\n    }\r\n  }\r\n  .parked-card p {\r\n    margin-bottom: 20px;\r\n    color: var(--muted);\r\n  }\r\n  @media (max-width: 640px) {\r\n    .quick-body.search-window {\r\n      width: 100%;\r\n      min-width: 0;\r\n    }\r\n    .quick-grid {\r\n      grid-template-columns: repeat(2, minmax(0, 1fr));\r\n    }\r\n    .settings-row {\r\n      grid-template-columns: 1fr;\r\n    }\r\n    .preview-image {\r\n      height: 95px;\r\n    }\r\n  }\r\n}\r\n\r\n.quick-body.search-window {\r\n  width: 100%;\r\n  min-width: 0;\r\n}\r\n.search-result[role='option'] {\r\n  cursor: pointer;\r\n  display: flex;\r\n  gap: 10px;\r\n  align-items: center;\r\n  border-radius: 5px;\r\n}\r\n.search-result[role='option'][aria-selected='true'] {\r\n  background: var(--selected);\r\n}\r\n.search-result[role='option']:hover {\r\n  background: var(--hover);\r\n}\r\n.scope-chip {\r\n  background: var(--selected);\r\n  font-size: 12px;\r\n  padding: 4px 8px;\r\n}\r\n.search-scope {\r\n  display: flex;\r\n  gap: 6px;\r\n  flex-wrap: wrap;\r\n}\r\n.search-dialog {\r\n  width: min(680px, calc(100vw - 28px));\r\n}\r\n.search-dialog > .search-input {\r\n  width: calc(100% - 24px);\r\n  margin: 0 12px;\r\n}\r\n.search-window {\r\n  min-height: 300px;\r\n  max-height: none;\r\n  overflow: auto;\r\n}\r\n.search-window .search-results {\r\n  max-height: calc(100dvh - 106px);\r\n}\r\n.group-header {\r\n  display: flex;\r\n  align-items: center;\r\n  min-width: 0;\r\n}\r\n.group-header .group-toggle {\r\n  flex: 1;\r\n  min-width: 0;\r\n}\r\n.group-toggle span {\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n.group-header > .icon-button {\r\n  opacity: 0;\r\n  flex: none;\r\n  width: 25px;\r\n  height: 25px;\r\n}\r\n.group-header:is(:hover, :focus-within) > .icon-button {\r\n  opacity: 1;\r\n}\r\n.more-links {\r\n  font-size: 12px;\r\n  color: var(--muted);\r\n  margin: 3px 6px;\r\n}\r\n.collection-head > .collection-name {\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n  display: block;\r\n  text-align: left;\r\n}\r\n.collection-footer {\r\n  flex-wrap: wrap;\r\n}\r\n.recovery-row .row {\r\n  flex-wrap: wrap;\r\n}\r\ndialog .row-title {\r\n  min-width: 0;\r\n}\r\n@media (pointer: coarse) {\r\n  .group-header > .icon-button {\r\n    opacity: 1;\r\n  }\r\n}\r\n.favicon {\r\n  position: relative;\r\n}\r\n.favicon.has-icon {\r\n  background: transparent;\r\n  color: transparent;\r\n}\r\n.favicon :is(img, canvas) {\r\n  position: absolute;\r\n  width: 18px;\r\n  height: 18px;\r\n  inset: 0;\r\n  background: var(--bg);\r\n  border-radius: 3px;\r\n}\r\n.link-picker {\r\n  margin: 14px 0;\r\n}\r\n.link-picker > .row {\r\n  justify-content: space-between;\r\n  flex-wrap: wrap;\r\n  margin-bottom: 7px;\r\n}\r\n.link-picker > .row button {\r\n  font-size: 12px;\r\n  padding: 4px 7px;\r\n}\r\n.link-picker > input {\r\n  margin-bottom: 8px;\r\n}\r\n.link-picker .review-list {\r\n  max-height: 210px;\r\n}\r\nprogress {\r\n  width: 100%;\r\n  height: 7px;\r\n  accent-color: var(--accent);\r\n  margin: 16px 0;\r\n}\r\n.help-page {\r\n  max-width: 760px;\r\n  padding: 44px 24px 80px;\r\n  margin: auto;\r\n}\r\n.help-page h1 {\r\n  margin: 20px 0 32px;\r\n}\r\n.help-page section {\r\n  margin: 30px 0;\r\n}\r\n.help-page h2 {\r\n  font-size: 18px;\r\n  margin-bottom: 10px;\r\n}\r\n.help-page p {\r\n  margin: 10px 0;\r\n  color: var(--muted);\r\n  line-height: 1.75;\r\n}\r\n.help-page code {\r\n  color: var(--text);\r\n}\r\n\r\n/* Direct organization: spaces, editable titles, and a final add row. */\r\n#spaces {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 6px;\r\n  min-width: 0;\r\n  overflow-x: auto;\r\n  padding: 3px;\r\n}\r\n.space-tab {\r\n  display: flex;\r\n  align-items: center;\r\n  flex: none;\r\n  border-bottom: 2px solid transparent;\r\n}\r\n.space-tab.active {\r\n  border-color: var(--accent);\r\n}\r\n.space-tab > button,\r\n.space-tab > input {\r\n  font-size: 17px;\r\n  font-weight: 600;\r\n}\r\n.space-tab > .icon-button {\r\n  padding: 4px;\r\n}\r\n.space-tab .inline-name {\r\n  width: 170px;\r\n}\r\n.page-head {\r\n  align-items: flex-start;\r\n  flex-wrap: wrap;\r\n  gap: 16px;\r\n  margin-bottom: 24px;\r\n}\r\n.head-actions {\r\n  flex: none;\r\n  flex-wrap: wrap;\r\n  gap: 5px;\r\n}\r\n#save-current,\r\n#switch-collection {\r\n  background: var(--side);\r\n}\r\n.add-collection {\r\n  min-height: 44px;\r\n  align-self: start;\r\n  justify-content: flex-start;\r\n  padding: 10px 14px;\r\n  color: var(--muted);\r\n  background: var(--side);\r\n  border: 1px dashed var(--line);\r\n  font-weight: 550;\r\n}\r\n.add-collection:hover {\r\n  color: var(--text);\r\n  border-color: var(--muted);\r\n}\r\n.inline-name {\r\n  min-width: 0;\r\n  padding: 4px 6px;\r\n  background: transparent;\r\n  border: 1px solid currentColor;\r\n}\r\n.editable-name {\r\n  text-align: left;\r\n  justify-content: flex-start;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n.collection-head > input.collection-name {\r\n  padding: 4px 6px;\r\n  background: #ffffff40;\r\n}\r\n.collection-head {\r\n  min-height: 44px;\r\n}\r\n.collection-head .icon-button {\r\n  width: 28px;\r\n  height: 30px;\r\n  padding: 4px;\r\n  opacity: 0.45;\r\n}\r\n.collection-head:is(:hover, :focus-within) .icon-button {\r\n  opacity: 1;\r\n}\r\n.group-header .group-toggle {\r\n  flex: none;\r\n  width: auto;\r\n  gap: 6px;\r\n}\r\n.group-header > .editable-name,\r\n.group-header > .inline-name {\r\n  flex: 1;\r\n  min-width: 0;\r\n}\r\n.group-label {\r\n  display: flex;\r\n  align-items: center;\r\n}\r\n.group-label > .editable-name,\r\n.group-label > .inline-name {\r\n  min-width: 0;\r\n  padding: 3px 5px;\r\n}\r\n.saved-row > .icon-button {\r\n  flex: none;\r\n  width: 25px;\r\n  height: 28px;\r\n  padding: 4px;\r\n}\r\n.saved-row .remove-link:hover {\r\n  color: light-dark(#b43343, #ffb2ba);\r\n}\r\n#dedup {\r\n  position: relative;\r\n  overflow: visible;\r\n}\r\n#dedup:disabled {\r\n  cursor: default;\r\n}\r\n.count-badge {\r\n  position: absolute;\r\n  top: -4px;\r\n  right: -3px;\r\n  min-width: 15px;\r\n  height: 15px;\r\n  padding: 0 3px;\r\n  font-size: 10px;\r\n  line-height: 15px;\r\n  border-radius: 9px;\r\n  background: var(--text);\r\n  color: var(--bg);\r\n  font-weight: 650;\r\n}\r\n.action-popover {\r\n  position: fixed;\r\n  margin: 0;\r\n  width: 330px;\r\n  max-width: calc(100vw - 24px);\r\n  padding: 20px;\r\n  border: 1px solid var(--line);\r\n  border-radius: 10px;\r\n  box-shadow: var(--shadow);\r\n  background: var(--panel);\r\n  color: var(--text);\r\n}\r\n.action-popover h2 {\r\n  margin-bottom: 16px;\r\n}\r\n.action-popover footer {\r\n  display: flex;\r\n  justify-content: flex-end;\r\n  margin-top: 16px;\r\n}\r\n\r\n/* A transient Windows-style switcher, with the current page visible around it. */\r\n.full-switcher {\r\n  margin: 0;\r\n  overflow: hidden;\r\n}\r\n.switcher-backdrop {\r\n  position: fixed;\r\n  inset: 0;\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n  padding: 32px;\r\n  background: light-dark(#00000020, #00000045);\r\n  color: var(--text);\r\n  font:\r\n    14px/1.5 'Segoe UI',\r\n    system-ui,\r\n    sans-serif;\r\n}\r\n.task-view {\r\n  display: flex;\r\n  flex-direction: column;\r\n  width: min(1180px, 100%);\r\n  max-height: min(86dvh, 900px);\r\n  min-height: 0;\r\n  padding: 22px 24px 14px;\r\n  gap: 16px;\r\n  color: var(--text);\r\n  background: light-dark(#f4f4f2e6, #282a2ee6);\r\n  border: 1px solid light-dark(#ffffffaa, #ffffff28);\r\n  border-radius: 14px;\r\n  box-shadow:\r\n    0 22px 80px #0005,\r\n    inset 0 1px 0 #ffffff12;\r\n  backdrop-filter: blur(32px) saturate(135%);\r\n}\r\n.task-view [hidden] {\r\n  display: none !important;\r\n}\r\n.task-view button:disabled {\r\n  cursor: default;\r\n}\r\n.task-head,\r\n.task-title,\r\n.view-choices {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 10px;\r\n}\r\n.task-head {\r\n  flex: none;\r\n}\r\n.task-title {\r\n  flex: 1;\r\n  align-items: baseline;\r\n}\r\n.task-title h1 {\r\n  font-size: 20px;\r\n  letter-spacing: -0.35px;\r\n}\r\n.task-title .muted {\r\n  font-size: 12px;\r\n}\r\n.task-head > button {\r\n  font-size: 12px;\r\n}\r\n.task-view .quick-head {\r\n  flex: none;\r\n  padding: 0;\r\n  border: 0;\r\n  gap: 10px;\r\n}\r\n.task-view .quick-head input {\r\n  background: light-dark(#ffffffb8, #15171999);\r\n  border: 1px solid var(--line);\r\n  padding: 10px 12px;\r\n  font-size: 14px;\r\n}\r\n.view-choices {\r\n  gap: 2px;\r\n}\r\n.view-choices button,\r\n#select-mode {\r\n  white-space: nowrap;\r\n  font-size: 12px;\r\n}\r\n#select-mode {\r\n  border: 1px solid var(--line);\r\n  margin-left: 4px;\r\n}\r\n#select-mode[aria-pressed='true'] {\r\n  background: var(--selected);\r\n  border-color: var(--accent);\r\n}\r\n.task-view .quick-grid {\r\n  grid-template-columns: repeat(var(--columns, 3), minmax(0, 340px));\r\n  gap: 18px;\r\n  justify-content: center;\r\n  padding: 7px;\r\n  margin: -7px;\r\n  align-content: start;\r\n  min-height: 0;\r\n  max-height: min(50dvh, 550px);\r\n  overflow-y: auto;\r\n  flex: 0 1 auto;\r\n}\r\n.switcher-card {\r\n  position: relative;\r\n  min-width: 0;\r\n  border-radius: 9px;\r\n}\r\n.task-view .preview-tile {\r\n  width: 100%;\r\n  border: 1px solid light-dark(#00000016, #ffffff1c);\r\n  border-radius: 8px;\r\n  background: light-dark(#ffffffa8, #17191dbb);\r\n  box-shadow: 0 2px 7px #0002;\r\n}\r\n.task-view .preview-tile:hover {\r\n  border-color: var(--muted);\r\n  background: var(--panel);\r\n}\r\n.task-view .preview-tile:focus-visible,\r\n.task-view .tab-choice:focus-visible {\r\n  outline: 3px solid light-dark(#087cca, #68caff);\r\n  outline-offset: 3px;\r\n}\r\n.task-view .preview-image {\r\n  width: 100%;\r\n  height: auto;\r\n  aspect-ratio: 16 / 10;\r\n  background: var(--side);\r\n}\r\n.task-view .preview-image > :is(img, canvas) {\r\n  object-fit: cover;\r\n  object-position: top;\r\n}\r\n.tile-topline {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 8px;\r\n  height: 36px;\r\n  padding: 7px 10px;\r\n}\r\n.tile-topline > span:not(.favicon):not(.selection-mark) {\r\n  flex: 1;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n  font-size: 12px;\r\n}\r\n.task-view .group-tile {\r\n  box-shadow:\r\n    0 -4px 0 -1px var(--blue),\r\n    0 -8px 0 -3px color-mix(in srgb, var(--blue) 45%, var(--panel));\r\n  margin-top: 4px;\r\n}\r\n.task-view .preview-info {\r\n  padding: 7px 11px 8px;\r\n}\r\n.task-view .preview-info small {\r\n  margin: 0;\r\n  font-size: 11px;\r\n  color: var(--muted);\r\n}\r\n.preview-missing {\r\n  display: flex;\r\n  flex-direction: column;\r\n  align-items: center;\r\n  text-align: center;\r\n  gap: 6px;\r\n  padding: 20px;\r\n  font-size: 14px;\r\n}\r\n.preview-missing small {\r\n  font-size: 11px;\r\n  color: var(--muted);\r\n}\r\n.task-view .search-results {\r\n  min-height: 0;\r\n  max-height: min(50dvh, 550px);\r\n  overflow: auto;\r\n  padding: 5px;\r\n  flex: 0 1 auto;\r\n}\r\n.task-view .search-result {\r\n  min-height: 52px;\r\n  width: 100%;\r\n  font-size: 14px;\r\n}\r\n.task-view .tab-list .switcher-card {\r\n  margin: 0 0 5px;\r\n  box-shadow: none;\r\n}\r\n.task-view .tab-choice {\r\n  display: flex;\r\n  flex-wrap: wrap;\r\n  justify-content: flex-start;\r\n  text-align: left;\r\n}\r\n.task-view .tab-choice .tile-topline {\r\n  flex: 1;\r\n  min-width: 0;\r\n  padding: 0;\r\n}\r\n.task-view .tab-choice .preview-info {\r\n  padding: 0 8px;\r\n}\r\n.task-view .search-scope {\r\n  margin: -8px 0 0;\r\n  padding: 0;\r\n  flex: none;\r\n}\r\n.selection-toolbar {\r\n  display: flex;\r\n  flex-wrap: wrap;\r\n  align-items: center;\r\n  gap: 4px;\r\n  border-bottom: 1px solid var(--line);\r\n  padding-bottom: 12px;\r\n  flex: none;\r\n}\r\n.selection-toolbar strong {\r\n  margin-right: auto;\r\n  font-size: 12px;\r\n}\r\n.selection-toolbar button {\r\n  font-size: 12px;\r\n}\r\n.selection-mark {\r\n  display: grid;\r\n  place-items: center;\r\n  flex: none;\r\n  width: 18px;\r\n  height: 18px;\r\n  border: 1px solid var(--muted);\r\n  border-radius: 4px;\r\n  line-height: 1;\r\n}\r\n.is-selected .selection-mark {\r\n  background: var(--accent-fill);\r\n  color: var(--on-accent);\r\n  border-color: var(--accent-fill);\r\n}\r\n.is-selected > button:first-child {\r\n  outline: 2px solid var(--accent);\r\n  outline-offset: 1px;\r\n  background: var(--selected);\r\n}\r\n.browse-group {\r\n  position: absolute;\r\n  right: 5px;\r\n  bottom: 3px;\r\n  background: var(--panel);\r\n  font-size: 11px;\r\n  padding: 4px 6px;\r\n}\r\n.selecting .group-tile .preview-info {\r\n  padding-right: 125px;\r\n}\r\n.group-rename {\r\n  display: flex;\r\n  align-items: flex-end;\r\n  gap: 8px;\r\n  flex: none;\r\n}\r\n.group-rename label {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 12px;\r\n  font-size: 12px;\r\n  flex: 1;\r\n}\r\n.group-rename input {\r\n  flex: 1;\r\n}\r\n.group-rename button {\r\n  font-size: 12px;\r\n}\r\n.collection-dock {\r\n  flex: none;\r\n  border-top: 1px solid var(--line);\r\n  padding-top: 12px;\r\n  min-width: 0;\r\n}\r\n.dock-actions {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 10px;\r\n  margin-bottom: 7px;\r\n}\r\n.dock-actions strong {\r\n  margin-right: auto;\r\n  font-size: 11px;\r\n  color: var(--muted);\r\n}\r\n.dock-actions button {\r\n  font-size: 12px;\r\n}\r\n.dock-collections {\r\n  display: flex;\r\n  gap: 9px;\r\n  overflow-x: auto;\r\n  padding-bottom: 4px;\r\n}\r\n.dock-collection {\r\n  border-top: 3px solid var(--color);\r\n  min-width: 125px;\r\n  max-width: 220px;\r\n  min-height: 42px;\r\n  padding: 8px 12px;\r\n  background: light-dark(#ffffff70, #ffffff08);\r\n  justify-content: flex-start;\r\n  text-align: left;\r\n  flex: none;\r\n  font-size: 12px;\r\n}\r\n.switcher-hint {\r\n  display: flex;\r\n  justify-content: space-between;\r\n  font-size: 10px;\r\n  color: var(--muted);\r\n  margin-top: -6px;\r\n}\r\n/* Only protected browser pages need a separate, bounded extension window. */\r\n.full-switcher .switcher-backdrop {\r\n  padding: 12px;\r\n}\r\n.full-switcher .task-view {\r\n  max-height: calc(100dvh - 24px);\r\n  width: 100%;\r\n}\r\n.note-preview {\r\n  margin: 0;\r\n  position: fixed;\r\n  width: min(340px, calc(100vw - 24px));\r\n  max-height: min(320px, calc(100vh - 24px));\r\n  padding: 14px;\r\n  background: var(--panel);\r\n  color: var(--text);\r\n  border: 1px solid var(--line);\r\n  border-radius: 9px;\r\n  box-shadow: 0 10px 32px #0003;\r\n  overflow: auto;\r\n}\r\n.note-preview header {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 10px;\r\n  margin-bottom: 8px;\r\n}\r\n.note-preview header strong {\r\n  flex: 1;\r\n  font-size: 13px;\r\n}\r\n.note-content {\r\n  white-space: pre-wrap;\r\n  overflow-wrap: anywhere;\r\n  font-size: 14px;\r\n  line-height: 1.6;\r\n}\r\n.note-button {\r\n  color: var(--accent);\r\n}\r\n.group-label[draggable='true'],\r\n.group-header[draggable='true'] {\r\n  cursor: grab;\r\n}\r\n.group-label[draggable='true']:active,\r\n.group-header[draggable='true']:active {\r\n  cursor: grabbing;\r\n}\r\n@media (max-width: 780px) {\r\n  .switcher-backdrop {\r\n    padding: 16px;\r\n  }\r\n  .task-view {\r\n    padding: 16px;\r\n    gap: 12px;\r\n    max-height: calc(100dvh - 32px);\r\n  }\r\n  .task-view .quick-head {\r\n    flex-wrap: wrap;\r\n    gap: 6px;\r\n  }\r\n  .task-view .quick-head input {\r\n    flex-basis: 70%;\r\n  }\r\n  .task-view .quick-grid {\r\n    gap: 12px;\r\n  }\r\n  .selection-toolbar strong {\r\n    flex-basis: 100%;\r\n  }\r\n}\r\n@media (prefers-reduced-transparency: reduce) {\r\n  .task-view {\r\n    background: var(--panel);\r\n    backdrop-filter: none;\r\n  }\r\n}\r\n@media (forced-colors: active) {\r\n  .task-view,\r\n  .task-view .preview-tile {\r\n    background: Canvas;\r\n    border: 1px solid CanvasText;\r\n  }\r\n  .is-selected > button:first-child {\r\n    outline-color: Highlight;\r\n  }\r\n}\r\n\r\n/* Shared controls across the organizer and the floating switcher. */\r\n.tab-tools {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 5px;\r\n  flex-wrap: wrap;\r\n}\r\n#tab-tools {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 2px;\r\n}\r\n.task-view > .tab-tools {\r\n  flex: none;\r\n  padding-bottom: 4px;\r\n}\r\n.tab-tools button {\r\n  font-size: 12px;\r\n}\r\n.dedup-button {\r\n  position: relative;\r\n  overflow: visible;\r\n}\r\n.dedup-button:disabled {\r\n  opacity: 0.45;\r\n}\r\n.dedup-button .count-badge {\r\n  position: static;\r\n  min-width: 17px;\r\n  margin-left: 2px;\r\n}\r\n.task-view .switcher-card {\r\n  width: 100%;\r\n  max-width: 340px;\r\n  justify-self: center;\r\n}\r\n.task-view .tab-list .switcher-card {\r\n  max-width: none;\r\n}\r\n.task-view.search-only {\r\n  width: min(760px, 100%);\r\n}\r\n.search-only .search-results {\r\n  max-height: min(55dvh, 440px);\r\n  overflow-y: auto;\r\n}\r\n.search-scope {\r\n  flex-wrap: wrap;\r\n}\r\n.saved-selection {\r\n  margin: 10px 12px 0;\r\n  padding-bottom: 10px;\r\n  gap: 4px;\r\n}\r\n.saved-selection button {\r\n  font-size: 11px;\r\n  padding: 5px 7px;\r\n}\r\n.saved-row.selected {\r\n  background: var(--selected);\r\n  border-radius: 5px;\r\n}\r\n.saved-row > input[type='checkbox'],\r\n.group-header > input[type='checkbox'] {\r\n  width: 16px;\r\n  height: 16px;\r\n  flex: none;\r\n}\r\n#tabs.selecting .tab-select {\r\n  opacity: 1;\r\n}\r\n#selection {\r\n  display: flex;\r\n  gap: 4px;\r\n  flex-wrap: wrap;\r\n  align-items: center;\r\n}\r\n#selection > strong {\r\n  flex-basis: 100%;\r\n}\r\n#selection button {\r\n  font-size: 12px;\r\n  padding: 6px;\r\n}\r\n.collection-head .collection-select {\r\n  flex: none;\r\n  font-size: 11px;\r\n  padding: 4px 6px;\r\n}\r\n\r\n/* Direct actions: small anchored lists and a single compact selection strip. */\r\n.action-menu {\r\n  width: 240px;\r\n  padding: 8px;\r\n  max-height: calc(100dvh - 24px);\r\n  overflow-y: auto;\r\n}\r\n.action-menu .menu-items {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 2px;\r\n}\r\n.action-menu .menu-items > button {\r\n  width: 100%;\r\n  min-height: 30px;\r\n  justify-content: flex-start;\r\n  text-align: left;\r\n  padding: 6px 9px;\r\n  font-size: 12px;\r\n}\r\n.action-menu hr {\r\n  width: calc(100% - 12px);\r\n  border: 0;\r\n  border-top: 1px solid var(--line);\r\n  margin: 6px;\r\n}\r\n.action-menu .swatches {\r\n  gap: 8px;\r\n  padding: 8px;\r\n  flex-wrap: wrap;\r\n}\r\n.action-menu .swatch {\r\n  width: 23px;\r\n  height: 23px;\r\n}\r\n.collection-head .icon-button,\r\n.collection-head .selection-mode-button {\r\n  width: 28px;\r\n  height: 28px;\r\n  padding: 5px;\r\n  color: #18202b;\r\n  opacity: 0.75;\r\n  flex: none;\r\n  background: transparent;\r\n}\r\n.collection-head .icon-button:is(:hover, :active),\r\n.collection-head .selection-mode-button:is(:hover, :active) {\r\n  background: #00000012;\r\n  opacity: 1;\r\n}\r\n.collection-head .icon-button:focus-visible,\r\n.collection-head .selection-mode-button:focus-visible {\r\n  outline: 2px solid #263850;\r\n  outline-offset: -2px;\r\n}\r\n.collection-head .collection-name:hover {\r\n  text-decoration: none;\r\n}\r\n.collection-head {\r\n  gap: 4px;\r\n  cursor: grab;\r\n}\r\n.collection-head:active {\r\n  cursor: grabbing;\r\n}\r\n.collection.folded {\r\n  min-height: 0;\r\n  background: transparent;\r\n}\r\n.collection.folded .collection-head {\r\n  margin-bottom: 0;\r\n}\r\n.collection.dragging {\r\n  opacity: 0.28;\r\n}\r\n.collection-insertion {\r\n  position: fixed;\r\n  z-index: 2147483647;\r\n  background: var(--accent);\r\n  box-shadow: 0 0 0 1px var(--bg);\r\n  border-radius: 2px;\r\n  pointer-events: none;\r\n}\r\n.collection-drag-ghost {\r\n  position: fixed;\r\n  top: 0;\r\n  left: 0;\r\n  z-index: -1;\r\n  border-radius: 6px;\r\n  padding: 12px 14px;\r\n  background: var(--color);\r\n  color: #18202b;\r\n  font:\r\n    600 14px 'Segoe UI',\r\n    sans-serif;\r\n  pointer-events: none;\r\n}\r\n#selection,\r\n.saved-selection {\r\n  display: flex;\r\n  flex-wrap: wrap;\r\n  gap: 3px;\r\n  align-items: center;\r\n  padding: 6px 0;\r\n  margin: 0 0 7px;\r\n  border: 0;\r\n  border-bottom: 1px solid var(--line);\r\n  border-radius: 0;\r\n  background: transparent;\r\n}\r\n.saved-selection {\r\n  margin: 0 10px;\r\n  padding: 8px 0;\r\n  flex-direction: column;\r\n  align-items: stretch;\r\n}\r\n#selection > strong,\r\n.saved-selection > strong {\r\n  flex: 0 0 auto;\r\n  font-size: 11px;\r\n  margin-right: auto;\r\n  white-space: nowrap;\r\n}\r\n#selection button,\r\n.saved-selection button {\r\n  width: 27px;\r\n  height: 27px;\r\n  min-width: 27px;\r\n  padding: 5px;\r\n}\r\n#tabs .tab-row {\r\n  margin-bottom: 4px;\r\n}\r\n#tabs.selecting .tab-row > .favicon {\r\n  visibility: hidden;\r\n}\r\n#selection {\r\n  gap: 1px;\r\n}\r\n#selection button {\r\n  width: 24px;\r\n  height: 24px;\r\n  min-width: 24px;\r\n  padding: 4px;\r\n}\r\n#selection > strong {\r\n  margin-right: 4px;\r\n}\r\n#tabs .tab-row .tab-open:focus-visible {\r\n  outline: 0;\r\n}\r\n#tabs .tab-row:has(.tab-open:focus-visible) {\r\n  outline: 2px solid var(--accent);\r\n  outline-offset: -2px;\r\n}\r\n#tabs .tab-row.selected .tab-open {\r\n  background: transparent;\r\n  box-shadow: none;\r\n}\r\n.saved-row {\r\n  margin-bottom: 3px;\r\n}\r\n.saved-row .link-open:focus-visible {\r\n  outline-offset: -2px;\r\n}\r\n.selection-toolbar .icon-button {\r\n  width: 28px;\r\n  height: 28px;\r\n  padding: 5px;\r\n}\r\n#ai-tools {\r\n  display: inline-flex;\r\n  gap: 6px;\r\n  align-items: center;\r\n}\r\n\r\n.action-popover:has(.switch-picker) {\r\n  width: 380px;\r\n  max-height: calc(100vh - 24px);\r\n  overflow-y: auto;\r\n}\r\n.switch-picker {\r\n  display: grid;\r\n  gap: 10px;\r\n  min-width: 0;\r\n}\r\n.switch-picker input[type='search'] {\r\n  width: 100%;\r\n}\r\n.switch-picker .hint {\r\n  margin: 0;\r\n}\r\n.switch-picker [role='status']:empty {\r\n  display: none;\r\n}\r\n.switch-choices {\r\n  display: grid;\r\n  gap: 3px;\r\n  max-height: min(300px, 40vh);\r\n  overflow-y: auto;\r\n}\r\n.switch-choices > button {\r\n  display: grid;\r\n  gap: 3px;\r\n  width: 100%;\r\n  text-align: left;\r\n  padding: 9px 10px;\r\n}\r\n.switch-name,\r\n.switch-detail {\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n.switch-detail {\r\n  font-size: 12px;\r\n  color: var(--muted);\r\n}\r\n\r\n.switch-picker .check-label {\r\n  margin: 0;\r\n  font-size: 13px;\r\n}\r\n.switch-choices > button {\r\n  justify-content: stretch;\r\n  justify-items: start;\r\n  font-size: 14px;\r\n}\r\n\r\n/* Selection actions must be distinguishable from leaving selection mode. */\r\n#sidebar .section-heading {\r\n  gap: 6px;\r\n  margin-inline: 0;\r\n}\r\n#sidebar .section-heading h2 {\r\n  white-space: nowrap;\r\n  font-size: 14px;\r\n}\r\n#tab-tools,\r\n.tab-tools.compact {\r\n  flex-wrap: nowrap;\r\n  gap: 2px;\r\n  flex: none;\r\n}\r\n.tab-tools.compact > button {\r\n  width: 28px;\r\n  min-width: 28px;\r\n  height: 28px;\r\n  padding: 5px;\r\n  flex: none;\r\n}\r\n.tab-tools .dedup-button,\r\n.tab-tools.compact > .dedup-button {\r\n  width: auto;\r\n  min-width: 28px;\r\n  gap: 3px;\r\n  overflow: hidden;\r\n}\r\n.dedup-button .count-badge {\r\n  position: static;\r\n  display: inline-grid;\r\n  place-items: center;\r\n  flex: none;\r\n  width: 16px;\r\n  min-width: 16px;\r\n  height: 16px;\r\n  padding: 0;\r\n  margin: 0;\r\n  border-radius: 50%;\r\n  font-size: 10px;\r\n  line-height: 1;\r\n}\r\n#tab-tools .selection-mode-button,\r\n#select-mode.selection-mode-button,\r\n.collection-head .selection-mode-button {\r\n  width: auto;\r\n  min-width: 46px;\r\n  height: 28px;\r\n  padding: 4px 7px;\r\n  flex: none;\r\n  font-size: 12px;\r\n  opacity: 1;\r\n}\r\n#tab-tools button:focus-visible,\r\n.tab-tools button:focus-visible,\r\n.selection-mode-button:focus-visible,\r\n#selection button:focus-visible,\r\n.selection-toolbar button:focus-visible {\r\n  outline: 2px solid var(--accent);\r\n  outline-offset: -2px;\r\n}\r\n#selection {\r\n  display: flex;\r\n  gap: 4px;\r\n  flex-direction: column;\r\n  align-items: stretch;\r\n}\r\n.selection-summary,\r\n.selection-actions {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 3px;\r\n}\r\n.selection-summary > strong {\r\n  margin-right: auto;\r\n  font-size: 12px;\r\n}\r\n#selection .selection-actions > button {\r\n  width: 28px;\r\n  min-width: 28px;\r\n  height: 28px;\r\n  padding: 5px;\r\n}\r\n#selection .selection-actions > .close-selected,\r\n.saved-selection .selection-actions > .close-selected,\r\n.selection-toolbar > .close-selected {\r\n  width: auto;\r\n  min-width: 72px;\r\n  height: 28px;\r\n  padding: 4px 8px;\r\n  margin-left: auto;\r\n  font-size: 12px;\r\n  white-space: nowrap;\r\n  color: light-dark(#a52c3b, #ffb2ba);\r\n}\r\n.close-selected:not(:disabled):hover {\r\n  background: light-dark(#fce9ed, #482b32);\r\n}\r\n.close-all-tabs,\r\n.tab-tools.compact > .close-all-tabs {\r\n  width: auto;\r\n  min-width: 62px;\r\n  height: 28px;\r\n  padding: 4px 7px;\r\n  font-size: 12px;\r\n  white-space: nowrap;\r\n  color: light-dark(#a52c3b, #ffb2ba);\r\n}\r\n.close-all-tabs:hover {\r\n  background: light-dark(#fce9ed, #482b32);\r\n}\r\n\r\n/* Settings: a toolbar menu for quick preferences, focused dialogs for longer tasks. */\r\n.head-actions > #settings {\r\n  display: inline-grid;\r\n  place-items: center;\r\n  width: 32px;\r\n  height: 32px;\r\n  padding: 6px;\r\n  flex: none;\r\n}\r\n.settings-menu {\r\n  width: 320px;\r\n  padding: 12px;\r\n  max-height: calc(100dvh - 24px);\r\n  overflow-y: auto;\r\n}\r\n.settings-menu h2 {\r\n  margin: 4px 8px 8px;\r\n  font-size: 14px;\r\n}\r\n.settings-list {\r\n  display: grid;\r\n  gap: 2px;\r\n}\r\n.settings-list hr {\r\n  width: auto;\r\n  margin: 8px;\r\n  border: 0;\r\n  border-top: 1px solid var(--line);\r\n}\r\n.settings-entry {\r\n  display: flex;\r\n  justify-content: flex-start;\r\n  width: 100%;\r\n  min-height: 36px;\r\n  gap: 10px;\r\n  padding: 8px;\r\n  font-size: 13px;\r\n  text-align: left;\r\n}\r\n.settings-preference {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  gap: 10px;\r\n  min-height: 36px;\r\n  padding: 5px 8px;\r\n  font-size: 13px;\r\n  cursor: pointer;\r\n}\r\n.settings-preference select {\r\n  width: 96px;\r\n  padding: 4px 7px;\r\n  font-size: 12px;\r\n}\r\n.settings-preference input[role='switch'] {\r\n  appearance: none;\r\n  position: relative;\r\n  width: 30px;\r\n  height: 18px;\r\n  flex: none;\r\n  margin: 0;\r\n  padding: 0;\r\n  border: 1px solid var(--muted);\r\n  border-radius: 12px;\r\n  background: var(--hover);\r\n  cursor: pointer;\r\n}\r\n.settings-preference input[role='switch']::after {\r\n  content: '';\r\n  position: absolute;\r\n  top: 2px;\r\n  left: 2px;\r\n  width: 12px;\r\n  height: 12px;\r\n  border-radius: 50%;\r\n  background: var(--muted);\r\n}\r\n.settings-preference input[role='switch']:checked {\r\n  background: var(--accent-fill);\r\n  border-color: var(--accent-fill);\r\n}\r\n.settings-preference input[role='switch']:checked::after {\r\n  left: 14px;\r\n  background: var(--on-accent);\r\n}\r\n.settings-menu :is(button, select, input):focus-visible {\r\n  outline: 2px solid var(--accent);\r\n  outline-offset: -2px;\r\n}\r\n.settings-detail {\r\n  width: min(640px, calc(100vw - 32px));\r\n  max-height: calc(100dvh - 40px);\r\n}\r\n.settings-detail::backdrop {\r\n  background: #080b10a0;\r\n  backdrop-filter: blur(3px);\r\n}\r\n.settings-detail .dialog-head {\r\n  padding: 26px 30px 12px;\r\n}\r\n.settings-detail .dialog-head h2 {\r\n  font-size: 24px;\r\n  font-weight: 650;\r\n}\r\n.settings-detail .dialog-head .icon-button {\r\n  width: 32px;\r\n  height: 32px;\r\n  padding: 6px;\r\n}\r\n.settings-detail .dialog-head :focus-visible {\r\n  outline-offset: -2px;\r\n}\r\n.settings-detail .dialog-head h2:focus {\r\n  outline: none;\r\n}\r\n.settings-detail .dialog-body {\r\n  padding: 12px 30px 28px;\r\n  max-height: calc(100dvh - 220px);\r\n}\r\n.settings-detail .settings-section {\r\n  border: 0;\r\n  padding: 0;\r\n  margin: 0;\r\n}\r\n.settings-detail .field {\r\n  margin-bottom: 16px;\r\n}\r\n.settings-detail footer {\r\n  padding: 16px 30px 22px;\r\n}\r\n.transfer-options {\r\n  display: grid;\r\n  gap: 18px;\r\n}\r\n.transfer-options .transfer-primary {\r\n  justify-content: flex-start;\r\n  text-align: left;\r\n  gap: 12px;\r\n  padding: 20px;\r\n  min-height: 70px;\r\n  border-radius: 9px;\r\n  background: var(--hover);\r\n  font-size: 15px;\r\n  font-weight: 600;\r\n}\r\n.transfer-options summary {\r\n  padding: 12px 0;\r\n  cursor: pointer;\r\n  font-weight: 550;\r\n}\r\n.transfer-options details {\r\n  border-bottom: 1px solid var(--line);\r\n  padding-bottom: 8px;\r\n}\r\n.transfer-formats {\r\n  display: grid;\r\n  gap: 6px;\r\n}\r\n@media (max-width: 600px) {\r\n  .settings-detail .dialog-head {\r\n    padding: 20px 20px 10px;\r\n  }\r\n  .settings-detail .dialog-body {\r\n    padding: 10px 20px 20px;\r\n  }\r\n}\r\n\r\n.collection-note-editor {\r\n  margin: 9px 6px 2px;\r\n}\r\n.collection-note-editor .collection-note {\r\n  display: block;\r\n  width: 100%;\r\n  margin: 0;\r\n  min-height: 100px;\r\n}\r\n.collection-note-editor .delete-collection-note {\r\n  display: block;\r\n  margin: 3px 0 0 auto;\r\n  padding: 4px 6px;\r\n  font-size: 11px;\r\n  color: var(--muted);\r\n}\r\n.collection-note-editor .delete-collection-note:hover {\r\n  color: light-dark(#a52c3b, #ffb2ba);\r\n  background: var(--hover);\r\n}\r\n.collection-note-editor :focus-visible {\r\n  outline-offset: -2px;\r\n}\r\n\r\n.space-tab > .space-options {\r\n  opacity: 0.65;\r\n  width: 26px;\r\n  height: 26px;\r\n  padding: 4px;\r\n  flex: none;\r\n}\r\n.space-tab > .space-options:is(:hover, :focus-visible) {\r\n  opacity: 1;\r\n}\r\n.space-tab > .space-options:focus-visible {\r\n  outline-offset: -2px;\r\n}\r\n\r\n/* Session history stays compact above a scrollable, grouped tab list. */\r\n.history-heading {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 8px;\r\n  flex-wrap: wrap;\r\n}\r\n.history-heading h2 {\r\n  margin: 0;\r\n  flex: 1;\r\n  white-space: nowrap;\r\n}\r\n.history-heading select {\r\n  width: auto;\r\n  max-width: 130px;\r\n  font: inherit;\r\n  font-size: 11px;\r\n  padding: 4px;\r\n}\r\n.history-navigation {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  gap: 6px;\r\n  margin: 12px 0;\r\n}\r\n.history-navigation time {\r\n  font-size: 12px;\r\n  color: var(--muted);\r\n  text-align: center;\r\n}\r\n.history-name {\r\n  display: block;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n  font-size: 13px;\r\n}\r\n.history-reason {\r\n  margin: 3px 0 8px;\r\n  font-size: 11px;\r\n}\r\n.history-tabs {\r\n  max-height: 230px;\r\n  overflow-y: auto;\r\n}\r\n.history-tabs .recent-link {\r\n  display: block;\r\n  width: 100%;\r\n  text-align: left;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n  padding: 7px 6px;\r\n  margin: 2px 0;\r\n}\r\n.history-group {\r\n  display: block;\r\n  color: var(--muted);\r\n  padding: 8px 6px 2px;\r\n}\r\n.history-restore {\r\n  width: 100%;\r\n  margin-top: 10px;\r\n}\r\n.history-footnote {\r\n  font-size: 10px;\r\n  margin: 8px 0 0;\r\n}\r\n.collection-switch {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 6px;\r\n  margin: 6px 10px;\r\n  padding: 4px 6px;\r\n  max-width: calc(100% - 20px);\r\n  font-size: 12px;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n.collection-switch svg {\r\n  width: 14px;\r\n  height: 14px;\r\n}\r\n\r\n/* Focused switcher: clear scopes, stable card actions and quiet surfaces. */\r\n.switcher-backdrop {\r\n  background: light-dark(#18203630, #03060c66);\r\n  backdrop-filter: blur(5px);\r\n}\r\n.task-view {\r\n  width: min(1240px, 100%);\r\n  padding: 24px 28px 16px;\r\n  gap: 14px;\r\n  background: light-dark(#fafbfdf5, #202328f5);\r\n  border-radius: 20px;\r\n  box-shadow: 0 28px 100px #0006;\r\n}\r\n.task-view.search-only {\r\n  width: min(1050px, 100%);\r\n}\r\n.task-head h1 {\r\n  font-size: 20px;\r\n  letter-spacing: -0.3px;\r\n}\r\n.task-view .quick-head {\r\n  gap: 10px;\r\n}\r\n.task-view .quick-head input {\r\n  min-height: 46px;\r\n  border-radius: 10px;\r\n  padding: 10px 14px;\r\n  font-size: 15px;\r\n  background: light-dark(#fff, #171a1f);\r\n}\r\n.task-view .quick-grid {\r\n  gap: 18px;\r\n  padding: 5px;\r\n}\r\n.task-view .switcher-card {\r\n  max-width: 380px;\r\n  position: relative;\r\n}\r\n.task-view .preview-tile {\r\n  border-radius: 12px;\r\n  overflow: hidden;\r\n  box-shadow: none;\r\n  background: light-dark(#fff, #181b20);\r\n}\r\n.task-view .preview-tile:focus-visible,\r\n.task-view .tab-choice:focus-visible {\r\n  outline: 2px solid var(--accent);\r\n  outline-offset: 2px;\r\n}\r\n.task-view .tile-topline {\r\n  height: 42px;\r\n  padding-right: 72px;\r\n}\r\n.task-view .group-tile .tile-topline {\r\n  padding-right: 12px;\r\n}\r\n.task-view .preview-info {\r\n  padding: 9px 12px;\r\n  color: var(--muted);\r\n}\r\n.tile-actions {\r\n  position: absolute;\r\n  right: 5px;\r\n  top: 5px;\r\n  display: flex;\r\n  gap: 2px;\r\n  z-index: 1;\r\n}\r\n.tile-actions button {\r\n  width: 28px;\r\n  height: 28px;\r\n  min-width: 28px;\r\n  padding: 5px;\r\n  border-radius: 6px;\r\n  background: light-dark(#ffffffee, #202328ee);\r\n  color: var(--muted);\r\n}\r\n.tile-actions .tile-close:hover {\r\n  color: light-dark(#b42335, #ff8795);\r\n  background: light-dark(#fff0f2, #48232c);\r\n}\r\n.tile-actions .tile-mute:hover {\r\n  color: var(--text);\r\n}\r\n.task-view .tab-list .tile-actions {\r\n  top: 50%;\r\n  transform: translateY(-50%);\r\n}\r\n.task-view .tab-list .tab-choice {\r\n  padding-right: 76px;\r\n}\r\n.browse-scopes {\r\n  display: flex;\r\n  gap: 4px;\r\n  align-items: center;\r\n  flex-wrap: wrap;\r\n}\r\n.browse-scopes button {\r\n  font-size: 13px;\r\n  padding: 7px 12px;\r\n  border-radius: 8px;\r\n  color: var(--muted);\r\n}\r\n.browse-scopes button[aria-pressed='true'],\r\n.overlay-utilities button[aria-pressed='true'] {\r\n  color: var(--text);\r\n  background: light-dark(#e6eafa, #39435a);\r\n}\r\n.browse-scopes button[data-count]::after {\r\n  content: attr(data-count);\r\n  margin-left: 7px;\r\n  opacity: 0.65;\r\n  font-size: 11px;\r\n}\r\n.browse-scopes .audio-filter {\r\n  margin-left: auto;\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 6px;\r\n}\r\n.overlay-utilities {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  padding-top: 10px;\r\n  border-top: 1px solid var(--line);\r\n}\r\n.overlay-utilities button {\r\n  display: flex;\r\n  gap: 7px;\r\n  align-items: center;\r\n  padding: 6px 10px;\r\n  font-size: 13px;\r\n}\r\n.task-view .collection-dock {\r\n  padding-top: 10px;\r\n}\r\n.task-view .selection-toolbar {\r\n  background: light-dark(#edf0f9, #2c3342);\r\n  border: 0;\r\n  border-radius: 10px;\r\n  padding: 8px 10px;\r\n  gap: 5px;\r\n  flex-wrap: wrap;\r\n}\r\n.task-view .selection-toolbar button {\r\n  font-size: 12px;\r\n}\r\n.task-view .selection-toolbar > .close-selected {\r\n  margin-left: auto;\r\n}\r\n.task-view .switcher-hint {\r\n  font-size: 11px;\r\n  opacity: 0.65;\r\n}\r\n.clear-search {\r\n  flex: none;\r\n}\r\n.session-results {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 9px;\r\n}\r\n.session-entry {\r\n  border-bottom: 1px solid var(--line);\r\n  padding: 8px 0;\r\n}\r\n.session-entry summary {\r\n  cursor: pointer;\r\n  padding: 9px;\r\n  font-size: 14px;\r\n}\r\n.session-time {\r\n  display: block;\r\n  color: var(--muted);\r\n  font-size: 11px;\r\n  padding: 0 9px;\r\n}\r\n.session-page {\r\n  display: flex;\r\n  justify-content: space-between;\r\n  align-items: center;\r\n  gap: 14px;\r\n  width: 100%;\r\n  text-align: left;\r\n  padding: 10px;\r\n  border-radius: 8px;\r\n}\r\n.session-page .row-title {\r\n  min-width: 0;\r\n  flex: 1;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n.session-page small {\r\n  display: block;\r\n  color: var(--muted);\r\n  font-size: 11px;\r\n}\r\n.result-verb {\r\n  font-size: 11px;\r\n  color: var(--muted);\r\n  flex: none;\r\n}\r\n.session-restore,\r\n.history-link {\r\n  margin: 5px 9px;\r\n  font-size: 12px;\r\n}\r\n.collection-result {\r\n  display: block;\r\n  width: 100%;\r\n  padding: 14px;\r\n  text-align: left;\r\n  border-radius: 9px;\r\n}\r\n.sidebar-scopes {\r\n  margin: 8px 0 12px;\r\n  gap: 2px;\r\n}\r\n.sidebar-scopes button {\r\n  font-size: 10px;\r\n  padding: 5px 6px;\r\n}\r\n#sidebar .session-page {\r\n  flex-wrap: wrap;\r\n  gap: 3px;\r\n}\r\n#sidebar .session-page .result-verb {\r\n  margin-left: auto;\r\n}\r\n@media (max-width: 700px) {\r\n  .switcher-backdrop {\r\n    padding: 12px;\r\n  }\r\n  .task-view {\r\n    padding: 16px;\r\n    border-radius: 14px;\r\n  }\r\n  .browse-scopes button {\r\n    font-size: 12px;\r\n    padding: 6px 8px;\r\n  }\r\n  .task-view .quick-head {\r\n    flex-wrap: wrap;\r\n  }\r\n  .task-view .quick-head input {\r\n    flex: 1;\r\n    width: 65%;\r\n  }\r\n  .browse-scopes .audio-filter {\r\n    margin-left: 0;\r\n  }\r\n  .task-view .selection-toolbar > .close-selected {\r\n    margin-left: 0;\r\n  }\r\n}\r\n\r\n.task-view .quick-head input {\r\n  flex: 1 1 180px;\r\n  width: auto;\r\n  min-width: 120px;\r\n}\r\n.task-view .browse-scopes,\r\n.task-view .overlay-utilities,\r\n.task-view .switcher-hint,\r\n.task-view .search-scope {\r\n  flex: none;\r\n}\r\n.task-view .search-results {\r\n  min-height: 100px;\r\n}\r\n@media (max-height: 560px) {\r\n  .task-view {\r\n    gap: 10px;\r\n    padding: 16px 20px 12px;\r\n    max-height: calc(100dvh - 24px);\r\n  }\r\n  .task-view .switcher-hint {\r\n    display: none;\r\n  }\r\n  .task-view .quick-head input {\r\n    min-height: 40px;\r\n  }\r\n}\r\n\r\n.task-view input[type='search']::-webkit-search-cancel-button {\r\n  -webkit-appearance: none;\r\n}\r\n.task-view .clear-search {\r\n  font-size: 12px;\r\n  color: var(--muted);\r\n  padding: 5px 8px;\r\n}\r\n\r\n/* One search, compact page recovery, and a distinct whole-session action. */\r\n#sidebar > * {\r\n  flex-shrink: 0;\r\n}\r\n#sidebar #tabs .empty {\r\n  padding: 18px 8px;\r\n  min-height: 0;\r\n}\r\n#sidebar #recent {\r\n  margin: 18px 2px 0;\r\n  padding-top: 14px;\r\n}\r\n.recent-heading {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  gap: 6px;\r\n  margin-bottom: 12px;\r\n}\r\n#recent .recent-heading h2 {\r\n  margin: 0;\r\n  font-size: 13px;\r\n}\r\n.recent-mode {\r\n  font-size: 11px;\r\n  padding: 5px 7px;\r\n  gap: 4px;\r\n  color: var(--accent);\r\n}\r\n.recent-mode svg {\r\n  width: 14px;\r\n  height: 14px;\r\n}\r\n.recent-section-label {\r\n  font-size: 11px;\r\n  color: var(--muted);\r\n  font-weight: 600;\r\n  margin: 10px 5px 5px;\r\n}\r\n.history-divider {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 10px;\r\n  margin-top: 16px;\r\n}\r\n.history-divider::after {\r\n  content: '';\r\n  height: 1px;\r\n  background: var(--line);\r\n  flex: 1;\r\n}\r\n.recent-page {\r\n  display: flex;\r\n  width: 100%;\r\n  align-items: center;\r\n  text-align: left;\r\n  gap: 8px;\r\n  padding: 7px 5px;\r\n  min-width: 0;\r\n}\r\n.recent-page-copy {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 2px;\r\n  min-width: 0;\r\n  flex: 1;\r\n}\r\n.recent-page-copy .row-title {\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n  font-size: 12px;\r\n}\r\n.recent-page-copy small {\r\n  font-size: 10px;\r\n  color: var(--muted);\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n.recent-page-verb {\r\n  font-size: 10px;\r\n  color: var(--muted);\r\n  flex-shrink: 0;\r\n}\r\n.recent-page:hover .recent-page-verb,\r\n.recent-page:focus-visible .recent-page-verb {\r\n  color: var(--accent);\r\n}\r\n.recent-more {\r\n  color: var(--accent);\r\n  font-size: 11px;\r\n  margin: 3px 0;\r\n}\r\n.enable-history {\r\n  font-size: 12px;\r\n  background: var(--hover);\r\n  width: 100%;\r\n  margin-top: 6px;\r\n}\r\n#recent > .hint {\r\n  padding: 3px 5px;\r\n  font-size: 11px;\r\n}\r\n#recent .history-heading {\r\n  margin-top: 6px;\r\n  justify-content: space-between;\r\n}\r\n#recent .history-heading h3 {\r\n  font-size: 11px;\r\n  color: var(--muted);\r\n  font-weight: 500;\r\n}\r\n#recent .history-restore {\r\n  background: var(--accent-fill);\r\n  color: var(--on-accent);\r\n  border: 1px solid transparent;\r\n  font-size: 13px;\r\n  font-weight: 650;\r\n  min-height: 38px;\r\n  margin: 8px 0 12px;\r\n  width: 100%;\r\n}\r\n#recent .history-restore:hover {\r\n  filter: brightness(1.08);\r\n}\r\n#recent .history-tabs {\r\n  border-top: 1px solid var(--line);\r\n  padding-top: 6px;\r\n}\r\n#sidebar mark,\r\n#board mark {\r\n  background: color-mix(in srgb, var(--accent) 28%, transparent);\r\n  color: var(--text);\r\n  border-radius: 2px;\r\n}\r\n#breadcrumbs {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 12px;\r\n}\r\n#breadcrumbs button {\r\n  color: var(--accent);\r\n}\r\n\r\n#board .collection-head mark {\r\n  color: inherit;\r\n  background: #fff5;\r\n}\r\n.link-open:has(.search-match-url) {\r\n  display: flex;\r\n  flex-direction: column;\r\n  align-items: flex-start;\r\n  min-width: 0;\r\n}\r\n.search-match-url {\r\n  display: block;\r\n  max-width: 100%;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  color: var(--muted);\r\n  font-size: 10px;\r\n  font-weight: 400;\r\n}\r\n\r\n#sidebar .section-heading {\r\n  flex-wrap: wrap;\r\n}\r\n#sidebar #tab-tools {\r\n  margin-left: auto;\r\n}\r\n#sidebar #recent {\r\n  display: block;\r\n}\r\n\r\n/* Flat overlay: one search row, one navigation row, individual tab frames. */\r\n.task-view {\r\n  background: light-dark(#f4f5f7, #202226);\r\n  border-radius: 8px;\r\n  box-shadow: none;\r\n  backdrop-filter: none;\r\n  border: 1px solid var(--line);\r\n  padding: 20px 24px;\r\n  gap: 16px;\r\n}\r\n.task-view.search-only {\r\n  width: min(1240px, 100%);\r\n}\r\n.task-view .quick-head input {\r\n  border-radius: 5px;\r\n  min-height: 42px;\r\n}\r\n.task-view .browse-scopes {\r\n  gap: 4px;\r\n}\r\n.task-view .browse-scopes .audio-filter {\r\n  margin-left: 0;\r\n}\r\n.task-view .browse-scopes button {\r\n  border-radius: 4px;\r\n}\r\n.overlay-navigation {\r\n  margin-left: auto;\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 6px;\r\n}\r\n.task-view .overlay-more {\r\n  padding: 7px;\r\n  flex: none;\r\n}\r\n.task-view .quick-grid {\r\n  max-height: min(62dvh, 650px);\r\n  gap: 16px;\r\n}\r\n.task-view .switcher-card {\r\n  border-radius: 5px;\r\n  background: light-dark(#e5e7eb, #30343a);\r\n  padding: 5px;\r\n  box-shadow: none;\r\n}\r\n.task-view .preview-tile {\r\n  background: transparent;\r\n  border: 0;\r\n  border-radius: 2px;\r\n  padding: 0;\r\n  box-shadow: none;\r\n  color: var(--text);\r\n}\r\n.task-view .preview-tile:hover {\r\n  background: transparent;\r\n}\r\n.task-view .switcher-card:has(.preview-tile:hover) {\r\n  outline: 1px solid var(--muted);\r\n  outline-offset: 1px;\r\n}\r\n.task-view .preview-tile:focus-visible {\r\n  outline: 2px solid var(--accent);\r\n  outline-offset: 5px;\r\n}\r\n.task-view .tile-topline {\r\n  height: 36px;\r\n  padding: 4px 64px 6px 5px;\r\n}\r\n.task-view .preview-info {\r\n  padding: 7px 5px 3px;\r\n}\r\n.task-view .preview-image {\r\n  border-radius: 1px;\r\n}\r\n.task-view .preview-info small {\r\n  color: var(--text);\r\n  opacity: 0.8;\r\n}\r\n.task-view .tile-actions {\r\n  right: 7px;\r\n  top: 7px;\r\n}\r\n.task-view .tile-actions button {\r\n  background: transparent;\r\n  border-radius: 3px;\r\n  color: var(--text);\r\n}\r\n.task-view .native-group-card {\r\n  background: var(--group-frame);\r\n}\r\n.task-view [data-group-color='blue'] {\r\n  --group-frame: light-dark(#c8dcfc, #354e72);\r\n}\r\n.task-view [data-group-color='red'] {\r\n  --group-frame: light-dark(#f5cccc, #693b40);\r\n}\r\n.task-view [data-group-color='yellow'] {\r\n  --group-frame: light-dark(#f3e5b3, #61532e);\r\n}\r\n.task-view [data-group-color='green'] {\r\n  --group-frame: light-dark(#c6e6cf, #345944);\r\n}\r\n.task-view [data-group-color='pink'] {\r\n  --group-frame: light-dark(#f0d0e4, #633e58);\r\n}\r\n.task-view [data-group-color='purple'] {\r\n  --group-frame: light-dark(#dfd2f5, #50416b);\r\n}\r\n.task-view [data-group-color='cyan'] {\r\n  --group-frame: light-dark(#c1e5e9, #305861);\r\n}\r\n.task-view [data-group-color='orange'] {\r\n  --group-frame: light-dark(#f2d5b8, #674a30);\r\n}\r\n.task-view [data-group-color='grey'] {\r\n  --group-frame: light-dark(#d9dce1, #454950);\r\n}\r\n.task-view .tab-list .switcher-card {\r\n  max-width: none;\r\n}\r\n.task-view .tab-list .tile-topline {\r\n  padding-right: 0;\r\n}\r\n.task-view .preview-missing .favicon {\r\n  width: 30px;\r\n  height: 30px;\r\n}\r\n.preview-missing .favicon:is(:has(img), .has-icon) {\r\n  background: transparent;\r\n  color: transparent;\r\n}\r\n.preview-missing .favicon :is(img, canvas) {\r\n  width: 100%;\r\n  height: 100%;\r\n  object-fit: contain;\r\n  background: transparent;\r\n  border-radius: 0;\r\n}\r\n@media (max-width: 700px) {\r\n  .task-view {\r\n    padding: 14px;\r\n  }\r\n  .task-view .quick-head {\r\n    flex-wrap: wrap;\r\n    gap: 6px;\r\n  }\r\n  .task-view .quick-head input {\r\n    flex: 1 1 calc(100% - 50px);\r\n  }\r\n  .task-view .view-choices {\r\n    margin-left: auto;\r\n  }\r\n  .task-view .browse-scopes button {\r\n    padding: 6px 8px;\r\n  }\r\n  .overlay-navigation {\r\n    margin-left: auto;\r\n  }\r\n}\r\n\r\n/* Native groups remain folder-like containers with whole-group selection. */\r\n.task-view .group-tile {\r\n  box-shadow: none;\r\n  margin-top: 0;\r\n}\r\n.task-view .group-preview {\r\n  display: grid;\r\n  grid-template-columns: repeat(2, minmax(0, 1fr));\r\n  grid-template-rows: repeat(2, minmax(0, 1fr));\r\n  gap: 6px;\r\n  padding: 6px;\r\n  background: transparent;\r\n}\r\n.task-view .group-preview > .preview-image {\r\n  width: 100%;\r\n  height: 100%;\r\n  min-height: 0;\r\n  aspect-ratio: auto;\r\n  border-radius: 3px;\r\n}\r\n.task-view .group-preview .preview-missing {\r\n  padding: 5px;\r\n  font-size: 10px;\r\n  gap: 4px;\r\n  overflow: hidden;\r\n}\r\n.task-view .group-preview .preview-missing small {\r\n  display: none;\r\n}\r\n.task-view .group-preview .preview-missing .favicon {\r\n  width: 22px;\r\n  height: 22px;\r\n}\r\n.task-view.selecting .tile-topline {\r\n  padding-right: 8px;\r\n}\r\n.task-view .selection-mark {\r\n  margin-left: auto;\r\n  flex: 0 0 18px;\r\n}\r\n.task-view .quick-head > button {\r\n  flex-shrink: 0;\r\n}\r\n\r\n/* Timeline uses the same page rows and website icons as Recent & history. */\r\n#recent .history-tabs {\r\n  border: 0;\r\n  padding: 0;\r\n  margin-top: 8px;\r\n  max-height: 280px;\r\n}\r\n#recent .history-name {\r\n  margin: 0 5px 6px;\r\n}\r\n#recent .history-navigation {\r\n  margin: 0 0 12px;\r\n}\r\n#recent .history-group {\r\n  padding: 8px 5px 3px;\r\n  font-size: 11px;\r\n}\r\n#recent .history-restore {\r\n  margin: 12px 0 0;\r\n}\r\n.session-page > .favicon {\r\n  flex-shrink: 0;\r\n}\r\n\r\n.collection-meta {\r\n  display: flex;\r\n  align-items: center;\r\n  flex-wrap: wrap;\r\n  gap: 8px;\r\n  margin: 8px 14px 2px;\r\n  min-height: 20px;\r\n  color: var(--muted);\r\n  font-size: 11px;\r\n}\r\n.collection-pinned {\r\n  display: inline-flex;\r\n  align-items: center;\r\n  gap: 3px;\r\n  color: var(--accent);\r\n}\r\n.collection-pinned svg {\r\n  width: 12px;\r\n  height: 12px;\r\n}\r\n.collection-meta .collection-update-prompt {\r\n  margin-left: auto;\r\n  color: var(--accent);\r\n  font-size: 11px;\r\n  padding: 3px 5px;\r\n}\r\n.collection-update-list {\r\n  max-height: 320px;\r\n  overflow: auto;\r\n  margin-top: 16px;\r\n}\r\n.collection-update-row {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 10px;\r\n  padding: 9px 4px;\r\n}\r\n.collection-update-row > span:last-child {\r\n  min-width: 0;\r\n}\r\n.collection-update-row strong {\r\n  display: block;\r\n  font-size: 13px;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n.collection-update-row small {\r\n  display: block;\r\n  color: var(--muted);\r\n  font-size: 11px;\r\n}\r\n\r\n/* Separate folder navigation, name editing and whole-group selection. */\r\n.task-view .group-name-slot {\r\n  position: absolute;\r\n  top: 10px;\r\n  left: 36px;\r\n  right: 42px;\r\n  height: 28px;\r\n}\r\n.task-view .group-name-slot .group-name {\r\n  display: block;\r\n  width: 100%;\r\n  padding: 3px 4px;\r\n  min-height: 28px;\r\n  text-align: left;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n  background: transparent;\r\n  color: var(--text);\r\n  border: 0;\r\n}\r\n.task-view .group-name:hover {\r\n  background: color-mix(in srgb, var(--text) 10%, transparent);\r\n}\r\n.task-view .group-name-slot input {\r\n  width: 100%;\r\n  height: 28px;\r\n  padding: 3px 4px;\r\n  font: inherit;\r\n}\r\n.task-view .group-select {\r\n  position: absolute;\r\n  right: 8px;\r\n  top: 10px;\r\n  padding: 4px;\r\n  min-width: 28px;\r\n  min-height: 28px;\r\n  background: transparent;\r\n  border: 0;\r\n}\r\n.task-view .group-select .selection-mark {\r\n  display: block;\r\n}\r\n.task-view .tab-list .group-name-slot {\r\n  top: 50%;\r\n  transform: translateY(-50%);\r\n  right: 115px;\r\n}\r\n.task-view .tab-list .group-select {\r\n  top: 50%;\r\n  transform: translateY(-50%);\r\n}\r\n.task-view .tab-list .group-tile .preview-info {\r\n  margin-right: 30px;\r\n}\r\n.collection-color {\r\n  width: 12px;\r\n  height: 12px;\r\n  flex: 0 0 12px;\r\n  border-radius: 50%;\r\n  background: var(--collection-color);\r\n}\r\n\r\n/* Bounded native groups distinguish their members from ungrouped tabs. */\r\n.open-tab-group {\r\n  margin: 8px 0;\r\n  border-left: 3px solid var(--native-color);\r\n  border-radius: 6px;\r\n  background: color-mix(in srgb, var(--native-color) 13%, var(--side));\r\n  padding: 3px 4px 4px;\r\n  min-width: 0;\r\n}\r\n.open-group-header.group-label {\r\n  margin: 0;\r\n  min-height: 34px;\r\n  gap: 3px;\r\n  color: var(--text);\r\n}\r\n.open-group-header .editable-name,\r\n.open-group-header .inline-name {\r\n  flex: 1;\r\n  text-align: left;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n  font-size: 12px;\r\n}\r\n.open-group-fold {\r\n  flex: 0 0 25px;\r\n  width: 25px;\r\n  padding: 4px;\r\n}\r\n.open-group-count {\r\n  color: var(--muted);\r\n  padding: 0 5px;\r\n}\r\n.open-group-tabs {\r\n  padding-left: 3px;\r\n}\r\n.open-tab-group.dragging {\r\n  outline: 2px solid var(--native-color);\r\n  opacity: 0.6;\r\n}\r\n.native-group-drag-image {\r\n  position: fixed;\r\n  left: -10000px;\r\n  top: 0;\r\n  width: 290px;\r\n  padding: 12px;\r\n  box-shadow: 0 8px 24px #0004;\r\n  background: color-mix(in srgb, var(--native-color) 24%, var(--panel));\r\n}\r\n.native-group-drag-image strong {\r\n  display: block;\r\n  margin-bottom: 8px;\r\n  font-size: 13px;\r\n}\r\n.native-drag-row {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 8px;\r\n  padding: 5px 0;\r\n  font-size: 12px;\r\n}\r\n.native-drag-row span:last-child {\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n\r\n/* Collection lists share one readable, full-width row rhythm. */\r\n.collection-picker {\r\n  display: grid;\r\n  gap: 12px;\r\n  min-width: 0;\r\n}\r\n.collection-choices {\r\n  display: grid;\r\n  grid-template-columns: minmax(0, 1fr);\r\n  gap: 8px;\r\n  align-content: start;\r\n  padding: 4px;\r\n  scroll-padding-block: 8px;\r\n}\r\n.collection-picker .collection-choices,\r\n.switch-choices.collection-choices {\r\n  max-height: min(340px, 42dvh);\r\n  overflow-y: auto;\r\n}\r\n.collection-choice,\r\n.switch-choices > .collection-choice,\r\n.task-view .collection-choice {\r\n  display: flex;\r\n  flex-wrap: nowrap;\r\n  align-items: center;\r\n  gap: 12px;\r\n  width: 100%;\r\n  min-width: 0;\r\n  min-height: 56px;\r\n  padding: 10px 12px;\r\n  text-align: left;\r\n  font-size: 14px;\r\n  line-height: 1.4;\r\n  border: 0;\r\n  border-radius: 7px;\r\n  background: color-mix(in srgb, var(--collection-color) 14%, var(--panel));\r\n}\r\n.collection-copy {\r\n  display: block;\r\n  flex: 1;\r\n  min-width: 0;\r\n}\r\n.collection-name {\r\n  display: block;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n.collection-detail {\r\n  display: block;\r\n  margin-top: 3px;\r\n  font-size: 12px;\r\n  color: var(--muted);\r\n}\r\n.collection-choice > .icon {\r\n  flex: 0 0 16px;\r\n  color: var(--muted);\r\n}\r\n.collection-choice:hover,\r\n.collection-choice:focus-visible,\r\n.collection-choice[aria-selected='true'] {\r\n  background: color-mix(in srgb, var(--collection-color) 28%, var(--panel));\r\n}\r\n.collection-choice:focus-visible {\r\n  outline: 2px solid var(--accent);\r\n  outline-offset: 1px;\r\n}\r\n.search-result.collection-choice {\r\n  margin-block: 4px;\r\n}\r\n.collection-choices .search-result.collection-choice {\r\n  margin-block: 0;\r\n}\r\n\r\n.collection-versions {\r\n  display: grid;\r\n  gap: 10px;\r\n  max-height: 60dvh;\r\n  overflow: auto;\r\n  padding: 4px;\r\n}\r\n.collection-version summary small {\r\n  display: block;\r\n  color: var(--muted);\r\n  margin-top: 4px;\r\n}\r\n.collection-version .session-page {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 10px;\r\n  padding: 9px 12px;\r\n}\r\n.collection-version .row-title small {\r\n  display: block;\r\n  color: var(--muted);\r\n}\r\n\r\n/* Collection identity and direct actions */\r\n#current-collection,.collection-primary-actions,.custom-colour{display:flex;align-items:center;gap:8px;flex-wrap:wrap}\r\n#current-collection{max-width:600px;border:1px solid var(--current-color,transparent);border-radius:9px;padding:3px}\r\n.current-collection-name{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:7px}\r\n.current-colour{width:12px;height:12px;background:var(--current-color);border-radius:50%;flex:none}\r\n.collection-primary-actions{padding:4px 12px 9px;gap:5px}\r\n.collection-primary-actions button{font-size:12px;padding:5px 7px}\r\n.current-collection-card{outline:2px solid var(--color);outline-offset:3px}\r\n.collection-head,.collection-head button{color:var(--collection-ink,#17221e)}\r\n.collection-current-label{font-size:11px;color:var(--text)}\r\n.custom-colour{width:100%;padding-top:8px;font-size:12px}\r\n.custom-colour input[type=color]{width:36px;height:30px;padding:2px;cursor:pointer}\r\n.custom-colour input:not([type=color]){width:90px;padding:5px}\r\n.swatches{flex-wrap:wrap}\r\n.timeline-event-picker{width:100%;max-width:100%;margin:6px 0 12px;padding:8px}\r\n.add-collection.drag-over{outline:2px solid var(--accent);background:var(--side)}\r\n@media(max-width:1000px){.page-head{flex-wrap:wrap}.head-actions{flex-wrap:wrap}#current-collection{max-width:100%}}\r\n\r\n.task-view{max-height:calc(100dvh - 32px);min-height:0;box-sizing:border-box}\r\n\r\n.current-auto-update{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap;padding:0 7px;border-inline:1px solid var(--line)}\r\n.current-auto-update input{width:30px;height:17px;min-height:0;appearance:none;border-radius:12px;border:1px solid var(--muted);background:var(--bg);position:relative;cursor:pointer;margin:0}\r\n.current-auto-update input::before{content:'';display:block;position:absolute;width:11px;height:11px;left:2px;top:2px;border-radius:50%;background:var(--muted)}\r\n.current-auto-update input:checked{background:var(--accent);border-color:var(--accent)}\r\n.current-auto-update input:checked::before{left:15px;background:var(--bg)}\r\n.current-auto-update input:focus-visible{outline:2px solid var(--text);outline-offset:3px}\r\n.current-auto-update input:disabled{opacity:.5;cursor:wait}\r\n.auto-update-state{min-width:37px;color:var(--muted)}\r\n.page-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start}\r\n.page-head #spaces{min-width:0;flex-wrap:wrap}\r\n.global-actions{display:flex;align-items:center;justify-self:end;gap:5px}\r\n.global-actions button{font-size:12px}\r\n.global-actions #settings{width:32px;height:32px;padding:0}\r\n.page-head .head-actions{grid-column:1 / -1;min-width:0;max-width:100%}\r\n.collection-primary-actions{flex-wrap:nowrap;gap:4px}\r\n.collection-primary-actions button{padding:5px 3px;font-size:11px;gap:4px;white-space:nowrap;min-width:0}\r\n.collection-primary-actions button svg{width:14px;height:14px;flex-shrink:0}\r\n\r\n/* Quiet shared dialogs, including those mounted inside the page switcher. */\r\ndialog {\r\n  border: 1px solid var(--line);\r\n  border-radius: 4px;\r\n  box-shadow: none;\r\n  outline: none;\r\n}\r\n.organisation-fields { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px; }\r\n.organisation-fields .field { margin:0;min-width:0; }\r\n.organisation-fields input,.organisation-fields select { width:100%;min-width:0; }\r\n.organisation-fields .check-label input { width:auto; }\r\n.organisation-rule { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px 0;border-bottom:1px solid var(--line); }\r\n.organisation-rule input,.organisation-rule select {min-width:0;max-width:100%;}\r\n.inline-name-editor {display:inline-flex;align-items:center;gap:4px;position:relative;min-width:0;max-width:100%;}\r\n.inline-name-editor .inline-name {min-width:0;flex:1;}\r\n.inline-name-suggestions:not(:empty) {position:absolute;top:100%;left:0;min-width:220px;z-index:20;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);padding:6px;}\r\n.destination-suggestions {display:flex;flex-wrap:wrap;gap:4px;}\r\n.timeline-event-list {max-height:240px;overflow:auto;margin:8px 0;}\r\n.timeline-event-list>strong {display:block;margin:12px 0 4px;font-size:11px;}\r\n.timeline-event-list>button {display:block;width:100%;text-align:left;white-space:normal;font-size:11px;}\r\n@media(max-width:540px) {.organisation-fields,.organisation-rule{grid-template-columns:1fr;}}\r\ndialog::backdrop, .settings-detail::backdrop {\r\n  background: #10121640;\r\n  backdrop-filter: none;\r\n}\r\n.dialog-head, .settings-detail .dialog-head { padding: 14px 18px 8px; }\r\n.dialog-head h2, .settings-detail .dialog-head h2 {\r\n  margin: 0;\r\n  font-size: 16px;\r\n  font-weight: 550;\r\n  letter-spacing: 0;\r\n}\r\n.dialog-body, .settings-detail .dialog-body { padding: 8px 18px 16px; }\r\ndialog footer, .settings-detail footer {\r\n  padding: 8px 18px 14px;\r\n  border-top: 0;\r\n}\r\ndialog button { border-radius: 3px; }\r\ndialog .primary {\r\n  background: var(--hover);\r\n  color: var(--text);\r\n  border: 1px solid var(--line);\r\n  font-weight: 550;\r\n}\r\ndialog .primary:hover { background: var(--selected); }\r\n.action-popover { border-radius: 4px; box-shadow: none; }\r\n.action-popover h2 { font-size: 15px; font-weight: 550; }\r\n\r\n/* Direct organisation: primary controls remain readable in the narrow sidebar. */\r\n.tab-tools .grouping-controls { flex: 1 0 100%; width:100%; display:grid; gap:8px; margin-bottom:8px; }\r\n.auto-group-control { font-size:12px; color:var(--muted); }\r\n.rules-screen {display:grid;gap:16px;min-width:0;}\r\n.rules-defaults {padding:14px;background:var(--bg);border:1px solid var(--line);border-radius:4px;display:grid;gap:10px;}\r\n.rules-defaults p {margin:0;}\r\n.rule-presets,.rule-suggestions,.rules-heading,.rule-row-actions {display:flex;gap:8px;flex-wrap:wrap;align-items:center;}\r\n.rules-heading {justify-content:space-between;}\r\n.rule-presets button,.rule-suggestions button {border:1px solid var(--line);border-radius:4px;text-align:left;white-space:normal;}\r\n.rule-card {border-top:1px solid var(--line);padding:12px 0;}\r\n.rule-card>summary {display:flex;align-items:center;gap:10px;cursor:pointer;min-height:32px;flex-wrap:wrap;}\r\n.rule-card>summary span:first-of-type {flex:1;font-weight:600;}\r\n.rule-card>summary .hint {overflow-wrap:anywhere;}\r\n.rule-editor {display:grid;gap:12px;padding:12px 0;}\r\n.rule-editor input,.rule-editor select {max-width:100%;min-width:0;}\r\n.grouping-progress {display:inline-flex;gap:12px;align-items:center;}\r\n#tab-tools {flex-wrap:wrap;}\r\n#tab-tools>.tab-tools.compact {flex:1 0 100%;flex-wrap:wrap;justify-content:flex-start;}\r\n\r\n#sidebar .section-heading {display:grid;grid-template-columns:minmax(0,1fr);width:100%;min-width:0;gap:8px;}\r\n#sidebar #tab-tools {width:100%;min-width:0;}\r\n#sidebar #tab-tools>.tab-tools {width:100%;min-width:0;}\r\n.grouping-controls {min-width:0;max-width:100%;}\r\n#toast {width:max-content;}\r\n#toast>button {flex-shrink:0;}\r\n\r\n.auto-group-control.settings-preference {padding:6px 0;gap:8px;justify-content:flex-start;}\r\n.auto-group-control > span {flex:1;}\r\n.auto-group-state {min-width:20px;}\r\n\r\n.native-ungroup-drop {display:none;position:fixed;bottom:16px;z-index:60;padding:12px;border:1px dashed var(--accent);border-radius:4px;background:var(--panel);color:var(--text);text-align:center;font-size:12px;}\r\n.dragging-open-tabs .native-ungroup-drop {display:block;}\r\n.native-drop-over {outline:2px solid var(--accent);outline-offset:-2px;background:var(--selected);}\r\n.tab-open[draggable='true'] {cursor:grab;}\r\n.tab-open[draggable='true']:active {cursor:grabbing;}\r\n";

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
