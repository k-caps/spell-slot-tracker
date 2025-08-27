// Spell Slot Tracker - minimal always-on token/actor bar
// Requires dnd5e system. Inspired by Monk's Tokenbar behavior.

const MODULE_ID = "spell-slot-tracker";

Hooks.once("init", () => {
  console.log(`[${MODULE_ID}] init`);
});

Hooks.once("ready", async () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications?.warn("Spell Slot Tracker: only the dnd5e system is supported (for now).");
    return;
  }
  SpellSlotTracker.mount();
  SpellSlotTracker.refresh();
  SpellSlotTracker._wire();
});

Hooks.on("canvasReady", () => SpellSlotTracker.refresh());

// Keep in sync with common changes
Hooks.on("createToken", () => SpellSlotTracker.refresh());
Hooks.on("deleteToken", () => SpellSlotTracker.refresh());
Hooks.on("updateToken", () => SpellSlotTracker.refresh());
Hooks.on("updateActor", () => SpellSlotTracker.refresh());
Hooks.on("updateItem", () => SpellSlotTracker.refresh());
Hooks.on("controlToken", () => SpellSlotTracker.refresh());
Hooks.on("updateScene", () => SpellSlotTracker.refresh());

const SpellSlotTracker = {
  _root: null,
  _templatePath: `modules/${MODULE_ID}/templates/tracker.hbs`,
  _template: null,

  async mount() {
    // Compile template on first mount
    if (!this._template) {
      const tplText = await fetch(this._templatePath).then(r => r.text());
      this._template = Handlebars.compile(tplText);
    }

    // Create root container
    const html = document.createElement("div");
    html.id = `${MODULE_ID}-mount`;
    document.body.appendChild(html);
    this._root = html;

    // Delegate clicks on cards & chips
    html.addEventListener("click", (ev) => {
      const card = ev.target.closest(".sst-card");
      if (!card) return;
      const actorId = card.dataset.actorId;
      const actor = game.actors?.get(actorId);
      if (!actor) return;

      // Open sheet and try to switch to Spells tab
      const sheet = actor.sheet;
      sheet?.render(true);
      setTimeout(() => {
        try {
          // Foundry v11/v12 Tabbed sheets often expose a "tabs" controller
          const tabs = sheet?.tabs;
          // Some sheets provide a way to activate by group/key
          if (tabs?.[0]?.activate) {
            // Try to activate the spells tab by label or by dataset
            const tab = tabs[0].tabs.find(t => (t.label || "").toLowerCase().includes("spell"));
            if (tab) tabs[0].activate(tab.name || tab.id);
          }
        } catch (e) { /* ignore */ }
      }, 400);
    });
  },

  async refresh() {
    if (!this._root || !canvas?.scene) return;

    const actors = this._collectSceneActors();
    const viewModel = {
      actors: actors.map(a => ({
        id: a.id,
        name: a.name,
        img: a.img || a.prototypeToken?.texture?.src || "icons/svg/mystery-man.svg",
        slots: this._spellSlotsFor(a)
      }))
    };

    const html = this._template(viewModel);
    this._root.innerHTML = html;
  },

  _wire() {
    // Optionally observe token/actor collections for deeper changes (throttled)
    const throttled = foundry.utils.debounce(() => this.refresh(), 200);
    game.actors?.on("update", throttled);
    canvas.tokens?.placeables?.forEach(t => t.document?.on?.("update", throttled));
  },

  _collectSceneActors() {
    // Unique actors from placed tokens on the *current* scene.
    const tokens = canvas?.tokens?.placeables || [];
    const seen = new Set();
    const actors = [];

    for (const t of tokens) {
      const a = t.actor;
      if (!a) continue;

      // GM sees all; players see owned/observer (like Monk's Tokenbar default vibe)
      if (!game.user.isGM && !a.isOwner) continue;

      if (!seen.has(a.id)) {
        seen.add(a.id);
        actors.push(a);
      }
    }
    return actors;
  },

  _spellSlotsFor(actor) {
    // Ported from your macro, lightly adapted.
    const sys = actor?.system;
    if (!sys?.spells) return [];

    let slots = [];

    // Regular levels 1..9 (spell1..spell9)
    Object.entries(sys.spells)
      .filter(([k, v]) => k.startsWith("spell") && v?.max !== undefined)
      .forEach(([k, v]) => {
        if ((v.value ?? 0) !== 0 || (v.max ?? 0) !== 0) {
          const level = k.replace("spell", "");
          slots.push({
            level,
            label: SpellSlotTracker._levelLabel(level),
            available: v.value ?? 0,
            max: v.max ?? 0,
            icon: SpellSlotTracker._levelIcon(level)
          });
        }
      });

    // Pact slots
    const pact = sys.spells.pact;
    if (pact?.max !== undefined && ((pact.value ?? 0) !== 0 || (pact.max ?? 0) !== 0)) {
      slots.push({
        level: "P",
        label: SpellSlotTracker._levelLabel("P"),
        available: pact.value ?? 0,
        max: pact.max ?? 0,
        icon: SpellSlotTracker._levelIcon("P")
      });
    }

    // NPC/day-uses (per item)
    for (const it of actor.items ?? []) {
      if (it.type === "spell" && it.system?.uses?.per === "day") {
        const lvl = (it.system.level ?? 0).toString();
        if ((it.system.uses.value ?? 0) > 0 && (it.system.uses.max ?? 0) > 0) {
          slots.push({
            level: `NPC-${lvl}`,
            label: `NPC ${lvl}`,
            available: it.system.uses.value,
            max: it.system.uses.max,
            icon: "<i class='fas fa-scroll'></i>"
          });
        }
      }
    }

    return slots;
  },

  _levelLabel(level) {
    const map = {
      "1": "1st",
      "2": "2nd",
      "3": "3rd",
      "4": "4th",
      "5": "5th",
      "6": "6th",
      "7": "7th",
      "8": "8th",
      "9": "9th",
      "P": "Pact"
    };
    if (level?.startsWith?.("NPC-")) return `NPC ${level.slice(4)}`;
    return map[level] ?? `L${level}`;
  },

  _levelIcon(level) {
    const icons = {
      "1": "<i class='fas fa-magic'></i>",
      "2": "<i class='fas fa-fire'></i>",
      "3": "<i class='fas fa-bolt'></i>",
      "4": "<i class='fas fa-water'></i>",
      "5": "<i class='fas fa-leaf'></i>",
      "6": "<i class='fas fa-star'></i>",
      "7": "<i class='fas fa-skull'></i>",
      "8": "<i class='fas fa-meteor'></i>",
      "9": "<i class='fas fa-dragon'></i>",
      "P": "<i class='fas fa-hand-sparkles'></i>"
    };
    if (level?.startsWith?.("NPC-")) return "<i class='fas fa-scroll'></i>";
    return icons[level] ?? "<i class='fas fa-question-circle'></i>";
  }
};
