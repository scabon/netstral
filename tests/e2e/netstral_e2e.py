#!/usr/bin/env python3
"""Netstral e2e on Firefox Dev Edition (headless, Marionette).

Suit la recette schatzy projects/firefox-marionette-e2e.md (harness wagonBAR) :
env MOZ_REMOTE_ALLOW_SYSTEM_ACCESS, badge lu via le nœud toolbar "-BAP",
seed de storage.js avec le backend IDB désactivé, pages moz-extension:// NON
navigables -> la pop-up est testée sur copie localhost avec chrome mock.

Phases :
  A. build xpi + install temporaire -> le manifest MV3 (background.scripts)
     charge, uuid résoluble.
  B. storage.js seedé (settings + usage) -> badge « 15% » (comptage local) ;
     manifest embarqué : default_popup déclaré, AUCUN side_panel/sidebar_action.
  C2. copie localhost de la pop-up : réglages (thème dark, langue EN avec
      drapeaux, alertes, clé API pré-remplie).
  C3. copie localhost de la pop-up (chrome mock) : rendu conso/projection/menu.

Usage : python tests/e2e/netstral_e2e.py
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
ADDON_ID = "netstral@cabon14.com"
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
    widget = "netstral_cabon14_com"
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
    now = time.localtime()
    month = f"{now.tm_year}-{now.tm_mon:02d}"
    seeds = {
        "settings": {"monthlyBudgetTokens": 1000, "warnPct": 70, "dangerPct": 90},
        "usage": {month: {"prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150}},
        "accountBudget": None,
    }
    data_dir = profile / "browser-extension-data" / ADDON_ID
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "storage.js").write_text(json.dumps(seeds), encoding="utf-8")


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


POPUP_MOCK = """
<script>
  // Réponses via le DOM (monde isolé Marionette : window.* invisibles).
  // storage persistant : les réglages écrits par la pop-up sont relus au load.
  (function () {
    const store = {};
    const state = {
      ok: true,
      version: "0.5.0-test",
      lang: "fr",
      badge: {
        mode: "account", source: "admin-budget", label: "plan Vibe", labelKey: "badge_plan_vibe",
        pct: 21, color: "#1a7f37", spent: 53.55, total: 255, currency: "EUR",
        resetAt: "2026-12-01T00:00:00Z", fetchedAt: Date.now() - 5 * 60000,
      },
      settings: { warnPct: 70, dangerPct: 90, monthlyBudgetTokens: null, lang: "system", theme: "system", alertsEnabled: true, alertPct: 90, notifyOnReset: true },
      account: {
        consoleCredits: { fetchedAt: Date.now(), total: 100, spent: 40, currency: "EUR" },
        consoleCreditsError: null,
        accountBudget: { fetchedAt: Date.now(), vibe: { usage_percentage: 21.2, initial_budget: 255, currency: "EUR", reset_at: "2026-12-01T00:00:00Z" } },
        accountBudgetError: null,
        subscriptionPlan: { fetchedAt: Date.now(), plan: "pro", planRaw: "Pro", planPath: "subscription.plan.name" },
        subscriptionPlanError: null,
      },
      localUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    function refreshLang() {
      const s = store.settings || {};
      state.settings = {
        warnPct: 70, dangerPct: 90, monthlyBudgetTokens: null,
        lang: s.lang ?? "system", theme: s.theme ?? "system",
        alertsEnabled: s.alertsEnabled !== false, alertPct: s.alertPct ?? 90, notifyOnReset: s.notifyOnReset !== false,
      };
      state.lang = NetstralI18n.resolveLang(s.lang, "fr-FR");
    }
    refreshLang();
    // #local : badge en comptage local ; #over : projection > 100 % ;
    // #nokey : plan non reconnu.
    if (location.hash === "#local") {
      state.badge = { mode: "local", label: "comptage local", labelKey: "badge_local", pct: 15, color: "#1a7f37", spentTokens: 150, budgetTokens: 1000 };
    }
    if (location.hash === "#over") {
      state.badge = {
        mode: "account", source: "admin-budget", label: "plan Vibe", labelKey: "badge_plan_vibe",
        pct: 95, color: "#b3261e", spent: 242.25, total: 255, currency: "EUR",
        resetAt: new Date(Date.now() + 5 * 86400000).toISOString(), fetchedAt: Date.now(),
      };
    }
    if (location.hash === "#nokey") {
      state.account.subscriptionPlan = {
        fetchedAt: Date.now(), plan: null, planRaw: null, planPath: null,
        source: "admin-trpc:billing.subscriptions.current", rawPreview: "{}",
      };
      refreshLang();
    }
    window.chrome = {
      storage: {
        local: {
          get: async (k) => {
            const want = Array.isArray(k) ? k : [k];
            const out = {};
            for (const key of want) if (key in store) out[key] = store[key];
            return typeof k === "string" ? { [k]: store[k] } : out;
          },
          set: async (o) => { Object.assign(store, o); refreshLang(); },
        },
        onChanged: { addListener: () => {} },
      },
      runtime: {
        getManifest: () => ({ version: "0.5.0-test" }),
        getURL: (p) => p,
        sendMessage: (m) => {
          if (m.type === "getPopupState") return Promise.resolve(state);
          if (m.type === "refreshBudget") {
            document.body.dataset.refreshBudget = "1";
            return Promise.resolve({});
          }
          return Promise.resolve({});
        },
      },
      tabs: {
        create: (opts) => {
          document.body.dataset.tabsCreate =
            (document.body.dataset.tabsCreate || "") + "|" + opts.url;
        },
      },
      windows: { getCurrent: async () => ({ id: 1 }) },
    };
  })();
</script>
"""


def build_srv(srv_dir: Path) -> None:
    srv_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(EXT_DIR / "i18n.js", srv_dir / "i18n.js")
    shutil.copy(EXT_DIR / "changelog.js", srv_dir / "changelog.js")
    shutil.copytree(EXT_DIR / "popup", srv_dir / "popup")
    pp = (srv_dir / "popup" / "popup.html").read_text(encoding="utf-8")
    (srv_dir / "popup" / "popup.html").write_text(
        pp.replace(
            '<script type="module" src="popup.js"></script>',
            POPUP_MOCK + '<script type="module" src="popup.js"></script>',
        ),
        encoding="utf-8",
    )


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="netstral_e2e_"))
    profile_dir = make_profile(tmp / "profile")
    xpi = tmp / "netstral.xpi"
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

        # ---- Phase B : badge + manifest embarqué
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
                const b = win.document.getElementById('netstral_cabon14_com-BAP');
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
        # - manifest embarqué : action.default_popup (check ci-dessus) ;
        # - AUCUN side panel : ni side_panel ni sidebar_action ni la
        #   permission sidePanel dans le manifest embarqué ;
        # - le rendu/boutons de la pop-up par les phases C2/C3 ci-dessous.
        with zipfile.ZipFile(xpi) as z:
            manifest = json.loads(z.read("manifest.json"))
        check(
            "B: manifest embarqué sans side_panel / sidebar_action / permission sidePanel",
            "side_panel" not in manifest
            and "sidebar_action" not in manifest
            and "sidePanel" not in manifest.get("permissions", []),
            json.dumps(
                {k: manifest.get(k) for k in ("side_panel", "sidebar_action", "permissions")}
            ),
        )

        # ---- Phase C2 : réglages dans la pop-up (thème/langue/alertes/clé)
        client.set_context("content")
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/popup/popup.html")
        time.sleep(0.8)
        disp = client.execute_script(
            """
            return (async () => {
              const r = {};
              r.themeAvant = document.documentElement.dataset.theme;
              r.setTitleFr = document.querySelector('#view-settings h2').textContent;
              r.alerts = document.getElementById('alertsEnabled').checked;
              r.alertPct = String(document.getElementById('alertPct').value);
              r.notifyReset = document.getElementById('notifyOnReset').checked;
              // navigation : menu ⋮ -> Réglages -> vue settings, retour <- vue main
              r.mainVisible = !document.getElementById('view-main').classList.contains('hidden');
              r.settingsHidden = document.getElementById('view-settings').classList.contains('hidden');
              // display calculé (régression : #view-* { display:flex } écrasait .hidden)
              r.mainDisplay = getComputedStyle(document.getElementById('view-main')).display;
              r.settingsDisplay = getComputedStyle(document.getElementById('view-settings')).display;
              document.getElementById('btn-menu').click();
              document.getElementById('btn-settings').click();
              r.settingsShown = !document.getElementById('view-settings').classList.contains('hidden');
              r.settingsDisplayShown = getComputedStyle(document.getElementById('view-settings')).display;
              r.mainDisplaySettings = getComputedStyle(document.getElementById('view-main')).display;
              r.menuClosed = document.getElementById('menu').classList.contains('hidden');
              document.getElementById('btn-back').click();
              r.backToMain = !document.getElementById('view-main').classList.contains('hidden');
              r.mainDisplayBack = getComputedStyle(document.getElementById('view-main')).display;
              r.settingsDisplayBack = getComputedStyle(document.getElementById('view-settings')).display;
              // changelog : menu ⋮ -> Changelog -> vue changelog, retour <- vue main
              document.getElementById('btn-menu').click();
              document.getElementById('btn-changelog').click();
              r.changelogShown = !document.getElementById('view-changelog').classList.contains('hidden');
              r.changelogDisplay = getComputedStyle(document.getElementById('view-changelog')).display;
              r.mainDisplayChangelog = getComputedStyle(document.getElementById('view-main')).display;
              r.settingsDisplayChangelog = getComputedStyle(document.getElementById('view-settings')).display;
              r.changelogEntries = document.querySelectorAll('#changelogContent h3').length;
              r.changelogTop = (document.querySelector('#changelogContent h3') || {}).textContent || '';
              document.getElementById('btn-back-changelog').click();
              r.backFromChangelog = !document.getElementById('view-main').classList.contains('hidden');
              r.changelogDisplayBack = getComputedStyle(document.getElementById('view-changelog')).display;
              // aide : menu ⋮ -> Aide -> vue help (i18n), retour <- vue main
              document.getElementById('btn-menu').click();
              r.menuIcons = document.querySelectorAll('#menu button svg').length;
              document.getElementById('btn-help').click();
              r.helpShown = !document.getElementById('view-help').classList.contains('hidden');
              r.helpDisplay = getComputedStyle(document.getElementById('view-help')).display;
              r.mainDisplayHelp = getComputedStyle(document.getElementById('view-main')).display;
              r.helpSections = document.querySelectorAll('#helpContent h3').length;
              r.helpGithub = !!document.querySelector('#helpContent a[href*="github.com/scabon/netstral"]');
              document.getElementById('btn-back-help').click();
              r.backFromHelp = !document.getElementById('view-main').classList.contains('hidden');
              r.helpDisplayBack = getComputedStyle(document.getElementById('view-help')).display;
              // à propos : menu ⋮ -> À propos -> vue about (site/support/dons), retour <- vue main
              document.getElementById('btn-menu').click();
              document.getElementById('btn-about').click();
              r.aboutShown = !document.getElementById('view-about').classList.contains('hidden');
              r.aboutDisplay = getComputedStyle(document.getElementById('view-about')).display;
              r.mainDisplayAbout = getComputedStyle(document.getElementById('view-main')).display;
              r.aboutSections = document.querySelectorAll('#aboutContent h3').length;
              r.aboutBrand = (document.querySelector('#aboutContent .brand-line') || {}).textContent || '';
              r.aboutSite = !!document.querySelector('#aboutContent a[href*="cabon14.com"]');
              r.aboutSupport = !!document.querySelector('#aboutContent a[href^="mailto:support@cabon14.com"]');
              r.aboutLiberapay = !!document.querySelector('#aboutContent a.donate-liberapay[href*="liberapay.com/cabon14"]');
              r.aboutTipeee = !!document.querySelector('#aboutContent a.donate-tipeee[href*="tipeee.com/cabon14"]');
              r.aboutNoTab = (document.body.dataset.tabsCreate || '').indexOf('pages/') === -1;
              document.getElementById('btn-back-about').click();
              r.backFromAbout = !document.getElementById('view-main').classList.contains('hidden');
              r.aboutDisplayBack = getComputedStyle(document.getElementById('view-about')).display;
              const th = document.getElementById('themeSelect');
              th.value = 'dark'; th.dispatchEvent(new Event('change'));
              const lg = document.getElementById('langSelect');
              lg.value = 'en'; lg.dispatchEvent(new Event('change'));
              await new Promise((res) => setTimeout(res, 400));
              r.theme = document.documentElement.dataset.theme;
              r.setTitleEn = document.querySelector('#view-settings h2').textContent;
              r.langVal = document.getElementById('langSelect').value;
              r.flagTheme = (document.querySelector('#themeSelect option[value="dark"]') || {}).textContent || '';
              r.flagLang = (document.querySelector('#langSelect option[value="fr"]') || {}).textContent || '';
              return r;
            })();
            """
        )
        check(
            "C2: vues dédiées (⋮ -> Réglages/Aide/Changelog/À propos -> retour, icônes), dark + EN, drapeaux, alertes",
            disp is not None
            and disp.get("mainVisible") is True
            and disp.get("settingsHidden") is True
            and disp.get("settingsShown") is True
            and disp.get("menuClosed") is True
            and disp.get("backToMain") is True
            and disp.get("mainDisplay") == "flex"
            and disp.get("settingsDisplay") == "none"
            and disp.get("settingsDisplayShown") == "flex"
            and disp.get("mainDisplaySettings") == "none"
            and disp.get("mainDisplayBack") == "flex"
            and disp.get("settingsDisplayBack") == "none"
            and disp.get("changelogShown") is True
            and disp.get("changelogDisplay") == "flex"
            and disp.get("mainDisplayChangelog") == "none"
            and disp.get("settingsDisplayChangelog") == "none"
            and disp.get("changelogEntries") == 0
            and disp.get("changelogTop") == ""
            and disp.get("backFromChangelog") is True
            and disp.get("changelogDisplayBack") == "none"
            and disp.get("menuIcons") == 4
            and disp.get("helpShown") is True
            and disp.get("helpDisplay") == "flex"
            and disp.get("mainDisplayHelp") == "none"
            and disp.get("helpSections") == 4
            and disp.get("helpGithub") is True
            and disp.get("backFromHelp") is True
            and disp.get("helpDisplayBack") == "none"
            and disp.get("aboutShown") is True
            and disp.get("aboutDisplay") == "flex"
            and disp.get("mainDisplayAbout") == "none"
            and disp.get("aboutSections") == 1
            and "v" in disp.get("aboutBrand", "")
            and disp.get("aboutSite") is True
            and disp.get("aboutSupport") is True
            and disp.get("aboutLiberapay") is True
            and disp.get("aboutTipeee") is True
            and disp.get("aboutNoTab") is True
            and disp.get("backFromAbout") is True
            and disp.get("aboutDisplayBack") == "none"
            and disp.get("setTitleFr") == "Réglages"
            and disp.get("theme") == "dark"
            and disp.get("setTitleEn") == "Settings"
            and disp.get("langVal") == "en"
            and "🌙" in disp.get("flagTheme", "")
            and "🇫🇷" in disp.get("flagLang", "")
            and disp.get("alerts") is True
            and disp.get("alertPct") == "90"
            and disp.get("notifyReset") is True,
            json.dumps(disp, ensure_ascii=False)[:1500],
        )

        # ---- Phase C3 : copie localhost de la pop-up (chrome mock)
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/i18n.js")
        time.sleep(0.4)
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
            "C3: pop-up rend conso (21%) + plan Pro + reset dans Xj + projection ; local masqué",
            pop
            and pop["version"] == "v0.5.0-test"
            and pop["pct"].replace(" ", "").replace("\u202f", "").replace("\u00a0", "") == "21%"
            and pop["width"] == "21%"
            and "26" in pop["bg"]  # rgb(26, 127, 55) = #1a7f37
            and "255" in pop["detail"]
            and pop["plan"] == "Pro" and pop["planRowHidden"] is False
            and pop["reset"] == "2026-12-01"  # yyyy-MM-dd
            and "dans" in pop["resetIn"] and "jour" in pop["resetIn"]
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
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/i18n.js")
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
              hintVisible: !document.getElementById('acc-error').classList.contains('hidden'),
              hintClass: document.getElementById('acc-error').className,
              hintLink: (document.querySelector('#acc-error a') || {}).href || '',
            };
            """
        )
        norm = lambda s: (s or "").replace(" ", "").replace("\u202f", "").replace("\u00a0", "")
        check(
            "C3b: repli local -> 15%, 150/1000 tokens, section local visible, projection graphique, bandeau connexion",
            pop_local
            and norm(pop_local["pct"]) == "15%"
            and "150" in pop_local["detail"] and "1000" in norm(pop_local["detail"])
            and pop_local["localHidden"] is False
            and norm(pop_local["tokens"]) == "15"
            and pop_local["projHidden"] is False
            and pop_local["markLabel"].startswith("~") and pop_local["markLabel"].endswith(" %")
            and pop_local["fillWidth"] == "15%"
            and pop_local["hintVisible"] is True
            and pop_local["hintClass"] == "hint"
            and "console.mistral.ai" in pop_local["hintLink"],
            json.dumps(pop_local, ensure_ascii=False)[:200],
        )

        # C3d : #over -> projection > 100 % : zone hachurée, marqueur rouge
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/i18n.js")
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
        # C3c : #nokey -> plan non reconnu -> ligne plan masquée
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/i18n.js")
        time.sleep(0.4)
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/popup/popup.html#nokey")
        time.sleep(0.8)
        nokey = client.execute_script(
            """
            return {
              planRowHidden: document.getElementById('plan-row').classList.contains('hidden'),
              settingsVisible: !document.querySelector('section.settings').classList.contains('hidden'),
            };
            """
        )
        check(
            "C3c: plan non reconnu -> type de plan masqué",
            nokey
            and nokey["planRowHidden"] is True
            and nokey["settingsVisible"] is True,
            json.dumps(nokey, ensure_ascii=False)[:200],
        )

        menu = client.execute_script(
            """
            return (async () => {
            const rb = document.getElementById('btn-refresh');
            const sourceAvant = document.getElementById('conso-source').textContent;
            if (rb) rb.click();
            const chatBtn = document.querySelector('header #btn-chat');
            if (chatBtn) chatBtn.click();
            document.getElementById('btn-menu').click();
            const menu = document.getElementById('menu');
            const visible = menu && !menu.classList.contains('hidden');
            document.getElementById('btn-about').click();
            await new Promise((r) => setTimeout(r, 200));
            return {
              visible,
              chatInHeader: !!chatBtn,
              refreshPresent: !!rb,
              refreshCalled: document.body.dataset.refreshBudget || '',
              sourceAvant,
              tabsCreate: document.body.dataset.tabsCreate || '',
              aboutView: getComputedStyle(document.getElementById('view-about')).display,
              linkConsole: (document.getElementById('link-console') || {}).href || '',
              linkSub: (document.getElementById('link-subscription') || {}).href || '',
            };
            })();
            """
        )
        time.sleep(0.5)
        check(
            "C3: bouton chat en haut -> chat.mistral.ai, refresh, menu, liens en bas",
            menu
            and menu["chatInHeader"] is True
            and "chat.mistral.ai" in menu["tabsCreate"]
            and menu["visible"]
            and menu["refreshPresent"] is True
            and menu["refreshCalled"] == "1"
            and "lu il y a" in menu["sourceAvant"]
            and "Source" not in menu["sourceAvant"]
            and menu["aboutView"] == "flex"
            and "pages/" not in menu["tabsCreate"]
            and "console.mistral.ai" in menu["linkConsole"]
            and "admin.mistral.ai/subscription" in menu["linkSub"],
            json.dumps(menu, ensure_ascii=False)[:260],
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
