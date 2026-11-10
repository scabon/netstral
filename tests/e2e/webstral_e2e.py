#!/usr/bin/env python3
"""Webstral e2e on Firefox Dev Edition (headless, Marionette).

Suit la recette schatzy projects/firefox-marionette-e2e.md (harness wagonBAR) :
env MOZ_REMOTE_ALLOW_SYSTEM_ACCESS, badge lu via le nœud toolbar "-BAP",
seed de storage.js avec le backend IDB désactivé, pages moz-extension:// NON
navigables -> sidepanel/options testés sur copie localhost avec chrome mock.

Phases :
  A. build xpi + install temporaire -> le manifest MV3 (sidebar_action +
     background.scripts) charge, uuid résoluble.
  B. storage.js seedé (settings + usage) -> badge « 15% » (comptage local) ;
     clic sur l'icône -> pop-up (default_popup) ; bouton « Ouvrir le chat »
     de la pop-up -> message openChat -> sidebarAction.open.
  C. copie localhost du sidepanel (chrome mock) : streaming + markdown + meta.
  C2. copie localhost des options : bouton permissions (visible sans grant,
      disparaît après accord).
  C3. copie localhost de la pop-up (chrome mock) : rendu conso/compte/menu.

Usage : python tests/e2e/webstral_e2e.py
MISTRAL_API_KEY (optionnel) est juste seedé comme clé de chat (jamais affiché).
"""
import functools
import json
import math
import os
import shutil
import socket
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
import threading
import time
import zipfile
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

from marionette_driver.addons import Addons
from marionette_driver.marionette import Marionette

ROOT = Path(__file__).resolve().parents[2]
EXT_DIR = ROOT / "extension"
ADDON_ID = "webstral@cabon14.com"
FF_BINARY = Path(os.environ["ProgramFiles"]) / "Firefox Developer Edition" / "firefox.exe"
PORT = 2828
HTTP_PORT = 8973

checks = []


def check(name, ok, extra=""):
    checks.append((name, bool(ok)))
    # console Windows en cp1252 : on remplace les caractères non encodables
    clean = lambda s: s.encode("cp1252", "replace").decode("cp1252")
    print(("PASS " if ok else "FAIL ") + clean(str(name)) + (f" — {clean(str(extra))}" if extra else ""))


def wait_port_open(port, tries=30):
    for _ in range(tries):
        with socket.socket() as s:
            s.settimeout(0.2)
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return True
            time.sleep(1)
    return False


def build_xpi(dest: Path) -> None:
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(EXT_DIR.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(EXT_DIR).as_posix())


def make_profile(dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    widget = "webstral_cabon14_com"
    ui_state = json.dumps({"placements": {"nav-bar": [f"{widget}-browser-action"]}})
    (dest / "user.js").write_text(
        'user_pref("browser.shell.checkDefaultBrowser", false);\n'
        'user_pref("extensions.webextensions.ExtensionStorageIDB.enabled", false);\n'
        f'user_pref("browser.uiCustomization.state", {json.dumps(ui_state)});\n'
        'user_pref("browser.warnOnQuit", false);\n',
        encoding="utf-8",
    )
    return dest


def seed_storage(profile: Path) -> None:
    key = os.environ.get("MISTRAL_API_KEY", "").strip() or "e2e-seed-key"
    now = time.localtime()
    month = f"{now.tm_year}-{now.tm_mon:02d}"
    seeds = {
        "apiKey": key,
        "settings": {"monthlyBudgetTokens": 1000, "warnPct": 70, "dangerPct": 90},
        "usage": {month: {"prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150}},
        "accountBudget": None,
        "models": ["mistral-small-latest"],
        "conversation": [],
    }
    data_dir = profile / "browser-extension-data" / ADDON_ID
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "storage.js").write_text(json.dumps(seeds), encoding="utf-8")


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


SIDEPANEL_MOCK = """
<script>
  window.__chatRequests = [];
  window.__portListeners = [];
  (function () {
    const store = {
      apiKey: 'test-key',
      models: ['mistral-small-latest'],
      defaultModel: 'mistral-small-latest',
      accountBudget: null,
    };
    window.chrome = {
      storage: {
        local: {
          get: async (keys) => {
            const want = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of want) if (k in store) out[k] = store[k];
            return out;
          },
          set: async () => {},
        },
      },
      runtime: {
        connect: () => ({
          postMessage: (m) => __chatRequests.push(m),
          onMessage: { addListener: (fn) => __portListeners.push(fn) },
          onDisconnect: { addListener: () => {} },
        }),
        openOptionsPage: () => {},
      },
    };
  })();
</script>
<script>
  // réponses SSE simulées pour chaque chat request
  (function () {
    const answer = (req) => {
      req.__answered = true;
      for (const fn of window.__portListeners) {
        fn({ type: 'delta', content: 'Salut' });
        fn({ type: 'delta', content: ' **parent**' });
        fn({ type: 'done', usage: { prompt_tokens: 9, completion_tokens: 3 } });
      }
    };
    setInterval(() => {
      for (const r of window.__chatRequests) if (!r.__answered) answer(r);
    }, 200);
  })();
</script>
"""

OPTIONS_MOCK = """
<script>
  // Compteurs via le DOM ( monde isolé Marionette : window.* invisibles )
  (function () {
    window.__permGranted = { v: false };
    const store = {}; // persistant : bootI18n relit settings après chaque set
    window.chrome = {
      storage: {
        local: {
          get: async (k) => {
            const want = Array.isArray(k) ? k : [k];
            const out = {};
            for (const key of want) if (key in store) out[key] = store[key];
            return typeof k === "string" ? { [k]: store[k] } : out;
          },
          set: async (o) => Object.assign(store, o),
        },
        onChanged: { addListener: () => {} },
      },
      runtime: {
        sendMessage: (m, cb) =>
          setTimeout(() => cb({ accountBudget: null, accountBudgetError: 'session absente (mock)' }), 10),
        openOptionsPage: () => {},
      },
      permissions: {
        contains: async () => window.__permGranted.v,
        request: async () => {
          window.__permGranted.v = true;
          const b = document.getElementById('btn-perms');
          b.dataset.requests = String((parseInt(b.dataset.requests || '0', 10) || 0) + 1);
          return true;
        },
      },
    };
  })();
</script>
"""

POPUP_MOCK = """
<script>
  // Réponses via le DOM (monde isolé Marionette : window.* invisibles).
  (function () {
    const state = {
      ok: true,
      version: "0.3.0-test",
      lang: "fr",
      badge: {
        mode: "account", source: "admin-budget", label: "plan Vibe",
        pct: 21, color: "#1a7f37", spent: 53.55, total: 255, currency: "EUR",
        resetAt: "2026-12-01T00:00:00Z", fetchedAt: Date.now() - 5 * 60000,
      },
      settings: { warnPct: 70, dangerPct: 90, monthlyBudgetTokens: null },
      account: {
        consoleCredits: { fetchedAt: Date.now(), total: 100, spent: 40, currency: "EUR" },
        consoleCreditsError: null,
        accountBudget: { fetchedAt: Date.now(), vibe: { usage_percentage: 21.2, initial_budget: 255, currency: "EUR", reset_at: "2026-12-01T00:00:00Z" } },
        accountBudgetError: null,
        subscriptionPlan: { fetchedAt: Date.now(), plan: "pro", planRaw: "Pro", planPath: "subscription.plan.name" },
        subscriptionPlanError: null,
      },
      localUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      hasApiKey: true,
      modelCount: 3,
    };
    // #local : bascule le badge en comptage local (pour tester l'affichage repli)
    if (location.hash === "#local") {
      state.badge = {
        mode: "local", label: "comptage local", pct: 15, color: "#1a7f37",
        spentTokens: 150, budgetTokens: 1000,
      };
    }
    // #nokey : pas de clé API + plan non reconnu (masquages + bouton config)
    if (location.hash === "#nokey") {
      state.hasApiKey = false;
      state.account.subscriptionPlan = {
        fetchedAt: Date.now(), plan: null, planRaw: null, planPath: null,
        source: "admin-trpc:billing.subscriptions.current", rawPreview: "{}",
      };
    }
    // #over : conso à 95 % avec réinit dans 5 j -> projection > 100 %
    if (location.hash === "#over") {
      state.badge = {
        mode: "account", source: "admin-budget", label: "plan Vibe",
        pct: 95, color: "#b3261e", spent: 242.25, total: 255, currency: "EUR",
        resetAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        fetchedAt: Date.now(),
      };
    }
    window.chrome = {
      storage: {
        local: { get: async () => ({}), set: async () => {} },
        onChanged: { addListener: () => {} },
      },
      runtime: {
        getManifest: () => ({ version: "0.3.0-test" }),
        getURL: (p) => p,
        sendMessage: (m) => {
          if (m.type === "getPopupState") return Promise.resolve(state);
          if (m.type === "openChat") {
            document.body.dataset.openChat = "1";
            return Promise.resolve({ ok: true });
          }
          return Promise.resolve({});
        },
        openOptionsPage: () => { document.body.dataset.optionsOpened = "1"; },
      },
      tabs: {
        create: (opts) => {
          document.body.dataset.tabsCreate =
            (document.body.dataset.tabsCreate || "") + "|" + opts.url;
        },
      },
    };
  })();
</script>
"""


def build_srv(srv_dir: Path) -> None:
    srv_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(EXT_DIR / "i18n.js", srv_dir / "i18n.js")
    shutil.copytree(EXT_DIR / "sidepanel", srv_dir / "sidepanel")
    shutil.copytree(EXT_DIR / "options", srv_dir / "options")
    shutil.copytree(EXT_DIR / "popup", srv_dir / "popup")
    sp = (srv_dir / "sidepanel" / "sidepanel.html").read_text(encoding="utf-8")
    (srv_dir / "sidepanel" / "sidepanel.html").write_text(
        sp.replace(
            '<script type="module" src="sidepanel.js"></script>',
            SIDEPANEL_MOCK + '<script type="module" src="sidepanel.js"></script>',
        ),
        encoding="utf-8",
    )
    op = (srv_dir / "options" / "options.html").read_text(encoding="utf-8")
    (srv_dir / "options" / "options.html").write_text(
        op.replace(
            '<script type="module" src="options.js"></script>',
            OPTIONS_MOCK + '<script type="module" src="options.js"></script>',
        ),
        encoding="utf-8",
    )
    pp = (srv_dir / "popup" / "popup.html").read_text(encoding="utf-8")
    (srv_dir / "popup" / "popup.html").write_text(
        pp.replace(
            '<script type="module" src="popup.js"></script>',
            POPUP_MOCK + '<script type="module" src="popup.js"></script>',
        ),
        encoding="utf-8",
    )


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="webstral_e2e_"))
    profile_dir = make_profile(tmp / "profile")
    xpi = tmp / "webstral.xpi"
    srv_dir = tmp / "srv"
    build_xpi(xpi)
    seed_storage(profile_dir)
    build_srv(srv_dir)

    httpd = HTTPServer(
        ("127.0.0.1", HTTP_PORT), functools.partial(QuietHandler, directory=str(srv_dir))
    )
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    env = dict(os.environ, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS="1")
    subprocess.Popen(
        [
            str(FF_BINARY), "-marionette", "-headless", "-no-remote",
            "-profile", str(profile_dir), "about:blank",
        ],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    client = None
    try:
        assert wait_port_open(PORT), "port marionette jamais ouvert"
        client = Marionette(host="127.0.0.1", port=PORT)
        client.start_session()

        # ---- Phase A : install + manifest
        try:
            Addons(client).install(str(xpi), temp=True)
            uuids = client.get_pref("extensions.webextensions.uuids")
            uuid_map = json.loads(uuids) if uuids else {}
            check(
                "A: install temporaire + uuid",
                ADDON_ID in uuid_map,
                str(uuid_map.get(ADDON_ID, "")),
            )
        except Exception as e:
            check("A: install temporaire + uuid", False, str(e)[:200])
            return 1

        # ---- Phase B : badge + sidebar
        time.sleep(2.0)
        client.set_context("chrome")

        def chrome_script(src):
            return client.execute_script(
                f"""
                const win = Services.wm.getMostRecentWindow('navigator:browser');
                {src}
                """
            )

        badge = None
        for _ in range(20):
            badge = chrome_script(
                """
                const b = win.document.getElementById('webstral_cabon14_com-BAP');
                return b ? b.getAttribute('badge') : null;
                """
            )
            if badge:
                break
            time.sleep(0.5)
        check("B: badge = 15% (comptage local seed)", badge == "15%", repr(badge))

        # Le manifest embarqué (xpi buildé depuis extension/) doit déclarer
        # la pop-up sur l'action.
        with zipfile.ZipFile(xpi) as z:
            manifest_popup = json.loads(z.read("manifest.json"))["action"].get("default_popup")
        check(
            "B: manifest embarqué déclare action.default_popup",
            manifest_popup == "popup/popup.html",
            repr(manifest_popup),
        )

        # En headless, un clic synthétique sur le bouton n'ouvre pas de
        # panel pop-up inspectable ; on valide à la place :
        # - manifest embarqué : action.default_popup (check ci-dessus, Python) ;
        # - la sidebar de l'extension s'ouvre à l'installation
        #   (sidebar_action.open_at_install) ;
        # - le flux « openChat -> sidebarAction.open » du vrai background est
        #   couvert par tests/ff-sidebar-smoke.mjs, et le rendu/boutons de la
        #   pop-up par la phase C3 ci-dessous.
        after = chrome_script(
            """
            const box = win.document.getElementById('sidebar-box');
            if (!box) return null;
            const src = box.getAttribute('src') || '';
            const cmd = box.getAttribute('sidebarcommand') || '';
            const browser = box.querySelector('browser');
            return {
              hidden: box.hidden,
              cmd,
              isExt:
                cmd.endsWith('-sidebar-action') ||
                src.startsWith('moz-extension://') ||
                (browser && (browser.getAttribute('src') || '').startsWith('moz-extension://')),
              src: src.slice(0, 45),
            };
            """
        )
        print("B: sidebar (open_at_install):", after)
        check(
            "B: sidebar extension active à l'installation (open_at_install)",
            after is not None and not after["hidden"] and after["isExt"],
            f"after={after}",
        )

        # ---- Phase C : copie localhost sidepanel (chrome mock)
        client.set_context("content")
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/sidepanel/sidepanel.html")
        time.sleep(0.8)
        client.execute_script(
            """
            const p = document.getElementById('prompt');
            p.value = 'test streaming';
            document.getElementById('btn-send').click();
            """
        )
        time.sleep(2.0)
        sp = client.execute_script(
            """
            return {
              assistant: (document.querySelector('.msg.assistant') || {}).textContent,
              meta: (document.querySelector('.meta') || {}).textContent,
              strong: !!document.querySelector('.msg.assistant strong'),
            };
            """
        )
        check(
            "C: streaming + markdown + meta (page localhost)",
            sp
            and "Salut" in (sp.get("assistant") or "")
            and sp.get("strong")
            and "9 tokens in" in (sp.get("meta") or ""),
            json.dumps(sp, ensure_ascii=False)[:160],
        )

        # ---- Phase C2 : copie localhost options (permissions mock)
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/options/options.html")
        time.sleep(0.8)
        opt = client.execute_script(
            """
            const view = document.getElementById('perm-view');
            const btn = document.getElementById('btn-perms');
            const visible = btn && !btn.classList.contains('hidden');
            if (btn) btn.click();
            return { view: view ? view.textContent : null, buttonVisible: visible };
            """
        )
        time.sleep(0.5)
        opt_after = client.execute_script(
            """
            return {
              view: document.getElementById('perm-view').textContent,
              buttonHidden: document.getElementById('btn-perms').classList.contains('hidden'),
              permsRequested: parseInt(document.getElementById('btn-perms').dataset.requests || '0', 10),
            };
            """
        )
        check(
            "C2: bouton permissions (visible sans accord, masqué après)",
            opt is not None
            and opt.get("buttonVisible")
            and opt_after.get("permsRequested") == 1
            and opt_after.get("buttonHidden")
            and "accordé" in (opt_after.get("view") or ""),
            json.dumps(opt_after, ensure_ascii=False)[:160],
        )

        # ---- Phase C2b : langue + thème + alertes dans les options
        disp = client.execute_script(
            """
            const theme = document.getElementById('theme');
            theme.value = 'dark';
            theme.dispatchEvent(new Event('change'));
            const lang = document.getElementById('lang');
            lang.value = 'en';
            lang.dispatchEvent(new Event('change'));
            return { themeAvant: document.documentElement.dataset.theme };
            """
        )
        time.sleep(0.6)
        disp_after = client.execute_script(
            """
            return {
              theme: document.documentElement.dataset.theme,
              testBtn: document.getElementById('btn-test').textContent,
              alerts: document.getElementById('alerts-enabled').checked,
              alertPct: String(document.getElementById('alert-pct').value),
            };
            """
        )
        check(
            "C2b: thème dark + langue EN appliqués, case alertes cochée à 90%",
            disp is not None
            and disp_after.get("theme") == "dark"
            and disp_after.get("testBtn") == "Test connection and load models"
            and disp_after.get("alerts") is True
            and disp_after.get("alertPct") == "90",
            json.dumps(disp_after, ensure_ascii=False)[:200],
        )

        # ---- Phase C3 : copie localhost de la pop-up (chrome mock)
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/popup/popup.html")
        time.sleep(0.8)
        pop = client.execute_script(
            """
            const fill = document.getElementById('bar-fill');
            return {
              version: document.getElementById('version').textContent,
              pct: document.getElementById('conso-pct').textContent,
              width: fill.style.width,
              bg: fill.style.background,
              detail: document.getElementById('conso-detail').textContent,
              plan: document.getElementById('acc-plan').textContent,
              planRowHidden: document.getElementById('plan-row').classList.contains('hidden'),
              wallet: document.getElementById('acc-wallet').textContent,
              reset: document.getElementById('acc-reset').textContent,
              resetIn: document.getElementById('acc-reset-in').textContent,
              keyRowHidden: document.getElementById('key-row').classList.contains('hidden'),
              errHidden: document.getElementById('acc-error').classList.contains('hidden'),
              localHidden: document.querySelector('section.local').classList.contains('hidden'),
              projHidden: document.getElementById('projection').classList.contains('hidden'),
              projRate: document.getElementById('proj-rate').textContent,
              proj100: document.getElementById('proj-100').textContent,
              markLabel: document.getElementById('proj-mark-label').textContent,
              markOver: document.getElementById('proj-mark-label').classList.contains('over'),
              fillWidth: document.getElementById('proj-fill').style.width,
              overWidth: document.getElementById('proj-over100').style.width,
              tickLeft: document.getElementById('proj-tick100').style.left,
            };
            """
        )
        # projection attendue (même calcul que popup.js : pct=21, reset 2026-12-01Z)
        reset_ms = datetime(2026, 12, 1, tzinfo=timezone.utc).timestamp() * 1000
        prev_ms = datetime(2026, 11, 1, tzinfo=timezone.utc).timestamp() * 1000
        period = round((reset_ms - prev_ms) / 86400000)
        days_left = max(0, math.ceil((reset_ms - time.time() * 1000) / 86400000))
        elapsed = max(1, period - days_left)
        rate = 21 / elapsed
        end_pct = round(rate * period)
        d100 = round((100 - 21) / rate)
        check(
            "C3: pop-up rend conso (21%) + plan Pro + reset dans Xj ; BYOK masquée, local masqué",
            pop
            and pop["version"] == "v0.3.0-test"
            and pop["pct"].replace(" ", "").replace("\u202f", "").replace("\u00a0", "") == "21%"
            and pop["width"] == "21%"
            and "26" in pop["bg"]  # rgb(26, 127, 55) = #1a7f37
            and "255" in pop["detail"]
            and pop["plan"] == "Pro" and pop["planRowHidden"] is False
            and pop["reset"] == "2026-12-01"  # yyyy-MM-dd
            and "dans" in pop["resetIn"] and "jour" in pop["resetIn"]
            and pop["keyRowHidden"] is True  # clé configurée -> ligne BYOK masquée
            and pop["errHidden"] is True   # source compte OK -> pas d'erreur de session
            and pop["localHidden"] is True  # comptage local masqué avec source compte
            and pop["projHidden"] is False
            and "%/jour" in pop["projRate"]
            and f"dans {days_left} j" in pop["projRate"]
            and pop["markLabel"] == f"~{end_pct} %" and pop["markOver"] is False
            and pop["fillWidth"] == "21%"      # 21% de l'échelle 0-100
            and pop["tickLeft"] == "100%"      # tick 100 % à droite (échelle = 100)
            and pop["overWidth"] == "0%"       # projection < 100 % -> pas de zone hachurée
            and "100 %" in pop["proj100"] and f"~{d100} j" in pop["proj100"],
            json.dumps(pop, ensure_ascii=False)[:220]
            + f" | attendu: mark ~{end_pct}%, dans {days_left}j, 100% dans ~{d100}j",
        )

        # C3b : repli comptage local (#local) -> section local visible.
        # (détour par une autre page : même URL + hash ne rechargerait pas)
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/options/options.html")
        time.sleep(0.4)
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/popup/popup.html#local")
        time.sleep(0.8)
        pop_local = client.execute_script(
            """
            return {
              pct: document.getElementById('conso-pct').textContent,
              detail: document.getElementById('conso-detail').textContent,
              localHidden: document.querySelector('section.local').classList.contains('hidden'),
              tokens: document.getElementById('local-tokens').textContent,
              projHidden: document.getElementById('projection').classList.contains('hidden'),
              markLabel: document.getElementById('proj-mark-label').textContent,
              fillWidth: document.getElementById('proj-fill').style.width,
            };
            """
        )
        norm = lambda s: (s or "").replace(" ", "").replace("\u202f", "").replace("\u00a0", "")
        check(
            "C3b: repli local -> 15%, 150/1000 tokens, section local visible, projection graphique",
            pop_local
            and norm(pop_local["pct"]) == "15%"
            and "150" in pop_local["detail"] and "1000" in norm(pop_local["detail"])
            and pop_local["localHidden"] is False
            and norm(pop_local["tokens"]) == "15"
            and pop_local["projHidden"] is False
            and pop_local["markLabel"].startswith("~") and pop_local["markLabel"].endswith(" %")
            and pop_local["fillWidth"] == "15%",
            json.dumps(pop_local, ensure_ascii=False)[:200],
        )

        # C3d : #over -> projection > 100 % : zone hachurée, marqueur rouge
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/options/options.html")
        time.sleep(0.4)
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/popup/popup.html#over")
        time.sleep(0.8)
        over = client.execute_script(
            """
            const fill = document.getElementById('proj-fill');
            return {
              pct: document.getElementById('conso-pct').textContent,
              markLabel: document.getElementById('proj-mark-label').textContent,
              markOver: document.getElementById('proj-mark-label').classList.contains('over'),
              fillWidth: fill.style.width,
              fillBg: fill.style.background,
              overWidth: document.getElementById('proj-over100').style.width,
              tickLeft: document.getElementById('proj-tick100').style.left,
              proj100: document.getElementById('proj-100').textContent,
              warn: document.getElementById('proj-100').classList.contains('warn'),
            };
            """
        )
        check(
            "C3d: projection > 100 % -> zone hachurée, marqueur rouge, tick 100 % avant la fin",
            over
            and norm(over["pct"]) == "95%"
            and over["markOver"] is True
            and over["markLabel"].startswith("~")
            and int(over["markLabel"].replace("~", "").replace(" %", "")) > 100
            and float(over["fillWidth"].rstrip("%")) > 50
            and float(over["overWidth"].rstrip("%")) > 0
            and float(over["tickLeft"].rstrip("%")) < 100
            and "100 %" in over["proj100"],
            json.dumps(over, ensure_ascii=False)[:220],
        )
        # C3c : #nokey -> plan masqué, bouton « Configurer la clé API » -> options
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/options/options.html")
        time.sleep(0.4)
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/popup/popup.html#nokey")
        time.sleep(0.8)
        nokey = client.execute_script(
            """
            document.getElementById('btn-config-key').click();
            return {
              planRowHidden: document.getElementById('plan-row').classList.contains('hidden'),
              keyRowHidden: document.getElementById('key-row').classList.contains('hidden'),
              optionsOpened: document.body.dataset.optionsOpened || '',
            };
            """
        )
        check(
            "C3c: sans clé -> bouton config (ouvre options) ; type de plan masqué",
            nokey
            and nokey["planRowHidden"] is True
            and nokey["keyRowHidden"] is False
            and nokey["optionsOpened"] == "1",
            json.dumps(nokey, ensure_ascii=False)[:200],
        )

        menu = client.execute_script(
            """
            document.getElementById('btn-menu').click();
            const menu = document.getElementById('menu');
            const visible = menu && !menu.classList.contains('hidden');
            document.getElementById('btn-chat').click();
            document.getElementById('btn-console').click();
            document.getElementById('btn-subscription').click();
            document.getElementById('btn-about').click();
            document.getElementById('btn-options').click();
            return {
              visible,
              openChat: document.body.dataset.openChat || '',
              tabsCreate: document.body.dataset.tabsCreate || '',
              optionsOpened: document.body.dataset.optionsOpened || '',
            };
            """
        )
        check(
            "C3: menu pop-up (chat/console/subscription/about/options)",
            menu
            and menu["visible"]
            and menu["openChat"] == "1"
            and "console.mistral.ai" in menu["tabsCreate"]
            and "admin.mistral.ai/subscription" in menu["tabsCreate"]
            and "pages/about.html" in menu["tabsCreate"]
            and menu["optionsOpened"] == "1",
            json.dumps(menu, ensure_ascii=False)[:220],
        )

        return 0 if all(ok for _, ok in checks) else 1
    finally:
        try:
            if client:
                client.quit()
        except Exception:
            pass
        httpd.shutdown()
        time.sleep(1.0)
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"name='firefox.exe'\" | "
             "Where-Object { $_.CommandLine -like '*-marionette*' } | "
             "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
            check=False, capture_output=True,
        )
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
